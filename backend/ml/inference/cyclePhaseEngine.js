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
  const periodDays = expandPeriodDaysFromEntries(entries);

  // Identify distinct cycle starts (gap > 3 days = new period)
  const periodClusters = buildPeriodClusters(periodDays);
  const cycleStarts = periodClusters.map((cluster) => cluster.start);
  const typicalPeriodDuration = estimateTypicalPeriodDuration(periodClusters);

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

    const phaseState = determineCurrentCyclePhase({
      lastPeriodStart: lastStart,
      averageCycleLength: effectiveCycleLength,
      averagePeriodDuration: typicalPeriodDuration,
      today: todayKey,
    });
    const { phase, phaseLabel } = phaseState;
    const ovulationDay = phaseState.ovulationDay;

    const nextPeriodDate = addDays(lastStart, effectiveCycleLength);
    const ovulationDate  = addDays(lastStart, ovulationDay - 1);
    const fertileStart   = addDays(lastStart, ovulationDay - 6);
    const fertileEnd     = addDays(lastStart, ovulationDay);

    const predictedPeriodDays = [];
    for (let i = 0; i < typicalPeriodDuration; i++) {
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
  const phaseState = determineCurrentCyclePhase({
    lastPeriodStart: lastStart,
    averageCycleLength: effectiveCycleLength,
    averagePeriodDuration: typicalPeriodDuration,
    today: todayKey,
  });
  const { phase, phaseLabel } = phaseState;
  const ovulationDay = phaseState.ovulationDay;

  // Key dates using effective cycle length
  const nextPeriodDate = addDays(lastStart, effectiveCycleLength);
  const ovulationDate  = addDays(lastStart, ovulationDay - 1);
  const fertileStart   = addDays(lastStart, ovulationDay - 6);
  const fertileEnd     = addDays(lastStart, ovulationDay);

  // Predicted period days for calendar
  const predictedPeriodDays = [];
  for (let i = 0; i < typicalPeriodDuration; i++) {
    predictedPeriodDays.push(addDays(lastStart, effectiveCycleLength + i));
  }

  // Confidence should reflect both quantity and stability.
  // Prevents "always high" when enough cycles exist but intervals vary widely.
  const confidence = calculateConfidence(lengths);

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

function isPeriodEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const flow = String(entry.flow || '').trim().toLowerCase();
  if (flow && flow !== 'none') return true;
  const flowLevel = Number(entry.flowLevel);
  if (Number.isFinite(flowLevel) && flowLevel > 0) return true;
  const periodDay = Number(entry.periodDay);
  if (Number.isFinite(periodDay) && periodDay > 0) return true;
  return entry.periodDay === true;
}

function expandPeriodDaysFromEntries(entries) {
  const days = new Set();

  for (const [date, entry] of entries) {
    if (!isPeriodEntry(entry)) continue;

    const explicitPeriodDay = Number(entry.periodDay);
    if (Number.isInteger(explicitPeriodDay) && explicitPeriodDay > 1 && explicitPeriodDay <= 10) {
      const start = addDays(date, -(explicitPeriodDay - 1));
      for (let i = 0; i < explicitPeriodDay; i++) {
        days.add(addDays(start, i));
      }
      continue;
    }

    days.add(date);
  }

  return [...days].sort();
}

function buildPeriodClusters(periodDays) {
  if (!periodDays.length) return [];

  const clusters = [];
  let start = periodDays[0];
  let end = periodDays[0];

  for (let i = 1; i < periodDays.length; i++) {
    if (daysBetween(periodDays[i - 1], periodDays[i]) > 3) {
      clusters.push({ start, end });
      start = periodDays[i];
    }
    end = periodDays[i];
  }

  clusters.push({ start, end });
  return clusters;
}

function estimateTypicalPeriodDuration(periodClusters) {
  // Average completed/logged bleeding clusters, ignoring one-day starts and
  // very long entries. If history is too sparse, default to 5 days so a logged
  // period start keeps menstrual phase projected across the expected bleed even
  // when the user does not log every day.
  const durations = periodClusters
    .map((cluster) => daysBetween(cluster.start, cluster.end) + 1)
    .filter((duration) => Number.isFinite(duration) && duration >= 2 && duration <= 10);

  if (!durations.length) return 5;

  const average = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  return Math.max(3, Math.min(8, Math.round(average)));
}

/**
 * Shared rule-based phase resolver.
 *
 * A period start is a confirmed cycle anchor. Menstrual phase continues for the
 * user's average period duration (or the 5-day fallback above), not only for
 * days that have individual bleeding logs. This keeps sparse logging realistic:
 * logging May 1 as Day 1 still means May 2-May 5 are estimated menstrual days.
 */
export function determineCurrentCyclePhase({
  lastPeriodStart,
  averageCycleLength = 28,
  averagePeriodDuration = 5,
  today = new Date(),
} = {}) {
  if (!lastPeriodStart) {
    return {
      phase: 'unknown',
      phaseLabel: 'Unknown',
      dayInCycle: null,
      ovulationDay: null,
    };
  }

  const cycleLength = Math.max(21, Math.min(45, Math.round(Number(averageCycleLength) || 28)));
  const periodDuration = Math.max(3, Math.min(8, Math.round(Number(averagePeriodDuration) || 5)));
  const todayKey = typeof today === 'string' ? today : toDateKey(new Date(today));
  const dayInCycle = daysBetween(lastPeriodStart, todayKey) + 1;
  const follicularEnd = Math.max(periodDuration + 1, Math.round(cycleLength * 13 / 28));
  const ovulationDay = Math.round(cycleLength * 14 / 28);
  const ovulationEnd = Math.round(cycleLength * 16 / 28);

  if (dayInCycle >= 1 && dayInCycle <= periodDuration) {
    return { phase: 'menstrual', phaseLabel: 'Menstrual', dayInCycle, ovulationDay };
  }
  if (dayInCycle <= follicularEnd) {
    return { phase: 'follicular', phaseLabel: 'Follicular', dayInCycle, ovulationDay };
  }
  if (dayInCycle <= ovulationEnd) {
    return { phase: 'ovulatory', phaseLabel: 'Ovulatory', dayInCycle, ovulationDay };
  }
  if (dayInCycle <= cycleLength) {
    return { phase: 'luteal', phaseLabel: 'Luteal', dayInCycle, ovulationDay };
  }
  return { phase: 'luteal', phaseLabel: 'Late Luteal', dayInCycle, ovulationDay };
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calculateConfidence(lengths) {
  if (!Array.isArray(lengths) || lengths.length === 0) return 'low';
  if (lengths.length === 1) return 'medium';

  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / lengths.length;
  const stdDev = Math.sqrt(variance);
  const range = Math.max(...lengths) - Math.min(...lengths);

  if (lengths.length >= 3 && stdDev <= 2.2 && range <= 6) return 'high';
  if (stdDev <= 4.5 && range <= 10) return 'medium';
  return 'low';
}
