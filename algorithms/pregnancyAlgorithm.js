/**
 * Bloom - Pregnancy-Related Algorithm
 * All outputs are educational estimates, not medical predictions.
 * Always display the disclaimer field to the user.
 */

const DISCLAIMER = "This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.";

function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toSafeCycleLength(value, fallback = 28) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(21, Math.min(45, Math.round(n)));
}

function sanitizePositiveNumbers(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
}

const addDays = (date, days) => {
  const base = toValidDate(date) || new Date();
  const safeDays = Number.isFinite(Number(days)) ? Number(days) : 0;
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + safeDays);
  return d;
};


// 1. CONCEPTION LIKELIHOOD
// Fertile window: ovulation -5 to +1 day
export function conceptionLikelihood(sexDate, ovulationDay) {
  const safeSexDate = toValidDate(sexDate);
  const safeOvulationDay = toValidDate(ovulationDay);
  if (!safeSexDate || !safeOvulationDay) {
    return {
      likelihood: "Possible",
      fertileWindow: { start: null, end: null },
      daysFromOvulation: null,
      withinWindow: false,
      disclaimer: DISCLAIMER,
    };
  }

  const fertileStart = addDays(safeOvulationDay, -5);
  const fertileEnd   = addDays(safeOvulationDay,  1);

  const daysFromOvulation = Math.round(
    (safeSexDate - safeOvulationDay) / (1000 * 60 * 60 * 24)
  );

  const withinWindow = safeSexDate >= fertileStart && safeSexDate <= fertileEnd;

  let likelihood;
  if (withinWindow) {
    likelihood = "Higher";
  } else if (Math.abs(daysFromOvulation) <= 3) {
    likelihood = "Possible";
  } else {
    likelihood = "Lower";
  }

  return {
    likelihood,
    fertileWindow: { start: fertileStart, end: fertileEnd },
    daysFromOvulation,
    withinWindow,
    disclaimer: DISCLAIMER,
  };
}


// 2. WHEN TO TEST
// Uses missed period date if known, otherwise 21-day rule from sex date
export function whenToTest(sexDate, expectedPeriodDate = null) {
  const safeSexDate = toValidDate(sexDate) || new Date();
  const safeExpectedPeriodDate = toValidDate(expectedPeriodDate);
  let primaryTestDate;
  let basis;

  if (safeExpectedPeriodDate) {
    primaryTestDate = addDays(safeExpectedPeriodDate, 1);
    basis           = "missed-period";
  } else {
    primaryTestDate = addDays(safeSexDate, 21);
    basis           = "21-day-rule";
  }

  const retestDate    = addDays(primaryTestDate, 3);
  const earlyTestDate = addDays(safeSexDate, 10); // hCG may be detectable ~10 days post-conception

  const message = basis === "missed-period"
    ? `Test from ${formatDate(primaryTestDate)} - the day after your expected period.`
    : `Test from ${formatDate(primaryTestDate)} - at least 21 days after unprotected sex.`;

  const retestMessage = `If the result is negative but your period hasn't started, retest on ${formatDate(retestDate)}.`;

  return {
    primaryTestDate,
    retestDate,
    earlyTestDate,
    basis,
    message,
    retestMessage,
    disclaimer: DISCLAIMER,
  };
}


