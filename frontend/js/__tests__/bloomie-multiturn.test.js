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
import { buildGuidanceResponse } from "../bloomie-templates.js";
import { computeRouteConfidence } from "../bloomie-routing.js";

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
  getUser: vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logSafetyEvent:    vi.fn(),
    logAnalyticsEvent: vi.fn(),
  };
});

// normalizePatois / detectUserTone iterate PHRASE_MAP, a large const array
// literal that Vite's transform renders non-iterable in the test environment
// (pre-existing bug — bloomie-patois.test.js shows 57/100 failures for the
// same reason). The multi-turn tests use plain English inputs, so bypassing
// Patois normalisation has no effect on the state-machine behaviours under
// test. All other exports (fuzzyCorrect, detectPatois, …) come from the
// real module unchanged.
vi.mock("../bloomie-patois.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePatois: (text) => (typeof text === "string" ? text : ""),
    detectUserTone: () => "neutral",
  };
});

// bloomie-templates and bloomie-routing are wrapped in vi.fn() so individual
// tests can inject one-shot return values (mockReturnValueOnce) without
// affecting other tests. The default implementation calls through to the
// real function, preserving all existing pipeline behaviour.
vi.mock("../bloomie-templates.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildGuidanceResponse: vi.fn((...a) => actual.buildGuidanceResponse(...a)) };
});
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
    // Turn 1: heavy bleeding message — registers the heavy_bleeding flag.
    // Note: without a severity qualifier, detectMissingContext intercepts the
    // message and asks for clarification, so state stays at START. The cumulative
    // flag IS set before that early return, and the context is stashed as
    // pendingContextProbe for merging into Turn 2.
    sendMessage("my period is really heavy right now");
    expect(chat.getState().cumulativeRiskFlags.has("heavy_bleeding")).toBe(true);

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
    // NOTE: "i have one sided pain" matches extractUrgency's `one.sided.*pain`
    // pattern and routes via the safety re-check BEFORE the cumulative flags
    // block runs, so one_sided_pain is never added to cumulativeRiskFlags.
    // Use "pain on one side" instead — "one side" matches the cumulative flag
    // regex (/one.sided|one side/) but not the urgency regex (one.sided.*pain).
    sendMessage("i have pain on one side of my lower abdomen");
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
    const lateNodes = new Set(["LATE_INTRO", "LATE_YES_PREG", "LATE_TEST_Q"]);
    expect(lateNodes.has(state.state)).toBe(false);
  });
});

// ── 4. Overload triage — 3+ topics in one message ────────────────────────────

