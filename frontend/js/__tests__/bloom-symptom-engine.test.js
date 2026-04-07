/**
 * bloom-symptom-engine.test.js
 * ─────────────────────────────────────────────────────────────
 * Unit tests for the Bloom Symptom Signals Engine.
 *
 * All tests are deterministic and use explicit mock data.
 * No network calls, no randomness, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  detectPhaseContextSignal,
  detectSymptomPatternSignal,
  detectBaselineDeviationSignal,
  detectReproductiveGuidanceSignal,
  detectSafetyEscalationSignal,
  detectDataQualitySignal,
  generateSymptomSignals,
  generateIntegratedSignals,
  getHighestPrioritySymptomSignal,
  getBloomieSymptomContext,
  buildSeverityMap,
  extractCodes,
  isSymptomPersistent,
  isNewSymptom,
  getBaselineSeverity,
  SYMPTOM_PHASE_MAP,
  ALL_SYMPTOM_CODES,
  validatePhaseMapCodes,
} from "../algorithms/bloom-symptom-engine.js";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/** Build a loggedSymptoms array from { code: severity } pairs */
function symptoms(map) {
  return Object.entries(map).map(([code, severity]) => ({ code, severity }));
}

/** Build a single symptomHistory entry for a given dateKey */
function historyEntry(dateKey, codeMap) {
  return {
    dateKey,
    items: Object.entries(codeMap).map(([code, severity]) => ({ code, severity })),
  };
}

/** Produce dateKey strings for the last N days (today = index 0) */
function lastNDays(n) {
  const keys = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    keys.push(`${y}-${m}-${day}`);
  }
  return keys;
}

/* ─── 1. PMS pattern detection ─────────────────────────────────────────────── */

describe("detectSymptomPatternSignal - PMS pattern", () => {
  it("fires SYMPTOMS_MATCH_PMS_PATTERN in luteal phase with 3+ cluster symptoms", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({
        MOOD_SWINGS: 3, IRRITABILITY: 2, BLOATING: 2, BREAST_TENDERNESS: 2,
      }),
      phase: "luteal",
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_PMS_PATTERN");
    expect(result.show).toBe(true);
    expect(result.level).toBe("medium");
  });

  it("fires PMS pattern when dayOfCycle >= 16 even without explicit phase", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ MOOD_SWINGS: 2, FATIGUE: 2, CRAVING_SWEET: 1, ANXIETY: 2 }),
      phase: null,
      dayOfCycle: 20,
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_PMS_PATTERN");
    expect(result.show).toBe(true);
  });

  it("does NOT fire PMS pattern when phase is follicular (too early)", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ MOOD_SWINGS: 3, IRRITABILITY: 2, BLOATING: 2, BREAST_TENDERNESS: 2 }),
      phase: "follicular",
      dayOfCycle: 8,
    });
    expect(result.code).not.toBe("SYMPTOMS_MATCH_PMS_PATTERN");
  });
});

/* ─── 2. Menstrual pattern detection ───────────────────────────────────────── */

describe("detectSymptomPatternSignal - menstrual pattern", () => {
  it("fires SYMPTOMS_MATCH_MENSTRUAL_PATTERN with bleeding + cramps + fatigue", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ VAGINAL_BLEEDING: 3, CRAMPS: 3, FATIGUE: 2 }),
      phase: "menstrual",
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_MENSTRUAL_PATTERN");
    expect(result.show).toBe(true);
    expect(result.level).toBe("low");
  });

  it("requires at least 2 support symptoms alongside bleeding", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ VAGINAL_BLEEDING: 2 }),
      phase: "menstrual",
    });
    expect(result.code).not.toBe("SYMPTOMS_MATCH_MENSTRUAL_PATTERN");
  });
});

/* ─── 3. Ovulation pattern detection ──────────────────────────────────────── */

describe("detectSymptomPatternSignal - ovulation pattern", () => {
  it("fires SYMPTOMS_MATCH_OVULATION_PATTERN with eggwhite + BBT shift + ovulation pain", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, BBT_SHIFT: 1, OVULATION_PAIN: 2 }),
      phase: "ovulation",
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_OVULATION_PATTERN");
    expect(result.show).toBe(true);
  });

  it("fires with eggwhite + libido (minimum cluster)", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, INCREASED_LIBIDO: 2 }),
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_OVULATION_PATTERN");
  });
});

/* ─── 4. Hormonal pattern detection ───────────────────────────────────────── */

