/**
 * bloom-cycle-signals.js
 * ─────────────────────────────────────────────────────────────
 * Bloom Cycle Signals Engine
 *
 * Purpose:
 *   Generate explainable, rule-based reproductive health signals
 *   from cycle logs, prediction outputs, and user tracking patterns.
 *
 * Design goals:
 *   - single source of truth for cycle-related fallback signals
 *   - dashboard-friendly and Bloomie-friendly
 *   - easy to tune without changing calling code
 *   - safe, conservative, and honest for irregular users
 *
 * Notes:
 *   - this engine is NOT a diagnostic tool
 *   - it is a rule-based inference layer for educational product support
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Convert Date|number|string to Date safely */
function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date input: ${value}`);
  }
  return d;
}

/** Normalize date to local midnight */
function startOfDay(d) {
  const x = toDate(d);
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

/** Clamp numeric value */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Mean of array */
function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((sum, x) => sum + x, 0) / arr.length;
}

/** Median of array */
function median(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Standard deviation of array */
function stdDev(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

/** Safe recent slice */
function lastN(arr, n) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(Math.max(0, arr.length - n));
}

/** Simple linear slope over equally spaced points */
function slopeOfSeries(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;

  const n = values.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(values);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i] - xMean) * (values[i] - yMean);
    denominator += Math.pow(xs[i] - xMean, 2);
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

/** Return most recent average if enough values */
function averageRecent(values, n) {
  const recent = lastN(values, n);
  return recent.length ? mean(recent) : 0;
}

/** Build consistent signal object */
function makeSignal({
  code,
  level,
  show,
  message = "",
  debug = {},
  title = "",
  category = "cycle",
}) {
  return {
    code,
    level,
    show,
    title,
    message,
    category,
    debug,
  };
}

/* ------------------------------------------------------------------ */
/* Signal types                                                       */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} CycleSignal
 * @property {string} code
 * @property {"low"|"medium"|"high"} level
 * @property {boolean} show
 * @property {string} title
 * @property {string} message
 * @property {string} category
 * @property {Object} debug
 */

/* ------------------------------------------------------------------ */
/* Core detectors                                                     */
/* ------------------------------------------------------------------ */

/**
 * Unified period status detector
 *
 * Progression:
 *   - no signal
 *   - LATE_PERIOD
 *   - MISSED_PERIOD
 *   - EXTENDED_ABSENCE
 *
 * Why unified:
 *   This avoids separate files making separate judgments about
 *   essentially the same timeline progression.
 */
export function detectPeriodStatusSignal({
  expectedNextPeriodWindow = null,
  today = new Date(),
  lastPeriodStart = null,
  cycleLengths = [],
  settings = {},
} = {}) {
  const {
    lateGraceDays = 2,
    missedGraceDays = 5,
    highConcernLateDays = 14,
    extendedAbsenceDays = 90,
    irregularStdDevThreshold = 6,
    irregularRangeThreshold = 9,
  } = settings;

  if (!lastPeriodStart) {
    return makeSignal({
      code: "PERIOD_STATUS",
      level: "medium",
      show: false,
      debug: { reason: "No logged period history" },
    });
  }

  const todayD = startOfDay(today);
  const lastPeriodD = startOfDay(lastPeriodStart);
  const daysSinceLastPeriod = diffDays(lastPeriodD, todayD);

  const recentCycles = lastN(cycleLengths, 6);
  const range =
    recentCycles.length > 0 ? Math.max(...recentCycles) - Math.min(...recentCycles) : 0;
  const sd = recentCycles.length > 0 ? stdDev(recentCycles) : 0;
  const irregular =
    recentCycles.length >= 4 &&
    (sd >= irregularStdDevThreshold || range >= irregularRangeThreshold);

  if (daysSinceLastPeriod >= extendedAbsenceDays) {
    return makeSignal({
      code: "EXTENDED_ABSENCE",
      level: "high",
      show: true,
      title: "Prolonged absence",
      message:
        "Bloom noticed a prolonged gap since your last logged period. Consider checking in with a healthcare professional, especially if this is unexpected for you.",
      debug: {
        daysSinceLastPeriod,
        threshold: extendedAbsenceDays,
        irregular,
        cycleStdDev: Number(sd.toFixed(2)),
        cycleRange: range,
      },
    });
  }

  if (!expectedNextPeriodWindow?.end) {
    return makeSignal({
      code: "PERIOD_STATUS",
      level: "medium",
      show: false,
      debug: {
        reason: "Missing expectedNextPeriodWindow.end",
        daysSinceLastPeriod,
      },
    });
  }

  const windowStart = expectedNextPeriodWindow.start
    ? startOfDay(expectedNextPeriodWindow.start)
    : null;
  const windowEnd = startOfDay(expectedNextPeriodWindow.end);

  const daysPastWindowEnd = diffDays(windowEnd, todayD);

  if (daysPastWindowEnd <= lateGraceDays) {
    return makeSignal({
      code: "PERIOD_STATUS",
      level: "medium",
      show: false,
      debug: {
        daysPastWindowEnd,
        daysSinceLastPeriod,
        irregular,
      },
    });
  }

  if (daysPastWindowEnd <= missedGraceDays) {
    return makeSignal({
      code: "LATE_PERIOD",
      level: irregular ? "low" : "medium",
      show: true,
      title: "Period may be late",
      message: irregular
        ? "Bloom noticed your period may be running late, though your recent cycles also look more variable than usual."
        : "Bloom noticed your period may be running late based on your expected cycle window.",
      debug: {
        daysPastWindowEnd,
        daysSinceLastPeriod,
        predictedWindowStartISO: windowStart ? windowStart.toISOString() : null,
        predictedWindowEndISO: windowEnd.toISOString(),
        irregular,
        cycleStdDev: Number(sd.toFixed(2)),
        cycleRange: range,
      },
    });
  }

  if (daysPastWindowEnd <= highConcernLateDays) {
    return makeSignal({
      code: "MISSED_PERIOD",
      level: "medium",
      show: true,
      title: "Missed expected period",
      message: irregular
        ? "Bloom noticed that a period has not been logged after your expected cycle window, though your recent cycle pattern is also less predictable right now."
        : "Bloom noticed that a period has not been logged within your expected cycle window.",
      debug: {
        daysPastWindowEnd,
        daysLate: Math.max(0, daysPastWindowEnd - missedGraceDays),
        daysSinceLastPeriod,
        predictedWindowStartISO: windowStart ? windowStart.toISOString() : null,
        predictedWindowEndISO: windowEnd.toISOString(),
        irregular,
        cycleStdDev: Number(sd.toFixed(2)),
        cycleRange: range,
      },
    });
  }

  return makeSignal({
    code: "MISSED_PERIOD",
    level: "high",
    show: true,
    title: "Period is significantly overdue",
    message:
      "Bloom noticed that your expected period is now considerably overdue. If this is unusual for you, consider taking appropriate next steps such as tracking carefully, using a pregnancy test at the right time, or speaking with a healthcare professional.",
    debug: {
      daysPastWindowEnd,
      daysLate: Math.max(0, daysPastWindowEnd - missedGraceDays),
      daysSinceLastPeriod,
      predictedWindowStartISO: windowStart ? windowStart.toISOString() : null,
      predictedWindowEndISO: windowEnd.toISOString(),
      irregular,
      cycleStdDev: Number(sd.toFixed(2)),
      cycleRange: range,
      thresholdHighConcernLateDays: highConcernLateDays,
    },
  });
}

/**
 * Detect statistical instability in recent cycle lengths
 */
export function detectIrregularCycleSignal({
  cycleLengths = [],
  minCycles = 4,
  stdDevThreshold = 5,
  rangeThreshold = 8,
} = {}) {
  if (!Array.isArray(cycleLengths) || cycleLengths.length < minCycles) {
    return makeSignal({
      code: "IRREGULAR_CYCLE",
      level: "medium",
      show: false,
      debug: { reason: "Not enough cycle history" },
    });
  }

  const recent = lastN(cycleLengths, 6);
  const min = Math.min(...recent);
  const max = Math.max(...recent);
  const range = max - min;
  const sd = stdDev(recent);
  const avg = mean(recent);

  const show = range >= rangeThreshold || sd >= stdDevThreshold;

  return makeSignal({
    code: "IRREGULAR_CYCLE",
    level: "medium",
    show,
    title: "Cycle variability detected",
    message: show
      ? "Bloom noticed more variation than usual in your recent cycle lengths."
      : "",
    debug: {
      recentCycles: recent,
      mean: Number(avg.toFixed(2)),
      median: Number(median(recent).toFixed(2)),
      stdDev: Number(sd.toFixed(2)),
      range,
      stdDevThreshold,
      rangeThreshold,
    },
  });
}

/**
 * Detect cycle trends:
 *   - lengthening trend
 *   - shortening trend
 *   - sudden shift from baseline
 */
export function detectCycleTrendSignal({
  cycleLengths = [],
  minCycles = 4,
  slopeThreshold = 1.0,
  suddenShiftDays = 5,
} = {}) {
  if (!Array.isArray(cycleLengths) || cycleLengths.length < minCycles) {
    return makeSignal({
      code: "CYCLE_TREND",
      level: "low",
      show: false,
      debug: { reason: "Not enough cycle history" },
    });
  }

  const recent = lastN(cycleLengths, 6);
  const slope = slopeOfSeries(recent);
  const recentAvg = averageRecent(recent, Math.min(3, recent.length));
  const baselineWindow = recent.slice(0, Math.max(1, recent.length - 3));
  const baselineAvg = baselineWindow.length ? mean(baselineWindow) : recentAvg;
  const shiftFromBaseline = recentAvg - baselineAvg;

  let code = "CYCLE_TREND";
  let title = "";
  let message = "";
  let level = "low";
  let show = false;

  if (slope >= slopeThreshold) {
    code = "LENGTHENING_CYCLE_TREND";
    title = "Cycles appear to be lengthening";
    message =
      "Bloom noticed your recent cycle lengths appear to be trending longer than your earlier recent pattern.";
    level = Math.abs(shiftFromBaseline) >= suddenShiftDays ? "medium" : "low";
    show = true;
  } else if (slope <= -slopeThreshold) {
    code = "SHORTENING_CYCLE_TREND";
    title = "Cycles appear to be shortening";
    message =
      "Bloom noticed your recent cycle lengths appear to be trending shorter than your earlier recent pattern.";
    level = Math.abs(shiftFromBaseline) >= suddenShiftDays ? "medium" : "low";
    show = true;
  } else if (Math.abs(shiftFromBaseline) >= suddenShiftDays) {
    code = "SUDDEN_CYCLE_SHIFT";
    title = "Recent cycle pattern changed";
    message =
      "Bloom noticed a noticeable shift between your recent cycle lengths and your earlier recent pattern.";
    level = "medium";
    show = true;
  }

  return makeSignal({
    code,
    level,
    show,
    title,
    message,
    debug: {
      recentCycles: recent,
      slope: Number(slope.toFixed(2)),
      slopeThreshold,
      recentAvg: Number(recentAvg.toFixed(2)),
      baselineAvg: Number(baselineAvg.toFixed(2)),
      shiftFromBaseline: Number(shiftFromBaseline.toFixed(2)),
      suddenShiftDays,
    },
  });
}

/**
 * Build a conservative confidence score around prediction quality
 */
export function detectLowPredictionConfidenceSignal({
  cycleLengths = [],
  missingLogDays = 0,
  predictionShiftDays = 0,
  expectedNextPeriodWindow = null,
} = {}) {
  if (!Array.isArray(cycleLengths) || cycleLengths.length === 0) {
    return makeSignal({
      code: "LOW_PREDICTION_CONFIDENCE",
      level: "low",
      show: true,
      title: "Prediction confidence is low",
      message: "Bloom needs more cycle data before prediction confidence can improve.",
      debug: {
        confidenceScore: 0,
        reason: "No cycle history",
      },
    });
  }

  const recent = lastN(cycleLengths, 6);
  const sd = stdDev(recent);
  const range = recent.length ? Math.max(...recent) - Math.min(...recent) : 0;

  let score = 100;

  if (cycleLengths.length < 3) score -= 35;
  else if (cycleLengths.length < 6) score -= 15;

  if (sd >= 6) score -= 25;
  else if (sd >= 4) score -= 12;

  if (range >= 10) score -= 15;
  else if (range >= 7) score -= 8;

  if (missingLogDays > 30) score -= 20;
  else if (missingLogDays > 14) score -= 10;

  if (predictionShiftDays > 7) score -= 20;
  else if (predictionShiftDays > 4) score -= 10;

  if (expectedNextPeriodWindow?.start && expectedNextPeriodWindow?.end) {
    const width = diffDays(expectedNextPeriodWindow.start, expectedNextPeriodWindow.end);
    if (width >= 8) score -= 12;
    else if (width >= 5) score -= 6;
  }

  score = clamp(score, 0, 100);
  const show = score < 60;

  return makeSignal({
    code: "LOW_PREDICTION_CONFIDENCE",
    level: "low",
    show,
    title: "Prediction confidence is lower",
    message: show
      ? "Bloom’s cycle prediction confidence is lower right now because recent data is limited, inconsistent, or more variable than usual."
      : "",
    debug: {
      confidenceScore: score,
      cycleCount: cycleLengths.length,
      recentCycleCount: recent.length,
      stdDev: Number(sd.toFixed(2)),
      range,
      missingLogDays,
      predictionShiftDays,
      expectedWindowWidthDays:
        expectedNextPeriodWindow?.start && expectedNextPeriodWindow?.end
          ? diffDays(expectedNextPeriodWindow.start, expectedNextPeriodWindow.end)
          : null,
    },
  });
}

/**
 * Detect if prediction moved significantly between runs
 */
export function detectPredictionDriftSignal({
  previousPredictedDate = null,
  currentPredictedDate = null,
  driftThresholdDays = 4,
} = {}) {
  if (!previousPredictedDate || !currentPredictedDate) {
    return makeSignal({
      code: "PREDICTION_DRIFT",
      level: "low",
      show: false,
      debug: { reason: "Missing one or more predicted dates" },
    });
  }

  const shiftDays = diffDaysAbs(
    toDate(previousPredictedDate),
    toDate(currentPredictedDate)
  );

  const show = shiftDays >= driftThresholdDays;

  return makeSignal({
    code: "PREDICTION_DRIFT",
    level: "low",
    show,
    title: "Prediction adjusted",
    message: show
      ? "Bloom adjusted your next predicted period because your recent cycle data changed."
      : "",
    debug: {
      shiftDays,
      threshold: driftThresholdDays,
      previousPredictedDateISO: toDate(previousPredictedDate).toISOString(),
      currentPredictedDateISO: toDate(currentPredictedDate).toISOString(),
    },
  });
}

/**
 * Detect logging gap
 */
export function detectLoggingGapSignal({
  lastLogDate = null,
  today = new Date(),
  gapDays = 30,
} = {}) {
  if (!lastLogDate) {
    return makeSignal({
      code: "LOGGING_GAP",
      level: "low",
      show: true,
      title: "More logging needed",
      message: "Bloom has not received enough recent cycle data yet.",
      debug: { daysSinceLastLog: null },
    });
  }

  const todayD = startOfDay(today);
  const lastLogD = startOfDay(lastLogDate);
  const daysSinceLastLog = diffDays(lastLogD, todayD);
  const show = daysSinceLastLog >= gapDays;

  return makeSignal({
    code: "LOGGING_GAP",
    level: "low",
    show,
    title: "Logging gap detected",
    message: show
      ? "Bloom has not received recent cycle logs. Logging helps keep predictions accurate."
      : "",
    debug: {
      daysSinceLastLog,
      threshold: gapDays,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Engine                                                             */
/* ------------------------------------------------------------------ */

/**
 * Main Cycle Signals Engine
 *
 * Generates all relevant rule-based signals in one pass.
 *
 * @param {Object} params
 * @param {{start?: Date|string|number, end?: Date|string|number}} [params.expectedNextPeriodWindow]
 * @param {Date|number|string} [params.today=new Date()]
 * @param {Date|number|string|null} [params.lastPeriodStart=null]
 * @param {Date|number|string|null} [params.lastLogDate=null]
 * @param {number[]} [params.cycleLengths=[]]
 * @param {number} [params.missingLogDays=0]
 * @param {Date|number|string|null} [params.previousPredictedDate=null]
 * @param {Date|number|string|null} [params.currentPredictedDate=null]
 * @param {Object} [params.settings={}]
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
  settings = {},
} = {}) {
  const signals = [];

  const predictionShiftDays =
    previousPredictedDate && currentPredictedDate
      ? diffDaysAbs(toDate(previousPredictedDate), toDate(currentPredictedDate))
      : 0;

  signals.push(
    detectPeriodStatusSignal({
      expectedNextPeriodWindow,
      today,
      lastPeriodStart,
      cycleLengths,
      settings,
    })
  );

  signals.push(
    detectIrregularCycleSignal({
      cycleLengths,
      minCycles: settings.irregularMinCycles ?? 4,
      stdDevThreshold: settings.irregularStdDevThreshold ?? 5,
      rangeThreshold: settings.irregularRangeThreshold ?? 8,
    })
  );

  signals.push(
    detectCycleTrendSignal({
      cycleLengths,
      minCycles: settings.trendMinCycles ?? 4,
      slopeThreshold: settings.trendSlopeThreshold ?? 1.0,
      suddenShiftDays: settings.suddenShiftDays ?? 5,
    })
  );

  signals.push(
    detectLowPredictionConfidenceSignal({
      cycleLengths,
      missingLogDays,
      predictionShiftDays,
      expectedNextPeriodWindow,
    })
  );

  signals.push(
    detectPredictionDriftSignal({
      previousPredictedDate,
      currentPredictedDate,
      driftThresholdDays: settings.driftThresholdDays ?? 4,
    })
  );

  signals.push(
    detectLoggingGapSignal({
      lastLogDate,
      today,
      gapDays: settings.loggingGapDays ?? 30,
    })
  );

  return signals.filter((signal) => signal.show);
}

/* ------------------------------------------------------------------ */
/* Priority helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Returns the single highest-priority signal for compact dashboard display
 */
export function getHighestPrioritySignal(signals = []) {
  const priority = {
    high: 3,
    medium: 2,
    low: 1,
  };

  if (!Array.isArray(signals) || signals.length === 0) return null;

  return [...signals].sort((a, b) => {
    const byLevel = (priority[b.level] || 0) - (priority[a.level] || 0);
    if (byLevel !== 0) return byLevel;

    return String(a.code).localeCompare(String(b.code));
  })[0];
}

/**
 * Optional helper:
 * returns grouped signals for UI sections if needed later
 */
export function groupSignalsByCategory(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) return {};

  return signals.reduce((acc, signal) => {
    const category = signal.category || "general";
    if (!acc[category]) acc[category] = [];
    acc[category].push(signal);
    return acc;
  }, {});
}