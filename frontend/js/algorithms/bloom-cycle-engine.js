/**
 * bloom-cycle-engine.js
 */

import {
  toDate, startOfDay, diffDays, diffDaysAbs, clamp,
  mean, median, stdDev, lastN, slopeOfSeries,
  makeSignal as _makeSignal,
} from "./bloom-utils.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Wrap makeSignal with cycle-engine default category */
const makeSignal = (p) => _makeSignal({ category: "cycle", ...p });

/** Return most recent average if enough values */
function averageRecent(values, n) {
  const recent = lastN(values, n);
  return recent.length ? mean(recent) : 0;
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
    stressDelay = false,
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
      message: stressDelay
        ? "Periods can sometimes be delayed by stress, travel, or illness - this may be one of those cycles."
        : irregular
          ? "Bloom noticed your period may be running late, though your recent cycles also look more variable than usual."
          : "Bloom noticed your period may be running late based on your expected cycle window.",
      debug: {
        daysPastWindowEnd,
        daysSinceLastPeriod,
        predictedWindowStartISO: windowStart ? windowStart.toISOString() : null,
        predictedWindowEndISO: windowEnd.toISOString(),
        irregular,
        stressDelay,
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
 * Detect statistical instability in recent cycle lengths.
 *
 * Accepts optional context flags:
 *   isPostpartum          - suppress IRREGULAR_CYCLE for first 3 post-birth cycles
 *   postpartumCycleCount  - cycles logged since birth
 *   recentlyStoppedBC     - suppress for first 3 cycles after stopping hormonal BC
 *   recentlyStoppedBCCycleCount - cycles since stopping BC
 *   userAge               - teen users (< 18) get relaxed thresholds
 */
export function detectIrregularCycleSignal({
  cycleLengths = [],
  minCycles = 4,
  stdDevThreshold = 5,
  rangeThreshold = 8,
  isPostpartum = false,
  postpartumCycleCount = 0,
  recentlyStoppedBC = false,
  recentlyStoppedBCCycleCount = 0,
  userAge = null,
} = {}) {
  // Teen users - relax thresholds (cycles 21–45 days are normal variation)
  const effectiveStdDevThreshold = (userAge !== null && userAge < 18) ? 8  : stdDevThreshold;
  const effectiveRangeThreshold  = (userAge !== null && userAge < 18) ? 15 : rangeThreshold;

  if (!Array.isArray(cycleLengths) || cycleLengths.length < minCycles) {
    return makeSignal({
      code: "IRREGULAR_CYCLE",
      level: "medium",
      show: false,
      debug: { reason: "Not enough cycle history" },
    });
  }

  // Postpartum: first 3 cycles are expected to be irregular - show a gentle note instead
  if (isPostpartum && postpartumCycleCount < 3) {
    return makeSignal({
      code: "IRREGULAR_CYCLE",
      level: "low",
      show: true,
      title: "Postpartum cycle adjustment",
      message:
        "Postpartum cycles are often irregular as your body adjusts. Bloom will start building your pattern after a few more logged cycles 🩷",
      debug: { reason: "postpartum suppression", postpartumCycleCount },
    });
  }

  // Recently stopped BC: first 3 settling cycles - suppress irregular signal
  if (recentlyStoppedBC && recentlyStoppedBCCycleCount < 3) {
    return makeSignal({
      code: "IRREGULAR_CYCLE",
      level: "low",
      show: true,
      title: "Post-birth-control adjustment",
      message:
        "Cycles often take 2–3 months to settle after stopping hormonal birth control. Bloom will build your pattern as things regulate 🩷",
      debug: { reason: "recentlyStoppedBC suppression", recentlyStoppedBCCycleCount },
    });
  }

  const recent = lastN(cycleLengths, 6);
  const minVal = Math.min(...recent);
  const maxVal = Math.max(...recent);
  const range  = maxVal - minVal;
  const sd     = stdDev(recent);
  const avg    = mean(recent);

  const show    = range >= effectiveRangeThreshold || sd >= effectiveStdDevThreshold;
  const isWild  = range >= 20 || sd >= 10;

  const message = isWild
    ? "Your recent cycles have varied quite a bit in length. Predictions will be less precise, but Bloom will give you a window rather than a single date."
    : show
      ? "Bloom noticed more variation than usual in your recent cycle lengths."
      : "";

  return makeSignal({
    code: "IRREGULAR_CYCLE",
    level: "medium",
    show,
    title: "Cycle variability detected",
    message,
    debug: {
      recentCycles: recent,
      mean: Number(avg.toFixed(2)),
      median: Number(median(recent).toFixed(2)),
      stdDev: Number(sd.toFixed(2)),
      range,
      stdDevThreshold: effectiveStdDevThreshold,
      rangeThreshold: effectiveRangeThreshold,
      isWild,
      predictionRange: isWild ? Math.ceil(sd) : null,
      isPostpartum,
      recentlyStoppedBC,
      userAge,
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
      ? "Bloom's cycle prediction confidence is lower right now because recent data is limited, inconsistent, or more variable than usual."
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

/* ------------------------------------------------------------------ */
/* Track Changes plan                                                 */
/* ------------------------------------------------------------------ */

/**
 * Track Changes mode template - store in Firebase when user taps "Enable Track Changes".
 * Generates a 28-day tracking plan with 6 check-in prompts.
 */
export function buildTrackChangesPlan({ today = new Date() } = {}) {
  const t = startOfDay(toDate(today));
  const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

  return {
    enabled: true,
    startDateISO: t.toISOString(),
    endDateISO: addDays(t, 28).toISOString(),
    prompts: [
      { dayOffset: 0, text: "Log any bleeding/spotting today (if any)." },
      { dayOffset: 3, text: "How is your stress/sleep? Any changes this week?" },
      { dayOffset: 7, text: "Log symptoms and note any major routine changes (travel, illness, exercise)." },
      { dayOffset: 14, text: "If your period still hasn't started, consider reviewing your test timing or checking in with a clinician." },
      { dayOffset: 21, text: "Keep tracking: changes over time help Bloom improve its predictions." },
      { dayOffset: 28, text: "Track Changes check-in complete. You can continue or export a summary for yourself." },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Data quality: deduplication and suspicious entries                */
/* ------------------------------------------------------------------ */

/**
 * Deduplicate a list of period start dates.
 * Any two dates within dedupDays of each other are treated as the same
 * period - the earlier date is kept and the later one is discarded.
 *
 * @param  {(Date|string|number)[]} dates
 * @param  {number} dedupDays  - threshold (default 3)
 * @returns {Date[]}
 */
export function deduplicatePeriods(dates = [], dedupDays = 3) {
  const sorted = [...dates]
    .map((d) => toDate(d))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  const result = [];
  for (const d of sorted) {
    const prev = result[result.length - 1];
    if (!prev || diffDaysAbs(prev, d) > dedupDays) {
      result.push(d);
    }
    // else: within dedupDays → skip (keep the earlier entry already in result)
  }
  return result;
}

/**
 * Flag period start dates that are suspiciously close together
 * (within windowDays, default 10) but not close enough to be obvious duplicates.
 *
 * @param  {(Date|string|number)[]} dates
 * @param  {number} windowDays - threshold (default 10)
 * @returns {{ suspicious: boolean, pairs: Array<{date1: Date, date2: Date, gapDays: number}> }}
 */
export function detectSuspiciousEntries(dates = [], windowDays = 10) {
  const sorted = [...dates]
    .map((d) => toDate(d))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  const pairs = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = diffDaysAbs(sorted[i - 1], sorted[i]);
    if (gap > 0 && gap <= windowDays) {
      pairs.push({ date1: sorted[i - 1], date2: sorted[i], gapDays: gap });
    }
  }
  return { suspicious: pairs.length > 0, pairs };
}

/* ------------------------------------------------------------------ */
/* Robust average cycle length                                        */
/* ------------------------------------------------------------------ */

/**
 * Compute average cycle length with:
 *   - sparse data guard (0 or 1 cycles → return default 28)
 *   - 90-day gap detection (exclude pre-gap cycles and the gap cycle itself)
 *   - outlier exclusion (> 2 standard deviations from the remaining mean)
 *
 * @param  {number[]} cycleLengths
 * @param  {Object}   opts
 * @param  {number}   opts.defaultLength    - returned when data is insufficient (default 28)
 * @param  {number}   opts.gapThresholdDays - gap that triggers pre-gap exclusion (default 90)
 * @returns {{
 *   average: number,
 *   usedDefault: boolean,
 *   excluded: number[],
 *   preGapExcluded: number,
 *   reason: string
 * }}
 */
export function computeRobustAverageCycleLength(cycleLengths = [], {
  defaultLength = 28,
  gapThresholdDays = 90,
} = {}) {
  if (!Array.isArray(cycleLengths) || cycleLengths.length === 0) {
    return { average: defaultLength, usedDefault: true, excluded: [], preGapExcluded: 0, reason: "no data" };
  }
  if (cycleLengths.length === 1) {
    return { average: defaultLength, usedDefault: true, excluded: [], preGapExcluded: 0, reason: "only 1 cycle" };
  }

  // Find the last large gap and exclude everything up to and including that cycle
  let working = [...cycleLengths];
  let preGapExcluded = 0;

  let lastLargeGapIdx = -1;
  for (let i = cycleLengths.length - 1; i >= 0; i--) {
    if (cycleLengths[i] >= gapThresholdDays) {
      lastLargeGapIdx = i;
      break;
    }
  }
  if (lastLargeGapIdx >= 0) {
    working = cycleLengths.slice(lastLargeGapIdx + 1);
    preGapExcluded = lastLargeGapIdx + 1;
  }

  if (working.length === 0) {
    return { average: defaultLength, usedDefault: true, excluded: [], preGapExcluded, reason: "all cycles pre-gap" };
  }
  if (working.length === 1) {
    return { average: defaultLength, usedDefault: true, excluded: [], preGapExcluded, reason: "only 1 cycle after gap" };
  }

  // Exclude outliers more than 2 SD from the mean
  const m  = mean(working);
  const sd = stdDev(working);
  const excluded = [];
  const included = working.filter((l) => {
    if (sd > 0 && Math.abs(l - m) > 2 * sd) {
      excluded.push(l);
      return false;
    }
    return true;
  });

  if (included.length === 0) {
    return { average: Math.round(m), usedDefault: false, excluded, preGapExcluded, reason: "all outliers" };
  }

  return {
    average: Math.round(mean(included)),
    usedDefault: false,
    excluded,
    preGapExcluded,
    reason: excluded.length > 0
      ? `excluded ${excluded.length} outlier(s): [${excluded.join(", ")}]`
      : "normal",
  };
}

/* ------------------------------------------------------------------ */
/* Dense / weird data signals                                         */
/* ------------------------------------------------------------------ */

/**
 * Signal when symptom history is rich but no cycle data has been logged.
 *
 * @param {Object} params
 * @param {number}  params.symptomEntryCount - total logged symptom entries
 * @param {boolean} params.hasCycleData      - true if any period dates are logged
 * @param {number}  params.minEntries        - threshold before signal fires (default 30)
 * @returns {CycleSignal}
 */
export function detectSymptomWithoutCycleData({
  symptomEntryCount = 0,
  hasCycleData = false,
  minEntries = 30,
} = {}) {
  const show = !hasCycleData && symptomEntryCount >= minEntries;
  return makeSignal({
    code: "SYMPTOM_WITHOUT_CYCLE_DATA",
    level: "low",
    show,
    title: "Add period dates to unlock insights",
    message: show
      ? "You've been logging symptoms - great 🩷 Adding your period start dates will help Bloom connect your symptoms to your cycle and give you much better insights."
      : "",
    debug: { symptomEntryCount, hasCycleData, minEntries },
  });
}

/**
 * Flag a period entry whose logged bleeding duration exceeds 10 days.
 * Long-duration entries are noted but excluded from average period-length
 * calculations to avoid skewing predictions.
 *
 * @param  {Array<{durationDays: number}>} periodEntries
 * @returns {CycleSignal}
 */
export function detectLongBleedingEntry(periodEntries = []) {
  const long = periodEntries.filter((e) => e && e.durationDays > 10);
  const show = long.length > 0;
  return makeSignal({
    code: "LONG_BLEEDING_ENTRY",
    level: "medium",
    show,
    title: "Extended bleeding flagged",
    message: show
      ? "You logged bleeding for more than 10 days - this has been noted but won't affect your average period length. If this is ongoing, it's worth mentioning to a provider 🩷"
      : "",
    debug: { longEntries: long },
  });
}

/**
 * Flag when two period start dates are within 10 days (too close to be a
 * separate cycle, too far apart to be a simple duplicate).
 * The earlier date is kept; the later one should be reviewed.
 *
 * @param  {(Date|string|number)[]} dates
 * @returns {CycleSignal}
 */
export function detectSuspiciousEntrySignal(dates = []) {
  const { suspicious, pairs } = detectSuspiciousEntries(dates, 10);
  return makeSignal({
    code: "SUSPICIOUS_ENTRY",
    level: "low",
    show: suspicious,
    title: "Unusual period entries",
    message: suspicious
      ? "It looks like two period start dates were logged close together. Bloom will use the earlier one - you can update your calendar if needed."
      : "",
    debug: { pairs: pairs.map((p) => ({ gapDays: p.gapDays })) },
  });
}

/* ------------------------------------------------------------------ */
/* Advanced Insights — period-pattern detection                       */
/* ------------------------------------------------------------------ */

/**
 * Signal groups used for deduplication.
 * When two signals share a group, only the higher-priority one is surfaced.
 */
const SIGNAL_GROUPS = {
  ABSENCE:            ['EXTENDED_ABSENCE', 'AMENORRHEA_PATTERN'],
  FREQUENCY:          ['OLIGOMENORRHEA_PATTERN', 'POLYMENORRHEA_PATTERN'],
  BLEEDING_INTENSITY: ['MENORRHAGIA_PATTERN', 'HYPOMENORRHEA_PATTERN'],
  IRREGULAR_BLEEDING: ['METRORRHAGIA_PATTERN', 'MENOMETRORRHAGIA_PATTERN'],
};

// Reverse lookup: signal code → group name (built once at load)
const _SIGNAL_TO_GROUP = {};
for (const [group, codes] of Object.entries(SIGNAL_GROUPS)) {
  for (const code of codes) _SIGNAL_TO_GROUP[code] = group;
}

/** Per-signal surface priority (higher = wins deduplication) */
const SIGNAL_PRIORITIES = {
  MENOMETRORRHAGIA_PATTERN: 5,
  MENORRHAGIA_PATTERN:      4,
  AMENORRHEA_PATTERN:       4,
  EXTENDED_ABSENCE:         3,
  OLIGOMENORRHEA_PATTERN:   3,
  POLYMENORRHEA_PATTERN:    3,
  HYPOMENORRHEA_PATTERN:    2,
  METRORRHAGIA_PATTERN:     2,
};

/** Wrap _makeSignal with advanced-insight extra fields */
function makeAdvancedSignal(p) {
  const base = _makeSignal({ category: "cycle", ...p });
  return {
    ...base,
    id:          base.code,
    priority:    SIGNAL_PRIORITIES[base.code] ?? 1,
    dedupeGroup: _SIGNAL_TO_GROUP[base.code] ?? null,
  };
}

/** Format a Date as "Month Day" (e.g. "March 2") */
function _fmtShort(date) {
  if (!date) return "unknown date";
  try {
    return toDate(date).toLocaleDateString("en-US", { month: "long", day: "numeric" });
  } catch {
    return "unknown date";
  }
}

/**
 * Deduplicate a list of advanced signals.
 * Within each dedupeGroup, only the highest-priority signal is kept.
 * Signals without a group are always kept.
 *
 * @param {Object[]} signals
 * @returns {{ finalSignals: Object[], suppressedSignals: Object[] }}
 */
function dedupeSignals(signals) {
  const LEVEL_NUM = { high: 3, medium: 2, low: 1 };
  const groupMap  = {};

  for (const s of signals) {
    if (!s.dedupeGroup) continue;
    if (!groupMap[s.dedupeGroup]) groupMap[s.dedupeGroup] = [];
    groupMap[s.dedupeGroup].push(s);
  }

  const finalSignals     = signals.filter(s => !s.dedupeGroup); // ungrouped always pass through
  const suppressedSignals = [];

  for (const group of Object.values(groupMap)) {
    group.sort((a, b) =>
      (b.priority - a.priority) ||
      ((LEVEL_NUM[b.level] || 0) - (LEVEL_NUM[a.level] || 0))
    );
    const [keep, ...rest] = group;
    finalSignals.push(keep);
    for (const s of rest) {
      suppressedSignals.push({ id: s.code, reason: "lower_priority_same_group" });
    }
  }

  return { finalSignals, suppressedSignals };
}

/* ── Individual pattern detectors ─────────────────────────────────── */

function _detectAmenorrheaPattern({ lastPeriodStart, today, cycleLengths, settings = {} }) {
  const threshold = settings.amenorrheaDays ?? 90;
  if (!lastPeriodStart) return null;

  const todayD     = startOfDay(toDate(today));
  const lastD      = startOfDay(toDate(lastPeriodStart));
  const daysSince  = diffDays(lastD, todayD);

  if (daysSince < threshold) return null;

  const recent   = lastN(cycleLengths, 6);
  const avgCycle = recent.length >= 2 ? Math.round(mean(recent)) : 28;
  const lastStr  = _fmtShort(lastPeriodStart);
  const months   = Math.floor(daysSince / 30);
  const weeks    = Math.floor(daysSince / 7);
  const timePhrase = months >= 3 ? `about ${months} months` : `roughly ${weeks} weeks`;

  const message =
    `Bloom noticed that your last logged period was on ${lastStr} — ${timePhrase} ago. ` +
    `Based on your cycle history, a gap of ${daysSince} days is significantly longer than your usual spacing of around ${avgCycle} days. ` +
    `Cycles can sometimes pause or shift due to stress, hormonal changes, or other factors. ` +
    `If this kind of extended gap is new for you, it may be worth keeping track and checking in with a healthcare provider if it continues.`;

  return makeAdvancedSignal({
    code:    "AMENORRHEA_PATTERN",
    level:   "high",
    show:    true,
    title:   "Extended gap since last period",
    message,
    debug:   { daysSince, lastPeriodStart: lastStr, avgCycle, threshold },
  });
}

function _detectOligomenorrheaPattern({ cycleLengths }) {
  if (cycleLengths.length < 3) return null;

  const recent     = lastN(cycleLengths, 3);
  const longCycles = recent.filter(c => c > 35);
  if (longCycles.length < 2) return null;

  const avg         = Math.round(mean(recent));
  const cycleSummary = recent.map(c => `${c} days`).join(", ");

  const message =
    `Looking at your last ${recent.length} logged cycles, Bloom noticed that the gaps between your periods have been consistently longer than the typical range. ` +
    `Your recent cycles were ${cycleSummary}, with ${longCycles.length} out of ${recent.length} extending beyond 35 days. ` +
    `An average spacing of around ${avg} days is on the longer side and suggests a more infrequent pattern than your earlier logs. ` +
    `This kind of shift can sometimes happen gradually, so it may be worth keeping an eye on whether the spacing continues.`;

  return makeAdvancedSignal({
    code:    "OLIGOMENORRHEA_PATTERN",
    level:   "medium",
    show:    true,
    title:   "Cycle timing looks more spread out",
    message,
    debug:   { recentCycles: recent, longCount: longCycles.length, avg },
  });
}

function _detectPolymenorrheaPattern({ cycleLengths }) {
  if (cycleLengths.length < 3) return null;

  const recent      = lastN(cycleLengths, 3);
  const shortCycles = recent.filter(c => c < 21);
  if (shortCycles.length < 2) return null;

  const avg         = Math.round(mean(recent));
  const cycleSummary = recent.map(c => `${c} days`).join(", ");

  const message =
    `Bloom noticed that your recent period gaps have been shorter than expected across your last ${recent.length} logged cycles. ` +
    `Your recent cycles were ${cycleSummary}, and ${shortCycles.length} of them came in under 21 days. ` +
    `Cycles averaging around ${avg} days are notably shorter than the typical range of 21–35 days. ` +
    `Consistently short cycles can sometimes signal hormonal changes, so it's worth noting if the pattern continues.`;

  return makeAdvancedSignal({
    code:    "POLYMENORRHEA_PATTERN",
    level:   "medium",
    show:    true,
    title:   "Cycles are coming closer together",
    message,
    debug:   { recentCycles: recent, shortCount: shortCycles.length, avg },
  });
}

function _detectMenorrhagiaPattern({ periodEntries }) {
  if (!Array.isArray(periodEntries) || periodEntries.length === 0) return null;

  const recent      = lastN(periodEntries, 3);
  const longDur     = recent.filter(e => (e.durationDays ?? 0) > 7);
  const heavyFlow   = recent.filter(e =>
    e.flowLevel === "heavy" || e.flowLevel === "very_heavy" || (e.flowScore ?? 0) >= 4
  );

  if (longDur.length === 0 && heavyFlow.length < 2) return null;

  const durations   = recent.filter(e => e.durationDays != null).map(e => e.durationDays);
  const avgDuration = durations.length ? Math.round(mean(durations)) : null;

  let detail;
  if (longDur.length > 0) {
    const durationStr = longDur.map(e => `${e.durationDays} days`).join(" and ");
    detail = `In ${longDur.length > 1 ? "multiple recent cycles" : "a recent cycle"}, your period lasted ${durationStr}, which is longer than the typical 3–7 day range. `;
  } else {
    detail = `Bloom noticed ${heavyFlow.length} of your recent logged periods included heavy or very heavy flow. `;
  }

  const message =
    detail +
    (avgDuration ? `Your average period length across recent logs is around ${avgDuration} days, which runs longer or heavier than what is usually expected. ` : "") +
    `Heavier or longer periods can sometimes be a one-off, but when the pattern repeats it's worth keeping a detailed record. ` +
    `If this is a noticeable change from your earlier cycle history, mentioning it to a healthcare provider can be helpful.`;

  return makeAdvancedSignal({
    code:    "MENORRHAGIA_PATTERN",
    level:   longDur.length > 0 ? "high" : "medium",
    show:    true,
    title:   "Periods appear longer or heavier than usual",
    message,
    debug:   { longDurationCount: longDur.length, heavyFlowCount: heavyFlow.length, avgDuration },
  });
}

function _detectHypomenorrheaPattern({ periodEntries }) {
  if (!Array.isArray(periodEntries) || periodEntries.length < 2) return null;

  const recent      = lastN(periodEntries, 3);
  const lightPeriods = recent.filter(e =>
    (e.durationDays != null && e.durationDays < 2) ||
    e.flowLevel === "light" || e.flowLevel === "very_light" || e.flowLevel === "spotting" ||
    (e.flowScore != null && e.flowScore <= 2)
  );

  if (lightPeriods.length < 2) return null;

  const durations   = recent.filter(e => e.durationDays != null).map(e => e.durationDays);
  const avgDuration = durations.length ? Math.round(mean(durations)) : null;

  const message =
    `Bloom noticed that ${lightPeriods.length} of your recent logged periods have been lighter or shorter than what appeared in your earlier logs. ` +
    (avgDuration
      ? `Your recent periods are averaging around ${avgDuration} day${avgDuration === 1 ? "" : "s"}, which is on the lighter side of the typical range. `
      : "") +
    `Lighter periods can reflect normal variation, but when the pattern repeats it sometimes signals a gradual change in hormonal activity. ` +
    `This is a gentle observation — not a cause for alarm, but something worth continuing to track.`;

  return makeAdvancedSignal({
    code:    "HYPOMENORRHEA_PATTERN",
    level:   "medium",
    show:    true,
    title:   "Periods may be lighter than your usual pattern",
    message,
    debug:   { lightCount: lightPeriods.length, avgDuration },
  });
}

function _detectMetrorrhagiaPattern({ unscheduledBleedingDates }) {
  if (!Array.isArray(unscheduledBleedingDates) || unscheduledBleedingDates.length < 2) return null;

  const recent    = lastN(unscheduledBleedingDates, 3);
  const dateStr   = recent.map(d => _fmtShort(d)).join(", ");

  const message =
    `Bloom noticed bleeding or spotting logged on ${recent.length} occasion${recent.length > 1 ? "s" : ""} that appeared to fall outside your expected period window (${dateStr}). ` +
    `Mid-cycle spotting can sometimes be a normal variation, but when it recurs it is worth keeping close track of the timing. ` +
    `This kind of irregular bleeding can have a range of causes, from hormonal shifts to other factors. ` +
    `If it is happening regularly, it would be worth mentioning to a healthcare provider.`;

  return makeAdvancedSignal({
    code:    "METRORRHAGIA_PATTERN",
    level:   "medium",
    show:    true,
    title:   "Bleeding logged outside expected window",
    message,
    debug:   { unscheduledCount: recent.length, dates: recent.map(d => _fmtShort(d)) },
  });
}

function _detectMenometrorrhagiaPattern({ menorrhagiaSignal, metrorrhagiaSignal }) {
  if (!menorrhagiaSignal || !metrorrhagiaSignal) return null;

  const message =
    `Bloom noticed a combination of two patterns in your recent logs: periods that appear longer or heavier than your earlier baseline, along with bleeding or spotting outside your expected period windows. ` +
    `On their own, each of these can sometimes reflect normal variation — but together they suggest a more significant shift in your cycle's usual behaviour. ` +
    `Tracking dates, flow level, and any other symptoms you notice will give the clearest picture of what's changing. ` +
    `If this combination is new for you, it is worth raising with a healthcare provider.`;

  return makeAdvancedSignal({
    code:    "MENOMETRORRHAGIA_PATTERN",
    level:   "high",
    show:    true,
    title:   "Irregular timing and heavier flow together",
    message,
    debug:   { menorrhagiaTrigger: true, metrorrhagiaTrigger: true },
  });
}

/* ------------------------------------------------------------------ */
/* Advanced Insights engine                                           */
/* ------------------------------------------------------------------ */

/**
 * Generate Advanced Insight signals from period-pattern analysis.
 *
 * Runs all pattern detectors, then deduplicates within signal groups so
 * the UI never surfaces two overlapping cards.
 *
 * @param {Object}  params
 * @param {number[]} params.cycleLengths             - ordered list of cycle lengths in days
 * @param {Date|string|null} params.lastPeriodStart  - most recent period start date
 * @param {Date}    params.today                     - reference date (default: now)
 * @param {Array<{durationDays?: number, flowLevel?: string, flowScore?: number}>} params.periodEntries
 *   - per-period metadata used for menorrhagia / hypomenorrhea detection
 * @param {(Date|string)[]} params.unscheduledBleedingDates
 *   - dates where bleeding was logged outside the expected period window
 * @param {Object}  params.settings                  - optional threshold overrides
 *
 * @returns {{
 *   signals: Object[],
 *   debug: { rawSignals: Object[], suppressedSignals: Object[], selectedSignals: Object[] }
 * }}
 */
export function generateAdvancedInsights({
  cycleLengths            = [],
  lastPeriodStart         = null,
  today                   = new Date(),
  periodEntries           = [],
  unscheduledBleedingDates = [],
  settings                = {},
} = {}) {
  const rawSignals = [];

  const amenorrhea = _detectAmenorrheaPattern({ lastPeriodStart, today, cycleLengths, settings });
  if (amenorrhea) rawSignals.push(amenorrhea);

  const oligo = _detectOligomenorrheaPattern({ cycleLengths });
  if (oligo) rawSignals.push(oligo);

  const poly = _detectPolymenorrheaPattern({ cycleLengths });
  if (poly) rawSignals.push(poly);

  const menorrhagia = _detectMenorrhagiaPattern({ periodEntries });
  if (menorrhagia) rawSignals.push(menorrhagia);

  const hypomenorrhea = _detectHypomenorrheaPattern({ periodEntries });
  if (hypomenorrhea) rawSignals.push(hypomenorrhea);

  const metrorrhagia = _detectMetrorrhagiaPattern({ unscheduledBleedingDates });
  if (metrorrhagia) rawSignals.push(metrorrhagia);

  // Menometrorrhagia fires only when both menorrhagia AND metrorrhagia are detected
  const menometrorrhagia = _detectMenometrorrhagiaPattern({
    menorrhagiaSignal:  menorrhagia,
    metrorrhagiaSignal: metrorrhagia,
  });
  if (menometrorrhagia) rawSignals.push(menometrorrhagia);

  const { finalSignals, suppressedSignals } = dedupeSignals(rawSignals);

  return {
    signals: finalSignals,
    debug: {
      rawSignals:        rawSignals.map(s => ({ id: s.code, group: s.dedupeGroup, priority: s.priority, level: s.level })),
      suppressedSignals,
      selectedSignals:   finalSignals.map(s => ({ id: s.code, group: s.dedupeGroup })),
    },
  };
}
