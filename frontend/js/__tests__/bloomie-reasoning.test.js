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

  // ── Fix 1: fever + discharge/pain ─────────────────────────────────────────

  it("fever + unusual discharge -> fever_with_discharge_or_pain triage", () => {
    const { decision } = runReasoning("i have a fever and some unusual discharge");
    expect(decision.interpretation).toBe("fever_with_discharge_or_pain");
    expect(decision.strategy).toBe("triage");
    expect(decision.next).toBe("ELSE_DISCHARGE_ENTRY");
  });

  it("fever + pelvic pain -> fever_with_discharge_or_pain triage", () => {
    const { decision } = runReasoning("running a fever and having pelvic pain");
    expect(decision.interpretation).toBe("fever_with_discharge_or_pain");
    expect(decision.strategy).toBe("triage");
    expect(decision.next).toBe("ELSE_DISCHARGE_ENTRY");
  });

  it("fever alone (no discharge or pain) -> does not trigger fever rule", () => {
    const { decision } = runReasoning("i have a fever");
    expect(decision.interpretation).not.toBe("fever_with_discharge_or_pain");
  });

  // ── Fix 3: bleeding after sex ─────────────────────────────────────────────

  it("bleeding after sex -> bleeding_after_sex clarify route to SPOT_INTRO", () => {
    const { decision } = runReasoning("i was bleeding after sex");
    expect(decision.interpretation).toBe("bleeding_after_sex");
    expect(decision.strategy).toBe("clarify");
    expect(decision.next).toBe("SPOT_INTRO");
    expect(decision.payload?.postSex).toBe(true);
  });

  it("spotting after intercourse -> bleeding_after_sex", () => {
    const { decision } = runReasoning("i had some spotting after intercourse");
    expect(decision.interpretation).toBe("bleeding_after_sex");
  });

  // ── Fix 4: severe unmanaged pain ──────────────────────────────────────────

  it("unbearable cramps -> severe_unmanaged_pain triage", () => {
    const { decision } = runReasoning("unbearable cramps, the pain is not going away");
    expect(decision.interpretation).toBe("severe_unmanaged_pain");
    expect(decision.strategy).toBe("triage");
    expect(decision.next).toBe("HEAVY_ROUTE_C");
  });

  it("ibuprofen didn't help with cramps -> severe_unmanaged_pain", () => {
    const { decision } = runReasoning("ibuprofen didn't help, my cramps are really bad");
    expect(decision.interpretation).toBe("severe_unmanaged_pain");
  });

  it("heavy bleeding + severe pain -> heavy_bleeding_red_flag wins over severe_unmanaged_pain", () => {
    const { decision } = runReasoning("heavy bleeding and unbearable pain");
    expect(decision.interpretation).toBe("heavy_bleeding_red_flag");
  });

  // ── Fix 5: perimenopause partial cluster ──────────────────────────────────

  it("irregular cycles + hot flashes (no sleep/mood) -> possible_perimenopause_pattern", () => {
    const { decision } = runReasoning("my periods are irregular and i keep getting hot flashes");
    expect(decision.interpretation).toBe("possible_perimenopause_pattern");
    expect(decision.next).toBe("PERIMENOPAUSE_INTRO");
  });

  it("irregular cycles + cant sleep (no vasomotor) -> possible_perimenopause_pattern", () => {
    const { decision } = runReasoning("my cycle is irregular and i cant sleep properly");
    expect(decision.interpretation).toBe("possible_perimenopause_pattern");
    expect(decision.next).toBe("PERIMENOPAUSE_INTRO");
  });

  // ── Fix 6: foul discharge without itching ────────────────────────────────

  it("foul-smelling discharge alone -> foul_discharge_alone route to ELSE_DISCHARGE_ENTRY", () => {
    const { decision } = runReasoning("my discharge has a foul smell");
    expect(decision.interpretation).toBe("foul_discharge_alone");
    expect(decision.next).toBe("ELSE_DISCHARGE_ENTRY");
  });

  it("fishy discharge (no itching) -> foul_discharge_alone", () => {
    const { decision } = runReasoning("i have fishy discharge");
    expect(decision.interpretation).toBe("foul_discharge_alone");
  });
});
