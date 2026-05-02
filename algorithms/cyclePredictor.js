/**
 * Bloom - Cycle Prediction Algorithm
 * Weighted OLS Linear Regression with hybrid fallback
 * All outputs are educational estimates, not medical predictions.
 */

function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sanitizePositiveNumbers(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
}

// Converts period start dates into cycle lengths in days
export function deriveCycleLengths(periodStartDates) {
  if (!Array.isArray(periodStartDates) || periodStartDates.length < 2) return [];

  const sorted = periodStartDates
    .map((d) => toValidDate(d))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  if (sorted.length < 2) return [];
  const lengths = [];

  for (let i = 1; i < sorted.length; i++) {
    const diffMs   = sorted[i].getTime() - sorted[i - 1].getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (Number.isFinite(diffDays) && diffDays > 0) lengths.push(diffDays);
  }

  return lengths;
}


// Standard OLS - treats all cycles equally, used as baseline comparison
export function trainLinearRegression(cycleLengths) {
  const safeLengths = sanitizePositiveNumbers(cycleLengths);
  const n = safeLengths.length;
  if (n < 3) throw new Error("Need at least 3 cycle lengths to train.");

  const x = Array.from({ length: n }, (_, i) => i + 1);
  const y = safeLengths;

  const sumX  = x.reduce((a, v) => a + v, 0);
  const sumY  = y.reduce((a, v) => a + v, 0);
  const sumXY = x.reduce((a, v, i) => a + v * y[i], 0);
  const sumX2 = x.reduce((a, v) => a + v * v, 0);

  const denom     = (n * sumX2 - sumX * sumX);
  const slope     = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept, cycleCount: n };
}


// Weighted OLS - recent cycles get higher weights than older ones
// weightMode: "linear" (default) | "exponential" | "equal"
export function trainWeightedLinearRegression(cycleLengths, weightMode = "linear") {
  const safeLengths = sanitizePositiveNumbers(cycleLengths);
  const n = safeLengths.length;
  if (n < 3) throw new Error("Need at least 3 cycle lengths to train.");

  const x = Array.from({ length: n }, (_, i) => i + 1);
  const y = safeLengths;

  let weights;

  if (weightMode === "linear") {
    // e.g. 5 cycles → [1, 2, 3, 4, 5]
    weights = Array.from({ length: n }, (_, i) => i + 1);

  } else if (weightMode === "exponential") {
    // steeper dropoff for older cycles
    const decay = 0.8;
    weights = Array.from({ length: n }, (_, i) => Math.pow(decay, n - 1 - i));

  } else {
    // equal weights - same result as standard OLS
    weights = Array.from({ length: n }, () => 1);
  }

  const sumW   = weights.reduce((a, w) => a + w, 0);
  const sumWX  = weights.reduce((a, w, i) => a + w * x[i], 0);
  const sumWY  = weights.reduce((a, w, i) => a + w * y[i], 0);
  const sumWXY = weights.reduce((a, w, i) => a + w * x[i] * y[i], 0);
  const sumWX2 = weights.reduce((a, w, i) => a + w * x[i] * x[i], 0);

  const denom     = (sumW * sumWX2 - sumWX * sumWX);
  const slope     = denom === 0 ? 0 : (sumW * sumWXY - sumWX * sumWY) / denom;
  const intercept = (sumWY - slope * sumWX) / sumW;

  return { slope, intercept, cycleCount: n, weights, weightMode };
}


// Predicts the next single cycle length
export function predictNextCycleLength(slope, intercept, cycleCount) {
  const safeSlope = Number.isFinite(Number(slope)) ? Number(slope) : 0;
  const safeIntercept = Number.isFinite(Number(intercept)) ? Number(intercept) : 28;
  const safeCount = Number.isFinite(Number(cycleCount)) ? Number(cycleCount) : 0;
  return clampCycleLength(safeSlope * (safeCount + 1) + safeIntercept);
}


// Predicts the next n cycle lengths
export function predictMultipleCycles(slope, intercept, cycleCount, n = 3) {
  const safeN = Math.max(1, Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 3);
  const safeSlope = Number.isFinite(Number(slope)) ? Number(slope) : 0;
  const safeIntercept = Number.isFinite(Number(intercept)) ? Number(intercept) : 28;
  const safeCount = Number.isFinite(Number(cycleCount)) ? Number(cycleCount) : 0;
  return Array.from({ length: safeN }, (_, i) =>
    clampCycleLength(safeSlope * (safeCount + i + 1) + safeIntercept)
  );
}


