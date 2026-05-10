/**
 * dashboard.js - Goal-based dashboard
 * One screen, content adapts to selected goal + cycle phase.
 *
 * PRESENTATION + INTEGRATION LAYER ONLY.
 * This file gathers user data, passes it to the approved engine files,
 * and renders the results. It must NOT contain reproductive-health
 * calculation logic (phase, next period, fertile window, ovulation, etc.).
 *
 * Approved engines used:
 *   - cyclesML.js + cyclePhaseEngine.js  â†’ via fetchCycleState()
 *   - bloom-cycle-engine.js              â†’ advanced insights
 *   - bloom-anomaly-engine.js            â†’ advanced insights
 *   - bloom-symptom-engine.js            â†’ advanced insights
 *   - pregnancyAlgorithm.js              â†’ pregnancy/TTC goal only
 */

import {
  renderNav,
  renderFooter,
  renderModeBanner,
  renderBloomieFab,
  formatDate,
  toDateKey,
  showToast,
} from "./utils.js";
import { getAllLogs } from "./db.js";
import { onAuthChange, getIdToken } from "./auth.js";
import { isAnonMode } from "./mode.js";
import { getUserGoal, goalLabel, goalDesc, isGoalAgeLocked } from "./goals.js";
import { triggerNotifications } from "./notifications.js";
import { getTodaysPhaseInsights } from "./phase-education.js";
import { fetchCycleState } from "./cycle-state.js";
import { mountSyncStatusBanner } from "./sync-status.js";
import {
  collectCustomSymptomRecurrence,
  customSymptomLooksUrgent,
  summarizeCustomSymptoms,
} from "./custom-symptoms.js";
// Algorithm modules loaded lazily inside loadDashboard() = no top-level await
let algoPregnancy    = null;
let algoCycleEngine  = null;
let algoSymptomEngine = null;
let algoAnomalyEngine = null;
// Reused by dashboard render + notification bootstrap to avoid duplicate fetches.
let _logsPromise = null;
let _logsPromiseMode = null;
let _cycleStatePromise = null;
let _dashboardLoadEpoch = 0;
let _plotlyLoadPromise = null;

renderNav("dashboard");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));
mountSyncStatusBanner(document.getElementById("banner-area"), {
  message: "Cloud sync is having trouble. Your dashboard is showing saved local data until it reconnects.",
});

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function diffDays(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function symptomLabelToCode(label) {
  return String(label || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildEngineSymptomHistory(logsByDate) {
  return Object.entries(logsByDate || {})
    .filter(([, log]) => Array.isArray(log?.symptoms) && log.symptoms.length > 0)
    .map(([dateKey, log]) => ({
      dateKey,
      items: (log.symptoms || [])
        .map((label) => {
          const hintedCode = String(
            log?.symptomCodes?.[label] ||
            log?.symptomCodes?.[symptomLabelToCode(label)] ||
            ""
          ).trim().toUpperCase();
          const code = hintedCode || symptomLabelToCode(label);
          if (!code) return null;
          const severity = Number(
            log?.symptomSeverity?.[label] ??
            log?.symptomSeverity?.[hintedCode] ??
            log?.symptomSeverity?.[code] ??
            3
          );
          return { code, severity: Number.isFinite(severity) ? severity : 3 };
        })
        .filter(Boolean),
    }))
    .filter((entry) => entry.items.length > 0)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function isLoggedPeriodDay(entry) {
  if (!entry) return false;
  if (entry.flow && entry.flow !== "none") return true;
  if (typeof entry.flowLevel === "number" && entry.flowLevel > 0) return true;
  if (Number.isFinite(Number(entry.periodDay)) && Number(entry.periodDay) > 0) return true;
  if (entry.periodDay === true) return true;
  return false;
}

function expandLoggedPeriodDays(logsByDate = {}) {
  const days = new Set();

  for (const [dateKey, entry] of Object.entries(logsByDate || {})) {
    if (!isLoggedPeriodDay(entry)) continue;

    const explicitPeriodDay = Number(entry.periodDay);
    if (Number.isInteger(explicitPeriodDay) && explicitPeriodDay > 1 && explicitPeriodDay <= 10) {
      const start = addDaysStr(dateKey, -(explicitPeriodDay - 1));
      for (let i = 0; i < explicitPeriodDay; i++) {
        days.add(addDaysStr(start, i));
      }
      continue;
    }

    days.add(dateKey);
  }

  return [...days].sort();
}

function buildCustomSymptomInsight(logsByDate, days = 30) {
  const recurrence = collectCustomSymptomRecurrence(logsByDate, days);
  if (!recurrence.length) return null;

  const top = recurrence[0];
  const recurringMessage = top.count >= 2
    ? `You've logged "${top.displayText}" ${top.count} times in the last ${days} days.`
    : `You've logged "${top.displayText}" in your recent history.`;

  const urgent = Object.values(logsByDate || {}).some((log) =>
    (log?.otherSymptoms || []).some((item) => customSymptomLooksUrgent(item?.text))
  );

  return {
    recurringMessage,
    extraCount: recurrence.length > 1 ? recurrence.length - 1 : 0,
    urgent,
  };
}

function renderCustomSymptomAdvancedInsights(logsByDate, today = new Date()) {
  const insights = summarizeCustomSymptoms(logsByDate, { days: 30, maxItems: 2, fromDate: today });
  if (!insights.length) return "";

  return `
    <div style="margin-top:0.9rem;padding-top:0.8rem;border-top:1px solid var(--color-border);">
      <div style="font-size:0.74rem;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--color-text-muted);margin-bottom:0.55rem;">
        Custom Symptoms From Your History
      </div>
      ${insights.map((item) => `
        <div class="insight-item" style="background:rgba(212,116,154,0.05);border:1px solid rgba(212,116,154,0.14);border-radius:12px;padding:0.7rem 0.85rem;margin-bottom:0.55rem;">
          <strong>${item.kind === "recurring" ? "Custom symptom pattern" : "Custom symptom saved"}:</strong> ${item.message}${item.guidance ? ` ${item.guidance}` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

// Pulled from bloomie-recovery advanced-insights path:
// derive period-level metadata for bloom-cycle-engine.generateAdvancedInsights().
function buildPeriodInsightInputs(logsByDate) {
  const FLOW_SCORES = {
    spotting: 1,
    very_light: 1,
    light: 2,
    medium: 3,
    heavy: 4,
    very_heavy: 5,
  };

  const bleedingDays = Object.entries(logsByDate || {})
    .filter(([, log]) => {
      const flowKey = String(log?.flow || "").toLowerCase();
      return (FLOW_SCORES[flowKey] || 0) > 0;
    })
    .sort(([a], [b]) => a.localeCompare(b));

  const clusters = [];
  let current = null;
  for (const [dateKey, log] of bleedingDays) {
    if (!current || diffDays(current.end, dateKey) > 3) {
      current = { start: dateKey, end: dateKey, days: [{ dateKey, log }] };
      clusters.push(current);
      continue;
    }
    current.end = dateKey;
    current.days.push({ dateKey, log });
  }

  const periodEntries = [];
  const unscheduledBleedingDates = [];

  for (const cluster of clusters) {
    const durationDays = diffDays(cluster.start, cluster.end) + 1;
    const flowScores = cluster.days.map(({ log }) => {
      const flowKey = String(log?.flow || "").toLowerCase();
      return FLOW_SCORES[flowKey] ?? 0;
    });
    const maxFlowScore = flowScores.length ? Math.max(...flowScores) : 0;
    const maxFlowLevel = cluster.days
      .map(({ log }) => log?.flow)
      .find((flow) => {
        const flowKey = String(flow || "").toLowerCase();
        return (FLOW_SCORES[flowKey] ?? 0) === maxFlowScore;
      }) ?? null;
    const nonSpottingDays = cluster.days.filter(({ log }) => {
      const flowKey = String(log?.flow || "").toLowerCase();
      return (FLOW_SCORES[flowKey] ?? 0) >= 2;
    }).length;
    const hadLargeClots = cluster.days.some(({ log }) => {
      const labels = Array.isArray(log?.symptoms) ? log.symptoms : [];
      const normalizedLabels = labels.map((s) => String(s).trim().toLowerCase());
      if (normalizedLabels.includes("large clots")) return true;
      if (labels.map((s) => String(s).trim().toUpperCase()).includes("LARGE_CLOTS")) return true;
      const mappedCodes = Object.values(log?.symptomCodes || {}).map((c) => String(c).trim().toUpperCase());
      return mappedCodes.includes("LARGE_CLOTS");
    });

    if (durationDays >= 2 || nonSpottingDays >= 1) {
      periodEntries.push({
        durationDays,
        flowLevel: maxFlowLevel,
        flowScore: maxFlowScore,
        hadLargeClots,
      });
    } else {
      unscheduledBleedingDates.push(cluster.start);
    }
  }

  return { periodEntries, unscheduledBleedingDates };
}

/**
 * Data preparation only - identifies period cluster starts from logs.
 * Used to derive cycleLengths and lastPeriodStart for passing to the approved engines.
 *
 * All reproductive-health calculations (phase, next period, fertile window,
 * ovulation, confidence) come ONLY from the approved engine files via fetchCycleState.
 * Do NOT add calculation logic here.
 */
function buildCycleBase(logsByDate) {
  const periodDays = expandLoggedPeriodDays(logsByDate);

  const cycleStarts = [];
  let prevDate = null;
  for (const day of periodDays) {
    if (!prevDate || diffDays(prevDate, day) > 3) cycleStarts.push(day);
    prevDate = day;
  }

  return {
    cycleStarts,
    phase: "unknown",
    confidence: "low",
    nextPeriodDate: null,
    fertileStart: null,
    fertileEnd: null,
    ovulationDate: null,
  };
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "block" : "none";
}

function applyGoalClasses(goal) {
  const isNoPeriodGoal = goal === "no_period";
  const isTrackSymptomsGoal = goal === "track_symptoms";
  document.body.classList.toggle("goal-ttc", goal === "ttc");
  document.body.classList.toggle("goal-pregnancy", goal === "pregnancy");
  document.body.classList.toggle("goal-no-period", isNoPeriodGoal);
  document.body.classList.toggle("goal-track-symptoms", isTrackSymptomsGoal);
  document.body.classList.toggle("goal-perimenopause", goal === "perimenopause");
}

function ensureLogsPromise() {
  const mode = isAnonMode() ? "anon" : "account";
  if (!_logsPromise || _logsPromiseMode !== mode) {
    _logsPromiseMode = mode;
    // Cloud Run/Firestore can be slow immediately after login or cold start.
    // A short timeout makes the dashboard look empty even when data exists.
    _logsPromise = getAllLogs({ timeoutMs: 10000 });
  }
  return _logsPromise;
}

function resetDashboardDataPromises() {
  _logsPromise = null;
  _logsPromiseMode = null;
  _cycleStatePromise = null;
}

function afterFirstPaint(fn) {
  requestAnimationFrame(() => setTimeout(fn, 0));
}

function ensurePlotlyLoaded() {
  if (typeof window !== "undefined" && window.Plotly) return Promise.resolve(window.Plotly);
  if (_plotlyLoadPromise) return _plotlyLoadPromise;

  _plotlyLoadPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-bloom-plotly="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Plotly || null), { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
      return;
    }

    const s = document.createElement("script");
    s.src = "https://cdn.plot.ly/plotly-2.32.0.min.js";
    s.async = true;
    s.dataset.bloomPlotly = "1";
    s.onload = () => resolve(window.Plotly || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });

  return _plotlyLoadPromise;
}

// â”€â”€â”€ Phase-based insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Phase insights are now provided by phase-education.js (getTodaysPhaseInsight)

function getGoalTip(goal, phase) {
  const map = {
    ttc: {
      ovulation:   { t: "Ovulation occurring - peak conception timing", d: "You are at or near your estimated ovulation day. Conception likelihood is highest today and the 2 days prior." },
      ovulatory:   { t: "Ovulation occurring - peak conception timing", d: "You are at or near your estimated ovulation day. Conception likelihood is highest today and the 2 days prior." },
      follicular:  { t: "Fertile window approaching", d: "Ovulation is estimated in the coming days. Track cervical mucus and basal body temperature changes." },
      luteal:      { t: "Two-week wait", d: "If conception occurred, the earliest pregnancy tests may detect hCG around 10-14 days post-ovulation. Rest and track any early symptoms." },
      late_luteal: { t: "Testing window opening", d: "You are in the late luteal phase. If your period is late, a pregnancy test taken now may be accurate." },
      menstrual:   { t: "New cycle beginning", d: "Your fertile window is expected again in approximately 1-2 weeks as you approach ovulation." },
    },
    pregnancy: {
      default: { t: "Pregnancy mode active", d: "Update LMP date in profile for accurate due date tracking." },
    },
    perimenopause: {
      default: { t: "Perimenopause tracking", d: "Cycle irregularity is common. Log what you experience - your pattern matters more than a standard model." },
    },
  };
  const g = map[goal];
  if (!g) return null;
  return g[phase] ?? g.default ?? null;
}

const PHASE_FEEDBACK_STORAGE_KEY = "bloom_phase_feedback_v2";
const PHASE_FEEDBACK_STORAGE_KEY_LEGACY = "bloom_phase_feedback_by_date_v1";
const API_BASE = (typeof window !== "undefined" && typeof window.BLOOM_API_BASE === "string")
  ? window.BLOOM_API_BASE.trim().replace(/\/+$/, "")
  : "";
const PHASE_FEEDBACK_ENDPOINT = `${API_BASE}/api/phase-feedback`;
const PHASE_CSS_MAP = {
  menstrual: "menstrual",
  follicular: "follicular",
  ovulation: "ovulation",
  ovulatory: "ovulation",
  luteal: "luteal",
  late_luteal: "luteal",
  unknown: "unknown",
};
const PHASE_LABELS = {
  menstrual: "Menstrual",
  follicular: "Follicular",
  ovulation: "Ovulatory",
  ovulatory: "Ovulatory",
  luteal: "Luteal",
  late_luteal: "Late Luteal",
  unknown: "Calculating",
};
const PHASE_FEEDBACK_CORRECTIONS = {
  bleeding: { phase: "menstrual", label: "Menstrual" },
  ovulation_signs: { phase: "ovulation", label: "Ovulatory" },
  pms_pre_period: { phase: "luteal", label: "Luteal" },
  not_sure: { phase: null, label: null },
};

function normalizeConfidenceLevel(level) {
  const normalized = String(level || "low").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "low";
}

function readPhaseFeedbackStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE_FEEDBACK_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePhaseFeedbackStore(store) {
  try {
    localStorage.setItem(PHASE_FEEDBACK_STORAGE_KEY, JSON.stringify(store || {}));
  } catch (_) {}
}

function normalizePhaseKeyForFeedback(phaseKey) {
  const normalized = String(phaseKey || "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "ovulation" || normalized === "ovulatory") return "ovulatory";
  return normalized;
}

function getCurrentCycleStartKey(cycle) {
  const starts = Array.isArray(cycle?.cycleStarts) ? cycle.cycleStarts : [];
  return starts.length ? String(starts[starts.length - 1]) : "unknown";
}

function buildPhaseFeedbackSignature(cycle, phaseKey) {
  const cycleStart = getCurrentCycleStartKey(cycle);
  const normalizedPhase = normalizePhaseKeyForFeedback(phaseKey);
  return `${cycleStart}|${normalizedPhase}`;
}

function readLegacyPhaseFeedbackForToday() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PHASE_FEEDBACK_STORAGE_KEY_LEGACY) || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    const todayKey = toDateKey(new Date());
    const entry = parsed[todayKey];
    return entry && typeof entry === "object" ? entry : null;
  } catch {
    return null;
  }
}

function getStoredPhaseFeedbackForSignature(signature, expectedPhaseKey = null) {
  const store = readPhaseFeedbackStore();
  if (store?.phaseSignature === signature) return store;

  // One-time compatibility fallback from older per-day storage.
  const legacy = readLegacyPhaseFeedbackForToday();
  if (!legacy) return null;
  if (expectedPhaseKey && normalizePhaseKeyForFeedback(legacy.phaseKey) !== normalizePhaseKeyForFeedback(expectedPhaseKey)) {
    return null;
  }

  const migrated = {
    ...legacy,
    phaseSignature: signature,
    updatedAt: new Date().toISOString(),
  };
  writePhaseFeedbackStore(migrated);
  return migrated;
}

function setStoredPhaseFeedbackForSignature(signature, feedback) {
  if (!feedback || typeof feedback !== "object") {
    writePhaseFeedbackStore({});
    return;
  }

  writePhaseFeedbackStore({
    ...feedback,
    phaseSignature: signature,
    updatedAt: new Date().toISOString(),
  });
}

function normalizePhaseKeyForBackend(phaseKey) {
  const normalized = normalizePhaseKeyForFeedback(phaseKey);
  if (normalized === "ovulatory") return "ovulation";
  if (normalized === "late_luteal") return "luteal";
  if (normalized === "menstrual" || normalized === "follicular" || normalized === "ovulation" || normalized === "luteal") {
    return normalized;
  }
  return null;
}

function hasSubmittedFeedbackForPhase(feedback, phaseKey, phaseSignature = null) {
  if (!feedback || typeof feedback !== "object") return false;
  const response = String(feedback.response || "").trim().toLowerCase();
  if (!["yes", "no", "not_sure"].includes(response)) return false;
  if (phaseSignature && String(feedback.phaseSignature || "").trim() !== String(phaseSignature)) return false;
  return normalizePhaseKeyForFeedback(feedback.phaseKey) === normalizePhaseKeyForFeedback(phaseKey);
}

async function persistPhaseFeedbackToBackend({ response, phaseKey, cycle }) {
  const normalizedResponse = String(response || "").trim().toLowerCase();
  if (!["yes", "no", "not_sure"].includes(normalizedResponse)) return;

  const token = await getIdToken({ waitForAuthMs: 1200 });
  if (!token) return;

  const predictedPhase = normalizePhaseKeyForBackend(phaseKey);
  const payload = {
    response: normalizedResponse,
    predictedPhase,
    cycleDay: Number.isFinite(Number(cycle?.dayInCycle)) ? Number(cycle.dayInCycle) : null,
    confidence: normalizeConfidenceLevel(cycle?.confidence),
  };

  const res = await fetch(PHASE_FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}


function getDisplayPhaseFromCycle(cycle, feedback = null) {
  const rawPhase = cycle?.phase && cycle.phase !== "unknown" ? cycle.phase : "unknown";
  const inferredKey = cycle?.phaseLabel === "Late Luteal" ? "late_luteal" : rawPhase;
  const displayKey = inferredKey;
  const displayLabel = PHASE_LABELS[displayKey] ?? cycle?.phaseLabel ?? "Calculating";
  const cssKey = PHASE_CSS_MAP[displayKey] ?? "unknown";

  return {
    key: displayKey,
    label: displayLabel,
    cssKey,
    rawPhase,
  };
}

function setTodayInsights(phaseKey, goal, phaseLabel, loggedSymptoms = []) {
  const box = document.getElementById("insights");
  if (!box) return;

  // Resolve sub-phase: Late Luteal has its own education variants
  let resolvedKey = phaseKey;
  if (phaseLabel === "Late Luteal" || phaseKey === "late_luteal") {
    resolvedKey = "late_luteal";
  }

  // Pick 3 symptom-relevant education variants for today
  const insights = getTodaysPhaseInsights({ phase: resolvedKey, loggedSymptoms, count: 3 });
  const items = insights.map(i => ({ t: i.title, d: i.body }));

  // Prepend goal-specific tip when available
  const tip = getGoalTip(goal, resolvedKey) || getGoalTip(goal, phaseKey);
  if (tip) items.unshift(tip);

  box.innerHTML = items.map((i, idx) => `
    <div style="display:flex;gap:0.65rem;align-items:flex-start;padding:0.65rem 0;${idx > 0 ? "border-top:1px solid var(--color-border);" : ""}">
      <div>
        <strong style="color:var(--color-primary-dark);font-size:0.9rem;display:block;margin-bottom:0.2rem;">${i.t}</strong>
        <span style="font-size:0.875rem;color:var(--color-text-muted);line-height:1.55;">${i.d}</span>
      </div>
    </div>`).join("");
}

// â”€â”€â”€ Phase card with colour badge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderPhaseCard(cycle, onFeedbackChange = null) {
  const el = document.getElementById("cycle-phase");
  if (!el) return;

  const phaseSignature = buildPhaseFeedbackSignature(cycle, cycle?.phaseLabel === "Late Luteal" ? "late_luteal" : cycle?.phase);
  const feedback = getStoredPhaseFeedbackForSignature(phaseSignature, cycle?.phase);
  const phase = getDisplayPhaseFromCycle(cycle, feedback);
  const confidenceLevel = normalizeConfidenceLevel(cycle?.confidence);
  const confidenceLabel = `${confidenceLevel.charAt(0).toUpperCase()}${confidenceLevel.slice(1)} confidence`;
  const feedbackSubmittedForCurrentPhase = hasSubmittedFeedbackForPhase(feedback, phase.key, phaseSignature);

  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.justifyContent = "space-between";

  if (phase.rawPhase !== "unknown") {
    el.innerHTML = `
      <div class="phase-estimate-wrap">
        <span class="phase-badge phase-${phase.cssKey}">
          <span class="phase-dot"></span>${phase.label} Phase
        </span>
        <div class="phase-meta-row">
          <span class="phase-confidence-dot phase-confidence-dot--${confidenceLevel}"></span>
          <span class="phase-confidence-text">${confidenceLabel}</span>
          ${feedbackSubmittedForCurrentPhase ? "" : `
            <span class="phase-feedback-divider">|</span>
            <span class="phase-feedback-label">Accurate?</span>
            <button type="button" class="phase-thumb-btn" data-phase-feedback="yes" title="Yes">👍</button>
            <button type="button" class="phase-thumb-btn" data-phase-feedback="no" title="No">👎</button>
          `}
        </div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:flex-start;justify-content:center;flex:1;padding:0.75rem 0;gap:0.45rem;">
        <span class="phase-badge phase-unknown">Calculating Phase</span>
        <p class="phase-reason" style="margin:0;">Keep logging to get a phase estimate.</p>
      </div>
    `;
    return;
  }

  el.querySelectorAll("[data-phase-feedback]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const response = btn.dataset.phaseFeedback;
      if (!response) return;

      const existing = getStoredPhaseFeedbackForSignature(phaseSignature, phase.key) || {};
      const phaseKey = normalizePhaseKeyForFeedback(phase.key);
      const next = {
        ...existing,
        response: String(response).toLowerCase(),
        phaseKey,
        phaseLabel: phase.label,
        phaseSignature,
      };

      setStoredPhaseFeedbackForSignature(phaseSignature, next);
      if (typeof onFeedbackChange === "function") onFeedbackChange(next);

      // Hide feedback controls immediately for this phase.
      renderPhaseCard(cycle, onFeedbackChange);

      persistPhaseFeedbackToBackend({ response: next.response, phaseKey, cycle })
        .catch((err) => {
          console.warn("[phase-feedback] backend save failed:", err?.message || err);
        });
    });
  });
}
function renderGoalToolCard(goal, cycle) {
  const el = document.getElementById("goal-tool");
  if (!el) return;
  const todayKey = toDateKey(new Date());

  if (goal === "perimenopause") {
    el.innerHTML = `
      <div class="stat-number">Perimenopause Mode</div>
      <p class="text-muted">Track cycle shifts and symptoms over time.</p>
      <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;display:inline-block;">Log today</a>
    `;
    return;
  }

  if (goal === "no_period" || goal === "track_symptoms") {
    el.innerHTML = `
      <div class="stat-number">Symptom Mode</div>
      <p class="text-muted">Log symptoms freely.</p>
      <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;display:inline-block;">Log today</a>
    `;
    return;
  }

  if (goal === "ttc") {
    // cycle already has resolved fertileStart/fertileEnd/ovulationDate from loadDashboard
    const fertileStart = cycle.fertileStart ?? null;
    const fertileEnd   = cycle.fertileEnd   ?? null;

    let windowBadge = "";
    let windowDates = "";
    if (fertileStart && fertileEnd) {
      windowDates = `<p class="ttc-window-dates">${formatDate(fertileStart)} to ${formatDate(fertileEnd)}</p>`;
      if (todayKey >= fertileStart && todayKey <= fertileEnd) {
        windowBadge = `<span class="ttc-window-badge ttc-window--active">Fertile window active</span>`;
      } else if (todayKey < fertileStart) {
        const dTo = diffDays(todayKey, fertileStart);
        windowBadge = `<span class="ttc-window-badge ttc-window--upcoming">Window in ${dTo} day${dTo !== 1 ? "s" : ""}</span>`;
      }
    }

    el.innerHTML = `
      ${windowDates}
      ${windowBadge}
    `;
    return;
  }

  if (goal === "pregnancy") {
    const lmp = localStorage.getItem("bloom_lmp");
    if (lmp && algoPregnancy) {
      try {
        const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
        const r = algoPregnancy.estimatedDueDate(new Date(lmp + "T00:00:00"), Number(profile.avgCycleLength) || 28);
        if (r.currentWeek) {
          el.innerHTML = `
            <div class="stat-number" style="font-size:1.3rem;">Week ${r.currentWeek}</div>
            <p class="text-muted" style="margin-top:0.25rem;">${r.trimesterLabel} | EDD ${formatDate(toDateKey(r.eddAdjusted))}</p>
          `;
          return;
        }
      } catch (_) {}
    }
    el.innerHTML = `
      <div class="stat-number">Track Pregnancy</div>
      <p class="text-muted">Add LMP date in profile to calculate due date.</p>
      <a class="btn btn-outline" href="/pages/profile-view.html" style="margin-top:0.5rem;display:inline-block;">Update profile</a>
    `;
    return;
  }

  // Default: next period
  if (cycle.periodPrediction?.status === "overdue") {
    const lateDays = Number(cycle.periodPrediction.daysLate) || 0;
    const start = cycle.periodPrediction.predictedStart;
    const end = cycle.periodPrediction.predictedEnd;
    el.innerHTML = `
      <div class="stat-number">Late by ${lateDays} day${lateDays === 1 ? "" : "s"}</div>
      <p class="text-muted" style="margin-top:0.25rem;">Expected around ${start ? formatDate(start) : "your predicted date"}${end && end !== start ? ` - ${formatDate(end)}` : ""}</p>
    `;
    return;
  }

  if (cycle.nextPeriodDate) {
    const d = diffDays(todayKey, cycle.nextPeriodDate);
    el.innerHTML = `
      <div class="stat-number">${formatDate(cycle.nextPeriodDate)}</div>
      <p class="text-muted" style="margin-top:0.25rem;">Next expected period${d >= 0 ? ` - in ${d} day${d !== 1 ? "s" : ""}` : " - may have started"}</p>
    `;
  } else {
    el.innerHTML = `
      <div class="stat-number">Next Period</div>
      <p class="text-muted">Log more period days to generate a prediction.</p>
    `;
  }
}

