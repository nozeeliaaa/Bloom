/**
 * bloomie-memory-recall.test.js
 * Regression tests for symptom-memory recall gating.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initBloomieChat } from "../assistant.js";

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
    fuzzyCorrect: (text) => text,
    collapseRepeatedLetters: (text) => text,
    expandShorthand: (text) => text,
  };
});

vi.mock("../bloomie-tone.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveTone: vi.fn().mockResolvedValue({
      tone: "neutral",
      intensity: "medium",
      subtext: "none",
      source: "rule_only",
    }),
    applyToneToLines: (lines) => lines,
    applyToneToChoices: (choices) => choices,
  };
});

Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });

let chat;

function clickButton(choiceId) {
  const btn = document.querySelector(`button[data-choice="${choiceId}"]`);
  if (!btn) throw new Error(`Button "${choiceId}" not found`);
  btn.click();
  vi.advanceTimersByTime(10_000);
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

function initWithMemory(memory) {
  document.body.innerHTML = `
    <div id="chat-box"></div>
    <form id="chat-form"><input id="chat-input" /></form>
  `;
  chat = initBloomieChat({ bloomieMemory: memory });
  vi.advanceTimersByTime(10_000);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("symptom memory recall gating", () => {
  it("recent explicit symptom memory + related topic -> recall allowed", () => {
    initWithMemory({
      lastSymptoms: ["mood", "anxiety"],
      lastSymptomsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      lastSymptomsSource: "explicit_entity",
      lastSessionDate: new Date().toISOString(),
    });
    clickButton("mood");
    expect(getChatText()).toMatch(/you(?:'ve)? mentioned/i);
  });

  it("old symptom memory + related topic -> recall blocked", () => {
    initWithMemory({
      lastSymptoms: ["mood", "anxiety"],
      lastSymptomsAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      lastSymptomsSource: "explicit_entity",
      lastSessionDate: new Date().toISOString(),
    });
    clickButton("mood");
    expect(getChatText()).not.toMatch(/you(?:'ve)? mentioned/i);
  });

  it("recent symptom memory + unrelated topic -> recall blocked", () => {
    initWithMemory({
      lastSymptoms: ["mood", "anxiety"],
      lastSymptomsAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      lastSymptomsSource: "explicit_entity",
      lastSessionDate: new Date().toISOString(),
    });
    clickButton("period");
    expect(getChatText()).not.toMatch(/you(?:'ve)? mentioned/i);
  });

  it("\"no\" low-information reply after prompt -> recall blocked", () => {
    initWithMemory({
      lastSymptoms: ["pelvic", "mood"],
      lastSymptomsAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      lastSymptomsSource: "explicit_entity",
      lastSessionDate: new Date().toISOString(),
    });
    sendMessage("no");
    expect(getChatText()).not.toMatch(/you(?:'ve)? mentioned/i);
  });

  it("legacy memory without timestamp -> handled safely (no recall)", () => {
    initWithMemory({
      lastSymptoms: ["mood", "anxiety"],
      lastSymptomsSource: "explicit_entity",
      lastSessionDate: new Date().toISOString(),
    });
    clickButton("mood");
    expect(getChatText()).not.toMatch(/you(?:'ve)? mentioned/i);
  });

  it("stale test memory source in persisted state -> blocked", () => {
    initWithMemory({
      lastSymptoms: ["mood", "anxiety"],
      lastSymptomsAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      lastSymptomsSource: "test_seed",
      lastSessionDate: new Date().toISOString(),
    });
    clickButton("mood");
    expect(getChatText()).not.toMatch(/you(?:'ve)? mentioned/i);
  });
});

