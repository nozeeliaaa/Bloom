/**
 * bloom-date-utils.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Natural language date parsing, calendar validation, and cycle date guards.
 *
 * Exported API:
 *   parseNaturalDate(text, today?)  → ParseResult | null
 *   validateCycleDate(params)       → ValidationResult
 *   validateCalendarDate(y, m, d)   → ValidationResult
 *   getLocalToday()                 → Date (local midnight)
 *   computePhaseConfidence(result)  → "low" | "medium" | "high"
 *
 * ParseResult shapes:
 *   { date: Date, approximate: boolean }   - resolved date
 *   { forgotten: true }                    - user doesn't know the date
 *
 * ValidationResult shapes:
 *   { valid: true }
 *   { valid: true, staleData: true, message: string }
 *   { valid: false, message: string }
 */

// ── Month name → 1-based number ────────────────────────────────────────────
const MONTH_MAP = {
  january: 1, february: 2, march: 3,    april: 4,
  may: 5,     june: 6,     july: 7,     august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4,
  jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12,
};

// Days per month (non-leap). Index 0 unused.
const BASE_DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month, year) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return BASE_DAYS[month] || 30;
}

function localMidnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function shiftDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Returns today as a Date at local midnight (timezone-aware). */
export function getLocalToday() {
  return localMidnight(new Date());
}

// ── Forgotten / can't remember patterns ────────────────────────────────────
const FORGOTTEN_RE = /\b(i forgot|i forget|can'?t remember|not sure|i don'?t know|i dont know|mi forget|mi nuh remember|mi cyaan remember|mi nuh sure|no idea)\b/;

// ── parseNaturalDate ────────────────────────────────────────────────────────

/**
 * Attempts to parse a natural-language or relative date expression.
 *
 * @param  {string}  text   - Raw (or normalised) user input
 * @param  {Date}    today  - Reference date (defaults to now)
 * @returns {ParseResult | null}
 *   { date, approximate }  - resolved date
 *   { forgotten: true }    - user can't recall
 *   null                   - not a date expression
 */
export function parseNaturalDate(text, today = new Date()) {
  if (!text || typeof text !== "string") return null;

  const t = text.toLowerCase().trim();
  const base = localMidnight(today);

  // ── Forgotten ──────────────────────────────────────────────────────────
  if (FORGOTTEN_RE.test(t)) return { forgotten: true };

  // ── Exact "today" / "yesterday" ────────────────────────────────────────
  if (/^\btoday\b/.test(t)) return { date: new Date(base), approximate: false };
  if (/\byesterday\b/.test(t)) return { date: shiftDays(base, -1), approximate: false };

  // ── Numeric "N days/weeks ago" ─────────────────────────────────────────
  const numDaysAgo = t.match(/\b(\d+)\s+days?\s+ago\b/);
  if (numDaysAgo) return { date: shiftDays(base, -parseInt(numDaysAgo[1], 10)), approximate: false };

  const numWeeksAgo = t.match(/\b(\d+)\s+weeks?\s+ago\b/);
  if (numWeeksAgo) return { date: shiftDays(base, -parseInt(numWeeksAgo[1], 10) * 7), approximate: false };

  // ── Worded relative expressions ────────────────────────────────────────
  if (/\bone\s+day\s+ago\b/.test(t))                    return { date: shiftDays(base, -1),  approximate: false };
  if (/\btwo\s+days?\s+ago\b/.test(t))                  return { date: shiftDays(base, -2),  approximate: false };
  if (/\bthree\s+days?\s+ago\b/.test(t))                return { date: shiftDays(base, -3),  approximate: false };
  if (/\ba?\s*few\s+days?\s+ago\b/.test(t))             return { date: shiftDays(base, -3),  approximate: true  };
  if (/\b(couple\s+(?:of\s+)?days?)\b/.test(t))         return { date: shiftDays(base, -2),  approximate: true  };
  if (/\b(couple\s+(?:of\s+)?weeks?)\b/.test(t))        return { date: shiftDays(base, -14), approximate: true  };
  if (/\b(a\s+week\s+ago|last\s+week|one\s+week\s+ago)\b/.test(t)) return { date: shiftDays(base, -7),  approximate: false };
  if (/\btwo\s+weeks?\s+ago\b/.test(t))                 return { date: shiftDays(base, -14), approximate: false };
  if (/\b(around|about)\s+two\s+weeks?\s+ago\b/.test(t))return { date: shiftDays(base, -14), approximate: true  };
  if (/\babout\s+a\s+month\s+ago\b/.test(t))            return { date: shiftDays(base, -30), approximate: true  };
  if (/\b(recently|not\s+long\s+ago|nuh\s+long\s+ago)\b/.test(t)) return { date: shiftDays(base, -5), approximate: true };
  if (/\b(di\s+odda\s+day|the\s+other\s+day)\b/.test(t))return { date: shiftDays(base, -3),  approximate: true  };
  if (/\b(di\s+odda\s+week|the\s+other\s+week)\b/.test(t)) return { date: shiftDays(base, -7), approximate: true };
  if (/\ba?\s*long\s+time\s+ago\b/.test(t))             return { date: shiftDays(base, -90), approximate: true  };

  // ── Last month variants ────────────────────────────────────────────────
  const prevMonthDate = new Date(base);
  prevMonthDate.setDate(1);
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const pm   = prevMonthDate.getMonth() + 1;   // 1-based
  const pmY  = prevMonthDate.getFullYear();
  const pmLast = daysInMonth(pm, pmY);

  if (/\bbeginning\s+of\s+last\s+month\b/.test(t)) return { date: new Date(pmY, pm - 1, 1),      approximate: false };
  if (/\bend\s+of\s+last\s+month\b/.test(t))        return { date: new Date(pmY, pm - 1, pmLast), approximate: false };
  if (/\bsometime\s+last\s+month\b/.test(t))        return { date: new Date(pmY, pm - 1, 15),     approximate: true  };
  if (/\blast\s+month\b/.test(t))                   return { date: new Date(pmY, pm - 1, 15),     approximate: true  };

  // ── Named-month expressions ────────────────────────────────────────────
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    if (!new RegExp(`\\b${name}\\b`).test(t)) continue;

    const currYear = today.getFullYear();
    const currMonth = today.getMonth() + 1;
    // Use the most recent past occurrence of this month
    const refYear = currMonth >= num ? currYear : currYear - 1;
    const lastDay = daysInMonth(num, refYear);

    if (new RegExp(`\\b(start\\s+of|beginning\\s+of)\\s+${name}\\b`).test(t))
      return { date: new Date(refYear, num - 1, 1),    approximate: false };
    if (new RegExp(`\\bearly\\s+${name}\\b`).test(t))
      return { date: new Date(refYear, num - 1, 5),    approximate: true  };
    if (new RegExp(`\\bmid(?:-|\\s+)?${name}\\b`).test(t))
      return { date: new Date(refYear, num - 1, 14),   approximate: true  };
    if (new RegExp(`\\bend\\s+of\\s+${name}\\b`).test(t))
      return { date: new Date(refYear, num - 1, lastDay), approximate: false };
    if (new RegExp(`\\blate\\s+${name}\\b`).test(t))
      return { date: new Date(refYear, num - 1, 25),   approximate: true  };

    // Bare month name only - no positional qualifier
    return { date: new Date(refYear, num - 1, 1), approximate: true };
  }

  return null;
}

