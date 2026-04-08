/**
 * bloomie-tone.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the hybrid two-layer emotion detection system.
 *
 * API calls are fully mocked — no real network requests are made.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectToneWithConfidence,
  classifyEmotionAI,
  resolveTone,
} from "../bloomie-tone.js";

// ── Mock fetch globally ───────────────────────────────────────────────────────

function mockFetch(responseBody, { ok = true, delay = 0 } = {}) {
  return vi.fn().mockImplementation(() =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok,
          json: () => Promise.resolve(responseBody),
        });
      }, delay);
    })
  );
}

function makeAIResponse(confirms, tone, intensity = "medium", subtext = "none") {
  return {
    content: [{ text: JSON.stringify({ confirms, tone, intensity, subtext }) }],
  };
}

function makeCtx(overrides = {}) {
  return {
    previousTone:        overrides.previousTone  ?? null,
    currentTone:         overrides.currentTone   ?? null,
    toneResult:          overrides.toneResult    ?? null,
    conversationProfile: {
      sessionDepth: overrides.sessionDepth ?? 0,
      ...(overrides.conversationProfile ?? {}),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. detectToneWithConfidence
// ─────────────────────────────────────────────────────────────────────────────

describe("detectToneWithConfidence — rule layer", () => {
  it("distressed text with 2+ signals → high confidence", () => {
    const result = detectToneWithConfidence("I'm so scared and I don't know what to do");
    expect(result.tone).toBe("distressed");
    expect(result.confidence).toBe("high");
    expect(result.hasUnknownTokens).toBe(false);
  });

  it("distressed text with 1 signal → medium confidence", () => {
    // "I feel upset" matches exactly 1 distress pattern and doesn't trigger
    // the scared/worried booster, so it reliably produces medium confidence.
    const result = detectToneWithConfidence("I feel upset");
    expect(result.tone).toBe("distressed");
    expect(result.confidence).toBe("medium");
  });

  it("multi-tone input → low confidence (ambiguous)", () => {
    // Both distressed AND casual signals present
    const result = detectToneWithConfidence("lol I'm so scared I don't know what to do");
    expect(result.confidence).toBe("low");
  });

  it("no tone signals → neutral, low confidence", () => {
    const result = detectToneWithConfidence("my period is late");
    expect(result.tone).toBe("neutral");
    expect(result.confidence).toBe("low");
  });

  it("unknown tokens → hasUnknownTokens true and low confidence", () => {
    // Made-up tokens that are definitely not in KNOWN_VOCAB
    const result = detectToneWithConfidence("xkqzbl fzzbt asdfghjkl scared");
    expect(result.hasUnknownTokens).toBe(true);
    expect(result.confidence).toBe("low");
  });

  it("deflecting signal detected", () => {
    const result = detectToneWithConfidence("it's probably nothing, just curious");
    expect(result.tone).toBe("deflecting");
    expect(result.signals.deflecting).toBeGreaterThanOrEqual(1);
  });

  it("anxious signal detected", () => {
    const result = detectToneWithConfidence("I'm anxious and don't know what this means");
    expect(result.tone).toBe("anxious");
  });

  it("frustrated signal detected", () => {
    const result = detectToneWithConfidence("this keeps happening every time I give up");
    expect(result.tone).toBe("frustrated");
  });

  it("returns signals map with counts", () => {
    const result = detectToneWithConfidence("I'm scared");
    expect(result.signals).toBeDefined();
    expect(typeof result.signals.distressed).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. classifyEmotionAI
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyEmotionAI — AI layer", () => {
  it("returns parsed result on successful API response", async () => {
    global.fetch = mockFetch(makeAIResponse(true, "distressed", "high", "feeling overwhelmed"));
    const ruleResult = { tone: "distressed", confidence: "high" };
    const result = await classifyEmotionAI("I am so scared", ruleResult);
    expect(result).not.toBeNull();
    expect(result.confirms).toBe(true);
    expect(result.tone).toBe("distressed");
    expect(result.intensity).toBe("high");
    expect(result.subtext).toBe("feeling overwhelmed");
  });

  it("returns null when fetch throws (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await classifyEmotionAI("test input", { tone: "neutral", confidence: "low" });
    expect(result).toBeNull();
  });

  it("returns null when response is not ok (API error)", async () => {
    global.fetch = mockFetch({}, { ok: false });
    const result = await classifyEmotionAI("test input", { tone: "neutral", confidence: "low" });
    expect(result).toBeNull();
  });

  it("returns null when response JSON is malformed", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ content: [{ text: "not json at all" }] }),
    });
    const result = await classifyEmotionAI("test input", { tone: "neutral", confidence: "low" });
    expect(result).toBeNull();
  });

  it("returns null on 800 ms timeout (AbortController fires)", async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockImplementation(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new DOMException("AbortError", "AbortError")));
        })
    );
    const ruleResult = { tone: "neutral", confidence: "low" };
    const promise = classifyEmotionAI("slow input", ruleResult);
    vi.advanceTimersByTime(801);
    const result = await promise;
    expect(result).toBeNull();
    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. resolveTone — resolution logic
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveTone — null API → rule_only", () => {
  it("returns rule tone with source 'rule_only' when API returns null", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fail"));
    const ctx = makeCtx({ sessionDepth: 3 });
    const result = await resolveTone("I'm scared", ctx);
    expect(result.source).toBe("rule_only");
    expect(result.tone).toBe("distressed");
    expect(result.intensity).toBe("medium");
    expect(result.subtext).toBe("none");
  });
});

describe("resolveTone — AI confirms → rule+ai_confirmed", () => {
  it("high confidence + AI confirms → source 'rule+ai_confirmed', rule tone kept", async () => {
    global.fetch = mockFetch(
      makeAIResponse(true, "distressed", "high", "very worried")
    );
    // 2+ distressed signals = high confidence
    const ctx = makeCtx({ sessionDepth: 3 });
    const result = await resolveTone("I'm so scared and I don't know what to do", ctx);
    expect(result.source).toBe("rule+ai_confirmed");
    expect(result.tone).toBe("distressed");
    expect(result.intensity).toBe("high");
    expect(result.subtext).toBe("very worried");
  });
});

describe("resolveTone — AI disagrees → ai_override", () => {
  it("AI tone ≠ rule tone → source 'ai_override', AI tone used", async () => {
    // Input that rule detects as deflecting but AI says is anxious
    global.fetch = mockFetch(
      makeAIResponse(false, "anxious", "medium", "trying to minimise")
    );
    const ctx = makeCtx({ sessionDepth: 3 });
    // "it's probably nothing" → deflecting rule; AI says anxious
    const result = await resolveTone("it's probably nothing just curious", ctx);
    expect(result.source).toBe("ai_override");
    expect(result.tone).toBe("anxious");
  });
});

describe("resolveTone — low confidence / unknown tokens → ai_primary", () => {
  it("unknown tokens in input → source 'ai_primary', AI tone used", async () => {
    global.fetch = mockFetch(
      makeAIResponse(false, "distressed", "high", "unknown language")
    );
    const ctx = makeCtx({ sessionDepth: 3 });
    const result = await resolveTone("xkqzbl fzzbt asdfghjkl scared", ctx);
    expect(result.source).toBe("ai_primary");
    expect(result.tone).toBe("distressed");
  });

  it("low confidence rule result → source 'ai_primary'", async () => {
    global.fetch = mockFetch(
      makeAIResponse(false, "anxious", "medium", "subtle worry")
    );
    const ctx = makeCtx({ sessionDepth: 3 });
    // Plain statement — rule gives neutral (low confidence)
    const result = await resolveTone("my period is late", ctx);
    expect(result.source).toBe("ai_primary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Stability gate
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveTone — stability gate", () => {
  it("blocks tone shift at sessionDepth < 2 (holds previousTone)", async () => {
    global.fetch = mockFetch(
      makeAIResponse(true, "distressed", "high", "scared")
    );
    // previousTone is "neutral", sessionDepth is 1 — gate should hold "neutral"
    const ctx = makeCtx({ previousTone: "neutral", sessionDepth: 1 });
    const result = await resolveTone("I'm so scared and I don't know what to do", ctx);
    expect(result.tone).toBe("neutral"); // held by stability gate
  });

  it("allows tone shift at sessionDepth === 2", async () => {
    global.fetch = mockFetch(
      makeAIResponse(true, "distressed", "high", "scared")
    );
    const ctx = makeCtx({ previousTone: "neutral", sessionDepth: 2 });
    const result = await resolveTone("I'm so scared and I don't know what to do", ctx);
    expect(result.tone).toBe("distressed"); // gate passes at depth ≥ 2
  });

  it("allows tone shift at sessionDepth > 2", async () => {
    global.fetch = mockFetch(
      makeAIResponse(true, "distressed", "high", "scared")
    );
    const ctx = makeCtx({ previousTone: "casual", sessionDepth: 5 });
    const result = await resolveTone("I'm so scared and I don't know what to do", ctx);
    expect(result.tone).toBe("distressed");
  });

  it("gate does not activate when previousTone is null (first message)", async () => {
    global.fetch = mockFetch(
      makeAIResponse(true, "distressed", "high", "scared")
    );
    const ctx = makeCtx({ previousTone: null, sessionDepth: 0 });
    const result = await resolveTone("I'm so scared and I don't know what to do", ctx);
    expect(result.tone).toBe("distressed"); // no previous tone → no gate
  });

  it("source field is always present regardless of resolution path", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("fail"));
    const ctx = makeCtx({ sessionDepth: 3 });
    const result = await resolveTone("just asking", ctx);
    expect(result.source).toBeDefined();
    expect(typeof result.source).toBe("string");
  });
});