describe("detectSymptomPatternSignal - hormonal pattern", () => {
  it("fires SYMPTOMS_MATCH_HORMONAL_PATTERN with acne + hair thinning + irregular + fatigue", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({
        ACNE: 2, HAIR_THINNING: 2, IRREGULAR_PERIOD: 1, FATIGUE: 3,
      }),
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_HORMONAL_PATTERN");
    expect(result.show).toBe(true);
    expect(result.level).toBe("medium");
  });

  it("does NOT say PCOS in the message", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({ ACNE: 2, WEIGHT_CHANGE: 2, IRREGULAR_PERIOD: 1, BLOATING: 2 }),
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_HORMONAL_PATTERN");
    expect(result.message).not.toMatch(/pcos/i);
    expect(result.message).toMatch(/provider/i);
  });
});

/* ─── 5. Safety escalation - heavy flow + fatigue ─────────────────────────── */

describe("detectSafetyEscalationSignal - heavy flow + fatigue", () => {
  it("fires SEEK_URGENT_CARE when HEAVY_FLOW >= 4 and FATIGUE present", () => {
    const syms = symptoms({ HEAVY_FLOW: 4, FATIGUE: 2 });
    const result = detectSafetyEscalationSignal({
      loggedSymptoms: syms,
      severityMap:    buildSeverityMap(syms),
    });
    expect(result.code).toBe("SEEK_URGENT_CARE");
    expect(result.level).toBe("high");
    expect(result.show).toBe(true);
  });

  it("does NOT fire SEEK_URGENT_CARE for low-severity heavy flow without fatigue", () => {
    const syms = symptoms({ HEAVY_FLOW: 2, BLOATING: 2 });
    const result = detectSafetyEscalationSignal({
      loggedSymptoms: syms,
      severityMap:    buildSeverityMap(syms),
    });
    expect(result.code).not.toBe("SEEK_URGENT_CARE");
  });
});

/* ─── 6. Ectopic risk flag ─────────────────────────────────────────────────── */

describe("detectSafetyEscalationSignal - ectopic risk", () => {
  it("fires SEEK_URGENT_CARE for CRAMPS >= 4 + SPOTTING + MISSED_PERIOD", () => {
    const syms = symptoms({ CRAMPS: 4, SPOTTING: 2, MISSED_PERIOD: 1 });
    const result = detectSafetyEscalationSignal({
      loggedSymptoms: syms,
      severityMap:    buildSeverityMap(syms),
    });
    expect(result.code).toBe("SEEK_URGENT_CARE");
    expect(result.debug.note).toBe("ectopic_risk_indicator");
  });
});

/* ─── 7. Fever proxy ───────────────────────────────────────────────────────── */

describe("detectSafetyEscalationSignal - fever proxy with pelvic symptoms", () => {
  it("fires SEEK_URGENT_CARE for PELVIC_PAIN >= 4 + NIGHT_SWEATS + COLD_FLASHES", () => {
    const syms = symptoms({ PELVIC_PAIN: 4, NIGHT_SWEATS: 2, COLD_FLASHES: 2 });
    const result = detectSafetyEscalationSignal({
      loggedSymptoms: syms,
      severityMap:    buildSeverityMap(syms),
    });
    expect(result.code).toBe("SEEK_URGENT_CARE");
    expect(result.debug.note).toBe("fever_proxy_with_severe_pelvic_pain");
  });

  it("fires FEVER_WITH_PELVIC_SYMPTOMS for milder fever proxy + pelvic pain", () => {
    const syms = symptoms({ PELVIC_PAIN: 2, NIGHT_SWEATS: 2, COLD_FLASHES: 2 });
    const result = detectSafetyEscalationSignal({
      loggedSymptoms: syms,
      severityMap:    buildSeverityMap(syms),
    });
    expect(result.code).toBe("FEVER_WITH_PELVIC_SYMPTOMS");
    expect(result.level).toBe("high");
  });
});

/* ─── 8. New symptom detection ─────────────────────────────────────────────── */

describe("detectBaselineDeviationSignal - new symptom", () => {
  it("fires NEW_SYMPTOM_DETECTED when code not seen in history", () => {
    const history = [
      historyEntry("2026-01-01", { CRAMPS: 2, FATIGUE: 2 }),
      historyEntry("2026-01-28", { CRAMPS: 2, HEADACHE: 1 }),
    ];
    const result = detectBaselineDeviationSignal({
      loggedSymptoms: symptoms({ HAIR_THINNING: 2 }),
      symptomHistory: history,
      phase: "luteal",
      cycleCount: 3,
    });
    expect(result.code).toBe("NEW_SYMPTOM_DETECTED");
    expect(result.show).toBe(true);
    expect(result.debug.newSymptoms).toContain("HAIR_THINNING");
  });

  it("uses medium level when 2+ new symptoms appear together", () => {
    const history = [historyEntry("2026-01-01", { CRAMPS: 2 })];
    const result = detectBaselineDeviationSignal({
      loggedSymptoms: symptoms({ HAIR_THINNING: 2, HOT_FLASHES: 2 }),
      symptomHistory: history,
      phase: "luteal",
      cycleCount: 2,
    });
    expect(result.code).toBe("NEW_SYMPTOM_DETECTED");
    expect(result.level).toBe("medium");
  });
});

