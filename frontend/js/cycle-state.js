/**
 * cycle-state.js - Shared cycle-state adapter
 *
 * INTEGRATION LAYER ONLY - no reproductive-health calculation logic here.
 *
 * Exports fetchCycleState, which calls the approved backend engine
 * (cyclesML.js → cyclePhaseEngine.js via POST /api/cycles/state) and
 * returns the result to the UI.
 *
 * Phase, next period, fertile window, ovulation, and confidence are ALL
 * computed exclusively by the approved engine files on the backend.
 * Do NOT add calculation logic to this file.
 *
 * Behavior:
 *   1. Tries POST /api/cycles/state (approved backend engine) when signed in.
 *   2. Falls back to stale sessionStorage, then local cyclePhaseEngine run.
 *   3. Returns { ready: false } only if all fallbacks fail (e.g. no logs).
 *   4. Caches the result in sessionStorage for 6 hours.
 */

import { getIdToken } from "./auth.js";
import { getMode } from "./mode.js";
import { toDateKey }  from "./utils.js";

// De-duplicate concurrent requests (dashboard + notifications + other consumers)
// so they share one backend call per "today + last period + mode".
const _inFlightCycleStateRequests = new Map();
const _cacheHitLoggedKeys = new Set();

// ── FutureCycles resolution ───────────────────────────────────────────────────
// If the engine's current-cycle fertile window has already ended, look for the
// first upcoming futureCycle whose window hasn't closed yet and promote its
// dates into the top-level state. Also overrides phase to "ovulatory" when
// today is inside the resolved fertile window (being in the fertile window IS
// the ovulatory phase for cycle-tracking purposes).
function _resolveFutureCycles(state, todayKey) {
  if (!state?.ready) return state;

  const toStr = v =>
    typeof v === "string" ? v : (v ? toDateKey(new Date(v)) : null);

  const fc = Array.isArray(state.futureCycles) ? state.futureCycles : [];
  let newState = { ...state };

  // ── 1. Next period date ────────────────────────────────────────────────────
  // Always use the SOONEST upcoming period from futureCycles (> today).
  // The engine computes this correctly via buildCalendarOverlays, but if it's
  // missing or stale we fill it in here.
  if (!newState.nextPeriodDate || newState.nextPeriodDate <= todayKey) {
    const nearestPeriodCycle = fc.find(c => {
      const ps = toStr(c.periodStart);
      return ps && ps > todayKey;
    });
    if (nearestPeriodCycle) {
      newState.nextPeriodDate = toStr(nearestPeriodCycle.periodStart);
    }
  }

  // ── 2. Fertile window + ovulation ─────────────────────────────────────────
  // If the engine's fertile window has already ended, find the next futureCycle
  // whose window hasn't closed yet and promote its dates.
  // nextPeriodDate is handled separately above - do NOT pull it from this cycle.
  const fwEnd = toStr(state.fertileEnd);
  if (fwEnd && fwEnd < todayKey && fc.length) {
    const upcomingFertileCycle = fc.find(c => {
      const end = toStr(c.fertileWindow?.end);
      return end && end >= todayKey;
    });
    if (upcomingFertileCycle) {
      newState.fertileStart  = toStr(upcomingFertileCycle.fertileWindow?.start) ?? state.fertileStart;
      newState.fertileEnd    = toStr(upcomingFertileCycle.fertileWindow?.end)   ?? state.fertileEnd;
      newState.ovulationDate = toStr(upcomingFertileCycle.ovulationDay)         ?? state.ovulationDate;
      console.log(
        `[cycle-state] futureCycles resolution: fertileWindow ${newState.fertileStart}→${newState.fertileEnd}` +
        ` ovulation=${newState.ovulationDate} nextPeriod=${newState.nextPeriodDate}`
      );
    }
  }

  // ── 3. Phase override ──────────────────────────────────────────────────────
  // If today is inside the (possibly resolved) fertile window, phase = ovulatory.
  const fwStart = toStr(newState.fertileStart);
  const fwEndResolved = toStr(newState.fertileEnd);
  if (fwStart && fwEndResolved && todayKey >= fwStart && todayKey <= fwEndResolved) {
    if (newState.phase !== "menstrual") {
      console.log(
        `[cycle-state] fertile window active today (${todayKey}): overriding phase` +
        ` "${newState.phase}" → "ovulatory"`
      );
      newState.phase      = "ovulatory";
      newState.phaseLabel = "Ovulatory";
    }
  }

  return newState;
}

