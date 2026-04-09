import { describe, it, expect } from "vitest";
import { extractEntities } from "../bloomie-inference.js";
import {
  ALLOWED_INTERPRETATION_KEYS,
  buildSignalBoard,
  scoreInterpretationBoard,
  scoreInterpretations,
  selectResponseStrategy,
} from "../bloomie-reasoning.js";

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
  it("late + cramps -> late_plus_cramps assistive interpretation", () => {
    const { decision } = runReasoning("my period is late and i have cramps", { overdueDays: -4 });
    expect(decision.interpretation).toBe("late_plus_cramps");
    expect(decision.strategy).toBe("defer");
  });

  it("late + nausea + breast tenderness -> late_plus_pregnancy_signs", () => {
    const { decision } = runReasoning("my period late, nausea and my boobs sore", { overdueDays: -7 });
    expect(decision.interpretation).toBe("pregnancy_signal_cluster");
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
    expect(
      new Set(["irregular_cycle_pattern", "possible_perimenopause_pattern"]).has(decision.interpretation)
    ).toBe(true);
  });

  it("true unrelated input -> defer (lets OOS handle)", () => {
    const { decision } = runReasoning("what is the football score tonight");
    expect(decision.strategy).toBe("defer");
  });

  it("returns structured interpretation scorecard with allowlisted keys only", () => {
    const entities = extractEntities("my period late and i have cramps plus nausea");
    const board = buildSignalBoard({
      text: "my period late and i have cramps plus nausea",
      entities,
      tags: ["late_period", "cramps", "nausea"],
      repair: null,
      ctx: { state: "START", lastIntent: null, conversationProfile: { concernsUnresolved: [] }, nodeHistory: [] },
      userMode: { isPregnancy: false, isTTC: false, isPostpartum: false, isCycleTracking: true },
      overdueDays: -6,
      bloomieMemory: {},
    });
    const scorecard = scoreInterpretationBoard(board);
    expect(scorecard.topInterpretation).toBeTruthy();
    expect(scorecard.confidence).toBeGreaterThan(0);
    expect(scorecard.confidence).toBeLessThanOrEqual(1);
    for (const item of scorecard.interpretations) {
      expect(ALLOWED_INTERPRETATION_KEYS.has(item.key)).toBe(true);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      expect(Array.isArray(item.reasons)).toBe(true);
    }
  });

  it("mid-cycle one-sided pain + spotting -> ovulation_pattern route", () => {
    const { decision } = runReasoning("mid cycle one-sided pain and light spotting");
    expect(decision.interpretation).toBe("ovulation_pattern");
    expect(decision.next).toBe("PELVIC_OVULATION_ROUTE");
  });

  it("before-period mood+bloating+breast tenderness -> luteal_pattern route", () => {
    const { decision } = runReasoning("before my period i get mood swings, bloating and breasts sore");
    expect(decision.interpretation).toBe("luteal_pattern");
    expect(decision.next).toBe("MOOD_INTRO");
  });

  it("heavy bleeding over 8 days -> prolonged_bleeding route", () => {
    const { decision } = runReasoning("heavy bleeding for 8 days");
    expect(decision.interpretation).toBe("prolonged_bleeding");
    expect(decision.next).toBe("HEAVY_ROUTE_B");
  });

  it("late + stress cluster -> stress_related_delay route", () => {
    const { decision } = runReasoning("my period is late and i am stressed out");
    expect(decision.interpretation).toBe("stress_related_delay");
    expect(decision.next).toBe("LATE_NO_GUIDANCE");
  });

  it("explicit perimenopause mention + cluster -> possible_perimenopause_pattern", () => {
    const { decision } = runReasoning("i think perimenopause, my periods are irregular, hot flashes and i cant sleep");
    expect(decision.interpretation).toBe("possible_perimenopause_pattern");
    expect(decision.next).toBe("PERIMENOPAUSE_INTRO");
  });
});