// â”€â”€â”€ Try to Conceive fertility guidance card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderTtcTools(goal, cycle, logsByDate) {
  // The whole zone is shown/hidden as one block - individual cards inside don't need show()
  const zone = document.getElementById("ttc-zone");
  const body = document.getElementById("ttc-tools-body");
  if (!zone) return;

  show(zone, goal === "ttc");
  if (goal !== "ttc") return;
  if (!body) return;

  const todayKey = toDateKey(new Date());
  const isPostOv = cycle.ovulationDate && todayKey > cycle.ovulationDate;

  // â”€â”€ LEFT CARD: "Fertility Insights" â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const fertileStart = cycle.fertileStart ?? null;
  const fertileEnd   = cycle.fertileEnd   ?? null;
  const ovDate       = cycle.ovulationDate ?? null;
  const phaseKey     = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : null;

  // Date/window summary block
  let dateSummary = "";
  if (ovDate || fertileStart) {
    let windowLine = "";
    if (fertileStart && fertileEnd) {
      if (todayKey >= fertileStart && todayKey <= fertileEnd) {
        windowLine = `Your fertile window is <strong>active today</strong> (${formatDate(fertileStart)} to ${formatDate(fertileEnd)}).`;
      } else if (todayKey < fertileStart) {
        const dTo = diffDays(todayKey, fertileStart);
        windowLine = `Your fertile window opens in <strong>${dTo} day${dTo !== 1 ? "s" : ""}</strong>. Track cervical mucus and BBT for additional confirmation.`;
      } else {
        windowLine = `Your fertile window closed ${diffDays(fertileEnd, todayKey)} day${diffDays(fertileEnd, todayKey) !== 1 ? "s" : ""} ago.`;
      }
    }
    dateSummary = `
      <div class="ttc-insight-item">
        ${ovDate ? `<p class="ttc-insight-body" style="margin:0 0 0.3rem;">Estimated ovulation: <strong>${formatDate(ovDate)}</strong></p>` : ""}
        ${windowLine ? `<p class="ttc-insight-body" style="margin:0;">${windowLine}</p>` : ""}
      </div>`;
  }

  // Phase tip + phase insights
  const tip = phaseKey ? getGoalTip("ttc", phaseKey) : null;
  const phaseInsights = phaseKey
    ? getTodaysPhaseInsights({ phase: phaseKey, loggedSymptoms: [], count: 1 })
    : [];
  const insightItems = [];
  if (tip) insightItems.push({ t: tip.t, d: tip.d });
  if (phaseInsights[0]) insightItems.push({ t: phaseInsights[0].title, d: phaseInsights[0].body });

  const insightHtml = insightItems.map((item) => `
    <div class="ttc-insight-item ttc-insight-item--sep">
      <strong class="ttc-insight-heading">${item.t}</strong>
      <span class="ttc-insight-body">${item.d}</span>
    </div>`).join("");

  if (!dateSummary && !insightHtml) {
    body.innerHTML = `<p class="text-muted">Log period days over 1-2 cycles to see your fertility insights.</p>`;
  } else {
    body.innerHTML = dateSummary + insightHtml;
  }

  // â”€â”€ CURRENT CYCLE SNIPPET (row 2, right card) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const currentCycleBody = document.getElementById("ttc-current-cycle-body");
  if (currentCycleBody) {
    const cycleStarts = cycle.cycleStarts || [];
    const localLengths = [];
    for (let i = 1; i < cycleStarts.length; i++) {
      localLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
    }
    if (cycleStarts.length) {
      const cards = buildCycleCards(cycleStarts, localLengths, logsByDate || {});
      currentCycleBody.innerHTML = (cards[0] || "") + `
        <a href="/pages/cycle-history.html" class="btn btn-outline ttc-history-btn">
          View entire cycle history ->
        </a>`;
    } else {
      currentCycleBody.innerHTML = `<p class="text-muted">Log a period day to see your cycle history.</p>`;
    }
  }

  // â”€â”€ WHEN TO TEST CARD (row 1, right card) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const testBody = document.getElementById("ttc-test-body");
  if (testBody) {
    const ovDateStr = cycle.ovulationDate ?? null;
    const ovLine = ovDateStr
      ? `<p class="ttc-insight-body" style="margin-top:0.5rem;">Ovulation estimated: ${formatDate(ovDateStr)}</p>`
      : "";

    if (cycle.periodPrediction?.status === "overdue") {
      const lateDays = Number(cycle.periodPrediction.daysLate) || 0;
      const start = cycle.periodPrediction.predictedStart;
      const end = cycle.periodPrediction.predictedEnd;
      testBody.innerHTML = `
        <p class="ttc-test-headline">Period is late by ${lateDays} day${lateDays === 1 ? "" : "s"}</p>
        <p class="ttc-insight-body">Expected around <strong>${start ? formatDate(start) : "your predicted date"}${end && end !== start ? ` - ${formatDate(end)}` : ""}</strong></p>
        ${ovLine}`;
    } else if (isPostOv && algoPregnancy && ovDateStr && cycle.nextPeriodDate) {
      // Post-ovulation: show TWW + full test guidance
      try {
        const r = algoPregnancy.whenToTest(
          new Date(ovDateStr + "T00:00:00"),
          new Date(cycle.nextPeriodDate + "T00:00:00")
        );
        const dpo = diffDays(ovDateStr, todayKey);
        const pct = Math.min(Math.round((dpo / 14) * 100), 100);
        const twwLine = dpo >= 1 && dpo <= 20
          ? `<p class="ttc-test-tww">Two-week wait | Day ${dpo}</p>
             <div class="tww-bar" style="margin-bottom:0.6rem;"><div class="tww-bar__fill" style="width:${pct}%;"></div></div>`
          : "";
        const earlyLine = r.earlyTestDate
          ? `<p class="ttc-insight-body">Early test possible from: <strong>${formatDate(toDateKey(r.earlyTestDate))}</strong></p>`
          : "";
        testBody.innerHTML = `
          ${twwLine}
          <p class="ttc-test-headline">${r.message}</p>
          ${earlyLine}
          <p class="ttc-insight-body">${r.retestMessage}</p>
          ${ovLine}`;
      } catch (_) {
        testBody.innerHTML = `<p class="ttc-test-headline">Test after a missed period</p>
          <p class="ttc-insight-body">Next expected period: <strong>${formatDate(cycle.nextPeriodDate)}</strong></p>
          ${ovLine}`;
      }
    } else if (cycle.nextPeriodDate) {
      // Pre-ovulation: show expected period + ovulation
      const d = diffDays(todayKey, cycle.nextPeriodDate);
      testBody.innerHTML = `
        <p class="ttc-test-headline">Test after a missed period</p>
        <p class="ttc-insight-body">Next expected period: <strong>${formatDate(cycle.nextPeriodDate)}</strong>${d >= 0 ? ` - in ${d} day${d !== 1 ? "s" : ""}` : ""}</p>
        ${ovLine}`;
    } else {
      testBody.innerHTML = `<p class="text-muted">Log period days to estimate when to test.</p>`;
    }
  }
}

// â”€â”€â”€ Rotating fertility facts slideshow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const _FERTILITY_FACTS = [
  { text: "Your fertile window is roughly the five days before ovulation plus ovulation day itself." },
  { text: "Tracking consistently for 2-3 cycles helps Bloom build a more accurate fertility picture." },
  { text: "Cervical mucus shifts from dry to clear and stretchy as ovulation approaches - a helpful natural sign." },
  { text: "Basal body temperature rises slightly after ovulation and can help confirm when it occurred." },
  { text: "Stress, illness, and travel can shift ovulation timing - cycle patterns may vary month to month." },
  { text: "Most pregnancy tests are most reliable from the day after a missed period." },
  { text: "Iron-rich foods like callaloo, red peas, and lentils can support overall reproductive health." },
  { text: "Managing stress has been associated with improved fertility outcomes in research." },
  { text: "Rest and community support around pregnancy are valued traditions in many Caribbean households." },
  { text: "Folate intake before conception is clinically recommended to support early fetal development." },
];

let _factsTimer = null;

// Compact slideshow for the right-column facts ticker - no show() needed, zone controls visibility
function renderFactsSlideshow(goal) {
  if (goal !== "ttc") return;
  const body = document.querySelector(".facts-slideshow-body");
  if (!body) return;

  let current = 0;
  const total = _FERTILITY_FACTS.length;

  function renderSlide(idx) {
    const fact = _FERTILITY_FACTS[idx];
    const dots = _FERTILITY_FACTS.map((_, i) =>
      `<button class="facts-dot${i === idx ? " facts-dot--active" : ""}" data-idx="${i}" aria-label="Fact ${i + 1}"></button>`
    ).join("");

    body.innerHTML = `
      <div class="fact-bubble">
        <svg class="fact-quote-icon" width="20" height="16" viewBox="0 0 30 24" fill="currentColor">
          <path d="M0 24V13.714C0 7.514 3.857 2.743 11.571 0l1.715 2.743C9.343 4.114 7.286 6.343 6.857 9.429H12V24H0zm18 0V13.714C18 7.514 21.857 2.743 29.571 0l1.715 2.743C27.343 4.114 25.286 6.343 24.857 9.429H30V24H18z"/>
        </svg>
        <p class="fact-text">${fact.text}</p>
      </div>
      <div class="facts-compact-footer">
        <div class="facts-compact-dots">${dots}</div>
        <div class="facts-compact-nav">
          <button class="facts-arrow-sm" id="facts-prev" aria-label="Previous">&#8592;</button>
          <button class="facts-arrow-sm" id="facts-next" aria-label="Next">&#8594;</button>
        </div>
      </div>
    `;

    body.querySelector("#facts-prev")?.addEventListener("click", () => {
      current = (current - 1 + total) % total;
      resetTimer(); renderSlide(current);
    });
    body.querySelector("#facts-next")?.addEventListener("click", () => {
      current = (current + 1) % total;
      resetTimer(); renderSlide(current);
    });
    body.querySelectorAll(".facts-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        current = Number(dot.dataset.idx);
        resetTimer(); renderSlide(current);
      });
    });
  }

  function resetTimer() {
    if (_factsTimer) clearInterval(_factsTimer);
    _factsTimer = setInterval(() => { current = (current + 1) % total; renderSlide(current); }, 8000);
  }

  renderSlide(0);
  resetTimer();
}