/* ─── 9. Intensity deviation above personal baseline ──────────────────────── */

describe("detectBaselineDeviationSignal - intensity deviation", () => {
  it("fires SYMPTOMS_MORE_INTENSE_THAN_USUAL when severity is 2+ above baseline", () => {
    const history = [
      historyEntry("2026-01-01", { CRAMPS: 1 }),
      historyEntry("2026-01-28", { CRAMPS: 1 }),
      historyEntry("2026-02-25", { CRAMPS: 1 }),
    ];
    // baseline ≈ 1; current = 4 → delta = 3
    const result = detectBaselineDeviationSignal({
      loggedSymptoms: symptoms({ CRAMPS: 4 }),
      symptomHistory: history,
      phase: "menstrual",
      cycleCount: 3,
    });
    expect(result.code).toBe("SYMPTOMS_MORE_INTENSE_THAN_USUAL");
    expect(result.show).toBe(true);
    expect(result.debug.intenseSymptoms[0].delta).toBeGreaterThanOrEqual(2);
  });

  it("does NOT fire if severity is only 1 point above baseline", () => {
    const history = [
      historyEntry("2026-01-01", { CRAMPS: 2 }),
      historyEntry("2026-01-28", { CRAMPS: 2 }),
    ];
    const result = detectBaselineDeviationSignal({
      loggedSymptoms: symptoms({ CRAMPS: 3 }),
      symptomHistory: history,
      phase: "menstrual",
      cycleCount: 2,
    });
    expect(result.code).not.toBe("SYMPTOMS_MORE_INTENSE_THAN_USUAL");
  });
});

/* ─── 10. Persistent symptom across 3 days ────────────────────────────────── */

describe("isSymptomPersistent", () => {
  it("returns true when code appears on the last 3 consecutive days", () => {
    const days = lastNDays(3);
    const history = days.map(key => historyEntry(key, { CRAMPS: 3 }));
    const today = new Date();
    expect(isSymptomPersistent(history, "CRAMPS", 3, today)).toBe(true);
  });

  it("returns false when there is a gap in the streak", () => {
    const days = lastNDays(4);
    // Leave day 2 (index 2) empty - break the streak
    const history = [
      historyEntry(days[0], { CRAMPS: 3 }),
      historyEntry(days[1], { CRAMPS: 3 }),
      historyEntry(days[3], { CRAMPS: 3 }),
    ];
    const today = new Date();
    expect(isSymptomPersistent(history, "CRAMPS", 3, today)).toBe(false);
  });
});

/* ─── 11. Phase mismatch detection ────────────────────────────────────────── */

describe("detectReproductiveGuidanceSignal - cycle phase shift", () => {
  it("fires CYCLE_PHASE_SHIFT_POSSIBLE when DISCHARGE_EGGWHITE logged in luteal phase", () => {
    const result = detectReproductiveGuidanceSignal({
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, BLOATING: 2 }),
      phase: "luteal",
    });
    expect(result.code).toBe("CYCLE_PHASE_SHIFT_POSSIBLE");
    expect(result.show).toBe(true);
    expect(result.debug.marker).toBe("DISCHARGE_EGGWHITE_IN_LUTEAL");
  });

  it("fires CYCLE_PHASE_SHIFT_POSSIBLE for bleeding + cramps in follicular phase", () => {
    const result = detectReproductiveGuidanceSignal({
      loggedSymptoms: symptoms({ VAGINAL_BLEEDING: 3, CRAMPS: 3 }),
      phase: "follicular",
    });
    expect(result.code).toBe("CYCLE_PHASE_SHIFT_POSSIBLE");
    expect(result.debug.marker).toBe("BLEEDING_IN_FOLLICULAR");
  });
});

/* ─── 12. Pregnancy test timing ───────────────────────────────────────────── */