describe("multi-turn: overload detection", () => {
  it("shows overload triage text and renders overload_* quick-reply buttons", () => {
    sendMessage("my period is late and i feel nauseous and anxious");
    const state = chat.getState();
    // Overload prompt does not force a node transition; it should remain in current node context.
    expect(state.state).toBe("START");
    expect(getChatBoxText()).toMatch(/You've shared a lot/i);
    expect(getChatBoxText()).toMatch(/Which one is bothering you most/i);

    const overloadButtons = [...document.querySelectorAll('button[data-choice^="overload_"]')];
    expect(overloadButtons.length).toBeGreaterThanOrEqual(3);
    const ids = overloadButtons.map((b) => b.getAttribute("data-choice"));
    expect(ids).toContain("overload_late_period");
    expect(ids).toContain("overload_nausea");
    expect(ids).toContain("overload_mood");
  });
});

// ── 5. Loop detection — adaptive repeat handling ─────────────────────────────
//
// Repeat semantics (after spec item 8):
//   Send #1 (_exactCount=0): normal routing
//   Send #2 (_exactCount=1): normal routing
//   Send #3 (_exactCount=2, "second repeat"): empathetic copy + isRetryAttempt=true, continues routing
//   Send #4 (_exactCount≥3, "third repeat"):  ELSE_NOT_SURE_ROUTE
//   Any non-repeat message: isRetryAttempt reset to false

describe("multi-turn: loop detection — exact repeat", () => {
  it("second repeat (3rd send) sets isRetryAttempt and does NOT route to ELSE_NOT_SURE_ROUTE", () => {
    sendMessage("help me");
    sendMessage("help me");
    // Third identical send — second repeat: empathetic variant queued, routing continues.
    // Note: the empathetic say() timers are cleared by the subsequent transition(), so
    // the text is not reliably verifiable in the chatbox. Only state flags are asserted.
    sendMessage("help me");

    const state = chat.getState();
    expect(state.isRetryAttempt).toBe(true);
    // Must NOT have transitioned to ELSE_NOT_SURE_ROUTE yet (third repeat needed for that).
    expect(state.state).not.toBe("ELSE_NOT_SURE_ROUTE");
  });

  it("third repeat (4th send) routes to ELSE_NOT_SURE_ROUTE", () => {
    sendMessage("help me");
    sendMessage("help me");
    sendMessage("help me");   // second repeat — continues routing, isRetryAttempt = true
    sendMessage("help me");   // third repeat  — ELSE_NOT_SURE_ROUTE

    const state = chat.getState();
    expect(state.state).toBe("ELSE_NOT_SURE_ROUTE");
    // "I heard you the first time" is queued by say() then cleared by
    // clearTimers() inside transition("ELSE_NOT_SURE_ROUTE"). The node's own
    // say content renders instead.
    expect(getChatBoxText()).toMatch(/That's completely okay/);
  });

  it("isRetryAttempt resets to false when a non-repeat message is sent", () => {
    sendMessage("help me");
    sendMessage("help me");
    sendMessage("help me");   // sets isRetryAttempt = true

    expect(chat.getState().isRetryAttempt).toBe(true);

    // Different message — _exactCount drops to 0 → else branch resets flag.
    sendMessage("my period is late");
    expect(chat.getState().isRetryAttempt).toBe(false);
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
    // Same clearTimers issue as test 5: "not knowing is okay" is cleared by
    // transition(); ELSE_NOT_SURE_ROUTE's own say renders instead.
    expect(getChatBoxText()).toMatch(/That's completely okay/);
  });
});

// ── 7. Conversational repair — OOS streak at sufficient session depth ─────────

describe("multi-turn: conversational repair → NARROWING", () => {
  it("transitions to NARROWING after 2 consecutive OOS at session depth ≥ 3", () => {
    // Three pure non-health OOS messages build depth and streak together.
    // Using a health message as Turn 1 would deposit symptoms into entityHistory
    // that then bleed into Turn 2 via mergeEntities(), causing OOS messages to
    // inherit the health context and route via buildGuidanceResponse instead of
    // routeUserText — so oosStreakCount would never increment.
    //
    // With pure OOS messages: depth++ and streak++ each turn via the keyword-
    // router path. Condition: streak >= 2 && depth >= 3 fires on Turn 3.

    // Turn 1: OOS — depth = 1, streak = 1.
    sendMessage("what is the weather like today");
    expect(chat.getState().oosStreakCount).toBe(1);

    // Turn 2: OOS — depth = 2, streak = 2 (depth still < 3, no NARROWING yet).
    sendMessage("tell me a joke please");
    expect(chat.getState().oosStreakCount).toBe(2);

    // Turn 3: OOS — depth = 3, streak = 3 → conversational repair fires.
    sendMessage("who won the election");
    const state = chat.getState();
    expect(state.state).toBe("NARROWING");
    expect(state.oosStreakCount).toBe(0);
    // "I've been having trouble…" is queued by say() then cleared by
    // clearTimers() inside transition("NARROWING"). The NARROWING node's own
    // say content renders instead.
    expect(getChatBoxText()).toMatch(/I want to make sure I help you/);
  });
});

// ── 8. Pending route confirmation (MEDIUM confidence) ────────────────────────

describe("multi-turn: MEDIUM confidence pending route", () => {
  // buildGuidanceResponse normally fires for any health input before the
  // confidence-tier path is reached. We suppress it for one turn so the
  // MEDIUM handler executes. computeRouteConfidence is also stubbed to a
  // deterministic MEDIUM result (the default call-through uses real scoring).
  const MEDIUM_CONF = {
    tier: "medium",
    score: 4,
    primaryIntent: "late",
    competingIntents: ["pelvic"],
    confidenceNote: "Just to make sure — is your concern mainly about a late period?",
  };

  it("shows MEDIUM_CONFIRM choices and routes to pending destination on yes", () => {
    buildGuidanceResponse.mockReturnValueOnce(null);
    computeRouteConfidence.mockReturnValueOnce(MEDIUM_CONF);

    sendMessage("late period cramps");

    // MEDIUM_CONFIRM node must be active and its yes/no buttons rendered.
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");
    expect(document.querySelector('button[data-choice="yes_confirm"]')).not.toBeNull();
    expect(document.querySelector('button[data-choice="no_confirm"]')).not.toBeNull();
    expect(chat.getState().pendingRoute).not.toBeNull();

    // Confirming yes resolves the pending route and clears it.
    clickButton("yes_confirm");
    expect(chat.getState().pendingRoute).toBeNull();
    // State moved away from MEDIUM_CONFIRM to the routed destination.
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
  });

  it("clears pending route and goes to NARROWING on no", () => {
    buildGuidanceResponse.mockReturnValueOnce(null);
    computeRouteConfidence.mockReturnValueOnce(MEDIUM_CONF);

    sendMessage("late period cramps");
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");

    // Rejecting clears the pending route and goes to NARROWING.
    clickButton("no_confirm");
    expect(chat.getState().pendingRoute).toBeNull();
    expect(chat.getState().state).toBe("NARROWING");
  });

  it("treats typed 'no' as confirmation response (not OOS)", () => {
    buildGuidanceResponse.mockReturnValueOnce(null);
    computeRouteConfidence.mockReturnValueOnce(MEDIUM_CONF);

    sendMessage("late period cramps");
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");

    sendMessage("no");
    expect(chat.getState().pendingRoute).toBeNull();
    expect(chat.getState().state).toBe("NARROWING");
    expect(chat.getState().oosStreakCount).toBe(0);
  });

  it("treats typed 'ok' as affirmative response in binary confirmation", () => {
    buildGuidanceResponse.mockReturnValueOnce(null);
    computeRouteConfidence.mockReturnValueOnce(MEDIUM_CONF);

    sendMessage("late period cramps");
    expect(chat.getState().state).toBe("MEDIUM_CONFIRM");

    sendMessage("ok");
    expect(chat.getState().pendingRoute).toBeNull();
    expect(chat.getState().state).not.toBe("MEDIUM_CONFIRM");
    expect(chat.getState().oosStreakCount).toBe(0);
  });
});

// ── 9. Return to resolved topic ───────────────────────────────────────────────

describe("multi-turn: return to resolved topic", () => {
  // Navigate to MOOD_GUIDE via the full button flow:
  // mood → MOOD_INTRO (autoNext) → MOOD_SAFETY_CHECK → no → MOOD_ENTRY →
  // ns → MOOD_TIMING_HELP → before → MOOD_SEVERITY → mild → MOOD_IMPACT →
  // yes → MOOD_SYMPTOMS_MULTI (multi-select) → submit → MOOD_DURATION → few → MOOD_GUIDE
  function navigateToMoodGuide() {
    clickButton("mood");        // → MOOD_INTRO → MOOD_SAFETY_CHECK (autoNext)
    clickButton("no");          // → MOOD_ENTRY
    clickButton("ns");          // → MOOD_TIMING_HELP
    clickButton("before");      // → MOOD_SEVERITY
    clickButton("mild");        // → MOOD_IMPACT
    clickButton("yes");         // → MOOD_SYMPTOMS_MULTI (multi-select)
    // Select one option to satisfy allowNone: false, then submit.
    const chip = document.querySelector(".chip");
    if (!chip) throw new Error("No multi-select chip found");
    chip.click();
    vi.advanceTimersByTime(10_000);
    const submitBtn = document.querySelector('[data-action="multi-submit"]');
    if (!submitBtn) throw new Error("No multi-submit button found");
    submitBtn.click();
    vi.advanceTimersByTime(10_000);
    clickButton("few");         // → MOOD_GUIDE
  }

  it("populates concernsResolved when MOOD_GUIDE is entered", () => {
    navigateToMoodGuide();
    expect(chat.getState().state).toBe("MOOD_GUIDE");
    expect(chat.getState().conversationProfile.concernsResolved).toContain("mood");
  });

  it("offers return-to-resolved dialog when user mentions mood again after resolution", () => {
    navigateToMoodGuide();
    expect(chat.getState().conversationProfile.concernsResolved).toContain("mood");

    // Re-raise mood: the return-to-resolved-topic handler fires before routing.
    sendMessage("i am feeling really low mood again");
    expect(getChatBoxText()).toMatch(/We talked about mood/i);
  });
});

describe("multi-turn: topic resolution at guide/wrap nodes", () => {
  function navigateToLateWrap() {
    clickButton("period"); // PERIOD_TRIAGE
    clickButton("late");   // LATE_INTRO
    clickButton("no");     // LATE_NO_GUIDANCE
    clickButton("no");     // LATE_CHANGES_Q
    clickButton("no");     // LATE_SYMPTOMS_Q
    clickButton("none");   // LATE_PATTERN_Q
    clickButton("yes");    // LATE_WRAP
  }

  function navigateToHeavyMonitor() {
    clickButton("period"); // PERIOD_TRIAGE
    clickButton("heavy");  // HEAVY_INTRO
    clickButton("no");     // HEAVY_A_RATE
    clickButton("3_4h");   // HEAVY_SHARED_CORE
    clickButton("no");     // HEAVY_CORE_CLOTS
    clickButton("no");     // HEAVY_CORE_SYMP_GATE
    clickButton("no");     // HEAVY_DECIDE -> HEAVY_MONITOR
  }

  function navigateToSpotWrap() {
    clickButton("period"); // PERIOD_TRIAGE
    clickButton("spot");   // SPOT_INTRO
    clickButton("yes");    // SPOT_YES_DURATION
    clickButton("no");     // SPOT_AMOUNT_Q
    clickButton("wipe");   // SPOT_PREG_Q
    clickButton("no");     // SPOT_BC_Q
    clickButton("no");     // SPOT_TRACK_WRAP
  }

  function navigateToPelvicReviewSoon() {
    clickButton("pain");   // PELVIC_INTRO -> PELVIC_SAFETY_CHECK
    clickButton("no");     // PELVIC_ENTRY
    clickButton("ns");     // PELVIC_GENERAL_ROUTE -> PELVIC_SEVERITY
    clickButton("mild");   // PELVIC_IMPACT
    clickButton("no");     // PELVIC_PATTERN
    clickButton("new");    // PELVIC_REVIEW_SOON
  }

  function navigateToPregnancyResolutionNode() {
    clickButton("preg");   // PREGNANCY_ENTRY
    clickButton("tested"); // PREG_TESTED_ROUTE
    clickButton("pos");    // LATE_POSITIVE
  }

  it("marks late concern as resolved at LATE_WRAP", () => {
    navigateToLateWrap();
    expect(chat.getState().state).toBe("LATE_WRAP");
    expect(chat.getState().conversationProfile.concernsResolved).toContain("late");
  });

  it("marks heavy concern as resolved at HEAVY_MONITOR", () => {
    navigateToHeavyMonitor();
    expect(chat.getState().state).toBe("HEAVY_MONITOR");
    expect(chat.getState().conversationProfile.concernsResolved).toContain("heavy");
  });

  it("marks spotting concern as resolved at SPOT_TRACK_WRAP", () => {
    navigateToSpotWrap();
    expect(chat.getState().state).toBe("SPOT_TRACK_WRAP");
    expect(chat.getState().conversationProfile.concernsResolved).toContain("spot");
  });

  it("marks pelvic concern as resolved at PELVIC_REVIEW_SOON", () => {
    navigateToPelvicReviewSoon();
    expect(chat.getState().state).toBe("PELVIC_REVIEW_SOON");
    expect(chat.getState().conversationProfile.concernsResolved).toContain("pelvic");
  });

  it("marks pregnancy concern as resolved at LATE_POSITIVE", () => {
    navigateToPregnancyResolutionNode();
    expect(chat.getState().state).toBe("LATE_POSITIVE");
    expect(chat.getState().conversationProfile.concernsResolved).toContain("pregnancy");
  });
});

// ── 10. Pelvic pain context-aware flow (late + cramps) ──────────────────────

describe("multi-turn: pelvic pain context-aware late-period handling", () => {
  function remountChat(options = {}) {
    document.body.innerHTML = `
      <div id="chat-box"></div>
      <form id="chat-form"><input id="chat-input" /></form>
    `;
    chat = initBloomieChat(options);
    vi.advanceTimersByTime(10_000);
  }

  it("late context + cramps routes through CRAMPS_LATE_CONTEXT before advice", () => {
    const lmp = new Date(Date.now() - 44 * 24 * 60 * 60 * 1000);
    remountChat({
      cycleData: {
        lmp,
        cycleLength: 28,
        mode: "cycle_tracking",
      },
    });

    clickButton("pain"); // -> PELVIC_INTRO -> PELVIC_SAFETY_CHECK
    clickButton("no");   // -> PELVIC_ENTRY_GATE -> CRAMPS_LATE_CONTEXT

    expect(chat.getState().state).toBe("CRAMPS_LATE_CONTEXT");
    expect(getChatBoxText()).toMatch(/cramps can happen for a few reasons/i);
    expect(getChatBoxText()).toMatch(/usual period-type cramps/i);
  });

  it("normal timing + cramps stays on standard pelvic entry flow", () => {
    const lmp = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    remountChat({
      cycleData: {
        lmp,
        cycleLength: 28,
        mode: "cycle_tracking",
      },
    });

    clickButton("pain");
    clickButton("no");

    expect(chat.getState().state).toBe("PELVIC_ENTRY");
    expect(getChatBoxText()).toMatch(/Pelvic pain can feel really different/i);
  });

  it("late context cramps + spotting follows spotting pathway", () => {
    const lmp = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    remountChat({
      cycleData: {
        lmp,
        cycleLength: 28,
        mode: "cycle_tracking",
      },
    });

    clickButton("pain");
    clickButton("no");      // CRAMPS_LATE_CONTEXT
    clickButton("usual");   // CRAMPS_LATE_SPOT_CHECK
    clickButton("yes");     // SPOT_INTRO

    expect(chat.getState().state).toBe("SPOT_INTRO");
  });
});

// ── 10. Unresolved concerns surfaced before CLOSE ────────────────────────────

describe("multi-turn: unresolved concerns before CLOSE", () => {
  function goToCloseTriggerNode() {
    clickButton("preg");   // PREGNANCY_ENTRY
    clickButton("tested"); // PREG_TESTED_ROUTE
    clickButton("pos");    // LATE_POSITIVE (has "done" -> CLOSE)
  }

  function countUnresolvedClosePrompts() {
    return chat.getState().history.filter(
      m => m.from === "bot" && /Before you go - you also mentioned/.test(m.text)
    ).length;
  }

  it("one unresolved + yes routes directly to that topic and consumes it", () => {
    goToCloseTriggerNode();
    chat.getState().conversationProfile.concernsUnresolved = ["late"];

    clickButton("done"); // attempt CLOSE -> CLOSE_UNRESOLVED_CONFIRM
    expect(chat.getState().state).toBe("CLOSE_UNRESOLVED_CONFIRM");
    expect(chat.getState().pendingUnresolvedTopic).toBe("late");

    clickButton("yes_unresolved");
    expect(chat.getState().state).toBe("LATE_INTRO");
    expect(chat.getState().conversationProfile.concernsUnresolved).toEqual([]);
  });

  it("one unresolved + no closes cleanly without immediate re-prompt loop", () => {
    goToCloseTriggerNode();
    chat.getState().conversationProfile.concernsUnresolved = ["late"];

    clickButton("done");
    expect(chat.getState().state).toBe("CLOSE_UNRESOLVED_CONFIRM");
    clickButton("no_done");

    expect(chat.getState().state).toBe("CLOSE");
    expect(chat.getState().pendingUnresolvedTopic).toBeNull();
    expect(chat.getState().conversationProfile.concernsUnresolved).toEqual(["late"]);
    expect(countUnresolvedClosePrompts()).toBe(1);
  });

  it("multiple unresolved + no does not nag through the rest of the queue", () => {
    goToCloseTriggerNode();
    chat.getState().conversationProfile.concernsUnresolved = ["late", "pelvic"];

    clickButton("done");
    clickButton("no_done");

    expect(chat.getState().state).toBe("CLOSE");
    expect(chat.getState().conversationProfile.concernsUnresolved).toEqual(["late", "pelvic"]);
    expect(countUnresolvedClosePrompts()).toBe(1);
  });

  it("multiple unresolved + yes consumes only the selected first unresolved topic", () => {
    goToCloseTriggerNode();
    chat.getState().conversationProfile.concernsUnresolved = ["late", "pelvic"];

    clickButton("done");
    clickButton("yes_unresolved");

    expect(chat.getState().state).toBe("LATE_INTRO");
    expect(chat.getState().conversationProfile.concernsUnresolved).toEqual(["pelvic"]);
  });
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

  it("treats repair/clarification turns as non-OOS for streak counting", () => {
    sendMessage("weather today?");
    expect(chat.getState().oosStreakCount).toBe(1);

    // Repair-classified message should not count as another OOS strike.
    sendMessage("kmt what?");
    expect(chat.getState().oosStreakCount).toBe(0);
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
    // Grab a reference to the "period" button before the epoch advances.
    const startPeriodBtn = document.querySelector('button[data-choice="period"]');
    expect(startPeriodBtn).not.toBeNull();
    expect(startPeriodBtn.getAttribute("data-flow")).toBe("0");

    // Sending any typed message advances flowId to 1, invalidating all buttons
    // rendered in epoch 0. "my period is late" goes through the guidance path
    // but inferRoute returns null (no duration/pregnancy context), so
    // buildGuidanceResponse fires guidance-only (no transition). State stays
    // at START but flowId is now 1.
    sendMessage("my period is late");
    expect(chat.getState().flowId).toBe(1);

    // Clicking the stale button (data-flow="0") must be silently ignored.
    // Without the guard it would navigate to PERIOD_TRIAGE.
    startPeriodBtn.click();
    vi.advanceTimersByTime(10_000);

    // State must remain at START — stale click had no effect.
    expect(chat.getState().state).toBe("START");
  });
});

// ── 14. END_CHAT detection (English + Jamaican/Patois variants) ─────────────

describe("multi-turn: end-chat intent detection", () => {
  it("still detects existing English close intent", () => {
    sendMessage("bye");
    expect(chat.getState().state).toBe("END_CHAT_CONFIRM");
  });

  it("detects Patois close variant: 'mi done'", () => {
    sendMessage("mi done");
    expect(chat.getState().state).toBe("END_CHAT_CONFIRM");
  });

  it("detects Patois close variant: 'mi good'", () => {
    sendMessage("mi good");
    expect(chat.getState().state).toBe("END_CHAT_CONFIRM");
  });

  it("detects Jamaican farewell variant: 'seen'", () => {
    sendMessage("seen");
    expect(chat.getState().state).toBe("END_CHAT_CONFIRM");
  });

  it("detects Jamaican farewell variant: 'later'", () => {
    sendMessage("later");
    expect(chat.getState().state).toBe("END_CHAT_CONFIRM");
  });

  it("does not trigger close-intent for ambiguous non-farewell phrase", () => {
    sendMessage("i seen spotting today");
    expect(chat.getState().state).not.toBe("END_CHAT_CONFIRM");
  });
});
