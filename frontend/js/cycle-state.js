/**
 * cycle-state.js - Shared cycle-state resolver
 *
 * Exports fetchCycleState - the single source of truth for current cycle phase,
 * ML prediction, and confidence. Used by dashboard.js, report.js, and any other
 * page that needs authoritative cycle data without duplicating the logic.
 *
 * Behaviour:
 *   1. Tries POST /api/cycles/state (ML backend) when the user has an auth token.
 *   2. Falls back to _localCycleState() (rule-based weighted-average) otherwise.
 *   3. Caches the result in sessionStorage for 6 hours (same key scheme as before).
 */

import { getIdToken } from "./auth.js";
import { toDateKey }  from "./utils.js";

// ── Private date helpers ──────────────────────────────────────────────────────
function _addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function _daysBetween(a, b) {
  return Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00")) / 86400000);
}

// ── Local rule-based fallback ──────────────────────────────────────────────────
// Mirrors the logic in dashboard.js. Always returns a state object with
// ready:true when ≥1 period day is logged, so the UI shows a low-confidence
// estimate rather than an empty state.
export function _localCycleState(logs) {
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
    if (_daysBetween(periodDays[i-1], periodDays[i]) > 3) {
      cStarts.push(cs); cEnds.push(ce); cs = periodDays[i];
    }
    ce = periodDays[i];
  }
  cStarts.push(cs); cEnds.push(ce);
  const lastStart = cStarts[cStarts.length - 1];

  // Cycle lengths from cluster intervals
  const cycleLengths = [];
  for (let i = 1; i < cStarts.length; i++) cycleLengths.push(_daysBetween(cStarts[i-1], cStarts[i]));
  const avgCycleLength = cycleLengths.length
    ? Math.round(cycleLengths.reduce((a,b) => a+b, 0) / cycleLengths.length) : 28;

  // Weighted-average predicted length (recency-weighted)
  let predictedCycleLength = avgCycleLength;
  if (cycleLengths.length > 0) {
    const n = cycleLengths.length;
    const weights = Array.from({length: n}, (_, i) => i + 1);
    const sumW = weights.reduce((a,w) => a+w, 0);
    predictedCycleLength = Math.max(21, Math.min(45, Math.round(
      weights.reduce((a,w,i) => a + w * cycleLengths[i], 0) / sumW
    )));
  }

  // Day in cycle + phase
  const todayKey = toDateKey(new Date());
  const dayInCycle = _daysBetween(lastStart, todayKey) + 1;
  const folEnd = Math.round(predictedCycleLength * 13 / 28);
  const ovDay  = Math.round(predictedCycleLength * 14 / 28);
  const ovEnd  = Math.round(predictedCycleLength * 16 / 28);

  let phase, phaseLabel;
  if (periodDays.includes(todayKey))           { phase = "menstrual";  phaseLabel = "Menstrual";  }
  else if (dayInCycle <= folEnd)               { phase = "follicular"; phaseLabel = "Follicular"; }
  else if (dayInCycle <= ovEnd)                { phase = "ovulatory";  phaseLabel = "Ovulatory";  }
  else if (dayInCycle <= predictedCycleLength) { phase = "luteal";     phaseLabel = "Luteal";     }
  else                                         { phase = "luteal";     phaseLabel = "Late Luteal";}

  const nextPeriodDate = _addDays(lastStart, predictedCycleLength);
  const ovulationDate  = _addDays(lastStart, ovDay - 1);
  const fertileStart   = _addDays(lastStart, ovDay - 6);
  const fertileEnd     = _addDays(lastStart, ovDay);

  const CONF_MAP = {
    high:   { level: "High",   windowDays: 0, message: "Your cycle is quite regular." },
    medium: { level: "Medium", windowDays: 2, message: "Your cycle varies slightly - estimate window shown." },
    low:    { level: "Low",    windowDays: 5,
              message: cycleLengths.length === 0
                ? "Based on 1 period logged - estimate uses a 28-day default. Log more cycles to improve accuracy."
                : "Your cycle varies significantly. This is a rough estimate only." },
  };
  const confKey = cycleLengths.length >= 3 ? "high" : cycleLengths.length >= 1 ? "medium" : "low";

  console.log(
    `[cycle-state] local fallback: phase=${phase} day=${dayInCycle}` +
    ` cycles=${cStarts.length} conf=${confKey} predictedLen=${predictedCycleLength}`
  );

  return {
    ready: true, phase, phaseLabel, dayInCycle,
    avgCycleLength: cycleLengths.length ? avgCycleLength : null,
    predictedCycleLength, confidence: CONF_MAP[confKey],
    nextPeriodDate, ovulationDate, fertileStart, fertileEnd,
    cyclesLogged: cStarts.length,
    source: "local",
  };
}