// Scores prediction reliability based on how consistent past cycles have been
export function getConfidenceLevel(cycleLengths) {
  const safeLengths = sanitizePositiveNumbers(cycleLengths);
  const n = safeLengths.length;
  if (n === 0) {
    return {
      level: "Low",
      windowDays: 5,
      stdDev: null,
      message: "Not enough history yet. Showing a wider estimate window.",
    };
  }
  const mean     = safeLengths.reduce((a, b) => a + b, 0) / n;
  const variance = safeLengths.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / n;
  const stdDev   = Math.sqrt(variance);
  const range    = Math.max(...safeLengths) - Math.min(...safeLengths);

  let level, windowDays, message;

  if (stdDev < 2 && range <= 4) {
    level = "High"; windowDays = 0;
    message = "Your cycle is quite regular. This estimate is fairly reliable.";
  } else if (stdDev < 4 && range <= 7) {
    level = "Medium"; windowDays = 2;
    message = "Your cycle varies slightly. Showing an estimated window.";
  } else {
    level = "Low"; windowDays = 5;
    message = "Your cycle varies significantly. This is a rough estimate only.";
  }

  return { level, windowDays, stdDev: parseFloat(stdDev.toFixed(2)), message };
}


// Calculates all phase dates from a predicted cycle length
const addDays = (date, days) => {
  const base = toValidDate(date) || new Date();
  const safeDays = Number.isFinite(Number(days)) ? Number(days) : 0;
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + safeDays);
  return d;
};

export function calculatePhases(
  lastPeriodStart,
  predictedCycleLength,
  periodDuration    = 5,
  lutealPhaseLength = 14  // biologically fixed at ~14 days
) {
  const safePeriodDuration = Math.max(1, Number.isFinite(Number(periodDuration)) ? Math.round(Number(periodDuration)) : 5);
  const safeLutealLength = Math.max(1, Number.isFinite(Number(lutealPhaseLength)) ? Math.round(Number(lutealPhaseLength)) : 14);
  const cycle = clampCycleLength(predictedCycleLength);
  const nextPeriodStart = addDays(lastPeriodStart, cycle);
  const nextPeriodEnd   = addDays(nextPeriodStart, safePeriodDuration - 1);
  const ovulationDay    = addDays(nextPeriodStart, -safeLutealLength);

  return {
    nextPeriodStart,
    nextPeriodEnd,
    ovulationDay,
    fertileWindow: {
      start: addDays(ovulationDay, -5),  // sperm survives ~5 days
      end:   addDays(ovulationDay,  1),  // egg viable ~1 day after ovulation
    },
    phases: {
      follicular: { start: lastPeriodStart,          end: addDays(ovulationDay, -1)    },
      ovulatory:  { start: ovulationDay,              end: ovulationDay                 },
      luteal:     { start: addDays(ovulationDay, 1),  end: addDays(nextPeriodStart, -1) },
    }
  };
}


// Returns the user's personal luteal phase length, falls back to 14 if not enough data
export function getPersonalLutealPhase(lutealHistory = []) {
  const safe = sanitizePositiveNumbers(lutealHistory);
  if (safe.length < 3) return 14;
  return Math.max(1, Math.round(safe.reduce((a, b) => a + b, 0) / safe.length));
}


// Returns which phase the user is currently in
export function getCurrentPhase(today, lastPeriodStart, lastPeriodEnd, phases) {
  const t = toValidDate(today);
  const pStart = toValidDate(lastPeriodStart);
  const pEnd = toValidDate(lastPeriodEnd);
  const fStart = toValidDate(phases?.follicular?.start);
  const fEnd = toValidDate(phases?.follicular?.end);
  const oStart = toValidDate(phases?.ovulatory?.start);
  const oEnd = toValidDate(phases?.ovulatory?.end);
  const lStart = toValidDate(phases?.luteal?.start);
  const lEnd = toValidDate(phases?.luteal?.end);

  if (!t || !pStart || !pEnd || !fStart || !fEnd || !oStart || !oEnd || !lStart || !lEnd) {
    return "unknown";
  }
  if (t >= pStart && t <= pEnd) return "menstrual";
  if (t >= fStart && t <= fEnd) return "follicular";
  if (t >= oStart && t <= oEnd) return "ovulatory";
  if (t >= lStart && t <= lEnd) return "luteal";
  return "unknown";
}


/**
 * Main function - call this from any component.
 *
 * Hybrid strategy:
 *   0 periods    → ready: false
 *   1-3 cycles   → rule-based average, wide window
 *   4+ cycles    → Weighted OLS (ML)
 *
 * Always check result.ready before accessing predictions.
 * Always display result.disclaimer in the UI.
 *
 * Dates come back as JS Date objects.
 * If reading from Firestore, convert with: timestamp.toDate()
 */
