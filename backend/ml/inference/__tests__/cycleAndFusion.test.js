import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeCyclePhaseML } from "../cyclePhaseEngine.js";
import { phaseFusionEngine } from "../phaseFusionEngine.js";
import {
  deriveCycleLengths,
  getConfidenceLevel,
  trainLinearRegression,
  trainWeightedLinearRegression,
} from "../../../../algorithms/cyclePredictor.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function periodDay(flow = "medium") {
  return { flow };
}

function logsFromStarts(starts, duration = 1, flow = "medium") {
  const logs = {};
  for (const start of starts) {
    for (let i = 0; i < duration; i += 1) {
      logs[addDays(start, i)] = periodDay(flow);
    }
  }
  return logs;
}

function expectFiniteRegression(result) {
  expect(Number.isFinite(result.slope)).toBe(true);
  expect(Number.isFinite(result.intercept)).toBe(true);
  expect(Number.isFinite(result.cycleCount)).toBe(true);
}

describe("computeCyclePhaseML", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unknown phase for no period logs", () => {
    const result = computeCyclePhaseML({});

    expect(result.phase).toBe("unknown");
    expect(result.usingML).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("uses a 28-day fallback for one cycle with no ML prediction", () => {
    const result = computeCyclePhaseML(logsFromStarts(["2026-04-01"]));

    expect(result.usingML).toBe(false);
    expect(result.nextPeriodDate).toBe("2026-04-29");
    expect(result.confidence).toBe("low");
  });

  it("uses an in-range ML prediction for one logged cycle", () => {
    const result = computeCyclePhaseML(logsFromStarts(["2026-04-01"]), 31);

    expect(result.usingML).toBe(true);
    expect(result.mlPredictedCycleLength).toBe(31);
    expect(result.nextPeriodDate).toBe("2026-05-02");
  });

  it("rejects one-cycle ML prediction above 45 days", () => {
    const result = computeCyclePhaseML(logsFromStarts(["2026-04-01"]), 50);

    expect(result.usingML).toBe(false);
    expect(result.mlPredictedCycleLength).toBeNull();
    expect(result.nextPeriodDate).toBe("2026-04-29");
  });

  it("rejects one-cycle ML prediction below 21 days", () => {
    const result = computeCyclePhaseML(logsFromStarts(["2026-04-01"]), 15);

    expect(result.usingML).toBe(false);
    expect(result.mlPredictedCycleLength).toBeNull();
    expect(result.nextPeriodDate).toBe("2026-04-29");
  });

  it("computes average cycle length for two cycles and returns medium confidence", () => {
    const result = computeCyclePhaseML(logsFromStarts(["2026-02-01", "2026-03-01"]));

    expect(result.avgCycleLength).toBe(28);
    expect(result.confidence).toBe("medium");
  });

  it("returns high confidence for four stable cycles", () => {
    const result = computeCyclePhaseML(
      logsFromStarts(["2026-01-01", "2026-01-29", "2026-02-26", "2026-03-26"])
    );

    expect(result.avgCycleLength).toBe(28);
    expect(result.confidence).toBe("high");
  });

  it("does not mark ML as used when it exactly matches the average cycle length", () => {
    const result = computeCyclePhaseML(
      logsFromStarts(["2026-01-01", "2026-01-29", "2026-02-26"]),
      28
    );

    expect(result.avgCycleLength).toBe(28);
    expect(result.usingML).toBe(false);
    expect(result.mlPredictedCycleLength).toBeNull();
  });

  it("treats active bleeding today as menstrual", () => {
    const result = computeCyclePhaseML({
      ...logsFromStarts(["2026-03-01"]),
      "2026-04-15": periodDay("heavy"),
    });

    expect(result.phase).toBe("menstrual");
    expect(result.cycleStarts.at(-1)).toBe("2026-04-15");
  });

  it("computes irregular cycle intervals from all logged starts", () => {
    const starts = ["2026-01-01", "2026-01-22", "2026-03-01", "2026-03-26"];
    const result = computeCyclePhaseML(logsFromStarts(starts));

    expect(result.avgCycleLength).toBe(28);
    expect(result.cycleStarts).toEqual(starts);
    expect(["low", "medium", "high"]).toContain(result.confidence);
  });

  it("allows an in-range ML prediction to override a widely varying average", () => {
    const starts = ["2026-01-01", "2026-01-20", "2026-03-03", "2026-03-31"];
    const result = computeCyclePhaseML(logsFromStarts(starts), 30);

    expect(result.avgCycleLength).toBe(30);
    expect(result.usingML).toBe(false);

    const override = computeCyclePhaseML(logsFromStarts(starts), 32);
    expect(override.avgCycleLength).toBe(30);
    expect(override.usingML).toBe(true);
    expect(override.mlPredictedCycleLength).toBe(32);
  });

  it("keeps heavy flow today as menstrual priority over any future phase math", () => {
    const result = computeCyclePhaseML({
      ...logsFromStarts(["2026-01-01", "2026-01-29", "2026-02-26"]),
      "2026-04-15": periodDay("heavy"),
    });

    expect(result.phase).toBe("menstrual");
    expect(result.phaseLabel).toBe("Menstrual");
  });

  const generatedBoundaryCases = [];
  for (const start of ["2026-03-01", "2026-03-05", "2026-03-10", "2026-03-15"]) {
    for (const mlLength of [21, 24, 28, 31, 35]) {
      for (const duration of [1, 2, 5, 7]) {
        generatedBoundaryCases.push({ start, mlLength, duration });
      }
    }
  }

  generatedBoundaryCases.slice(0, 80).forEach(({ start, mlLength, duration }, index) => {
    it(`generated one-cycle boundary case ${index + 1}: start=${start}, ml=${mlLength}, duration=${duration}`, () => {
      const result = computeCyclePhaseML(logsFromStarts([start], duration), mlLength);

      expect(result.cycleStarts).toEqual([start]);
      expect(result.usingML).toBe(true);
      expect(result.nextPeriodDate).toBe(addDays(start, mlLength));
      expect(result.predictedPeriodDays.length).toBeGreaterThanOrEqual(3);
      expect(result.confidence).toBe("low");
    });
  });

  const generatedAverageCases = Array.from({ length: 50 }, (_, index) => {
    const length = 23 + (index % 13);
    const start = addDays("2025-12-01", index % 9);
    return {
      starts: [start, addDays(start, length), addDays(start, length * 2)],
      length,
      mlLength: index % 2 === 0 ? length : length + 1,
    };
  });

  generatedAverageCases.forEach(({ starts, length, mlLength }, index) => {
    it(`generated average case ${index + 1}: length=${length}, ml=${mlLength}`, () => {
      const result = computeCyclePhaseML(logsFromStarts(starts), mlLength);

      expect(result.cycleStarts).toEqual(starts);
      expect(result.avgCycleLength).toBe(length);
      expect(result.usingML).toBe(mlLength !== length);
      expect(result.nextPeriodDate).toBe(addDays(starts.at(-1), mlLength));
      expect(["low", "medium", "high"]).toContain(result.confidence);
    });
  });

  const generatedIrregularCases = Array.from({ length: 40 }, (_, index) => {
    const a = 19 + (index % 8);
    const b = 28 + (index % 11);
    const c = 35 - (index % 7);
    const start = "2025-11-01";
    const starts = [start, addDays(start, a), addDays(start, a + b), addDays(start, a + b + c)];
    const avg = Math.round((a + b + c) / 3);
    const mlLength = Math.max(21, Math.min(45, avg + (index % 3 === 0 ? 2 : -1)));
    return { starts, avg, mlLength };
  });

  generatedIrregularCases.forEach(({ starts, avg, mlLength }, index) => {
    it(`generated irregular case ${index + 1}: avg=${avg}, ml=${mlLength}`, () => {
      const result = computeCyclePhaseML(logsFromStarts(starts), mlLength);

      expect(result.avgCycleLength).toBe(avg);
      expect(result.cycleStarts).toEqual(starts);
      expect(result.usingML).toBe(mlLength !== avg);
      expect(Number.isInteger(result.dayInCycle)).toBe(true);
      expect(result.predictedPeriodDays.length).toBeGreaterThan(0);
    });
  });
});

