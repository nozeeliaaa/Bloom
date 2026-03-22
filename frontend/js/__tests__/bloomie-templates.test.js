/**
 * bloomie-templates.test.js
 * Regression tests for guidance response assembly.
 * Ensures safety-critical scenarios produce the correct response sections.
 */

import { describe, it, expect } from "vitest";
import { buildGuidanceResponse, getStructuredSummary, getPhaseInsight, getToneOpener, hasMedicalSeriousness, CONCERN_PRIORITY } from "../bloomie-templates.js";
import { extractUrgency } from "../bloomie-inference.js";
import { createCtx } from "../bloomie-session.js";

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
    // Safety content must reach the user — phrase is now in a "One thing to watch for:" line
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
    // Mental health crisis content must still reach the user (now inside "One thing to watch for:" line)
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
    // Disclaimer is now "This is educational info, not a diagnosis — you know your body best 🩷"
    expect(res.lines.at(-1)).toMatch(/educational info|educational information/i);
  });

  it("always includes urgent signs line with watch-for phrasing", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { heavy: true } }));
    // Old format: "Seek urgent help if: …"
    // New format: "One thing to watch for: if …"
    expect(res.lines.some(l => /one thing to watch for/i.test(l))).toBe(true);
  });

  it("does NOT expose internal section headers in visible lines", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { late: true } }));
    const forbidden = ["Possible situation:", "What this may mean:", "What to do next:", "Seek urgent help if:"];
    for (const header of forbidden) {
      expect(res.lines.every(l => !l.includes(header))).toBe(true);
    }
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

// ─── getPhaseInsight ──────────────────────────────────────────────────────────

describe("getPhaseInsight — null / missing inputs", () => {
  it("returns null when phase is null", () => {
    expect(getPhaseInsight(null, "mood")).toBeNull();
  });

  it("returns null when concern is null", () => {
    expect(getPhaseInsight("luteal", null)).toBeNull();
  });

  it("returns null when both are null", () => {
    expect(getPhaseInsight(null, null)).toBeNull();
  });

  it("returns null for an unknown phase", () => {
    expect(getPhaseInsight("unknown_phase", "mood")).toBeNull();
  });

  it("returns null for an unknown concern in a known phase", () => {
    expect(getPhaseInsight("luteal", "unknown_concern")).toBeNull();
  });
});

