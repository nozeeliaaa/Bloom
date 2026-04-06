/**
 * bloom-anomaly-engine.js
 *
 * Statistical anomaly detection for menstrual cycle timing.
 * Educational / wellness support only - not diagnostic.
 *
 * --------------------------------------------------------------------
 * RESEARCH BASIS FOR THE THRESHOLDS IN THIS FILE
 * --------------------------------------------------------------------
 * 1) Clinical baseline for adult cycles:
 *    - Typical cycle length: 21–35 days
 *    - Typical bleeding duration: up to 7 days
 *    Source used in project notes/comments:
 *    - ACOG: Abnormal Uterine Bleeding FAQ
 *
 * 2) Personal cycle variability:
 *    - Large cohort work reports average within-person cycle variability
 *      around 4–6 days across many groups.
 *    Source used in project notes/comments:
 *    - Li et al. (2023), PMC: Menstrual cycle length variation...
 *
 * 3) Statistical anomaly scoring:
 *    - Z-score = (value - mean) / standard deviation
 *    - Common general outlier practice uses SD-based screening.
 *    Source used in project notes/comments:
 *    - NIST Engineering Statistics Handbook
 *
 * DESIGN CHOICES DERIVED FROM THOSE SOURCES
 * --------------------------------------------------------------------
 * - absoluteResidualFloor = 4 days
 *   Why:
 *   A 1–3 day change can easily be ordinary biological fluctuation.
 *   Since population variability is often around 4–6 days, using 4 days
 *   as a minimum floor helps avoid over-flagging tiny shifts while still
 *   catching meaningful deviations early.
 *
 * - anomalyZScoreThreshold = 2.0
 *   Why:
 *   About 2 standard deviations from the mean is a common statistical
 *   threshold for "unusual" observations.
 *
 * - highAnomalyZScoreThreshold = 2.75
 *   Why:
 *   This is stricter than the main alert threshold and is used here as
 *   an "extreme enough to escalate" cutoff without waiting all the way
 *   to 3.0.
 *
 * - minimumCyclesForAnomaly = 4
 *   Why:
 *   Very small histories make mean/SD unstable. We therefore treat
 *   anomaly detection as "not ready" until at least 4 cycles exist.
 *   Even then, results should be interpreted as heuristic rather than
 *   definitive, especially for small samples.
 *
 * - driftSlopeThreshold = 1.0 day/cycle
 *   Why:
 *   We use slope to detect trend over recent cycles, not just average
 *   bias. A slope around 1 day per cycle means cycle timing is shifting
 *   meaningfully over a short run.
 */

const DEFAULT_SETTINGS = {
  anomalyZScoreThreshold: 2.0,
  highAnomalyZScoreThreshold: 2.75,
  minimumCyclesForAnomaly: 4,
  absoluteResidualFloor: 4,
  driftWindow: 4,
  driftSlopeThreshold: 1.0,
  moderateResidualThreshold: 3,
  clusterWindow: 4,
  clusterMinHits: 3,
  variabilityThreshold: 7, // practical marker for clearly irregular spread
};

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanNumericArray(arr) {
  return Array.isArray(arr) ? arr.filter(isFiniteNumber) : [];
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function mean(values) {
  const v = cleanNumericArray(values);
  if (!v.length) return 0;
  return v.reduce((sum, x) => sum + x, 0) / v.length;
}

function stdDev(values) {
  const v = cleanNumericArray(values);
  if (v.length < 2) return 0;
  const m = mean(v);
  const variance = v.reduce((sum, x) => sum + (x - m) ** 2, 0) / (v.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  const v = cleanNumericArray(values).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
}

function lastN(values, n) {
  return Array.isArray(values) ? values.slice(-n) : [];
}

function makeSignal({
  code,
  level = "low",
  show = false,
  title = "",
  message = "",
  guidance = "",
  category = "anomaly",
  debug = {},
}) {
  return { code, level, show, title, message, guidance, category, debug };
}

/**
 * Error function approximation.
 * Used for normal CDF approximation so we can convert z-scores into
 * two-tailed probability-like rarity scores.
 */
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const ax = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax));

  return sign * y;
}

