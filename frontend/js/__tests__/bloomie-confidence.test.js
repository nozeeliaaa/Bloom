/**
 * bloomie-confidence.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for the confidence-tier routing system.
 *
 * Tests cover:
 *   - computeRouteConfidence tier rules (pure function)
 *   - Confidence router: HIGH → direct, MEDIUM → MEDIUM_CONFIRM,
 *     LOW → NARROWING, repeated LOW → CONFIDENCE_FALLBACK
 *   - CLARIFICATION_PAIRS promotion from HIGH to MEDIUM
 *   - lastConfidence and confidenceFallbackCount ctx fields
 *   - CONFIDENCE_FALLBACK node rendering
 *
 * Input strategy
 * ──────────────
 * The confidence router is reached only via the routeUserText path (after both
 * inferRoute and buildGuidanceResponse return null). "my period is late" is used
 * as the canonical test input because:
 *   - inferRoute returns null for late-only entities (confirmed by harness)
 *   - routeUserText scores late ≥ 2 → returns { next: "LATE_INTRO" } (no reply)
 *   - guidance is suppressed by buildGuidanceResponse.mockReturnValueOnce(null)
 * This makes the confidence tier the sole decision point for every test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeRouteConfidence, scoreSignals, INTENT_TO_NODE } from "../bloomie-routing.js";
import { initBloomieChat } from "../assistant.js";
import { buildGuidanceResponse } from "../bloomie-templates.js";
import { inferRoute } from "../bloomie-inference.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../db.js", () => ({
  loadBloomieMemory:      vi.fn().mockResolvedValue(null),
  saveBloomieMemory:      vi.fn().mockResolvedValue(),
  loadLocalBloomieMemory: vi.fn().mockReturnValue(null),
  saveLocalBloomieMemory: vi.fn(),
}));

vi.mock("../auth.js", () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
  getUser:    vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logSafetyEvent:    vi.fn(),
    logAnalyticsEvent: vi.fn(),
  };
});

// Stub patois to identity + neutral tone (prevents PHRASE_MAP iteration bug).
vi.mock("../bloomie-patois.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePatois: (text) => (typeof text === "string" ? text : ""),
    detectUserTone:  () => "neutral",
  };
});

// Stub resolveTone so the async await is replaced by an instant resolve.
vi.mock("../bloomie-tone.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveTone: vi.fn().mockResolvedValue({
      tone: "neutral", intensity: "medium", subtext: "none", source: "rule_only",
    }),
  };
});

// Wrap buildGuidanceResponse so tests can inject mockReturnValueOnce.
vi.mock("../bloomie-templates.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildGuidanceResponse: vi.fn((...a) => actual.buildGuidanceResponse(...a)) };
});

// Wrap inferRoute so tests can inject mockReturnValueOnce (suppress the
// inference path so execution falls through to the confidence router).
vi.mock("../bloomie-inference.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, inferRoute: vi.fn((...a) => actual.inferRoute(...a)) };
});

// Wrap computeRouteConfidence so tests can inject mockReturnValueOnce.
vi.mock("../bloomie-routing.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, computeRouteConfidence: vi.fn((...a) => actual.computeRouteConfidence(...a)) };
});

// ── Global stubs ──────────────────────────────────────────────────────────────

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

// ── Test state ────────────────────────────────────────────────────────────────

let chat;

// ── Helpers ───────────────────────────────────────────────────────────────────

const CANONICAL_INPUT = "my period is late";

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

/**
 * withConfidence(tier, primaryIntent, competingIntents?)
 *
 * Suppresses guidance for one call (so the confidence router is reached)
 * and stubs computeRouteConfidence to return the given tier for one call.
 * The route/competitors/ambiguous fields are derived consistently with the
 * real implementation so downstream assertions can use them.
 */