// â”€â”€â”€ Pregnancy section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Twemoji SVG images via jsDelivr CDN - renders consistently on all platforms
const _TW = (cp) => `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp}.svg`;
const _SVG = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`;
const PAPAYA_SVG = _SVG(`
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96' role='img' aria-label='Papaya'>
    <defs>
      <linearGradient id='papayaOuter' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='#f9bd66'/>
        <stop offset='100%' stop-color='#e78a2f'/>
      </linearGradient>
      <linearGradient id='papayaInner' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0%' stop-color='#ffd8a5'/>
        <stop offset='100%' stop-color='#ffc98b'/>
      </linearGradient>
    </defs>
    <ellipse cx='48' cy='52' rx='26' ry='36' transform='rotate(-16 48 52)' fill='url(#papayaOuter)' stroke='#cd7326' stroke-width='2.5'/>
    <ellipse cx='48' cy='52' rx='18' ry='27' transform='rotate(-16 48 52)' fill='url(#papayaInner)'/>
    <ellipse cx='48' cy='52' rx='9' ry='17' transform='rotate(-16 48 52)' fill='#6a311b'/>
    <g fill='#1f1714'>
      <circle cx='46' cy='37' r='1.7'/><circle cx='42.5' cy='40.5' r='1.6'/><circle cx='49.5' cy='39.8' r='1.5'/>
      <circle cx='43.2' cy='45' r='1.5'/><circle cx='50.4' cy='44.6' r='1.6'/><circle cx='46' cy='47.2' r='1.4'/>
      <circle cx='41.8' cy='50.6' r='1.4'/><circle cx='50.8' cy='50.8' r='1.5'/><circle cx='45.2' cy='53.4' r='1.4'/>
      <circle cx='42.4' cy='56.6' r='1.5'/><circle cx='49' cy='56.7' r='1.4'/><circle cx='45.8' cy='60.2' r='1.4'/>
      <circle cx='42.8' cy='63.3' r='1.3'/><circle cx='48.4' cy='63.6' r='1.3'/><circle cx='45.2' cy='66.3' r='1.2'/>
    </g>
    <path d='M31 19c4-4 9-6 14-6' stroke='#648f35' stroke-width='4' fill='none' stroke-linecap='round'/>
  </svg>