// 3. ESTIMATED DUE DATE
// Uses Naegele's Rule: LMP + 280 days, adjusted for non-28-day cycles
export function estimatedDueDate(lmpDate, cycleLength = 28) {
  const safeLmp = toValidDate(lmpDate);
  if (!safeLmp) {
    return {
      edd: null,
      eddAdjusted: null,
      conceptionWindow: { start: null, end: null },
      currentWeek: null,
      trimester: null,
      trimesterLabel: "",
      weeksRemaining: null,
      disclaimer: DISCLAIMER,
    };
  }
  const safeCycleLength = toSafeCycleLength(cycleLength, 28);

  const edd              = addDays(safeLmp, 280);
  const cycleAdjustment  = safeCycleLength - 28;
  const eddAdjusted      = addDays(edd, cycleAdjustment);

  const estimatedOvulation = addDays(safeLmp, 14 + cycleAdjustment);
  const conceptionWindow   = {
    start: addDays(estimatedOvulation, -2),
    end:   addDays(estimatedOvulation,  2),
  };

  const today        = new Date();
  const daysPregnant = Math.floor((today - safeLmp) / (1000 * 60 * 60 * 24));
  const currentWeek  = daysPregnant >= 0 && daysPregnant <= 280
    ? Math.floor(daysPregnant / 7) + 1
    : null;

  let trimester      = null;
  let trimesterLabel = "";
  if (currentWeek !== null) {
    if (currentWeek <= 12)      { trimester = 1; trimesterLabel = "First trimester";  }
    else if (currentWeek <= 26) { trimester = 2; trimesterLabel = "Second trimester"; }
    else                        { trimester = 3; trimesterLabel = "Third trimester";  }
  }

  const weeksRemaining = currentWeek !== null ? Math.max(0, 40 - currentWeek) : null;

  return {
    edd,
    eddAdjusted,
    conceptionWindow,
    currentWeek,
    trimester,
    trimesterLabel,
    weeksRemaining,
    disclaimer: DISCLAIMER,
  };
}


// 4. FERTILITY CONFIDENCE
// Scores fertile window reliability based on cycle variability
// More variability = wider window shown = more honest about uncertainty
export function fertilityConfidence(cycleLengths, ovulationDay) {
  const safeCycleLengths = sanitizePositiveNumbers(cycleLengths);
  const safeOvulationDay = toValidDate(ovulationDay);
  if (!safeOvulationDay) {
    return {
      confidence:         "Low",
      fertileWindowStart: null,
      fertileWindowEnd:   null,
      windowDays:         5,
      stdDev:             null,
      message:            "Not enough data to estimate a reliable fertile window.",
      disclaimer:         DISCLAIMER,
    };
  }

  if (!safeCycleLengths.length || safeCycleLengths.length < 2) {
    return {
      confidence:         "Low",
      fertileWindowStart: addDays(safeOvulationDay, -5),
      fertileWindowEnd:   addDays(safeOvulationDay,  1),
      windowDays:         5,
      stdDev:             null,
      message:            "Not enough cycle history to confirm this window. Treat as a rough estimate.",
      disclaimer:         DISCLAIMER,
    };
  }

  const n        = safeCycleLengths.length;
  const mean     = safeCycleLengths.reduce((a, b) => a + b, 0) / n;
  const variance = safeCycleLengths.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / n;
  const stdDev   = parseFloat(Math.sqrt(variance).toFixed(2));
  const range    = Math.max(...safeCycleLengths) - Math.min(...safeCycleLengths);

  let confidence, windowExtension, message;

  if (stdDev < 2 && range <= 4) {
    confidence      = "High";
    windowExtension = 0;
    message         = "Your cycles are consistent. This fertile window estimate is fairly reliable.";
  } else if (stdDev < 4 && range <= 7) {
    confidence      = "Medium";
    windowExtension = 1;
    message         = "Your cycles vary slightly. The fertile window may shift by a day or two.";
  } else {
    confidence      = "Low";
    windowExtension = 3;
    message         = "Your cycles vary significantly. Treat this as a rough window only.";
  }

  const fertileWindowStart = addDays(safeOvulationDay, -(5 + windowExtension));
  const fertileWindowEnd   = addDays(safeOvulationDay,  (1 + windowExtension));

  return {
    confidence,
    fertileWindowStart,
    fertileWindowEnd,
    windowDays: 5 + windowExtension,
    stdDev,
    message,
    disclaimer: DISCLAIMER,
  };
}


// UTILITY
function formatDate(date) {
  return date?.toLocaleDateString("en-JM", { month: "short", day: "numeric", year: "numeric" }) ?? "-";
}