describe("phaseFusionEngine", () => {
  const baseModel = {
    probabilities: {
      Menstrual: 0.1,
      Follicular: 0.55,
      Ovulation: 0.2,
      Luteal: 0.15,
    },
  };

  it("keeps the highest raw probability when no rules apply", () => {
    const result = phaseFusionEngine({
      modelOutput: baseModel,
      userInput: { day_in_study: 8, cramps: 0, moodswing: 0, foodcravings: 0 },
    });

    expect(result.finalPhase).toBe("Follicular");
  });

  it("boosts Menstrual when cramps are at least 3", () => {
    const result = phaseFusionEngine({
      modelOutput: { probabilities: { Menstrual: 0.3, Follicular: 0.25, Ovulation: 0.2, Luteal: 0.25 } },
      userInput: { day_in_study: 8, cramps: 3 },
    });

    expect(result.finalPhase).toBe("Menstrual");
    expect(result.scores.Menstrual).toBeCloseTo(0.5 / 1.2);
  });

  it("does not boost Menstrual when cramps are below 3", () => {
    const result = phaseFusionEngine({
      modelOutput: baseModel,
      userInput: { day_in_study: 8, cramps: 2 },
    });

    expect(result.scores.Menstrual).toBeCloseTo(0.1);
  });

  it("boosts Menstrual on day 3", () => {
    const result = phaseFusionEngine({
      modelOutput: { probabilities: { Menstrual: 0.3, Follicular: 0.25, Ovulation: 0.2, Luteal: 0.25 } },
      userInput: { day_in_study: 3 },
    });

    expect(result.finalPhase).toBe("Menstrual");
  });

  it("boosts Ovulation on day 14", () => {
    const result = phaseFusionEngine({
      modelOutput: { probabilities: { Menstrual: 0.2, Follicular: 0.2, Ovulation: 0.3, Luteal: 0.3 } },
      userInput: { day_in_study: 14 },
    });

    expect(result.finalPhase).toBe("Ovulation");
    expect(result.scores.Ovulation).toBeCloseTo(0.6 / 1.3);
  });

  it("boosts Luteal only when mood and cravings are both at least 3", () => {
    const result = phaseFusionEngine({
      modelOutput: { probabilities: { Menstrual: 0.2, Follicular: 0.2, Ovulation: 0.2, Luteal: 0.4 } },
      userInput: { day_in_study: 9, moodswing: 3, foodcravings: 3 },
    });

    expect(result.finalPhase).toBe("Luteal");
    expect(result.scores.Luteal).toBeCloseTo(0.6 / 1.2);
  });

  it("does not boost Luteal when cravings are below 3", () => {
    const result = phaseFusionEngine({
      modelOutput: baseModel,
      userInput: { day_in_study: 9, moodswing: 3, foodcravings: 2 },
    });

    expect(result.scores.Luteal).toBeCloseTo(0.15);
  });

  it("normalizes all scores to sum to 1", () => {
    const result = phaseFusionEngine({
      modelOutput: baseModel,
      userInput: { day_in_study: 14, cramps: 5, moodswing: 3, foodcravings: 3 },
    });

    const total = Object.values(result.scores).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1);
  });

  it("applies +0.4 Menstrual support when cramps and day 1-5 both match", () => {
    const result = phaseFusionEngine({
      modelOutput: { probabilities: { Menstrual: 0.2, Follicular: 0.3, Ovulation: 0.25, Luteal: 0.25 } },
      userInput: { day_in_study: 4, cramps: 5 },
    });

    expect(result.scores.Menstrual).toBeCloseTo(0.6 / 1.4);
  });

  it("handles irregular symptom input with cramps on ovulation day and lets Ovulation win", () => {
    const result = phaseFusionEngine({
      modelOutput: { probabilities: { Menstrual: 0.2, Follicular: 0.2, Ovulation: 0.35, Luteal: 0.25 } },
      userInput: { day_in_study: 14, cramps: 5 },
    });

    expect(result.scores.Menstrual).toBeCloseTo(0.4 / 1.5);
    expect(result.scores.Ovulation).toBeCloseTo(0.65 / 1.5);
    expect(result.finalPhase).toBe("Ovulation");
  });

  it("sets confidence to the normalized winning score", () => {
    const result = phaseFusionEngine({
      modelOutput: baseModel,
      userInput: { day_in_study: 14 },
    });

    expect(result.confidence).toBeCloseTo(result.scores[result.finalPhase]);
  });

  it("defaults missing userInput fields to 0", () => {
    const result = phaseFusionEngine({
      modelOutput: baseModel,
      userInput: {},
    });

    expect(result.finalPhase).toBe("Follicular");
    expect(result.confidence).toBeCloseTo(0.55);
  });

  const generatedFusionCases = Array.from({ length: 40 }, (_, index) => {
    const day = (index % 28) + 1;
    const cramps = index % 3 === 0 ? 4 : 1;
    const moodswing = index % 4 === 0 ? 4 : 1;
    const foodcravings = index % 5 === 0 ? 4 : 1;
    const probabilities = {
      Menstrual: 0.2 + ((index % 2) * 0.05),
      Follicular: 0.25,
      Ovulation: 0.25 + ((index % 3) * 0.03),
      Luteal: 0.2,
    };
    const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
    Object.keys(probabilities).forEach((key) => {
      probabilities[key] = probabilities[key] / total;
    });
    return { day, cramps, moodswing, foodcravings, probabilities };
  });

  generatedFusionCases.forEach(({ day, cramps, moodswing, foodcravings, probabilities }, index) => {
    it(`generated fusion normalization case ${index + 1}: day=${day}`, () => {
      const result = phaseFusionEngine({
        modelOutput: { probabilities },
        userInput: { day_in_study: day, cramps, moodswing, foodcravings },
      });

      const total = Object.values(result.scores).reduce((sum, value) => sum + value, 0);
      const maxScore = Math.max(...Object.values(result.scores));

      expect(total).toBeCloseTo(1);
      expect(result.confidence).toBeCloseTo(maxScore);
      expect(result.scores[result.finalPhase]).toBeCloseTo(maxScore);
    });
  });
});

