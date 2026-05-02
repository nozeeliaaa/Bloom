/**
 * cycle-state-biometric.js - Shared biometric cycle-state adapter
 *
 * INTEGRATION LAYER ONLY - no reproductive-health calculation logic here.
 *
 * Exports fetchBiometricCycleState, which calls the approved backend engine
 * (cyclesML.js → biometric_phase.py + phase_fusion_engine.js via
 * POST /api/cycles/biometric-state) and returns the result to the UI.
 *
 * Phase is computed by the biometric backend engines. Calendar overlays are
 * consumed from the backend response.
 * Do NOT add local calculation logic to this file.
 *
 * Behavior:
 *   1. Tries POST /api/cycles/biometric-state when signed in.
 *   2. Falls back to stale sessionStorage only.
 *   3. Returns { ready: false } if no biometric state is available.
 *   4. Caches the result in sessionStorage for 6 hours.
 */

import { getIdToken } from "./auth.js";
import { toDateKey }  from "./utils.js";

function _resolveFutureCycles(state, todayKey) {
  if (!state?.ready) return state;

  const toStr = v =>
    typeof v === "string" ? v : (v ? toDateKey(new Date(v)) : null);

  const fc = Array.isArray(state.futureCycles) ? state.futureCycles : [];
  let newState = { ...state };

  if (!newState.nextPeriodDate || newState.nextPeriodDate <= todayKey) {
    const nearestPeriodCycle = fc.find(c => {
      const ps = toStr(c.periodStart);
      return ps && ps > todayKey;
    });
    if (nearestPeriodCycle) {
      newState.nextPeriodDate = toStr(nearestPeriodCycle.periodStart);
    }
  }

  const fwEnd = toStr(state.fertileEnd);
  if (fwEnd && fwEnd < todayKey && fc.length) {
    const upcomingFertileCycle = fc.find(c => {
      const end = toStr(c.fertileWindow?.end);
      return end && end >= todayKey;
    });
    if (upcomingFertileCycle) {
      newState.fertileStart = toStr(upcomingFertileCycle.fertileWindow?.start) ?? state.fertileStart;
      newState.fertileEnd = toStr(upcomingFertileCycle.fertileWindow?.end) ?? state.fertileEnd;
      newState.ovulationDate = toStr(upcomingFertileCycle.ovulationDay) ?? state.ovulationDate;
      console.log(
        `[cycle-state-biometric] futureCycles resolution: fertileWindow ${newState.fertileStart}→${newState.fertileEnd}` +
        ` ovulation=${newState.ovulationDate} nextPeriod=${newState.nextPeriodDate}`
      );
    }
  }

  const fwStart = toStr(newState.fertileStart);
  const fwEndResolved = toStr(newState.fertileEnd);
  if (fwStart && fwEndResolved && todayKey >= fwStart && todayKey <= fwEndResolved) {
    if (newState.phase !== "menstrual") {
      console.log(
        `[cycle-state-biometric] fertile window active today (${todayKey}): overriding phase` +
        ` "${newState.phase}" → "ovulatory"`
      );
      newState.phase = "ovulatory";
      newState.phaseLabel = "Ovulatory";
    }
  }

  return newState;
}

function _applyPrecedence(state, logs, todayKey) {
  if (state?.ready && logs[todayKey]?.flow && logs[todayKey].flow !== "none") {
    if (state.phase !== "menstrual") {
      console.log(
        `[cycle-state-biometric] precedence: engine returned "${state.phase}"` +
        ` but today (${todayKey}) is a logged period day → menstrual`
      );
      return { ...state, phase: "menstrual", phaseLabel: "Menstrual" };
    }
  }
  return state;
}

function _trimLogsForBackend(logs) {
  const todayKey = toDateKey(new Date());
  const cutoffMs = new Date(todayKey + "T00:00:00");
  cutoffMs.setDate(cutoffMs.getDate() - 90);
  const cutoff = toDateKey(cutoffMs);
  const trimmed = {};
  for (const [k, v] of Object.entries(logs || {})) {
    if ((v?.flow && v.flow !== "none") || k >= cutoff) trimmed[k] = v;
  }
  return trimmed;
}

/**
 * fetchBiometricCycleState(logs)
 *
 * Returns the authoritative biometric cycle state from the backend engines.
 * Caches for 6 hours in sessionStorage so rapid page loads don't re-fetch.
 *
 * @param {Object} logs - logsByDate from getAllLogs()
 * @returns {Promise<Object>} cycle state with:
 *   ready, phase, phaseLabel, dayInCycle, avgCycleLength, predictedCycleLength,
 *   confidence {level, windowDays, message}, nextPeriodDate, ovulationDate,
 *   fertileStart, fertileEnd, cyclesLogged, source ("biometric-backend"|"unavailable")
 */
export async function fetchBiometricCycleState(logs) {
  const token = await getIdToken();

  const periodDays = Object.keys(logs || {})
    .filter(k => logs[k]?.flow && logs[k].flow !== "none").sort();
  const lastPeriodDay = periodDays[periodDays.length - 1] || "none";
  const todayKey = toDateKey(new Date());
  const cacheKey = `bloom_biometric_cs_v1_${token ? "acct" : "anon"}_${lastPeriodDay}_${todayKey}`;

  let staleState = null;
  try {
    const hit = sessionStorage.getItem(cacheKey);
    if (hit) {
      const { state, ts } = JSON.parse(hit);
      if (Date.now() - ts < 6 * 60 * 60 * 1000) {
        console.log("[cycle-state-biometric] cache hit");
        return _applyPrecedence(_resolveFutureCycles(state, todayKey), logs, todayKey);
      }
      staleState = state;
    }
  } catch (_) {}

  let result = null;

  if (!token) {
    console.log("[cycle-state-biometric] no auth token - skipping biometric backend");
  } else {
    try {
      const res = await fetch("/api/cycles/biometric-state", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ logs: _trimLogsForBackend(logs) }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.state) {
          const s = json.state;
          console.log(
            `[cycle-state-biometric] backend: phase=${s.phase} day=${s.dayInCycle}` +
            ` conf=${s.confidence?.level} predictedLen=${s.predictedCycleLength}` +
            ` cyclesLogged=${s.cyclesLogged}`
          );
          result = { ...s, source: "biometric-backend" };
        }
      } else {
        const body = await res.text().catch(() => "");
        console.warn("[cycle-state-biometric] backend error", res.status, body);
      }
    } catch (e) {
      console.warn("[cycle-state-biometric] backend unreachable:", e.message);
    }
  }

  if (!result && staleState) {
    console.warn("[cycle-state-biometric] backend unavailable - serving stale cache as fallback");
    return _applyPrecedence(_resolveFutureCycles(staleState, todayKey), logs, todayKey);
  }

  if (!result) {
    console.warn("[cycle-state-biometric] no data available - returning not-ready state");
    return { ready: false, source: "unavailable" };
  }

  result = _applyPrecedence(_resolveFutureCycles(result, todayKey), logs, todayKey);

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ state: result, ts: Date.now() }));
  } catch (_) {}

  return result;
}