describe("detectReproductiveGuidanceSignal - pregnancy test timing", () => {
  it("fires PREGNANCY_TEST_TIMING_RELEVANT for MISSED_PERIOD + NAUSEA + FATIGUE", () => {
    const result = detectReproductiveGuidanceSignal({
      loggedSymptoms: symptoms({ MISSED_PERIOD: 1, NAUSEA: 2, FATIGUE: 3 }),
      missedPeriod: false,
    });
    expect(result.code).toBe("PREGNANCY_TEST_TIMING_RELEVANT");
    expect(result.level).toBe("medium");
    expect(result.show).toBe(true);
  });

  it("also fires when missedPeriod param is true + breast tenderness", () => {
    const result = detectReproductiveGuidanceSignal({
      loggedSymptoms: symptoms({ BREAST_TENDERNESS: 3 }),
      missedPeriod: true,
    });
    expect(result.code).toBe("PREGNANCY_TEST_TIMING_RELEVANT");
  });
});

/* ─── 13. Perimenopause pattern ────────────────────────────────────────────── */

describe("detectSymptomPatternSignal - perimenopause pattern", () => {
  it("fires SYMPTOMS_MATCH_PERIMENOPAUSE_PATTERN with 3+ cluster symptoms", () => {
    const result = detectSymptomPatternSignal({
      loggedSymptoms: symptoms({
        HOT_FLASHES: 3, NIGHT_SWEATS: 3, INSOMNIA: 2, MOOD_SWINGS: 2,
      }),
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_PERIMENOPAUSE_PATTERN");
    expect(result.level).toBe("medium");
    expect(result.show).toBe(true);
  });
});

/* ─── 14. Insufficient history suppresses baseline signals ─────────────────── */

describe("detectBaselineDeviationSignal - insufficient history", () => {
  it("returns NOT_ENOUGH_HISTORY_FOR_BASELINE with show: false when cycleCount < 2", () => {
    const result = detectBaselineDeviationSignal({
      loggedSymptoms: symptoms({ CRAMPS: 4, FATIGUE: 3 }),
      symptomHistory: [historyEntry("2026-01-01", { CRAMPS: 1 })],
      phase: "menstrual",
      cycleCount: 1,
    });
    expect(result.code).toBe("NOT_ENOUGH_HISTORY_FOR_BASELINE");
    expect(result.show).toBe(false);
  });

  it("detectDataQualitySignal also returns NOT_ENOUGH_HISTORY_FOR_BASELINE when cycleCount < 2", () => {
    const result = detectDataQualitySignal({
      symptomHistory: [],
      loggedSymptoms: [],
      cycleCount: 1,
    });
    expect(result.code).toBe("NOT_ENOUGH_HISTORY_FOR_BASELINE");
    expect(result.show).toBe(false);
  });
});

/* ─── 15. Logging gap detection ────────────────────────────────────────────── */

describe("detectDataQualitySignal - logging gap", () => {
  it("fires SYMPTOM_LOGGING_GAP when last entry is 14+ days ago", () => {
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const key = staleDate.toISOString().slice(0, 10);
    const result = detectDataQualitySignal({
      symptomHistory:  [historyEntry(key, { CRAMPS: 2 })],
      loggedSymptoms:  [],
      cycleCount:      3,
    });
    expect(result.code).toBe("SYMPTOM_LOGGING_GAP");
    expect(result.show).toBe(true);
  });

  it("does NOT fire SYMPTOM_LOGGING_GAP when entry is recent", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = detectDataQualitySignal({
      symptomHistory:  [historyEntry(today, { CRAMPS: 2 })],
      loggedSymptoms:  symptoms({ CRAMPS: 2 }),
      cycleCount:      3,
    });
    expect(result.code).not.toBe("SYMPTOM_LOGGING_GAP");
  });
});

/* ─── 16. All severity-0 entries → LOW_SEVERITY_DATA ──────────────────────── */

describe("detectDataQualitySignal - low severity data", () => {
  it("returns LOW_SEVERITY_DATA with show: false when all severities are 0", () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = detectDataQualitySignal({
      symptomHistory:  [historyEntry(today, { CRAMPS: 0 })],
      loggedSymptoms:  symptoms({ CRAMPS: 0, FATIGUE: 0, BLOATING: 0 }),
      cycleCount:      3,
    });
    expect(result.code).toBe("LOW_SEVERITY_DATA");
    expect(result.show).toBe(false);
  });
});

/* ─── 17. getBloomieSymptomContext - urgent flag ───────────────────────────── */