`);

const BABY_SIZES = [
  null, null, null, null,
  { label: "sweet pea",        img: _TW("1f331") }, // 4  ðŸŒ±
  { label: "sesame seed",      img: _TW("1f331") }, // 5  ðŸŒ±
  { label: "sweet pea",        img: _TW("1fad9") }, // 6  ðŸ«›
  { label: "blueberry",        img: _TW("1fad0") }, // 7  ðŸ«
  { label: "kidney bean",      img: _TW("1fad8") }, // 8  ðŸ«˜
  { label: "grape",            img: _TW("1f347") }, // 9  ðŸ‡
  { label: "small orange",     img: _TW("1f34a") }, // 10 ðŸŠ
  { label: "fig",              img: _TW("1f34b") }, // 11 ðŸ‹
  { label: "lime",             img: _TW("1f34b") }, // 12 ðŸ‹
  { label: "lemon",            img: _TW("1f34b") }, // 13 ðŸ‹
  { label: "peach",            img: _TW("1f351") }, // 14 ðŸ‘
  { label: "apple",            img: _TW("1f34e") }, // 15 ðŸŽ
  { label: "avocado",          img: _TW("1f951") }, // 16 ðŸ¥‘
  { label: "pear",             img: _TW("1f350") }, // 17 ðŸ
  { label: "bell pepper",      img: _TW("1fad1") }, // 18 ðŸ«‘
  { label: "mango",            img: _TW("1f96d") }, // 19 ðŸ¥­
  { label: "banana",           img: _TW("1f34c") }, // 20 ðŸŒ
  { label: "carrot",           img: _TW("1f955") }, // 21 ðŸ¥•
  { label: "papaya",           img: PAPAYA_SVG },   // 22 custom papaya
  { label: "large mango",      img: _TW("1f96d") }, // 23 ðŸ¥­
  { label: "corn",             img: _TW("1f33d") }, // 24 ðŸŒ½
  { label: "cauliflower",      img: _TW("1f966") }, // 25 ðŸ¥¦
  { label: "lettuce",          img: _TW("1f96c") }, // 26 ðŸ¥¬
  { label: "head of lettuce",  img: _TW("1f96c") }, // 27 ðŸ¥¬
  { label: "eggplant",         img: _TW("1f346") }, // 28 ðŸ†
  { label: "pumpkin",          img: _TW("1f383") }, // 29 ðŸŽƒ
  { label: "cabbage",          img: _TW("1f96c") }, // 30 ðŸ¥¬
  { label: "coconut",          img: _TW("1f965") }, // 31 ðŸ¥¥
  { label: "large pumpkin",    img: _TW("1f383") }, // 32 ðŸŽƒ
  { label: "pineapple",        img: _TW("1f34d") }, // 33 ðŸ
  { label: "cantaloupe",       img: _TW("1f348") }, // 34 ðŸˆ
  { label: "honeydew melon",   img: _TW("1f348") }, // 35 ðŸˆ
  { label: "large coconut",    img: _TW("1f965") }, // 36 ðŸ¥¥
  { label: "Swiss chard",      img: _TW("1f96c") }, // 37 ðŸ¥¬
  { label: "leek",             img: _TW("1f955") }, // 38 ðŸ¥•
  { label: "small watermelon", img: _TW("1f349") }, // 39 ðŸ‰
  { label: "watermelon",       img: _TW("1f349") }, // 40 ðŸ‰
];

// â”€â”€ Pregnancy week tips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Educational tips by trimester/week range. Not medical advice.
const PREGNANCY_WEEK_TIPS = [
  { weeks: [4,  8],  tips: [
    { t: "Folic acid matters now", d: "The neural tube forms in weeks 3-6. If you haven't already, start a prenatal vitamin with at least 400mcg of folate." },
    { t: "Nausea is common", d: "Morning sickness often peaks in weeks 6-9. Small, frequent meals and ginger tea can help manage it." },
    { t: "Fatigue is normal", d: "Your body is working hard to grow a placenta. Rest when you can - this usually eases in the second trimester." },
  ]},
  { weeks: [9,  13], tips: [
    { t: "First trimester closing", d: "Many people find nausea improves after week 10-12. Energy often returns as you enter the second trimester." },
    { t: "Hydration is key", d: "Blood volume increases significantly during pregnancy. Aim for 8-10 glasses of water daily." },
    { t: "Prenatal care", d: "Your first ultrasound is typically scheduled around weeks 10-12 to confirm dating and check development." },
  ]},
  { weeks: [14, 20], tips: [
    { t: "Second trimester energy", d: "This trimester is often the most comfortable. Many experience increased energy and reduced nausea." },
    { t: "Feeling movement", d: "First-time parents often feel fetal movement (quickening) between weeks 16-25. It may feel like flutters." },
    { t: "Anatomy scan", d: "The mid-pregnancy ultrasound (typically weeks 18-22) checks fetal anatomy and development." },
  ]},
  { weeks: [21, 27], tips: [
    { t: "Growing fast", d: "Your baby is gaining weight rapidly. Increasing your iron and calcium intake can support this growth." },
    { t: "Glucose screening", d: "Gestational diabetes screening is usually done between weeks 24-28. Discuss this with your provider." },
    { t: "Kick counting", d: "From around week 24, you can start tracking fetal movements. A pattern of regular movement is reassuring." },
  ]},
  { weeks: [28, 35], tips: [
    { t: "Third trimester begins", d: "Your baby's lungs, brain, and nervous system are maturing rapidly. Braxton Hicks contractions may begin." },
    { t: "Prepare for birth", d: "Now is a good time to attend birth preparation classes and discuss your birth preferences with your provider." },
    { t: "Rest positions matter", d: "Sleeping on your left side improves blood flow to the baby. Use pillows for support." },
  ]},
  { weeks: [36, 40], tips: [
    { t: "Nearly there", d: "Your baby is considered full term from week 39. They are likely head-down and preparing for birth." },
    { t: "Signs of labour", d: "Watch for regular contractions, water breaking, or bloody show. Contact your provider if these occur." },
    { t: "Nesting instinct", d: "Increased energy and urge to prepare the home is common late in pregnancy. Take care not to overdo it." },
  ]},
];

function getPregnancyWeekTips(week) {
  if (!week) return [];
  const match = PREGNANCY_WEEK_TIPS.find(({ weeks }) => week >= weeks[0] && week <= weeks[1]);
  return match ? match.tips : [{ t: "Stay in touch with your provider", d: "Regular antenatal visits are important throughout pregnancy. Track any new symptoms and share them at your appointments." }];
}

// â”€â”€ Pregnancy symptom insights (uses logged symptoms) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PREGNANCY_SYMPTOM_MAP = {
  // Bleeding
  VAGINAL_BLEEDING:     { label: "Bleeding", note: "Any vaginal bleeding in pregnancy should be reported to your provider promptly, even if light." },
  SPOTTING:             { label: "Spotting", note: "Light spotting can occur in early pregnancy from implantation or cervical sensitivity. Always mention it to your provider." },
  HEAVY_FLOW:           { label: "Heavy bleeding", note: "Heavy bleeding during pregnancy requires prompt medical attention. Contact your provider or go to emergency care." },
  LARGE_CLOTS:          { label: "Blood clots", note: "Passing clots during pregnancy should always be assessed by your healthcare provider right away." },
  // Pain
  CRAMPS:               { label: "Cramping", note: "Mild cramping can be normal as the uterus stretches. Sharp, persistent, or one-sided pain should be assessed by your provider." },
  PELVIC_PAIN:          { label: "Pelvic pain", note: "Pelvic girdle pain is common as ligaments loosen. A support belt or prenatal physiotherapy can help. Severe pain warrants a check-up." },
  HEADACHE:             { label: "Headaches", note: "Common in pregnancy due to hormonal changes and increased blood volume. Stay hydrated and rest. Persistent or severe headaches should be checked." },
  JOINT_PAIN:           { label: "Joint pain", note: "Relaxin hormone loosens joints in preparation for birth, which can cause aching. Gentle movement and warm compresses help." },
  BREAST_TENDERNESS:    { label: "Breast tenderness", note: "Increased blood flow and hormones cause breast changes throughout pregnancy. A well-fitted, supportive bra makes a difference." },
  OVULATION_PAIN:       { label: "Pelvic twinges", note: "Round ligament pain - sharp twinges in the lower abdomen - is common as the uterus grows. Changing positions slowly can help." },
  // Digestive
  BLOATING:             { label: "Bloating", note: "Progesterone slows digestion, causing gas and bloating. Smaller meals and gentle movement can help." },
  GASSY:                { label: "Gas", note: "Increased gas is common throughout pregnancy. Eating slowly, avoiding carbonated drinks, and light walks after meals can ease it." },
  HEARTBURN:            { label: "Heartburn", note: "The growing uterus pushes stomach acid up. Smaller meals, avoiding lying down after eating, and sleeping with your head elevated can help." },
  NAUSEA:               { label: "Nausea", note: "Very common especially in the first trimester. Small, frequent meals and ginger can help. Severe or persistent vomiting (hyperemesis) warrants a call to your provider." },
  CONSTIPATION:         { label: "Constipation", note: "Iron supplements and progesterone slow the gut. Increase fibre, water, and gentle activity to help keep things moving." },
  DIARRHEA:             { label: "Diarrhoea", note: "Can occur in pregnancy due to hormonal changes or diet. Stay well hydrated and contact your provider if it persists." },
  // Discharge
  DISCHARGE_EGGWHITE:   { label: "Discharge changes", note: "Increased clear or white discharge is normal in pregnancy. Unusual colour, odour, or itching should be assessed." },
  DISCHARGE_CREAMY:     { label: "Creamy discharge", note: "Increased creamy discharge is common and normal. If it has an unusual smell or causes itching, check with your provider." },
  UNUSUAL_DISCHARGE:    { label: "Unusual discharge", note: "Any discharge that is yellow, green, or foul-smelling should be reported to your provider to rule out infection." },
  // Physical
  FATIGUE:              { label: "Fatigue", note: "Extremely common especially in the first and third trimesters. Prioritise rest, accept help, and eat iron-rich foods to support energy levels." },
  FLUID_RETENTION:      { label: "Swelling", note: "Mild swelling in legs and feet is common later in pregnancy. Sudden or severe swelling in the face or hands should be reported to your provider." },
  FREQUENT_URINATION:   { label: "Frequent urination", note: "Normal as the uterus grows and presses on the bladder. Reduce fluids in the evening if it disrupts sleep, but stay hydrated during the day." },
  WEIGHT_CHANGE:        { label: "Weight changes", note: "Steady weight gain is expected during pregnancy. Your provider will monitor this at each visit to ensure it's on track for you." },
  NASAL_CONGESTION:     { label: "Nasal congestion", note: "Pregnancy rhinitis - a stuffy nose caused by increased blood flow - is common. A humidifier and saline spray can help." },
  SMELL_SENSITIVITY:    { label: "Smell sensitivity", note: "Heightened sense of smell is very common in the first trimester and often linked to nausea. Avoiding strong scents where possible can help." },
  // Skin & Hair
  ACNE:                 { label: "Acne", note: "Hormonal changes can trigger breakouts. Gentle cleansers are best - avoid strong actives like retinoids during pregnancy." },
  DRY_SKIN:             { label: "Dry skin", note: "Skin stretching and hormonal shifts can cause dryness and itching. Fragrance-free moisturisers help, and staying hydrated matters too." },
  HAIR_THINNING:        { label: "Hair changes", note: "Some people experience hair thinning during pregnancy while others notice thicker hair. Postpartum hair shedding is also very common." },
  // Temperature
  HOT_FLASHES:          { label: "Feeling hot", note: "Increased metabolic rate and blood volume can make you feel overheated. Wear breathable fabrics, stay cool, and stay hydrated." },
  NIGHT_SWEATS:         { label: "Night sweats", note: "Hormonal shifts can cause night sweats, especially in the third trimester. Light bedding and a cool room can help." },
  // Cognitive
  BRAIN_FOG:            { label: "Brain fog", note: "Often called 'pregnancy brain', forgetfulness and difficulty concentrating are common and caused by hormonal and sleep changes." },
  FORGETFUL:            { label: "Forgetfulness", note: "Memory lapses during pregnancy are normal. Lists, reminders, and routines can help manage this." },
  POOR_CONCENTRATION:   { label: "Poor concentration", note: "Difficulty focusing is common throughout pregnancy. Rest, good nutrition, and reducing unnecessary stressors all support cognitive function." },
  // Mood
  MOOD_SWINGS:          { label: "Mood swings", note: "Hormonal fluctuations cause rapid emotional shifts throughout pregnancy. Connection, rest, and talking to someone you trust all help." },
  IRRITABILITY:         { label: "Irritability", note: "Feeling irritable is very common in pregnancy, driven by hormonal changes, discomfort, and disrupted sleep. Rest and boundaries matter." },
  ANXIETY:              { label: "Anxiety", note: "Worry about pregnancy and birth is common. Talking to someone you trust, prenatal yoga, or speaking with your midwife can all support your wellbeing." },
  DEPRESSION:           { label: "Low mood", note: "Prenatal depression affects many people and is treatable. Please speak with your provider or midwife - you do not have to manage this alone." },
  CRYING_SPELLS:        { label: "Crying spells", note: "Emotional sensitivity and tearfulness are very common in pregnancy. Hormonal changes are usually responsible, but if it feels overwhelming, speak to your provider." },
  STRESSED:             { label: "Stress", note: "Some stress is normal, but chronic stress can affect sleep and wellbeing. Breathing exercises, support from loved ones, and rest all help." },
  // Sleep
  INSOMNIA:             { label: "Sleep difficulty", note: "Common in all trimesters for different reasons - nausea, back pain, or anxiety. A body pillow, cool room, and wind-down routine can support better sleep." },
  // Appetite
  CRAVING_SWEET:        { label: "Sweet cravings", note: "Food cravings are very common in pregnancy. Satisfying them in moderation while maintaining balanced nutrition is a reasonable approach." },
  CRAVING_SALTY:        { label: "Salty cravings", note: "Salt cravings can occur as blood volume increases. Balance them with nutritious whole foods and adequate hydration." },
  CRAVING_GREASY:       { label: "Greasy food cravings", note: "Cravings for comfort foods are normal. Listen to your body while keeping a varied, nutritious diet overall." },
  CRAVING_SPICY:        { label: "Spicy food cravings", note: "Spicy food cravings are common - just be mindful of heartburn, which spicy foods can worsen during pregnancy." },
  APPETITE_INCREASE:    { label: "Increased appetite", note: "Increased hunger, especially in the second trimester, is normal as your baby grows rapidly. Focus on nutrient-dense foods." },
  APPETITE_DECREASE:    { label: "Decreased appetite", note: "Reduced appetite is common in the first trimester due to nausea. Eat small amounts often and focus on what you can tolerate." },
  // Reproductive
  VAGINAL_DRYNESS:      { label: "Vaginal dryness", note: "Can occur due to hormonal shifts. A water-based lubricant is safe to use during pregnancy if needed." },
  PAIN_DURING_SEX:      { label: "Discomfort during sex", note: "Common as the body changes. Many positions become uncomfortable - communication with your partner and trying different positions can help." },
  CERVICAL_MUCUS_CHANGE:{ label: "Cervical mucus changes", note: "Increased discharge throughout pregnancy is normal as the body maintains the mucus plug. Report any sudden gush of fluid to your provider." },
};

function renderPregnancySymptomInsights(logsByDate, week, lmp) {
  const body = document.getElementById("pregnancy-symptom-body");
  if (!body) return;

  // db.js stores symptoms as human-readable labels ("Nausea"), so convert
  // each to an uppercase code ("NAUSEA") before looking up in the map.
  const labelToCode = label =>
    String(label || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

  // Determine trimester date range from LMP so we scan the whole trimester
  const todayKey = toDateKey(new Date());
  let trimesterStartKey = todayKey;
  if (lmp && week) {
    const lmpMs = new Date(lmp + "T00:00:00").getTime();
    // Trimester boundaries in weeks: T1=1-12, T2=13-26, T3=27+
    const trimesterStartWeek = week <= 12 ? 1 : week <= 26 ? 13 : 27;
    const startMs = lmpMs + (trimesterStartWeek - 1) * 7 * 86400000;
    trimesterStartKey = toDateKey(new Date(startMs));
  }

  // Collect every unique symptom logged from trimester start to today
  const trimesterSymptoms = new Set();
  for (const [dk, entry] of Object.entries(logsByDate)) {
    if (dk < trimesterStartKey || dk > todayKey) continue;
    (entry.symptoms ?? []).forEach(s => trimesterSymptoms.add(labelToCode(s)));
  }

  const matched = [...trimesterSymptoms]
    .map(s => PREGNANCY_SYMPTOM_MAP[s])
    .filter(Boolean);

  if (!matched.length) {
    const genericTip = week && week <= 12
      ? "In the first trimester, common experiences include nausea, fatigue, and breast tenderness. Log your symptoms to receive personalised insights here."
      : week && week <= 26
      ? "The second trimester often brings more energy. Log any symptoms you notice and they will appear here with context."
      : "Log your daily symptoms in the calendar and they will appear here with pregnancy-specific context.";
    body.innerHTML = `<p class="text-muted preg-insight-body">${genericTip}</p><a class="btn btn-outline btn-log-today" href="/pages/calendar.html">Log today</a>`;
    return;
  }

  const trimesterLabel = week ? (week <= 12 ? "First trimester" : week <= 26 ? "Second trimester" : "Third trimester") : "This trimester";
  const tags = matched.map(m => `<span class="preg-symptom-tag">${m.label}</span>`).join("");

  body.innerHTML = `
    <p class="preg-insight-body" style="margin-bottom:0.5rem;">Logged during your ${trimesterLabel}:</p>
    <div class="preg-symptom-tags">${tags}</div>
    ${matched.map(m => `
      <div class="preg-insight-item">
        <span class="preg-insight-title">${m.label}</span>
        <span class="preg-insight-body">${m.note}</span>
      </div>`).join("")}
  `;
}

function renderPregnancyTools(goal, logsByDate) {
  const card = document.getElementById("pregnancy-tools");
  const body = document.getElementById("pregnancy-tools-body");
  const insightsZone = document.getElementById("pregnancy-insights");
  if (!card || !body) return;

  const isPreg = goal === "pregnancy";
  show(card, isPreg);
  document.body.classList.toggle("goal-pregnancy", isPreg);
  if (!isPreg) {
    if (insightsZone) insightsZone.style.display = "none";
    return;
  }

  const lmp = localStorage.getItem("bloom_lmp");

  if (!lmp || !algoPregnancy) {
    if (insightsZone) insightsZone.style.display = "none";
    body.innerHTML = `
      <p class="text-muted">Add your last menstrual period (LMP) date in your profile to see your due date, trimester, and weekly milestones.</p>
      <a class="btn btn-primary" href="/pages/profile-view.html" style="margin-top:0.75rem;display:inline-block;">Add LMP date</a>
    `;
    return;
  }

  if (insightsZone) insightsZone.style.display = "grid";

  let week = null;
  try {
    const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
    const cycleLen = Number(profile.avgCycleLength) || 28;
    // Parse LMP as local midnight to avoid UTC-offset shifting the date
    const lmpDate = new Date(lmp + "T00:00:00");
    console.log(`[pregnancy] LMP stored: ${lmp} -> parsed: ${lmpDate.toDateString()} -> daysAgo: ${Math.floor((Date.now() - lmpDate) / 86400000)}`);
    const r = algoPregnancy.estimatedDueDate(lmpDate, cycleLen);
    week = r.currentWeek;
    const babySizeWeek = Number.isFinite(week) && week >= 4 ? Math.min(40, week) : null;
    const size = babySizeWeek ? BABY_SIZES[babySizeWeek] : null;
    const isPostDue = Number.isFinite(week) && week > 40;
    const overdueWeeks = isPostDue ? week - 40 : 0;
    const weekLabel = Number.isFinite(week) ? week : "-";
    const weeksRemainingLabel = Number.isFinite(r.weeksRemaining)
      ? r.weeksRemaining
      : (isPostDue ? 0 : "-");
    const overdueBanner = isPostDue
      ? `
        <div class="preg-overdue-banner" role="status" aria-live="polite">
          <span class="preg-overdue-title">Past due date</span>
          <p class="preg-overdue-body">
            You are about ${overdueWeeks} week${overdueWeeks === 1 ? "" : "s"} past your EDD.
            Stay in close contact with your provider for ongoing monitoring.
          </p>
        </div>
      `
      : "";

    body.innerHTML = `
      ${overdueBanner}
      ${size ? `
        <div class="baby-size-display">
          <img class="baby-size-img" src="${size.img}" alt="${size.label}" />
          <div class="baby-size-label">Your baby is the size of a ${size.label}</div>
          <div class="baby-size-week">Week ${weekLabel}${isPostDue ? " (post-due)" : ""}</div>
        </div>` : ""}
      <div class="insight-item"><strong>EDD:</strong> ${formatDate(toDateKey(r.eddAdjusted))}${cycleLen !== 28 ? ` <span class="text-muted">(adjusted for ${cycleLen}-day cycle)</span>` : ""}</div>
      <div class="insight-item"><strong>Trimester:</strong> ${r.trimesterLabel ?? "-"} &bull; <strong>Week:</strong> ${weekLabel} &bull; <strong>Weeks remaining:</strong> ${weeksRemainingLabel}${isPostDue ? ` <span class="text-muted">(${overdueWeeks} week${overdueWeeks === 1 ? "" : "s"} past EDD)</span>` : ""}</div>
      `;
  } catch (_) {
    body.innerHTML = `<p class="text-muted">Could not calculate due date. Check your LMP date in your profile.</p>`;
  }

  // Week tips card
  const weekTipsBody = document.getElementById("pregnancy-week-tips-body");
  if (weekTipsBody) {
    const tips = getPregnancyWeekTips(week);
    const weekBadge = week ? `<div class="preg-week-badge">Week ${week}</div>` : "";
    weekTipsBody.innerHTML = weekBadge + tips.map(tip => `
      <div class="preg-insight-item">
        <span class="preg-insight-title">${tip.t}</span>
        <span class="preg-insight-body">${tip.d}</span>
      </div>`).join("");
  }

  // Symptom insights card
  renderPregnancySymptomInsights(logsByDate ?? {}, week, lmp);
}

// â”€â”€â”€ Symptom section â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function renderSymptomTools(goal, logsByDate, cycle) {
  const card = document.getElementById("symptom-tools");
  const body = document.getElementById("symptom-tools-body");
  const subtitle = document.getElementById("symptom-tools-subtitle");
  if (!card || !body) return;

  const on = goal === "no_period" || goal === "track_symptoms" || goal === "perimenopause";
  document.body.classList.toggle("goal-no-period", goal === "no_period");
  document.body.classList.toggle("goal-track-symptoms", goal === "track_symptoms");
  document.body.classList.toggle("goal-perimenopause", goal === "perimenopause");
  show(card, on);
  if (!on) return;

  // Use cyclePhaseEngine.js directly to get phase from logs (works without sign-in)
  let phase = cycle?.phase && cycle.phase !== "unknown" ? cycle.phase : null;
  let phaseLabel = cycle?.phaseLabel ?? null;
  if (!phase) {
    try {
      const { computeCyclePhaseML } = await import("../../backend/ml/inference/cyclePhaseEngine.js");
      const trimLogs = Object.fromEntries(
        Object.entries(logsByDate).filter(([, v]) => isLoggedPeriodDay(v))
      );
      const result = computeCyclePhaseML(trimLogs);
      if (result?.phase && result.phase !== "unknown") {
        phase = result.phase;
        phaseLabel = result.phaseLabel ?? null;
      }
    } catch (_) {}
  }
  // Normalize late_luteal/ovulatory to engine keys
  const displayPhaseLabel = phaseLabel ?? (phase ? phase.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) : null);
  if (subtitle) {
    subtitle.textContent = phase
      ? `Based on your logs | ${displayPhaseLabel} Phase`
      : "Based on your recent logs";
  }

  // Build logged symptoms in engine format: [{code, severity}]
  // Use the most recently logged day within the last 7 days, not strictly today.
  const labelToCode = s => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const todayKey = toDateKey(new Date());
  const customInsight = buildCustomSymptomInsight(logsByDate, 30);

  let recentEntry = null;
  for (let d = 0; d < 7; d++) {
    const dk = addDaysStr(todayKey, -d);
    if (logsByDate[dk]?.symptoms?.length) { recentEntry = logsByDate[dk]; break; }
  }
  const todaySyms = recentEntry
    ? (recentEntry.symptoms ?? []).map(s => ({
        code: labelToCode(s),
        severity: recentEntry.symptomSeverity?.[s] ?? 3,
      }))
    : [];

  // Build symptom history in engine format for the last 90 days
  const symptomHistory = [];
  for (let d = 0; d < 90; d++) {
    const dk = addDaysStr(todayKey, -d);
    const entry = logsByDate[dk];
    if (!entry?.symptoms?.length) continue;
    symptomHistory.push({
      dateKey: dk,
      items: entry.symptoms.map(s => ({
        code: labelToCode(s),
        severity: entry.symptomSeverity?.[s] ?? 3,
      })),
    });
  }

  if (!symptomHistory.length && !customInsight) {
    body.innerHTML = `
      <p class="text-muted">No symptoms logged yet. Open the calendar to start tracking.</p>
      <a class="btn btn-outline btn-log-today" href="/pages/calendar.html">Open calendar</a>
    `;
    return;
  }

  if (!algoSymptomEngine) {
    body.innerHTML = `<p class="text-muted">Symptom engine loading - please refresh.</p>`;
    return;
  }

  // Normalize phase to engine's known keys (late_luteal and ovulatory map to luteal/ovulation)
  const ENGINE_PHASE_MAP = { late_luteal: "luteal", ovulatory: "ovulation" };
  const enginePhase = ENGINE_PHASE_MAP[phase] ?? phase ?? null;

  const signals = algoSymptomEngine.generateSymptomSignals({
    loggedSymptoms:  todaySyms,
    phase:           enginePhase,
    dayOfCycle:      cycle?.dayInCycle ?? null,
    cycleLengths:    [],
    cycleCount:      Math.max(cycle?.cyclesLogged ?? 0, symptomHistory.length > 0 ? 2 : 0),
    symptomHistory,
    today:           new Date(),
  });

  // If engine returned no visible signals but symptoms are logged,
  // fall back to showing phase-context for each logged symptom using SYMPTOM_PHASE_MAP.
  const levelColor = { high: "var(--color-danger)", medium: "var(--color-warning)", low: "var(--color-text-muted)" };

  if (signals.length) {
    const customHtml = customInsight ? `
      <div class="preg-insight-item">
        <span class="preg-insight-title">Custom symptom history</span>
        <span class="preg-insight-body">${customInsight.recurringMessage}${customInsight.extraCount > 0 ? ` ${customInsight.extraCount} other custom symptom${customInsight.extraCount === 1 ? " has" : "s have"} also appeared in your recent history.` : ""} Custom symptoms are tracked in your history, but are not yet used in pattern predictions.${customInsight.urgent ? " If a custom symptom feels severe, sudden, or worrying, consider seeking medical advice." : ""}</span>
      </div>` : "";
    body.innerHTML = signals.map(s => `
      <div class="preg-insight-item">
        <span class="preg-insight-title" style="color:${levelColor[s.level] ?? "var(--color-primary-dark)"};">${s.title}</span>
        <span class="preg-insight-body">${s.message}${s.guidance ? ` ${s.guidance}` : ""}</span>
      </div>`).join("") + customHtml;
    return;
  }

  // Fallback: use SYMPTOM_PHASE_MAP from the engine to show per-symptom context
  const phaseMap = algoSymptomEngine.SYMPTOM_PHASE_MAP;
  const expectedSet   = new Set(enginePhase ? (phaseMap[enginePhase]?.expected   ?? []) : []);
  const unexpectedSet = new Set(enginePhase ? (phaseMap[enginePhase]?.unexpected ?? []) : []);

  const allRecentCodes = new Set();
  symptomHistory.slice(0, 7).forEach(e => e.items?.forEach(i => allRecentCodes.add(i.code)));
  todaySyms.forEach(i => allRecentCodes.add(i.code));

  if (!allRecentCodes.size && !customInsight) {
    body.innerHTML = `<p class="text-muted">No recent symptoms found. Open the calendar to log symptoms.</p><a class="btn btn-outline btn-log-today" href="/pages/calendar.html">Open calendar</a>`;
    return;
  }

  const detailForSymptom = (code) => {
    const DETAIL_MAP = {
      BREAST_TENDERNESS: {
        why: "Breast tenderness often rises with hormone shifts, especially progesterone changes around ovulation and the luteal phase.",
        tip: "A supportive bra, less caffeine, and warm compresses can reduce discomfort.",
      },
      IRRITABILITY: {
        why: "Irritability is often linked to sleep disruption, stress load, and premenstrual hormone shifts.",
        tip: "Protect sleep, eat consistently, and log triggers so recurring patterns are easier to manage.",
      },
      HEARTBURN: {
        why: "Heartburn can rise around cycle transitions because progesterone can slow digestion.",
        tip: "Smaller meals, less late-night eating, and staying upright after meals can help.",
      },
      NAUSEA: {
        why: "Nausea can appear with hormonal shifts, pain flares, poor sleep, or digestive sensitivity.",
        tip: "Hydration and small frequent meals help; persistent or severe nausea should be medically reviewed.",
      },
      CRAMPS: {
        why: "Cramps are driven by uterine prostaglandins and often peak in early menstrual days.",
        tip: "Heat, gentle movement, hydration, and timely pain relief can make symptoms easier to handle.",
      },
      PELVIC_PAIN: {
        why: "Pelvic pain can be cycle-linked, especially around bleeding days or ovulation timing.",
        tip: "Track location and severity; worsening, severe, or one-sided pain should be checked.",
      },
      BLOATING: {
        why: "Bloating is common when progesterone slows gut motility and fluid shifts increase.",
        tip: "Hydration, lower sodium intake, and light movement can reduce pressure and discomfort.",
      },
      FATIGUE: {
        why: "Cycle-linked fatigue often appears when sleep quality dips or during late luteal and menstrual days.",
        tip: "Prioritize sleep consistency and iron-rich foods, especially if your flow is heavy.",
      },
      ANXIETY: {
        why: "Anxiety symptoms can intensify around hormonal transitions and cumulative stress.",
        tip: "Breathing routines, sleep consistency, and tracking timing can help identify triggers.",
      },
      LOW_MOOD: {
        why: "Low mood can increase when estrogen and progesterone fall in late luteal days.",
        tip: "Track mood with cycle timing; persistent low mood should be discussed with a clinician.",
      },
      SPOTTING: {
        why: "Spotting may happen with ovulation timing, hormonal fluctuations, or cycle disruption.",
        tip: "Track amount, timing, and accompanying symptoms to identify if a repeat pattern is forming.",
      },
      HEAVY_FLOW: {
        why: "Heavy flow can increase fatigue and pain burden and may affect cycle predictions.",
        tip: "Log flow intensity daily; soaking products rapidly needs urgent medical care.",
      },
    };

    if (DETAIL_MAP[code]) return DETAIL_MAP[code];

    if (code.includes("DISCHARGE") || code.includes("CERVICAL_MUCUS")) {
      return {
        why: "Discharge changes often reflect normal hormone shifts across the cycle.",
        tip: "Track color, texture, and timing; sudden odor, irritation, or pain should be checked.",
      };
    }
    if (code.includes("CRAVING") || code.includes("APPETITE")) {
      return {
        why: "Cravings and appetite changes are common with hormonal and energy fluctuations.",
        tip: "Regular balanced meals can reduce sharp hunger swings and energy crashes.",
      };
    }
    if (code.includes("MOOD") || ["CRYING_SPELLS", "STRESSED", "WITHDRAWN", "SOCIABLE"].includes(code)) {
      return {
        why: "Mood and social energy can shift significantly across cycle phases.",
        tip: "Tracking timing helps separate cycle-linked changes from day-to-day stress.",
      };
    }
    if (code.includes("PAIN") || code === "JOINT_OR_MUSCLE_PAIN") {
      return {
        why: "Pain symptoms can cluster around menstruation or ovulation windows.",
        tip: "Log location and intensity to identify predictable patterns and escalation points.",
      };
    }

    return {
      why: "This symptom can be cycle-linked, but its meaning is clearest when viewed as a repeating trend.",
      tip: "Keep logging timing and intensity so Bloom can personalize insights for your pattern.",
    };
  };

  const severityLabel = (avg) => {
    if (!Number.isFinite(avg)) return null;
    if (avg <= 2.0) return "mild";
    if (avg <= 3.3) return "moderate";
    if (avg <= 4.2) return "elevated";
    return "high";
  };

  const statsByCode = new Map();
  const cutoff14 = addDaysStr(todayKey, -13);
  for (const day of symptomHistory) {
    for (const item of (day.items || [])) {
      const code = item.code;
      const sev = Number(item.severity ?? 3);
      const stat = statsByCode.get(code) || {
        count14: 0,
        sev14Sum: 0,
        sev14Count: 0,
      };
      if (day.dateKey >= cutoff14) {
        stat.count14 += 1;
        stat.sev14Sum += sev;
        stat.sev14Count += 1;
      }
      statsByCode.set(code, stat);
    }
  }

  const codeToLabel = code => code.replace(/_/g, " ").toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());

  const items = [...allRecentCodes]
    .sort((a, b) => (statsByCode.get(b)?.count14 ?? 0) - (statsByCode.get(a)?.count14 ?? 0))
    .map(code => {
      const stats = statsByCode.get(code);
      const avg14 = stats?.sev14Count ? (stats.sev14Sum / stats.sev14Count) : null;
      const sevText = severityLabel(avg14);
      const frequency = stats?.count14
        ? `Logged ${stats.count14} time${stats.count14 !== 1 ? "s" : ""} in the last 14 days${sevText ? ` (${sevText} intensity)` : ""}.`
        : "Logged recently.";

      const isUnexpected = unexpectedSet.has(code);
      const isExpected   = expectedSet.has(code);
      const badge = isUnexpected
        ? `<span class="sym-badge sym-badge--warn">worth noting</span>`
        : isExpected
        ? `<span class="sym-badge sym-badge--typical">typical for this phase</span>`
        : "";

      const detail = detailForSymptom(code);
      const phaseContext = isUnexpected && phase
        ? `It is less typical in the ${phaseLabel ?? phase} phase, so watch for persistence or escalation.`
        : isExpected && phase
        ? `It is commonly seen in the ${phaseLabel ?? phase} phase.`
        : phase
        ? `Phase context is mixed in the ${phaseLabel ?? phase} phase, so multi-cycle trend matters most.`
        : "";

      const context = [frequency, detail.why, phaseContext, detail.tip].filter(Boolean).join(" ");

      return `
      <div class="preg-insight-item">
        <span class="preg-insight-title">${codeToLabel(code)}${badge}</span>
        <span class="preg-insight-body">${context}</span>
      </div>`;
    });

  const customHtml = customInsight ? `
    <div class="preg-insight-item">
      <span class="preg-insight-title">Custom symptom history</span>
      <span class="preg-insight-body">${customInsight.recurringMessage}${customInsight.extraCount > 0 ? ` ${customInsight.extraCount} other custom symptom${customInsight.extraCount === 1 ? " has" : "s have"} also appeared in your recent history.` : ""} Custom symptoms are tracked in your history, but are not yet used in pattern predictions.${customInsight.urgent ? " If a custom symptom feels severe, sudden, or worrying, consider seeking medical advice." : ""}</span>
    </div>` : "";

  body.innerHTML = items.join("") + customHtml;
}

// â”€â”€â”€ Cycle history + trend chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Returns an array of card HTML strings (most recent first)
function buildCycleCards(cycleStarts, cycleLengths, logsByDate, currentCycleState = null) {
  const todayKey = toDateKey(new Date());

  return [...cycleStarts].reverse().map((start, revIdx) => {
    const i = cycleStarts.length - 1 - revIdx;
    const cycleLen = cycleLengths[i];
    const isCurrent = cycleLen == null;
    const nextStart = isCurrent ? null : cycleStarts[i + 1];
    const cycleEndKey = nextStart ? addDaysStr(nextStart, -1) : todayKey;

    // Compute phase boundaries for this cycle.
    // For historical (closed) cycles we infer from next period start.
    // For current cycle we use authoritative state from fetchCycleState().
    let ovulationKey = isCurrent
      ? (currentCycleState?.ovulationDate ?? null)
      : (nextStart ? addDaysStr(nextStart, -14) : null);
    let fertileStartKey = isCurrent
      ? (currentCycleState?.fertileStart ?? null)
      : (nextStart ? addDaysStr(nextStart, -19) : null);
    let fertileEndKey = isCurrent
      ? (currentCycleState?.fertileEnd ?? null)
      : (nextStart ? addDaysStr(nextStart, -13) : null);
    const currentPhaseKey = String(currentCycleState?.phase || "").toLowerCase();
    const currentPhaseIsLuteal = isCurrent && (currentPhaseKey === "luteal" || currentPhaseKey === "late_luteal");
    if (currentPhaseIsLuteal && (!ovulationKey || ovulationKey >= todayKey)) {
      ovulationKey = addDaysStr(todayKey, -1);
      fertileEndKey = ovulationKey;
      fertileStartKey = addDaysStr(ovulationKey, -5);
    }

    // Build dot array (cap at 40 for display)
    const displayLen = Math.min(cycleLen ?? (diffDays(start, todayKey) + 1), 40);
    const dots = [];
    for (let d = 0; d < displayLen; d++) {
      const dk = addDaysStr(start, d);
      const log = logsByDate[dk];
      const isPeriod = isLoggedPeriodDay(log);
      let cls = "dot-follicular"; // default: follicular phase
      if (isPeriod) {
        cls = "dot-period";
      } else if (ovulationKey && dk === ovulationKey) {
        cls = "dot-ovulation";
      } else if (fertileStartKey && dk >= fertileStartKey && dk <= fertileEndKey) {
        cls = "dot-fertile";
      } else if (ovulationKey && dk > ovulationKey) {
        cls = "dot-luteal"; // after ovulation until next period
      }
      dots.push(`<span class="cycle-dot-item ${cls}" title="${dk}"></span>`);
    }

    const daysSoFar = diffDays(start, todayKey) + 1;
    const title    = isCurrent ? `Current cycle: ${daysSoFar} days` : `${cycleLen} days`;
    const subtitle = `${formatDate(start)} - ${isCurrent ? "present" : formatDate(cycleEndKey)}`;

    const nextParam = nextStart ? `&next=${nextStart}` : "";
    return `
      <div class="cycle-card cycle-card--clickable" role="button" tabindex="0"
           onclick="window.location.href='/pages/cycle-detail.html?start=${start}${nextParam}'"
           onkeydown="if(event.key==='Enter')window.location.href='/pages/cycle-detail.html?start=${start}${nextParam}'">
        <span class="cycle-card-title">${title}</span>
        <span class="cycle-card-subtitle">${subtitle}</span>
        <div class="cycle-dot-row">${dots.join("")}</div>
        <span class="cycle-card-arrow">&rsaquo;</span>
      </div>`;
  });
}

async function renderCycleHistoryAndChart(cycle, logsByDate) {
  const cycleStarts = cycle.cycleStarts || [];
  const dotsEl = document.getElementById("cycle-dots");
  const canvas = document.getElementById("cycleChart");
  const todayKey = toDateKey(new Date());

  // Compute cycle lengths (days between consecutive period starts)
  const cycleLengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    cycleLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }

  // â”€â”€ Dot-based cycle history â”€â”€
  if (dotsEl) {
    if (!cycleStarts.length) {
      dotsEl.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">No periods logged. Open Calendar to begin tracking.</p>`;
    } else {
      const legend = `
        <div class="cycle-legend">
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-period"></span>Period</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-fertile"></span>Fertile</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-ovulation"></span>Ovulation</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-follicular"></span>Follicular</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-luteal"></span>Luteal</span>
        </div>`;

      const INITIAL_SHOW = 4;
      const cardHTMLs = buildCycleCards(cycleStarts, cycleLengths, logsByDate, cycle);
      const visible = cardHTMLs.slice(0, INITIAL_SHOW);
      const extra   = cardHTMLs.slice(INITIAL_SHOW);

      let historyHTML = legend + visible.join("");
      if (extra.length) {
        historyHTML += `<div id="cycle-history-extra" class="hidden">${extra.join("")}</div>`;
        historyHTML += `<button type="button" id="show-more-cycles" class="btn btn-outline" style="margin-top:0.75rem;width:100%;">
          Show ${extra.length} more cycle${extra.length !== 1 ? "s" : ""}
        </button>`;
      }

      dotsEl.innerHTML = historyHTML;

      const moreBtn = document.getElementById("show-more-cycles");
      if (moreBtn) {
        moreBtn.onclick = () => {
          document.getElementById("cycle-history-extra").classList.remove("hidden");
          moreBtn.remove();
        };
      }
    }
  }

  // â”€â”€ Trend chart (Plotly) â”€â”€
  if (!canvas) return;

  const chartLengths = [...cycleLengths];
  const chartLabels = cycleStarts.slice(0, -1).map((s) => formatDate(s));

  // Include the in-progress cycle so the chart represents all observed cycles.
  if (cycleStarts.length) {
    const currentStart = cycleStarts[cycleStarts.length - 1];
    const currentDays = Math.max(1, diffDays(currentStart, todayKey) + 1);
    chartLengths.push(currentDays);
    chartLabels.push(`${formatDate(currentStart)} (current)`);
  }

  if (chartLengths.length < 1) {
    canvas.closest(".chart-frame").innerHTML =
      `<p class="text-muted" style="font-size:0.9rem;text-align:center;padding:1.25rem 0;">Log at least 2 periods to view the cycle trend.</p>`;
    return;
  }

  const avgBase = cycleLengths.length ? cycleLengths : chartLengths;
  const avg = Math.round(avgBase.reduce((a, b) => a + b, 0) / avgBase.length);
  const yPad = 6;
  const yMin = Math.max(0, Math.min(...chartLengths) - yPad);
  const yMax = Math.max(...chartLengths) + yPad;

  // Marker colours: red if outside typical 21-35 day range
  const markerColors = chartLengths.map((l, idx) => {
    const isCurrent = idx === chartLengths.length - 1 && cycleStarts.length > 0;
    if (isCurrent) return "#8c6bb1";
    return l < 21 || l > 35 ? "#e05c7a" : "#D4749A";
  });

  const plotly = (typeof window !== "undefined" && window.Plotly)
    ? window.Plotly
    : await ensurePlotlyLoaded();

  if (!plotly) {
    const frame = canvas.closest(".chart-frame");
    if (frame) {
      frame.innerHTML = `<p class="text-muted" style="font-size:0.9rem;text-align:center;padding:1.25rem 0;">Cycle trend is temporarily unavailable. Please refresh.</p>`;
    }
    return;
  }

  plotly.newPlot(canvas, [
    // â”€â”€ Typical range ribbon (21-35 days) â”€â”€
    {
      x: chartLabels,
      y: Array(chartLabels.length).fill(35),
      type: "scatter",
      mode: "none",
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: chartLabels,
      y: Array(chartLabels.length).fill(21),
      type: "scatter",
      mode: "none",
      fill: "tonexty",
      fillcolor: "rgba(180,160,210,0.09)",
      name: "Typical range (21-35d)",
      hoverinfo: "skip",
    },
    // â”€â”€ Average line â”€â”€
    {
      x: chartLabels,
      y: Array(chartLengths.length).fill(avg),
      type: "scatter",
      mode: "lines",
      name: `Avg: ${avg}d`,
      line: { color: "#B85C82", dash: "dot", width: 1.8 },
      hoverinfo: "skip",
    },
    // â”€â”€ Cycle length line â”€â”€
    {
      x: chartLabels,
      y: chartLengths,
      type: "scatter",
      mode: "lines+markers",
      name: "Cycle length",
      line: { color: "#D4749A", width: 3, shape: "spline", smoothing: 1.1 },
      marker: {
        color: markerColors,
        size: 10,
        line: { color: "#fff", width: 2.5 },
      },
      hovertemplate: "<b>%{x}</b><br><b>%{y} days</b><extra></extra>",
    },
  ], {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 14, r: 16, b: 72, l: 48 },
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.28,
      x: 0,
      xanchor: "left",
      font: { family: "Nunito, sans-serif", size: 11 },
      bgcolor: "transparent",
    },
    yaxis: {
      range: [yMin, yMax],
      gridcolor: "rgba(0,0,0,0.06)",
      zeroline: false,
      tickfont: { family: "Nunito, sans-serif", size: 11 },
      ticksuffix: "d",
      automargin: true,
      autorange: false,
    },
    xaxis: {
      showgrid: false,
      tickfont: { family: "Nunito, sans-serif", size: 11 },
      tickangle: -30,
      automargin: true,
    },
    hovermode: "closest",
    annotations: [{
      x: chartLabels[chartLabels.length - 1],
      y: avg,
      xanchor: "right",
      yanchor: "bottom",
      text: `avg ${avg}d`,
      showarrow: false,
      font: { size: 10, color: "#B85C82", family: "Nunito, sans-serif" },
      yshift: 5,
    }],
  }, {
    responsive: true,
    displayModeBar: false,
  });
}

