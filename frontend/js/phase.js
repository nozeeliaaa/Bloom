/**
 * phase.js
 * Shared local cycle phase computation.
 * Mirrors the rule-based fallback logic in dashboard.js / calendar.js.
 * Used by report.js, fertility.js, and any module that needs a cycle state
 * without hitting the backend.
 */

import { toDateKey } from "./utils.js";

function _addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function _daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

/**
 * Compute local rule-based cycle state from a logsByDate map.
 * Returns the same shape as the backend /api/cycles/state response so callers
 * can use either source interchangeably.
 *
 * @param {Object} logs  - { "YYYY-MM-DD": { flow, symptoms, notes, ... } }
 * @returns {Object} cycle state
 */
export function computeCyclePhase(logs) {
  const EMPTY = {
    ready: false, phase: "unknown", phaseLabel: "Unknown",
    dayInCycle: null, avgCycleLength: null, predictedCycleLength: null,
    confidence: { level: "Low", windowDays: 5, message: "Log your first period to see predictions." },
    nextPeriodDate: null, ovulationDate: null, fertileStart: null, fertileEnd: null,
    cyclesLogged: 0, source: "local",
  };

  const periodDays = Object.keys(logs || {})
    .filter(k => { const l = logs[k]; return l && l.flow && l.flow !== "none"; })
    .sort();

  if (!periodDays.length) return EMPTY;

  // Cluster period days (gap > 3 days = new cycle)
  const cStarts = [], cEnds = [];
  let cs = periodDays[0], ce = periodDays[0];
  for (let i = 1; i < periodDays.length; i++) {
    if (_daysBetween(periodDays[i - 1], periodDays[i]) > 3) {
      cStarts.push(cs); cEnds.push(ce); cs = periodDays[i];
    }
    ce = periodDays[i];
  }
  cStarts.push(cs); cEnds.push(ce);

  const lastStart = cStarts[cStarts.length - 1];

  // Cycle lengths from cluster start intervals
  const cycleLengths = [];
  for (let i = 1; i < cStarts.length; i++) {
    cycleLengths.push(_daysBetween(cStarts[i - 1], cStarts[i]));
  }

  const avgCycleLength = cycleLengths.length
    ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length)
    : 28;

  // Weighted-average predicted length (recent cycles count more)
  let predictedCycleLength = avgCycleLength;
  if (cycleLengths.length > 0) {
    const n = cycleLengths.length;
    const weights = Array.from({ length: n }, (_, i) => i + 1);
    const sumW = weights.reduce((a, w) => a + w, 0);
    predictedCycleLength = Math.max(21, Math.min(45, Math.round(
      weights.reduce((a, w, i) => a + w * cycleLengths[i], 0) / sumW
    )));
  }

  // Day in cycle + phase
  const todayKey = toDateKey(new Date());
  const dayInCycle = _daysBetween(lastStart, todayKey) + 1;
  const folEnd = Math.round(predictedCycleLength * 13 / 28);
  const ovDay  = Math.round(predictedCycleLength * 14 / 28);
  const ovEnd  = Math.round(predictedCycleLength * 16 / 28);

  let phase, phaseLabel;
  if (periodDays.includes(todayKey))            { phase = "menstrual";  phaseLabel = "Menstrual";  }
  else if (dayInCycle <= folEnd)                { phase = "follicular"; phaseLabel = "Follicular"; }
  else if (dayInCycle <= ovEnd)                 { phase = "ovulatory";  phaseLabel = "Ovulatory";  }
  else if (dayInCycle <= predictedCycleLength)  { phase = "luteal";     phaseLabel = "Luteal";     }
  else                                          { phase = "luteal";     phaseLabel = "Late Luteal"; }

  const nextPeriodDate  = _addDays(lastStart, predictedCycleLength);
  const ovulationDate   = _addDays(lastStart, ovDay - 1);
  const fertileStart    = _addDays(lastStart, ovDay - 5);
  const fertileEnd      = ovulationDate;

  const confLevel = cycleLengths.length >= 3 ? "Medium" : cycleLengths.length >= 1 ? "Low" : "Low";

  return {
    ready: true,
    phase,
    phaseLabel,
    dayInCycle,
    avgCycleLength,
    predictedCycleLength,
    confidence: { level: confLevel, windowDays: 3, message: "Rule-based estimate from your logged history." },
    nextPeriodDate,
    ovulationDate,
    fertileStart,
    fertileEnd,
    cyclesLogged: cStarts.length,
    source: "local",
  };
}