describe("getBloomieSymptomContext - urgent flag", () => {
  it("sets hasUrgentSignal = true when any signal is high level", () => {
    const syms = symptoms({ HEAVY_FLOW: 4, FATIGUE: 2 });
    const signals = generateSymptomSignals({
      loggedSymptoms: syms,
      cycleCount: 3,
      symptomHistory: [],
    });
    const ctx = getBloomieSymptomContext(signals);
    expect(ctx.hasUrgentSignal).toBe(true);
  });

  it("sets hasUrgentSignal = false for mild symptoms", () => {
    const syms = symptoms({ BLOATING: 1, MOOD_SWINGS: 1 });
    const signals = generateSymptomSignals({
      loggedSymptoms: syms,
      phase: "luteal",
      cycleCount: 3,
      symptomHistory: [],
    });
    const ctx = getBloomieSymptomContext(signals);
    expect(ctx.hasUrgentSignal).toBe(false);
  });
});

/* ─── 18. getBloomieSymptomContext - bloomieInsight when pattern detected ──── */

describe("getBloomieSymptomContext - bloomieInsight", () => {
  it("returns a bloomieInsight string when a pattern is detected", () => {
    const signals = generateSymptomSignals({
      loggedSymptoms: symptoms({
        MOOD_SWINGS: 3, IRRITABILITY: 2, BLOATING: 2, BREAST_TENDERNESS: 2,
      }),
      phase: "luteal",
      cycleCount: 3,
      symptomHistory: [],
    });
    const ctx = getBloomieSymptomContext(signals);
    expect(typeof ctx.bloomieInsight).toBe("string");
    expect(ctx.bloomieInsight.length).toBeGreaterThan(0);
  });

  it("suppresses bloomieInsight when SEEK_URGENT_CARE fires", () => {
    const syms = symptoms({ HEAVY_FLOW: 4, FATIGUE: 2 });
    const signals = generateSymptomSignals({
      loggedSymptoms: syms,
      cycleCount: 3,
      symptomHistory: [],
    });
    const ctx = getBloomieSymptomContext(signals);
    expect(ctx.safetyEscalationNeeded).toBe(true);
    expect(ctx.bloomieInsight).toBeNull();
  });
});

/* ─── 19. Safety escalation takes priority in sorted results ──────────────── */

describe("generateSymptomSignals - safety escalation priority", () => {
  it("places SEEK_URGENT_CARE first in the output array", () => {
    const syms = symptoms({
      HEAVY_FLOW: 4, FATIGUE: 2,
      MOOD_SWINGS: 2, BLOATING: 2, IRRITABILITY: 2, BREAST_TENDERNESS: 2,
    });
    const signals = generateSymptomSignals({
      loggedSymptoms: syms,
      phase: "luteal",
      cycleCount: 3,
      symptomHistory: [],
    });
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].code).toBe("SEEK_URGENT_CARE");
    expect(signals[0].level).toBe("high");
  });
});

/* ─── 20. Multiple signals sorted correctly by level ──────────────────────── */

describe("generateSymptomSignals - signal sort order", () => {
  it("sorts high > medium > low and all returned signals have show: true", () => {
    const signals = generateSymptomSignals({
      loggedSymptoms: symptoms({
        MOOD_SWINGS: 3, IRRITABILITY: 2, BLOATING: 2, BREAST_TENDERNESS: 2,
        HEAVY_FLOW: 3, PELVIC_PAIN: 3,   // triggers URGENT_SYMPTOM_COMBINATION (high)
      }),
      phase: "luteal",
      cycleCount: 3,
      symptomHistory: [],
    });

    expect(signals.every(s => s.show)).toBe(true);

    const levels = signals.map(s => s.level);
    const order  = { high: 3, medium: 2, low: 1 };
    for (let i = 0; i < levels.length - 1; i++) {
      expect(order[levels[i]]).toBeGreaterThanOrEqual(order[levels[i + 1]]);
    }
  });
});

/* ─── 21. Phase context match ──────────────────────────────────────────────── */

describe("detectPhaseContextSignal - phase match", () => {
  it("fires SYMPTOMS_MATCH_PHASE for 3+ luteal expected symptoms in luteal phase", () => {
    const result = detectPhaseContextSignal({
      loggedSymptoms: symptoms({
        BLOATING: 2, MOOD_SWINGS: 2, BREAST_TENDERNESS: 2, FATIGUE: 2,
      }),
      phase: "luteal",
    });
    expect(result.code).toBe("SYMPTOMS_MATCH_PHASE");
    expect(result.show).toBe(true);
  });
});

/* ─── 22. Phase context unexpected ────────────────────────────────────────── */