function normalCDF(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

/**
 * Two-tailed rarity score under a normal approximation.
 * Not a Bayesian posterior.
 *
 * Interpretation:
 * - smaller tail probability => more unusual residual
 */
function twoTailedProbFromZ(zScore) {
  return 2 * (1 - normalCDF(Math.abs(zScore)));
}

/**
 * Resolve expected values for each actual cycle.
 * Best case: pass predictedHistory aligned to actualCycleLengths.
 * Fallback: use a single predictedCycleLength repeated across cycles.
 */
function resolvePredictedHistory({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
}) {
  const actuals = cleanNumericArray(actualCycleLengths);
  const explicit = cleanNumericArray(predictedHistory);

  if (explicit.length >= actuals.length) {
    return explicit.slice(0, actuals.length);
  }

  if (isFiniteNumber(predictedCycleLength) && actuals.length > 0) {
    return Array.from({ length: actuals.length }, () => predictedCycleLength);
  }

  return [];
}

/**
 * residual = actual - expected
 *
 * This follows a standard anomaly framework:
 * anomaly = observed value - baseline value
 *
 * In this project:
 * - observed value  = actual cycle length
 * - baseline value  = predicted / expected cycle length
 */
export function computeResidualSeries({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
}) {
  const actuals = cleanNumericArray(actualCycleLengths);
  const expecteds = resolvePredictedHistory({
    actualCycleLengths: actuals,
    predictedHistory,
    predictedCycleLength,
  });

  const n = Math.min(actuals.length, expecteds.length);
  const residuals = [];

  for (let i = 0; i < n; i++) {
    residuals.push({
      index: i,
      actual: actuals[i],
      expected: expecteds[i],
      residual: actuals[i] - expecteds[i],
      absResidual: Math.abs(actuals[i] - expecteds[i]),
    });
  }

  return residuals;
}

/**
 * Compute slope using simple least squares over equally spaced points.
 * We use slope for drift because mean residual only shows average bias,
 * while slope shows whether cycles are trending longer/shorter over time.
 */
export function computeSlope(values = []) {
  const y = cleanNumericArray(values);
  const n = y.length;
  if (n < 2) return 0;

  const xMean = (n - 1) / 2;
  const yMean = mean(y);

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (y[i] - yMean);
    denominator += (i - xMean) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Personal baseline stats from earlier residuals.
 *
 * Important:
 * If enough data exists, we exclude the latest point from baseline
 * calculation so we evaluate the newest cycle against prior behavior.
 */
export function computeResidualBaseline(residualSeries = []) {
  const series = Array.isArray(residualSeries) ? residualSeries : [];
  if (series.length < 2) {
    return {
      ready: false,
      count: series.length,
      meanResidual: 0,
      stdResidual: 0,
      medianAbsResidual: 0,
      note: "Too little history for a stable baseline.",
    };
  }

  const baselineSlice =
    series.length >= 4 ? series.slice(0, -1) : series;

  const residuals = baselineSlice.map(r => r.residual);
  const absResiduals = baselineSlice.map(r => Math.abs(r.residual));

  return {
    ready: residuals.length >= 2,
    count: residuals.length,
    meanResidual: round(mean(residuals)),
    stdResidual: round(stdDev(residuals)),
    medianAbsResidual: round(median(absResiduals)),
    note:
      residuals.length < 4
        ? "Small sample: anomaly scoring is heuristic."
        : "Baseline computed from prior residual behavior.",
  };
}

export function scoreLatestResidual({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
}) {
  const residualSeries = computeResidualSeries({
    actualCycleLengths,
    predictedHistory,
    predictedCycleLength,
  });

  if (!residualSeries.length) {
    return {
      ready: false,
      reason: "No aligned actual/predicted cycle history.",
      residualSeries: [],
      latest: null,
      baseline: null,
      zScore: null,
      tailProb: null,
      anomalyLikelihood: null,
    };
  }

  const latest = residualSeries[residualSeries.length - 1];
  const baseline = computeResidualBaseline(residualSeries);

  if (!baseline.ready || baseline.stdResidual === 0) {
    return {
      ready: false,
      reason:
        baseline.count < 2
          ? "Not enough residual history for scoring."
          : "Residual spread is zero; z-score not meaningful yet.",
      residualSeries,
      latest,
      baseline,
      zScore: null,
      tailProb: null,
      anomalyLikelihood: null,
    };
  }

  const zScore = (latest.residual - baseline.meanResidual) / baseline.stdResidual;
  const tailProb = twoTailedProbFromZ(zScore);

  return {
    ready: true,
    reason: null,
    residualSeries,
    latest,
    baseline,
    zScore: round(zScore),
    tailProb: round(tailProb, 4),
    anomalyLikelihood: round(1 - tailProb, 4),
  };
}

/**
 * Point anomaly:
 * latest cycle is unusually different from expected
 */
export function detectCycleLengthAnomalySignal({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
  settings = {},
}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const actuals = cleanNumericArray(actualCycleLengths);

  if (actuals.length < s.minimumCyclesForAnomaly) {
    return makeSignal({
      code: "CYCLE_LENGTH_ANOMALY",
      level: "low",
      show: false,
      title: "Anomaly check not ready",
      message:
        "More cycle history is needed before statistical anomaly checks become meaningful.",
      debug: {
        actualCycleCount: actuals.length,
        minimumCyclesForAnomaly: s.minimumCyclesForAnomaly,
      },
    });
  }

  const scored = scoreLatestResidual({
    actualCycleLengths: actuals,
    predictedHistory,
    predictedCycleLength,
  });

  if (!scored.ready) {
    return makeSignal({
      code: "CYCLE_LENGTH_ANOMALY",
      level: "low",
      show: false,
      title: "Anomaly check not ready",
      message:
        "The system does not yet have a stable enough residual baseline to score this cycle reliably.",
      debug: {
        reason: scored.reason,
        baseline: scored.baseline,
      },
    });
  }

  const { latest, baseline, zScore, tailProb, anomalyLikelihood } = scored;
  const absResidual = Math.abs(latest.residual);

  /**
   * Why combine z-score + absolute residual floor?
   * - z-score alone can overreact when variance is tiny
   * - absolute floor prevents flagging tiny day-level changes
   * So we require both "statistically unusual" and "practically noticeable"
   */
  const isAnomalous =
    Math.abs(zScore) >= s.anomalyZScoreThreshold &&
    absResidual >= s.absoluteResidualFloor;

  if (!isAnomalous) {
    return makeSignal({
      code: "CYCLE_LENGTH_ANOMALY",
      level: "low",
      show: false,
      title: "No major anomaly detected",
      message:
        "The latest cycle does not stand out strongly from the recent personal baseline.",
      debug: {
        zScore,
        residual: round(latest.residual),
        absResidual: round(absResidual),
        tailProb,
        anomalyLikelihood,
        baseline,
      },
    });
  }

  const level =
    Math.abs(zScore) >= s.highAnomalyZScoreThreshold ? "high" : "medium";

  const direction = latest.residual > 0 ? "longer" : "shorter";

  return makeSignal({
    code: "CYCLE_LENGTH_ANOMALY",
    level,
    show: true,
    title: "Cycle timing looks unusually different",
    message:
      `The most recent cycle was noticeably ${direction} than expected based on the recent personal pattern.`,
    guidance:
      "Keep logging the next few cycles so the system can determine whether this was a one-off shift or part of a new pattern.",
    debug: {
      actual: latest.actual,
      expected: round(latest.expected),
      residual: round(latest.residual),
      absResidual: round(absResidual),
      zScore,
      tailProb,
      anomalyLikelihood,
      baseline,
      thresholds: {
        anomalyZScoreThreshold: s.anomalyZScoreThreshold,
        highAnomalyZScoreThreshold: s.highAnomalyZScoreThreshold,
        absoluteResidualFloor: s.absoluteResidualFloor,
      },
    },
  });
}

/**
 * Drift anomaly:
 * recent residuals are trending upward/downward over time
 */
export function detectResidualDriftSignal({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
  settings = {},
}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const residualSeries = computeResidualSeries({
    actualCycleLengths,
    predictedHistory,
    predictedCycleLength,
  });

  if (residualSeries.length < s.driftWindow) {
    return makeSignal({
      code: "RESIDUAL_DRIFT",
      level: "low",
      show: false,
      title: "Drift check not ready",
      message: "More recent cycles are needed to estimate trend.",
      debug: {
        residualCount: residualSeries.length,
        driftWindow: s.driftWindow,
      },
    });
  }

  const recent = lastN(residualSeries, s.driftWindow);
  const residuals = recent.map(r => r.residual);
  const slope = round(computeSlope(residuals));
  const avgResidual = round(mean(residuals));

  const hasDrift = Math.abs(slope) >= s.driftSlopeThreshold;

  if (!hasDrift) {
    return makeSignal({
      code: "RESIDUAL_DRIFT",
      level: "low",
      show: false,
      title: "No clear drift detected",
      message: "Recent cycles do not show a strong directional shift.",
      debug: {
        residuals: residuals.map(r => round(r)),
        avgResidual,
        slope,
        driftSlopeThreshold: s.driftSlopeThreshold,
      },
    });
  }

  const direction = slope > 0 ? "longer over time" : "shorter over time";

  return makeSignal({
    code: "RESIDUAL_DRIFT",
    level: "medium",
    show: true,
    title: "Cycle pattern may be shifting",
    message:
      `Recent cycles show a directional trend, with timing becoming ${direction} relative to expectation.`,
    guidance:
      "Continue logging consistently. Repeated drift can indicate that the personal baseline should be updated.",
    debug: {
      residuals: residuals.map(r => round(r)),
      avgResidual,
      slope,
      driftWindow: s.driftWindow,
      driftSlopeThreshold: s.driftSlopeThreshold,
    },
  });
}

/**
 * Cluster anomaly:
 * repeated moderate deviations across recent cycles
 */
export function detectDeviationClusterSignal({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
  settings = {},
}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const residualSeries = computeResidualSeries({
    actualCycleLengths,
    predictedHistory,
    predictedCycleLength,
  });

  if (residualSeries.length < s.clusterWindow) {
    return makeSignal({
      code: "DEVIATION_CLUSTER",
      level: "low",
      show: false,
      title: "Cluster check not ready",
      message: "More residual history is needed to evaluate repeated deviations.",
      debug: {
        residualCount: residualSeries.length,
        clusterWindow: s.clusterWindow,
      },
    });
  }

  const recent = lastN(residualSeries, s.clusterWindow);
  const hits = recent.filter(r => Math.abs(r.residual) >= s.moderateResidualThreshold);

  if (hits.length < s.clusterMinHits) {
    return makeSignal({
      code: "DEVIATION_CLUSTER",
      level: "low",
      show: false,
      title: "No deviation cluster detected",
      message: "Recent cycles do not show repeated moderate deviations.",
      debug: {
        hitCount: hits.length,
        clusterMinHits: s.clusterMinHits,
        moderateResidualThreshold: s.moderateResidualThreshold,
      },
    });
  }

  return makeSignal({
    code: "DEVIATION_CLUSTER",
    level: "medium",
    show: true,
    title: "Recent cycles have been consistently off-pattern",
    message:
      "Several recent cycles were moderately different from expected timing, suggesting more than a one-cycle fluctuation.",
    guidance:
      "Keep tracking upcoming cycles and relevant context such as stress, travel, illness, medication changes, or lifestyle shifts.",
    debug: {
      recentResiduals: recent.map(r => round(r.residual)),
      hitCount: hits.length,
      clusterWindow: s.clusterWindow,
      clusterMinHits: s.clusterMinHits,
      moderateResidualThreshold: s.moderateResidualThreshold,
    },
  });
}

/**
 * Variability signal:
 * checks whether cycle spread itself is getting large
 *
 * Why threshold ~7 days?
 * This is a practical rule-of-thumb marker for clearly irregular spread,
 * sitting above the smaller 4–6 day variability often seen in many groups.
 */
export function detectHighVariabilitySignal({
  actualCycleLengths = [],
  settings = {},
}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const cycles = cleanNumericArray(actualCycleLengths);

  if (cycles.length < s.minimumCyclesForAnomaly) {
    return makeSignal({
      code: "HIGH_CYCLE_VARIABILITY",
      level: "low",
      show: false,
      title: "Variability check not ready",
      message: "More cycle history is needed to estimate spread reliably.",
      debug: {
        cycleCount: cycles.length,
      },
    });
  }

  const variability = round(stdDev(cycles));
  const isHigh = variability >= s.variabilityThreshold;

  if (!isHigh) {
    return makeSignal({
      code: "HIGH_CYCLE_VARIABILITY",
      level: "low",
      show: false,
      title: "No high variability detected",
      message: "Cycle lengths are not showing unusually high spread right now.",
      debug: {
        variability,
        variabilityThreshold: s.variabilityThreshold,
      },
    });
  }

  return makeSignal({
    code: "HIGH_CYCLE_VARIABILITY",
    level: "medium",
    show: true,
    title: "Cycle variability is elevated",
    message:
      "Recent cycle lengths show a wider spread than expected, which may reflect an irregular pattern.",
    guidance:
      "Track a few more cycles to see whether the variability persists.",
    debug: {
      variability,
      variabilityThreshold: s.variabilityThreshold,
    },
  });
}

/**
 * Simple descriptive mapping to non-diagnostic pattern labels.
 * This avoids claiming a diagnosis.
 */
export function summarizeCyclePattern(actualCycleLengths = []) {
  const cycles = cleanNumericArray(actualCycleLengths);
  if (!cycles.length) {
    return {
      avgCycleLength: null,
      variability: null,
      patternLabel: "insufficient data",
    };
  }

  const avgCycleLength = round(mean(cycles));
  const variability = round(stdDev(cycles));

  let patternLabel = "within expected range";

  if (avgCycleLength > 35) patternLabel = "pattern resembles infrequent cycles";
  else if (avgCycleLength < 21) patternLabel = "pattern resembles frequent cycles";
  else if (variability >= 7) patternLabel = "pattern resembles irregular cycles";

  return {
    avgCycleLength,
    variability,
    patternLabel,
  };
}

/**
 * Main engine
 */
export function generateAnomalySignals({
  actualCycleLengths = [],
  predictedHistory = [],
  predictedCycleLength = null,
  settings = {},
}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const signals = [
    detectCycleLengthAnomalySignal({
      actualCycleLengths,
      predictedHistory,
      predictedCycleLength,
      settings: s,
    }),
    detectResidualDriftSignal({
      actualCycleLengths,
      predictedHistory,
      predictedCycleLength,
      settings: s,
    }),
    detectDeviationClusterSignal({
      actualCycleLengths,
      predictedHistory,
      predictedCycleLength,
      settings: s,
    }),
    detectHighVariabilitySignal({
      actualCycleLengths,
      settings: s,
    }),
  ];

  const shownSignals = signals.filter(signal => signal.show);

  const priority = { high: 3, medium: 2, low: 1 };
  const topSignal =
    shownSignals.sort((a, b) => (priority[b.level] || 0) - (priority[a.level] || 0))[0] ||
    null;

  const residualSeries = computeResidualSeries({
    actualCycleLengths,
    predictedHistory,
    predictedCycleLength,
  });

  const baseline = computeResidualBaseline(residualSeries);
  const patternSummary = summarizeCyclePattern(actualCycleLengths);

  return {
    anomalyDetected: shownSignals.length > 0,
    signals,
    shownSignals,
    topSignal,
    stats: {
      cycleCount: cleanNumericArray(actualCycleLengths).length,
      residualCount: residualSeries.length,
      meanResidual: baseline.meanResidual,
      stdResidual: baseline.stdResidual,
      latestResidual: residualSeries.length
        ? round(residualSeries[residualSeries.length - 1].residual)
        : null,
      patternSummary,
    },
    methods: {
      pointAnomaly: "Residual-based anomaly using z-score + absolute residual floor",
      drift: "Least-squares slope over recent residuals",
      cluster: "Repeated moderate deviations in recent cycles",
      variability: "Standard deviation of cycle lengths",
    },
    referencesUsedInComments: [
      "ACOG: typical adult cycle about 21–35 days; period duration up to 7 days",
      "Li et al. 2023: within-person cycle variability often around 4–6 days",
      "NIST: z-score is standard deviations from the mean",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Example usage
/* ------------------------------------------------------------------ */
/*
const result = generateAnomalySignals({
  actualCycleLengths: [28, 29, 31, 27, 35, 28],
  predictedHistory:   [28, 28, 29, 29, 30, 30],
});

console.log(JSON.stringify(result, null, 2));
*/