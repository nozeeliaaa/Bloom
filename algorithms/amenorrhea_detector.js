/*
 * amenorrhea-detector.js
 * ─────────────────────────────────────────────────────────────
 * Missed period / extended gap detector for Bloom.
 *
 * This keeps the original detection logic and predicted-window support,
 * but trims the dashboard output down to a short message so the UI
 * does not stretch with long educational content.
 */

/**
 * @typedef {Object} PredictionWindow
 * @property {Date|number|string} start - predicted earliest next period start
 * @property {Date|number|string} end   - predicted latest next period start (end of window)
 */

/**
 * @typedef {Object} AmenorrheaAlert
 * @property {boolean} show
 * @property {"none"|"late"|"extended"} level
 * @property {string} title
 * @property {string[]} messages
 * @property {string[]} suggestedActions
 * @property {Array<{ label: string, url: string }>} resources
 * @property {{
 *   daysLate?: number,
 *   daysSinceLastPeriod?: number,
 *   predictedWindow?: { startISO: string, endISO: string }
 * }} debug
 */

/** Convert Date|number|string to a Date (local time) safely */
function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date input: ${value}`);
  return d;
}

/** Normalize to local midnight to avoid off-by-one due to hours/timezones */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole-day difference between dates (b - a) in days */
function diffDays(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / msPerDay);
}

/**
 * Missed period / amenorrhea detector.
 *
 * @param {Object} params
 * @param {PredictionWindow} params.expectedNextPeriodWindow
 * @param {Date|number|string} params.today
 * @param {Date|number|string|null} params.lastPeriodStart - last logged period start date
 * @param {number|null} [params.userAge] - optional, kept for compatibility
 * @param {number} [params.graceDays=14] - days after predicted window end to consider "late"
 * @param {number} [params.extendedAbsenceDays=90] - days since last period to consider "extended absence"
 * @param {number} [params.perimenopauseAgeGate=40] - optional, kept for compatibility
 * @param {boolean} [params.hasPregnancyRiskLog=false] - optional, kept for compatibility
 *
 * @returns {AmenorrheaAlert}
 */
export function detectAmenorrheaAlert(params) {
  const {
    expectedNextPeriodWindow,
    today,
    lastPeriodStart,
    userAge = null,
    graceDays = 14,
    extendedAbsenceDays = 90,
    perimenopauseAgeGate = 40,
    hasPregnancyRiskLog = false,
  } = params;

  // kept so the function signature stays compatible even if unused for dashboard
  void userAge;
  void perimenopauseAgeGate;
  void hasPregnancyRiskLog;

  if (!expectedNextPeriodWindow?.end) {
    throw new Error("expectedNextPeriodWindow.end is required");
  }

  const todayD = startOfDay(toDate(today));
  const windowStart = expectedNextPeriodWindow.start
    ? startOfDay(toDate(expectedNextPeriodWindow.start))
    : null;
  const windowEnd = startOfDay(toDate(expectedNextPeriodWindow.end));

  // If user has never logged a period, we can't do a "missed period" check reliably.
  if (!lastPeriodStart) {
    return {
      show: false,
      level: "none",
      title: "",
      messages: [],
      suggestedActions: [],
      resources: [],
      debug: {
        predictedWindow: {
          startISO: windowStart ? windowStart.toISOString() : "",
          endISO: windowEnd.toISOString(),
        },
      },
    };
  }

  const lastPeriodD = startOfDay(toDate(lastPeriodStart));

  const daysPastWindowEnd = diffDays(windowEnd, todayD); // positive if today after windowEnd
  const daysLate = Math.max(0, daysPastWindowEnd - graceDays);
  const daysSinceLast = diffDays(lastPeriodD, todayD);

  const isLate = daysPastWindowEnd > graceDays;
  const isExtended = daysSinceLast >= extendedAbsenceDays;

  // Highest severity wins
  const level = isExtended ? "extended" : isLate ? "late" : "none";

  if (level === "none") {
    return {
      show: false,
      level: "none",
      title: "",
      messages: [],
      suggestedActions: [],
      resources: [],
      debug: {
        daysLate: 0,
        daysSinceLastPeriod: daysSinceLast,
        predictedWindow: {
          startISO: windowStart ? windowStart.toISOString() : "",
          endISO: windowEnd.toISOString(),
        },
      },
    };
  }

  const messages =
    level === "late"
      ? [
          "Bloom noticed your period may be later than expected based on your predicted cycle window.",
        ]
      : [
          "Bloom noticed a longer-than-expected gap since your last logged period.",
        ];

  const suggestedActions = [];
  const resources = [];

  const title = level === "late" ? "Period seems late" : "Extended gap since last period";

  return {
    show: true,
    level,
    title,
    messages,
    suggestedActions,
    resources,
    debug: {
      daysLate: level === "late" ? daysLate : undefined,
      daysSinceLastPeriod: daysSinceLast,
      predictedWindow: {
        startISO: windowStart ? windowStart.toISOString() : "",
        endISO: windowEnd.toISOString(),
      },
    },
  };
}

/**
 * OPTIONAL helper:
 * Track Changes mode template you can store in Firebase when user taps "Enable Track Changes".
 * This is not required, but it makes your feature concrete in your system design.
 */
export function buildTrackChangesPlan({ today = new Date() } = {}) {
  const t = startOfDay(toDate(today));
  const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

  return {
    enabled: true,
    startDateISO: t.toISOString(),
    endDateISO: addDays(t, 28).toISOString(), // 4 weeks
    prompts: [
      { dayOffset: 0, text: "Log any bleeding/spotting today (if any)." },
      { dayOffset: 3, text: "How is your stress/sleep? Any changes this week?" },
      { dayOffset: 7, text: "Log symptoms and note any major routine changes (travel, illness, exercise)." },
      { dayOffset: 14, text: "If your period still hasn’t started, consider reviewing your test timing or checking in with a clinician." },
      { dayOffset: 21, text: "Keep tracking: changes over time help Bloom improve its predictions." },
      { dayOffset: 28, text: "Track Changes check-in complete. You can continue or export a summary for yourself." },
    ],
  };
}