/**
 * bloom-cycle-engine.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests covering cycle engine edge cases, date utilities, and the
 * full set of new guard functions introduced in this sprint.
 *
 * All tests are deterministic — no network calls, no randomness.
 * Reference date: 2026-03-22 (today fixture used throughout).
 */

import { describe, it, expect } from "vitest";

// ── Cycle engine ────────────────────────────────────────────────────────────
import {
  detectIrregularCycleSignal,
  detectCycleTrendSignal,
  detectPeriodStatusSignal,
  computeRobustAverageCycleLength,
  deduplicatePeriods,
  detectSuspiciousEntries,
  detectSuspiciousEntrySignal,
  detectSymptomWithoutCycleData,
  detectLongBleedingEntry,
} from "../algorithms/bloom-cycle-engine.js";

// ── Date utilities ───────────────────────────────────────────────────────────
import {
  parseNaturalDate,
  validateCycleDate,
  validateCalendarDate,
  computePhaseConfidence,
} from "../algorithms/bloom-date-utils.js";

// ── Patois normalisation (for tests that combine both) ────────────────────
import { normalizePatois } from "../bloomie-patois.js";

// ── Helpers ──────────────────────────────────────────────────────────────────
const TODAY = new Date("2026-03-22T12:00:00");

function daysAgo(n) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d;
}