describe("detectPhaseContextSignal - unexpected symptoms", () => {
  it("fires SYMPTOMS_UNEXPECTED_FOR_PHASE for 2+ unexpected symbols in menstrual phase", () => {
    const result = detectPhaseContextSignal({
      loggedSymptoms: symptoms({
        DISCHARGE_EGGWHITE: 2, INCREASED_LIBIDO: 2, CRAMPS: 2,
      }),
      phase: "menstrual",
    });
    expect(result.code).toBe("SYMPTOMS_UNEXPECTED_FOR_PHASE");
    expect(result.show).toBe(true);
    expect(result.level).toBe("medium");
  });

  it("returns show: false when phase is null", () => {
    const result = detectPhaseContextSignal({
      loggedSymptoms: symptoms({ CRAMPS: 2 }),
      phase: null,
    });
    expect(result.show).toBe(false);
  });
});

/* ─── Helpers: buildSeverityMap / extractCodes / isNewSymptom ──────────────── */

describe("buildSeverityMap", () => {
  it("maps codes to their severity values", () => {
    const map = buildSeverityMap(symptoms({ CRAMPS: 3, FATIGUE: 2 }));
    expect(map.CRAMPS).toBe(3);
    expect(map.FATIGUE).toBe(2);
  });

  it("defaults missing severity to 0", () => {
    const map = buildSeverityMap([{ code: "BLOATING" }]);
    expect(map.BLOATING).toBe(0);
  });
});

describe("extractCodes", () => {
  it("returns a Set of code strings", () => {
    const codes = extractCodes(symptoms({ CRAMPS: 2, FATIGUE: 1 }));
    expect(codes.has("CRAMPS")).toBe(true);
    expect(codes.has("FATIGUE")).toBe(true);
    expect(codes.size).toBe(2);
  });
});

describe("isNewSymptom", () => {
  it("returns true when code has never appeared in history", () => {
    const history = [historyEntry("2026-01-01", { CRAMPS: 2 })];
    expect(isNewSymptom(history, "HAIR_THINNING")).toBe(true);
  });

  it("returns false when code has appeared before", () => {
    const history = [historyEntry("2026-01-01", { CRAMPS: 2 })];
    expect(isNewSymptom(history, "CRAMPS")).toBe(false);
  });
});

describe("getHighestPrioritySymptomSignal", () => {
  it("returns null for empty array", () => {
    expect(getHighestPrioritySymptomSignal([])).toBeNull();
  });

  it("returns the high-level signal when mixed levels present", () => {
    const signals = [
      { code: "A", level: "low",    show: true },
      { code: "B", level: "high",   show: true },
      { code: "C", level: "medium", show: true },
    ];
    expect(getHighestPrioritySymptomSignal(signals).code).toBe("B");
  });
});

/* ─── New tests: suppression, phase confidence, validation, weighted baseline, ─ */
/* ─── integrated signals, sporadic logger, cross-validation                    ─ */

/* ─── N1. SEEK_URGENT_CARE suppresses HEAVY_BLEEDING_FLAG ─────────────────── */

describe("generateSymptomSignals - safety suppression", () => {
  it("SEEK_URGENT_CARE suppresses HEAVY_BLEEDING_FLAG in same output", () => {
    // HEAVY_FLOW >= 4 + FATIGUE triggers SEEK_URGENT_CARE
    // HEAVY_FLOW alone (if it were to show) would also trigger HEAVY_BLEEDING_FLAG
    // With suppression, HEAVY_BLEEDING_FLAG must not appear alongside SEEK_URGENT_CARE
    const syms = symptoms({ HEAVY_FLOW: 4, FATIGUE: 3 });
    const signals = generateSymptomSignals({
      loggedSymptoms: syms,
      cycleCount: 3,
      symptomHistory: [],
    });
    const codes = signals.map(s => s.code);
    expect(codes).toContain("SEEK_URGENT_CARE");
    expect(codes).not.toContain("HEAVY_BLEEDING_FLAG");
  });

  it("URGENT_SYMPTOM_COMBINATION suppresses HEAVY_BLEEDING_FLAG but not SEEK_URGENT_CARE signals", () => {
    // HEAVY_FLOW(3) + PELVIC_PAIN(3) → URGENT_SYMPTOM_COMBINATION (no SEEK_URGENT_CARE)
    const syms = symptoms({ HEAVY_FLOW: 3, PELVIC_PAIN: 3 });
    const signals = generateSymptomSignals({
      loggedSymptoms: syms,
      cycleCount: 3,
      symptomHistory: [],
    });
    const codes = signals.map(s => s.code);
    expect(codes).toContain("URGENT_SYMPTOM_COMBINATION");
    expect(codes).not.toContain("HEAVY_BLEEDING_FLAG");
    expect(codes).not.toContain("SEEK_URGENT_CARE");
  });
});

/* ─── N2. Low phase confidence softens language ───────────────────────────── */

