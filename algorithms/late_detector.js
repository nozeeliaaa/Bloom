/*
 * bloom-missed-period-detector.js
 * ─────────────────────────────────────────────────────────────
 * Detects when a user has not logged a period within the
 * predicted next-period window.
 *
 * This function is designed for notification/dashboard signals
 * rather than full educational guidance.
 */

/**
 * @typedef {Object} PredictionWindow
 * @property {Date|number|string} start
 * @property {Date|number|string} end
 */

/**
 * @typedef {Object} MissedPeriodNotification
 * @property {boolean} show
 * @property {"none"|"missed"} level
 * @property {string} message
 * @property {{
 *   daysLate?: number,
 *   predictedWindow?: { startISO: string, endISO: string }
 * }} debug
 */

/** Convert input to Date safely */
function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date input: ${value}`);
  }
  return d;
}

/** Normalize date to midnight */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Calculate day difference */
function diffDays(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / msPerDay);
}

/**
 * Detect missed period notification.
 *
 * @param {Object} params
 * @param {PredictionWindow} params.expectedNextPeriodWindow
 * @param {Date|number|string} params.today
 * @param {Date|number|string|null} params.lastPeriodStart
 * @param {number} [params.graceDays=5]
 *
 * @returns {MissedPeriodNotification}
 */
export function detectMissedPeriodNotification(params) {
  const {
    expectedNextPeriodWindow,
    today,
    lastPeriodStart,
    graceDays = 5,
  } = params;

  if (!expectedNextPeriodWindow?.end) {
    throw new Error("expectedNextPeriodWindow.end is required");
  }

  const todayD = startOfDay(toDate(today));
  const windowStart = expectedNextPeriodWindow.start
    ? startOfDay(toDate(expectedNextPeriodWindow.start))
    : null;
  const windowEnd = startOfDay(toDate(expectedNextPeriodWindow.end));

  // If user never logged a period, we can't detect a missed one
  if (!lastPeriodStart) {
    return {
      show: false,
      level: "none",
      message: "",
      debug: {
        predictedWindow: {
          startISO: windowStart ? windowStart.toISOString() : "",
          endISO: windowEnd.toISOString(),
        },
      },
    };
  }

  const daysPastWindowEnd = diffDays(windowEnd, todayD);
  const daysLate = Math.max(0, daysPastWindowEnd - graceDays);

  const isMissed = daysPastWindowEnd > graceDays;

  if (!isMissed) {
    return {
      show: false,
      level: "none",
      message: "",
      debug: {
        daysLate: 0,
        predictedWindow: {
          startISO: windowStart ? windowStart.toISOString() : "",
          endISO: windowEnd.toISOString(),
        },
      },
    };
  }

  return {
    show: true,
    level: "missed",

    // This is the short dashboard notification text
    message:
      "Bloom noticed that a period has not been logged within your expected cycle window. If your period has started, consider logging it so your cycle predictions stay accurate.",

    debug: {
      daysLate,
      predictedWindow: {
        startISO: windowStart ? windowStart.toISOString() : "",
        endISO: windowEnd.toISOString(),
      },
    },
  };
}