describe("getPhaseInsight — luteal phase", () => {
  it("luteal + mood returns a non-empty string mentioning progesterone", () => {
    const result = getPhaseInsight("luteal", "mood");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toMatch(/progesterone/i);
  });

  it("luteal + fatigue returns a non-empty string mentioning progesterone or lazy", () => {
    const result = getPhaseInsight("luteal", "fatigue");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/progesterone|lazy/i);
  });

  it("luteal + bloating mentions progesterone or digestion", () => {
    const result = getPhaseInsight("luteal", "bloating");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/progesterone|digestion/i);
  });

  it("luteal + sleep mentions disrupts or sleep quality", () => {
    const result = getPhaseInsight("luteal", "sleep");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/sleep|disrupts/i);
  });

  it("luteal + skin mentions oil production or breakout", () => {
    const result = getPhaseInsight("luteal", "skin");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/oil|breakout/i);
  });

  it("luteal + pain returns a non-empty string", () => {
    const result = getPhaseInsight("luteal", "pain");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("luteal + libido returns a non-empty string", () => {
    const result = getPhaseInsight("luteal", "libido");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("getPhaseInsight — menstrual phase", () => {
  it("menstrual + fatigue mentions iron or bleeding", () => {
    const result = getPhaseInsight("menstrual", "fatigue");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/iron|bleeding/i);
  });

  it("menstrual + mood mentions estrogen or progesterone drop", () => {
    const result = getPhaseInsight("menstrual", "mood");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/estrogen|progesterone/i);
  });

  it("menstrual + pain mentions prostaglandins or uterus", () => {
    const result = getPhaseInsight("menstrual", "pain");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/prostaglandin|uterus/i);
  });

  it("menstrual + sleep returns a non-empty string", () => {
    const result = getPhaseInsight("menstrual", "sleep");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("menstrual + bloating returns a non-empty string", () => {
    const result = getPhaseInsight("menstrual", "bloating");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("getPhaseInsight — follicular phase", () => {
  it("follicular + mood mentions estrogen", () => {
    const result = getPhaseInsight("follicular", "mood");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/estrogen/i);
  });

  it("follicular + libido mentions estrogen or energy", () => {
    const result = getPhaseInsight("follicular", "libido");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/estrogen|energy/i);
  });

  it("follicular + fatigue returns a non-empty string", () => {
    const result = getPhaseInsight("follicular", "fatigue");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("follicular + skin mentions estrogen or skin", () => {
    const result = getPhaseInsight("follicular", "skin");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/estrogen|skin/i);
  });
});

describe("getPhaseInsight — ovulation phase", () => {
  it("ovulation + mood mentions estrogen or peaks", () => {
    const result = getPhaseInsight("ovulation", "mood");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/estrogen|peaks/i);
  });

  it("ovulation + pain mentions mittelschmerz or follicle", () => {
    const result = getPhaseInsight("ovulation", "pain");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/mittelschmerz|follicle/i);
  });

  it("ovulation + libido mentions libido or estrogen", () => {
    const result = getPhaseInsight("ovulation", "libido");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/libido|estrogen/i);
  });

  it("ovulation + fatigue returns a non-empty string", () => {
    const result = getPhaseInsight("ovulation", "fatigue");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ─── getPhaseInsight — lowConfidence (softened phrasing) ──────────────────────

describe("getPhaseInsight — lowConfidence=true produces softened language", () => {
  it("luteal + mood: lowConfidence replaces hard 'In the luteal phase' opener", () => {
    const certain   = getPhaseInsight("luteal", "mood", false);
    const uncertain = getPhaseInsight("luteal", "mood", true);
    expect(certain).toMatch(/^In the luteal phase/i);
    expect(uncertain).not.toMatch(/^In the luteal phase/i);
    expect(uncertain).toMatch(/if you're in your luteal phase/i);
  });

  it("luteal + fatigue: lowConfidence softens the opener", () => {
    const uncertain = getPhaseInsight("luteal", "fatigue", true);
    expect(uncertain).toMatch(/if you're in your luteal phase/i);
  });

  it("luteal + bloating: lowConfidence softens the opener", () => {
    const certain   = getPhaseInsight("luteal", "bloating", false);
    const uncertain = getPhaseInsight("luteal", "bloating", true);
    expect(certain).toMatch(/^Luteal phase bloating/i);
    expect(uncertain).not.toMatch(/^Luteal phase bloating/i);
    expect(uncertain).toMatch(/if you're in your luteal phase/i);
  });

  it("menstrual + fatigue: lowConfidence softens 'During your period'", () => {
    const certain   = getPhaseInsight("menstrual", "fatigue", false);
    const uncertain = getPhaseInsight("menstrual", "fatigue", true);
    expect(certain).toMatch(/^During your period/i);
    expect(uncertain).not.toMatch(/^During your period/i);
    expect(uncertain).toMatch(/around your period/i);
  });

  it("menstrual + pain: lowConfidence softens 'Period cramps can happen when' (already soft — returns unchanged)", () => {
    // menstrual+pain starts with 'Period cramps can happen when' — already uses 'can'
    const certain   = getPhaseInsight("menstrual", "pain", false);
    const uncertain = getPhaseInsight("menstrual", "pain", true);
    // Both should contain the core content about prostaglandins
    expect(certain).toMatch(/prostaglandin/i);
    expect(uncertain).toMatch(/prostaglandin/i);
  });

  it("follicular + mood: lowConfidence softens the opener", () => {
    const certain   = getPhaseInsight("follicular", "mood", false);
    const uncertain = getPhaseInsight("follicular", "mood", true);
    expect(certain).toMatch(/^Estrogen rises steadily/i);
    expect(uncertain).not.toMatch(/^Estrogen rises steadily/i);
    expect(uncertain).toMatch(/if you're in your follicular phase/i);
  });

  it("ovulation + pain: already hedged with 'Some people feel' — unchanged by lowConfidence", () => {
    const certain   = getPhaseInsight("ovulation", "pain", false);
    const uncertain = getPhaseInsight("ovulation", "pain", true);
    // Both should start with the same soft phrasing
    expect(certain).toMatch(/^Some people feel/i);
    expect(uncertain).toMatch(/^Some people feel/i);
  });

  it("null phase always returns null regardless of lowConfidence", () => {
    expect(getPhaseInsight(null, "mood", true)).toBeNull();
    expect(getPhaseInsight(null, "mood", false)).toBeNull();
  });
});

// ─── CONCERN_PRIORITY ─────────────────────────────────────────────────────────

describe("CONCERN_PRIORITY — order and content", () => {
  it("is an array", () => {
    expect(Array.isArray(CONCERN_PRIORITY)).toBe(true);
  });

  it("pain comes before mood", () => {
    expect(CONCERN_PRIORITY.indexOf("pain")).toBeLessThan(CONCERN_PRIORITY.indexOf("mood"));
  });

  it("mood comes before fatigue", () => {
    expect(CONCERN_PRIORITY.indexOf("mood")).toBeLessThan(CONCERN_PRIORITY.indexOf("fatigue"));
  });

  it("fatigue comes before bloating", () => {
    expect(CONCERN_PRIORITY.indexOf("fatigue")).toBeLessThan(CONCERN_PRIORITY.indexOf("bloating"));
  });

  it("bloating comes before sleep", () => {
    expect(CONCERN_PRIORITY.indexOf("bloating")).toBeLessThan(CONCERN_PRIORITY.indexOf("sleep"));
  });

  it("sleep comes before skin", () => {
    expect(CONCERN_PRIORITY.indexOf("sleep")).toBeLessThan(CONCERN_PRIORITY.indexOf("skin"));
  });

  it("skin comes before libido", () => {
    expect(CONCERN_PRIORITY.indexOf("skin")).toBeLessThan(CONCERN_PRIORITY.indexOf("libido"));
  });

  it("given pain and mood, pain wins (priority selection logic)", () => {
    // Simulate pickPriorityConcern logic: iterate CONCERN_PRIORITY and return first match
    const concerns = ["mood", "pain"];
    const winner = CONCERN_PRIORITY.find(c => concerns.includes(c) && getPhaseInsight("luteal", c));
    expect(winner).toBe("pain");
  });

  it("given bloating and skin, bloating wins (body_image fix)", () => {
    const concerns = ["bloating", "skin"];
    const winner = CONCERN_PRIORITY.find(c => concerns.includes(c) && getPhaseInsight("luteal", c));
    expect(winner).toBe("bloating");
  });
});

// ─── Safety override — extractUrgency blocks phase insights ───────────────────

describe("safety override — extractUrgency detects urgency signals", () => {
  it("'soaking through' is recognised as urgent", () => {
    expect(extractUrgency("soaking through my pads")).toBe(true);
  });

  it("'passed out' is recognised as urgent", () => {
    expect(extractUrgency("i passed out from the pain")).toBe(true);
  });

  it("'shortness of breath' is recognised as urgent", () => {
    expect(extractUrgency("having shortness of breath")).toBe(true);
  });

  it("'severe pain' is recognised as urgent", () => {
    expect(extractUrgency("I have severe pain on one side")).toBe(true);
  });

  it("a non-urgent message is not flagged", () => {
    expect(extractUrgency("I feel tired and my mood has been low")).toBe(false);
  });

  it("a food craving message is not flagged as urgent", () => {
    expect(extractUrgency("I keep craving chocolate and salty snacks")).toBe(false);
  });

  it("a sleep complaint is not flagged as urgent", () => {
    expect(extractUrgency("I can't sleep and feel exhausted")).toBe(false);
  });
});

// ─── Session memory — insightsGiven prevents repeated full explanations ────────

describe("session memory — insightsGiven Set on createCtx()", () => {
  it("fresh ctx has an empty insightsGiven Set", () => {
    const ctx = createCtx();
    expect(ctx.insightsGiven).toBeInstanceOf(Set);
    expect(ctx.insightsGiven.size).toBe(0);
  });

  it("adding a key marks it as seen", () => {
    const ctx = createCtx();
    ctx.insightsGiven.add("luteal_mood");
    expect(ctx.insightsGiven.has("luteal_mood")).toBe(true);
    expect(ctx.insightsGiven.has("luteal_fatigue")).toBe(false);
  });

  it("two sessions have independent insightsGiven Sets", () => {
    const ctx1 = createCtx();
    const ctx2 = createCtx();
    ctx1.insightsGiven.add("menstrual_pain");
    expect(ctx2.insightsGiven.has("menstrual_pain")).toBe(false);
  });

  it("simulated repeat: first call would show full insight, second would be skipped", () => {
    const ctx = createCtx();
    const phase = "luteal", concern = "mood";
    const key = `${phase}_${concern}`;

    // First time: key not present → full insight should be shown
    expect(ctx.insightsGiven.has(key)).toBe(false);
    const fullInsight = getPhaseInsight(phase, concern);
    expect(fullInsight).not.toBeNull();
    ctx.insightsGiven.add(key);

    // Second time: key present → caller would return a brief "as mentioned" line instead
    expect(ctx.insightsGiven.has(key)).toBe(true);
  });

  it("cycleVariability starts as null", () => {
    const ctx = createCtx();
    expect(ctx.cycleVariability).toBeNull();
  });

  it("cycleVariability can be set to a number (simulating irregular cycles)", () => {
    const ctx = createCtx();
    ctx.cycleVariability = 8;  // >5 = low confidence
    expect(ctx.cycleVariability).toBe(8);
  });

  it("fresh ctx has currentTone, previousTone, and usedOpeners", () => {
    const ctx = createCtx();
    expect(ctx.currentTone).toBeNull();
    expect(ctx.previousTone).toBeNull();
    expect(ctx.usedOpeners).toBeInstanceOf(Set);
    expect(ctx.usedOpeners.size).toBe(0);
  });
});

// ─── NEW: getToneOpener — repetition control ──────────────────────────────────

describe("getToneOpener — opener repetition control", () => {
  it("with ctx, tracks used openers and avoids repeats", () => {
    const ctx = createCtx();
    const seen = new Set();
    // Call more times than pool size (6) — all first 6 should be distinct
    for (let i = 0; i < 6; i++) {
      const opener = getToneOpener("distressed", ctx);
      expect(opener.length).toBeGreaterThan(0);
      seen.add(opener);
    }
    // All 6 calls returned distinct openers (no repeats before pool exhausted)
    expect(seen.size).toBe(6);
  });

  it("without ctx, returns a string (backward-compatible)", () => {
    const opener = getToneOpener("distressed");
    expect(typeof opener).toBe("string");
    expect(opener.length).toBeGreaterThan(0);
  });

  it("neutral tone returns empty string", () => {
    expect(getToneOpener("neutral")).toBe("");
    expect(getToneOpener("neutral", createCtx())).toBe("");
  });

  it("after pool exhausted, resets and continues serving openers", () => {
    const ctx = createCtx();
    // Exhaust the exhausted pool (6 items)
    for (let i = 0; i < 6; i++) getToneOpener("exhausted", ctx);
    // 7th call should still return a non-empty opener (pool reset)
    const afterReset = getToneOpener("exhausted", ctx);
    expect(typeof afterReset).toBe("string");
    expect(afterReset.length).toBeGreaterThan(0);
  });
});

// ─── NEW: hasMedicalSeriousness — medical override guard ─────────────────────

describe("hasMedicalSeriousness — detects urgent medical content", () => {
  it("heavy bleeding message → true", () => {
    expect(hasMedicalSeriousness("I'm heavy bleeding and soaking through")).toBe(true);
  });

  it("fainting message → true", () => {
    expect(hasMedicalSeriousness("I nearly fainted from the pain")).toBe(true);
  });

  it("pregnancy concern message → true", () => {
    expect(hasMedicalSeriousness("I think I might be pregnant")).toBe(true);
  });

  it("severe pain message → true", () => {
    expect(hasMedicalSeriousness("the severe pain is on one side")).toBe(true);
  });

  it("casual period question → false", () => {
    expect(hasMedicalSeriousness("is it normal for my period to be late?")).toBe(false);
  });

  it("mood question → false", () => {
    expect(hasMedicalSeriousness("I've been feeling anxious lately")).toBe(false);
  });
});

// ─── NEW: medical seriousness override blocks casual opener ───────────────────

describe("getToneOpener — medical seriousness overrides casual opener", () => {
  it("casual tone + heavy bleeding text → empty string (no casual opener)", () => {
    const opener = getToneOpener("casual", null, "I'm soaking through and bleeding heavy");
    expect(opener).toBe("");
  });

  it("casual tone + casual text (no medical) → non-empty opener", () => {
    const opener = getToneOpener("casual", null, "lol what is going on with my cycle");
    expect(typeof opener).toBe("string");
    expect(opener.length).toBeGreaterThan(0);
  });

  it("distressed tone + medical text → uses calmest opener (not blocked)", () => {
    const opener = getToneOpener("distressed", null, "I'm soaking through my pads");
    expect(typeof opener).toBe("string");
    expect(opener.length).toBeGreaterThan(0);
  });

  it("with ctx and medical content, casual opener still blocked and ctx.usedOpeners updated for non-casual tones", () => {
    const ctx = createCtx();
    // Distressed + medically serious — should still return an opener and track it
    const opener = getToneOpener("distressed", ctx, "I passed out and I'm scared");
    expect(opener.length).toBeGreaterThan(0);
    expect(ctx.usedOpeners.size).toBe(1);
  });
});

// ─── NEW: buildGuidanceResponse — tone blending ───────────────────────────────

describe("buildGuidanceResponse — tone blending adjustments", () => {
  it("distressed tone adds grounding reassurance line before guidance", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { late: true } }),
      null, null, "distressed"
    );
    expect(res).not.toBeNull();
    // First line should be the reassurance, not the situation+meaning
    expect(res.lines[0]).toMatch(/right place|together|alone/i);
  });

  it("frustrated tone prefixes first guidance line with validating phrase", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { late: true } }),
      null, null, "frustrated"
    );
    expect(res).not.toBeNull();
    // The combined situation+meaning line should start with a validating phrase
    const guidanceLine = res.lines.find(l => /deserve|clear answers/i.test(l));
    expect(guidanceLine).toBeDefined();
  });

  it("exhausted tone uses 'When you have the energy' starter for next steps", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { late: true } }),
      null, null, "exhausted"
    );
    expect(res).not.toBeNull();
    const nextStepLine = res.lines.find(l => /when you have the energy/i.test(l));
    expect(nextStepLine).toBeDefined();
  });

  it("angry tone strips exclamation marks from all lines", () => {
    const res = buildGuidanceResponse(
      entities({ symptoms: { late: true } }),
      null, null, "angry"
    );
    expect(res).not.toBeNull();
    for (const line of res.lines) {
      expect(line).not.toContain("!");
    }
  });

  it("tone blending does NOT apply to urgent/safety scenarios", () => {
    const res = buildGuidanceResponse(
      entities({ urgent: true }),
      "urgency_flag", null, "distressed"
    );
    expect(res).not.toBeNull();
    expect(res.scenario).toBe("urgent");
    // Safety node — no reassurance prefix injected before the main content
    // (lines[0] should be the situation line, not a separate reassurance)
    expect(res.lines[0]).not.toMatch(/right place.*we'll work through/i);
  });

  it("null tone produces standard response (backward-compatible)", () => {
    const res = buildGuidanceResponse(entities({ symptoms: { late: true } }));
    expect(res).not.toBeNull();
    expect(res.lines.length).toBeGreaterThanOrEqual(3);
  });
});