// ── validateCalendarDate ────────────────────────────────────────────────────

/**
 * Checks for impossible calendar dates (Feb 30, month 13, etc.).
 *
 * @param  {number} year
 * @param  {number} month  1-based
 * @param  {number} day
 * @returns {ValidationResult}
 */
export function validateCalendarDate(year, month, day) {
  if (month < 1 || month > 12) {
    return { valid: false, message: "That date doesn't exist in the calendar 🩷 Try entering it as YYYY-MM-DD, like 2026-02-08." };
  }
  if (day < 1 || day > 31) {
    return { valid: false, message: "That date doesn't exist in the calendar 🩷 Try entering it as YYYY-MM-DD, like 2026-02-08." };
  }
  if (day > daysInMonth(month, year)) {
    return { valid: false, message: "That date doesn't exist in the calendar 🩷 Try entering it as YYYY-MM-DD, like 2026-02-08." };
  }
  return { valid: true };
}

// ── validateCycleDate ───────────────────────────────────────────────────────

/**
 * Validates logical constraints on a date that is being captured as part
 * of a cycle context (LMP, sex date, expected period date, etc.).
 *
 * @param {Object} params
 * @param {Date|string|null} params.date     - The date to validate
 * @param {string}           params.kind     - "lmpDate" | "sexDate" | "expectedPeriodDate"
 * @param {Date}             params.today    - Reference date (defaults to now)
 * @param {Date|null}        params.lmpDate  - Known LMP (used for next-period checks)
 * @returns {ValidationResult}
 */
export function validateCycleDate({
  date,
  kind = "lmpDate",
  today = new Date(),
  lmpDate = null,
} = {}) {
  if (!date) return { valid: false, message: "No date provided." };

  const d = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (isNaN(d.getTime())) {
    return { valid: false, message: "That doesn't look like a valid date 🩷 Try entering it as YYYY-MM-DD, like 2026-02-08." };
  }

  const todayMid = localMidnight(today);

  // ── LMP-specific rules ─────────────────────────────────────────────────
  if (kind === "lmpDate") {
    if (d > todayMid) {
      return {
        valid: false,
        message: "That date is in the future 🩷 Your last period start date should be a past date. When did your most recent period actually start?",
      };
    }

    const twoYearsAgo = shiftDays(todayMid, -730);
    if (d < twoYearsAgo) {
      return {
        valid: true,
        staleData: true,
        message: "Your last logged period was a while ago - logging a more recent one will help Bloom give you better predictions 🩷",
      };
    }
  }

  // ── Next-period / expected-period must be after LMP ────────────────────
  if (kind === "expectedPeriodDate" && lmpDate) {
    const lmp = lmpDate instanceof Date ? lmpDate : new Date(lmpDate);
    if (!isNaN(lmp.getTime()) && d <= lmpDate) {
      return {
        valid: false,
        message: "That date is before your last period start 🩷 Your expected period date should be after your last period.",
      };
    }
  }

  return { valid: true };
}

// ── computePhaseConfidence ──────────────────────────────────────────────────

/**
 * Derives a phaseConfidence level from a parseNaturalDate result.
 * Downstream callers (symptom engine, phase display) should read this.
 *
 * @param  {{ approximate?: boolean, forgotten?: boolean } | null} parseResult
 * @returns {"low" | "medium" | "high"}
 */
export function computePhaseConfidence(parseResult) {
  if (!parseResult || parseResult.forgotten) return "low";
  if (parseResult.approximate) return "low";
  return "high";
}
