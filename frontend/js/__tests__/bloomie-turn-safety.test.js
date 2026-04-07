/**
 * bloomie-turn-safety.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Regression tests for:
 *  1) stale async tone results overwriting newer turn tone state
 *  2) duplicate history insertion in testedToday path
 * ─────────────────────────────────────────────────────────────────────────────
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initBloomieChat } from "../assistant.js";

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const toneDeferreds = [];

vi.mock("../bloomie-tone.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveTone: vi.fn(() => {
      const d = makeDeferred();
      toneDeferreds.push(d);
      return d.promise;
    }),
    applyToneToLines: (lines) => lines,
    applyToneToChoices: (choices) => choices,
  };
});

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

vi.mock("../bloomie-patois.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePatois: (text) => (typeof text === "string" ? text : ""),
    detectUserTone: () => "neutral",
    fuzzyCorrect: (text) => text,
    collapseRepeatedLetters: (text) => text,
    expandShorthand: (text) => text,
  };
});

Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });

let chat;

function sendMessage(text) {
  const $input = document.getElementById("chat-input");
  const $form  = document.getElementById("chat-form");
  $input.value = text;
  $form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  vi.advanceTimersByTime(10_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  toneDeferreds.length = 0;
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

describe("turn-safe async tone guard", () => {
  it("ignores stale tone result from an older turn when a newer turn already updated tone", async () => {
    sendMessage("my period is late");
    sendMessage("i have cramps");
    expect(toneDeferreds.length).toBeGreaterThanOrEqual(2);

    // Resolve second (newer) request first.
    toneDeferreds[1].resolve({
      tone: "anxious",
      intensity: "high",
      subtext: "none",
      source: "ai_primary",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(chat.getState().currentTone).toBe("anxious");

    // Resolve first (older) request late - must be ignored.
    toneDeferreds[0].resolve({
      tone: "neutral",
      intensity: "medium",
      subtext: "none",
      source: "rule_only",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(chat.getState().currentTone).toBe("anxious");
  });
});

describe("testedToday single history insertion", () => {
  it("records one user history entry for testedToday input", () => {
    sendMessage("i tested today");
    const state = chat.getState();
    const userMsgs = state.history.filter((m) => m.from === "user" && m.text === "i tested today");
    expect(userMsgs.length).toBe(1);
  });
});

describe("late-flow follow-up continuity", () => {
  it("keeps late context when user says a non-arrival paraphrase", () => {
    sendMessage("my period is late");
    sendMessage("it nuh come yet");
    const state = chat.getState();
    expect(state.state).not.toBe("NARROWING");
    expect(state.entityHistory.at(-1)?.symptoms?.late).toBe(true);
  });

  it("does not force unrelated follow-up text into late flow", () => {
    sendMessage("my period is late");
    sendMessage("let me test something");
    const state = chat.getState();
    expect(state.entityHistory.at(-1)?.symptoms?.late).toBe(false);
  });
});

describe("clarifier de-duplication", () => {
  it("varies repeated 'feel sick' follow-up wording instead of repeating exact text", () => {
    sendMessage("feel sick");
    sendMessage("feel sick");
    const prompts = chat.getState().history
      .filter((m) => m.from === "bot")
      .map((m) => m.text)
      .filter((t) => /nausea|generally unwell|stomach discomfort/i.test(t));
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const lastTwo = prompts.slice(-2);
    expect(lastTwo[0]).not.toBe(lastTwo[1]);
  });
});