// ── Trim logs for backend (period days + last 90 days) ────────────────────────
function _trimLogsForBackend(logs) {
  const todayKey = toDateKey(new Date());
  const cutoff = _addDays(todayKey, -90);
  const trimmed = {};
  for (const [k, v] of Object.entries(logs || {})) {
    if ((v?.flow && v.flow !== "none") || k >= cutoff) trimmed[k] = v;
  }
  return trimmed;
}

// ── Main export: fetch canonical cycle state ──────────────────────────────────
/**
 * fetchCycleState(logs)
 *
 * Returns the authoritative cycle state. Tries the ML backend first,
 * falls back to the local rule-based engine. Caches for 6 hours in
 * sessionStorage so rapid page navigations don't re-fetch.
 *
 * @param {Object} logs  - logsByDate from getAllLogs()
 * @returns {Promise<Object>} cycle state with:
 *   ready, phase, phaseLabel, dayInCycle, avgCycleLength, predictedCycleLength,
 *   confidence {level, windowDays, message}, nextPeriodDate, ovulationDate,
 *   fertileStart, fertileEnd, cyclesLogged, source ("backend"|"local")
 */
export async function fetchCycleState(logs) {
  const token = await getIdToken();

  // Cache key: auth type + last period day + today (phase can't change mid-day)
  const periodDays = Object.keys(logs || {})
    .filter(k => logs[k]?.flow && logs[k].flow !== "none").sort();
  const lastPeriodDay = periodDays[periodDays.length - 1] || "none";
  const todayKey = toDateKey(new Date());
  const cacheKey = `bloom_cs_v1_${token ? "acct" : "anon"}_${lastPeriodDay}_${todayKey}`;

  try {
    const hit = sessionStorage.getItem(cacheKey);
    if (hit) {
      const { state, ts } = JSON.parse(hit);
      if (Date.now() - ts < 6 * 60 * 60 * 1000) {
        console.log("[cycle-state] cycle state (cache)");
        return state;
      }
    }
  } catch (_) {}

  let result = null;

  if (token) {
    try {
      const res = await fetch("/api/cycles/state", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ logs: _trimLogsForBackend(logs) }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.state) {
          const s = json.state;
          console.log(
            `[cycle-state] backend ML: phase=${s.phase} day=${s.dayInCycle}` +
            ` conf=${s.confidence?.level} predictedLen=${s.predictedCycleLength}` +
            ` cyclesLogged=${s.cyclesLogged} source=backend`
          );
          result = { ...s, source: "backend" };
        }
      } else {
        console.warn("[cycle-state] backend error", res.status, "- falling back to local");
      }
    } catch (e) {
      console.warn("[cycle-state] backend unreachable:", e.message, "- falling back to local");
    }
  } else {
    console.log("[cycle-state] no auth token - using local rule-based engine");
  }

  if (!result) result = _localCycleState(logs);

  try { sessionStorage.setItem(cacheKey, JSON.stringify({ state: result, ts: Date.now() })); } catch (_) {}
  return result;
}