export function runFullPrediction(
  periodStartDates,
  lastPeriodStart,
  lastPeriodEnd,
  monthsAhead            = 3,
  lutealHistory          = [],
  userTypicalCycleLength = 28,
  weightMode             = "linear"
) {
  if (!Array.isArray(periodStartDates) || periodStartDates.length < 1) {
    return {
      ready:        false,
      cyclesLogged: 0,
      message:      "Log your first period start and end date to get an estimate.",
    };
  }

  const safeLastPeriodStart = toValidDate(lastPeriodStart) || toValidDate(periodStartDates[periodStartDates.length - 1]) || new Date();
  const safeLastPeriodEnd = toValidDate(lastPeriodEnd) || safeLastPeriodStart;
  const safeMonthsAhead = Math.max(1, Number.isFinite(Number(monthsAhead)) ? Math.floor(Number(monthsAhead)) : 3);
  const safeTypicalCycleLength = clampCycleLength(userTypicalCycleLength);
  const cycleLengths = deriveCycleLengths(periodStartDates);

  const rawPeriodDuration = Math.round(
    (safeLastPeriodEnd.getTime() - safeLastPeriodStart.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;
  const periodDuration = Math.max(1, Number.isFinite(rawPeriodDuration) ? rawPeriodDuration : 5);

  const confidence = cycleLengths.length < 3
    ? { level: "Low", windowDays: 5, stdDev: null,
        message: "Not enough history yet. Showing a wider estimate window." }
    : getConfidenceLevel(cycleLengths);

  const lutealPhase = getPersonalLutealPhase(lutealHistory);

  // Rule-based baseline
  const ruleBasedLength = clampCycleLength(
    cycleLengths.length > 0
      ? cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length
      : safeTypicalCycleLength
  );

  // Standard OLS for comparison
  let standardOLSLength = ruleBasedLength;
  if (cycleLengths.length >= 3) {
    const { slope, intercept, cycleCount } = trainLinearRegression(cycleLengths);
    standardOLSLength = predictNextCycleLength(slope, intercept, cycleCount);
  }

  // Weighted OLS - primary prediction
  let predictedLengths;
  let weightsUsed    = null;
  let weightModeUsed = "rule-based";

  if (cycleLengths.length >= 3) {
    const weighted = trainWeightedLinearRegression(cycleLengths, weightMode);
    predictedLengths = predictMultipleCycles(
      weighted.slope,
      weighted.intercept,
      weighted.cycleCount,
      safeMonthsAhead
    );
    weightsUsed    = weighted.weights;
    weightModeUsed = weighted.weightMode;
  } else {
    predictedLengths = Array.from({ length: safeMonthsAhead }, () => ruleBasedLength);
  }

  // Chain predictions - each cycle starts where the previous one ends
  const futureCycles = [];
  let   chainStart   = safeLastPeriodStart;

  for (let i = 0; i < predictedLengths.length; i++) {
    const cycleLength  = predictedLengths[i];
    const phases       = calculatePhases(chainStart, cycleLength, periodDuration, lutealPhase);
    const windowGrowth = (confidence.windowDays || 0) * (i + 1);

    futureCycles.push({
      cycleNumber:   (cycleLengths.length + 1) + i,
      cycleLength,
      periodStart:   phases.nextPeriodStart,
      periodEnd:     phases.nextPeriodEnd,
      ovulationDay:  phases.ovulationDay,
      fertileWindow: phases.fertileWindow,
      phases:        phases.phases,
      earliestStart: addDays(phases.nextPeriodStart, -windowGrowth),
      latestStart:   addDays(phases.nextPeriodStart,  windowGrowth),
      isEstimate:    true,
    });

    chainStart = phases.nextPeriodStart;
  }

  const today        = new Date();
  const currentPhase = getCurrentPhase(
    today, safeLastPeriodStart, safeLastPeriodEnd, futureCycles[0]?.phases || {}
  );

  if (!futureCycles.length) {
    return {
      ready: false,
      cyclesLogged: periodStartDates.length,
      message: "Bloom could not generate predictions from the current data.",
      confidence,
      disclaimer: "This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.",
    };
  }

  return {
    ready:         true,
    cyclesLogged:  periodStartDates.length,
    futureCycles,

    // First cycle shortcuts
    predictedCycleLength: predictedLengths[0],
    nextPeriodStart:      futureCycles[0].periodStart,
    nextPeriodEnd:        futureCycles[0].periodEnd,
    earliestDate:         futureCycles[0].earliestStart,
    latestDate:           futureCycles[0].latestStart,
    ovulationDay:         futureCycles[0].ovulationDay,
    fertileWindow:        futureCycles[0].fertileWindow,
    phases:               futureCycles[0].phases,

    currentPhase,
    confidence,
    lutealPhaseUsed: lutealPhase,

    // Three-way comparison for display and documentation
    comparison: {
      ruleBasedAverage: ruleBasedLength,
      standardOLS:      standardOLSLength,
      weightedOLS:      predictedLengths[0],
      weightsUsed,
      weightMode:       weightModeUsed,
    },

    disclaimer: "This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.",
  };
}


// Clamps predicted cycle length to biologically typical range (21-35 days)
function clampCycleLength(value) {
  const v = Math.round(Number(value));
  if (!Number.isFinite(v)) return 28;
  return Math.max(21, Math.min(35, v));
}
