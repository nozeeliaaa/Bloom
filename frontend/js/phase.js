/**
 * phase.js - Cycle Phase Calculation Module
 *
 * Computes the current menstrual cycle phase based on logged period data.
 * Phases: Menstrual (days 1-5), Follicular (days 6-13),
 *         Ovulation (day 14), Luteal (days 15-28).
 *
 * Uses average cycle length derived from cycle start dates.
 * Returns low-confidence result when insufficient data is available.
 *
 * COMP3901: This is educational estimation only, not medical prediction.
 */

/**
 * Compute cycle analysis from all logs.
 * @param {Object} logs - All daily logs keyed by date string YYYY-MM-DD
 * @returns {Object} { phase, dayInCycle, avgCycleLength, confidence, cycleStarts, nextPeriodDate, ovulationDate, fertileStart, fertileEnd }
 */
export function computeCyclePhase(logs) {
  const entries = Object.entries(logs).sort(([a], [b]) => a.localeCompare(b));

  // Gather period days (flow != 'none') sorted ascending
  const periodDays = entries
    .filter(([, d]) => d.flow && d.flow !== 'none')
    .map(([date]) => date)
    .sort();

  // Identify distinct cycle starts (period day that is >3 days after previous period day)
  const cycleStarts = [];
  let prevDate = null;
  for (const day of periodDays) {
    if (!prevDate || daysBetween(prevDate, day) > 3) {
      cycleStarts.push(day);
    }
    prevDate = day;
  }

  // Not enough data
  if (cycleStarts.length < 2) {
    return {
      phase: 'unknown',
      phaseLabel: 'Unknown',
      dayInCycle: null,
      avgCycleLength: null,
      confidence: 'low',
      message: 'Not enough data. Log more period days to see your predicted phase.',
      cycleStarts,
      nextPeriodDate: null,
      ovulationDate: null,
      fertileStart: null,
      fertileEnd: null,
      predictedPeriodDays: []
    };
  }

  // Calculate average cycle length
  const lengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    lengths.push(daysBetween(cycleStarts[i - 1], cycleStarts[i]));
  }
  const avgCycleLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);

  // Calculate current day in cycle from last cycle start
  const lastStart = cycleStarts[cycleStarts.length - 1];
  const todayKey = toDateKey(new Date());
  const dayInCycle = daysBetween(lastStart, todayKey) + 1; // Day 1 = first period day

  // Determine phase based on day in cycle (using standard 28-day model scaled)
  const menstrualEnd = Math.round(avgCycleLength * 5 / 28);       // ~days 1-5
  const follicularEnd = Math.round(avgCycleLength * 13 / 28);     // ~days 6-13
  const ovulationDay = Math.round(avgCycleLength * 14 / 28);      // ~day 14
  const ovulationEnd = Math.round(avgCycleLength * 16 / 28);      // ~days 14-16

  let phase, phaseLabel;
  if (dayInCycle <= menstrualEnd) {
    phase = 'menstrual';
    phaseLabel = 'Menstrual';
  } else if (dayInCycle <= follicularEnd) {
    phase = 'follicular';
    phaseLabel = 'Follicular';
  } else if (dayInCycle <= ovulationEnd) {
    phase = 'ovulation';
    phaseLabel = 'Ovulation';
  } else if (dayInCycle <= avgCycleLength) {
    phase = 'luteal';
    phaseLabel = 'Luteal';
  } else {
    // Past expected cycle length - period may be late
    phase = 'luteal';
    phaseLabel = 'Late Luteal';
  }

  // Predicted next period date
  const nextPeriodDate = addDays(lastStart, avgCycleLength);

  // Ovulation date (approx day 14 of cycle scaled)
  const ovulationDate = addDays(lastStart, ovulationDay - 1);

  // Fertile window: 5 days before ovulation to 1 day after
  const fertileStart = addDays(lastStart, ovulationDay - 6);
  const fertileEnd = addDays(lastStart, ovulationDay);

  // Predicted period days for calendar (next predicted period, ~5 days)
  const predictedPeriodDays = [];
  for (let i = 0; i < menstrualEnd; i++) {
    predictedPeriodDays.push(addDays(lastStart, avgCycleLength + i));
  }

  // Confidence based on number of cycles tracked
  const confidence = lengths.length >= 3 ? 'high' : 'medium';

  return {
    phase,
    phaseLabel,
    dayInCycle,
    avgCycleLength,
    confidence,
    message: null,
    cycleStarts,
    nextPeriodDate,
    ovulationDate,
    fertileStart,
    fertileEnd,
    predictedPeriodDays
  };
}

/* ===== Helper functions ===== */

function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2 - d1) / 86400000);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
