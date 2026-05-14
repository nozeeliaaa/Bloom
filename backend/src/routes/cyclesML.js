// cyclesML.js
// Routes:
//   POST /api/cycles/predict   → ML cycle length prediction
//   POST /api/cycles/state     → full phase state (reads from Firestore, no body needed)
//   POST /api/cycles/phase     → quick phase via cyclePhaseEngine.js
//   POST /api/cycles/feedback  → store user feedback + re-estimate phase

import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from "../middleware/auth.js";
import { computeCyclePhaseML } from "../../ml/inference/cyclePhaseEngine.js";
import { db } from "../firebaseAdmin.js";
import admin from "firebase-admin";
import { ensureUserDocument } from "../utils/userDataPaths.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CYCLE_SCRIPT = path.join(__dirname, '../../ml/inference/cycle_predict.py');
const PYTHON_CMD = process.env.PYTHON_CMD || (process.platform === "win32" ? "python" : "python3");
const PYTHON_TIMEOUT_MS = Number(process.env.CYCLE_PY_TIMEOUT_MS || 5000);

const router = express.Router();

// ── Python runner ────────────────────────────────────────────

function runPython(scriptPath, args, { timeoutMs = PYTHON_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const python = spawn(PYTHON_CMD, [scriptPath, ...args.map(String)]);
    let output = '';
    let errorOutput = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { python.kill(); } catch (_) {}
      reject(new Error(`Python timed out after ${timeoutMs}ms (${PYTHON_CMD})`));
    }, timeoutMs);

    python.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start Python (${PYTHON_CMD}): ${err.message}`));
    });

    python.stdout.on('data', (data) => { output += data.toString(); });
    python.stderr.on('data', (data) => { errorOutput += data.toString(); });
    python.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`Python failed: ${errorOutput || `exit code ${code}`}`));
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

// ── In-memory cache ──────────────────────────────────────────
const _stateCache = new Map();
const _STATE_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function _getCachedState(uid, lastPeriodDay) {
  const entry = _stateCache.get(uid);
  if (!entry) return null;
  if (entry.lastPeriodDay !== lastPeriodDay) return null;
  if (Date.now() - entry.ts > _STATE_CACHE_TTL) return null;
  // Never serve "not ready" cache entries - they can become stale quickly
  // and block fresh estimation after new logs are added.
  if (!entry.state?.ready) return null;
  return entry.state;
}

function _setCachedState(uid, lastPeriodDay, state) {
  _stateCache.set(uid, { lastPeriodDay, state, ts: Date.now() });
}

function _clearCache(uid) {
  _stateCache.delete(uid);
}

function normalizeFlowValue(rawFlowLevel, rawFlow) {
  if (typeof rawFlow === "string" && rawFlow.trim()) {
    const normalized = rawFlow.trim().toLowerCase();
    if (normalized !== "none") return normalized;
  }

  const parsed = Number(rawFlowLevel);
  if (!Number.isFinite(parsed)) return "none";
  if (parsed <= 0) return "none";
  if (parsed >= 3) return "heavy";
  if (parsed >= 2) return "medium";
  return "light";
}

function mergeLogSnapByDate(target, snap, mapper, { override = true } = {}) {
  if (!snap?.docs) return;
  snap.forEach((doc) => {
    const row = doc.data() || {};
    const dateKey = row.dateKey || doc.id;
    if (!dateKey) return;
    if (!override && target[dateKey]) return;
    target[dateKey] = mapper(row, dateKey);
  });
}

function isPeriodDayEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const flow = normalizeFlowValue(entry.flowLevel, entry.flow);
  if (flow !== "none") return true;
  if (typeof entry.flowLevel === "number" && entry.flowLevel > 0) return true;
  if (Number.isFinite(Number(entry.periodDay)) && Number(entry.periodDay) > 0) return true;
  return entry.periodDay === true;
}

function getLastPeriodDayFromLogs(logsObj = {}) {
  return Object.keys(logsObj)
    .filter((dateKey) => isPeriodDayEntry(logsObj[dateKey]))
    .sort()
    .pop() ?? null;
}

function getPeriodCacheSignatureFromLogs(logsObj = {}) {
  const days = expandPeriodDaysBackend(logsObj);
  if (!days.length) return null;
  return `${days[days.length - 1]}|${days.length}`;
}

// ── Fallback: rule-based weighted average ────────────────────

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
  const weights = Array.from({ length: n }, (_, i) => i + 1);
  const sumW    = weights.reduce((a, w) => a + w, 0);
  const weighted = weights.reduce((a, w, i) => a + w * cycleHistory[i], 0) / sumW;
  const clamped  = Math.max(21, Math.min(45, Math.round(weighted)));
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

function calculateStdDev(arr) {
  if (!arr || arr.length < 2) return 1.5;
  const mean     = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function isPlausibleCycleLength(length) {
  return Number.isFinite(Number(length)) && Number(length) >= 15 && Number(length) <= 60;
}

function clampPredictedCycleLength(length, fallback = 28) {
  const parsed = Number(length);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(15, Math.min(60, Math.round(parsed)));
}

// ── Firestore data fetcher ───────────────────────────────────
// Reads all logs from Firestore for the given uid.
// Returns { cycleLogs, symptomLogs, biometricLogs } as flat objects keyed by dateKey.

async function fetchUserLogs(uid, daysBack = 180, cycleLogsOverride = null) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const userRef = db.collection('users').doc(uid);

  const hasCycleOverride =
    cycleLogsOverride &&
    typeof cycleLogsOverride === "object" &&
    Object.keys(cycleLogsOverride).length > 0;

  const [cycleSnap, symptomSnap, biometricSnap, feedbackSnap] = await Promise.all([
    hasCycleOverride
      ? Promise.resolve(null)
      : userRef.collection('cycleLogs')
        .where('dateKey', '>=', cutoffKey)
        .orderBy('dateKey', 'asc')
        .get(),
    userRef.collection('symptomLogs')
      .where('dateKey', '>=', cutoffKey)
      .orderBy('dateKey', 'asc')
      .get(),
    userRef.collection('biometricLogs')
      .where('dateKey', '>=', cutoffKey)
      .orderBy('dateKey', 'asc')
      .get(),
    userRef.collection('phaseFeedback')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get(),
  ]);

  const cycleLogs = {};
  if (hasCycleOverride) {
    for (const [dateKey, rowRaw] of Object.entries(cycleLogsOverride)) {
      if (!dateKey) continue;
      const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
      cycleLogs[dateKey] = {
        ...row,
        dateKey,
        flow: normalizeFlowValue(row.flowLevel, row.flow),
      };
    }
  } else if (!hasCycleOverride) {
    const legacySnap = await db.collection('cycleLogs').doc(uid).collection('entries')
      .where('dateKey', '>=', cutoffKey)
      .orderBy('dateKey', 'asc')
      .get();
    const mapCycle = (row, dateKey) => ({
      ...row,
      dateKey,
      flow: normalizeFlowValue(row.flowLevel, row.flow),
    });
    mergeLogSnapByDate(cycleLogs, legacySnap, mapCycle);
    mergeLogSnapByDate(cycleLogs, cycleSnap, mapCycle);
  }

  const symptomLogs = {};
  const legacySymptomSnap = await db.collection('symptomLogs').doc(uid).collection('entries')
    .where('dateKey', '>=', cutoffKey)
    .orderBy('dateKey', 'asc')
    .get();
  const mapGeneric = (row, dateKey) => ({ ...row, dateKey });
  mergeLogSnapByDate(symptomLogs, legacySymptomSnap, mapGeneric);
  mergeLogSnapByDate(symptomLogs, symptomSnap, mapGeneric);

  const biometricLogs = {};
  const legacyBiometricSnap = await db.collection('biometricLogs').doc(uid).collection('entries')
    .where('dateKey', '>=', cutoffKey)
    .orderBy('dateKey', 'asc')
    .get();
  mergeLogSnapByDate(biometricLogs, legacyBiometricSnap, mapGeneric);
  mergeLogSnapByDate(biometricLogs, biometricSnap, mapGeneric);

  let phaseFeedback = feedbackSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const legacyFeedbackSnap = await db.collection('phaseFeedback').doc(uid).collection('entries')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  const feedbackById = new Map();
  legacyFeedbackSnap.docs.forEach(doc => feedbackById.set(doc.id, { id: doc.id, ...doc.data() }));
  phaseFeedback.forEach(entry => feedbackById.set(entry.id, entry));
  phaseFeedback = [...feedbackById.values()]
    .sort((a, b) => {
      const at = a.createdAt?.toMillis?.() ?? (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bt = b.createdAt?.toMillis?.() ?? (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return bt - at;
    })
    .slice(0, 10);

  return { cycleLogs, symptomLogs, biometricLogs, phaseFeedback };
}

// ── Symptom phase support scorer ─────────────────────────────
// Looks at recent symptoms and scores which phase they support.

const SYMPTOM_PHASE_MAP = {
  // Menstrual
  CRAMPS:          { menstrual: 3, follicular: 0, ovulation: 0, luteal: 1 },
  HEAVY_BLEEDING:  { menstrual: 3, follicular: 0, ovulation: 0, luteal: 0 },
  CLOTTING:        { menstrual: 3, follicular: 0, ovulation: 0, luteal: 0 },
  BACK_PAIN:       { menstrual: 2, follicular: 0, ovulation: 0, luteal: 1 },
  FATIGUE:         { menstrual: 2, follicular: 0, ovulation: 0, luteal: 2 },
  // Follicular
  ACNE:            { menstrual: 0, follicular: 2, ovulation: 1, luteal: 1 },
  // Ovulation
  OVULATION_PAIN:  { menstrual: 0, follicular: 0, ovulation: 3, luteal: 0 },
  DISCHARGE_NORMAL:{ menstrual: 0, follicular: 1, ovulation: 3, luteal: 0 },
  LIBIDO_CHANGE:   { menstrual: 0, follicular: 1, ovulation: 3, luteal: 0 },
  // Luteal
  BLOATING:        { menstrual: 1, follicular: 0, ovulation: 0, luteal: 3 },
  BREAST_TENDERNESS:{ menstrual: 0, follicular: 0, ovulation: 1, luteal: 3 },
  MOOD_SWINGS:     { menstrual: 1, follicular: 0, ovulation: 0, luteal: 3 },
  IRRITABILITY:    { menstrual: 1, follicular: 0, ovulation: 0, luteal: 3 },
  LOW_MOOD:        { menstrual: 1, follicular: 0, ovulation: 0, luteal: 2 },
  WATER_RETENTION: { menstrual: 0, follicular: 0, ovulation: 0, luteal: 3 },
  APPETITE_CHANGE: { menstrual: 0, follicular: 0, ovulation: 0, luteal: 2 },
  HEADACHE:        { menstrual: 2, follicular: 0, ovulation: 0, luteal: 2 },
  NAUSEA:          { menstrual: 2, follicular: 0, ovulation: 1, luteal: 1 },
  HOT_FLASHES:     { menstrual: 0, follicular: 0, ovulation: 0, luteal: 2 },
  INSOMNIA:        { menstrual: 0, follicular: 0, ovulation: 0, luteal: 2 },
};

function scoreSymptoms(symptomLogs, recentDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - recentDays);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const support = { menstrual: 0, follicular: 0, ovulation: 0, luteal: 0 };
  const contradictions = [];
  let totalLogged = 0;
  let daysWithLogs = 0;

  for (const [dateKey, entry] of Object.entries(symptomLogs)) {
    if (dateKey < cutoffKey) continue;
    const items = Array.isArray(entry.items) ? entry.items : [];
    if (items.length > 0) daysWithLogs++;

    for (const item of items) {
      const code = item.code || item.symptomKey;
      if (!code) continue;
      totalLogged++;
      const mapping = SYMPTOM_PHASE_MAP[code];
      if (!mapping) continue;
      for (const phase of Object.keys(support)) {
        support[phase] += mapping[phase] || 0;
      }
    }
  }

  // Detect contradictions: menstrual + ovulation both high
  if (support.menstrual >= 3 && support.ovulation >= 3) {
    contradictions.push('Bleeding symptoms and ovulation symptoms both present');
  }

  const loggingGap = daysWithLogs < 3;
  const lowHistory = totalLogged < 2;

  return {
    phaseSupport: support,
    contradictions,
    dataQuality: { loggingGap, lowHistory },
  };
}

// ── Biometric phase scorer ────────────────────────────────────
// Uses recent sleep/stress/activity to nudge phase confidence.

function scoreBiometrics(biometricLogs, recentDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - recentDays);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  const recent = Object.entries(biometricLogs)
    .filter(([k]) => k >= cutoffKey)
    .map(([, v]) => v);

  if (recent.length === 0) {
    return { predictedPhase: null, confidence: 0, weightApplied: 0 };
  }

  const avgSleep    = recent.reduce((a, b) => a + (b.sleepScore    ?? 3), 0) / recent.length;
  const avgStress   = recent.reduce((a, b) => a + (b.stressLevel   ?? 2), 0) / recent.length;
  const avgActivity = recent.reduce((a, b) => a + (b.activityLevel ?? 2), 0) / recent.length;

  // Heuristic: high stress + low sleep → luteal signal
  // Low stress + good sleep + moderate activity → follicular/ovulation signal
  let predictedPhase = null;
  let confidence = 0;

  if (avgStress >= 3.5 && avgSleep <= 2.5) {
    predictedPhase = 'luteal';
    confidence = 0.45;
  } else if (avgStress <= 2 && avgSleep >= 3.5 && avgActivity >= 3) {
    predictedPhase = 'follicular';
    confidence = 0.40;
  } else if (avgActivity >= 4 && avgStress <= 2.5) {
    predictedPhase = 'ovulation';
    confidence = 0.35;
  }

  return {
    predictedPhase,
    confidence,
    weightApplied: predictedPhase ? 0.3 : 0,
  };
}

// ── Signal fusion ─────────────────────────────────────────────
// Combines cycle timing, symptoms, and biometrics into one result.

function fuseSignals(phaseData, symptomScore, biometricScore, quality = {}) {
  const phases = ['menstrual', 'follicular', 'ovulation', 'luteal'];

  // Normalize cycle timing into a support object
  const cycleSupport = { menstrual: 0, follicular: 0, ovulation: 0, luteal: 0 };
  const cyclePhaseKey = phaseData.phase === 'ovulatory' ? 'ovulation' : phaseData.phase;
  if (cyclePhaseKey && cycleSupport[cyclePhaseKey] !== undefined) {
    const baseScore = phaseData.confidence === 'high' ? 3
      : phaseData.confidence === 'medium' ? 2 : 1;
    cycleSupport[cyclePhaseKey] = baseScore;
  }

  // Weighted fusion
  const CYCLE_WEIGHT    = quality.lowHistory ? 0.35 : quality.irregularCycles ? 0.4 : 0.5;
  const SYMPTOM_WEIGHT  = quality.lowHistory ? 0.35 : 0.25;
  const BIOMETRIC_WEIGHT = biometricScore.weightApplied;
  const remaining = 1 - CYCLE_WEIGHT - SYMPTOM_WEIGHT - BIOMETRIC_WEIGHT;

  // Normalize symptom support
  const symptomTotal = Object.values(symptomScore.phaseSupport).reduce((a, b) => a + b, 0) || 1;
  const symptomNorm  = {};
  for (const p of phases) symptomNorm[p] = symptomScore.phaseSupport[p] / symptomTotal;

  // Fuse scores
  const fused = {};
  for (const p of phases) {
    const cycleNorm = cycleSupport[p] / 3;
    const bioScore  = biometricScore.predictedPhase === p ? biometricScore.confidence : 0;
    fused[p] = (cycleNorm * CYCLE_WEIGHT) + (symptomNorm[p] * SYMPTOM_WEIGHT) + (bioScore * BIOMETRIC_WEIGHT);
  }

  // Winner
  const winner = phases.reduce((a, b) => fused[a] >= fused[b] ? a : b);
  const score  = fused[winner];

  // Check agreement
  const sortedScores = Object.values(fused).sort((a, b) => b - a);
  const signalAgreementScore = sortedScores[0] - (sortedScores[1] || 0);
  const conflictDetected = signalAgreementScore < 0.15;

  // Map winner back to display phase
  const finalPhase = winner === 'ovulation' ? 'ovulatory' : winner;

  // Confidence level
  let confidenceScore = score;
  if (quality.irregularCycles) confidenceScore -= 0.08;
  if (quality.lowHistory) confidenceScore -= 0.12;
  if (quality.extremeCycleLengths) confidenceScore -= 0.1;
  confidenceScore = Math.max(0.12, Math.min(0.95, confidenceScore));
  const confidenceLevel = confidenceScore >= 0.55 ? 'high' : confidenceScore >= 0.32 ? 'medium' : 'low';
  confidenceScore = Math.round(confidenceScore * 100) / 100;

  return {
    estimatedPhase: finalPhase,
    confidence: { level: confidenceLevel, score: confidenceScore },
    signals: {
      cycleTiming: { phaseSupport: cycleSupport },
      symptoms: symptomScore,
      biometricModel: biometricScore,
      rules: {
        bleedingOverride: phaseData.phase === 'menstrual',
        biologicallyPlausible: !conflictDetected,
      },
    },
    agreement: { signalAgreementScore: Math.round(signalAgreementScore * 100) / 100, conflictDetected },
  };
}

// ── Display message builder ───────────────────────────────────

function buildDisplay(estimatedPhase, confidenceLevel, conflictDetected, quality = {}) {
  const phaseLabels = {
    menstrual: 'menstrual', follicular: 'follicular',
    ovulatory: 'ovulatory', luteal: 'luteal',
  };
  const label = phaseLabels[estimatedPhase] || estimatedPhase;

  if (conflictDetected) {
    return {
      mode: 'soft',
      message: `Bloom is picking up mixed signals - you may be transitioning into your ${label} phase.`,
    };
  }
  if (quality.lowHistory) {
    return {
      mode: 'soft',
      message: `Bloom has a tentative ${label} phase estimate. Log more cycle days to improve confidence.`,
    };
  }
  if (quality.irregularCycles) {
    return {
      mode: 'soft',
      message: `Bloom thinks you may be in your ${label} phase, but your recent cycle lengths vary.`,
    };
  }
  if (confidenceLevel === 'high') {
    return {
      mode: 'strong',
      message: `Based on your data, you are most likely in your ${label} phase.`,
    };
  }
  return {
    mode: 'soft',
    message: `Bloom thinks you may be in your ${label} phase.`,
  };
}

// ── Explanation builder ───────────────────────────────────────

function buildExplanation(phaseData, symptomScore, biometricScore, estimatedPhase, quality = {}) {
  const details = [];

  if (phaseData.dayInCycle) {
    details.push(`You are on day ${phaseData.dayInCycle} of your cycle.`);
  }

  const topSymptoms = Object.entries(symptomScore.phaseSupport)
    .sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v > 0)
    .slice(0, 2)
    .map(([p]) => p);

  if (topSymptoms.length > 0) {
    details.push(`Your recent symptoms align most with the ${topSymptoms[0]} phase.`);
  }

  if (biometricScore.predictedPhase) {
    details.push(`Your sleep and stress levels suggest a ${biometricScore.predictedPhase} pattern.`);
  }

  if (symptomScore.contradictions.length > 0) {
    details.push('Some conflicting signals were detected - logging more data will improve accuracy.');
  }

  if (quality.lowHistory) {
    details.push('There is limited cycle history, so this estimate is intentionally cautious.');
  }
  if (quality.irregularCycles) {
    details.push('Your recent cycle lengths are irregular, which lowers prediction confidence.');
  }
  if (quality.extremeCycleLengths) {
    details.push('One or more logged cycle lengths were outside the usual range and excluded from prediction.');
  }

  return {
    summary: `Based on your cycle timing${topSymptoms.length ? ', logged symptoms' : ''}${biometricScore.predictedPhase ? ', and biometric data' : ''}.`,
    details,
  };
}

// ── Date helpers ─────────────────────────────────────────────

function dateStrAddDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function getPeriodClustersBackend(logs) {
  const periodDays = expandPeriodDaysBackend(logs);
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

function expandPeriodDaysBackend(logs = {}) {
  const days = new Set();

  for (const [dateKey, entry] of Object.entries(logs || {})) {
    if (!isPeriodDayEntry(entry)) continue;

    const explicitPeriodDay = Number(entry?.periodDay);
    if (Number.isInteger(explicitPeriodDay) && explicitPeriodDay > 1 && explicitPeriodDay <= 10) {
      const start = dateStrAddDays(dateKey, -(explicitPeriodDay - 1));
      for (let i = 0; i < explicitPeriodDay; i++) {
        days.add(dateStrAddDays(start, i));
      }
      continue;
    }

    days.add(dateKey);
  }

  return [...days].sort();
}

function periodClusterDuration(cluster) {
  return Math.round(
    (new Date(cluster.end + 'T00:00:00') - new Date(cluster.start + 'T00:00:00')) / 86400000
  ) + 1;
}

function estimatePeriodDurationBackend(clusters, profileDuration = null) {
  // Use the user's completed bleeding clusters when available. A lone start
  // date is intentionally not treated as a 1-day period; if duration history is
  // sparse, Bloom falls back to 5 days so menstrual phase and calendar overlays
  // continue through the expected bleed even without daily logs.
  const loggedDurations = clusters
    .map(periodClusterDuration)
    .filter((duration) => Number.isFinite(duration) && duration >= 2 && duration <= 10);

  const profileDays = Number(profileDuration);
  const rawDuration = loggedDurations.length
    ? loggedDurations.reduce((sum, duration) => sum + duration, 0) / loggedDurations.length
    : (Number.isFinite(profileDays) && profileDays >= 2 && profileDays <= 10 ? profileDays : 5);

  return Math.max(3, Math.min(8, Math.round(rawDuration)));
}

function buildFutureCyclesBackend(lastPeriodStart, predictedLength, periodDuration, monthsAhead, windowDays) {
  const cycles = [];
  let chainStart = lastPeriodStart;
  const cycleLengthDays = Math.max(21, Math.min(45, Math.round(Number(predictedLength) || 28)));
  for (let i = 0; i < monthsAhead; i++) {
    const periodStart  = dateStrAddDays(chainStart, cycleLengthDays);
    const periodEnd    = dateStrAddDays(periodStart, periodDuration - 1);
    const ovulationDay = dateStrAddDays(periodStart, -14);
    const fertileStart = dateStrAddDays(ovulationDay, -5);
    const fertileEnd   = dateStrAddDays(ovulationDay, 1);
    const grow = windowDays * (i + 1);
    cycles.push({
      cycleLength: cycleLengthDays, periodStart, periodEnd, ovulationDay,
      fertileWindow: { start: fertileStart, end: fertileEnd },
      earliestStart: dateStrAddDays(periodStart, -grow),
      latestStart:   dateStrAddDays(periodStart,  grow),
      isEstimate: true,
    });
    chainStart = periodStart;
  }
  return cycles;
}

const FUTURE_CYCLES_TO_PROJECT = 10;

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

function phaseLabelForDisplay(phaseKey, fallback = 'Unknown') {
  const labels = {
    menstrual: 'Menstrual',
    follicular: 'Follicular',
    ovulation: 'Ovulatory',
    ovulatory: 'Ovulatory',
    luteal: 'Luteal',
    late_luteal: 'Late Luteal',
  };
  return labels[String(phaseKey || '').toLowerCase()] || fallback;
}

function buildCalendarOverlays(futureCycles, clusterStarts, loggedPeriodDays = new Set()) {
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
    // Only add ovulation/fertile days that don't fall on a confirmed period day
    if (c.ovulationDay && !loggedPeriodDays.has(c.ovulationDay)) {
      futureOvulationDates.push(c.ovulationDay);
    }
    if (c.fertileWindow?.start && c.fertileWindow?.end) {
      let d = c.fertileWindow.start;
      while (d <= c.fertileWindow.end) {
        if (!loggedPeriodDays.has(d)) allFertileDays.push(d);
        d = dateStrAddDays(d, 1);
      }
    }
  }
  return { predictedPeriodDays, futureOvulationDates, allFertileDays, nextPeriodDate };
}

function hasLoggedPeriodResolvingPrediction(clusterStarts, periodStart, windowDays = 14) {
  if (!periodStart) return false;
  const predMs = new Date(periodStart + 'T00:00:00').getTime();
  return clusterStarts.some(
    s => Math.abs(new Date(s + 'T00:00:00').getTime() - predMs) <= windowDays * 86400000
  );
}

function buildPeriodPredictionStatus(futureCycles, clusterStarts) {
  const today = todayDateKey();
  const unresolvedPastCycles = (futureCycles || [])
    .filter(c =>
      c?.periodStart &&
      c.periodStart < today &&
      !hasLoggedPeriodResolvingPrediction(clusterStarts, c.periodStart)
    )
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart));

  const latestOverdue = unresolvedPastCycles[unresolvedPastCycles.length - 1] ?? null;
  if (!latestOverdue) {
    return {
      status: 'upcoming',
      predictedStart: null,
      predictedEnd: null,
      daysLate: 0,
      message: '',
    };
  }

  const daysLate = Math.max(1, Math.round(
    (new Date(today + 'T00:00:00') - new Date(latestOverdue.periodStart + 'T00:00:00')) / 86400000
  ));

  // Stale predictions are not presented as future dates. The old expected
  // window stays attached to the shared state so dashboard and calendar can say
  // "expected around May 1-May 5" or "late by 8 days" consistently.
  return {
    status: 'overdue',
    predictedStart: latestOverdue.periodStart,
    predictedEnd: latestOverdue.periodEnd ?? latestOverdue.periodStart,
    daysLate,
    message: `Period is late by ${daysLate} day${daysLate === 1 ? '' : 's'}.`,
  };
}

// ── Core estimation function ──────────────────────────────────
// Extracted so both /state and /feedback can call it.

async function computeFullEstimation(uid, cycleLogsOverride = null, options = {}) {
  const mlTimeoutMs = Number(options.mlTimeoutMs ?? Math.min(PYTHON_TIMEOUT_MS, 1200));
  const allowML = options.allowML !== false;

  // 1 - Fetch all logs from Firestore
  const { cycleLogs, symptomLogs, biometricLogs, phaseFeedback } = await fetchUserLogs(uid, 180, cycleLogsOverride);
  const userDoc = await db.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() || {} : {};

  // 2 - Derive period clusters from cycle logs
  const clusters = getPeriodClustersBackend(cycleLogs);

  if (!clusters.length) {
  const symptomScore = scoreSymptoms(symptomLogs);
  const biometricScore = scoreBiometrics(biometricLogs);
  const phaseEstimation = {
    estimatedPhase: 'unknown',
    confidence: { level: 'low', score: 0.12 },
    display: {
      mode: 'soft',
      message: 'Log your first period to see your current phase estimate.',
    },
    timingContext: {
      cycleDay: null,
      predictedCycleLength: userData.averageCycleLength ?? userData.healthProfile?.avgCycleLength ?? null,
      predictedNextPeriodDate: null,
      estimatedOvulationWindow: null,
    },
    signals: {
      cycleTiming: { phaseSupport: { menstrual: 0, follicular: 0, ovulation: 0, luteal: 0 } },
      symptoms: symptomScore,
      biometricModel: biometricScore,
      rules: { bleedingOverride: false, biologicallyPlausible: false },
    },
    agreement: { signalAgreementScore: 0, conflictDetected: false },
    explanation: {
      summary: 'There is not enough cycle history yet.',
      details: ['Add at least one period start date so Bloom can estimate your cycle phase.'],
    },
    feedback: { prompt: false, options: ['yes', 'not_sure', 'no'] },
    override: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  return {
    state: {
      ready: false,
      phase: 'unknown',
      phaseLabel: 'Unknown',
      dayInCycle: null,
      avgCycleLength: null,
      predictedCycleLength: null,
      confidence: {
        level: 'Low',
        windowDays: 5,
        message: 'Log your first period to see predictions.',
      },
      nextPeriodDate: null,
      ovulationDate: null,
      fertileStart: null,
      fertileEnd: null,
      cyclesLogged: 0,
      cycleLengths: [],
      predictedPeriodDays: [],
      futureOvulationDates: [],
      allFertileDays: [],
      futureCycles: [],
      phaseEstimation,
      disclaimer: 'This is an educational estimate, not a medical prediction.',
    },
    lastStart: null,
  };
}

  const clusterStarts = clusters.map(c => c.start);
  const lastCluster   = clusters[clusters.length - 1];
  const lastStart     = lastCluster.start;

  // Cycle lengths from cluster intervals
  const rawCycleLengths = [];
  for (let i = 1; i < clusterStarts.length; i++) {
    rawCycleLengths.push(Math.round(
      (new Date(clusterStarts[i] + 'T00:00:00') - new Date(clusterStarts[i - 1] + 'T00:00:00')) / 86400000
    ));
  }
  const cycleLengths = rawCycleLengths.filter(isPlausibleCycleLength);
  const excludedCycleLengths = rawCycleLengths.filter((length) => !isPlausibleCycleLength(length));
  const fallbackCycleLength = clampPredictedCycleLength(
    userData.averageCycleLength ?? userData.healthProfile?.avgCycleLength ?? 28,
    28
  );
  const avgLen = cycleLengths.length
    ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length)
    : fallbackCycleLength;
  const cycleStdDev = calculateStdDev(cycleLengths);
  const quality = {
    lowHistory: clusterStarts.length < 2 || cycleLengths.length < 1,
    irregularCycles: cycleLengths.length >= 2 && cycleStdDev >= 7,
    extremeCycleLengths: excludedCycleLengths.length > 0,
    recentFeedbackCount: phaseFeedback.length,
  };

  // 3 - ML-predicted cycle length
  let predictedCycleLength = avgLen;
  let predMethod = 'avg';

  if (allowML && cycleLengths.length >= 3) {
    try {
      const cycleVariability = calculateStdDev(cycleLengths);
      const mlResult = await runPython(CYCLE_SCRIPT, [
        cycleLengths[cycleLengths.length - 1], avgLen, 14,
        cycleVariability, clusterStarts.length, 28, 22, 0, 0,
      ], { timeoutMs: mlTimeoutMs });
      predictedCycleLength = clampPredictedCycleLength(mlResult.predictedCycleLength ?? avgLen, avgLen);
      predMethod = 'ml';
    } catch (mlErr) {
      console.warn('[cyclesML] ML failed, fallback:', mlErr.message);
      predictedCycleLength = clampPredictedCycleLength(weightedAverageFallback(cycleLengths, avgLen).predicted_cycle_length, avgLen);
      predMethod = 'weighted-avg';
    }
  } else if (cycleLengths.length > 0) {
    predictedCycleLength = clampPredictedCycleLength(weightedAverageFallback(cycleLengths, avgLen).predicted_cycle_length, avgLen);
    predMethod = 'weighted-avg';
  }

  // 4 - Phase via cyclePhaseEngine
  const phaseData = computeCyclePhaseML(cycleLogs, predictedCycleLength);

  // 5 - Score symptoms and biometrics
  const symptomScore   = scoreSymptoms(symptomLogs);
  const biometricScore = scoreBiometrics(biometricLogs);

  // 6 - Fuse all signals
  const fusion = fuseSignals(phaseData, symptomScore, biometricScore, quality);

  // 7 - Build display + explanation
  const display     = buildDisplay(fusion.estimatedPhase, fusion.confidence.level, fusion.agreement.conflictDetected, quality);
  const explanation = buildExplanation(phaseData, symptomScore, biometricScore, fusion.estimatedPhase, quality);

  // 8 - Confidence + calendar overlays
  const periodDuration = estimatePeriodDurationBackend(
    clusters,
    userData.healthProfile?.periodDuration
  );
  const confidence  = buildConfidenceObj(phaseData.confidence, cycleLengths.length);
  const futureCycles = buildFutureCyclesBackend(
    lastStart,
    predictedCycleLength,
    periodDuration,
    FUTURE_CYCLES_TO_PROJECT,
    confidence.windowDays
  );
  const loggedPeriodDays = new Set(expandPeriodDaysBackend(cycleLogs));
  const overlays    = buildCalendarOverlays(futureCycles, clusterStarts, loggedPeriodDays);
  const periodPrediction = buildPeriodPredictionStatus(futureCycles, clusterStarts);
  const displayPhaseKey = fusion.estimatedPhase;
  const displayPhaseLabel = phaseLabelForDisplay(displayPhaseKey, phaseData.phaseLabel);
  let currentOvulationDate = phaseData.ovulationDate;
  let currentFertileStart = phaseData.fertileStart;
  let currentFertileEnd = phaseData.fertileEnd;
  const todayKey = todayDateKey();
  const displaySaysPostOvulation = ['luteal', 'late_luteal'].includes(String(displayPhaseKey || '').toLowerCase());
  if (displaySaysPostOvulation && currentOvulationDate && currentOvulationDate >= todayKey) {
    currentOvulationDate = null;
    currentFertileStart = null;
    currentFertileEnd = null;
  }

  // 9 - Build full phaseEstimation object (Jahzara's spec)
  const phaseEstimation = {
    estimatedPhase: displayPhaseKey,
    confidence: fusion.confidence,
    display,
    timingContext: {
      cycleDay:               phaseData.dayInCycle,
      predictedCycleLength,
      predictedNextPeriodDate: overlays.nextPeriodDate ?? phaseData.nextPeriodDate,
      periodPrediction,
      estimatedOvulationWindow: currentFertileStart && currentFertileEnd
        ? { start: currentFertileStart, end: currentFertileEnd }
        : null,
    },
    signals:     fusion.signals,
    agreement:   fusion.agreement,
    explanation,
    dataQuality: {
      lowHistory: quality.lowHistory,
      irregularCycles: quality.irregularCycles,
      excludedCycleLengths,
      predictionMethod: predMethod,
      recentFeedbackCount: phaseFeedback.length,
    },
    feedback:    { prompt: true, options: ['yes', 'not_sure', 'no'] },
    override:    null,
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  };

  const state = {
    ready:                true,
    phase:                displayPhaseKey,
    phaseLabel:           displayPhaseLabel,
    dayInCycle:           phaseData.dayInCycle,
    avgCycleLength:       phaseData.avgCycleLength ?? avgLen,
    predictedCycleLength,
    confidence,
    nextPeriodDate:       overlays.nextPeriodDate ?? phaseData.nextPeriodDate,
    periodPrediction,
    averagePeriodDuration: periodDuration,
    ovulationDate:        currentOvulationDate,
    fertileStart:         currentFertileStart,
    fertileEnd:           currentFertileEnd,
    cyclesLogged:         clusterStarts.length,
    cycleLengths,
    predictedPeriodDays:  overlays.predictedPeriodDays,
    futureOvulationDates: overlays.futureOvulationDates,
    allFertileDays:       overlays.allFertileDays,
    futureCycles,
    phaseEstimation,
    disclaimer: 'This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.',
  };

  return { state, lastStart };
}

// ── Route: POST /api/cycles/predict ─────────────────────────

router.post('/predict', requireAuth, async (req, res) => {
  try {
    const {
      cycleLength, meanCycleLength,
      lutealPhaseLength    = 14,
      cycleNumber          = 1,
      age                  = 28,
      bmi                  = 22,
      unusualBleeding      = 0,
      reproductiveCategory = 0,
      cycleHistory         = []
    } = req.body;

    if (cycleHistory.length < 3) {
      return res.json({ prediction: weightedAverageFallback(cycleHistory) });
    }

    const cycleVariability = calculateStdDev(cycleHistory);

    try {
      const cycleResult = await runPython(CYCLE_SCRIPT, [
        cycleLength, meanCycleLength, lutealPhaseLength,
        cycleVariability, cycleNumber, age, bmi,
        unusualBleeding, reproductiveCategory
      ]);
      return res.json({
        prediction: {
          predicted_cycle_length: cycleResult.predictedCycleLength,
          method: 'ml-weighted-ols', confidence: 'high',
          message: cycleResult.message
        }
      });
    } catch (mlErr) {
      console.warn('[cyclesML] ML failed, using fallback:', mlErr.message);
      return res.json({ prediction: weightedAverageFallback(cycleHistory) });
    }
  } catch (err) {
    console.error('[cyclesML] predict failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Route: POST /api/cycles/state ────────────────────────────
// No body needed - reads all logs from Firestore using req.user.uid

router.post('/state', requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    console.log(`[cyclesML/state] uid=${uid}`);

    // Check cache
    const requestLogs = (req.body && typeof req.body === "object") ? (req.body.logs || {}) : {};
    const requestLastPeriodDay = getLastPeriodDayFromLogs(requestLogs);
    const requestPeriodSignature = getPeriodCacheSignatureFromLogs(requestLogs);
    await ensureUserDocument(uid);
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};
    const lastPeriodDay =
      requestLastPeriodDay ??
      userData?.lastPeriodStart ??
      userData?.phaseProfile?.lastPeriodStart ??
      'none';

    const todayKey = todayDateKey();
    const cacheKey = `${requestPeriodSignature ?? lastPeriodDay}|${todayKey}`;
    const cached = _getCachedState(uid, cacheKey);
    if (cached) {
      console.log(`[cyclesML/state] cache hit uid=${uid}`);
      return res.json({ ok: true, state: cached });
    }

    const { state, lastStart } = await computeFullEstimation(uid, requestLogs, {
      allowML: true,
      mlTimeoutMs: Number(process.env.CYCLE_STATE_ML_TIMEOUT_MS || 1200),
    });
    console.log(
      `[cyclesML/state] complete uid=${uid} ready=${state.ready} phase=${state.phase} len=${state.predictedCycleLength}`
    );

    // Cache + persist to Firestore (non-blocking)
    _setCachedState(uid, cacheKey ?? `${lastStart ?? 'none'}|${todayKey}`, state);

    if (db) {
      // Persist full state to cycleState/current
      db.collection('users').doc(uid)
        .collection('cycleState').doc('current')
        .set({ ...state, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(err => console.warn('[cyclesML/state] cycleState persist failed:', err.message));

      // Persist phaseEstimation to main user doc
      if (state.phaseEstimation) {
        db.collection('users').doc(uid).set(
          {
            lastPeriodStart: lastStart ?? null,
            averageCycleLength: state.avgCycleLength ?? null,
            cycleLengths: state.cycleLengths ?? [],
            phaseEstimation: state.phaseEstimation,
            phaseProfile: {
              lastPeriodStart: lastStart ?? null,
              phaseEstimation: state.phaseEstimation,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ).catch(err => console.warn('[cyclesML/state] phaseProfile save failed:', err.message));
      }
    }

    return res.json({ ok: true, state });
  } catch (err) {
    console.error('[cyclesML/state] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Route: POST /api/cycles/feedback ─────────────────────────
// Stores user feedback and re-runs phase estimation if correction is strong.

router.post('/feedback', requireAuth, async (req, res) => {
  try {
    const uid  = req.user.uid;
    const body = req.body || {};

    const { userResponse, correction, estimatedPhase, confidence } = body;

    const VALID_RESPONSES = ['yes', 'not_sure', 'no'];
    if (!VALID_RESPONSES.includes(userResponse)) {
      return res.status(400).json({ error: `userResponse must be one of: ${VALID_RESPONSES.join(', ')}` });
    }

    // 1 - Store feedback doc in phaseFeedback subcollection
    await ensureUserDocument(uid);

    const feedbackRef = db.collection('users').doc(uid).collection('phaseFeedback').doc();
    const legacyFeedbackRef = db.collection('phaseFeedback').doc(uid).collection('entries').doc(feedbackRef.id);

    const feedbackDoc = {
      timestamp:  new Date().toISOString(),
      prediction: { phase: estimatedPhase || null, confidence: confidence || null },
      userFeedback: {
        response:          userResponse,
        correctedPhase:    correction || null,
        bleedingConfirmed: correction === 'bleeding',
      },
      context: {
        cycleDay: body.cycleDay ?? null,
        symptomsLogged: Array.isArray(body.symptomsLogged) ? body.symptomsLogged : [],
        biometricUsed: !!body.biometricUsed,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await feedbackRef.set(feedbackDoc);
    await legacyFeedbackRef.set(feedbackDoc);

    // 2 - If strong correction (bleeding confirmed or explicit phase given), re-estimate
    const isStrongCorrection = correction === 'bleeding' || (userResponse === 'no' && correction);

    if (!isStrongCorrection) {
      return res.json({ ok: true, reestimated: false, message: 'Feedback saved.' });
    }

    // 3 - If bleeding correction, update lastPeriodStart to today
    if (correction === 'bleeding') {
      const today = todayDateKey();
      await db.collection('users').doc(uid).set(
        {
          lastPeriodStart: today,
          phaseProfile: { lastPeriodStart: today },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    // 4 - Clear cache and re-run estimation
    _clearCache(uid);
    const { state, lastStart } = await computeFullEstimation(uid);

    // 5 - If bleeding, override the estimated phase
    if (correction === 'bleeding' && state.phaseEstimation) {
      state.phaseEstimation.estimatedPhase = 'menstrual';
      state.phaseEstimation.confidence     = { level: 'high', score: 0.9 };
      state.phaseEstimation.display        = {
        mode:    'strong',
        message: 'Bloom has updated your phase based on your input.',
      };
      state.phaseEstimation.override = {
        source: 'user_feedback',
        reason: 'bleeding_confirmed',
      };
      state.phase      = 'menstrual';
      state.phaseLabel = 'Menstrual';
    }

    // 6 - Persist updated state
    _setCachedState(uid, lastStart ?? 'none', state);

    if (db) {
      db.collection('users').doc(uid)
        .collection('cycleState').doc('current')
        .set({ ...state, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(err => console.warn('[cyclesML/feedback] cycleState persist failed:', err.message));

      if (state.phaseEstimation) {
        db.collection('users').doc(uid).set(
          {
            lastPeriodStart: lastStart ?? null,
            averageCycleLength: state.avgCycleLength ?? null,
            cycleLengths: state.cycleLengths ?? [],
            phaseEstimation: state.phaseEstimation,
            phaseProfile: {
              lastPeriodStart: lastStart ?? null,
              phaseEstimation: state.phaseEstimation,
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        ).catch(err => console.warn('[cyclesML/feedback] phaseProfile save failed:', err.message));
      }
    }

    return res.json({ ok: true, reestimated: true, state });
  } catch (err) {
    console.error('[cyclesML/feedback] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Route: POST /api/cycles/phase ───────────────────────────

router.post('/phase', requireAuth, (req, res) => {
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
