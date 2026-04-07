/**
 * cyclePhaseEngine.js
 * ====================
 * ML-enhanced cycle phase calculation for Bloom.
 *
 * Replaces the simple rule-based average in phase.js with a more
 * accurate cycle length when the ML model (cycle_predict.py) has
 * returned a prediction. Falls back to the simple average when ML
 * is unavailable or fewer than 3 cycles have been logged.
 *
 * Usage:
 *   import { computeCyclePhaseML } from '../ml/inference/cyclePhaseEngine.js';
 *
 *   // Without ML (rule-based only)
 *   const result = computeCyclePhaseML(logs);
 *
 *   // With ML prediction from /api/cycles/predict
 *   const result = computeCyclePhaseML(logs, mlPredictedCycleLength);
 *
 * COMP3901: Educational estimation only - not medical advice.
 */

/**
 * Compute cycle phase using ML-predicted cycle length when available.
 *
 * @param {Object}      logs                   - Daily logs keyed by YYYY-MM-DD
 * @param {number|null} mlPredictedCycleLength - Optional ML cycle length in days
 * @returns {Object} Phase data compatible with existing calendar rendering
 */
export function computeCyclePhaseML(logs, mlPredictedCycleLength = null) {
  const entries = Object.entries(logs).sort(([a], [b]) => a.localeCompare(b));

  // Gather period days
  const periodDays = entries
    .filter(([, d]) => d.flow && d.flow !== 'none')
    .map(([date]) => date)
    .sort();

  // Identify distinct cycle starts (gap > 3 days = new period)
  const cycleStarts = [];
  let prevDate = null;
  for (const day of periodDays) {
    if (!prevDate || daysBetween(prevDate, day) > 3) {
      cycleStarts.push(day);
    }
    prevDate = day;
  }

  // No period data at all
  if (cycleStarts.length === 0) {
    return {
      phase:                  'unknown',
      phaseLabel:             'Unknown',
      dayInCycle:             null,
      avgCycleLength:         null,
      mlPredictedCycleLength: null,
      usingML:                false,
      confidence:             'low',
      message:                'Log your first period to see your cycle phase.',
      cycleStarts,
      nextPeriodDate:         null,
      ovulationDate:          null,
      fertileStart:           null,
      fertileEnd:             null,
      predictedPeriodDays:    []
    };
  }

  // One cycle logged - compute phase using ML prediction if available,
  // otherwise fall back to a 28-day default. Confidence is always low
  // here since we have no interval history yet.
  if (cycleStarts.length === 1) {
    const effectiveCycleLength = (
      mlPredictedCycleLength &&
      mlPredictedCycleLength >= 21 &&
      mlPredictedCycleLength <= 45
    ) ? Math.round(mlPredictedCycleLength) : 28;

    const lastStart  = cycleStarts[0];
    const todayKey   = toDateKey(new Date());
    const dayInCycle = daysBetween(lastStart, todayKey) + 1;

    const menstrualEnd  = Math.round(effectiveCycleLength * 5  / 28);
    const follicularEnd = Math.round(effectiveCycleLength * 13 / 28);
    const ovulationDay  = Math.round(effectiveCycleLength * 14 / 28);
    const ovulationEnd  = Math.round(effectiveCycleLength * 16 / 28);

    let phase, phaseLabel;
    if (periodDays.includes(todayKey)) {
      // Actively bleeding - always menstrual
      phase = 'menstrual';  phaseLabel = 'Menstrual';
    } else if (dayInCycle <= follicularEnd) {
      // Period has ended but still early in cycle
      phase = 'follicular'; phaseLabel = 'Follicular';
    } else if (dayInCycle <= ovulationEnd) {
      phase = 'ovulatory';  phaseLabel = 'Ovulatory';
    } else {
      phase = 'luteal';     phaseLabel = 'Luteal';
    }

    const nextPeriodDate = addDays(lastStart, effectiveCycleLength);
    const ovulationDate  = addDays(lastStart, ovulationDay - 1);
    const fertileStart   = addDays(lastStart, ovulationDay - 6);
    const fertileEnd     = addDays(lastStart, ovulationDay);

    const predictedPeriodDays = [];
    for (let i = 0; i < menstrualEnd; i++) {
      predictedPeriodDays.push(addDays(lastStart, effectiveCycleLength + i));
    }

    return {
      phase,
      phaseLabel,
      dayInCycle,
      avgCycleLength:         null,
      mlPredictedCycleLength: mlPredictedCycleLength ?? null,
      usingML:                !!mlPredictedCycleLength,
      confidence:             'low',
      message:                'Based on your first cycle - log more periods to improve accuracy.',
      cycleStarts,
      nextPeriodDate,
      ovulationDate,
      fertileStart,
      fertileEnd,
      predictedPeriodDays
    };
  }

  // Calculate average cycle length from history
  const lengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    lengths.push(daysBetween(cycleStarts[i - 1], cycleStarts[i]));
  }
  const avgCycleLength = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);

  // Use ML prediction if available and within plausible range
  const effectiveCycleLength = (
    mlPredictedCycleLength &&
    mlPredictedCycleLength >= 21 &&
    mlPredictedCycleLength <= 45
  ) ? Math.round(mlPredictedCycleLength) : avgCycleLength;

  const usingML = effectiveCycleLength !== avgCycleLength;

  // Current day in cycle
  const lastStart   = cycleStarts[cycleStarts.length - 1];
  const todayKey    = toDateKey(new Date());
  const dayInCycle  = daysBetween(lastStart, todayKey) + 1;

  // Phase boundaries scaled to effective cycle length
  const menstrualEnd  = Math.round(effectiveCycleLength * 5  / 28);
  const follicularEnd = Math.round(effectiveCycleLength * 13 / 28);
  const ovulationDay  = Math.round(effectiveCycleLength * 14 / 28);
  const ovulationEnd  = Math.round(effectiveCycleLength * 16 / 28);

  let phase, phaseLabel;
  if (periodDays.includes(todayKey)) {
    // Actively bleeding - always menstrual
    phase = 'menstrual';   phaseLabel = 'Menstrual';
  } else if (dayInCycle <= follicularEnd) {
    // Period has ended but still early in cycle
    phase = 'follicular';  phaseLabel = 'Follicular';
  } else if (dayInCycle <= ovulationEnd) {
    phase = 'ovulatory';   phaseLabel = 'Ovulatory';
  } else if (dayInCycle <= effectiveCycleLength) {
    phase = 'luteal';      phaseLabel = 'Luteal';
  } else {
    phase = 'luteal';      phaseLabel = 'Late Luteal';
  }

  // Key dates using effective cycle length
  const nextPeriodDate = addDays(lastStart, effectiveCycleLength);
  const ovulationDate  = addDays(lastStart, ovulationDay - 1);
  const fertileStart   = addDays(lastStart, ovulationDay - 6);
  const fertileEnd     = addDays(lastStart, ovulationDay);

  // Predicted period days for calendar
  const predictedPeriodDays = [];
  for (let i = 0; i < menstrualEnd; i++) {
    predictedPeriodDays.push(addDays(lastStart, effectiveCycleLength + i));
  }

  // lengths.length === cycleStarts.length - 1 (number of intervals)
  // high: 3+ intervals (4+ cycles), medium: 1-2 intervals (2-3 cycles)
  const confidence = lengths.length >= 3 ? 'high' : 'medium';

  return {
    phase,
    phaseLabel,
    dayInCycle,
    avgCycleLength,
    mlPredictedCycleLength: usingML ? effectiveCycleLength : null,
    usingML,
    confidence,
    message:             null,
    cycleStarts,
    nextPeriodDate,
    ovulationDate,
    fertileStart,
    fertileEnd,
    predictedPeriodDays
  };
}

// ─── Helpers ──────────────────────────────────────────────────

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