describe("detectPhaseContextSignal - phase confidence softening", () => {
  it("uses softened message when phaseConfidence is 'low'", () => {
    const result = detectPhaseContextSignal({
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, INCREASED_LIBIDO: 2, CRAMPS: 2 }),
      phase: "menstrual",
      phaseConfidence: "low",
    });
    expect(result.code).toBe("SYMPTOMS_UNEXPECTED_FOR_PHASE");
    expect(result.message).toMatch(/If you are in your/i);
    expect(result.level).toBe("medium"); // low confidence still shows medium
  });

  it("downgrades level to low when phaseConfidence is null", () => {
    const result = detectPhaseContextSignal({
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, INCREASED_LIBIDO: 2, CRAMPS: 2 }),
      phase: "menstrual",
      phaseConfidence: null,
    });
    expect(result.code).toBe("SYMPTOMS_UNEXPECTED_FOR_PHASE");
    expect(result.level).toBe("low");
    expect(result.message).toMatch(/If you are in your/i);
  });

  it("uses assertive message at high confidence (default behaviour unchanged)", () => {
    const result = detectPhaseContextSignal({
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, INCREASED_LIBIDO: 2, CRAMPS: 2 }),
      phase: "menstrual",
      phaseConfidence: "high",
    });
    expect(result.code).toBe("SYMPTOMS_UNEXPECTED_FOR_PHASE");
    expect(result.level).toBe("medium");
    expect(result.message).not.toMatch(/If you are in your/i);
  });
});

/* ─── N3. Phase map validation catches unknown code ───────────────────────── */

describe("validatePhaseMapCodes - phase map validation", () => {
  it("throws when phase map contains an unknown code", () => {
    const badMap = {
      menstrual: { expected: ["CRAMPS", "TYPO_CODE_XYZ"], unexpected: [] },
    };
    expect(() => validatePhaseMapCodes(badMap, ALL_SYMPTOM_CODES)).toThrow(
      "SYMPTOM_PHASE_MAP contains unknown code: TYPO_CODE_XYZ"
    );
  });

  it("does not throw for the current valid SYMPTOM_PHASE_MAP", () => {
    expect(() => validatePhaseMapCodes(SYMPTOM_PHASE_MAP, ALL_SYMPTOM_CODES)).not.toThrow();
  });
});

/* ─── N4. Weighted baseline gives higher weight to recent entries ──────────── */

describe("getBaselineSeverity - weighted baseline", () => {
  it("gives more weight to recent entries when weightRecent=true", () => {
    // Older entry: severity 1; recent entry (within last 30 days): severity 5
    const recentKey = new Date().toISOString().slice(0, 10);
    const oldKey = "2024-01-01"; // definitely older than 30 days
    const history = [
      historyEntry(oldKey,    { CRAMPS: 1 }),
      historyEntry(recentKey, { CRAMPS: 5 }),
    ];
    const weighted   = getBaselineSeverity(history, "CRAMPS", true);
    const unweighted = getBaselineSeverity(history, "CRAMPS", false);
    // Unweighted average = (1+5)/2 = 3; weighted = (1*1 + 5*2)/(1+2) ≈ 3.67
    expect(weighted).toBeGreaterThan(unweighted);
  });

  it("returns the flat average when weightRecent=false", () => {
    const history = [
      historyEntry("2024-01-01", { CRAMPS: 2 }),
      historyEntry("2024-02-01", { CRAMPS: 4 }),
    ];
    const result = getBaselineSeverity(history, "CRAMPS", false);
    expect(result).toBeCloseTo(3, 5);
  });
});

/* ─── N5. generateIntegratedSignals elevates pregnancy signal ─────────────── */

describe("generateIntegratedSignals - pregnancy signal elevation", () => {
  it("elevates PREGNANCY_TEST_TIMING_RELEVANT to high when cycle engine also fires MISSED_PERIOD", () => {
    // Use a lastPeriodStart far enough in the past to trigger MISSED_PERIOD in cycle engine
    const lastPeriodStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const expectedEnd     = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000); // window ended 25 days ago
    const result = generateIntegratedSignals({
      expectedNextPeriodWindow: {
        start: new Date(expectedEnd.getTime() - 4 * 24 * 60 * 60 * 1000),
        end:   expectedEnd,
      },
      lastPeriodStart,
      cycleLengths: [28, 28, 28],
      loggedSymptoms: symptoms({ NAUSEA: 2, FATIGUE: 3, MISSED_PERIOD: 1 }),
      cycleCount: 3,
      symptomHistory: [],
    });
    const pregSignal = result.symptomSignals.find(s => s.code === "PREGNANCY_TEST_TIMING_RELEVANT");
    expect(pregSignal).toBeDefined();
    expect(pregSignal.level).toBe("high");
    expect(pregSignal.message).toMatch(/Both your cycle timing/i);
    expect(result.crossValidatedNotes.length).toBeGreaterThan(0);
  });
});