// â”€â”€â”€ PDF export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Full report generation lives in report.js / pdf-report-data.js.
// The dashboard button navigates there so all PDF logic stays in one place.

// â”€â”€â”€ Algorithm-powered advanced insights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function signalLabel(code) {
  return {
    // Cycle engine
    EXTENDED_ABSENCE:             "Extended gap since last period",
    MISSED_PERIOD:                "Period may be late",
    LATE_PERIOD:                  "Period seems late",
    IRREGULAR_CYCLE:              "Irregular pattern detected",
    LOW_PREDICTION_CONFIDENCE:    "Prediction confidence low",
    LOGGING_GAP:                  "Logging gap",
    PREDICTION_DRIFT:             "Prediction updated",
    SHORTENING_CYCLE_TREND:       "Shortening cycle trend",
    LENGTHENING_CYCLE_TREND:      "Lengthening cycle trend",
    SUDDEN_CYCLE_SHIFT:           "Sudden cycle shift",
    SHORT_CYCLE:                  "Short cycle noted",
    LONG_CYCLE:                   "Long cycle noted",
    // Anomaly engine
    CYCLE_LENGTH_ANOMALY:         "Unusual cycle timing",
    RESIDUAL_DRIFT:               "Cycle pattern shifting",
    DEVIATION_CLUSTER:            "Repeated off-pattern cycles",
    HIGH_CYCLE_VARIABILITY:       "High cycle variability",
    // Symptom engine
    SEEK_URGENT_CARE:             "Urgent = seek medical care",
    URGENT_SYMPTOM_COMBINATION:   "Concerning symptom combination",
    HEAVY_BLEEDING_FLAG:          "Heavy bleeding flagged",
    SEVERE_PAIN_FLAG:             "Severe pain flagged",
    PHASE_UNEXPECTED_SYMPTOMS:    "Unusual symptoms for this phase",
    PMS_CLUSTER_DETECTED:         "PMS pattern detected",
    PERIMENOPAUSE_PATTERN:        "Perimenopause pattern",
    PREGNANCY_TEST_TIMING_RELEVANT: "Pregnancy test timing relevant",
    HORMONAL_PATTERN_POSSIBLE:    "Hormonal pattern possible",
    SYMPTOM_FORECAST:             "Symptom forecast from your logs",
    PERSONAL_CURRENT_SYMPTOM_CONTEXT: "Your symptoms in context",
    PERSONAL_SYMPTOM_FORECAST:    "What may come next",
    BIOMETRIC_STRESS_SLEEP_LOAD:  "Stress and sleep pattern",
    BIOMETRIC_LOW_RECOVERY_LOAD:  "Recovery pattern",
    BIOMETRIC_ACTIVITY_STRESS_SHIFT: "Activity and stress pattern",
  }[code] || code.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function friendlySymptomNameFromCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SYMPTOM_PHRASE_OVERRIDES = {
  CRAVING_SWEET: "sweet cravings",
  SWEET_CRAVINGS: "sweet cravings",
  IRRITABLE_MIND: "irritability",
  IRRITABILITY: "irritability",
  FAINT_FEELING: "feeling faint",
  FEELING_FAINT: "feeling faint",
  FACIAL_PUFFINESS: "facial puffiness",
};

function symptomPhraseFromCode(code) {
  const key = String(code || "").trim().toUpperCase();
  return SYMPTOM_PHRASE_OVERRIDES[key] || friendlySymptomNameFromCode(key).toLowerCase();
}

function sentenceCase(value) {
  const text = String(value || "").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function severityLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "unrated";
  if (n >= 4.5) return "very high";
  if (n >= 3.5) return "high";
  if (n >= 2.5) return "moderate";
  if (n >= 1.5) return "mild";
  return "light";
}