// ── Logged-data precedence rule ───────────────────────────────────────────────
// If the user has a logged period entry for today, the phase MUST be Menstrual
// regardless of what the engine predicted. Applied to every return path
// (cache hit and live backend result) so stale cached predictions can never
// override what the user has actually recorded for the current date.
function _applyPrecedence(state, logs, todayKey) {
  if (state?.ready && logs[todayKey]?.flow && logs[todayKey].flow !== "none") {
    if (state.phase !== "menstrual") {
      console.log(
        `[cycle-state] precedence: engine returned "${state.phase}"` +
        ` but today (${todayKey}) is a logged period day → menstrual`
      );
      return { ...state, phase: "menstrual", phaseLabel: "Menstrual" };
    }
  }
  return state;
}

// ── Trim logs for backend (period days + last 90 days) ────────────────────────
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

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * fetchCycleState(logs)
 *
 * Returns the authoritative cycle state from the approved backend engines.
 * Caches for 6 hours in sessionStorage so rapid page loads don't re-fetch.
 *
 * @param {Object} logs  - logsByDate from getAllLogs()
 * @returns {Promise<Object>} cycle state with:
 *   ready, phase, phaseLabel, dayInCycle, avgCycleLength, predictedCycleLength,
 *   confidence {level, windowDays, message}, nextPeriodDate, ovulationDate,
 *   fertileStart, fertileEnd, cyclesLogged, source ("backend"|"unavailable")
 */
