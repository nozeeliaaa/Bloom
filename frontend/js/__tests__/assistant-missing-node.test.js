// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initBloomieChat } from "../assistant.js";
import { logAnalyticsEvent } from "../bloomie-logger.js";

vi.mock("../db.js", () => ({
  loadBloomieMemory: vi.fn().mockResolvedValue(null),
  saveBloomieMemory: vi.fn().mockResolvedValue(),
  loadLocalBloomieMemory: vi.fn().mockReturnValue(null),
  saveLocalBloomieMemory: vi.fn(),
  loadUserProfile: vi.fn().mockResolvedValue({ nickname: null }),
}));

vi.mock("../auth.js", () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
  getUser: vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logSafetyEvent: vi.fn(),
    logAnalyticsEvent: vi.fn(),
  };
});

vi.mock("../bloomie-patois.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    normalizePatois: (text) => (typeof text === "string" ? text : ""),
    detectUserTone: () => "neutral",
  };
});

// Minimal node graph with an intentional missing route target.
vi.mock("../bloomie-nodes.js", () => ({
  createNodes: () => ({
    START: {
      say: ["Hi from test start"],
      choices: [{ id: "go_missing", label: "Go missing", next: "MISSING_NODE_FOR_TEST", primary: true }],
    },
    START_MENU: {
      say: ["Recovered menu"],
      choices: [{ id: "done", label: "Done", next: "CLOSE", primary: true }],
    },
    CLOSE: {
      say: ["Bye"],
      choices: [{ id: "menu", label: "Menu", next: "START_MENU", primary: true }],
    },
  }),
}));

vi.mock("../bloomie-oos.js", () => ({
  createOOS: () => ({
    OOS: [],
    OOS_DEFAULT: [],
    HEALTH_OVERRIDE_PATTERNS: [],
    CYCLE_QUESTION_PATTERNS: [],
    routeUserText: () => null,
  }),
}));

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

let chat;

function clickButton(choiceId) {
  const btn = document.querySelector(`button[data-choice="${choiceId}"]`);
  if (!btn) throw new Error(`Button "${choiceId}" not found`);
  btn.click();
  vi.advanceTimersByTime(10_000);
}

function getChatBoxText() {
  return document.getElementById("chat-box")?.textContent ?? "";
}

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

describe("missing node fallback", () => {
  it("recovers to START_MENU instead of silently stopping", () => {
    clickButton("go_missing");

    expect(chat.getState().state).toBe("START_MENU");
    expect(getChatBoxText()).toMatch(/I lost my place for a second/i);
    expect(logAnalyticsEvent).toHaveBeenCalledWith(
      "missing_node_fallback",
      expect.objectContaining({ missingNode: "MISSING_NODE_FOR_TEST", fallbackState: "START_MENU" }),
      expect.anything()
    );
  });
});

