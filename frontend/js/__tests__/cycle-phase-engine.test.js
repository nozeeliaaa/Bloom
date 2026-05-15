import { describe, expect, it } from "vitest";

import {
  determineCurrentCyclePhase,
} from "../../../backend/ml/inference/cyclePhaseEngine.js";

describe("determineCurrentCyclePhase", () => {
  it("keeps menstrual phase through the average period duration without daily logs", () => {
    const inputs = {
      lastPeriodStart: "2026-05-01",
      averageCycleLength: 28,
      averagePeriodDuration: 5,
    };

    expect(determineCurrentCyclePhase({ ...inputs, today: "2026-05-01" }).phase).toBe("menstrual");
    expect(determineCurrentCyclePhase({ ...inputs, today: "2026-05-05" }).phase).toBe("menstrual");
    expect(determineCurrentCyclePhase({ ...inputs, today: "2026-05-06" }).phase).toBe("follicular");
  });

  it("uses the 5-day fallback for new users with no duration history", () => {
    const result = determineCurrentCyclePhase({
      lastPeriodStart: "2026-05-01",
      averageCycleLength: 28,
      averagePeriodDuration: null,
      today: "2026-05-05",
    });

    expect(result.phase).toBe("menstrual");
    expect(result.dayInCycle).toBe(5);
  });
});