export async function fetchCycleState(logs) {
  // Cache key parts: auth type + last period day + today
  const periodDays = Object.keys(logs || {})
    .filter(k => logs[k]?.flow && logs[k].flow !== "none").sort();
  const lastPeriodDay = periodDays[periodDays.length - 1] || "none";
  const todayKey = toDateKey(new Date());
  const modeKeyForDedupe = getMode() === "account" ? "acct" : "anon";
  const dedupeKey = `bloom_cs_req_v1_${modeKeyForDedupe}_${lastPeriodDay}_${todayKey}`;

  const existingRequest = _inFlightCycleStateRequests.get(dedupeKey);
  if (existingRequest) {
    console.log("[cycle-state] reusing in-flight request");
    return existingRequest;
  }

  const run = (async () => {

  // Fast path: check session cache before waiting on auth token.
  // This avoids startup lag when state is already cached.
  const modeKey = getMode() === "account" ? "acct" : "anon";
  const modeCacheKey = `bloom_cs_v1_${modeKey}_${lastPeriodDay}_${todayKey}`;
  const fallbackCacheKey = `bloom_cs_v1_${modeKey === "acct" ? "anon" : "acct"}_${lastPeriodDay}_${todayKey}`;

  let staleState = null;
  try {
    const tryKeys = [modeCacheKey, fallbackCacheKey];
    for (const key of tryKeys) {
      const hit = sessionStorage.getItem(key);
      if (!hit) continue;
      const { state, ts } = JSON.parse(hit);
      if (Date.now() - ts < 6 * 60 * 60 * 1000 && state?.ready) {
        if (!_cacheHitLoggedKeys.has(key)) {
          _cacheHitLoggedKeys.add(key);
          console.log("[cycle-state] cache hit");
        }
        return _applyPrecedence(_resolveFutureCycles(state, todayKey), logs, todayKey);
      }
      // Keep only usable stale state for fallback.
      if (state?.ready) staleState = state;
    }
  } catch (_) {}

  const token = await getIdToken({ waitForAuthMs: 700 });
  const cacheKey = `bloom_cs_v1_${token ? "acct" : "anon"}_${lastPeriodDay}_${todayKey}`;

  let result = null;
  let backendDenied = null;

  if (!token) {
    console.log("[cycle-state] no auth token - skipping backend and using local fallback when possible");
  } else {
    const backendAttempts = [5000];
    for (let i = 0; i < backendAttempts.length && !result && !backendDenied; i++) {
      const timeoutMs = backendAttempts[i];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch("/api/cycles/state", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ logs: _trimLogsForBackend(logs) }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (res.ok) {
          const json = await res.json();
          if (json.state) {
            const s = json.state;
            console.log(
              `[cycle-state] backend: phase=${s.phase} day=${s.dayInCycle}` +
              ` conf=${s.confidence?.level} predictedLen=${s.predictedCycleLength}` +
              ` cyclesLogged=${s.cyclesLogged}`
            );
            result = { ...s, source: "backend" };
          }
        } else {
          const body = await res.text().catch(() => "");
          if (res.status === 401 || res.status === 403) {
            backendDenied = { status: res.status, body };
          } else {
            console.warn(
              `[cycle-state] backend error attempt ${i + 1}/${backendAttempts.length}`,
              res.status,
              body
            );
          }
        }
      } catch (e) {
        const msg = e?.name === "AbortError"
          ? `request timed out after ${timeoutMs}ms`
          : e.message;
        console.warn(
          `[cycle-state] backend unreachable attempt ${i + 1}/${backendAttempts.length}:`,
          msg
        );
      }
    }
  }

  if (backendDenied) {
    const status = backendDenied.status;
    const body = backendDenied.body || "";
    console.warn("[cycle-state] backend access denied", status, body);
    return {
      ready: false,
      source: "backend-denied",
      errorCode: status === 401 ? "AUTH_REQUIRED" : "CONSENT_OR_PERMISSION_REQUIRED",
      message:
        status === 401
          ? "Sign in again to sync your cycle state from the backend."
          : "This account does not currently have permission to load backend cycle state.",
    };
  }

  if (!result) {
    if (staleState?.ready) {
      console.warn("[cycle-state] backend unavailable - serving stale cache as fallback");
      return _applyPrecedence(_resolveFutureCycles(staleState, todayKey), logs, todayKey);
    }

    // Local fallback: run the same engine the backend uses, client-side.
    // This keeps the dashboard usable when the backend is temporarily unreachable.
    try {
      const { computeCyclePhaseML } =
        await import("../../backend/ml/inference/cyclePhaseEngine.js");
      const phaseData = computeCyclePhaseML(_trimLogsForBackend(logs));
      if (phaseData?.phase && phaseData.phase !== "unknown") {
        console.warn("[cycle-state] using local engine fallback");
        result = {
          ...phaseData,
          ready:                true,
          source:               "local",
          predictedCycleLength: phaseData.avgCycleLength ?? null,
          cyclesLogged:         (phaseData.cycleStarts || []).length,
          confidence: {
            level:      (phaseData.confidence || "low"),
            windowDays: 5,
            message:    "Local estimate - backend offline. Refresh to sync.",
          },
          futureCycles:         [],
          predictedPeriodDays:  phaseData.predictedPeriodDays ?? [],
          futureOvulationDates: [],
          allFertileDays:       [],
        };
      }
    } catch (localErr) {
      console.warn("[cycle-state] local fallback failed:", localErr.message);
    }
  }

  if (!result) {
    console.warn("[cycle-state] no data available - returning not-ready state");
    return { ready: false, source: "unavailable" };
  }

  result = _applyPrecedence(_resolveFutureCycles(result, todayKey), logs, todayKey);

  if (result?.ready) {
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ state: result, ts: Date.now() })); } catch (_) {}
  }
  return result;
  })();

  _inFlightCycleStateRequests.set(dedupeKey, run);
  try {
    return await run;
  } finally {
    if (_inFlightCycleStateRequests.get(dedupeKey) === run) {
      _inFlightCycleStateRequests.delete(dedupeKey);
    }
  }
}
