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
  getUser:    vi.fn().mockReturnValue(null),
}));

vi.mock("../bloomie-logger.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, logSafetyEvent: vi.fn(), logAnalyticsEvent: vi.fn() };
});

globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => ({}) });
Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

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

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("vague triage + anxiety + reassurance + pattern catcher", () => {
  it("routes vague text into triage instead of fallback", () => {
    mountChat();
    sendMessage("sumn off");
    const text = getChatText();
    expect(text).toMatch(/What feels off most right now\?/i);
    expect(text).toMatch(/Pain|Bleeding|Discharge|Missed period|Mood|Pregnancy concern/i);
  });

  it("routes pregnancy panic language to structured anxiety flow", () => {
    mountChat();
    sendMessage("condom broke and I'm panicking");
    const text = getChatText();
    expect(text).toMatch(/take this step by step/i);
    expect(text).toMatch(/When did this happen\?/i);
  });

  it("applies reassurance template for reassurance questions", () => {
    mountChat();
    sendMessage("is this normal?");
    const text = getChatText();
    expect(text).toMatch(/A lot of people experience this/i);
    expect(text).toMatch(/not always a sign/i);
  });

  it("shows pattern catcher only when repeat evidence exists", () => {
    mountChat();
    sendMessage("my period is late");
    const first = getChatText();
    expect(first).not.toMatch(/has come up more than once/i);

    sendMessage("my period is late");
    const second = getChatText();
    expect(second).toMatch(/has come up more than once/i);
  });
});
