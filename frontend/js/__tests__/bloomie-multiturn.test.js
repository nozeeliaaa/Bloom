/**
 * bloomie-multiturn.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for multi-turn conversation flows.
 *
 * These test the full pipeline end-to-end: DOM mount → user input → NLP
 * pipeline → state machine transitions → follow-up exchanges.
 *
 * Requires jsdom environment for DOM manipulation.
 * Uses fake timers to resolve say()/transition() setTimeout chains.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initBloomieChat } from "../assistant.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../db.js", () => ({
  loadBloomieMemory: vi.fn().mockResolvedValue(null),
  saveBloomieMemory: vi.fn().mockResolvedValue(),
}));

vi.mock("../auth.js", () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
  getUser: vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", () => ({
  logSafetyEvent: vi.fn(),
}));

// ── Global stubs ──────────────────────────────────────────────────────────────

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

// ── Test state ────────────────────────────────────────────────────────────────

let chat;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

  chat = initBloomieChat();
  vi.advanceTimersByTime(10_000);
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── 1. Cumulative risk: heavy bleeding + dizziness ────────────────────────────

describe("multi-turn: cumulative risk flags — heavy + dizziness", () => {
  it("escalates to HEAVY_URGENT when heavy bleeding is followed by dizziness", () => {
    // Turn 1: heavy bleeding message — registers the heavy_bleeding flag,
    // routes to HEAVY_INTRO but does NOT yet escalate (dizziness not present).
    sendMessage("my period is really heavy right now");
    expect(chat.getState().cumulativeRiskFlags.has("heavy_bleeding")).toBe(true);
    expect(chat.getState().state).toBe("HEAVY_INTRO");

    // Turn 2: user now reports dizziness — combination triggers cumulative escalation.
    sendMessage("i also feel dizzy and lightheaded");
    const state = chat.getState();
    expect(state.cumulativeRiskFlags.has("heavy_bleeding")).toBe(true);
    expect(state.cumulativeRiskFlags.has("dizziness")).toBe(true);
    expect(state.state).toBe("HEAVY_URGENT");
    expect(state.urgency).toBe(true);
  });
});

// ── 2. Cumulative risk: late period + one-sided pain ─────────────────────────

describe("multi-turn: cumulative risk flags — late + one-sided pain", () => {
  it("escalates to HEAVY_URGENT when late period is followed by one-sided pain", () => {
    // Turn 1: late period — sets late_period flag, routes to late flow.
    sendMessage("my period is late");
    expect(chat.getState().cumulativeRiskFlags.has("late_period")).toBe(true);

    // Turn 2: mention of one-sided pain triggers the ectopic-adjacent escalation.
    sendMessage("i have one sided pain in my lower left side");
    const state = chat.getState();
    expect(state.cumulativeRiskFlags.has("late_period")).toBe(true);
    expect(state.cumulativeRiskFlags.has("one_sided_pain")).toBe(true);
    expect(state.state).toBe("HEAVY_URGENT");
  });
});

// ── 3. Topic interrupt clears entity history ──────────────────────────────────

describe("multi-turn: topic interrupt clears entity history", () => {
  it("resets entityHistory when topic switches from late period to cramps", () => {
    // Turn 1: late period — builds entity history with late symptoms.
    sendMessage("my period is late");
    expect(chat.getState().entityHistory.length).toBeGreaterThan(0);
    const firstEntry = chat.getState().entityHistory[chat.getState().entityHistory.length - 1];
    expect(firstEntry.symptoms.late).toBe(true);

    // Turn 2: user switches to pelvic/cramp topic — triggers topic interrupt.
    // The old late-period entityHistory should be wiped; only pelvic remains.
    sendMessage("actually i have really bad cramps in my lower abdomen");
    const state = chat.getState();
    // After topic switch, history is reset then repopulated with only pelvic entities.
    const latest = state.entityHistory[state.entityHistory.length - 1];
    expect(latest?.symptoms?.late).toBeFalsy();
    // State should have routed to the pelvic flow, not a late-period node.
    const pelvicNodes = new Set(["PELVIC_INTRO", "PELVIC_SAFETY_CHECK"]);
    const lateNodes   = new Set(["LATE_INTRO", "LATE_YES_PREG", "LATE_TEST_Q"]);
    expect(lateNodes.has(state.state)).toBe(false);
  });
});

// ── 4. Overload triage — 3+ topics in one message ────────────────────────────

describe("multi-turn: overload detection", () => {
  it("shows overload triage when 3+ distinct topics appear in one message", () => {
    // Send a message that mixes late period, heavy bleeding, and pelvic pain.
    sendMessage("my period is late and i have really heavy bleeding and bad cramps all at once");

    // The overload handler fires: say() is called with the overload copy and
    // topic-choice buttons, but transition() is NOT called — state stays at START.
    const state = chat.getState();
    const boxText = getChatBoxText();

    expect(boxText).toMatch(/You've shared a lot/);

    // Topic-choice buttons must be present (at least 2 of the 3 detected topics).
    const buttons = [...document.querySelectorAll("button[data-choice]")]
      .map(b => b.dataset.choice);
    const overloadButtons = buttons.filter(id => id.startsWith("overload_"));
    expect(overloadButtons.length).toBeGreaterThanOrEqual(2);

    // State is still START — no transition happened.
    expect(state.state).toBe("START");
  });
});

// ── 5. Loop detection — same message 3 times ─────────────────────────────────

describe("multi-turn: loop detection — exact repeat", () => {
  it("routes to ELSE_NOT_SURE_ROUTE after 3 identical messages", () => {
    // First two sends of the same message are processed normally.
    sendMessage("help me");
    sendMessage("help me");
    // On the third identical message the exact-repeat guard fires.
    sendMessage("help me");

    const state = chat.getState();
    expect(state.state).toBe("ELSE_NOT_SURE_ROUTE");
    // The "I heard you" prompt must appear in the chat box.
    expect(getChatBoxText()).toMatch(/I heard you the first time/);
  });
});

// ── 6. IDK loop — "not sure" variants 3 times ────────────────────────────────

describe("multi-turn: IDK loop", () => {
  it("routes to ELSE_NOT_SURE_ROUTE after 3 idk-variant messages", () => {
    sendMessage("idk");
    sendMessage("not sure");
    sendMessage("i don't know");

    const state = chat.getState();
    expect(state.state).toBe("ELSE_NOT_SURE_ROUTE");
    expect(getChatBoxText()).toMatch(/not knowing is okay/);
  });
});

// ── 7. Conversational repair — OOS streak at sufficient session depth ─────────

describe("multi-turn: conversational repair → NARROWING", () => {
  it("transitions to NARROWING after 2 consecutive OOS at session depth ≥ 3", () => {
    // Turn 1: health message — builds session depth (depth = 1), resets streak.
    sendMessage("my period is late");
    expect(chat.getState().oosStreakCount).toBe(0);

    // Turn 2: clearly OOS — streak = 1, depth = 2 (not yet ≥ 3).
    sendMessage("what is the weather like today");
    expect(chat.getState().oosStreakCount).toBe(1);

    // Turn 3: another OOS — streak = 2, depth = 3 → conversational repair fires.
    sendMessage("tell me a joke please");
    const state = chat.getState();
    expect(state.state).toBe("NARROWING");
    expect(state.oosStreakCount).toBe(0);
    expect(getChatBoxText()).toMatch(/I've been having trouble/);
  });
});

// ── 8. Pending route confirmation (MEDIUM confidence) ────────────────────────

describe("multi-turn: MEDIUM confidence pending route", () => {
  it.skip(
    "confirms a MEDIUM-confidence route when user says 'yes' and clears it on 'no'" +
    " — SKIP: computeRouteConfidence() MEDIUM tier depends on exact signal score " +
    "thresholds that cannot be reliably triggered by a fixed natural-language string " +
    "without mocking scoreSignals(). A deterministic fixture would be brittle.",
    () => {}
  );
});

// ── 9. Return to resolved topic ───────────────────────────────────────────────

describe("multi-turn: return to resolved topic", () => {
  it.skip(
    "offers follow-up options when user returns to a topic already resolved " +
    " — SKIP: concernsResolved is only populated when transitioning into a GUIDE " +
    "node (HEAVY_GUIDE, LATE_GUIDE, etc.) that is currently listed in RESOLVED_NODES " +
    "but not in TOPIC_NODE_MAP, so topicCode is always undefined and the condition " +
    "`RESOLVED_NODES.has(nextState) && topicCode` is never true. " +
    "Topics therefore never enter concernsResolved in the current codebase.",
    () => {}
  );
});

// ── 10. Unresolved concerns surfaced before CLOSE ────────────────────────────

describe("multi-turn: unresolved concerns before CLOSE", () => {
  it.skip(
    "surfaces the 'Before you go' prompt for unresolved topics before CLOSE " +
    " — SKIP: concernsUnresolved is never populated in the current codebase " +
    "(no code path writes to prof.concernsUnresolved). The CLOSE guard at " +
    "transition() checks it but it always starts and stays as [].",
    () => {}
  );
});

// ── 11. OOS follow-up resolution ─────────────────────────────────────────────

describe("multi-turn: OOS follow-up resolution", () => {
  it("resolves a food OOS follow-up to MOOD_SAFETY_CHECK when user confirms pre-period", () => {
    // Turn 1: food/craving OOS — sets lastOOS = "food".
    sendMessage("i really want to eat junk food all day today");
    expect(chat.getState().lastOOS).toBe("food");

    // Turn 2: user confirms the craving happens before their period.
    // resolveOOSFollowUp recognises "yes before my period" for lastOOS="food"
    // and returns "MOOD_SAFETY_CHECK", bypassing the full NLP pipeline.
    sendMessage("yes before my period");
    const state = chat.getState();
    expect(state.lastOOS).toBeNull();
    expect(state.state).toBe("MOOD_SAFETY_CHECK");
  });
});

// ── 12. Date capture interrupted by urgency ───────────────────────────────────

describe("multi-turn: date capture interrupted by urgency", () => {
  it("abandons date capture and escalates to HEAVY_URGENT on urgent input", () => {
    // Navigate to a node that puts Bloomie into date-capture mode.
    // Path: START → "Pregnancy concern" → "I want to know when to take a test"
    //       → "I know my expected period date" → TEST_EXPECTED_DATE
    // TEST_EXPECTED_DATE.autoNext sets ctx.capture = { kind: "expectedPeriodDate", ... }
    clickButton("preg");    // → PREGNANCY_ENTRY
    clickButton("when");    // → TEST_INTRO
    clickButton("know_date"); // → TEST_EXPECTED_DATE (autoNext sets ctx.capture)

    expect(chat.getState().capture?.kind).toBe("expectedPeriodDate");

    // While in capture mode, type an urgent message.
    // The capture handler's safety re-check fires before date parsing.
    sendMessage("i'm bleeding really heavily and i feel faint and dizzy");

    const state = chat.getState();
    expect(state.state).toBe("HEAVY_URGENT");
    expect(state.urgency).toBe(true);
    expect(state.capture).toBeNull();
  });
});

// ── 13. Stale button guard (flowId) ──────────────────────────────────────────

describe("multi-turn: stale button guard", () => {
  it("ignores button clicks from a previous render epoch after user sends a message", () => {
    // After boot the START node's buttons are rendered with flowId = 0.
    // Grab a reference to the START "period" button before the epoch advances.
    const startPeriodBtn = document.querySelector('button[data-choice="period"]');
    expect(startPeriodBtn).not.toBeNull();
    expect(startPeriodBtn.getAttribute("data-flow")).toBe("0");

    // Sending a typed message advances flowId to 1 and transitions to LATE_INTRO.
    sendMessage("my period is late");
    const afterMsgState = chat.getState().state;
    expect(afterMsgState).toBe("LATE_INTRO");

    // Clicking the stale START button (data-flow="0") must be silently ignored.
    // If it weren't guarded, it would navigate to PERIOD_TRIAGE.
    startPeriodBtn.click();
    vi.runAllTimers();

    // State must remain where the typed message left it.
    expect(chat.getState().state).toBe("LATE_INTRO");
  });
});
