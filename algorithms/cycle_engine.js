/*
 * bloom-cycle-signals.js
 * ─────────────────────────────────────────────────────────────
 * Bloom Cycle Signals Engine
 *
 * Purpose:
 *   Generate lightweight, dashboard-ready reproductive health signals
 *   from cycle logs, prediction outputs, and user tracking patterns.
 *
 * Signals produced here are designed to be:
 *   - explainable
 *   - rule-based
 *   - usable as fallbacks to the ML model
 *   - easy for the dashboard and Bloomie to consume
 *
 * Example output:
 * [
 *   {
 *     code: "MISSED_PERIOD",
 *     level: "medium",
 *     message: "Bloom noticed that a period has not been logged within your expected cycle window.",
 *     show: true,
 *     debug: { daysLate: 4 }
 *   },
 *   {
 *     code: "LOW_PREDICTION_CONFIDENCE",
 *     level: "low",
 *     message: "Bloom’s cycle prediction confidence is lower right now because recent data is limited or variable.",
 *     show: true,
 *     debug: { confidenceScore: 48 }
 *   }
 * ]
 */

/** Convert Date|number|string to Date safely */
function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date input: ${value}`);
  }
  return d;
}

/** Normalize date to local midnight */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole-day difference: (b - a) in days */
function diffDays(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / msPerDay);
}

/** Absolute whole-day difference */
function diffDaysAbs(a, b) {
  return Math.abs(diffDays(a, b));
}

/** Mean of array */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, x) => sum + x, 0) / arr.length;
}

/** Standard deviation of array */
function stdDev(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

/**
 * Signal shape used throughout engine
 * @typedef {Object} CycleSignal
 * @property {string} code
 * @property {"low"|"medium"|"high"} level
 * @property {boolean} show
 * @property {string} message
 * @property {Object} debug
 */

/**
 * MISSED PERIOD
 * Detect if user has not logged a period within expected window + grace period
 */
export function detectMissedPeriodSignal({
  expectedNextPeriodWindow,
  today,
  lastPeriodStart,
  graceDays = 5,
}) {
  if (!expectedNextPeriodWindow?.end) {
    return {
      code: "MISSED_PERIOD",
      level: "medium",
      show: false,
      message: "",
      debug: { reason: "Missing expectedNextPeriodWindow.end" },
    };
  }

  const todayD = startOfDay(toDate(today));
  const windowEnd = startOfDay(toDate(expectedNextPeriodWindow.end));

  if (!lastPeriodStart) {
    return {
      code: "MISSED_PERIOD",
      level: "medium",
      show: false,
      message: "",
      debug: { reason: "No logged period history" },
    };
  }

  const daysPastWindowEnd = diffDays(windowEnd, todayD);
  const daysLate = Math.max(0, daysPastWindowEnd - graceDays);
  const show = daysPastWindowEnd > graceDays;

  return {
    code: "MISSED_PERIOD",
    level: "medium",
    show,
    message: show
      ? "Bloom noticed that a period has not been logged within your expected cycle window."
      : "",
    debug: {
      daysPastWindowEnd,
      daysLate,
      predictedWindowEndISO: windowEnd.toISOString(),
    },
  };
}

/**
 * EXTENDED ABSENCE
 * Detect prolonged gap since last logged period
 */
export function detectExtendedAbsenceSignal({
  today,
  lastPeriodStart,
  extendedAbsenceDays = 90,
}) {
  if (!lastPeriodStart) {
    return {
      code: "EXTENDED_ABSENCE",
      level: "high",
      show: false,
      message: "",
      debug: { reason: "No logged period history" },
    };
  }

  const todayD = startOfDay(toDate(today));
  const lastPeriodD = startOfDay(toDate(lastPeriodStart));
  const daysSinceLastPeriod = diffDays(lastPeriodD, todayD);
  const show = daysSinceLastPeriod >= extendedAbsenceDays;

  return {
    code: "EXTENDED_ABSENCE",
    level: "high",
    show,
    message: show
      ? "Bloom noticed a prolonged gap since your last logged period."
      : "",
    debug: {
      daysSinceLastPeriod,
      threshold: extendedAbsenceDays,
    },
  };
}

/**
 * IRREGULAR CYCLE FALLBACK
 * Detect statistical instability in recent cycle lengths
 */
export function detectIrregularCycleSignal({
  cycleLengths = [],
  minCycles = 4,
  stdDevThreshold = 5,
  rangeThreshold = 8,
}) {
  if (!Array.isArray(cycleLengths) || cycleLengths.length < minCycles) {
    return {
      code: "IRREGULAR_CYCLE",
      level: "medium",
      show: false,
      message: "",
      debug: { reason: "Not enough cycle history" },
    };
  }

  const recent = cycleLengths.slice(-6);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const range = max - min;
  const sd = stdDev(recent);
  const avg = mean(recent);

  const show = range >= rangeThreshold || sd >= stdDevThreshold;

  return {
    code: "IRREGULAR_CYCLE",
    level: "medium",
    show,
    message: show
      ? "Bloom noticed more variation than usual in your recent cycle lengths."
      : "",
    debug: {
      recentCycles: recent,
      mean: Number(avg.toFixed(2)),
      stdDev: Number(sd.toFixed(2)),
      range,
    },
  };
}

/**
 * LOW PREDICTION CONFIDENCE
 * Build a simple confidence score around prediction quality
 */
export function detectLowPredictionConfidenceSignal({
  cycleLengths = [],
  missingLogDays = 0,
  predictionShiftDays = 0,
}) {
  if (!Array.isArray(cycleLengths) || cycleLengths.length === 0) {
    return {
      code: "LOW_PREDICTION_CONFIDENCE",
      level: "low",
      show: true,
      message: "Bloom needs more cycle data before prediction confidence can improve.",
      debug: {
        confidenceScore: 0,
        reason: "No cycle history",
      },
    };
  }

  const sd = stdDev(cycleLengths);
  let score = 100;

  if (cycleLengths.length < 3) score -= 30;
  if (cycleLengths.length < 6) score -= 15;
  if (sd > 5) score -= 20;
  if (missingLogDays > 20) score -= 20;
  if (predictionShiftDays > 4) score -= 15;

  score = Math.max(0, Math.min(100, score));
  const show = score < 60;

  return {
    code: "LOW_PREDICTION_CONFIDENCE",
    level: "low",
    show,
    message: show
      ? "Bloom’s cycle prediction confidence is lower right now because recent data is limited or more variable than usual."
      : "",
    debug: {
      confidenceScore: score,
      cycleCount: cycleLengths.length,
      stdDev: Number(sd.toFixed(2)),
      missingLogDays,
      predictionShiftDays,
    },
  };
}

/**
 * PREDICTION DRIFT
 * Detect if model prediction changed significantly
 */
export function detectPredictionDriftSignal({
  previousPredictedDate,
  currentPredictedDate,
  driftThresholdDays = 4,
}) {
  if (!previousPredictedDate || !currentPredictedDate) {
    return {
      code: "PREDICTION_DRIFT",
      level: "low",
      show: false,
      message: "",
      debug: { reason: "Missing one or more predicted dates" },
    };
  }

  const shiftDays = diffDaysAbs(
    toDate(previousPredictedDate),
    toDate(currentPredictedDate)
  );

  const show = shiftDays >= driftThresholdDays;

  return {
    code: "PREDICTION_DRIFT",
    level: "low",
    show,
    message: show
      ? "Bloom adjusted your next predicted period because your recent cycle data changed."
      : "",
    debug: {
      shiftDays,
      threshold: driftThresholdDays,
    },
  };
}

/**
 * LOGGING GAP
 * Detect if the user has not logged data for a while
 */
export function detectLoggingGapSignal({
  lastLogDate,
  today,
  gapDays = 30,
}) {
  if (!lastLogDate) {
    return {
      code: "LOGGING_GAP",
      level: "low",
      show: true,
      message: "Bloom has not received enough recent cycle data yet.",
      debug: { daysSinceLastLog: null },
    };
  }

  const todayD = startOfDay(toDate(today));
  const lastLogD = startOfDay(toDate(lastLogDate));
  const daysSinceLastLog = diffDays(lastLogD, todayD);
  const show = daysSinceLastLog >= gapDays;

  return {
    code: "LOGGING_GAP",
    level: "low",
    show,
    message: show
      ? "Bloom has not received recent cycle logs. Logging helps keep predictions accurate."
      : "",
    debug: {
      daysSinceLastLog,
      threshold: gapDays,
    },
  };
}

/**
 * Main Cycle Signals Engine
 *
 * Generates all relevant signals in one pass.
 *
 * @param {Object} params
 * @param {{start?: Date|string|number, end: Date|string|number}} [params.expectedNextPeriodWindow]
 * @param {Date|number|string} [params.today=new Date()]
 * @param {Date|number|string|null} [params.lastPeriodStart=null]
 * @param {Date|number|string|null} [params.lastLogDate=null]
 * @param {number[]} [params.cycleLengths=[]]
 * @param {number} [params.missingLogDays=0]
 * @param {Date|number|string|null} [params.previousPredictedDate=null]
 * @param {Date|number|string|null} [params.currentPredictedDate=null]
 *
 * @returns {CycleSignal[]}
 */
export function generateCycleSignals({
  expectedNextPeriodWindow = null,
  today = new Date(),
  lastPeriodStart = null,
  lastLogDate = null,
  cycleLengths = [],
  missingLogDays = 0,
  previousPredictedDate = null,
  currentPredictedDate = null,
} = {}) {
  const signals = [];

  if (expectedNextPeriodWindow?.end) {
    signals.push(
      detectMissedPeriodSignal({
        expectedNextPeriodWindow,
        today,
        lastPeriodStart,
      })
    );
  }

  signals.push(
    detectExtendedAbsenceSignal({
      today,
      lastPeriodStart,
    })
  );

  signals.push(
    detectIrregularCycleSignal({
      cycleLengths,
    })
  );

  const predictionShiftDays =
    previousPredictedDate && currentPredictedDate
      ? diffDaysAbs(toDate(previousPredictedDate), toDate(currentPredictedDate))
      : 0;

  signals.push(
    detectLowPredictionConfidenceSignal({
      cycleLengths,
      missingLogDays,
      predictionShiftDays,
    })
  );

  signals.push(
    detectPredictionDriftSignal({
      previousPredictedDate,
      currentPredictedDate,
    })
  );

  signals.push(
    detectLoggingGapSignal({
      lastLogDate,
      today,
    })
  );

  return signals.filter((signal) => signal.show);
}

/**
 * Optional helper:
 * returns the single highest-priority signal for compact dashboard display
 */
export function getHighestPrioritySignal(signals = []) {
  const priority = {
    high: 3,
    medium: 2,
    low: 1,
  };

  if (!Array.isArray(signals) || signals.length === 0) return null;

  return [...signals].sort((a, b) => {
    return (priority[b.level] || 0) - (priority[a.level] || 0);
  })[0];
}