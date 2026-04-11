// cyclesML.js
// Routes:
//   POST /api/cycles/predict  → ML cycle length prediction
//   POST /api/cycles/phase    → current phase using cyclePhaseEngine.js
//
// Prediction strategy:
//   < 3 cycles  → rule-based weighted average (fallback)
//   3+ cycles   → ML model (cycle_predict.py)
//   ML fails    → rule-based weighted average (fallback)

import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireConsent } from "../middleware/requireConsent.js";
import { requireAuth } from "../middleware/auth.js";
import { computeCyclePhaseML } from "../../ml/inference/cyclePhaseEngine.js";
import { db } from "../firebaseAdmin.js";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CYCLE_SCRIPT = path.join(__dirname, '../public/ml/inference/cycle_predict.py');

const router = express.Router();

// ── Python runner ────────────────────────────────────────────

function runPython(scriptPath, args) {
    return new Promise((resolve, reject) => {
        const python = spawn('python3', [scriptPath, ...args.map(String)]);
        let output = '';
        let errorOutput = '';
        python.stdout.on('data', (data) => { output += data.toString(); });
        python.stderr.on('data', (data) => { errorOutput += data.toString(); });
        python.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Python failed: ${errorOutput}`));
            try {
                const result = JSON.parse(output.trim());
                if (result.error) return reject(new Error(result.error));
                resolve(result);
            } catch (e) {
                reject(new Error(`Failed to parse Python output: ${output}`));
            }
        });
    });
}

// ── In-memory cache for /state (avoids repeated Python spawns) ──────────────
// Keyed by uid. Cache entry expires after 4 hours or when the last period date changes.
const _stateCache = new Map();
const _STATE_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function _getCachedState(uid, lastPeriodDay) {
  const entry = _stateCache.get(uid);
  if (!entry) return null;
  if (entry.lastPeriodDay !== lastPeriodDay) return null;
  if (Date.now() - entry.ts > _STATE_CACHE_TTL) return null;
  return entry.state;
}

function _setCachedState(uid, lastPeriodDay, state) {
  _stateCache.set(uid, { lastPeriodDay, state, ts: Date.now() });
}

// ── Fallback: rule-based weighted average ────────────────────
//
// Mirrors the Weighted OLS logic from cyclePredictor.js but
// runs on the backend. Recent cycles get higher weight.
// Falls back to userTypicalCycleLength if no history exists.

function weightedAverageFallback(cycleHistory, userTypicalCycleLength = 28) {
    if (!cycleHistory || cycleHistory.length === 0) {
        return {
            predicted_cycle_length: userTypicalCycleLength,
            method:     'default',
            confidence: 'low',
            message:    'No cycle history yet. Using typical cycle length as estimate.'
        };
    }

    const n       = cycleHistory.length;
    const weights = Array.from({ length: n }, (_, i) => i + 1); // linear weights
    const sumW    = weights.reduce((a, w) => a + w, 0);
    const weighted = weights.reduce((a, w, i) => a + w * cycleHistory[i], 0) / sumW;
    const clamped  = Math.max(21, Math.min(45, Math.round(weighted)));

    // Confidence based on variability
    const mean    = cycleHistory.reduce((a, b) => a + b, 0) / n;
    const stdDev  = Math.sqrt(cycleHistory.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / n);
    const confidence = stdDev < 2 ? 'high' : stdDev < 4 ? 'medium' : 'low';

    return {
        predicted_cycle_length: clamped,
        method:     'rule-based-weighted-average',
        confidence,
        message:    `Estimated from your last ${n} cycle${n !== 1 ? 's' : ''} using weighted average.`
    };
}

// ── Helper: std dev ──────────────────────────────────────────

function calculateStdDev(arr) {
    if (!arr || arr.length < 2) return 1.5;
    const mean     = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// ── Route: POST /api/cycles/predict ─────────────────────────

router.post('/predict', requireAuth, requireConsent, async (req, res) => {
    try {
        const {
            cycleLength,
            meanCycleLength,
            lutealPhaseLength   = 14,
            cycleNumber         = 1,
            age                 = 28,
            bmi                 = 22,
            unusualBleeding     = 0,
            reproductiveCategory = 0,
            cycleHistory        = []
        } = req.body;

        // ── Fallback for new users (< 3 cycles) ─────────────
        if (cycleHistory.length < 3) {
            const fallback = weightedAverageFallback(cycleHistory);
            return res.json({ prediction: fallback });
        }

        // ── ML model for established users (3+ cycles) ───────
        const cycleVariability = calculateStdDev(cycleHistory);

        try {
            const cycleResult = await runPython(CYCLE_SCRIPT, [
                cycleLength,
                meanCycleLength,
                lutealPhaseLength,
                cycleVariability,
                cycleNumber,
                age,
                bmi,
                unusualBleeding,
                reproductiveCategory
            ]);

            console.log('[cyclesML] prediction:', {
                predicted_cycle_length: cycleResult.predictedCycleLength,
                method:                 'ml-weighted-ols',
                cycleHistory,
                cycleVariability
            });

            return res.json({
                prediction: {
                    predicted_cycle_length: cycleResult.predictedCycleLength,
                    method:     'ml-weighted-ols',
                    confidence: 'high',
                    message:    cycleResult.message
                }
            });

        } catch (mlErr) {
            // ── ML failed - fall back to weighted average ─────
            console.warn('[cyclesML] ML failed, using fallback:', mlErr.message);
            const fallback = weightedAverageFallback(cycleHistory);
            return res.json({ prediction: fallback });
        }

    } catch (err) {
        console.error('[cyclesML] predict failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Helpers for /state ──────────────────────────────────────

function dateStrAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

function todayDateKey() {
  const d  = new Date();
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

/** Same period-cluster logic as calendar.js getPeriodClusters */
function getPeriodClustersBackend(logs) {
  const periodDays = Object.keys(logs)
    .filter(k => { const l = logs[k]; return l && l.flow && l.flow !== 'none'; })
    .sort();
  if (!periodDays.length) return [];

  const clusters = [];
  let start = periodDays[0], end = periodDays[0];
  for (let i = 1; i < periodDays.length; i++) {
    const gap = Math.round(
      (new Date(periodDays[i] + 'T00:00:00') - new Date(periodDays[i - 1] + 'T00:00:00')) / 86400000
    );
    if (gap > 3) { clusters.push({ start, end }); start = periodDays[i]; }
    end = periodDays[i];
  }
  clusters.push({ start, end });
  return clusters;
}

/** Build N future cycles (all dates as YYYY-MM-DD strings) */
function buildFutureCyclesBackend(lastPeriodStart, predictedLength, periodDuration, monthsAhead, windowDays) {
  const cycles = [];
  let chainStart = lastPeriodStart;
  for (let i = 0; i < monthsAhead; i++) {
    const periodStart  = dateStrAddDays(chainStart, predictedLength);
    const periodEnd    = dateStrAddDays(periodStart, periodDuration - 1);
    const ovulationDay = dateStrAddDays(periodStart, -14);
    const fertileStart = dateStrAddDays(ovulationDay, -5);
    const fertileEnd   = dateStrAddDays(ovulationDay, 1);
    const grow = windowDays * (i + 1);
    cycles.push({
      cycleLength:   predictedLength,
      periodStart,
      periodEnd,
      ovulationDay,
      fertileWindow: { start: fertileStart, end: fertileEnd },
      earliestStart: dateStrAddDays(periodStart, -grow),
      latestStart:   dateStrAddDays(periodStart,  grow),
      isEstimate:    true,
    });
    chainStart = periodStart;
  }
  return cycles;
}

/** Convert cyclePhaseEngine confidence string → object shape calendar.js expects */
function buildConfidenceObj(confidenceStr, cycleCount) {
  const map = {
    high:   { level: 'High',   windowDays: 0, message: 'Your cycle is quite regular. This estimate is fairly reliable.' },
    medium: { level: 'Medium', windowDays: 2, message: 'Your cycle varies slightly. Showing an estimated window.' },
    low:    { level: 'Low',    windowDays: 5, message: cycleCount === 0
                ? 'Not enough history yet. Showing a wider estimate window.'
                : 'Your cycle varies significantly. This is a rough estimate only.' },
  };
  return map[confidenceStr] ?? map.low;
}

/** Build calendar overlay arrays from futureCycles + real cluster starts */
function buildCalendarOverlays(futureCycles, clusterStarts) {
  const today = todayDateKey();
  const predictedPeriodDays = [];
  const futureOvulationDates = [];
  const allFertileDays = [];
  let nextPeriodDate = null;

  for (const c of futureCycles) {
    if (!c.periodStart || c.periodStart <= today) continue;
    const predMs   = new Date(c.periodStart + 'T00:00:00').getTime();
    const resolved = clusterStarts.some(
      s => Math.abs(new Date(s + 'T00:00:00').getTime() - predMs) <= 14 * 86400000
    );
    if (resolved) continue;

    const duration = c.periodEnd
      ? Math.round((new Date(c.periodEnd + 'T00:00:00') - new Date(c.periodStart + 'T00:00:00')) / 86400000) + 1
      : 5;
    for (let i = 0; i < duration; i++) predictedPeriodDays.push(dateStrAddDays(c.periodStart, i));
    if (!nextPeriodDate) nextPeriodDate = c.periodStart;

    if (c.ovulationDay) futureOvulationDates.push(c.ovulationDay);

    if (c.fertileWindow?.start && c.fertileWindow?.end) {
      let d = c.fertileWindow.start;
      while (d <= c.fertileWindow.end) { allFertileDays.push(d); d = dateStrAddDays(d, 1); }
    }
  }

  return { predictedPeriodDays, futureOvulationDates, allFertileDays, nextPeriodDate };
}

// ── Route: POST /api/cycles/state ────────────────────────────
// Single source of truth: ML prediction + phase + calendar overlays.
// Persists result to users/{uid}/cycleState/current in Firestore.

router.post('/state', requireAuth, requireConsent, async (req, res) => {
  try {
    const { logs = {} } = req.body;
    const uid = req.user?.uid;

    if (!logs || typeof logs !== 'object') {
      return res.status(400).json({ error: 'logs must be an object keyed by YYYY-MM-DD' });
    }

    console.log(`[cyclesML/state] uid=${uid} log_days=${Object.keys(logs).length}`);

    // 1 ─ Derive period clusters
    const clusters = getPeriodClustersBackend(logs);

    // Check in-memory cache before doing any computation
    const lastPeriodDay = clusters.length ? clusters[clusters.length - 1].start : "none";
    const cached = _getCachedState(uid, lastPeriodDay);
    if (cached) {
      console.log(`[cyclesML/state] cache hit uid=${uid}`);
      return res.json({ ok: true, state: cached });
    }

    if (!clusters.length) {
      const emptyState = {
        ready: false, phase: 'unknown', phaseLabel: 'Unknown',
        dayInCycle: null, avgCycleLength: null, predictedCycleLength: null,
        confidence: { level: 'Low', windowDays: 5, message: 'Log your first period to see predictions.' },
        nextPeriodDate: null, ovulationDate: null, fertileStart: null, fertileEnd: null,
        cyclesLogged: 0, predictedPeriodDays: [], futureOvulationDates: [],
        allFertileDays: [], futureCycles: [],
        disclaimer: 'This is an educational estimate, not a medical prediction.',
      };
      return res.json({ ok: true, state: emptyState });
    }

    const clusterStarts = clusters.map(c => c.start);
    const lastCluster   = clusters[clusters.length - 1];
    const lastStart     = lastCluster.start;
    const lastEnd       = lastCluster.end;

    // Cycle lengths from cluster start intervals
    const cycleLengths = [];
    for (let i = 1; i < clusterStarts.length; i++) {
      cycleLengths.push(Math.round(
        (new Date(clusterStarts[i] + 'T00:00:00') - new Date(clusterStarts[i - 1] + 'T00:00:00')) / 86400000
      ));
    }
    const avgLen = cycleLengths.length
      ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length)
      : 28;

    // 2 ─ ML-predicted cycle length (same flow as /predict)
    let predictedCycleLength = avgLen;
    let predMethod = 'avg';

    if (cycleLengths.length >= 3) {
      try {
        const cycleVariability = calculateStdDev(cycleLengths);
        const mlResult = await runPython(CYCLE_SCRIPT, [
          cycleLengths[cycleLengths.length - 1], avgLen, 14,
          cycleVariability, clusterStarts.length, 28, 22, 0, 0,
        ]);
        predictedCycleLength = mlResult.predictedCycleLength ?? avgLen;
        predMethod = 'ml';
      } catch (mlErr) {
        console.warn('[cyclesML/state] ML failed, fallback:', mlErr.message);
        predictedCycleLength = weightedAverageFallback(cycleLengths).predicted_cycle_length;
        predMethod = 'weighted-avg';
      }
    } else if (cycleLengths.length > 0) {
      predictedCycleLength = weightedAverageFallback(cycleLengths).predicted_cycle_length;
      predMethod = 'weighted-avg';
    }

    // 3 ─ Phase via cyclePhaseEngine (with ML cycle length)
    const phaseData = computeCyclePhaseML(logs, predictedCycleLength);
    console.log(`[cyclesML/state] phase=${phaseData.phase} day=${phaseData.dayInCycle} method=${predMethod} len=${predictedCycleLength}`);

    // 4 ─ Confidence object
    const periodDuration = Math.max(1,
      Math.round((new Date(lastEnd + 'T00:00:00') - new Date(lastStart + 'T00:00:00')) / 86400000) + 1
    );
    const confidence = buildConfidenceObj(phaseData.confidence, cycleLengths.length);

    // 5 ─ Future cycles (date strings)
    const futureCycles = buildFutureCyclesBackend(lastStart, predictedCycleLength, periodDuration, 3, confidence.windowDays);

    // 6 ─ Calendar overlays
    const overlays = buildCalendarOverlays(futureCycles, clusterStarts);

    const state = {
      ready:                true,
      phase:                phaseData.phase,
      phaseLabel:           phaseData.phaseLabel,
      dayInCycle:           phaseData.dayInCycle,
      avgCycleLength:       phaseData.avgCycleLength ?? avgLen,
      predictedCycleLength,
      confidence,
      nextPeriodDate:       overlays.nextPeriodDate ?? phaseData.nextPeriodDate,
      ovulationDate:        phaseData.ovulationDate,
      fertileStart:         phaseData.fertileStart,
      fertileEnd:           phaseData.fertileEnd,
      cyclesLogged:         clusterStarts.length,
      predictedPeriodDays:  overlays.predictedPeriodDays,
      futureOvulationDates: overlays.futureOvulationDates,
      allFertileDays:       overlays.allFertileDays,
      futureCycles,
      disclaimer: 'This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.',
    };

    // 7 ─ Cache result + persist to Firestore (both non-blocking)
    _setCachedState(uid, lastPeriodDay, state);

    if (uid && db) {
      db.collection('users').doc(uid)
        .collection('cycleState').doc('current')
        .set({ ...state, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(err => console.warn('[cyclesML/state] Firestore persist failed:', err.message));
    }
    // 🔥 ALSO SAVE TO phaseProfile (this is what dashboard should use)
    if (uid && db) {
      db.collection('users').doc(uid).set(
        {
          phaseProfile: {
            lastPeriodStart: lastStart ?? null,
            phaseEstimation: {
              estimatedPhase: state.phase ?? null,
              phaseLabel: state.phaseLabel ?? null,
              cycleDay: state.dayInCycle ?? null,
              confidence: {
                level: state.confidence?.level ?? null,
                score:
                  state.confidence?.level === "High"
                    ? 0.9
                    : state.confidence?.level === "Medium"
                    ? 0.6
                    : 0.3,
              },
              override: null,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      ).catch(err =>
        console.warn("[cyclesML/state] phaseProfile save failed:", err.message)
      );
    }

    return res.json({ ok: true, state });
  } catch (err) {
    console.error('[cyclesML/state] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Route: POST /api/cycles/phase ───────────────────────────
// Uses cyclePhaseEngine.js to compute the current cycle phase.
// Accepts the same log shape as the frontend db.js getAllLogs().
// Optional mlPredictedCycleLength from a prior /predict call.

router.post('/phase', requireAuth, requireConsent, (req, res) => {
  try {
    const { logs = {}, mlPredictedCycleLength = null } = req.body;

    if (!logs || typeof logs !== 'object') {
      return res.status(400).json({ error: 'logs must be an object keyed by YYYY-MM-DD' });
    }

    const result = computeCyclePhaseML(logs, mlPredictedCycleLength);
    return res.json({ ok: true, phase: result });
  } catch (err) {
    console.error('[cyclesML] /phase error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;