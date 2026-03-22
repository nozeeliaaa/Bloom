/**
 * bloomie-templates.test.js
 * Regression tests for guidance response assembly.
 * Ensures safety-critical scenarios produce the correct response sections.
 */

import { describe, it, expect } from "vitest";
import { buildGuidanceResponse, getStructuredSummary } from "../bloomie-templates.js";

// Helper: build a minimal entities object
function entities(overrides = {}) {
  return {
    symptoms: {
      late: false, heavy: false, spotting: false, pelvic: false,
      mood: false, discharge: false, nausea: false, dizziness: false,
      ...overrides.symptoms,
    },
    severity:  overrides.severity  || null,
    timing:    overrides.timing    || null,
    pregnancy: overrides.pregnancy || { chance: false, testedYet: false, result: null },
    urgent:    overrides.urgent    || false,
  };
}

// ─── buildGuidanceResponse — scenario resolution via reason ──────────────────

describe("buildGuidanceResponse — via inferredReason", () => {
  it("urgency_flag → urgent scenario, includes seek care line", () => {
    const res = buildGuidanceResponse(entities({ urgent: true }), "urgency_flag");
    expect(res).not.toBeNull();
    expect(res.scenario).toBe("urgent");
    expect(res.lines.some(l => /seek urgent help/i.test(l))).toBe(true);
    expect(res.lines.some(l => /seek care now/i.test(l))).toBe(true);
  });

  it("heavy+dizzy → heavy_with_dizziness scenario", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { heavy: true, dizziness: true } }),
      "heavy+dizzy"
    );
    expect(res.scenario).toBe("heavy_with_dizziness");
  });

  it("late+pregnancy_chance+no_test → late_with_pregnancy_chance", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { late: true }, pregnancy: { chance: true, testedYet: false, result: null } }),
      "late+pregnancy_chance+no_test"
    );
    expect(res.scenario).toBe("late_with_pregnancy_chance");
  });

  it("late+2weeks → late_long_duration", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { late: true } }),
      "late+2weeks"
    );
    expect(res.scenario).toBe("late_long_duration");
  });

  it("heavy+7days → heavy_long", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { heavy: true } }),
      "heavy+7days"
    );
    expect(res.scenario).toBe("heavy_long");
  });

  it("pelvic+after_sex → pelvic_sex", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { pelvic: true }, timing: "after_sex" }),
      "pelvic+after_sex"
    );
    expect(res.scenario).toBe("pelvic_sex");
  });

  it("pelvic+severe → pelvic_severe", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { pelvic: true }, severity: "severe" }),
      "pelvic+severe"
    );
    expect(res.scenario).toBe("pelvic_severe");
  });

  it("spotting+mid_cycle → spotting_midcycle", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { spotting: true }, timing: "mid_cycle" }),
      "spotting+mid_cycle"
    );
    expect(res.scenario).toBe("spotting_midcycle");
  });

  it("spot+discharge → spotting_with_symptoms", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { spotting: true, discharge: true } }),
      "spot+discharge"
    );
    expect(res.scenario).toBe("spotting_with_symptoms");
  });

  it("mood+before_period → mood_before_period", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { mood: true }, timing: "before_period" }),
      "mood+before_period"
    );
    expect(res.scenario).toBe("mood_before_period");
    // Must include mental health crisis line
    expect(res.lines.some(l => /unsafe|harm yourself/i.test(l))).toBe(true);
  });
});

// ─── buildGuidanceResponse — entity fallback (no reason) ─────────────────────

describe("buildGuidanceResponse — entity-based fallback", () => {
  it("urgent flag → urgent scenario", () => {
    const res = buildGuidanceResponse(entities({ urgent: true }));
    expect(res.scenario).toBe("urgent");
  });

  it("heavy + dizziness → heavy_with_dizziness", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { heavy: true, dizziness: true } })
    );
    expect(res.scenario).toBe("heavy_with_dizziness");
  });

  it("late + pregnancy chance (no test) → late_with_pregnancy_chance", () => {
    const res = buildGuidanceResponse(
      entities({
        symptoms: { late: true },
        pregnancy: { chance: true, testedYet: false, result: null },
      })
    );
    expect(res.scenario).toBe("late_with_pregnancy_chance");
  });

  it("pelvic + severe → pelvic_severe", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { pelvic: true }, severity: "severe" })
    );
    expect(res.scenario).toBe("pelvic_severe");
  });

  it("late alone → late_period", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { late: true } }));
    expect(res.scenario).toBe("late_period");
  });

  it("heavy alone → heavy_bleeding", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { heavy: true } }));
    expect(res.scenario).toBe("heavy_bleeding");
  });

  it("mood alone → mood_general", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { mood: true } }));
    expect(res.scenario).toBe("mood_general");
  });

  it("no symptoms → null", () => {
    const res = buildGuidanceResponse(entities());
    expect(res).toBeNull();
  });
});

// ─── response structure ───────────────────────────────────────────────────────

describe("buildGuidanceResponse — response structure", () => {
  it("always includes disclaimer line", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { late: true } }));
    expect(res.lines.at(-1)).toMatch(/educational information only/i);
  });

  it("always includes urgent signs line", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { heavy: true } }));
    expect(res.lines.some(l => /seek urgent help if/i.test(l))).toBe(true);
  });

  it("includes all four structured fields", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { late: true } }));
    expect(res.structured).toHaveProperty("situation");
    expect(res.structured).toHaveProperty("meaning");
    expect(res.structured).toHaveProperty("nextSteps");
    expect(res.structured).toHaveProperty("urgentSigns");
  });
});

// ─── getStructuredSummary ─────────────────────────────────────────────────────

describe("getStructuredSummary", () => {
  it("returns scenario and extracted entities", () => {
    const e = entities({ symptoms: { spotting: true, discharge: true } });
    const summary = getStructuredSummary(e, "spot+discharge");
    expect(summary.scenario).toBe("spotting_with_symptoms");
    expect(summary.extractedEntities.symptoms).toContain("spotting");
    expect(summary.extractedEntities.symptoms).toContain("discharge");
  });

  it("returns null when no scenario matches", () => {
    const summary = getStructuredSummary(entities());
    expect(summary).toBeNull();
  });
});
