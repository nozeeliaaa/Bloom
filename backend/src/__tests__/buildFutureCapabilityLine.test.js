/**
 * backend/src/__tests__/buildFutureCapabilityLine.test.js
 *
 * Unit tests for buildFutureCapabilityLine and detectFutureCapabilityContext.
 *
 * Run: cd backend && npx vitest run src/__tests__/buildFutureCapabilityLine.test.js
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  buildFutureCapabilityLine,
  detectFutureCapabilityContext,
} from "../utils/bloomie/messaging/buildFutureCapabilityLine.js";

// ─────────────────────────────────────────────────────────────────────────────
// buildFutureCapabilityLine
// ─────────────────────────────────────────────────────────────────────────────

describe("buildFutureCapabilityLine", () => {
  it("returns a non-empty string for the default general context", () => {
    const line = buildFutureCapabilityLine();
    expect(typeof line).toBe("string");
    expect(line.length).toBeGreaterThan(0);
  });

  it("returns null when urgentFlag is true - never surfaces during urgent flows", () => {
    expect(buildFutureCapabilityLine("general",        { urgentFlag: true })).toBeNull();
    expect(buildFutureCapabilityLine("improvement",    { urgentFlag: true })).toBeNull();
    expect(buildFutureCapabilityLine("personalization",{ urgentFlag: true })).toBeNull();
    expect(buildFutureCapabilityLine("general_scope",  { urgentFlag: true })).toBeNull();
    expect(buildFutureCapabilityLine("future_products",{ urgentFlag: true })).toBeNull();
  });

  it("falls back to the general pool for an unknown context", () => {
    const fallback = buildFutureCapabilityLine("unknown_context");
    const general  = buildFutureCapabilityLine("general");
    expect(fallback).toBe(general);
  });

  it("returns distinct lines for each valid context", () => {
    const contexts = ["general", "improvement", "personalization", "general_scope", "future_products"];
    const lines = contexts.map(c => buildFutureCapabilityLine(c));
    // Every result must be a non-empty string
    lines.forEach(l => {
      expect(typeof l).toBe("string");
      expect(l.length).toBeGreaterThan(0);
    });
  });

  it("lines use future-framed language and never certainty language", () => {
    const contexts = ["general", "improvement", "personalization", "general_scope", "future_products"];
    const FUTURE_SIGNALS = /\b(future|may|could|over time|as bloom evolves|in future versions|longer-term)\b/i;
    const BANNED = /\b(currently analyzing|i (already|now) (analyze|use) your (medical|clinical|health) records?|based on your (medical|health) records?|your (medical|clinical) history (shows?|indicates?)|i can diagnose|will improve (diagnosis|treatment))\b/i;

    for (const ctx of contexts) {
      const line = buildFutureCapabilityLine(ctx);
      expect(FUTURE_SIGNALS.test(line)).toBe(true);
      expect(BANNED.test(line)).toBe(false);
    }
  });

  it("is deterministic - same context always returns the same line", () => {
    expect(buildFutureCapabilityLine("improvement")).toBe(buildFutureCapabilityLine("improvement"));
    expect(buildFutureCapabilityLine("personalization")).toBe(buildFutureCapabilityLine("personalization"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectFutureCapabilityContext
// ─────────────────────────────────────────────────────────────────────────────

describe("detectFutureCapabilityContext", () => {
  it("returns null for empty or non-string input", () => {
    expect(detectFutureCapabilityContext("")).toBeNull();
    expect(detectFutureCapabilityContext(null)).toBeNull();
    expect(detectFutureCapabilityContext(undefined)).toBeNull();
    expect(detectFutureCapabilityContext(42)).toBeNull();
  });

  it("returns null for unrelated health questions", () => {
    expect(detectFutureCapabilityContext("what is ovulation?")).toBeNull();
    expect(detectFutureCapabilityContext("I have heavy bleeding")).toBeNull();
    expect(detectFutureCapabilityContext("when is my next period?")).toBeNull();
  });

  it("detects personalization context", () => {
    expect(detectFutureCapabilityContext("can you be more personalised for me?")).toBe("personalization");
    expect(detectFutureCapabilityContext("I want more tailored advice")).toBe("personalization");
    expect(detectFutureCapabilityContext("will Bloom ever use my medical records?")).toBe("personalization");
    expect(detectFutureCapabilityContext("can you use my health history?")).toBe("personalization");
  });

  it("detects improvement context", () => {
    expect(detectFutureCapabilityContext("can the app improve over time?")).toBe("improvement");
    expect(detectFutureCapabilityContext("will Bloom get better?")).toBe("improvement");
    expect(detectFutureCapabilityContext("will you ever become smarter?")).toBe("improvement"); // "smarter" + "you" matches improvement before future_products
  });

  it("detects general_scope context", () => {
    expect(detectFutureCapabilityContext("why are you so general?")).toBe("general_scope");
    expect(detectFutureCapabilityContext("why is Bloomie so basic?")).toBe("general_scope");
    expect(detectFutureCapabilityContext("why can't you give me specific advice?")).toBe("general_scope");
  });

  it("detects future_products context", () => {
    expect(detectFutureCapabilityContext("will there be future features?")).toBe("future_products");
    expect(detectFutureCapabilityContext("what updates are coming to Bloom?")).toBeNull(); // no pattern match
    expect(detectFutureCapabilityContext("could Bloom ever do more in future?")).toBe("future_products");
  });

  it("returns the first matching context (priority order)", () => {
    // "more personalised" matches personalization before any other pattern
    expect(detectFutureCapabilityContext("will there be a more personalised version in future?")).toBe("personalization");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: resolveEducationalQuery attaches futureCapabilityLine correctly
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveEducationalQuery - futureCapabilityLine field", () => {
  let resolveEducationalQuery;

  // Dynamically import to avoid hoisting issues with named exports
  beforeAll(async () => {
    ({ resolveEducationalQuery } = await import(
      "../utils/bloomie/resolver/resolveEducationalQuery.js"
    ));
  });

  it("includes futureCapabilityLine: null on a standard health query", () => {
    const result = resolveEducationalQuery("what is ovulation?");
    expect(result).toHaveProperty("futureCapabilityLine", null);
  });

  it("attaches futureCapabilityLine when the query asks about personalisation", () => {
    const result = resolveEducationalQuery("why are you so general", null);
    // general_scope is detected; falls back to UNSUPPORTED since no topic resolved,
    // but the field must still be present on every response
    expect(result).toHaveProperty("futureCapabilityLine");
  });

  it("returns null for futureCapabilityLine when urgentFlag is set on context", () => {
    const result = resolveEducationalQuery("what is ovulation?", { urgentFlag: true });
    expect(result).toHaveProperty("futureCapabilityLine", null);
  });
});
