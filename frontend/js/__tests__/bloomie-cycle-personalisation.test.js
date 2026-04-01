/**
 * bloomie-cycle-personalisation.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for cycle-aware personalisation helpers:
 *
 *   buildCyclePersonalisationLine(context)
 *     - appends variability string in LATE_INTRO when IRREGULAR_CYCLE signal set
 *     - no line appended when no cycleSignals present
 *     - no line appended when ctx.urgency is true (user routes to HEAVY_URGENT)
 *
 *   buildSymptomPatternLine(catalogCodes)
 *     - returns a string the first time when pattern signal + history match
 *     - adviceGiven guard prevents a second rendering (dedup key set after first)
 *     - returns null when no symptomHistory provided
 *     - returns null when no matching pattern signal present
 *
 *   loggingGapPending / START node
 *     - adviceGiven entry set on mount when SYMPTOM_LOGGING_GAP signal is "high"
 *     - logging gap message appears in chatbox after mount timers fire
 *     - no message when signal level is not "high"
 *     - no message when no signal present
 *
 * Implementation notes:
 *   - loggingGapPending is set then immediately consumed (synchronously) by the
 *     START node's say() during transition("START") at the end of initBloomieChat().
 *     The flag itself is always false after mount; we test the observable effects
 *     (adviceGiven entry, chatbox text) instead.
 *   - say() timers are cleared by subsequent transition() calls, so empathetic or
 *     personalisation copy that fires from a gate node's onEnter() may not persist
 *     in the chatbox if routing immediately transitions away. Tests that verify
 *     personalisation lines focus on nodes where the say() has time to render.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initBloomieChat } from "../assistant.js";
import { buildGuidanceResponse } from "../bloomie-templates.js";
import { generateIntegratedSignals } from "../algorithms/bloom-symptom-engine.js";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../db.js", () => ({
  loadBloomieMemory: vi.fn().mockResolvedValue(null),
  saveBloomieMemory: vi.fn().mockResolvedValue(),
}));

vi.mock("../auth.js", () => ({
  getIdToken:  vi.fn().mockResolvedValue(null),
  getUser:     vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logSafetyEvent:    vi.fn(),
    logAnalyticsEvent: vi.fn(),
  };
});

// Bypass Patois normalisation (non-iterable PHRASE_MAP in test env).
vi.mock("../bloomie-patois.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePatois: (text) => (typeof text === "string" ? text : ""),
    detectUserTone:  () => "neutral",
  };
});

// Wrap buildGuidanceResponse so tests can inject mockReturnValueOnce to bypass
// the guidance-template path and force node-transition routing.
vi.mock("../bloomie-templates.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildGuidanceResponse: vi.fn((...a) => actual.buildGuidanceResponse(...a)) };
});

// Wrap generateIntegratedSignals so each test controls the signals returned at
// mount time. Default returns empty signal sets (no signals active).
vi.mock("../algorithms/bloom-symptom-engine.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateIntegratedSignals: vi.fn(() => ({ cycleSignals: [], symptomSignals: [] })),
    getBloomieSymptomContext: actual.getBloomieSymptomContext,
  };
});

// ── Global stubs ──────────────────────────────────────────────────────────────

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Minimal symptom history with MOOD_SWINGS appearing in two separate entries
// → buildSymptomPatternLine count-≥-2 check passes for MOOD_SWINGS.
const MOOD_HISTORY = [
  { dateKey: "2026-03-01", items: [{ code: "MOOD_SWINGS", severity: "moderate" }] },
  { dateKey: "2026-03-15", items: [{ code: "MOOD_SWINGS", severity: "mild" }, { code: "IRRITABILITY", severity: "mild" }] },
];

// Minimal non-empty history used when symptom codes don't matter, just to
// satisfy the `symptomHistory.length > 0` guard that triggers generateIntegratedSignals.
const STUB_HISTORY = [{ dateKey: "2026-03-01", items: [] }];

// ── Helpers ───────────────────────────────────────────────────────────────────

let chat;

function mountChat(opts = {}) {
  chat = initBloomieChat(opts);
  vi.advanceTimersByTime(10_000);
}

function sendMessage(text) {
  const $input = document.getElementById("chat-input");
  const $form  = document.getElementById("chat-form");
  $input.value = text;
  $form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  vi.advanceTimersByTime(10_000);
}

function clickButton(choiceId) {
  const btn = document.querySelector(`button[data-choice="${choiceId}"]`);
  if (!btn) {
    const available = [...document.querySelectorAll("button[data-choice]")]
      .map(b => b.dataset.choice).join(", ");
    throw new Error(`Button "${choiceId}" not found. Available: ${available}`);
  }
  btn.click();
  vi.advanceTimersByTime(10_000);
}

function getChatBoxText() {
  return document.getElementById("chat-box")?.textContent ?? "";
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = `
    <div id="chat-box"></div>
    <form id="chat-form"><input id="chat-input" /></form>
  `;
  // Default: no signals. Tests override per-call with mockReturnValueOnce before mountChat().
  generateIntegratedSignals.mockReturnValue({ cycleSignals: [], symptomSignals: [] });
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.resetAllMocks();   // clears queued mockReturnValueOnce values AND mockReturnValue to prevent leakage
  vi.restoreAllMocks();
});


// ── 1. loggingGapPending — flag set and consumed at mount ─────────────────────
//
// transition("START") is called synchronously at the end of initBloomieChat().
// START's say() checks ctx.loggingGapPending and immediately sets it to false.
// The flag is therefore always false after mount; we assert observable effects:
// adviceGiven entry (proves the flag was set then consumed) and chatbox text.

describe("loggingGapPending — flag set and consumed at mount", () => {
  it("adviceGiven entry is set when SYMPTOM_LOGGING_GAP signal level is 'high'", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOM_LOGGING_GAP", level: "high", show: true }],
    });
    mountChat({ symptomHistory: STUB_HISTORY });

    expect(chat.getState().adviceGiven.has("logging_gap_surfaced")).toBe(true);
    expect(chat.getState().loggingGapPending).toBe(false);
  });

  it("logging gap message appears in chatbox on first START render", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOM_LOGGING_GAP", level: "high", show: true }],
    });
    mountChat({ symptomHistory: STUB_HISTORY });

    expect(getChatBoxText()).toMatch(
      /it's been a while since your last symptom log|logging regularly|one small thing before we start/i
    );
  });

  it("no adviceGiven entry when SYMPTOM_LOGGING_GAP signal level is not 'high'", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOM_LOGGING_GAP", level: "medium", show: true }],
    });
    mountChat({ symptomHistory: STUB_HISTORY });

    expect(chat.getState().adviceGiven.has("logging_gap_surfaced")).toBe(false);
  });

  it("no logging gap message when no signal is present", () => {
    mountChat({ symptomHistory: STUB_HISTORY });

    const text = getChatBoxText();
    expect(text).not.toMatch(/it's been a while since your last symptom log/i);
    expect(text).not.toMatch(/logging regularly/i);
  });

  it("logging gap message does not appear a second time (adviceGiven guard)", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOM_LOGGING_GAP", level: "high", show: true }],
    });
    mountChat({ symptomHistory: STUB_HISTORY });

    // Count occurrences in the full chatbox text.
    const text = getChatBoxText();
    const matches = [
      ...text.matchAll(/one small thing before we start|it's been a while since your last symptom log|logging regularly/gi),
    ];
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});


// ── 2. buildCyclePersonalisationLine — via LATE_INTRO ────────────────────────
//
// buildCyclePersonalisationLine("late") is called inside LATE_INTRO's say().
// To reach LATE_INTRO: suppress buildGuidanceResponse (template fires first for
// health inputs) then send "my period is late" — inferRoute returns LATE_INTRO.

describe("buildCyclePersonalisationLine — variability line in LATE_INTRO", () => {
  it("appends variability string when IRREGULAR_CYCLE signal + cycleVariability set", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [{ code: "IRREGULAR_CYCLE", level: "medium", show: true, message: null }],
      symptomSignals: [],
    });
    mountChat({
      // previousCycleLengths [21, 35] → ctx.cycleVariability = 14
      cycleData:     { previousCycleLengths: [21, 35] },
      // Non-empty so the symptomHistory guard allows generateIntegratedSignals to be called.
      symptomHistory: STUB_HISTORY,
    });

    // Suppress guidance template so routing falls through to LATE_INTRO.
    buildGuidanceResponse.mockReturnValueOnce(null);
    sendMessage("my period is late");

    expect(getChatBoxText()).toMatch(/varied by up to 14 days|more variability than usual/i);
  });

  it("does not append variability line when no cycleSignals are present", () => {
    mountChat({ cycleData: { previousCycleLengths: [21, 35] }, symptomHistory: STUB_HISTORY });

    buildGuidanceResponse.mockReturnValueOnce(null);
    sendMessage("my period is late");

    expect(getChatBoxText()).not.toMatch(/varied by up to|more variability than usual/i);
  });

  it("does not append variability line when urgency routes away from LATE_INTRO", () => {
    // Trigger urgency escalation — bypasses LATE_INTRO entirely.
    // buildCyclePersonalisationLine is never called when routing goes to HEAVY_URGENT.
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [{ code: "IRREGULAR_CYCLE", level: "medium", show: true, message: null }],
      symptomSignals: [],
    });
    mountChat({ cycleData: { previousCycleLengths: [21, 35] }, symptomHistory: STUB_HISTORY });

    sendMessage("I am bleeding heavily and I feel dizzy and faint");

    const state = chat.getState();
    expect(state.urgency).toBe(true);
    expect(state.state).toBe("HEAVY_URGENT");
    expect(getChatBoxText()).not.toMatch(/varied by up to|more variability than usual/i);
  });
});


// ── 3. buildSymptomPatternLine — via MOOD_INTRO → MOOD_SAFETY_CHECK ──────────
//
// buildSymptomPatternLine is first called in MOOD_INTRO's onEnter() (gate node,
// say: []). Clicking "mood" from START navigates:
//   START → MOOD_INTRO (onEnter: buildSymptomPatternLine, say([line]), auto-timer)
//         → MOOD_SAFETY_CHECK (say(): patternLine returns null — already in adviceGiven)
//
// The patternLine from MOOD_INTRO fires at 500ms (firstBubbleMs). The timer for
// MOOD_SAFETY_CHECK fires at 1300ms. advanceTimersByTime(10000) fires both.

describe("buildSymptomPatternLine — pattern line in mood flow", () => {
  it("returns a pattern string the first time when signal and history match", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOMS_MATCH_PMS_PATTERN", level: "medium", show: true }],
    });
    mountChat({ symptomHistory: MOOD_HISTORY });

    clickButton("mood");   // START → MOOD_INTRO (onEnter) → MOOD_SAFETY_CHECK

    expect(getChatBoxText()).toMatch(
      /tend to experience|tends to come up|tend to log/i
    );
  });

  it("adviceGiven key is set after first pattern line render", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOMS_MATCH_PMS_PATTERN", level: "medium", show: true }],
    });
    mountChat({ symptomHistory: MOOD_HISTORY });

    clickButton("mood");

    expect(chat.getState().adviceGiven.has("symptom_pattern_line")).toBe(true);
  });

  it("pattern line appears at most once across MOOD_INTRO and MOOD_SAFETY_CHECK", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOMS_MATCH_PMS_PATTERN", level: "medium", show: true }],
    });
    mountChat({ symptomHistory: MOOD_HISTORY });

    clickButton("mood");

    const text = getChatBoxText();
    const matches = [...text.matchAll(/tend to experience|tends to come up|tend to log/gi)];
    // Can appear at most once — MOOD_SAFETY_CHECK dedup guard prevents repeat.
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it("returns null (no pattern line) when symptomHistory is empty", () => {
    generateIntegratedSignals.mockReturnValueOnce({
      cycleSignals:   [],
      symptomSignals: [{ code: "SYMPTOMS_MATCH_PMS_PATTERN", level: "medium", show: true }],
    });
    // Mount WITHOUT symptomHistory — history guard returns null immediately.
    mountChat({ symptomHistory: null });

    clickButton("mood");

    expect(getChatBoxText()).not.toMatch(/tend to experience|tends to come up|tend to log/i);
  });

  it("returns null (no pattern line) when no matching pattern signal is present", () => {
    // symptomHistory exists but no PATTERN_CODES signal → hasPatternSignal = false.
    mountChat({ symptomHistory: MOOD_HISTORY });

    clickButton("mood");

    expect(getChatBoxText()).not.toMatch(/tend to experience|tends to come up|tend to log/i);
  });
});