function averageSeverity(items = []) {
  const values = items
    .map((item) => Number(item?.severity))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function symptomStatCountBefore(stat, dateKey) {
  return Array.isArray(stat?.dates)
    ? stat.dates.filter((d) => d && d !== dateKey && d < dateKey).length
    : 0;
}

function formatSymptomLogDate(dateKey, todayKey) {
  if (!dateKey) return "recently";
  if (dateKey === todayKey) return "today";
  return formatDate(dateKey);
}

function buildPersonalizedSymptomSignals({
  symptomHistory = [],
  today = new Date(),
  currentEntry = null,
  phase = null,
  dayOfCycle = null,
} = {}) {
  if (!Array.isArray(symptomHistory) || symptomHistory.length < 1) return [];

  const todayKey = toDateKey(today);
  const recent30Start = addDaysStr(todayKey, -29);
  const prev30Start = addDaysStr(todayKey, -59);
  const prev30End = addDaysStr(todayKey, -30);
  const selectedCurrentEntry =
    currentEntry ||
    symptomHistory.find((entry) => entry?.dateKey === todayKey) ||
    symptomHistory[symptomHistory.length - 1] ||
    null;

  const byCode = new Map();
  const recentSymptomDays = new Set();

  for (const day of symptomHistory) {
    const dateKey = day?.dateKey;
    if (!dateKey || !Array.isArray(day?.items)) continue;
    const isRecent30 = dateKey >= recent30Start && dateKey <= todayKey;
    const isPrev30 = dateKey >= prev30Start && dateKey <= prev30End;
    if (isRecent30) recentSymptomDays.add(dateKey);

    for (const item of day.items) {
      const code = String(item?.code || "").trim().toUpperCase();
      if (!code) continue;
      const sev = Number(item?.severity ?? 3);
      const stat = byCode.get(code) || {
        code,
        recent30: 0,
        prev30: 0,
        total: 0,
        dates: [],
        severitySum: 0,
        severityCount: 0,
        recentSevSum: 0,
        recentSevCount: 0,
      };

      stat.total += 1;
      stat.dates.push(dateKey);
      stat.severitySum += Number.isFinite(sev) ? sev : 3;
      stat.severityCount += 1;

      if (isRecent30) {
        stat.recent30 += 1;
        stat.recentSevSum += Number.isFinite(sev) ? sev : 3;
        stat.recentSevCount += 1;
      } else if (isPrev30) {
        stat.prev30 += 1;
      }

      byCode.set(code, stat);
    }
  }

  const ranked = [...byCode.values()]
    .filter((s) => s.recent30 > 0)
    .sort((a, b) => b.recent30 - a.recent30 || b.recentSevSum - a.recentSevSum);

  if (!ranked.length) return [];

  const signals = [];
  const top = ranked[0];
  const topLabel = friendlySymptomNameFromCode(top.code);
  const topPhrase = symptomPhraseFromCode(top.code);
  const topAvgSeverity = top.recentSevCount ? top.recentSevSum / top.recentSevCount : 0;
  const currentItems = Array.isArray(selectedCurrentEntry?.items)
    ? [...selectedCurrentEntry.items]
        .filter((item) => item?.code)
        .sort((a, b) => Number(b?.severity ?? 0) - Number(a?.severity ?? 0))
        .slice(0, 4)
    : [];
  const currentAgeDays = selectedCurrentEntry?.dateKey
    ? diffDays(selectedCurrentEntry.dateKey, todayKey)
    : Infinity;

  if (currentItems.length && currentAgeDays >= 0 && currentAgeDays <= 14) {
    const currentDateKey = selectedCurrentEntry.dateKey;
    const currentList = toPrettyList(currentItems.map((item) => {
      const label = symptomPhraseFromCode(item.code);
      return `${label} (${severityLabel(item.severity)})`;
    }), 3);
    const recurring = currentItems.filter((item) =>
      symptomStatCountBefore(byCode.get(String(item.code || "").toUpperCase()), currentDateKey) > 0
    );
    const newer = currentItems.filter((item) =>
      symptomStatCountBefore(byCode.get(String(item.code || "").toUpperCase()), currentDateKey) === 0
    );
    const recurringNames = toPrettyList(recurring.map((item) =>
      symptomPhraseFromCode(item.code)
    ), 2);
    const newNames = toPrettyList(newer.map((item) =>
      symptomPhraseFromCode(item.code)
    ), 2);
    const avgCurrentSeverity = averageSeverity(currentItems);
    const datePhrase = formatSymptomLogDate(currentDateKey, todayKey);
    const patternLabel = recurring.length
      ? "Returning pattern"
      : newer.length > 1
      ? "New symptoms"
      : "New symptom";
    const patternLine = recurring.length
      ? `${sentenceCase(recurringNames)} ${recurring.length === 1 ? "has" : "have"} appeared before.`
      : `${sentenceCase(newNames || "This symptom")} ${newer.length === 1 ? "looks" : "look"} new in your saved history.`;

    signals.push({
      code: "PERSONAL_CURRENT_SYMPTOM_CONTEXT",
      title: "Latest symptom log",
      level: avgCurrentSeverity >= 3.5 || recurring.length >= 2 || currentItems.length >= 3 ? "medium" : "low",
      show: true,
      summary: currentDateKey === todayKey
        ? `You logged ${currentList} today.`
        : `Most recent symptoms: ${currentList}.`,
      details: [
        `Date: ${datePhrase}`,
        `Pattern: ${patternLabel}`,
        `What Bloom sees: ${patternLine}`,
      ],
      guidance: "Log these again if they continue so Bloom can tell whether this is a one-off or part of your usual pattern.",
      debug: {
        currentDateKey,
        avgCurrentSeverity,
        recurringSymptoms: recurring.map((item) => item.code),
        newSymptoms: newer.map((item) => item.code),
      },
    });
  }

  const forecastCandidates = ranked
    .filter((s) => (s.recent30 >= 2 || s.total >= 2) && !/^SEEK_|URGENT|SEVERE_|HEAVY_BLEEDING/.test(s.code))
    .sort((a, b) => {
      const aAvg = a.severityCount ? a.severitySum / a.severityCount : 0;
      const bAvg = b.severityCount ? b.severitySum / b.severityCount : 0;
      return b.recent30 - a.recent30 || b.total - a.total || bAvg - aAvg;
    });

  if (forecastCandidates.length) {
    const topForecast = forecastCandidates.slice(0, 3);
    const forecastNames = toPrettyList(topForecast.map((s) =>
      symptomPhraseFromCode(s.code)
    ), 3);
    const avgForecastSeverity = averageSeverity(topForecast.map((s) => ({
      severity: s.severityCount ? s.severitySum / s.severityCount : 0,
    })));
    const timingBits = [
      phase ? `${formatPhaseLabelForInsight(phase)} phase` : "",
      Number.isFinite(Number(dayOfCycle)) ? `cycle day ${Number(dayOfCycle)}` : "",
    ].filter(Boolean);

    signals.push({
      code: "PERSONAL_SYMPTOM_FORECAST",
      title: "Likely next symptom",
      level: topForecast[0].recent30 >= 4 || avgForecastSeverity >= 3.5 ? "medium" : "low",
      show: true,
      summary: `${sentenceCase(forecastNames)} ${topForecast.length === 1 ? "is" : "are"} the strongest repeat in your saved logs for this timing.`,
      details: [
        `Timing: ${timingBits.length ? timingBits.join(" • ") : "current cycle timing"}`,
        `Usual severity: ${severityLabel(avgForecastSeverity)}`,
        "Basis: your saved symptom history",
      ],
      guidance: "If it shows up, log it with severity so Bloom can confirm whether this cycle is following your usual pattern.",
      debug: {
        forecastSymptoms: topForecast.map((s) => s.code),
        forecastBasis: "recent user symptom frequency",
        avgForecastSeverity,
        phase,
        dayOfCycle,
      },
    });
  }

  if (top.prev30 > 0 && top.recent30 >= top.prev30 + 2) {
    // Trending up - lead with the change
    signals.push({
      code: `PERSONAL_SYMPTOM_TREND_${top.code}`,
      title: `${topLabel} is coming up more often`,
      level: "medium",
      show: true,
      summary: `${sentenceCase(topPhrase)} increased compared with last month.`,
      details: [
        `This month: ${top.recent30} log${top.recent30 !== 1 ? "s" : ""}`,
        `Previous month: ${top.prev30} log${top.prev30 !== 1 ? "s" : ""}`,
        "Pattern: emerging",
      ],
      guidance: `Keep logging ${topPhrase} with severity so Bloom can tell whether this is continuing or settling back down.`,
    });
  } else if (top.recent30 >= 2) {
    const freqWord = top.recent30 >= 6 ? "frequently" : top.recent30 >= 4 ? "several times" : "a few times";
    const sevNote = topAvgSeverity >= 4 ? " at higher intensity" : topAvgSeverity >= 3 ? " at a moderate level" : "";
    signals.push({
      code: `PERSONAL_SYMPTOM_RECURRING_${top.code}`,
      title: `${topLabel} is a pattern for you`,
      level: top.recent30 >= 4 ? "medium" : "low",
      show: true,
      summary: `${sentenceCase(topPhrase)} is recurring in your recent logs.`,
      details: [
        `Frequency: ${freqWord} this month`,
        `Severity: ${severityLabel(topAvgSeverity)}${sevNote ? "" : " in your saved logs"}`,
        "Pattern: recurring",
      ],
      guidance: `Keep severity updated when ${topPhrase} appears so forecasts can become more specific to you.`,
    });
  }

  const uniqueRecent = ranked.filter((s) => s.recent30 > 0).length;
  if (uniqueRecent >= 3 && recentSymptomDays.size >= 4) {
    const topThree = ranked.slice(0, 3).map(s => symptomPhraseFromCode(s.code)).join(", ");
    signals.push({
      code: "PERSONAL_SYMPTOM_MIX_PATTERN",
      title: "You have a consistent symptom cluster",
      level: "low",
      show: true,
      summary: `${sentenceCase(topThree)} are showing up as a cluster.`,
      details: [
        `Logged days: ${recentSymptomDays.size} in the last month`,
        `Symptoms: ${topThree}`,
        "Pattern: cluster",
      ],
      guidance: "Keep logging which symptoms happen together so Bloom can compare this cluster with future cycles.",
    });
  }

  if (!signals.length && top.recent30 >= 1) {
    signals.push({
      code: `PERSONAL_SYMPTOM_RECENT_${top.code}`,
      title: `${topLabel} noted in your recent logs`,
      level: "low",
      show: true,
      summary: `${sentenceCase(topPhrase)} is saved in your recent history.`,
      details: [
        "Pattern: one-off for now",
        "Reason: not enough repeat logs yet",
      ],
      guidance: "If it happens again, log severity so Bloom can decide whether it is becoming a pattern.",
    });
  }

  return signals;
}

function normalizeBiometricLevelToScore(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1 && value <= 4) return value;
    if (value >= 0 && value <= 5) return Math.max(1, Math.min(4, Math.round(value)));
  }

  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map = { low: 1, moderate: 2, medium: 2, high: 3, very_high: 4 };
  return map[normalized] ?? null;
}

function biometricLevelLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "not set";
  if (n >= 3.5) return "very high";
  if (n >= 2.5) return "high";
  if (n >= 1.5) return "moderate";
  return "low";
}

function sleepQualityLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "not set";
  if (n >= 8) return "strong";
  if (n >= 6) return "okay";
  if (n >= 4) return "low";
  return "very low";
}

