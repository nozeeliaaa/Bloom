/**
 * mockCycle.js - Frontend-only mock cycle data (no calculations).
 * Use this when you need the UI to show a cycle phase / predictions
 * without doing algorithmic prediction work.
 */
import { toDateKey } from "./utils.js";

/**
 * Returns demo cycle data in the same shape as computeCyclePhase().
 * Dates are strings in YYYY-MM-DD format.
 */
export function getMockCycleData() {
  const today = new Date();
  const todayKey = toDateKey(today);

  // Demo values (feel free to tweak)
  // Next period: 7 days from today, predicted window = nextPeriod..nextPeriod+4
  const nextPeriod = new Date(today);
  nextPeriod.setDate(nextPeriod.getDate() + 7);

  const predictedPeriodDays = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(nextPeriod);
    d.setDate(d.getDate() + i);
    predictedPeriodDays.push(toDateKey(d));
  }

  // Fertile window: 10-5 days from today (demo)
  const fertileStart = new Date(today);
  fertileStart.setDate(fertileStart.getDate() + 10);
  const fertileEnd = new Date(today);
  fertileEnd.setDate(fertileEnd.getDate() + 15);

  const ovulationDate = new Date(today);
  ovulationDate.setDate(ovulationDate.getDate() + 13);

  return {
    phase: "unknown",
    phaseLabel: "Demo",
    dayInCycle: null,
    avgCycleLength: 28,
    confidence: "low",
    message: "Demo cycle data (frontend-only).",
    cycleStarts: [],
    nextPeriodDate: toDateKey(nextPeriod),
    ovulationDate: toDateKey(ovulationDate),
    fertileStart: toDateKey(fertileStart),
    fertileEnd: toDateKey(fertileEnd),
    predictedPeriodDays
  };
}
