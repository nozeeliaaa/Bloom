import { describe, it, expect } from "vitest";
import {
  buildEmotionalFollowUp,
  getFollowUpKey,
  buildFollowUpQuestion,
  buildMiniReplay,
  buildSoftContinuePrompt,
  buildTinyWinLine,
  composeResponseLayers,
  detectReasoningSpiral,
  detectTinyWin,
  maybeBuildRealityCheckPrefix,
  normalizeDisplayText,
  shouldAskFollowUp,
  shouldUseMiniReplay,
  softenEscalationLine,
} from "../bloomie-response-layers.js";

function makeContext(overrides = {}) {
  return {
    text: overrides.text || "",
    normalizedText: overrides.normalizedText || String(overrides.text || "").toLowerCase(),
    tone: overrides.tone || "neutral",
    inferredReason: overrides.inferredReason || null,
    inferredNext: overrides.inferredNext || null,
    lastIntent: overrides.lastIntent || null,
    sessionDepth: overrides.sessionDepth ?? 1,
    isShortFollowUp: overrides.isShortFollowUp ?? false,
    hasPendingClarifier: overrides.hasPendingClarifier ?? false,
    askedFollowUpKeys: overrides.askedFollowUpKeys ?? new Set(),
    primaryFocusApplied: overrides.primaryFocusApplied ?? false,
    entities: {
      symptoms: {
        late: false,
        implicit_late: false,
        spotting: false,
        pelvic: false,
        discharge: false,
        ...overrides.symptoms,
      },
      severity: overrides.severity || null,
      timing: overrides.timing || null,
      pregnancy: overrides.pregnancy || { chance: false, testedYet: false, result: null },
      urgent: overrides.urgent || false,
    },
  };
}

describe("silent clue detection", () => {
  it("asks a follow-up for a short late-period statement with missing clues", () => {
    const ctx = makeContext({
      text: "mi period late",
      normalizedText: "mi period late",
      inferredReason: "late+short_duration",
      symptoms: { late: true },
    });
    expect(shouldAskFollowUp(ctx)).toBe(true);
    expect(buildFollowUpQuestion(ctx)).toMatch(/chance of pregnancy|stress|routine/i);
  });

  it("asks about severity and timing for cramps when context is thin", () => {
    const ctx = makeContext({
      text: "i have cramps",
      normalizedText: "i have cramps",
      inferredReason: "pelvic+mild",
      symptoms: { pelvic: true },
    });
    expect(buildFollowUpQuestion(ctx)).toMatch(/mild, moderate, or severe/i);
    expect(buildFollowUpQuestion(ctx)).toMatch(/bleeding|cycle/i);
  });

  it("asks amount and timing for brown spotting", () => {
    const ctx = makeContext({
      text: "brown spotting",
      normalizedText: "brown spotting",
      inferredReason: "spotting+mid_cycle",
      symptoms: { spotting: true },
    });
    expect(buildFollowUpQuestion(ctx)).toMatch(/light spotting|more like bleeding/i);
  });

  it("does not repeat the same generated follow-up once its key is tracked", () => {
    const base = makeContext({
      text: "mi period late",
      normalizedText: "mi period late",
      inferredReason: "late+short_duration",
      symptoms: { late: true },
    });
    const key = getFollowUpKey(base);
    const ctx = makeContext({
      text: "mi period late",
      normalizedText: "mi period late",
      inferredReason: "late+short_duration",
      symptoms: { late: true },
      askedFollowUpKeys: new Set([key]),
    });
    expect(shouldAskFollowUp(ctx)).toBe(false);
  });

  it("can ask one focused follow-up for a multi-symptom turn when primary focus is applied", () => {
    const ctx = makeContext({
      text: "clots and cramps",
      normalizedText: "clots and cramps",
      symptoms: { heavy: true, large_clots: true, pelvic: true },
      primaryFocusApplied: true,
    });
    expect(shouldAskFollowUp(ctx)).toBe(true);
    expect(buildFollowUpQuestion(ctx)).toMatch(/soaking through pads?|heavier than usual/i);
  });
});