function average(values = []) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function buildBiometricHistory(logsByDate = {}) {
  return Object.entries(logsByDate || {})
    .map(([dateKey, log]) => {
      const sleepScore = Number(log?.sleepScore);
      const stressScore = normalizeBiometricLevelToScore(log?.stressLevel);
      const activityScore = normalizeBiometricLevelToScore(log?.activityLevel);
      if (!Number.isFinite(sleepScore) && stressScore === null && activityScore === null) return null;
      return {
        dateKey,
        sleepScore: Number.isFinite(sleepScore) ? sleepScore : null,
        stressScore,
        activityScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function buildBiometricInsightSignals({
  logsByDate = {},
  today = new Date(),
  phase = null,
  dayOfCycle = null,
} = {}) {
  const history = buildBiometricHistory(logsByDate);
  if (!history.length) return [];

  const todayKey = toDateKey(today);
  const recentStart = addDaysStr(todayKey, -13);
  const recent = history.filter((entry) => entry.dateKey >= recentStart && entry.dateKey <= todayKey);
  if (!recent.length) return [];

  const latest = recent[recent.length - 1];
  const sleepValues = recent.map((entry) => entry.sleepScore).filter((value) => value !== null);
  const stressValues = recent.map((entry) => entry.stressScore).filter((value) => value !== null);
  const activityValues = recent.map((entry) => entry.activityScore).filter((value) => value !== null);
  const avgSleep = average(sleepValues);
  const avgStress = average(stressValues);
  const avgActivity = average(activityValues);
  const lowSleepDays = sleepValues.filter((value) => value <= 5).length;
  const highStressDays = stressValues.filter((value) => value >= 3).length;
  const lowActivityDays = activityValues.filter((value) => value <= 1).length;
  const timingBits = [
    phase ? `${formatPhaseLabelForInsight(phase)} phase` : "",
    Number.isFinite(Number(dayOfCycle)) ? `cycle day ${Number(dayOfCycle)}` : "",
  ].filter(Boolean);

  const signals = [];

  if (
    avgStress !== null &&
    avgSleep !== null &&
    (avgStress >= 2.75 || highStressDays >= 2) &&
    (avgSleep <= 5.5 || lowSleepDays >= 2)
  ) {
    signals.push({
      code: "BIOMETRIC_STRESS_SLEEP_LOAD",
      title: "Stress and sleep are both elevated signals",
      level: avgStress >= 3.25 && avgSleep <= 4.5 ? "medium" : "low",
      show: true,
      summary: `Recent logs show ${biometricLevelLabel(avgStress)} stress with ${sleepQualityLabel(avgSleep)} sleep.`,
      details: [
        `Recent window: ${recent.length} biometric log${recent.length !== 1 ? "s" : ""}`,
        `Average sleep: ${avgSleep.toFixed(1)}/10`,
        `Stress pattern: ${highStressDays} high-stress day${highStressDays === 1 ? "" : "s"}`,
        timingBits.length ? `Timing: ${timingBits.join(" | ")}` : "Timing: recent cycle context",
      ],
      guidance: "Keep logging sleep and stress with symptoms so Bloom can tell whether low-rest days line up with cycle changes.",
      debug: { avgSleep, avgStress, lowSleepDays, highStressDays, latestDateKey: latest.dateKey },
    });
  }

  if (avgSleep !== null && avgActivity !== null && avgSleep <= 5.5 && (avgActivity <= 1.75 || lowActivityDays >= 2)) {
    signals.push({
      code: "BIOMETRIC_LOW_RECOVERY_LOAD",
      title: "Recovery looks lower recently",
      level: avgSleep <= 4.5 && avgActivity <= 1.5 ? "medium" : "low",
      show: true,
      summary: "Sleep and activity logs suggest a lower-recovery stretch.",
      details: [
        `Average sleep: ${avgSleep.toFixed(1)}/10`,
        `Activity pattern: ${biometricLevelLabel(avgActivity)}`,
        `Low-activity days: ${lowActivityDays}`,
        timingBits.length ? `Timing: ${timingBits.join(" | ")}` : "Timing: recent cycle context",
      ],
      guidance: "If symptoms feel stronger during lower-recovery days, log both together so Bloom can connect the pattern.",
      debug: { avgSleep, avgActivity, lowActivityDays, latestDateKey: latest.dateKey },
    });
  }

  if (avgStress !== null && avgActivity !== null && avgStress >= 2.75 && avgActivity <= 2) {
    signals.push({
      code: "BIOMETRIC_ACTIVITY_STRESS_SHIFT",
      title: "Activity dipped while stress was higher",
      level: "low",
      show: true,
      summary: `Recent activity is ${biometricLevelLabel(avgActivity)} while stress is ${biometricLevelLabel(avgStress)}.`,
      details: [
        `Stress pattern: ${biometricLevelLabel(avgStress)}`,
        `Activity pattern: ${biometricLevelLabel(avgActivity)}`,
        `Recent logs used: ${recent.length}`,
      ],
      guidance: "This is useful context for cycle predictions because stress and routine shifts can affect timing and symptoms.",
      debug: { avgStress, avgActivity, latestDateKey: latest.dateKey },
    });
  }

  return signals.slice(0, 2);
}


function toPrettyList(items = [], max = 3) {
  return items.filter(Boolean).slice(0, max).join(", ");
}

function formatPhaseLabelForInsight(phase) {
  const key = String(phase || "").toLowerCase();
  if (!key) return "current";
  if (key === "late_luteal") return "late luteal";
  return key.replace(/_/g, " ");
}

function collectSignalSymptomLabels(debug = {}) {
  const keys = [
    "matchedSymptoms",
    "supportingSymptoms",
    "matched",
    "unexpected",
    "intenseSymptoms",
    "persistingSymptoms",
    "newSymptoms",
    "trendingSymptoms",
    "forecastSymptoms",
  ];

  const labels = [];
  for (const key of keys) {
    const arr = Array.isArray(debug?.[key]) ? debug[key] : [];
    for (const item of arr) {
      const label = friendlySymptomNameFromCode(String(item));
      if (label) labels.push(label);
    }
  }
  return [...new Set(labels)];
}

function extractPrimarySymptomCode(signal = {}) {
  const signalCode = String(signal?.code || "").trim().toUpperCase();
  const personalPrefixes = [
    "PERSONAL_SYMPTOM_RECURRING_",
    "PERSONAL_SYMPTOM_TREND_",
    "PERSONAL_SYMPTOM_RECENT_",
  ];

  for (const prefix of personalPrefixes) {
    if (signalCode.startsWith(prefix)) {
      return signalCode.slice(prefix.length);
    }
  }

  const debug = signal?.debug || {};
  const keys = [
    "matchedSymptoms",
    "supportingSymptoms",
    "matched",
    "unexpected",
    "intenseSymptoms",
    "persistingSymptoms",
    "newSymptoms",
    "trendingSymptoms",
    "forecastSymptoms",
  ];

  for (const key of keys) {
    const arr = Array.isArray(debug?.[key]) ? debug[key] : [];
    if (!arr.length) continue;
    const first = String(arr[0] || "").trim().toUpperCase();
    if (first) return first;
  }

  return "";
}

function buildPhaseSymptomReason(symptomCode, phase) {
  const code = String(symptomCode || "").trim().toUpperCase();
  if (!code) return "";

  const phaseKey = String(phase || "").toLowerCase() === "late_luteal"
    ? "luteal"
    : String(phase || "").toLowerCase();
  const symptom = friendlySymptomNameFromCode(code).toLowerCase();

  const perSymptom = {
    IRRITABILITY: {
      luteal: "Irritability often rises in the luteal phase when progesterone shifts and estrogen drops before a period.",
      menstrual: "During menstruation, lower hormone levels plus discomfort can make irritability feel stronger.",
      any: "Mood symptoms like irritability are commonly linked to hormone shifts across the cycle.",
    },
    MOOD_SWINGS: {
      luteal: "Mood swings are common in the luteal phase as pre-period hormone levels change quickly.",
      menstrual: "Lower estrogen during menstruation can contribute to mood swings for some people.",
      any: "Mood swings can happen when estrogen and progesterone fluctuate across phases.",
    },
    ANXIETY: {
      luteal: "Anxiety can feel stronger in the luteal phase as hormone levels change before bleeding starts.",
      any: "Anxiety symptoms can track with cycle-related hormone fluctuations.",
    },
    CRAMPS: {
      menstrual: "Cramps during menstruation are commonly linked to prostaglandins, which trigger uterine contractions.",
      any: "Pelvic cramping symptoms are often tied to cycle-phase hormone and uterine activity shifts.",
    },
    PELVIC_PAIN: {
      menstrual: "Pelvic pain in the menstrual phase is often related to uterine contractions and inflammation signals.",
      ovulation: "Mid-cycle pelvic pain can happen around ovulation when the ovary releases an egg.",
      any: "Pelvic pain can vary by phase and is often linked to ovulation or menstrual changes.",
    },
    BREAST_TENDERNESS: {
      luteal: "Breast tenderness is common in the luteal phase because progesterone changes can increase tissue sensitivity.",
      any: "Breast tenderness often follows hormone shifts, especially in the second half of the cycle.",
    },
    BLOATING: {
      luteal: "Bloating is common in the luteal phase when progesterone can slow digestion and increase fluid retention.",
      menstrual: "Bloating around menstruation is often related to inflammatory signaling and fluid shifts.",
      any: "Bloating can increase with hormone-driven digestion and fluid changes across the cycle.",
    },
    NAUSEA: {
      menstrual: "Nausea around a period can happen when prostaglandin activity is higher during bleeding.",
      luteal: "Some people notice nausea in the luteal phase during pre-period hormone changes.",
      any: "Nausea can be cycle-related when hormone and inflammation signals shift.",
    },
    HEARTBURN: {
      luteal: "Heartburn may feel worse in the luteal phase because progesterone can relax the esophageal sphincter and slow digestion.",
      any: "Digestive symptoms like heartburn can be amplified by hormone-related gut motility changes.",
    },
    HEADACHE: {
      luteal: "Headaches often increase near the end of the luteal phase as estrogen drops before a period.",
      menstrual: "Period headaches are commonly linked to lower estrogen and inflammatory signaling.",
      any: "Cycle-related headaches are often associated with estrogen fluctuations.",
    },
    FATIGUE: {
      luteal: "Fatigue can increase in the luteal phase as progesterone rises and sleep quality shifts.",
      menstrual: "Fatigue during menstruation can be linked to bleeding, inflammation, and lower energy reserves.",
      any: "Energy changes across the cycle are common and often hormone-related.",
    },
    INSOMNIA: {
      luteal: "Sleep can become lighter in the luteal phase because progesterone and body-temperature changes affect sleep quality.",
      any: "Sleep changes are common around hormone transitions in the cycle.",
    },
    DISCHARGE_EGGWHITE: {
      ovulation: "Egg-white discharge is typical near ovulation as estrogen rises and cervical mucus becomes more fertile-type.",
      any: "This discharge pattern is usually linked to estrogen-driven ovulation timing.",
    },
    CERVICAL_MUCUS_CHANGE: {
      ovulation: "Cervical mucus often changes around ovulation due to rising estrogen.",
      follicular: "Mucus texture can shift through the follicular phase as estrogen rises toward ovulation.",
      any: "Cervical mucus changes are strongly tied to normal cycle-phase hormone shifts.",
    },
    INCREASED_LIBIDO: {
      ovulation: "Increased libido is common near ovulation, when estrogen and testosterone are relatively higher.",
      any: "Libido can shift naturally across phases as hormones change.",
    },
    DECREASED_LIBIDO: {
      luteal: "Lower libido is common in the luteal phase when PMS-type symptoms and progesterone shifts are present.",
      any: "Lower libido can happen during phases with stronger hormonal or symptom load.",
    },
    ACNE: {
      luteal: "Acne often flares in the luteal phase as pre-period hormone changes affect oil production.",
      any: "Cycle-related acne is commonly linked to hormonal shifts in the second half of the cycle.",
    },
  };

  const hit = perSymptom[code];
  if (hit) {
    return hit[phaseKey] || hit.any || "";
  }

  const moodCodes = new Set(["DEPRESSION", "CRYING_SPELLS", "STRESSED", "BRAIN_FOG", "POOR_CONCENTRATION"]);
  if (moodCodes.has(code)) {
    if (phaseKey === "luteal") return `Symptoms like ${symptom} can increase in the luteal phase due to pre-period hormone shifts.`;
    return `Symptoms like ${symptom} can track with hormone changes across cycle phases.`;
  }

  const gutCodes = new Set(["CONSTIPATION", "DIARRHEA", "APPETITE_INCREASE", "APPETITE_DECREASE", "CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY", "CRAVING_SPICY"]);
  if (gutCodes.has(code)) {
    if (phaseKey === "luteal") return `In the luteal phase, progesterone and appetite-related hormone shifts can drive ${symptom}.`;
    return `Digestive and appetite symptoms like ${symptom} often vary with cycle-phase hormone changes.`;
  }

  if (phaseKey === "menstrual") {
    return `During the menstrual phase, hormone and prostaglandin changes can contribute to symptoms like ${symptom}.`;
  }
  if (phaseKey === "ovulation") {
    return `Around ovulation, rapid hormone shifts can contribute to symptoms like ${symptom}.`;
  }
  if (phaseKey === "luteal") {
    return `In the luteal phase, pre-period hormone changes can contribute to symptoms like ${symptom}.`;
  }
  if (phaseKey === "follicular") {
    return `In the follicular phase, rising estrogen can influence symptoms like ${symptom}.`;
  }

  return "";
}

function buildPossibleReason(signal, cycle = {}) {
  const code = String(signal?.code || "").toUpperCase();
  const debug = signal?.debug || {};
  const symptomLabels = collectSignalSymptomLabels(debug);
  const symptomList = toPrettyList(symptomLabels, 4);
  const phaseLabel = formatPhaseLabelForInsight(cycle?.phase);
  const primarySymptomCode = extractPrimarySymptomCode(signal);
  const phaseSymptomReason = buildPhaseSymptomReason(primarySymptomCode, cycle?.phase);

  if (code === "LATE_PERIOD") {
    return "Your expected period window passed without a new logged period start.";
  }
  if (code === "MISSED_PERIOD") {
    return "Your logs still do not show a period start after the expected window.";
  }
  if (code === "EXTENDED_ABSENCE") {
    return "There has been a longer gap since your last logged period than your pattern usually shows.";
  }
  if (code === "IRREGULAR_CYCLE") {
    return "Recent cycle lengths in your history are varying more than usual, which can shift timing.";
  }
  if (code === "LOW_PREDICTION_CONFIDENCE") {
    return "Recent cycle data is limited or variable, so timing-based predictions are less precise right now.";
  }
  if (code === "LOGGING_GAP") {
    return "Recent logging is sparse, so Bloom has less data to map your pattern.";
  }
  if (code === "LENGTHENING_CYCLE_TREND") {
    return "Your latest cycles are trending longer than your earlier recent cycles.";
  }
  if (code === "SHORTENING_CYCLE_TREND") {
    return "Your latest cycles are trending shorter than your earlier recent cycles.";
  }
  if (code === "SUDDEN_CYCLE_SHIFT") {
    return "Your most recent cycle timing changed noticeably from your earlier baseline.";
  }
  if (code.startsWith("PERSONAL_SYMPTOM_RECURRING_")) {
    if (phaseSymptomReason) return phaseSymptomReason;
    return "This symptom has repeated multiple times in your recent history.";
  }
  if (code.startsWith("PERSONAL_SYMPTOM_TREND_")) {
    if (phaseSymptomReason) return phaseSymptomReason;
    return "This symptom is showing up more often recently than in your previous month of logs.";
  }
  if (code === "PERSONAL_SYMPTOM_MIX_PATTERN") {
    return "You logged several symptom types across multiple recent days, which suggests a personal recurring mix.";
  }
  if (code.startsWith("PERSONAL_SYMPTOM_RECENT_")) {
    if (phaseSymptomReason) return phaseSymptomReason;
    return "This symptom appears in your recent logs and may become clearer as you keep tracking.";
  }

  if (phaseSymptomReason && signal?._source === "symptom") {
    return phaseSymptomReason;
  }

  if (symptomList) {
    if (code === "PHASE_UNEXPECTED_SYMPTOMS") {
      return `Recent logs include ${symptomList}, which is less typical for the ${phaseLabel} phase.`;
    }
    if (code === "SYMPTOM_FORECAST") {
      return "Bloom found similar symptom timing in your earlier cycles around this phase.";
    }
    return `This insight is based on recent logs including ${symptomList}.`;
  }

  if (signal?._source === "symptom") {
    return `Bloom compared your recent symptom logs with your ${phaseLabel} phase context.`;
  }

  return "";
}

function buildLateNoticeBanner(signal) {
  if (!signal) return "";
  const code = String(signal.code || "").toUpperCase();
  const debug = signal.debug || {};
  const isIrregular = Boolean(debug.irregular);

  let title = "Health notice - Period may be late";
  let body = "Bloom noticed your period has not started yet based on your logged cycle timing.";

  if (code === "MISSED_PERIOD") {
    title = "Health notice - Period appears overdue";
    body = "Bloom noticed your expected period still has not started based on your logged cycle dates.";
  } else if (code === "EXTENDED_ABSENCE") {
    title = "Health notice - Longer gap since last period";
    body = "Bloom noticed a longer-than-usual gap since your last logged period start.";
  }

  const variabilityLine = isIrregular
    ? "Your recent cycle lengths have also been more variable, which can shift exact timing."
    : "";

  return `
    <div style="background:#fff8e7;border:1px solid #f5c842;border-left:3px solid #f59e0b;border-radius:12px;padding:0.85rem 1rem;margin-bottom:0.85rem;">
      <div style="font-size:0.95rem;font-weight:800;color:#91610a;margin-bottom:0.35rem;">${title}</div>
      <div style="font-size:0.9rem;line-height:1.55;color:#5d4a1f;">
        ${body} ${variabilityLine} Keep tracking, and if this feels unusual for your body, consider taking a pregnancy test at the right time and checking in with a healthcare professional.
      </div>
    </div>
  `;
}

function humanizeCrossEngineNote(note) {
  const raw = String(note || "").trim();
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (lower.includes("low_cycle_prediction_confidence")) {
    return "Forecast-style symptom predictions are paused right now because cycle confidence is still low. More consistent logs will unlock better forecasting.";
  }
  if (lower.includes("missed_period_detected")) {
    return "Bloom paused forecast-style symptom predictions because your period looks delayed, which makes timing-based forecasts less reliable right now.";
  }
  if (lower.includes("extended_absence_detected")) {
    return "Forecast-style symptom predictions are paused because there has been a longer gap since your last logged period, so cycle timing is less certain.";
  }
  if (lower.includes("sudden_cycle_shift_detected")) {
    return "Forecast-style symptom predictions are paused because your recent cycle timing appears to have shifted, and Bloom is recalibrating.";
  }

  return raw.replace(/[_-]+/g, " ");
}

const SIGNAL_PRIORITY = { high: 3, medium: 2, low: 1 };
const SIGNAL_SOURCE_PRIORITY = { symptom: 3, biometric: 3, cycle: 2, anomaly: 1 };
const SIGNAL_SKIP_CODES = new Set(["LOW_PREDICTION_CONFIDENCE", "LOGGING_GAP"]);

function softenSignalText(value) {
  return String(value || "")
    .replace(/\bdetected\b/gi, "noticed")
    .replace(/\bAlert:\s*/gi, "")
    .trim();
}

function normalizeSignalLevel(level) {
  const value = String(level || "low").toLowerCase();
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function signalGuidance(signal) {
  const guidance = String(signal?.guidance || "").trim();
  if (guidance) return softenSignalText(guidance);
  if (normalizeSignalLevel(signal?.level) === "high") {
    return "Track what happens next and consider checking in with a healthcare professional if this feels unusual for your body.";
  }
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function visibleDashboardSignals(signals = []) {
  const seen = new Set();
  return (Array.isArray(signals) ? signals : [])
    .filter((s) => s?.show !== false)
    .filter((s) => !SIGNAL_SKIP_CODES.has(String(s?.code || "").toUpperCase()))
    .filter((s) => !String(s?.code || "").toUpperCase().startsWith("CROSS_ENGINE_NOTE_"))
    .filter((s) => {
      const key = String(s?.code || "").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const byLevel = (SIGNAL_PRIORITY[normalizeSignalLevel(b.level)] || 0) -
        (SIGNAL_PRIORITY[normalizeSignalLevel(a.level)] || 0);
      if (byLevel !== 0) return byLevel;
      return (SIGNAL_SOURCE_PRIORITY[b._source] || 0) - (SIGNAL_SOURCE_PRIORITY[a._source] || 0);
    });
}

function signalCode(signal) {
  return String(signal?.code || "").trim().toUpperCase();
}

function isSymptomInsightSignal(signal) {
  return signal?._source === "symptom" || String(signal?.category || "").toLowerCase() === "symptom";
}

function selectDashboardSignals(signals = []) {
  let visible = visibleDashboardSignals(signals);
  if (visible.some((s) => signalCode(s) === "SYMPTOM_FORECAST")) {
    visible = visible.filter((s) => signalCode(s) !== "PERSONAL_SYMPTOM_FORECAST");
  }

  const selected = [];
  const add = (signal) => {
    if (!signal || selected.length >= 3) return;
    const code = signalCode(signal);
    if (selected.some((existing) => signalCode(existing) === code)) return;
    selected.push(signal);
  };

  visible
    .filter((s) => normalizeSignalLevel(s.level) === "high")
    .forEach(add);

  const symptomSignals = visible.filter(isSymptomInsightSignal);
  const preferredSymptomCodes = [
    "SYMPTOM_FORECAST",
    "PERSONAL_SYMPTOM_FORECAST",
    "PERSONAL_CURRENT_SYMPTOM_CONTEXT",
  ];

  for (const code of preferredSymptomCodes) {
    add(symptomSignals.find((s) => signalCode(s) === code));
  }

  if (!selected.some(isSymptomInsightSignal)) {
    add(symptomSignals.find((s) => {
      const level = normalizeSignalLevel(s.level);
      return level === "medium" || level === "high";
    }) || symptomSignals[0]);
  }

  visible
    .filter((s) => {
      const level = normalizeSignalLevel(s.level);
      return level === "medium" || level === "high";
    })
    .forEach(add);

  visible.forEach(add);
  return selected.slice(0, 3);
}

function renderSignalCard(signal) {
  const level = normalizeSignalLevel(signal?.level);
  const title = escapeHtml(softenSignalText(signal?.title || signalLabel(signal?.code) || "Bloom noticed something"));
  const summary = escapeHtml(softenSignalText(signal?.summary || ""));
  const message = escapeHtml(softenSignalText(signal?.message || ""));
  const guidance = escapeHtml(signalGuidance(signal));
  const details = Array.isArray(signal?.details)
    ? signal.details.map((item) => escapeHtml(softenSignalText(item))).filter(Boolean).slice(0, 4)
    : [];
  const icon = level === "high" ? "!" : "•";
  const detailList = details.length
    ? `<ul class="bloom-signal-details">${details.map((item) => `<li>${item}</li>`).join("")}</ul>`
    : "";
  const hiddenGuidance = guidance && level !== "high"
    ? `<div class="bloom-signal-guidance bloom-signal-guidance--inside">${guidance}</div>`
    : "";
  const expandable = detailList || hiddenGuidance
    ? `
      <details class="bloom-signal-more">
        <summary>View details</summary>
        <div class="bloom-signal-more-body">
          ${detailList}
          ${hiddenGuidance}
        </div>
      </details>`
    : "";

  return `
    <article class="bloom-signal-card bloom-signal-card--${level}">
      <div class="bloom-signal-heading">
        <span class="bloom-signal-icon" aria-hidden="true">${icon}</span>
        <span>${title}</span>
      </div>
      ${summary ? `<div class="bloom-signal-summary">${summary}</div>` : ""}
      ${!summary && message ? `<div class="bloom-signal-message">${message}</div>` : ""}
      ${expandable}
      ${level === "high" && guidance ? `<div class="bloom-signal-guidance">${guidance}</div>` : ""}
    </article>
  `;
}

function renderAdvancedInsights(advancedEl, { cycle, cycleLengths, lastPeriodStart, lastLogDate, logsByDate, mlPredictedCycleLength }) {
  if (!advancedEl) return;
  const customInsightsHtml = renderCustomSymptomAdvancedInsights(logsByDate, new Date());

  const signals = [];
  const symptomHistoryForInsights = buildEngineSymptomHistory(logsByDate);

  const today          = new Date();
  const lastPeriodDate = lastPeriodStart ? new Date(lastPeriodStart + "T00:00:00") : null;
  const lastLogDateObj = lastLogDate     ? new Date(lastLogDate     + "T00:00:00") : null;
  const expectedStart = cycle.periodPrediction?.status === "overdue"
    ? cycle.periodPrediction.predictedStart
    : cycle.nextPeriodDate;
  const expectedEnd = cycle.periodPrediction?.status === "overdue"
    ? (cycle.periodPrediction.predictedEnd || addDaysStr(cycle.periodPrediction.predictedStart, 5))
    : (cycle.nextPeriodDate ? addDaysStr(cycle.nextPeriodDate, 5) : null);
  const nextWindow = expectedStart ? {
    start: new Date(expectedStart + "T00:00:00"),
    end:   new Date(expectedEnd + "T00:00:00"),
  } : null;
  const ENGINE_PHASE_MAP = { late_luteal: "luteal", ovulatory: "ovulation" };
  const enginePhase = ENGINE_PHASE_MAP[cycle.phase] ?? cycle.phase;

  const biometricSignals = buildBiometricInsightSignals({
    logsByDate,
    today,
    phase: enginePhase,
    dayOfCycle: cycle.dayInCycle,
  });
  signals.push(...biometricSignals.map((s) => ({ ...s, _source: "biometric" })));

  // Cycle engine
  if (algoCycleEngine) {
    try {
      const cycleSignals = algoCycleEngine.generateCycleSignals({
        expectedNextPeriodWindow: nextWindow,
        today,
        lastPeriodStart: lastPeriodDate,
        lastLogDate:     lastLogDateObj,
        cycleLengths,
      });
      signals.push(...(cycleSignals || []).map((s) => ({ ...s, _source: "cycle" })));

      // Pulled from bloomie-recovery: include advanced cycle-pattern signals
      // (menorrhagia/oligomenorrhea/etc.) so advanced insights are not limited
      // to only timing-window signals.
      if (typeof algoCycleEngine.generateAdvancedInsights === "function") {
        const { periodEntries, unscheduledBleedingDates } = buildPeriodInsightInputs(logsByDate);
        const advCycleResult = algoCycleEngine.generateAdvancedInsights({
          cycleLengths,
          lastPeriodStart: lastPeriodDate,
          today,
          periodEntries,
          unscheduledBleedingDates,
        });
        const advCycleSignals = Array.isArray(advCycleResult?.signals) ? advCycleResult.signals : [];
        const cycleCodes = new Set((cycleSignals || []).map((s) => s?.code));
        const filtered = advCycleSignals.filter(
          (s) => !(s?.code === "AMENORRHEA_PATTERN" && cycleCodes.has("EXTENDED_ABSENCE"))
        );
        signals.push(...filtered.map((s) => ({ ...s, _source: "cycle" })));
      }
    } catch (e) {
      console.warn("[dashboard] cycle engine error:", e.message);
    }
  }

  // Anomaly engine (requires â‰¥ 4 cycle lengths)
  if (algoAnomalyEngine && cycleLengths.length >= 4) {
    try {
      const anomalyResult = algoAnomalyEngine.generateAnomalySignals({
        actualCycleLengths:   cycleLengths,
        predictedCycleLength: mlPredictedCycleLength,
      });
      signals.push(...(anomalyResult.shownSignals || []).map((s) => ({ ...s, _source: "anomaly" })));
    } catch (e) {
      console.warn("[dashboard] anomaly engine error:", e.message);
    }
  }

  // Symptom engine
  if (algoSymptomEngine && logsByDate) {
    try {
      const latestWithSymptoms = symptomHistoryForInsights.length
        ? symptomHistoryForInsights[symptomHistoryForInsights.length - 1]
        : null;
      const todayKey = toDateKey(today);
      const todayWithSymptoms = symptomHistoryForInsights.find((entry) => entry?.dateKey === todayKey) || null;
      const currentSymptomEntry = todayWithSymptoms || latestWithSymptoms;
      const loggedSymptoms = currentSymptomEntry?.items || [];
      let integratedSignals = null;
      const cycleCount = Math.max((cycle.cycleStarts || []).length, symptomHistoryForInsights.length > 0 ? 2 : 0);

      if (typeof algoSymptomEngine.generateIntegratedSignals === "function") {
        integratedSignals = algoSymptomEngine.generateIntegratedSignals({
          expectedNextPeriodWindow: nextWindow,
          today,
          lastPeriodStart: lastPeriodDate,
          lastLogDate: lastLogDateObj,
          cycleLengths,
          loggedSymptoms,
          phase: enginePhase,
          dayOfCycle: cycle.dayInCycle,
          cycleCount,
          symptomHistory: symptomHistoryForInsights,
        });

        signals.push(...(integratedSignals?.cycleSignals || []).map((s) => ({ ...s, _source: "cycle" })));
        signals.push(...(integratedSignals?.symptomSignals || []).map((s) => ({ ...s, _source: "symptom" })));
      } else {
        const symptomSignals = algoSymptomEngine.generateSymptomSignals({
          loggedSymptoms,
          phase:           enginePhase,
          dayOfCycle:      cycle.dayInCycle,
          cycleLengths,
          cycleCount,
          symptomHistory: symptomHistoryForInsights,
          lastPeriodStart: lastPeriodDate,
          today,
        });
        signals.push(...(symptomSignals || []).map((s) => ({ ...s, _source: "symptom" })));
      }

      if (typeof algoSymptomEngine.generateAdvancedSymptomInsights === "function") {
        const advancedSymptom = algoSymptomEngine.generateAdvancedSymptomInsights({
          loggedSymptoms,
          phase: enginePhase,
          symptomHistory: symptomHistoryForInsights,
        });
        signals.push(...(advancedSymptom?.signals || []).map((s) => ({ ...s, _source: "symptom" })));
      }

      // Personalization fallback: ensure advanced insights can still surface
      // user-specific symptom trends even when strict rule-based signals are sparse.
      const personalized = buildPersonalizedSymptomSignals({
        symptomHistory: symptomHistoryForInsights,
        today,
        currentEntry: currentSymptomEntry,
        phase: enginePhase,
        dayOfCycle: cycle.dayInCycle,
      });
      signals.push(...personalized.map((s) => ({ ...s, _source: "symptom" })));

      // Cross-engine notes from bloom-symptom-engine:
      // adds low-priority context when cycle and symptom engines agree.
      if (integratedSignals) {
        const crossNotes = Array.isArray(integratedSignals?.crossValidatedNotes)
          ? integratedSignals.crossValidatedNotes
          : [];
        crossNotes.slice(0, 2).forEach((note, idx) => {
          const pretty = humanizeCrossEngineNote(note);
          if (!pretty) return;
          signals.push({
            code: `CROSS_ENGINE_NOTE_${idx}`,
            level: "low",
            show: true,
            title: "Combined pattern insight",
            message: pretty,
            _source: "symptom",
          });
        });
      }
    } catch (e) {
      console.warn("[dashboard] symptom engine error:", e.message);
    }
  }

  // â”€â”€ Basic avg-cycle outlier flags (all goals) â”€â”€
  if (
    cycle.avgCycleLength &&
    cycle.avgCycleLength < 21 &&
    !signals.some((s) => s.code === "SHORT_CYCLE" || s.code === "POLYMENORRHEA_PATTERN")
  ) {
    signals.push({
      code: "SHORT_CYCLE",
      level: "medium",
      show: true,
      summary: "Your average cycle is shorter than the usual tracking range.",
      details: [
        `Average cycle: ${cycle.avgCycleLength} days`,
        "Pattern: shorter cycle timing",
      ],
      guidance: "Keep logging start dates so Bloom can confirm whether this is consistent before you raise it with a provider.",
      _source: "cycle",
    });
  }
  if (
    cycle.avgCycleLength &&
    cycle.avgCycleLength > 35 &&
    !signals.some((s) => s.code === "LONG_CYCLE" || s.code === "OLIGOMENORRHEA_PATTERN")
  ) {
    signals.push({
      code: "LONG_CYCLE",
      level: "medium",
      show: true,
      summary: "Your average cycle is running longer than the usual tracking range.",
      details: [
        `Average cycle: ${cycle.avgCycleLength} days`,
        "Pattern: longer cycle timing",
      ],
      guidance: "Keep logging start dates so Bloom can confirm whether this is consistent before you raise it with a provider.",
      _source: "cycle",
    });
  }

  if (!signals.length) {
    advancedEl.innerHTML = customInsightsHtml || `<div class="adv-insight-empty">Keep logging daily - patterns will surface here as your data builds up.</div>`;
    return;
  }

  const dashboardSignals = selectDashboardSignals(signals);
  if (!dashboardSignals.length) {
    advancedEl.innerHTML = customInsightsHtml || `<div class="adv-insight-empty">Keep logging daily - patterns will surface here as your data builds up.</div>`;
    return;
  }
  const signalHtml = dashboardSignals.length
    ? `<div class="bloom-signal-list">${dashboardSignals.map(renderSignalCard).join("")}</div>`
    : "";

  advancedEl.innerHTML = signalHtml + (customInsightsHtml || "");
}

// â”€â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadDashboard() {
  const goal = getUserGoal();
  const loadEpoch = ++_dashboardLoadEpoch;
  applyGoalClasses(goal);
  // â”€â”€ Age-lock gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Try to Conceive, Track Pregnancy, and Track Perimenopause are 18+ goals.
  // If the user is under 18 and somehow reaches one, show a graceful locked state.
  if (isGoalAgeLocked(goal)) {
    const goalNames = { ttc: "Try to Conceive", pregnancy: "Track Pregnancy", perimenopause: "Track Perimenopause" };
    const goalName = goalNames[goal] || "this goal";
    const main = document.querySelector("main") || document.body;
    main.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:60vh;padding:2rem;text-align:center;gap:1rem;
      ">
        <div style="
          width:64px;height:64px;border-radius:50%;
          background:var(--color-primary-light,#fce4ec);
          display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary,#e91e63)" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 style="margin:0;font-size:1.4rem;color:var(--color-text);">${goalName}</h2>
        <p style="margin:0;color:var(--color-text-muted);max-width:340px;line-height:1.6;font-size:0.95rem;">
          This goal is available to users aged 18 and older. You can switch to a different goal from your profile.
        </p>
        <a href="/pages/profile.html" class="btn btn-primary" style="margin-top:0.5rem;">Change goal</a>
      </div>`;
    return;
  }

  // Load modules and logs in parallel so initial dashboard work starts sooner.
  const needsPregnancyAlgo = goal === "pregnancy" || goal === "ttc";
  const moduleImportsPromise = Promise.all([
    needsPregnancyAlgo
      ? import("./algorithms/pregnancyAlgorithm.js").catch(() => null)
      : Promise.resolve(null),
    import("./algorithms/bloom-cycle-engine.js").catch(() => null),
    import("./algorithms/bloom-symptom-engine.js").catch(() => null),
    import("./algorithms/bloom-anomaly-engine.js").catch(() => null),
  ]);

  const logsByDate = await ensureLogsPromise();
  if (loadEpoch !== _dashboardLoadEpoch) return;
  const cycle = buildCycleBase(logsByDate);

  // Derived cycle history
  const cycleStarts = cycle.cycleStarts || [];
  const cycleLengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    cycleLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }
  const lastPeriodStart = cycleStarts.length ? cycleStarts[cycleStarts.length - 1] : null;

  // â”€â”€ Cycle state: backend when signed in, local rule-based otherwise â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // fetchCycleState always returns at least a local estimate when period data exists,
  // so the dashboard degrades gracefully to a low-confidence prediction rather than
  // showing nothing when the backend is unavailable or the user is in anon mode.
  let predictedCycleLength = null;
  if (lastPeriodStart) {
    _cycleStatePromise = fetchCycleState(logsByDate);
  } else {
    _cycleStatePromise = Promise.resolve(null);
  }

  // First paint: show the top cards immediately with baseline values so the
  // dashboard feels responsive while cycle-state is still resolving.
  const earlyGoalBadge = document.getElementById("goal-badge");
  const earlyGoalDescEl = document.getElementById("goal-desc");
  if (earlyGoalBadge) earlyGoalBadge.textContent = goalLabel(goal);
  if (earlyGoalDescEl) earlyGoalDescEl.textContent = goalDesc(goal);

  const earlySnapshotEl = document.getElementById("cycle-snapshot");
  if (earlySnapshotEl && !cycle.dayInCycle) {
    earlySnapshotEl.innerHTML = `
      <div class="stat-number">-</div>
      <p class="text-muted">Loading your cycle snapshot...</p>
    `;
  }

  const waitForBackendPhase = !isAnonMode() && !!lastPeriodStart;
  const earlyCycleForPhaseCard = waitForBackendPhase
    ? { ...cycle, phase: "unknown", phaseLabel: null, confidence: null }
    : cycle;
  const earlyCycleForGoalCard = waitForBackendPhase
    ? { ...cycle, nextPeriodDate: null, fertileStart: null, fertileEnd: null, ovulationDate: null }
    : cycle;

  renderPhaseCard(earlyCycleForPhaseCard, () => {});
  renderGoalToolCard(goal, earlyCycleForGoalCard);

  let hasResolvedBackendState = false;
  if (lastPeriodStart) {
    const state = await _cycleStatePromise;
    if (loadEpoch !== _dashboardLoadEpoch) return;
    if (state?.ready) {
      hasResolvedBackendState = true;
      cycle.phase          = state.phase          ?? cycle.phase;
      cycle.phaseLabel     = state.phaseLabel      ?? null;
      cycle.source         = state.source          ?? "backend";
      // confidence may be an object {level,message} (local) or a string (old path)
      const confidenceObj = typeof state.confidence === "object"
        ? state.confidence
        : { level: state.confidence, message: "" };
      const confLevel = confidenceObj?.level?.toLowerCase();
      cycle.confidence = confLevel ?? cycle.confidence;
      cycle.confidenceMessage = String(confidenceObj?.message || "").trim();
      cycle.dayInCycle     = state.dayInCycle      ?? cycle.dayInCycle;
      cycle.avgCycleLength = state.avgCycleLength  ?? cycle.avgCycleLength;
      predictedCycleLength = state.predictedCycleLength ?? null;
      cycle.nextPeriodDate = state.nextPeriodDate ?? null;
      cycle.periodPrediction = state.periodPrediction ?? null;
      cycle.ovulationDate  = state.ovulationDate ?? null;
      cycle.fertileStart   = state.fertileStart ?? null;
      cycle.fertileEnd     = state.fertileEnd ?? null;
      if (state.futureCycles?.length) cycle.futureCycles = state.futureCycles;
      if (state.source === "local") {
        console.log("[dashboard] using local fallback state = backend unavailable or anon mode");
      }
    }

    // FutureCycles resolution is now handled centrally in cycle-state.js
    // (_resolveFutureCycles runs on every fetchCycleState result before caching).
  }

  if (waitForBackendPhase && !hasResolvedBackendState) {
    cycle.phase = "unknown";
    cycle.phaseLabel = null;
  }

  const goalBadge = document.getElementById("goal-badge");
  const goalDescEl = document.getElementById("goal-desc");
  if (goalBadge) goalBadge.textContent = goalLabel(goal);
  if (goalDescEl) goalDescEl.textContent = goalDesc(goal);

  // Cycle snapshot
  const snapshotEl = document.getElementById("cycle-snapshot");
  if (snapshotEl) {
    if (cycle.dayInCycle) {
      const confNorm = (cycle.confidence || "low").toLowerCase();
      const confCls = confNorm === "high" ? "conf-high" : confNorm === "medium" ? "conf-medium" : "conf-low";
      const confLabel = confNorm.charAt(0).toUpperCase() + confNorm.slice(1);
      snapshotEl.innerHTML = `
        <div class="stat-number">Day ${cycle.dayInCycle}</div>
        <p class="muted-line">
          ${cycle.avgCycleLength ? `Avg cycle: ${cycle.avgCycleLength} days` : ""}
          &nbsp;|&nbsp;<span class="fertility-conf ${confCls}">${confLabel} confidence</span>
        </p>
      `;
    } else {
      snapshotEl.innerHTML = `
        <div class="stat-number">-</div>
        <p class="text-muted">Log a period day in Calendar to view your cycle day.</p>
      `;
    }
  }

  const applyPhaseFeedbackToInsights = () => {
    const phaseForInsight = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : "unknown";
    const phaseLabelForInsight = cycle.phaseLabel;
    const todaySymptoms = (logsByDate[toDateKey(new Date())]?.symptoms) || [];
    setTodayInsights(phaseForInsight, goal, phaseLabelForInsight, todaySymptoms);
  };

  renderPhaseCard(cycle, applyPhaseFeedbackToInsights);
  renderGoalToolCard(goal, cycle);
  triggerNotifications(cycle, logsByDate);

  applyPhaseFeedbackToInsights();

  // Anon mode: hide advanced features quickly (without waiting for deferred work)
  if (isAnonMode()) {
    const advCard = document.getElementById("advanced-insights")?.closest(".card");
    if (advCard) {
      advCard.innerHTML = `
        <div style="text-align:center;padding:1.5rem 1rem;">
          <div style="font-size:1rem;font-weight:800;margin-bottom:0.5rem;">Locked</div>
          <p style="font-weight:700;color:var(--color-primary-dark);margin:0 0 0.35rem;">Advanced Insights</p>
          <p style="font-size:0.88rem;color:var(--color-text-muted);margin:0 0 1rem;">Create a free account to unlock cycle predictions, personalised insights, and health reports.</p>
          <a href="/pages/register.html" class="btn btn-primary btn-sm">Create account</a>
        </div>`;
    }
    const pdfBtn = document.getElementById("export-pdf");
    if (pdfBtn) pdfBtn.style.display = "none";
  }

  // PDF export - generate and download directly without leaving the page
  const pdfBtn = document.getElementById("export-pdf");
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      pdfBtn.disabled = true;
      const prev = pdfBtn.textContent;
      pdfBtn.textContent = "Generating...";
      try {
        const [{ generatePDF }, { buildReportData }] = await Promise.all([
          import("./pdf-generator.js"),
          import("./pdf-report-data.js"),
        ]);
        const userName = localStorage.getItem("bloom_user_name") ?? null;
        const data = buildReportData(logsByDate, cycle, userName);
        if (!data.cyclesTracked) {
          showToast("No cycle history yet. Log period days in the Calendar first.", "error");
          return;
        }
        generatePDF(data);
      } catch (e) {
        console.error("[export-pdf]", e);
        showToast("Could not generate PDF. Please try again.", "error");
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.textContent = prev;
      }
    };
  }

  // Defer heavier sections so the top cards paint first.
  afterFirstPaint(async () => {
    if (loadEpoch !== _dashboardLoadEpoch) return;

    [algoPregnancy, algoCycleEngine, algoSymptomEngine, algoAnomalyEngine] =
      await moduleImportsPromise;
    if (loadEpoch !== _dashboardLoadEpoch) return;

    renderTtcTools(goal, cycle, logsByDate);
    renderFactsSlideshow(goal);
    renderPregnancyTools(goal, logsByDate);
    await renderSymptomTools(goal, logsByDate, cycle);

    // Chart + advanced insights are the heaviest; run them after another paint.
    afterFirstPaint(async () => {
      if (loadEpoch !== _dashboardLoadEpoch) return;

      try {
        await renderCycleHistoryAndChart(cycle, logsByDate);
      } catch (e) {
        console.warn("[dashboard] cycle chart render failed:", e?.message || e);
      }

      const allLogDates = Object.keys(logsByDate)
        .filter(k => { const l = logsByDate[k]; return l?.flow || l?.symptoms?.length || l?.notes; })
        .sort();
      const lastLogDate = allLogDates.length ? allLogDates[allLogDates.length - 1] : null;

      renderAdvancedInsights(document.getElementById("advanced-insights"), {
        cycle, cycleLengths, lastPeriodStart, lastLogDate,
        logsByDate,
        mlPredictedCycleLength: predictedCycleLength,
      });
    });
  });
}


onAuthChange(() => {
  // Auth state may resolve after initial script execution. Reset bootstrap
  // promises so account mode does not reuse an early empty logs fetch.
  resetDashboardDataPromises();
  loadDashboard();
});
