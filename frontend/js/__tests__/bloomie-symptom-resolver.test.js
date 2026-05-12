/**
 * bloomie-symptom-resolver.test.js
 *
 * Unit tests for resolveSymptoms() - the symptom-source arbitration layer.
 * No mocks needed: the function is pure and has no external imports.
 *
 * Covers all seven cases from the spec plus edge/safety guards.
 */

import { describe, it, expect } from "vitest";
import { resolveSymptoms } from "../bloomie-symptom-resolver.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function local(key, confidence) {
  return { key, confidence };
}

function ai(primary, secondary = [], confidence = 0.85, clarificationNeeded = false, reason = "") {
  return { primary, secondary, confidence, clarificationNeeded, reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 1: No local matches + strong AI
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 1 - no local matches, strong AI", () => {
  it("uses AI primary when local is empty", () => {
    const result = resolveSymptoms([], ai("NAUSEA", ["SMELL_SENSITIVITY"], 0.9));

    expect(result.primary).toBe("NAUSEA");
    expect(result.secondary).toContain("SMELL_SENSITIVITY");
    expect(result.source).toBe("ai");
    expect(result.clarificationNeeded).toBe(false);
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it("returns clarificationNeeded when local is empty and AI primary is null", () => {
    const result = resolveSymptoms([], ai(null, [], 0.3, true));

    expect(result.primary).toBeNull();
    expect(result.clarificationNeeded).toBe(true);
    expect(result.source).toBe("ai");
    expect(result.secondary).toHaveLength(0);
  });

  it("returns clarificationNeeded when local is empty and aiResult is null", () => {
    const result = resolveSymptoms([], null);

    expect(result.primary).toBeNull();
    expect(result.clarificationNeeded).toBe(true);
    expect(result.secondary).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 2: Strong local (>= 0.85) + weaker AI
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 2 - strong local, weaker AI", () => {
  it("keeps local as primary even when AI disagrees", () => {
    const result = resolveSymptoms(
      [local("BLOATING", 0.9)],
      ai("NAUSEA", [], 0.7),
    );

    expect(result.primary).toBe("BLOATING");
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.clarificationNeeded).toBe(false);
  });

  it("includes AI primary as secondary when it does not conflict", () => {
    const result = resolveSymptoms(
      [local("BLOATING", 0.9)],
      ai("NAUSEA", [], 0.7),
    );

    expect(result.secondary).toContain("NAUSEA");
    expect(result.source).toBe("merged");
  });

  it("does not include primary key in secondary", () => {
    const result = resolveSymptoms(
      [local("BLOATING", 0.92)],
      ai("BLOATING", ["GASSY"], 0.88),
    );

    expect(result.primary).toBe("BLOATING");
    expect(result.secondary).not.toContain("BLOATING");
  });

  it("ignores aiResult=null and uses local only", () => {
    const result = resolveSymptoms([local("BLOATING", 0.9)], null);

    expect(result.primary).toBe("BLOATING");
    expect(result.source).toBe("local");
    expect(result.clarificationNeeded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 3: Medium local (0.6–0.85) + stronger AI
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 3 - medium local, AI has higher confidence", () => {
  it("uses AI primary when AI confidence exceeds local", () => {
    const result = resolveSymptoms(
      [local("HEADACHE", 0.7)],
      ai("THROBBING_PAIN", [], 0.85),
    );

    expect(result.primary).toBe("THROBBING_PAIN");
    expect(result.source).toBe("merged");
    expect(result.confidence).toBeCloseTo(0.85);
  });

  it("includes displaced local key as secondary", () => {
    const result = resolveSymptoms(
      [local("HEADACHE", 0.7)],
      ai("THROBBING_PAIN", [], 0.85),
    );

    expect(result.secondary).toContain("HEADACHE");
  });

  it("keeps local when AI confidence is equal or lower", () => {
    const result = resolveSymptoms(
      [local("HEADACHE", 0.75)],
      ai("THROBBING_PAIN", [], 0.70),
    );

    expect(result.primary).toBe("HEADACHE");
  });

  it("keeps local when aiResult is null at medium confidence", () => {
    const result = resolveSymptoms([local("HEADACHE", 0.72)], null);

    expect(result.primary).toBe("HEADACHE");
    expect(result.source).toBe("local");
    expect(result.clarificationNeeded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 4: Low local confidence (< 0.6) + AI absent
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 4 - low local, no AI", () => {
  it("returns clarificationNeeded when local is weak and AI is null", () => {
    const result = resolveSymptoms([local("HEADACHE", 0.4)], null);

    expect(result.clarificationNeeded).toBe(true);
  });

  it("uses AI when local is below threshold", () => {
    const result = resolveSymptoms(
      [local("HEADACHE", 0.45)],
      ai("MIGRAINE", [], 0.8),
    );

    expect(result.primary).toBe("MIGRAINE");
    expect(result.source).toBe("merged");
    expect(result.clarificationNeeded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 5: AI clarificationNeeded with weak local
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 5 - AI requests clarification, local is weak", () => {
  it("respects AI clarificationNeeded when local match is weak", () => {
    const result = resolveSymptoms(
      [local("FATIGUE", 0.5)],
      ai(null, [], 0.3, true, "ambiguous phrasing"),
    );

    expect(result.primary).toBeNull();
    expect(result.clarificationNeeded).toBe(true);
  });

  it("does NOT override strong local just because AI says clarificationNeeded", () => {
    const result = resolveSymptoms(
      [local("CRAMPS", 0.92)],
      ai(null, [], 0.3, true),
    );

    expect(result.primary).toBe("CRAMPS");
    expect(result.clarificationNeeded).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 6: Merged output with deduped secondary
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 6 - merged secondary deduplication", () => {
  it("never duplicates keys in secondary", () => {
    // AI secondary overlaps with local secondary
    const result = resolveSymptoms(
      [local("BLOATING", 0.9), local("GASSY", 0.75), local("NAUSEA", 0.7)],
      ai("NAUSEA", ["GASSY", "BLOATING"], 0.8),
    );

    const all = [result.primary, ...result.secondary];
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  it("caps secondary at 2 entries", () => {
    const result = resolveSymptoms(
      [local("BLOATING", 0.91), local("GASSY", 0.8), local("NAUSEA", 0.75), local("HEARTBURN", 0.7)],
      ai("STOMACH_CRAMPS", ["INDIGESTION"], 0.6),
    );

    expect(result.secondary.length).toBeLessThanOrEqual(2);
  });

  it("does not include primary in secondary", () => {
    const result = resolveSymptoms(
      [local("BLOATING", 0.9), local("BLOATING", 0.8)],
      ai("GASSY", ["BLOATING"], 0.7),
    );

    expect(result.secondary).not.toContain(result.primary);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case 7: Null / empty input safety
// ─────────────────────────────────────────────────────────────────────────────
describe("Case 7 - null and empty input safety", () => {
  it("handles null localMatches without throwing", () => {
    expect(() => resolveSymptoms(null, null)).not.toThrow();
    const result = resolveSymptoms(null, null);
    expect(result.primary).toBeNull();
    expect(result.clarificationNeeded).toBe(true);
  });

  it("handles undefined localMatches without throwing", () => {
    expect(() => resolveSymptoms(undefined, null)).not.toThrow();
  });

  it("handles empty arrays and null aiResult", () => {
    const result = resolveSymptoms([], null);
    expect(result.primary).toBeNull();
    expect(result.secondary).toEqual([]);
    expect(result.clarificationNeeded).toBe(true);
  });

  it("handles malformed localMatches entries gracefully", () => {
    const result = resolveSymptoms(
      [null, undefined, { key: "CRAMPS" }, { confidence: 0.9 }, { key: "NAUSEA", confidence: 0.8 }],
      null,
    );
    // Only the fully valid entry (NAUSEA) should survive
    expect(result.primary).toBe("NAUSEA");
  });

  it("handles aiResult with missing fields gracefully", () => {
    const result = resolveSymptoms(
      [],
      { primary: "NAUSEA" }, // no secondary, no confidence
    );
    expect(result.primary).toBe("NAUSEA");
    expect(result.secondary).toEqual([]);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it("output always contains all required fields", () => {
    const result = resolveSymptoms([], null);
    expect(result).toHaveProperty("primary");
    expect(result).toHaveProperty("secondary");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("clarificationNeeded");
    expect(result).toHaveProperty("source");
    expect(result).toHaveProperty("reason");
  });
});