function makeWindow(centerDaysAgo, spread = 2) {
  return {
    start: daysAgo(centerDaysAgo + spread),
    end:   daysAgo(centerDaysAgo - spread),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  PART 1 — Natural language date parsing
// ════════════════════════════════════════════════════════════════════════════

describe("parseNaturalDate — relative expressions", () => {
  it("TEST-01  'sometime last month' → approx mid-last-month", () => {
    const r = parseNaturalDate("sometime last month", TODAY);
    expect(r).not.toBeNull();
    expect(r.approximate).toBe(true);
    // Today is 2026-03-22, so last month = February 2026
    expect(r.date.getMonth()).toBe(1);          // February (0-indexed)
    expect(r.date.getDate()).toBe(15);
  });

  it("TEST-02  'early february' → February 5", () => {
    const r = parseNaturalDate("early february", TODAY);
    expect(r).not.toBeNull();
    expect(r.approximate).toBe(true);
    expect(r.date.getMonth()).toBe(1);          // February
    expect(r.date.getDate()).toBe(5);
  });

  it("TEST-03  'i forgot' → forgotten: true, graceful skip", () => {
    const r = parseNaturalDate("i forgot", TODAY);
    expect(r).not.toBeNull();
    expect(r.forgotten).toBe(true);
    expect(r.date).toBeUndefined();
  });

  it("TEST-16  'mi forget' Patois → graceful date skip", () => {
    // parseNaturalDate accepts both raw and normalised forms
    const raw = parseNaturalDate("mi forget", TODAY);
    expect(raw?.forgotten).toBe(true);

    // Also works after normalizePatois (mi forget → i forgot)
    const norm = parseNaturalDate(normalizePatois("mi forget"), TODAY);
    expect(norm?.forgotten).toBe(true);
  });

  it("TEST-17  approximate date → computePhaseConfidence returns 'low'", () => {
    const r = parseNaturalDate("early march", TODAY);
    expect(r?.approximate).toBe(true);
    expect(computePhaseConfidence(r)).toBe("low");
  });

  it("TEST-20  'di odda week' (Patois) → normalises then parses as ~7 days ago", () => {
    // Patois normalisation turns "di odda week" → "the other week"
    const normalised = normalizePatois("mi period started di odda week");
    expect(normalised).toMatch(/the other week/i);

    const r = parseNaturalDate("the other week", TODAY);
    expect(r).not.toBeNull();
    expect(r.approximate).toBe(true);
    // ~7 days ago
    const diff = Math.round((TODAY.getTime() - r.date.getTime()) / 86400000);
    expect(diff).toBeGreaterThanOrEqual(6);
    expect(diff).toBeLessThanOrEqual(8);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 2 — Calendar and cycle date validation
// ════════════════════════════════════════════════════════════════════════════

describe("validateCalendarDate — impossible dates", () => {
  it("TEST-05  February 30 → rejected with calendar message", () => {
    const r = validateCalendarDate(2026, 2, 30);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/doesn't exist/i);
  });

  it("rejects April 31", () => {
    expect(validateCalendarDate(2026, 4, 31).valid).toBe(false);
  });

  it("rejects month > 12", () => {
    expect(validateCalendarDate(2026, 13, 1).valid).toBe(false);
  });

  it("rejects day > 31", () => {
    expect(validateCalendarDate(2026, 1, 32).valid).toBe(false);
  });

  it("accepts February 29 in a leap year", () => {
    expect(validateCalendarDate(2024, 2, 29).valid).toBe(true);
  });

  it("rejects February 29 in a non-leap year", () => {
    expect(validateCalendarDate(2026, 2, 29).valid).toBe(false);
  });
});

describe("validateCycleDate — logical constraints", () => {
  it("TEST-04  Future LMP date → rejected with clear message", () => {
    const tomorrow = daysAgo(-1);
    const r = validateCycleDate({ date: tomorrow, kind: "lmpDate", today: TODAY });
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/future/i);
  });

  it("LMP > 2 years ago → valid but staleData: true", () => {
    const old = daysAgo(800);
    const r = validateCycleDate({ date: old, kind: "lmpDate", today: TODAY });
    expect(r.valid).toBe(true);
    expect(r.staleData).toBe(true);
  });

  it("Normal past LMP → valid, no staleData", () => {
    const r = validateCycleDate({ date: daysAgo(28), kind: "lmpDate", today: TODAY });
    expect(r.valid).toBe(true);
    expect(r.staleData).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 3 — Robust average cycle length (sparse data + outlier exclusion)
// ════════════════════════════════════════════════════════════════════════════

describe("computeRobustAverageCycleLength — sparse data", () => {
  it("TEST-06  Cycle length of 0 / empty array → defaults to 28", () => {
    expect(computeRobustAverageCycleLength([]).average).toBe(28);
    expect(computeRobustAverageCycleLength([]).usedDefault).toBe(true);
  });

  it("TEST-08  1 logged cycle → defaults to 28, reason = 'only 1 cycle'", () => {
    const r = computeRobustAverageCycleLength([32]);
    expect(r.average).toBe(28);
    expect(r.usedDefault).toBe(true);
    expect(r.reason).toMatch(/1 cycle/);
  });

  it("2 cycles with no outlier → uses real average", () => {
    const r = computeRobustAverageCycleLength([28, 30]);
    expect(r.usedDefault).toBe(false);
    expect(r.average).toBe(29);
  });
});

describe("computeRobustAverageCycleLength — outlier exclusion", () => {
  it("TEST-09  Single outlier cycle excluded from average", () => {
    // [28, 29, 28, 75, 28, 29] — 75 is >2 SD from the rest; below gap threshold (90)
    // so it goes through outlier exclusion, not pre-gap exclusion
    const r = computeRobustAverageCycleLength([28, 29, 28, 75, 28, 29]);
    expect(r.excluded).toContain(75);
    expect(r.average).toBeLessThan(35);     // should be close to 28/29
    expect(r.usedDefault).toBe(false);
  });
});

describe("computeRobustAverageCycleLength — 90+ day gap", () => {
  it("TEST-18  90-day gap cycle + preceding cycles excluded from average", () => {
    // Pattern: normal, normal, 90-day gap, normal, normal
    const r = computeRobustAverageCycleLength([28, 29, 90, 27, 28]);
    // Pre-gap cycles (28, 29, 90) should all be excluded
    expect(r.preGapExcluded).toBe(3);
    // Average is based only on [27, 28]
    expect(r.average).toBe(28);
    expect(r.usedDefault).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 4 — Deduplication and suspicious entries
// ════════════════════════════════════════════════════════════════════════════

describe("deduplicatePeriods", () => {
  it("TEST-07  Two entries 2 days apart → deduplicated to 1", () => {
    const d1 = daysAgo(30);
    const d2 = daysAgo(28);   // 2 days after d1
    const result = deduplicatePeriods([d1, d2]);
    expect(result.length).toBe(1);
    // Earlier date is kept
    expect(result[0].getTime()).toBe(d1.getTime());
  });

  it("Entries more than 3 days apart → both kept", () => {
    const d1 = daysAgo(30);
    const d2 = daysAgo(25);   // 5 days after d1
    expect(deduplicatePeriods([d1, d2]).length).toBe(2);
  });
});

describe("detectSuspiciousEntries + detectSuspiciousEntrySignal", () => {
  it("TEST-10  Entries 5 days apart → SUSPICIOUS_ENTRY fires", () => {
    const d1 = daysAgo(30);
    const d2 = daysAgo(25);   // 5-day gap
    const { suspicious, pairs } = detectSuspiciousEntries([d1, d2]);
    expect(suspicious).toBe(true);
    expect(pairs[0].gapDays).toBe(5);

    const signal = detectSuspiciousEntrySignal([d1, d2]);
    expect(signal.show).toBe(true);
    expect(signal.code).toBe("SUSPICIOUS_ENTRY");
  });

  it("Entries 11 days apart → no suspicious flag", () => {
    const d1 = daysAgo(30);
    const d2 = daysAgo(19);   // 11-day gap — beyond window
    expect(detectSuspiciousEntries([d1, d2]).suspicious).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 5 — Dense / weird data signals
// ════════════════════════════════════════════════════════════════════════════

describe("detectSymptomWithoutCycleData", () => {
  it("TEST-11  35 symptom logs + no cycle data → signal fires", () => {
    const s = detectSymptomWithoutCycleData({ symptomEntryCount: 35, hasCycleData: false });
    expect(s.show).toBe(true);
    expect(s.code).toBe("SYMPTOM_WITHOUT_CYCLE_DATA");
    expect(s.message).toMatch(/period start dates/i);
  });

  it("Symptom logs with cycle data → signal suppressed", () => {
    const s = detectSymptomWithoutCycleData({ symptomEntryCount: 35, hasCycleData: true });
    expect(s.show).toBe(false);
  });

  it("Fewer than threshold entries → signal suppressed", () => {
    const s = detectSymptomWithoutCycleData({ symptomEntryCount: 10, hasCycleData: false });
    expect(s.show).toBe(false);
  });
});

describe("detectLongBleedingEntry", () => {
  it("TEST-12  Bleeding logged for 12 days → flagged but noted", () => {
    const s = detectLongBleedingEntry([{ durationDays: 12 }]);
    expect(s.show).toBe(true);
    expect(s.code).toBe("LONG_BLEEDING_ENTRY");
    expect(s.message).toMatch(/10 days/i);
  });

  it("Bleeding ≤ 10 days → no signal", () => {
    const s = detectLongBleedingEntry([{ durationDays: 7 }]);
    expect(s.show).toBe(false);
  });

  it("Empty entry list → no signal", () => {
    expect(detectLongBleedingEntry([]).show).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 6 — Irregular cycle: postpartum, BC, teen user
// ════════════════════════════════════════════════════════════════════════════

describe("detectIrregularCycleSignal — postpartum suppression", () => {
  it("TEST-13  Postpartum user with 2 cycles → shows postpartum note, not irregular", () => {
    const s = detectIrregularCycleSignal({
      cycleLengths: [28, 32, 30, 29],    // 4 cycles, range=4, sd≈1.5 — not irregular on its own
      isPostpartum: true,
      postpartumCycleCount: 2,
    });
    expect(s.show).toBe(true);
    expect(s.message).toMatch(/postpartum/i);
    expect(s.debug.reason).toBe("postpartum suppression");
  });

  it("Postpartum user with 3+ cycles → normal irregular logic applies", () => {
    const s = detectIrregularCycleSignal({
      cycleLengths: [28, 32, 30, 29],
      isPostpartum: true,
      postpartumCycleCount: 3,         // no longer suppressed
    });
    // Range = 4, sd ≈ 1.5 — neither threshold met → show: false
    expect(s.debug.reason).toBeUndefined();
    expect(s.show).toBe(false);
  });
});

describe("detectIrregularCycleSignal — recentlyStoppedBC suppression", () => {
  it("TEST-14  recentlyStoppedBC + 1 cycle logged → suppression message shown", () => {
    const s = detectIrregularCycleSignal({
      cycleLengths: [21, 35, 21, 35, 21, 35],  // very irregular — range=14, sd≈7
      recentlyStoppedBC: true,
      recentlyStoppedBCCycleCount: 1,
    });
    expect(s.show).toBe(true);
    expect(s.message).toMatch(/birth control/i);
    expect(s.debug.reason).toBe("recentlyStoppedBC suppression");
  });

  it("recentlyStoppedBC + 3 cycles → falls through to real irregularity check", () => {
    const s = detectIrregularCycleSignal({
      cycleLengths: [21, 35, 21, 35, 21, 35],
      recentlyStoppedBC: true,
      recentlyStoppedBCCycleCount: 3,    // suppression window passed
    });
    // range=14, sd≈7 — both above thresholds → show: true, normal message
    expect(s.show).toBe(true);
    expect(s.message).not.toMatch(/birth control/i);
  });
});

describe("detectIrregularCycleSignal — teen user relaxed thresholds", () => {
  it("TEST-19  Teen user (age 17) with 20-day cycle → NOT flagged as irregular", () => {
    // Cycles [20, 22, 21, 23] — range=3, sd≈1.1
    // Adult thresholds: range≥8, sd≥5 — would be fine anyway
    // But with an extreme example: [20, 35, 20, 35] adult range=15 > 8 → irregular
    // Teen threshold: range ≥ 15 → not triggered (exactly 15 is not > 15)
    const s = detectIrregularCycleSignal({
      cycleLengths: [20, 34, 20, 34],   // range=14, sd≈7 — adult: irregular; teen: not
      userAge: 17,
    });
    // Teen effectiveRangeThreshold=15, effectiveStdDevThreshold=8
    // range=14 < 15, sd≈7 < 8 → show: false
    expect(s.show).toBe(false);
  });

  it("Adult with the same cycles IS flagged (range=14 ≥ rangeThreshold=8)", () => {
    const s = detectIrregularCycleSignal({
      cycleLengths: [20, 34, 20, 34],
      // no userAge — adult thresholds
    });
    expect(s.show).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 7 — Stress delay softens LATE_PERIOD message
// ════════════════════════════════════════════════════════════════════════════

describe("detectPeriodStatusSignal — stressDelay flag", () => {
  it("TEST-15  stressDelay: true softens the LATE_PERIOD message", () => {
    // Window ended 3 days ago: daysPastWindowEnd=3 > lateGraceDays(2) → LATE_PERIOD
    const s = detectPeriodStatusSignal({
      lastPeriodStart: daysAgo(35),
      expectedNextPeriodWindow: makeWindow(5),   // end = daysAgo(3), 3 days past window
      today: TODAY,
      cycleLengths: [28, 29, 28, 27],
      settings: { stressDelay: true },
    });
    expect(s.code).toBe("LATE_PERIOD");
    expect(s.show).toBe(true);
    expect(s.message).toMatch(/stress.*travel.*illness/i);
    expect(s.debug.stressDelay).toBe(true);
  });

  it("Without stressDelay the standard message is used", () => {
    const s = detectPeriodStatusSignal({
      lastPeriodStart: daysAgo(35),
      expectedNextPeriodWindow: makeWindow(5),
      today: TODAY,
      cycleLengths: [28, 29, 28, 27],
      settings: { stressDelay: false },
    });
    expect(s.code).toBe("LATE_PERIOD");
    expect(s.message).not.toMatch(/stress.*travel.*illness/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  PART 8 — 1-cycle trend suppression
// ════════════════════════════════════════════════════════════════════════════

describe("detectCycleTrendSignal — sparse data guard", () => {
  it("TEST-08b  1 logged cycle → trend signal suppressed (show: false)", () => {
    const s = detectCycleTrendSignal({ cycleLengths: [28] });
    expect(s.show).toBe(false);
  });

  it("3 logged cycles (< minCycles=4) → trend signal suppressed", () => {
    const s = detectCycleTrendSignal({ cycleLengths: [28, 30, 32] });
    expect(s.show).toBe(false);
  });
});