describe("cyclePredictor helpers", () => {
  it("deriveCycleLengths returns [] with fewer than two dates", () => {
    expect(deriveCycleLengths(["2026-01-01"])).toEqual([]);
  });

  it("deriveCycleLengths sorts unsorted dates before computing intervals", () => {
    expect(deriveCycleLengths(["2026-02-26", "2026-01-01", "2026-01-29"])).toEqual([28, 28]);
  });

  it("deriveCycleLengths filters invalid date strings", () => {
    expect(deriveCycleLengths(["2026-01-01", "not-a-date", "2026-01-29"])).toEqual([28]);
  });

  it("deriveCycleLengths returns normal day intervals", () => {
    expect(deriveCycleLengths(["2026-01-01", "2026-01-30", "2026-02-27"])).toEqual([29, 28]);
  });

  it("deriveCycleLengths keeps irregular but positive intervals", () => {
    expect(deriveCycleLengths(["2026-01-01", "2026-01-10", "2026-03-01"])).toEqual([9, 50]);
  });

  it("getConfidenceLevel returns High for regular cycles", () => {
    const result = getConfidenceLevel([28, 28, 28, 28]);

    expect(result.level).toBe("High");
    expect(result.stdDev).toBe(0);
    expect(result.windowDays).toBe(0);
  });

  it("getConfidenceLevel returns Medium for slightly variable cycles", () => {
    const result = getConfidenceLevel([25, 28, 31, 30]);

    expect(result.level).toBe("Medium");
    expect(result.windowDays).toBe(2);
  });

  it("getConfidenceLevel returns Low for irregular cycles", () => {
    const result = getConfidenceLevel([21, 35, 28, 42, 19]);

    expect(result.level).toBe("Low");
    expect(result.windowDays).toBe(5);
    expect(result.stdDev).toBeGreaterThan(4);
  });

  it("getConfidenceLevel returns Low for highly irregular cycles", () => {
    const result = getConfidenceLevel([18, 45, 22, 40, 25]);

    expect(result.level).toBe("Low");
    expect(result.stdDev).toBeGreaterThan(4);
  });

  it("getConfidenceLevel returns Low with null stdDev for empty input", () => {
    const result = getConfidenceLevel([]);

    expect(result.level).toBe("Low");
    expect(result.stdDev).toBeNull();
    expect(result.windowDays).toBe(5);
  });

  it("trainLinearRegression throws with fewer than three cycle lengths", () => {
    expect(() => trainLinearRegression([28, 29])).toThrow(/at least 3/i);
  });

  it("trainLinearRegression returns finite slope and intercept", () => {
    const result = trainLinearRegression([28, 29, 27]);

    expectFiniteRegression(result);
    expect(result.cycleCount).toBe(3);
  });

  it("trainWeightedLinearRegression returns finite values for irregular cycles", () => {
    const result = trainWeightedLinearRegression([21, 42, 19, 38], "linear");

    expectFiniteRegression(result);
    expect(result.cycleCount).toBe(4);
    expect(result.weights).toEqual([1, 2, 3, 4]);
    expect(result.weightMode).toBe("linear");
  });

  it("trainWeightedLinearRegression supports exponential weighting", () => {
    const result = trainWeightedLinearRegression([28, 29, 31, 30], "exponential");

    expectFiniteRegression(result);
    expect(result.weightMode).toBe("exponential");
    expect(result.weights).toHaveLength(4);
  });

  it("produces a finite next-cycle prediction from irregular regression output", () => {
    const result = trainWeightedLinearRegression([45, 18, 38, 22, 30], "linear");
    const prediction = result.slope * (result.cycleCount + 1) + result.intercept;

    expect(Number.isFinite(prediction)).toBe(true);
    expect(prediction).toBeGreaterThan(-20);
    expect(prediction).toBeLessThan(80);
  });

  const generatedPredictorCases = [
    [28, 28, 29, 27],
    [21, 35, 28, 42],
    [45, 18, 38, 22, 30],
    [25, 27, 31, 33, 29],
    [35, 34, 33, 32, 31],
    [22, 25, 29, 34, 35],
    [19, 42, 28, 31, 24],
    [30, 30, 30, 31, 29],
  ];

  generatedPredictorCases.forEach((cycles, index) => {
    it(`generated predictor linear regression case ${index + 1}`, () => {
      const result = trainLinearRegression(cycles);
      const prediction = result.slope * (result.cycleCount + 1) + result.intercept;

      expectFiniteRegression(result);
      expect(Number.isFinite(prediction)).toBe(true);
    });
  });

  generatedPredictorCases.forEach((cycles, index) => {
    it(`generated predictor weighted regression case ${index + 1}`, () => {
      const result = trainWeightedLinearRegression(cycles, index % 2 === 0 ? "linear" : "exponential");
      const confidence = getConfidenceLevel(cycles);

      expectFiniteRegression(result);
      expect(result.weights).toHaveLength(cycles.length);
      expect(["High", "Medium", "Low"]).toContain(confidence.level);
    });
  });

  Array.from({ length: 10 }, (_, index) => {
    const start = addDays("2026-01-01", index);
    return [start, addDays(start, 24 + index), addDays(start, 52 + index), addDays(start, 81 + index)];
  }).forEach((dates, index) => {
    it(`generated deriveCycleLengths range case ${index + 1}`, () => {
      const lengths = deriveCycleLengths(dates);
      const confidence = getConfidenceLevel(lengths);

      expect(lengths).toHaveLength(3);
      expect(lengths.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
      expect(["High", "Medium", "Low"]).toContain(confidence.level);
    });
  });
});