describe("reality check layer", () => {
  it("detects pregnancy catastrophizing", () => {
    const spiral = detectReasoningSpiral(
      "every symptom me have must mean pregnancy",
      "every symptom me have must mean pregnancy",
      "anxious",
      "pregnancy_concern"
    );
    expect(spiral).toBe("pregnancy_fear");
  });

  it("builds a balanced prefix for pregnancy fear", () => {
    const line = maybeBuildRealityCheckPrefix(makeContext({
      text: "every symptom me have must mean pregnancy",
      normalizedText: "every symptom me have must mean pregnancy",
      tone: "anxious",
      inferredReason: "pregnancy_concern",
    }));
    expect(line).toMatch(/mind would jump|feels scary/i);
    expect(line).toMatch(/overlap|does not settle/i);
  });
});

describe("mini replay", () => {
  it("triggers for short late follow-up", () => {
    const ctx = makeContext({
      text: "still no bleeding",
      normalizedText: "still no bleeding",
      sessionDepth: 2,
      symptoms: { late: true },
    });
    expect(shouldUseMiniReplay(ctx)).toBe(true);
    expect(buildMiniReplay(ctx)).toMatch(/period is late/i);
    expect(buildMiniReplay(ctx)).toMatch(/still no bleeding/i);
  });

  it("replays one-sided cramps naturally", () => {
    const ctx = makeContext({
      text: "on one side",
      normalizedText: "on one side",
      sessionDepth: 2,
      symptoms: { pelvic: true },
    });
    expect(buildMiniReplay(ctx)).toMatch(/cramps/i);
    expect(buildMiniReplay(ctx)).toMatch(/one-sided/i);
  });
});

describe("question behind the question + soft continue", () => {
  it("adds an emotional follow-up for worry-framed questions", () => {
    const line = buildEmotionalFollowUp(makeContext({
      text: "is brown blood bad?",
      normalizedText: "is brown blood bad?",
      inferredReason: "spotting+mid_cycle",
      symptoms: { spotting: true },
    }));
    expect(line).toMatch(/worrying|wrong|color|timing/i);
  });

  it("builds a warm continue prompt", () => {
    const line = buildSoftContinuePrompt(makeContext({
      inferredReason: "late+short_duration",
      symptoms: { late: true },
      sessionDepth: 2,
    }));
    expect(line).toMatch(/Before you go|If you want/i);
  });
});

describe("tiny wins and gentle warnings", () => {
  it("detects logging as a tiny win", () => {
    const type = detectTinyWin(makeContext({
      text: "i logged my symptoms",
      normalizedText: "i logged my symptoms",
    }));
    expect(type).toBe("symptom_logging");
    expect(buildTinyWinLine(type, "i logged my symptoms")).toMatch(/logging symptoms|symptom logs/i);
  });

  it("normalizes custom display text lightly", () => {
    expect(normalizeDisplayText('  "brown   blood"  ')).toBe("brown blood");
  });

  it("softens harsh escalation wording", () => {
    const line = softenEscalationLine("Please seek medical care as soon as possible 🩷");
    expect(line).toMatch(/good idea to get medical care soon/i);
  });
});

describe("response orchestration", () => {
  it("keeps a short layered response without stacking every helper", () => {
    const composed = composeResponseLayers(
      makeContext({
        text: "is brown blood bad?",
        normalizedText: "is brown blood bad?",
        inferredReason: "spotting+mid_cycle",
        sessionDepth: 2,
        symptoms: { spotting: true },
      }),
      {
        guidance: {
          scenario: "spotting_info",
          lines: ["Brown blood can happen when blood moves more slowly or is older."],
        },
        guidanceOpener: "I can help with that 🩷",
        secondaryAcknowledgement: "I'm also noting the cramps 🩷",
        patternLine: "I'm noticing this has come up more than once 🩷",
        alreadyShown: {
          tinyWins: new Set(),
          softContinue: false,
        },
      }
    );

    expect(composed.lines.length).toBeLessThanOrEqual(4);
    expect(composed.lines.join(" ")).toMatch(/brown blood|worr|cramps/i);
  });
});