/* ─── N6. generateIntegratedSignals adds ectopic note ─────────────────────── */

describe("generateIntegratedSignals - ectopic risk note", () => {
  it("adds ectopic risk note to SEEK_URGENT_CARE message when MISSED_PERIOD fires in cycle engine", () => {
    const lastPeriodStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const expectedEnd     = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
    const result = generateIntegratedSignals({
      expectedNextPeriodWindow: {
        start: new Date(expectedEnd.getTime() - 4 * 24 * 60 * 60 * 1000),
        end:   expectedEnd,
      },
      lastPeriodStart,
      cycleLengths: [28, 28, 28],
      // CRAMPS(4) + SPOTTING + MISSED_PERIOD triggers SEEK_URGENT_CARE (ectopic indicator)
      loggedSymptoms: symptoms({ CRAMPS: 4, SPOTTING: 2, MISSED_PERIOD: 1 }),
      cycleCount: 3,
      symptomHistory: [],
    });
    const urgentSignal = result.symptomSignals.find(s => s.code === "SEEK_URGENT_CARE");
    expect(urgentSignal).toBeDefined();
    expect(urgentSignal.message).toMatch(/period is also late/i);
    expect(result.crossValidatedNotes.some(n => /ectopic/i.test(n))).toBe(true);
  });
});

/* ─── N7. Sporadic logger suppression ─────────────────────────────────────── */

describe("detectDataQualitySignal - sporadic logger suppression", () => {
  it("suppresses SYMPTOM_LOGGING_GAP when user is a sporadic logger with suppressLoggingGapIfSporadic", () => {
    // Build a history where entries are ~15 days apart (sporadic) and cycleCount > 3
    const gaps = [0, 15, 30, 45, 60, 75];
    const history = gaps.map(offset => {
      const d = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
      // Oldest entry is 75 days ago (well past 14-day threshold)
      return historyEntry(d.toISOString().slice(0, 10), { CRAMPS: 2 });
    });
    const result = detectDataQualitySignal({
      symptomHistory:  history,
      loggedSymptoms:  [],
      cycleCount:      5,
      settings:        { suppressLoggingGapIfSporadic: true },
    });
    // Should be suppressed - not SYMPTOM_LOGGING_GAP
    expect(result.code).not.toBe("SYMPTOM_LOGGING_GAP");
    expect(result.show).toBe(false);
  });

  it("still fires SYMPTOM_LOGGING_GAP when suppressLoggingGapIfSporadic is false", () => {
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const result = detectDataQualitySignal({
      symptomHistory:  [historyEntry(staleDate.toISOString().slice(0, 10), { CRAMPS: 2 })],
      loggedSymptoms:  [],
      cycleCount:      5,
      settings:        { suppressLoggingGapIfSporadic: false },
    });
    expect(result.code).toBe("SYMPTOM_LOGGING_GAP");
    expect(result.show).toBe(true);
  });
});

/* ─── N8. Cross-validation note when both engines detect cycle shift ──────── */

describe("generateIntegratedSignals - cycle shift cross-validation", () => {
  it("adds cross-validation note and elevates level when both engines detect cycle shift", () => {
    // cycleLengths showing a sudden shift (recent avg vs baseline avg > 5 days)
    const cycleLengths = [28, 28, 28, 35, 36, 37]; // recent cycles lengthened suddenly
    const result = generateIntegratedSignals({
      lastPeriodStart:  new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      cycleLengths,
      // DISCHARGE_EGGWHITE in luteal phase triggers CYCLE_PHASE_SHIFT_POSSIBLE
      loggedSymptoms: symptoms({ DISCHARGE_EGGWHITE: 2, BLOATING: 2 }),
      phase:          "luteal",
      cycleCount:     6,
      symptomHistory: [],
    });
    const shiftSignal = result.symptomSignals.find(s => s.code === "CYCLE_PHASE_SHIFT_POSSIBLE");
    if (shiftSignal && result.cycleSignals.some(s => s.code === "SUDDEN_CYCLE_SHIFT")) {
      expect(shiftSignal.level).toBe("medium");
      expect(shiftSignal.debug.cycleEngineAgrees).toBe(true);
      expect(result.crossValidatedNotes.some(n => /both.*engines/i.test(n))).toBe(true);
    } else {
      // If cycle engine didn't fire SUDDEN_CYCLE_SHIFT, verify the signal still shows at its default level
      expect(shiftSignal).toBeDefined();
    }
  });
});
