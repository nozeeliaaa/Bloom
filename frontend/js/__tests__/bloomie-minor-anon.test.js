// @vitest-environment jsdom

/**
 * bloomie-minor-anon.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * First-pass tests for minor / anonymous user handling.
 *
 * Covers:
 *   1. ctx.isMinor is true after initBloomieChat({ isMinor: true })
 *   2. ctx.isAnon  is true after initBloomieChat({ isAnon: true })
 *   3. Minor greeting appears when isMinor is true
 *   4. Anonymous greeting appears when isAnon is true and isMinor is false
 *   5. When both flags are true, minor greeting takes priority
 *
 * Second-pass - minorSafeFooter():
 *   6. footer nudge is recorded in adviceGiven after first health guidance
 *   7. footer nudge appears at most once per session
 *   8. footer nudge does not fire during urgent escalation
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initBloomieChat } from "../assistant.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../db.js", () => ({
  loadBloomieMemory:      vi.fn().mockResolvedValue(null),
  saveBloomieMemory:      vi.fn().mockResolvedValue(),
  loadLocalBloomieMemory: vi.fn().mockReturnValue(null),
  saveLocalBloomieMemory: vi.fn(),
  loadUserProfile:        vi.fn().mockResolvedValue({ nickname: null }),
}));

vi.mock("../auth.js", () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
  getUser:    vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logSafetyEvent: vi.fn(), logAnalyticsEvent: vi.fn() };
});

vi.mock("../bloomie-patois.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePatois: (text) => (typeof text === "string" ? text : ""),
    detectUserTone:  () => "neutral",
  };
});

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function mountChat(flags = {}) {
  document.body.innerHTML = `
    <div id="chat-box"></div>
    <form id="chat-form"><input id="chat-input" /></form>
  `;
  const chat = initBloomieChat(flags);
  vi.advanceTimersByTime(10_000);
  return chat;
}

function sendMessage(text) {
  const $input = document.getElementById("chat-input");
  const $form  = document.getElementById("chat-form");
  $input.value = text;
  $form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  vi.advanceTimersByTime(10_000);
}

function getChatText() {
  return document.getElementById("chat-box")?.textContent ?? "";
}

const FOOTER_PATTERN = /trusted adult|school nurse|healthcare provider/i;
const NUDGE_PATTERN  = /free account|free bloom account|signing up for free|remember your cycle/i;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("minor/anon flags on ctx", () => {
  it("sets ctx.isMinor = true when isMinor is passed", () => {
    const chat = mountChat({ isMinor: true, policySeed: { ageGroup: "minor", hasGuardianConsent: true } });
    expect(chat.getState().isMinor).toBe(true);
  });

  it("sets ctx.isAnon = true when isAnon is passed", () => {
    const chat = mountChat({ isAnon: true });
    expect(chat.getState().isAnon).toBe(true);
  });

  it("promotes explicit in-chat age disclosure to minor-safe mode", () => {
    const chat = mountChat({ isMinor: false });
    sendMessage("mi 13 and my period irregular");
    expect(chat.getState().isMinor).toBe(true);
    expect(chat.getState().declaredAge).toBe(13);
  });
});

describe("minor/anon greeting content", () => {
  it("shows minor-safe greeting when isMinor is true", () => {
    mountChat({ isMinor: true, policySeed: { ageGroup: "minor", hasGuardianConsent: true } });
    const text = getChatText();
    expect(text).toMatch(/help you understand|period questions|what's on your mind/i);
  });

  it("shows anon greeting when isAnon is true and isMinor is false", () => {
    mountChat({ isAnon: true, isMinor: false });
    const text = getChatText();
    expect(text).toMatch(/anonymous mode|not saved to your account|pdf export/i);
  });

  it("minor greeting takes priority when both isMinor and isAnon are true", () => {
    mountChat({ isMinor: true, isAnon: true, policySeed: { ageGroup: "minor", hasGuardianConsent: true } });
    const text = getChatText();
    expect(text).toMatch(/help you understand|period questions|what's on your mind/i);
    expect(text).not.toMatch(/anonymous mode/i);
  });

  it("blocks minor chat when guardian consent is missing", () => {
    mountChat({ isMinor: true, policySeed: { ageGroup: "minor", hasGuardianConsent: false } });
    const text = getChatText();
    expect(text).toMatch(/parent or guardian needs to complete consent|school nurse|trusted adult/i);
  });
});

// ── minorSafeFooter ───────────────────────────────────────────────────────────

describe("minorSafeFooter", () => {
  it("records minor_adult_nudge in adviceGiven after first health guidance exchange", () => {
    const chat = mountChat({ isMinor: true, policySeed: { ageGroup: "minor", hasGuardianConsent: true } });
    // A symptom-rich message is needed to reach buildGuidanceResponse.
    sendMessage("my period is late and I have cramps and feel nauseous");
    expect(chat.getState().adviceGiven.has("minor_adult_nudge")).toBe(true);
  });

  it("footer nudge appears at most once per session", () => {
    mountChat({ isMinor: true, policySeed: { ageGroup: "minor", hasGuardianConsent: true } });
    sendMessage("my period is late and I have cramps and feel nauseous");
    sendMessage("I also feel really tired and low energy");
    const text = getChatText();
    const occurrences = (text.match(FOOTER_PATTERN) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it("does not fire during urgent escalation", () => {
    // "soaking through" is in urgentPhrases → routes to EMERGENCY_REDIRECT
    // before buildGuidanceResponse is ever reached, so minorSafeFooter is
    // never called and the nudge is never added to adviceGiven.
    const chat = mountChat({ isMinor: true, policySeed: { ageGroup: "minor", hasGuardianConsent: true } });
    sendMessage("I'm soaking through my pads and I feel faint");
    expect(chat.getState().adviceGiven.has("minor_adult_nudge")).toBe(false);
    expect(getChatText()).not.toMatch(FOOTER_PATTERN);
  });
});

// ── anonNudge ─────────────────────────────────────────────────────────────────

describe("anonNudge", () => {
  it("does not fire at session depth 1", () => {
    // anonNudge call site requires sessionDepth >= 2.
    // After one message, depth = 1 - nudge must not fire even if guidance is built.
    const chat = mountChat({ isAnon: true });
    sendMessage("my period is late");  // depth becomes 1; late_period guidance is non-null
    expect(chat.getState().adviceGiven.has("anon_account_nudge")).toBe(false);
    expect(getChatText()).not.toMatch(NUDGE_PATTERN);
  });

  it("fires once after session depth reaches 2", () => {
    // Second message brings depth to 2; guidance fires again → nudge fires.
    const chat = mountChat({ isAnon: true });
    sendMessage("my period is late");       // depth = 1, no nudge
    sendMessage("my period is late");       // depth = 2, nudge fires
    expect(chat.getState().adviceGiven.has("anon_account_nudge")).toBe(true);
    expect(getChatText()).toMatch(NUDGE_PATTERN);
  });

  it("does not fire when urgency is true", () => {
    // "soaking through" routes to EMERGENCY_REDIRECT before the guidance block,
    // so anonNudge is never reached regardless of depth.
    const chat = mountChat({ isAnon: true });
    sendMessage("I'm soaking through my pads and I feel faint");
    expect(chat.getState().adviceGiven.has("anon_account_nudge")).toBe(false);
    expect(getChatText()).not.toMatch(NUDGE_PATTERN);
  });

  it("does not fire twice in one session", () => {
    // adviceGiven guard prevents a second fire after the first.
    mountChat({ isAnon: true });
    sendMessage("my period is late");   // depth = 1
    sendMessage("my period is late");   // depth = 2, nudge fires once
    sendMessage("my period is late");   // depth = 3, guard prevents second fire
    const occurrences = (getChatText().match(NUDGE_PATTERN) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
