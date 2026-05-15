// @vitest-environment jsdom

/**
 * bloomie-logger.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for fire-and-forget analytics + safety event logging.
 *
 * Covers:
 *   logAnalyticsEvent - posts to correct endpoint
 *   logAnalyticsEvent - never throws on fetch reject
 *   logAnalyticsEvent - never throws on timeout (2 s race)
 *   anonymise()       - strips nums, month names, caps at 120 chars
 *   buildSessionMeta() - returns all correct fields from a ctx object
 *   logSafetyEvent    - regression: logs safety events without account-mode auth
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logAnalyticsEvent,
  logSafetyEvent,
  anonymise,
  buildSessionMeta,
} from "../bloomie-logger.js";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../auth.js", () => ({
  getIdToken: vi.fn().mockResolvedValue(null),
}));

vi.mock("../mode.js", () => ({
  isAccountMode: vi.fn().mockReturnValue(false),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(response = { ok: true }, delay = 0) {
  return vi.fn().mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve(response), delay)
      )
  );
}

function makeCtx(overrides = {}) {
  return {
    state:                    overrides.state            ?? "LATE_INTRO",
    lastConfidence:           { tier: overrides.tier     ?? "HIGH" },
    toneResult:               { source: overrides.source ?? "keyword", tone: overrides.tone ?? "anxious" },
    currentTone:              overrides.currentTone      ?? null,
    confidenceFallbackCount:  overrides.fallbackCount    ?? 2,
    riskLevel:                overrides.riskLevel        ?? "moderate",
    oosStreakCount:           overrides.oosStreakCount   ?? 0,
    conversationProfile:      { sessionDepth: overrides.sessionDepth ?? 5 },
  };
}

// ── Tests: logAnalyticsEvent posts to correct endpoint ────────────────────────

describe("logAnalyticsEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = mockFetch();
    window.BLOOM_API_BASE = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("posts to /api/bloomie/analytics with correct eventType", async () => {
    logAnalyticsEvent("route_matched", { route: "LATE_INTRO" });
    await vi.runAllTimersAsync();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("/api/bloomie/analytics");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.eventType).toBe("route_matched");
    expect(body.payload.route).toBe("LATE_INTRO");
  });

  it("never throws when fetch rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    window.BLOOM_API_BASE = "";

    await expect(
      (async () => {
        logAnalyticsEvent("route_matched", {});
        await vi.runAllTimersAsync();
      })()
    ).resolves.toBeUndefined();
  });

  it("never throws on 2 s timeout (fetch never resolves)", async () => {
    // fetch hangs forever - the 2000 ms race inside _sendAnalytics should reject
    // but the outer catch must swallow it
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    let threw = false;
    try {
      logAnalyticsEvent("session_end", {});
      // Advance past the 2 s timeout
      await vi.advanceTimersByTimeAsync(2500);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ── Tests: anonymise() ────────────────────────────────────────────────────────

describe("anonymise", () => {
  it("replaces digit sequences with [NUM]", () => {
    expect(anonymise("I am 25 years old and 14 days late")).toContain("[NUM]");
    expect(anonymise("I am 25 years old and 14 days late")).not.toMatch(/\d/);
  });

  it("replaces month names (case-insensitive) with [DATE]", () => {
    expect(anonymise("I missed my period in January")).toContain("[DATE]");
    expect(anonymise("last December was the last time")).toContain("[DATE]");
    expect(anonymise("MARCH was rough")).toContain("[DATE]");
  });

  it("lowercases output", () => {
    const result = anonymise("HEAVY BLEEDING");
    expect(result).toBe("heavy bleeding");
  });

  it("truncates to 120 characters", () => {
    const long = "a".repeat(200);
    expect(anonymise(long).length).toBe(120);
  });

  it("handles null/undefined gracefully", () => {
    expect(() => anonymise(null)).not.toThrow();
    expect(() => anonymise(undefined)).not.toThrow();
    expect(anonymise(null)).toBe("");
  });
});

// ── Tests: buildSessionMeta() ─────────────────────────────────────────────────

describe("buildSessionMeta", () => {
  it("returns all expected fields from a full ctx", () => {
    const ctx = makeCtx({
      sessionDepth: 7,
      state: "HEAVY_INTRO",
      tier: "MEDIUM",
      source: "ai",
      tone: "scared",
      fallbackCount: 3,
      riskLevel: "high",
      oosStreakCount: 1,
    });

    const meta = buildSessionMeta(ctx);

    expect(meta.sessionDepth).toBe(7);
    expect(meta.currentState).toBe("HEAVY_INTRO");
    expect(meta.confidenceTier).toBe("MEDIUM");
    expect(meta.toneSource).toBe("ai");
    expect(meta.tone).toBe("scared");
    expect(meta.confidenceFallbackCount).toBe(3);
    expect(meta.urgency).toBe("high");
    expect(meta.oosStreakCount).toBe(1);
  });

  it("defaults all fields gracefully when ctx is null", () => {
    const meta = buildSessionMeta(null);

    expect(meta.sessionDepth).toBe(0);
    expect(meta.currentState).toBeNull();
    expect(meta.confidenceTier).toBeNull();
    expect(meta.toneSource).toBeNull();
    expect(meta.tone).toBeNull();
    expect(meta.confidenceFallbackCount).toBe(0);
    expect(meta.urgency).toBeNull();
    expect(meta.oosStreakCount).toBe(0);
  });

  it("falls back to ctx.currentTone when toneResult.tone is absent", () => {
    const ctx = {
      state: null,
      lastConfidence: null,
      toneResult: { source: "keyword" },   // no .tone field
      currentTone: "calm",
      confidenceFallbackCount: 0,
      riskLevel: null,
      oosStreakCount: 0,
      conversationProfile: { sessionDepth: 0 },
    };
    const meta = buildSessionMeta(ctx);
    expect(meta.tone).toBe("calm");
  });
});

// ── Tests: logSafetyEvent regression ─────────────────────────────────────────

describe("logSafetyEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = mockFetch();
    window.BLOOM_API_BASE = "";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs anonymous safety events without an Authorization header", async () => {
    logSafetyEvent("urgent_trigger", { route: "HEAVY_URGENT" });
    await vi.runAllTimersAsync();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("/api/bloomie-safety-log");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBeUndefined();
    expect(JSON.parse(opts.body)).toMatchObject({
      type: "urgent_trigger",
      route: "HEAVY_URGENT",
    });
  });
});
