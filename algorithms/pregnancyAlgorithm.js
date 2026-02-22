/**
 * Bloom — Pregnancy-Related Algorithm
 * All outputs are educational estimates, not medical predictions.
 * Always display the disclaimer field to the user.
 */

const DISCLAIMER = "This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.";

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};


// 1. CONCEPTION LIKELIHOOD
// Fertile window: ovulation -5 to +1 day
export function conceptionLikelihood(sexDate, ovulationDay) {
  const fertileStart = addDays(ovulationDay, -5);
  const fertileEnd   = addDays(ovulationDay,  1);

  const daysFromOvulation = Math.round(
    (sexDate - ovulationDay) / (1000 * 60 * 60 * 24)
  );

  const withinWindow = sexDate >= fertileStart && sexDate <= fertileEnd;

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
  let primaryTestDate;
  let basis;

  if (expectedPeriodDate) {
    primaryTestDate = addDays(expectedPeriodDate, 1);
    basis           = "missed-period";
  } else {
    primaryTestDate = addDays(sexDate, 21);
    basis           = "21-day-rule";
  }

  const retestDate    = addDays(primaryTestDate, 3);
  const earlyTestDate = addDays(sexDate, 10); // hCG may be detectable ~10 days post-conception

  const message = basis === "missed-period"
    ? `Test from ${formatDate(primaryTestDate)} — the day after your expected period.`
    : `Test from ${formatDate(primaryTestDate)} — at least 21 days after unprotected sex.`;

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
  const edd              = addDays(lmpDate, 280);
  const cycleAdjustment  = cycleLength - 28;
  const eddAdjusted      = addDays(edd, cycleAdjustment);

  const estimatedOvulation = addDays(lmpDate, 14 + cycleAdjustment);
  const conceptionWindow   = {
    start: addDays(estimatedOvulation, -2),
    end:   addDays(estimatedOvulation,  2),
  };

  const today        = new Date();
  const daysPregnant = Math.floor((today - lmpDate) / (1000 * 60 * 60 * 24));
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
  if (!cycleLengths || cycleLengths.length < 2) {
    return {
      confidence:         "Low",
      fertileWindowStart: addDays(ovulationDay, -5),
      fertileWindowEnd:   addDays(ovulationDay,  1),
      windowDays:         5,
      stdDev:             null,
      message:            "Not enough cycle history to confirm this window. Treat as a rough estimate.",
      disclaimer:         DISCLAIMER,
    };
  }

  const n        = cycleLengths.length;
  const mean     = cycleLengths.reduce((a, b) => a + b, 0) / n;
  const variance = cycleLengths.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / n;
  const stdDev   = parseFloat(Math.sqrt(variance).toFixed(2));
  const range    = Math.max(...cycleLengths) - Math.min(...cycleLengths);

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

  const fertileWindowStart = addDays(ovulationDay, -(5 + windowExtension));
  const fertileWindowEnd   = addDays(ovulationDay,  (1 + windowExtension));

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
  return date?.toLocaleDateString("en-JM", { month: "short", day: "numeric", year: "numeric" }) ?? "—";
}