function withConfidence(tier, primaryIntent, competingIntents = []) {
  const route       = primaryIntent ? (INTENT_TO_NODE[primaryIntent] || null) : null;
  const competitors = competingIntents.map(i => INTENT_TO_NODE[i] || null).filter(Boolean);
  const ambiguous   = tier !== "high";
  // Suppress the inference path so execution reaches the confidence router.
  inferRoute.mockReturnValueOnce(null);
  buildGuidanceResponse.mockReturnValueOnce(null);
  computeRouteConfidence.mockReturnValueOnce({
    tier,
    score:          tier === "high" ? 8 : tier === "medium" ? 5 : 2,
    primaryIntent,
    competingIntents,
    confidenceNote: tier === "medium"
      ? `Just to confirm — is this about ${(primaryIntent || "").replace(/_/g, " ")}?`
      : null,
    route,
    competitors,
    ambiguous,
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();

  document.body.innerHTML = `
    <div id="chat-box"></div>
    <form id="chat-form"><input id="chat-input" /></form>
  `;

  chat = initBloomieChat();
  vi.advanceTimersByTime(10_000);
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});


// ── Pure function: computeRouteConfidence tier rules ──────────────────────────

describe("computeRouteConfidence — tier rules (real implementation)", () => {
  it("urgency always → high tier + HEAVY_URGENT route + ambiguous false", () => {
    const { sig } = scoreSignals("i am bleeding heavily");
    const conf = computeRouteConfidence(sig, { urgent: true });
    expect(conf.tier).toBe("high");
    expect(conf.route).toBe("HEAVY_URGENT");
    expect(conf.ambiguous).toBe(false);
    expect(conf.competitors).toEqual([]);
  });

  it("low score (<3) → low tier, ambiguous true, null route possible", () => {
    const conf = computeRouteConfidence(
      { late: 1, heavy: 0, spot: 0, mood: 0, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    expect(conf.tier).toBe("low");
    expect(conf.ambiguous).toBe(true);
  });

  it("zero signals → low tier, null route", () => {
    const conf = computeRouteConfidence(
      { late: 0, heavy: 0, spot: 0, mood: 0, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    expect(conf.tier).toBe("low");
    expect(conf.route).toBeNull();
  });

  it("two close signals → medium tier, ambiguous true, non-null confidenceNote", () => {
    const conf = computeRouteConfidence(
      { late: 4, heavy: 0, spot: 0, mood: 0, pelvic: 4, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    expect(conf.tier).toBe("medium");
    expect(conf.ambiguous).toBe(true);
    expect(conf.confidenceNote).toBeTruthy();
  });

  it("3+ signals within 2 points → low tier (genuine ambiguity)", () => {
    const conf = computeRouteConfidence(
      { late: 4, heavy: 4, mood: 4, spot: 0, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    expect(conf.tier).toBe("low");
  });

  it("dominant single signal → high tier, ambiguous false", () => {
    const conf = computeRouteConfidence(
      { late: 8, heavy: 0, spot: 0, mood: 0, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    expect(conf.tier).toBe("high");
    expect(conf.ambiguous).toBe(false);
    expect(conf.route).toBe("LATE_INTRO");
  });

  it("late + confirmed positive → high (unambiguous pregnancy)", () => {
    const conf = computeRouteConfidence(
      { late: 4, heavy: 0, spot: 0, mood: 0, pelvic: 0, pregnancy: 2, discharge: 0, late_check: 0, red_flag: 0 },
      { symptoms: { late: true }, pregnancy: { result: "positive" } }
    );
    expect(conf.tier).toBe("high");
    expect(conf.ambiguous).toBe(false);
  });

  it("ambiguous field mirrors tier !== high for every tier", () => {
    const cases = [
      [{ late: 8 }, {}, "high"],
      [{ late: 4, pelvic: 4 }, {}, "medium"],
      [{ late: 1 }, {}, "low"],
    ];
    for (const [sigPartial, entities, expectedTier] of cases) {
      const fullSig = { late: 0, heavy: 0, spot: 0, mood: 0, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0, ...sigPartial };
      const conf = computeRouteConfidence(fullSig, entities);
      expect(conf.ambiguous).toBe(conf.tier !== "high");
    }
  });
});

describe("computeRouteConfidence — route and competitors fields", () => {
  it("route matches INTENT_TO_NODE[primaryIntent]", () => {
    const { sig } = scoreSignals("my period is very late this month");
    const conf = computeRouteConfidence(sig, {});
    if (conf.primaryIntent) {
      expect(conf.route).toBe(INTENT_TO_NODE[conf.primaryIntent] ?? null);
    }
  });

  it("competitors contains node strings, not intent keys", () => {
    const conf = computeRouteConfidence(
      { late: 4, pelvic: 4, heavy: 0, spot: 0, mood: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    conf.competitors.forEach(c => {
      expect(typeof c).toBe("string");
      // Node names are UPPER_SNAKE_CASE
      expect(c).toMatch(/^[A-Z][A-Z0-9_]+$/);
    });
  });

  it("competitors has no duplicates", () => {
    const { sig } = scoreSignals("late period with spotting and mood swings");
    const conf = computeRouteConfidence(sig, {});
    expect(new Set(conf.competitors).size).toBe(conf.competitors.length);
  });

  it("competitor nodes are all valid INTENT_TO_NODE values", () => {
    const validNodes = new Set(Object.values(INTENT_TO_NODE));
    const conf = computeRouteConfidence(
      { late: 4, pelvic: 4, heavy: 0, spot: 0, mood: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    conf.competitors.forEach(c => expect(validNodes.has(c)).toBe(true));
  });
});


// ── Integration: HIGH tier → routes directly ──────────────────────────────────

describe("confidence router — HIGH tier", () => {
  it("routes directly without showing MEDIUM_CONFIRM or NARROWING", () => {
    withConfidence("high", "late");
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
    expect(chat.getState().state).not.toBe("NARROWING");
    expect(chat.getState().pendingRoute).toBeNull();
  });

  it("sets lastConfidence with tier=high after routing", () => {
    withConfidence("high", "late");
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().lastConfidence).not.toBeNull();
    expect(chat.getState().lastConfidence?.tier).toBe("high");
  });

  it("does not increment confidenceFallbackCount on HIGH", () => {
    withConfidence("high", "late");
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(0);
  });

  it("lastConfidence.ambiguous is false on HIGH", () => {
    withConfidence("high", "late");
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().lastConfidence?.ambiguous).toBe(false);
  });
});


// ── Integration: MEDIUM tier → MEDIUM_CONFIRM ────────────────────────────────

describe("confidence router — MEDIUM tier", () => {
  it("transitions to MEDIUM_CONFIRM and sets pendingRoute", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
    expect(chat.getState().pendingRoute).not.toBeNull();
    expect(chat.getState().pendingRoute?.next).toBeTruthy();
  });

  it("yes_confirm resolves pendingRoute and leaves MEDIUM_CONFIRM", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);

    clickButton("yes_confirm");
    expect(chat.getState().pendingRoute).toBeNull();
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
  });

  it("no_confirm clears pendingRoute and goes to NARROWING", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);

    clickButton("no_confirm");
    expect(chat.getState().pendingRoute).toBeNull();
    expect(chat.getState().state).toBe("NARROWING");
  });

  it("MEDIUM_CONFIRM node renders the confidenceNote", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
    expect(getChatBoxText()).toMatch(/confirm|make sure|sure|right/i);
  });

  it("lastConfidence.ambiguous is true on MEDIUM", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().lastConfidence?.ambiguous).toBe(true);
  });

  it("lastConfidence.competitors is non-empty array on MEDIUM", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().lastConfidence?.competitors.length).toBeGreaterThan(0);
  });
});


// ── Integration: LOW tier → NARROWING ────────────────────────────────────────

describe("confidence router — LOW tier", () => {
  it("transitions to NARROWING on first LOW", () => {
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("NARROWING");
  });

  it("increments confidenceFallbackCount to 1 on first LOW", () => {
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(1);
  });

  it("NARROWING node shows disambiguating topic buttons", () => {
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("NARROWING");
    expect(getChatBoxText()).toMatch(/help you|right thing|closest/i);
  });

  it("lastConfidence.ambiguous is true on LOW", () => {
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().lastConfidence?.ambiguous).toBe(true);
  });
});


// ── Integration: repeated LOW → CONFIDENCE_FALLBACK ──────────────────────────

describe("confidence router — CONFIDENCE_FALLBACK after repeated LOW", () => {
  it("routes to CONFIDENCE_FALLBACK when confidenceFallbackCount reaches 2", () => {
    // First LOW → NARROWING (count 0 → 1)
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(1);

    // Second LOW → NARROWING (count 1 → 2)
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(2);

    // Third LOW — use a distinct input to avoid the exact-repeat guard
    // (3 identical messages in a row → ELSE_NOT_SURE_ROUTE instead of CONFIDENCE_FALLBACK)
    withConfidence("low", "late", []);
    sendMessage("i missed my period");
    expect(chat.getState().state).toBe("CONFIDENCE_FALLBACK");
  });

  it("CONFIDENCE_FALLBACK node shows the full topic menu", () => {
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    withConfidence("low", "late", []);
    sendMessage("i missed my period");
    expect(chat.getState().state).toBe("CONFIDENCE_FALLBACK");
    expect(getChatBoxText()).toMatch(/hard time|pinpoint|main topics/i);
  });

  it("confidenceFallbackCount keeps incrementing on each LOW/FALLBACK", () => {
    // Use distinct inputs to avoid the exact-repeat guard on the 3rd+ sends.
    const inputs = [
      CANONICAL_INPUT,
      CANONICAL_INPUT,
      "i missed my period",
      "late period this month",
    ];
    for (let i = 1; i <= 4; i++) {
      withConfidence("low", "late", []);
      sendMessage(inputs[i - 1]);
      expect(chat.getState().confidenceFallbackCount).toBe(i);
    }
  });
});


// ── Integration: CLARIFICATION_PAIRS promotion ────────────────────────────────

describe("confidence router — CLARIFICATION_PAIRS", () => {
  // The pair check uses conf.competingIntents[0], not the routing signals.
  // withConfidence injects the pair into the mocked confidence result,
  // while CANONICAL_INPUT reaches the confidence router reliably.

  it("late+pelvic pair promotes HIGH → MEDIUM_CONFIRM", () => {
    withConfidence("high", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
    expect(chat.getState().pendingRoute).not.toBeNull();
  });

  it("pelvic+late pair (reversed key order) promotes HIGH → MEDIUM_CONFIRM", () => {
    withConfidence("high", "pelvic", ["late"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
  });

  it("late+pregnancy pair promotes HIGH → MEDIUM_CONFIRM", () => {
    withConfidence("high", "late", ["pregnancy"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
  });

  it("mood+heavy pair promotes HIGH → MEDIUM_CONFIRM", () => {
    withConfidence("high", "mood", ["heavy"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
  });

  it("single HIGH signal with no competitor does not promote", () => {
    // mood with no competitors — no pair formed → routes directly
    withConfidence("high", "mood", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
    expect(chat.getState().state).not.toBe("NARROWING");
  });

  it("non-paired HIGH competitors do not promote to MEDIUM_CONFIRM", () => {
    // late + discharge — not a defined clarification pair
    withConfidence("high", "late", ["discharge"]);
    sendMessage(CANONICAL_INPUT);
    // Should route directly (not a known pair)
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
    expect(chat.getState().state).not.toBe("NARROWING");
  });

  it("pair promotion sets pendingRoute to conf.route", () => {
    withConfidence("high", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().pendingRoute?.next).toBe(INTENT_TO_NODE["late"]);
  });
});


// ── confidenceFallbackCount streak reset ──────────────────────────────────────

describe("confidenceFallbackCount — streak reset on successful routing", () => {
  it("LOW → LOW → HIGH resets count to 0", () => {
    // First LOW: count goes to 1
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(1);

    // Second LOW: count goes to 2
    withConfidence("low", "late", []);
    sendMessage("i missed my period");
    expect(chat.getState().confidenceFallbackCount).toBe(2);

    // HIGH success: count resets to 0
    withConfidence("high", "late", []);
    sendMessage("my period is a week late");
    expect(chat.getState().confidenceFallbackCount).toBe(0);
  });

  it("a subsequent LOW after recovery starts fresh at 1, not 3", () => {
    // Build up count to 2
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    withConfidence("low", "late", []);
    sendMessage("i missed my period");
    expect(chat.getState().confidenceFallbackCount).toBe(2);

    // Recover via HIGH
    withConfidence("high", "late", []);
    sendMessage("my period is a week late");
    expect(chat.getState().confidenceFallbackCount).toBe(0);

    // New LOW starts fresh — count is 1, not 3
    withConfidence("low", "late", []);
    sendMessage("something something cycle");
    expect(chat.getState().confidenceFallbackCount).toBe(1);
    // Should go to NARROWING, not CONFIDENCE_FALLBACK
    expect(chat.getState().state).toBe("NARROWING");
  });

  it("CONFIDENCE_FALLBACK does not appear prematurely after earlier recovery", () => {
    // Accumulate 2 LOWs
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    withConfidence("low", "late", []);
    sendMessage("i missed my period");

    // Recover via HIGH — resets count
    withConfidence("high", "late", []);
    sendMessage("my period is a week late");

    // One more LOW — should go to NARROWING (count=1), not CONFIDENCE_FALLBACK
    withConfidence("low", "late", []);
    sendMessage("something about my cycle");
    expect(chat.getState().state).toBe("NARROWING");
    expect(chat.getState().state).not.toBe("CONFIDENCE_FALLBACK");
  });

  it("NARROWING button click resets count to 0", () => {
    // Get into NARROWING
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("NARROWING");
    expect(chat.getState().confidenceFallbackCount).toBe(1);

    // Click a topic button from NARROWING — this is a successful exit
    clickButton("cycle");
    expect(chat.getState().confidenceFallbackCount).toBe(0);
  });

  it("MEDIUM confirmation via yes_confirm resets count to 0", () => {
    // Build up count
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(1);

    // Enter MEDIUM_CONFIRM
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage("i missed my period");
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");

    // Confirm — resets streak
    clickButton("yes_confirm");
    expect(chat.getState().confidenceFallbackCount).toBe(0);
  });
});


// ── _MEDIUM_YES null/malformed pendingRoute recovery ─────────────────────────

describe("_MEDIUM_YES — null and malformed pendingRoute recovery", () => {
  it("_MEDIUM_YES with null route in pendingRoute recovers into NARROWING", () => {
    // Get into MEDIUM_CONFIRM
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");

    // getState() shallow-copies ctx, but pendingRoute is shared by reference —
    // nulling .next on the shared object is the reliable way to corrupt it.
    chat.getState().pendingRoute.next = null;

    // Clicking yes_confirm must not strand the user
    clickButton("yes_confirm");
    expect(chat.getState().state).toBe("NARROWING");
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
  });

  it("_MEDIUM_YES with undefined route in pendingRoute recovers into NARROWING", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");

    // Simulate a malformed pendingRoute where next is undefined
    chat.getState().pendingRoute.next = undefined;

    clickButton("yes_confirm");
    expect(chat.getState().state).toBe("NARROWING");
  });

  it("_MEDIUM_YES recovery also resets confidenceFallbackCount", () => {
    withConfidence("low", "late", []);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().confidenceFallbackCount).toBe(1);

    withConfidence("medium", "late", ["pelvic"]);
    sendMessage("i missed my period");
    // Corrupt route so recovery path is exercised
    chat.getState().pendingRoute.next = null;

    clickButton("yes_confirm");
    // Reset fires even on the graceful recovery path
    expect(chat.getState().confidenceFallbackCount).toBe(0);
  });

  it("_MEDIUM_YES with valid pendingRoute still routes correctly", () => {
    withConfidence("medium", "late", ["pelvic"]);
    sendMessage(CANONICAL_INPUT);
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
    expect(chat.getState().pendingRoute?.next).toBeTruthy();

    clickButton("yes_confirm");
    expect(chat.getState().pendingRoute).toBeNull();
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
    expect(chat.getState().state).not.toBe("NARROWING");
  });
});
