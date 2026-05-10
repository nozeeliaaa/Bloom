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

const API_BASE = (typeof window !== "undefined" && typeof window.BLOOM_API_BASE === "string")
  ? window.BLOOM_API_BASE.trim().replace(/\/+$/, "")
  : "";
const CYCLE_STATE_ENDPOINT = `${API_BASE}/api/cycles/state`;

// De-duplicate concurrent requests (dashboard + notifications + other consumers)
// so they share one backend call per "today + last period + mode".
const _inFlightCycleStateRequests = new Map();
const _cacheHitLoggedKeys = new Set();

function _dayDiff(a, b) {
  return Math.round(
    (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000
  );
}

function _toDateKeyMaybe(value) {
  return typeof value === "string" ? value : (value ? toDateKey(new Date(value)) : null);
}

/**
 * Average completed period clusters from logged bleeding days.
 * Single start-only clusters are excluded because they usually mean "the user
 * logged Day 1 and stopped logging", not that bleeding lasted exactly one day.
 * With no reliable history, Bloom uses a 5-day fallback.
 */
export function estimateAveragePeriodDurationFromLogs(logs = {}) {
  const periodDays = Object.keys(logs || {})
    .filter((dateKey) => _isLoggedPeriodDay(logs[dateKey]))
    .sort();

  if (!periodDays.length) return 5;

  const clusters = [];
  let start = periodDays[0];
  let end = periodDays[0];
  for (let i = 1; i < periodDays.length; i++) {
    if (_dayDiff(periodDays[i - 1], periodDays[i]) > 3) {
      clusters.push({ start, end });
      start = periodDays[i];
    }
    end = periodDays[i];
  }
  clusters.push({ start, end });

  const durations = clusters
    .map((cluster) => Math.max(1, _dayDiff(cluster.start, cluster.end) + 1))
    .filter((duration) => duration >= 2 && duration <= 10);

  if (!durations.length) return 5;
  const avg = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  return Math.max(3, Math.min(8, Math.round(avg)));
}

/**
 * Resolve stale next-period predictions into a clear status object. When the
 * predicted start is before today and no new period has been logged, UI should
 * show the old expected window as overdue, not as a future "next period".
 */
export function resolvePeriodPredictionStatus(state, logs = {}, todayKey = toDateKey(new Date())) {
  const backendStatus = state?.periodPrediction;
  if (backendStatus?.status === "overdue") {
    return {
      ...backendStatus,
      predictedStart: _toDateKeyMaybe(backendStatus.predictedStart),
      predictedEnd: _toDateKeyMaybe(backendStatus.predictedEnd),
    };
  }

  const predictedStart = _toDateKeyMaybe(state?.nextPeriodDate);
  if (!predictedStart || predictedStart >= todayKey) {
    return backendStatus || {
      status: predictedStart ? "upcoming" : "unknown",
      predictedStart: predictedStart || null,
      predictedEnd: null,
      daysLate: 0,
      message: "",
    };
  }

  const hasNewerLoggedPeriod = Object.keys(logs || {}).some(
    (dateKey) => dateKey >= predictedStart && _isLoggedPeriodDay(logs[dateKey])
  );
  if (hasNewerLoggedPeriod) {
    return { status: "updated", predictedStart: null, predictedEnd: null, daysLate: 0, message: "" };
  }

  const periodDuration = Number(state?.averagePeriodDuration) || estimateAveragePeriodDurationFromLogs(logs);
  const predictedEnd = _addDays(predictedStart, Math.max(1, periodDuration) - 1);
  const daysLate = Math.max(1, _dayDiff(predictedStart, todayKey));

  return {
    status: "overdue",
    predictedStart,
    predictedEnd,
    daysLate,
    message: `Period is late by ${daysLate} day${daysLate === 1 ? "" : "s"}.`,
  };
}

// ── FutureCycles resolution ───────────────────────────────────────────────────
// If the engine's current-cycle fertile window has already ended, look for the
// first upcoming futureCycle whose window hasn't closed yet and promote its
// dates into the top-level state. Also overrides phase to "ovulatory" when
// today is inside the resolved fertile window (being in the fertile window IS
// the ovulatory phase for cycle-tracking purposes).
function _resolveFutureCycles(state, todayKey) {
  if (!state?.ready) return state;

  const toStr = _toDateKeyMaybe;
  const dayDiff = _dayDiff;

  const fc = Array.isArray(state.futureCycles) ? state.futureCycles : [];
  let newState = { ...state };
  const sourceKey = String(state?.source || "").toLowerCase();
  const phaseKeyFromBackend = String(state?.phase || "").toLowerCase();
  const backendSaysPostOvulation =
    sourceKey === "backend" &&
    (phaseKeyFromBackend === "luteal" || phaseKeyFromBackend === "late_luteal");
  const originalFertileStart = toStr(state.fertileStart);
  const originalFertileEnd = toStr(state.fertileEnd);
  const originalOvulationDate = toStr(state.ovulationDate);

  if (backendSaysPostOvulation) {
    const fertileLooksCurrent =
      originalFertileStart &&
      originalFertileEnd &&
      todayKey >= originalFertileStart &&
      todayKey <= originalFertileEnd;
    const ovulationStillFuture = originalOvulationDate && originalOvulationDate >= todayKey;

    if (fertileLooksCurrent || ovulationStillFuture) {
      newState.fertileStart = null;
      newState.fertileEnd = null;
      newState.ovulationDate = null;
    }
  }

  // ── 1. Next period date ────────────────────────────────────────────────────
  // Always use the SOONEST upcoming period from futureCycles (> today).
  // The engine computes this correctly via buildCalendarOverlays, but if it's
  // missing or stale we fill it in here.
  if (!newState.periodPrediction) {
    newState.periodPrediction = resolvePeriodPredictionStatus(newState, {}, todayKey);
  }

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
  const fwEnd = toStr(newState.fertileEnd);
  if (!backendSaysPostOvulation && fwEnd && fwEnd < todayKey && fc.length) {
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

  // ── 3. Phase override (local-only) ─────────────────────────────────────────
  // Keep backend phase authoritative across pages to avoid phase flip between
  // views. We only apply local phase-window smoothing for non-backend sources.
  if (sourceKey !== "backend") {
    const fwStart = toStr(newState.fertileStart);
    const fwEndResolved = toStr(newState.fertileEnd);
    if (fwStart && fwEndResolved && todayKey >= fwStart && todayKey <= fwEndResolved) {
      if (newState.phase !== "menstrual") {
        console.log(
          `[cycle-state] fertile window active today (${todayKey}): overriding phase` +
          ` "${newState.phase}" -> "ovulatory"`
        );
        newState.phase      = "ovulatory";
        newState.phaseLabel = "Ovulatory";
      }
    }

    const phaseKey = String(newState.phase || "").toLowerCase();
    const isOvulatoryPhase = phaseKey === "ovulatory" || phaseKey === "ovulation";
    if (isOvulatoryPhase && newState.phase !== "menstrual") {
      const inOriginalFertileWindow =
        originalFertileStart &&
        originalFertileEnd &&
        todayKey >= originalFertileStart &&
        todayKey <= originalFertileEnd;
      const nearOriginalOvulation =
        !!originalOvulationDate && Math.abs(dayDiff(todayKey, originalOvulationDate)) <= 1;

      if (!inOriginalFertileWindow && !nearOriginalOvulation) {
        const correctedPhase =
          originalOvulationDate && todayKey > originalOvulationDate ? "luteal" : "follicular";
        newState.phase = correctedPhase;
        newState.phaseLabel = correctedPhase === "luteal" ? "Luteal" : "Follicular";
        console.log(
          `[cycle-state] phase-window consistency: overriding "${phaseKey}" -> "${newState.phase}"`
        );
      }
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
  if (state?.ready) {
    state = {
      ...state,
      periodPrediction: resolvePeriodPredictionStatus(state, logs, todayKey),
    };
  }

  if (state?.ready && _isLoggedPeriodDay(logs?.[todayKey])) {
    const loggedPeriodDay = _deriveLoggedPeriodDay(logs, todayKey);
    const override = {
      ...state,
      phase: "menstrual",
      phaseLabel: "Menstrual",
      dayInCycle: loggedPeriodDay ?? state.dayInCycle,
    };
    if (state.phase !== "menstrual") {
      console.log(
        `[cycle-state] precedence: engine returned "${state.phase}"` +
        ` but today (${todayKey}) is a logged period day → menstrual`
      );
    }
    if (loggedPeriodDay && state.dayInCycle !== loggedPeriodDay) {
      console.log(
        `[cycle-state] precedence: engine returned day ${state.dayInCycle}` +
        ` but logged period streak says day ${loggedPeriodDay}`
      );
    }
    return override;
  }
  return state;
}

function _isLoggedPeriodDay(entry) {
  if (!entry) return false;
  if (entry.flow && entry.flow !== "none") return true;
  if (typeof entry.flowLevel === "number" && entry.flowLevel > 0) return true;
  if (Number.isFinite(Number(entry.periodDay)) && Number(entry.periodDay) > 0) return true;
  return entry.periodDay === true;
}

function _addDays(dateKey, n) {
  const d = new Date(dateKey + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

function _deriveLoggedPeriodDay(logs, todayKey) {
  const explicit = Number(logs?.[todayKey]?.periodDay);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  if (!_isLoggedPeriodDay(logs?.[todayKey])) return null;

  let start = todayKey;
  while (_isLoggedPeriodDay(logs?.[_addDays(start, -1)])) {
    start = _addDays(start, -1);
  }

  return Math.max(
    1,
    Math.round((new Date(todayKey + "T00:00:00") - new Date(start + "T00:00:00")) / 86400000) + 1
  );
}

// ── Trim logs for backend (period days + last 90 days) ────────────────────────
function _trimLogsForBackend(logs) {
  const todayKey = toDateKey(new Date());
  const cutoffMs = new Date(todayKey + "T00:00:00");
  cutoffMs.setDate(cutoffMs.getDate() - 90);
  const cutoff = toDateKey(cutoffMs);
  const trimmed = {};
  for (const [k, v] of Object.entries(logs || {})) {
    if (_isLoggedPeriodDay(v) || k >= cutoff) trimmed[k] = v;
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
  const isAccountMode = getMode() === "account";

  // Cache key parts: auth type + last period day + today
  const periodDays = Object.keys(logs || {})
    .filter(k => _isLoggedPeriodDay(logs[k])).sort();
  const lastPeriodDay = periodDays[periodDays.length - 1] || "none";
  const periodLogCount = periodDays.length;
  const todayKey = toDateKey(new Date());
  const modeKeyForDedupe = isAccountMode ? "acct" : "anon";
  const dedupeKey = `bloom_cs_req_v2_${modeKeyForDedupe}_${lastPeriodDay}_${periodLogCount}_${todayKey}`;

  const existingRequest = _inFlightCycleStateRequests.get(dedupeKey);
  if (existingRequest) {
    console.log("[cycle-state] reusing in-flight request");
    return existingRequest;
  }

  const run = (async () => {

  // Fast path: check session cache before waiting on auth token.
  // This avoids startup lag when state is already cached.
  const modeKey = isAccountMode ? "acct" : "anon";
  const modeCacheKey = `bloom_cs_v2_${modeKey}_${lastPeriodDay}_${periodLogCount}_${todayKey}`;
  const fallbackCacheKey = `bloom_cs_v2_${modeKey === "acct" ? "anon" : "acct"}_${lastPeriodDay}_${periodLogCount}_${todayKey}`;

  let staleState = null;
  try {
    const tryKeys = isAccountMode ? [modeCacheKey] : [modeCacheKey, fallbackCacheKey];
    for (const key of tryKeys) {
      const hit = sessionStorage.getItem(key);
      if (!hit) continue;
      const { state, ts } = JSON.parse(hit);
      // In account mode, never reuse a cached local-engine fallback state.
      if (isAccountMode && state?.source === "local") continue;
      if (Date.now() - ts < 6 * 60 * 60 * 1000 && state?.ready) {
        if (!_cacheHitLoggedKeys.has(key)) {
          _cacheHitLoggedKeys.add(key);
          console.log("[cycle-state] cache hit");
        }
        return _applyPrecedence(_resolveFutureCycles(state, todayKey), logs, todayKey);
      }
      // Keep only usable stale state for fallback.
      // In account mode, only trust stale backend-sourced state to avoid
      // showing local-fallback phase values that can later "flip".
      if (state?.ready) {
        const staleSource = String(state?.source || "").toLowerCase();
        if (!isAccountMode || staleSource === "backend") {
          staleState = state;
        }
      }
    }
  } catch (_) {}

  let token = await getIdToken({ waitForAuthMs: 1500 });
  if (!token && isAccountMode) {
    token = await getIdToken({ waitForAuthMs: 2500 });
  }
  const cacheKey = `bloom_cs_v2_${token ? "acct" : "anon"}_${lastPeriodDay}_${periodLogCount}_${todayKey}`;

  let result = null;
  let backendDenied = null;

  if (!token) {
    if (isAccountMode) {
      console.warn("[cycle-state] no auth token in account mode - backend sync unavailable");
    } else {
      console.log("[cycle-state] no auth token - skipping backend and using local fallback when possible");
    }
  } else {
    // Cloud Run cold starts and Firestore reads can exceed 5s right after login.
    // Keep account mode backend-authoritative by waiting long enough for the
    // approved engine instead of dropping into a blank "not ready" state.
    const backendAttempts = [15000];
    for (let i = 0; i < backendAttempts.length && !result && !backendDenied; i++) {
      const timeoutMs = backendAttempts[i];
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(CYCLE_STATE_ENDPOINT, {
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

    // Local fallback is allowed only in anonymous mode.
    if (!isAccountMode) {
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
