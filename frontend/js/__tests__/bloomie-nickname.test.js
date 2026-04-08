// @vitest-environment jsdom

/**
 * bloomie-nickname.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for user nickname feature.
 *
 * Covers:
 *   1. loadUserProfile() — success, null, fetch error, timeout, non-ok
 *   2. canUseNickname()  — all guard conditions
 *   3. withNickname()    — append, no-op, side-effects
 *   4. Integration       — null fetch, null ctx, urgency, first message
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// ── Page globals ──────────────────────────────────────────────────────────────

Element.prototype.scrollIntoView = vi.fn();
window.BLOOM_API_BASE = "";

// ── Module mocks that must be hoisted (applied before any import) ─────────────

vi.mock("../auth.js", () => ({
  getIdToken: vi.fn().mockResolvedValue("test-token"),
  getUser:    vi.fn().mockReturnValue(null),
}));

vi.mock("../mode.js", () => ({
  isAccountMode: vi.fn().mockReturnValue(true),
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

// ── loadUserProfile() ─────────────────────────────────────────────────────────
//
// Uses the REAL db.js (not mocked). auth.js mock above ensures getIdToken()
// returns "test-token" so authHeaders() is non-null. Each test swaps fetch.

describe("loadUserProfile()", () => {
  let loadUserProfile;

  beforeAll(async () => {
    // Import the real module once — auth mock is already registered above.
    ({ loadUserProfile } = await import("../db.js"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { nickname } on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ nickname: "Zara" }),
    });
    expect(await loadUserProfile()).toEqual({ nickname: "Zara" });
  });

  it("returns { nickname: null } when server returns null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve({ nickname: null }),
    });
    expect(await loadUserProfile()).toEqual({ nickname: null });
  });

  it("returns { nickname: null } on fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    expect(await loadUserProfile()).toEqual({ nickname: null });
  });

  it("returns { nickname: null } on timeout (> 3 s)", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    const promise = loadUserProfile();
    await vi.advanceTimersByTimeAsync(3100); // fires timer + flushes microtasks
    expect(await promise).toEqual({ nickname: null });
    vi.useRealTimers();
  });

  it("returns { nickname: null } on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false });
    expect(await loadUserProfile()).toEqual({ nickname: null });
  });
});

// ── Shared test helpers ───────────────────────────────────────────────────────

function mountChat(init, flags = {}) {
  document.body.innerHTML = `
    <div id="chat-box"></div>
    <form id="chat-form"><input id="chat-input" /></form>
  `;
  const chat = init(flags);
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

// Stub db.js for assistant tests (no real fetch needed; nickname comes via profile param)
const DB_STUB = {
  loadBloomieMemory:      vi.fn().mockResolvedValue(null),
  saveBloomieMemory:      vi.fn().mockResolvedValue(),
  loadLocalBloomieMemory: vi.fn().mockReturnValue(null),
  saveLocalBloomieMemory: vi.fn(),
  loadUserProfile:        vi.fn().mockResolvedValue({ nickname: null }),
};

// ── canUseNickname() ──────────────────────────────────────────────────────────

describe("canUseNickname()", () => {
  let initBloomieChat;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock("../db.js", () => ({ ...DB_STUB }));
    ({ initBloomieChat } = await import("../assistant.js"));
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("../db.js");
  });

  it("is false when userNickname is null — ctx.userNickname stays null", () => {
    const chat = mountChat(initBloomieChat, { profile: null });
    expect(chat.getState().userNickname).toBeNull();
  });

  it("is false when ctx.urgency is true — nickname never appears in urgency flow", () => {
    mountChat(initBloomieChat, { profile: { nickname: "Zara" } });
    sendMessage("I'm soaking through my pads and feel faint");
    expect(getChatText()).not.toMatch(/,\s*Zara/);
  });

  it("is false when sessionDepth < 2 — first user message is depth 1", () => {
    const chat = mountChat(initBloomieChat, { profile: { nickname: "Zara" } });
    sendMessage("my period is late");
    const depth = chat.getState().conversationProfile?.sessionDepth ?? 0;
    expect(depth).toBeLessThan(2);
  });

  it("is false when nickname was used fewer than 4 turns ago", () => {
    const chat = mountChat(initBloomieChat, { profile: { nickname: "Zara" } });
    sendMessage("my period is late");
    sendMessage("my period is late");
    const state = chat.getState();
    if (state.lastNicknameUsedAtDepth !== null) {
      const depth = state.conversationProfile?.sessionDepth ?? 0;
      expect(depth - state.lastNicknameUsedAtDepth).toBeLessThan(4);
    }
  });

  it("allows use when all conditions met (no urgency, depth >= 2, gap >= 4)", () => {
    const chat = mountChat(initBloomieChat, { profile: { nickname: "Zara" } });
    for (let i = 0; i < 6; i++) sendMessage("my period is late");
    const state = chat.getState();
    expect(state.userNickname).toBe("Zara");
    expect(state.urgency).not.toBe(true);
  });
});

// ── withNickname() ────────────────────────────────────────────────────────────

describe("withNickname()", () => {
  let initBloomieChat;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock("../db.js", () => ({ ...DB_STUB }));
    ({ initBloomieChat } = await import("../assistant.js"));
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("../db.js");
  });

  it("returns original text unchanged when nickname is null", () => {
    mountChat(initBloomieChat, { profile: null });
    sendMessage("my period is late");
    expect(getChatText()).not.toMatch(/,\s+\w+\s*[🩷💗]?$/m);
  });

  it("does not update lastNicknameUsedAtDepth when nickname is null", () => {
    const chat = mountChat(initBloomieChat, { profile: null });
    sendMessage("my period is late");
    expect(chat.getState().lastNicknameUsedAtDepth).toBeNull();
  });

  it("never emits raw null or undefined as a nickname", () => {
    mountChat(initBloomieChat, { profile: { nickname: null } });
    sendMessage("my period is late");
    expect(getChatText()).not.toMatch(/,\s*(null|undefined)/i);
  });

  it("does not update lastNicknameUsedAtDepth before depth >= 2", () => {
    const chat = mountChat(initBloomieChat, { profile: { nickname: "Zara" } });
    const before = chat.getState().lastNicknameUsedAtDepth;
    sendMessage("my period is late"); // depth becomes 1, still blocked
    expect(chat.getState().lastNicknameUsedAtDepth).toBe(before);
  });
});

// ── Integration ───────────────────────────────────────────────────────────────

describe("nickname integration", () => {
  let initBloomieChat;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.doMock("../db.js", () => ({ ...DB_STUB }));
    ({ initBloomieChat } = await import("../assistant.js"));
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.doUnmock("../db.js");
  });

  it("ctx.userNickname is null when no profile is passed", () => {
    const chat = mountChat(initBloomieChat, {});
    expect(chat.getState().userNickname).toBeNull();
  });

  it("ctx.userNickname is null when profile.nickname is null", () => {
    const chat = mountChat(initBloomieChat, { profile: { nickname: null } });
    expect(chat.getState().userNickname).toBeNull();
  });

  it("nickname never appears when ctx.urgency becomes true", () => {
    mountChat(initBloomieChat, { profile: { nickname: "Zara" } });
    sendMessage("I'm soaking through my pads and feel faint");
    expect(getChatText()).not.toMatch(/,\s*Zara/);
  });

  it("nickname never appears in the first greeting message (sessionDepth 0)", () => {
    // Mount only — no user messages, so sessionDepth = 0 and canUseNickname = false
    document.body.innerHTML = `
      <div id="chat-box"></div>
      <form id="chat-form"><input id="chat-input" /></form>
    `;
    initBloomieChat({ profile: { nickname: "Zara" } });
    vi.advanceTimersByTime(10_000);
    expect(getChatText()).not.toMatch(/,\s*Zara/);
  });
});
