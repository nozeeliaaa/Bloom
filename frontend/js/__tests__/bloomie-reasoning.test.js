import { describe, it, expect } from "vitest";
import { extractEntities } from "../bloomie-inference.js";
import { buildSignalBoard, scoreInterpretations, selectResponseStrategy } from "../bloomie-reasoning.js";

function runReasoning(text, { overdueDays = null, ctx = {}, userMode = {}, bloomieMemory = {} } = {}) {
  const entities = extractEntities(text);
  const board = buildSignalBoard({
    text,
    entities,
    ctx: {
      state: "START",
      lastIntent: null,
      conversationProfile: { concernsUnresolved: [] },
      nodeHistory: [],
      ...ctx,
    },
    userMode: {
      isPregnancy: false,
      isTTC: false,
      isPostpartum: false,
      isCycleTracking: true,
      ...userMode,
    },
    overdueDays,
    bloomieMemory,
  });
  const interpretations = scoreInterpretations(board);
  const decision = selectResponseStrategy(board, interpretations);
  return { board, interpretations, decision };
}

describe("bloomie reasoning layer", () => {
  it("late + cramps -> late_plus_cramps triage", () => {
    const { decision } = runReasoning("my period is late and i have cramps", { overdueDays: -4 });
    expect(decision.interpretation).toBe("late_plus_cramps");
    expect(decision.strategy).toBe("triage");
    expect(decision.next).toBe("LATE_INTRO");
  });

  it("late + nausea + breast tenderness -> late_plus_pregnancy_signs", () => {
    const { decision } = runReasoning("my period late, nausea and my boobs sore", { overdueDays: -7 });
    expect(decision.interpretation).toBe("late_plus_pregnancy_signs");
    expect(decision.next).toBe("LATE_TEST_Q");
  });

  it("kmt what -> clarification repair", () => {
    const { decision } = runReasoning("kmt what?", { overdueDays: -16 });
    expect(decision.strategy).toBe("repair");
    expect(decision.interpretation).toBe("clarification_needed");
    expect(decision.reply.join(" ")).toMatch(/more simply|later than expected/i);
  });

  it("me nuh understand -> clarification repair", () => {
    const { decision } = runReasoning("me nuh understand");
    expect(decision.strategy).toBe("repair");
    expect(decision.interpretation).toBe("clarification_needed");
  });

  it("heavy bleeding + clots + dizziness -> safety redirect", () => {
    const { decision } = runReasoning("heavy bleeding with large clots and i feel dizzy");
    expect(decision.strategy).toBe("safety_redirect");
    expect(decision.next).toBe("HEAVY_URGENT");
  });

  it("irregular periods + hot flashes + sleep issues -> peri cluster", () => {
    const { decision } = runReasoning("my periods are irregular, hot flashes, and i can't sleep");
    expect(decision.interpretation).toBe("peri_cluster");
    expect(decision.next).toBe("PERIMENOPAUSE_INTRO");
  });

  it("true unrelated input -> defer (lets OOS handle)", () => {
    const { decision } = runReasoning("what is the football score tonight");
    expect(decision.strategy).toBe("defer");
  });
});
