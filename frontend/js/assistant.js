import { normalizePatois, detectPatois, detectUserTone, fuzzyCorrect, collapseRepeatedLetters, expandShorthand } from "./bloomie-patois.js";
import { resolveTone, applyToneToLines, applyToneToChoices } from "./bloomie-tone.js";
import { extractEntities, inferRoute, summarizeEntities, extractUrgency, SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS, detectDownplaying, detectAmbiguousInput, detectContradiction, detectMissingContext, checkCumulativeRisk } from "./bloomie-inference.js";
import { buildGuidanceResponse, getStructuredSummary, getToneOpener, getPhaseInsight, CONCERN_PRIORITY } from "./bloomie-templates.js";
import { loadBloomieMemory, saveBloomieMemory, loadLocalBloomieMemory, saveLocalBloomieMemory, loadUserProfile } from "./db.js";
import { pick, detectOutOfScope, resolveOOSFollowUp, scoreSignals, resolveSignals, computeRouteConfidence, resolveChoiceByIntent, classifyNodeQuestion, detectReportedCondition, detectConditionManagementQuestion, detectConditionSymptomQuestion, CONDITION_META, CONDITION_ALIASES, extractConditionKey, scoreVagueHealth } from "./bloomie-routing.js";
import { resolveIntentAssist, classifyRepairClarification, extractMultiIntentTags } from "./bloomie-intent.js";
import { extractSignalsAI }   from "./bloomie-extract.js";
import { createCtx } from "./bloomie-session.js";
import { logSafetyEvent, logAnalyticsEvent, bloomieDebug } from "./bloomie-logger.js";
import { getIdToken, getUser } from "./auth.js";
import { generateIntegratedSignals, getBloomieSymptomContext } from "./algorithms/bloom-symptom-engine.js";
import { generateAnomalySignals } from "./algorithms/bloom-anomaly-engine.js";
import { parseNaturalDate, validateCycleDate, validateCalendarDate, computePhaseConfidence } from "./algorithms/bloom-date-utils.js";
import { whenToTest as pregnancyWhenToTest, estimatedDueDate as pregnancyEstimatedDueDate } from "./algorithms/pregnancyAlgorithm.js";
import { createOOS } from "./bloomie-oos.js";
import { createNodes } from "./bloomie-nodes.js";
import { sanitizeInput, classifyInputSafety, sanitizeBotLine, authorizeHtmlPayload, isHtmlPayloadAuthorized } from "./bloomie-safety.js";
import { buildSignalBoard, scoreInterpretationBoard, scoreInterpretations, selectResponseStrategy } from "./bloomie-reasoning.js";
import { buildPolicyContext, evaluatePolicyDecision, sanitizeMinorEnglishLine } from "./bloomie-policy.js";
import { isBloomieDebugEnabled } from "./bloom-storage.js";
import {
  buildEmotionalFollowUp,
  buildFollowUpQuestion,
  buildMiniReplay,
  buildSoftContinuePrompt,
  buildTinyWinLine,
  detectHiddenConcern,
  detectTinyWin,
  maybeBuildRealityCheckPrefix,
  shouldAddSoftContinue,
  shouldAskFollowUp,
  shouldUseMiniReplay,
  softenEscalationLine,
} from "./bloomie-response-layers.js";

// ── Mood anomaly context ────────────────────────────────────────────────────
// Combines cycle-timing anomaly (from bloom-anomaly-engine) with a
// symptom-severity deviation check (computed from symptomHistory).
// Returns { cycleAnomaly: Signal|null, severitySpike: boolean, level: "none"|"medium"|"high" }
// Called once at mount; result stored on ctx.bloomieAnomalyCtx.
const MOOD_CATALOG_CODES = new Set([
  "MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "DEPRESSION", "CRYING_SPELLS", "FATIGUE",
]);
const SEVERITY_SPIKE_THRESHOLD = 1.2; // must exceed historical avg by this many points (1–5 scale)
const SEVERITY_MIN_ENTRIES = 3;       // need at least this many history entries to baseline

function computeMoodAnomalyCtx(cycleLengths = [], symptomHistory = []) {
  // 1. Cycle-timing anomaly from the anomaly engine
  let cycleAnomaly = null;
  if (cycleLengths.length >= 4) {
    try {
      const result = generateAnomalySignals({ actualCycleLengths: cycleLengths });
      const top = result?.topSignal;
      if (top?.show && (top.level === "medium" || top.level === "high")) {
        cycleAnomaly = top;
      }
    } catch {
      // anomaly engine errors should never surface to the user
    }
  }

  // 2. Symptom severity deviation for mood-related codes
  // Partition history: baseline = all but most recent entry, recent = last entry
  let severitySpike = false;
  if (Array.isArray(symptomHistory) && symptomHistory.length >= SEVERITY_MIN_ENTRIES) {
    const sorted = [...symptomHistory].sort((a, b) =>
      a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0
    );
    const baseline = sorted.slice(0, -1);
    const recent   = sorted[sorted.length - 1];

    // Average severity of mood codes across baseline entries
    const baselineSeverities = [];
    for (const entry of baseline) {
      for (const item of entry.items ?? []) {
        if (MOOD_CATALOG_CODES.has(item.code) && typeof item.severity === "number") {
          baselineSeverities.push(item.severity);
        }
      }
    }

    // Recent entry mood severities
    const recentSeverities = (recent.items ?? [])
      .filter(item => MOOD_CATALOG_CODES.has(item.code) && typeof item.severity === "number")
      .map(item => item.severity);

    if (baselineSeverities.length >= 2 && recentSeverities.length > 0) {
      const avgBaseline = baselineSeverities.reduce((a, b) => a + b, 0) / baselineSeverities.length;
      const avgRecent   = recentSeverities.reduce((a, b) => a + b, 0) / recentSeverities.length;
      if (avgRecent - avgBaseline >= SEVERITY_SPIKE_THRESHOLD) {
        severitySpike = true;
      }
    }
  }

  // 3. Derive overall level for gating in nodes
  const cycleLevel = cycleAnomaly?.level ?? "none";
  const level = cycleLevel === "high" || (cycleLevel === "medium" && severitySpike)
    ? "high"
    : cycleLevel === "medium" || severitySpike
    ? "medium"
    : "none";

  return { cycleAnomaly, severitySpike, level };
}

/* ------------------ PAGE UI ------------------ */
export function Chat() {
  return `
    <section class="bloomie">
      <div class="bloomie-shell">
        <div class="bloomie-card">
          <div class="chat-head">
            <div>
              <h2>Bloomie Chat</h2>
              <p class="muted">Type a message or use the buttons 🩷</p>
            </div>
          </div>

          <div class="chat-box" id="chat-box" aria-live="polite"></div>

          <form class="chat-form" id="chat-form">
            <input
              class="chat-input"
              id="chat-input"
              placeholder="Use the buttons below…"
              autocomplete="off"
            />
          </form>

          <p class="tiny-note tiny-note--bloomie">
            NOTE: Bloom is not a diagnostic tool.
          </p>
        </div>
      </div>
    </section>
  `;
}

export async function mountChat(
  user = null,
  cycleData = null,
  symptomHistory = null,
  { isMinor = false, isAnon = false, policySeed = null } = {}
) {
  const box = document.getElementById("chat-box");
  if (!box) return;

  // Load persistent memory and user profile in parallel before mounting.
  const [bloomieMemory, profile] = await Promise.all([
    isAnon ? Promise.resolve(null) : loadBloomieMemory(),
    isAnon ? Promise.resolve({ nickname: null }) : loadUserProfile(),
  ]);

  initBloomieChat({
    userName: user?.nickname || user?.displayName || null,
    cycleData,
    symptomHistory,
    bloomieMemory,
    isMinor,
    isAnon,
    policySeed,
    profile,
    onSaveMemory: saveBloomieMemory,
    onOpenCareMap: () => {
      window.location.href = "/pages/clinics.html?autolocate=true";
    },
    onRequestPdf: async (summaryText) => {
  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });

    const M   = 18;
    const CW  = 210 - M * 2;
    const C   = { primary: [212, 116, 154], text: [42, 24, 44], muted: [138, 108, 138] };

    // Header bar
    doc.setFillColor(...C.primary);
    doc.rect(0, 0, 210, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Bloom – Chat Summary", M, 14);

    doc.setTextColor(...C.muted);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Not a diagnosis. For educational reference only.", M, 19);

    // Body text
    doc.setTextColor(...C.text);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(summaryText, CW);
    doc.text(lines, M, 32);

    // Footer
    const footerY = 285;
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.4);
    doc.line(M, footerY - 3, 210 - M, footerY - 3);
    doc.setTextColor(...C.muted);
    doc.setFontSize(7);
    doc.text("Bloom is not a medical tool. Always consult a qualified healthcare provider.", M, footerY);

    doc.save(`bloom-chat-summary-${new Date().toISOString().slice(0,10)}.pdf`);
  } catch (err) {
    console.error("PDF export failed:", err);
    alert("PDF export failed. Please try again.");
  }
},
  });
}

/* ------------------ CHAT ENGINE ------------------ */
export function initBloomieChat({
  chatBoxId = "chat-box",
  inputId = "chat-input",
  formId = "chat-form",
  userName = null,
  cycleData = null,
  // Array of symptom log entries from Firestore (last ~30–60 days).
  // Shape: [{ dateKey: "YYYY-MM-DD", items: [{ code, severity, note }] }, ...]
  // Pass this from dashboard when mounting so Bloomie can reference log history.
  symptomHistory = null,
  bloomieMemory = null,
  onSaveMemory = null,
  onOpenCareMap = () => { window.location.href = "/pages/clinics.html?autolocate=true"; },
  onRequestPdf = (summaryText) => console.log("PDF requested:", summaryText),
  onLogAction = (action, data) => console.log("Log action:", action, data),
  isMinor = false,
  isAnon = false,
  policySeed = null,
  profile = null,
} = {}) {
  const $box = document.getElementById(chatBoxId);
  const $input = document.getElementById(inputId);
  const $form = document.getElementById(formId);

  if (!$box) throw new Error(`Missing #${chatBoxId}`);

  const CHAT_PREFS_KEY = "bloom_chat_prefs";
  const BLOOMIE_REMINDERS_KEY = "bloomie_scheduled_reminders";
  const REMINDER_POLL_MS = 30 * 1000;

  function loadChatPrefs() {
    try {
      return JSON.parse(localStorage.getItem(CHAT_PREFS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function isSoundEnabled() {
    const p = loadChatPrefs();
    return p.soundEnabled !== false;
  }

  function isVoicePlaybackEnabled() {
    const p = loadChatPrefs();
    return p.voicePlaybackEnabled === true;
  }

  function playChatCue() {
    if (!isSoundEnabled()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ac = new Ctx();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = 720;
      g.gain.value = 0.00001;
      o.connect(g);
      g.connect(ac.destination);
      const now = ac.currentTime;
      g.gain.exponentialRampToValueAtTime(0.045, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.00001, now + 0.17);
      o.start(now);
      o.stop(now + 0.2);
    } catch {
      // best-effort only
    }
  }

  function speakBotLine(text) {
    if (!isVoicePlaybackEnabled()) return;
    if (!("speechSynthesis" in window)) return;
    const line = String(text || "").replace(/\s+/g, " ").trim();
    if (!line) return;
    try {
      const utterance = new SpeechSynthesisUtterance(line);
      const lang = loadChatPrefs().chatLanguage === "en-jm" ? "en-JM" : "en-US";
      utterance.lang = lang;
      utterance.rate = 1;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // best-effort only
    }
  }

  function loadReminders() {
    try {
      const raw = JSON.parse(localStorage.getItem(BLOOMIE_REMINDERS_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveReminders(reminders) {
    localStorage.setItem(BLOOMIE_REMINDERS_KEY, JSON.stringify(reminders));
  }

  function parseReminderIntent(normalizedText) {
    const t = String(normalizedText || "").toLowerCase();
    if (!/\b(remind me|tell me later|remind us|reminder)\b/.test(t)) return null;

    let scheduleAt = null;
    let phrase = "";
    const now = new Date();
    const inDays = t.match(/\bin\s+(\d+)\s+days?\b/);
    const inHours = t.match(/\bin\s+(\d+)\s+hours?\b/);
    const inWeeks = t.match(/\bin\s+(\d+)\s+weeks?\b/);
    const tomorrow = /\btomorrow\b/.test(t);
    const nextWeek = /\bnext week\b/.test(t);
    const onIso = t.match(/\bon\s+(\d{4}-\d{2}-\d{2})\b/);

    if (inDays) {
      scheduleAt = addDays(now, Number(inDays[1]));
      phrase = `in ${inDays[1]} day${Number(inDays[1]) === 1 ? "" : "s"}`;
    } else if (inHours) {
      scheduleAt = new Date(now.getTime() + Number(inHours[1]) * 60 * 60 * 1000);
      phrase = `in ${inHours[1]} hour${Number(inHours[1]) === 1 ? "" : "s"}`;
    } else if (inWeeks) {
      scheduleAt = addDays(now, Number(inWeeks[1]) * 7);
      phrase = `in ${inWeeks[1]} week${Number(inWeeks[1]) === 1 ? "" : "s"}`;
    } else if (tomorrow) {
      scheduleAt = addDays(now, 1);
      phrase = "tomorrow";
    } else if (nextWeek) {
      scheduleAt = addDays(now, 7);
      phrase = "next week";
    } else if (onIso) {
      const parsed = new Date(`${onIso[1]}T09:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        scheduleAt = parsed;
        phrase = `on ${onIso[1]}`;
      }
    }
    if (!scheduleAt) return null;

    let reminderText =
      t.match(/\b(?:remind me|tell me later|set a reminder)\b(?:\s+(?:to|about))?\s+(.+)$/)?.[1] || "";
    if (!reminderText) reminderText = "check in with Bloomie";
    reminderText = reminderText
      .replace(/\bin\s+\d+\s+(days?|hours?|weeks?)\b/g, "")
      .replace(/\b(tomorrow|next week|on \d{4}-\d{2}-\d{2})\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!reminderText) reminderText = "check in with Bloomie";

    return { scheduleAt, phrase, reminderText };
  }

  async function persistReminder(reminder) {
    const existing = loadReminders();
    const fp = `${reminder.userId || "anon"}|${reminder.scheduledTime}|${reminder.messageType}`;
    if (existing.some((r) => r.fingerprint === fp)) return false;
    const next = [...existing, { ...reminder, fingerprint: fp }];
    saveReminders(next);

    // Backend persistence is best-effort when signed in.
    if (!ctx?.isAnon) {
      try {
        const token = await getIdToken();
        if (token) {
          await fetch(`${window.BLOOM_API_BASE || ""}/api/reminders`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(reminder),
          });
        }
      } catch {
        // local reminder remains source of truth
      }
    }
    return true;
  }

  function popDueReminders() {
    const all = loadReminders();
    if (!all.length) return [];
    const now = Date.now();
    const due = [];
    const keep = [];
    for (const r of all) {
      const ts = new Date(r.scheduledTime).getTime();
      if (!Number.isNaN(ts) && ts <= now && !r.deliveredAt) {
        due.push(r);
      } else {
        keep.push(r);
      }
    }
    if (due.length) {
      const delivered = due.map((r) => ({ ...r, deliveredAt: new Date().toISOString() }));
      saveReminders([...keep, ...delivered]);
    }
    return due;
  }

  // Stable random ID for this chat session - sent with every feedback event
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // ── Inject typing indicator CSS once per page load ───────────────────────
  if (!document.getElementById("bloomie-typing-css")) {
    const style = document.createElement("style");
    style.id = "bloomie-typing-css";
    style.textContent = `
      .bubble--typing {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 10px 16px;
        min-width: 52px;
      }
      .typing-dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #b0a0b0;
        animation: bloomie-typing-bounce 1.2s ease-in-out infinite;
        flex-shrink: 0;
      }
      .typing-dot:nth-child(2) { animation-delay: 0.18s; }
      .typing-dot:nth-child(3) { animation-delay: 0.36s; }
      @keyframes bloomie-typing-bounce {
        0%, 60%, 100% { transform: translateY(0);    opacity: 0.35; }
        30%           { transform: translateY(-5px); opacity: 1;    }
      }
    `;
    document.head.appendChild(style);
  }

  // ---------- Nickname helper ----------
  function greet(useName = true, prefix = null) {
    const name = userName && userName.trim() ? userName.trim() : null;
    if (prefix) {
      return name && useName ? `${prefix}, ${name} 🩷` : `${prefix} 🩷`;
    }
    return name && useName ? `Hey ${name} 🩷` : `Hey 🩷`;
  }

  // ---------- Nickname helpers ----------

  function getNickname() {
    return ctx.userNickname ?? null;
  }

  function canUseNickname() {
    if (!getNickname()) return false;
    if (ctx.urgency === true) return false;
    const depth = ctx.conversationProfile?.sessionDepth ?? 0;
    if (depth < 2) return false;
    if (ctx.lastNicknameUsedAtDepth !== null && depth - ctx.lastNicknameUsedAtDepth < 4) return false;
    return true;
  }

  function withNickname(text) {
    if (!canUseNickname()) return text;
    ctx.lastNicknameUsedAtDepth = ctx.conversationProfile?.sessionDepth ?? 0;
    return `${text}, ${getNickname()}`;
  }

  // ---------- Cycle data helpers ----------
  function toDate(val) {
    if (!val) return null;
    if (val?.toDate) return val.toDate();           // Firestore Timestamp
    if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const d = new Date(`${val}T00:00:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ── User state - derived from Firestore cycleData ────────────────────────
  const cd = {
    lmp:                 toDate(cycleData?.lmp),
    cycleLength:         Number(cycleData?.cycleLength) || 28,
    nextPeriodDate:      toDate(cycleData?.nextPeriodDate),
    dayInCycle:          Number(cycleData?.dayInCycle) || null,
    phase:               cycleData?.phase || null,
    phaseLabel:          cycleData?.phaseLabel || null,
    confidence:          cycleData?.confidence || null,
    edd:                 toDate(cycleData?.edd),
    hasData:             !!(cycleData?.lmp),  // also re-checked via hasLmpData()

    // Explicit mode from dashboard - never guessed by Bloomie
    mode: cycleData?.mode || (
      cycleData?.isTrackingPregnancy ? "pregnancy_tracking" :
      cycleData?.lmp                 ? "cycle_tracking"     :
                                       "just_browsing"
    ),

    // Derived facts
    pregnancyConfirmed:  !!(cycleData?.isTrackingPregnancy || cycleData?.mode === "pregnancy_tracking"),
    hasPeriodLogs:       !!cycleData?.lmp,
    isTTC:               cycleData?.mode === "trying_to_conceive",
    isPostpartum:        cycleData?.mode === "postpartum",
  };

  // Shorthand mode checks used throughout nodes
  function effectiveMode() {
    return ctx?.sessionMode || cd.mode;
  }

  // effectiveLmp: returns session-entered LMP if user typed it this session,
  // otherwise falls back to the Firestore-derived cd.lmp.
  function effectiveLmp() {
    if (ctx?.sessionData?.lmp) return new Date(ctx.sessionData.lmp);
    return cd.lmp;
  }
  function effectiveCycleLength() {
    return Number(ctx?.sessionData?.cycleLength) || cd.cycleLength;
  }
  function hasLmpData() {
    return !!(effectiveLmp());
  }
  function hasSessionCycleOverride() {
    return Boolean(ctx?.sessionData?.lmp || ctx?.sessionData?.cycleLength);
  }
  function startOfLocalDay(dateLike) {
    const d = toDate(dateLike);
    if (!d) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function daysBetweenCalendar(a, b) {
    const start = startOfLocalDay(a);
    const end = startOfLocalDay(b);
    if (!start || !end) return null;
    return Math.round((end - start) / 86400000);
  }
  function getCanonicalPhaseInfo() {
    if (hasSessionCycleOverride()) return null;
    if (!cd.phase) return null;
    return {
      phase: cd.phase,
      days: Number.isFinite(cd.dayInCycle) ? Math.max(0, cd.dayInCycle - 1) : null,
      label: cd.phaseLabel ? `${cd.phaseLabel} phase` : null,
    };
  }

  // Builds the cycle context object passed to buildGuidanceResponse so
  // templates can produce specific numbers ("you're 3 days late") rather
  // than generic copy.  Returns null when no LMP data is available.
  function buildCycleCtx() {
    const lmp = effectiveLmp();
    if (!lmp) return null;
    const cycleLength = effectiveCycleLength();
    const today       = new Date();
    const dayOfCycle  = hasSessionCycleOverride()
      ? Math.max(1, (daysBetweenCalendar(lmp, today) ?? 0) + 1)
      : (cd.dayInCycle || Math.max(1, (daysBetweenCalendar(lmp, today) ?? 0) + 1));
    const daysUntil   = daysUntilNextPeriod();
    const daysLate    = typeof daysUntil === "number" ? Math.max(0, -daysUntil) : Math.max(0, dayOfCycle - cycleLength);
    return { lmp, cycleLength, dayOfCycle, daysLate };
  }

  // Reactive mode checks - always use these instead of cd.mode directly
  // so session overrides apply automatically everywhere.
  const userMode = {
    get isCycleTracking() { return effectiveMode() === "cycle_tracking"; },
    get isTTC()           { return effectiveMode() === "trying_to_conceive"; },
    get isPregnancy()     { return effectiveMode() === "pregnancy_tracking" || cd.pregnancyConfirmed; },
    get isPostpartum()    { return effectiveMode() === "postpartum"; },
    get isBrowsing()      { return effectiveMode() === "just_browsing"; },
    hasLogs:              cd.hasPeriodLogs,
  };

  // Days between two dates
  function daysBetween(a, b) {
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  // Current cycle phase based on LMP and cycle length
  function getCurrentPhase() {
    const canonical = getCanonicalPhaseInfo();
    if (canonical) return canonical;
    const lmp = effectiveLmp();
    if (!lmp) return null;
    const today = new Date();
    const dayOfCycle = (daysBetweenCalendar(lmp, today) ?? 0) % effectiveCycleLength();
    if (dayOfCycle < 0) return null;
    if (dayOfCycle <= 5)  return { phase: "menstrual",   days: dayOfCycle, label: "your period phase (days 1–5)" };
    if (dayOfCycle <= 13) return { phase: "follicular",  days: dayOfCycle, label: "the follicular phase (days 6–13) - your body is preparing to ovulate" };
    if (dayOfCycle <= 15) return { phase: "ovulation",   days: dayOfCycle, label: "your ovulation window - days 13–15" };
    if (dayOfCycle <= 28) return { phase: "luteal",      days: dayOfCycle, label: "the luteal phase (days 16–28) - this is when PMS symptoms can show up" };
    return null;
  }

  // Returns a one-time nudge to log LMP for personalised insights, or null if
  // already shown this session. Uses the existing adviceGiven Set as the guard.
  function phaseNudge() {
    if (ctx.adviceGiven.has("phase_nudge")) return null;
    ctx.adviceGiven.add("phase_nudge");
    return "By the way - if you log your last period date in the dashboard I can give more tailored cycle-timing context 🩷";
  }

  // Nodes where a phase insight must never appear regardless of other logic.
  const PHASE_INSIGHT_BLOCKED_NODES = new Set(["HEAVY_URGENT", "CRISIS_SUPPORT", "SAFETY_SUPPORT"]);

  // Returns true when cycle data is too thin to state phase with confidence:
  // either the LMP was logged more than 45 days ago, or the last 3 cycle
  // lengths varied by more than 5 days.
  function computeLowConfidencePhase() {
    const lmp = effectiveLmp();
    if (!lmp) return false; // no LMP at all → getCurrentPhase() returns null anyway
    const daysSinceLmp = daysBetweenCalendar(lmp, new Date());
    if (daysSinceLmp > 45) return true;
    if (ctx.cycleVariability !== null && ctx.cycleVariability > 5) return true;
    return false;
  }

  // Given a phase and an array of concern strings, return the highest-priority
  // concern that has a non-null insight - using the exported CONCERN_PRIORITY order.
  function pickPriorityConcern(phase, concerns) {
    for (const concern of CONCERN_PRIORITY) {
      if (concerns.includes(concern) && getPhaseInsight(phase, concern)) {
        return concern;
      }
    }
    return null;
  }

  // Master phase insight accessor.
  //
  // Applies all safety layers in order:
  //   1. Skip entirely if the current node is in PHASE_INSIGHT_BLOCKED_NODES
  //   2. Skip if messageText contains urgency signals
  //   3. Return a brief "as mentioned" line if this insight was already shown
  //   4. Otherwise mark the insight as shown and return the full text
  //      (with low-confidence softening applied when cycle data is thin)
  //
  // Returns null when no insight should be shown, so callers can safely skip.
  function insightFor(phase, concern, messageText = "") {
    if (!phase || !concern) return null;
    if (PHASE_INSIGHT_BLOCKED_NODES.has(ctx.state)) return null;
    if (messageText && extractUrgency(messageText)) return null;

    const key = `${phase}_${concern}`;

    if (ctx.insightsGiven.has(key)) {
      return pick([
        `As I mentioned earlier, this can be part of the ${phase} phase pattern 🩷`,
        `We touched on this - it's a common experience at this point in the cycle 🩷`,
        `This is part of the pattern I mentioned for this phase of the cycle 🩷`,
      ]);
    }

    const insight = getPhaseInsight(phase, concern, computeLowConfidencePhase());
    if (!insight) return null;

    ctx.insightsGiven.add(key);
    return insight;
  }

  // ── P1: Symptom history context ───────────────────────────────────────────
  // Converts a entities.symptoms object into the set of catalog codes that fired.
  function detectedCatalogKeys(symptoms) {
    const codes = new Set();
    for (const [key, fired] of Object.entries(symptoms)) {
      if (fired && SYMPTOM_TO_CATALOG_KEYS[key]) {
        SYMPTOM_TO_CATALOG_KEYS[key].forEach(c => codes.add(c));
      }
    }
    return [...codes];
  }

  // buildSymptomContext(catalogCodes) → string | null
  function buildSymptomContext(catalogCodes) {
    if (!symptomHistory || !symptomHistory.length || !catalogCodes.length) return null;
    const lmp   = effectiveLmp();
    const phase = getCurrentPhase();
    const cycleLen = effectiveCycleLength();
    const todayCycleDay = phase?.days ?? null;

    const insights = [];

    for (const code of catalogCodes) {
      // Find log entries that contain this catalog code
      const matchingEntries = symptomHistory.filter(entry =>
        Array.isArray(entry.items) && entry.items.some(item => item.code === code)
      );
      if (matchingEntries.length < 2) continue;  // need at least 2 to call it a pattern

      // Map each entry to a cycle day (relative to lmp)
      const cycleDays = matchingEntries
        .map(entry => {
          if (!lmp) return null;
          const entryDate = toDate(entry.dateKey);
          if (isNaN(entryDate.getTime())) return null;
          const raw = daysBetweenCalendar(lmp, entryDate);
          // Fold back into current cycle using modulo; ignore negatives
          const cd = ((raw % cycleLen) + cycleLen) % cycleLen;
          return cd;
        })
        .filter(d => d !== null);

      if (cycleDays.length < 2) continue;

      const label = CATALOG_LABELS[code] || code.replace(/_/g, " ").toLowerCase();
      const count = cycleDays.length;
      const minDay = Math.min(...cycleDays);
      const maxDay = Math.max(...cycleDays);
      const dayRange = minDay === maxDay ? `day ${minDay}` : `days ${minDay}–${maxDay}`;

      // Only surface the pattern if today is within that window (±2 days)
      if (todayCycleDay !== null) {
        const inWindow = cycleDays.some(d => Math.abs(d - todayCycleDay) <= 2);
        if (!inWindow) continue;
      }

      insights.push({ label, count, dayRange, todayCycleDay });
    }

    if (!insights.length) return null;

    // Build one cohesive sentence per pattern (max 2 to avoid wall of text)
    const lines = insights.slice(0, 2).map(({ label, count, dayRange, todayCycleDay }) => {
      const dayNote = todayCycleDay !== null
        ? ` - and you're on day ${todayCycleDay} right now, which lines up`
        : "";
      return `📊 Your logs show **${label}** tends to appear around ${dayRange} of your cycle (logged ${count} time${count > 1 ? "s" : ""}${dayNote}).`;
    });

    return lines.join(" ");
  }

  // ── Follow-up memory: merge entity history ───────────────────────────────
  function mergeEntities(current, history) {
    if (!history.length) return current;

    // Don't merge history into a zero-symptom message (e.g. OOS inputs).
    // Doing so causes irrelevant messages to inherit prior health context and
    // trigger guidance responses that should only fire for health inputs.
    const currentHasSymptoms = Object.values(current.symptoms || {}).some(Boolean);
    if (!currentHasSymptoms && !current.urgent) return current;

    const merged = {
      symptoms:  { ...current.symptoms },
      duration:  current.duration,
      severity:  current.severity,
      timing:    current.timing,
      pregnancy: { ...current.pregnancy },
      urgent:    current.urgent,
      raw:       current.raw,
    };

    // Walk history newest-first so earlier messages only fill gaps
    for (let i = history.length - 1; i >= 0; i--) {
      const prev = history[i];

      // Accumulate symptoms
      for (const key of Object.keys(merged.symptoms)) {
        if (prev.symptoms?.[key]) merged.symptoms[key] = true;
      }

      // Fill in missing scalar fields from prior messages
      if (!merged.duration && prev.duration)   merged.duration = prev.duration;
      if (!merged.severity && prev.severity)   merged.severity = prev.severity;
      if (!merged.timing   && prev.timing)     merged.timing   = prev.timing;

      // Accumulate pregnancy signals
      if (prev.pregnancy?.chance)     merged.pregnancy.chance    = true;
      if (prev.pregnancy?.testedYet)  merged.pregnancy.testedYet = true;
      if (!merged.pregnancy.result && prev.pregnancy?.result)
        merged.pregnancy.result = prev.pregnancy.result;

      if (prev.urgent) merged.urgent = true;
    }

    return merged;
  }

  const WEAK_MEMORY_SYMPTOM_KEYS = new Set(["implicit_late"]);
  const VALID_SYMPTOM_KEYS = new Set(Object.keys(extractEntities("").symptoms || {}));

  function symptomKeyToTopic(symptomKey) {
    if (!symptomKey) return null;
    if (["late", "nausea", "pregnancy_symptoms", "test_timing", "pregnancy_mention"].includes(symptomKey)) return "late";
    if (["heavy", "large_clots", "light", "flow_change", "bleeding_through"].includes(symptomKey)) return "heavy";
    if (["spotting"].includes(symptomKey)) return "spot";
    if (["pelvic", "ovulation_pain", "pain_during_sex", "one_sided_pain", "cramps"].includes(symptomKey)) return "pelvic";
    if (["mood", "anxiety", "depression", "irritability", "night_sweats", "cold_flashes", "fatigue"].includes(symptomKey)) return "mood";
    if (["discharge", "unusual_discharge", "discharge_eggwhite", "odor"].includes(symptomKey)) return "discharge";
    if (["pregnant", "positive_test", "negative_test", "tested_today"].includes(symptomKey)) return "pregnancy";
    return null;
  }

  function getExplicitSymptomKeys(sourceEntities) {
    const symptoms = sourceEntities?.symptoms || {};
    return Object.entries(symptoms)
      .filter(([k, v]) => v && VALID_SYMPTOM_KEYS.has(k) && !WEAK_MEMORY_SYMPTOM_KEYS.has(k))
      .map(([k]) => k);
  }

  // Persist a compact memory snapshot after a meaningful exchange.
  // Safe to call fire-and-forget - saves to localStorage immediately,
  // Firestore sync happens in the background.
  function persistMemory(entities, reason, { sourceEntities = entities } = {}) {
    if (ctx.isAnon) return;
    const activeSymptoms = getExplicitSymptomKeys(sourceEntities);
    if (!activeSymptoms.length) return;
    const activeTopics = [...new Set(activeSymptoms.map(symptomKeyToTopic).filter(Boolean))];
    const partialUpdate = {
      lastSymptoms:            activeSymptoms,
      lastSymptomsAt:          new Date().toISOString(),
      lastSymptomsSource:      "explicit_entity",
      lastSymptomTopics:       activeTopics.slice(0, 5),
      lastIntent:              reason || null,
      lastSeverity:            entities.severity,
      lastDuration:            entities.duration,
      lastPregnancyChance:     entities.pregnancy?.chance || false,
      recentTopics:            activeTopics.length ? activeTopics.slice(0, 5) : activeSymptoms.slice(0, 5),
      lastSessionDate:         new Date().toISOString(),
      lastResolutionStatus:    ctx.resolutionStatus  ?? null,
      closeIntentDetected:     ctx.closeIntentDetected ?? false,
      // Anti-repetition fields — both shown AND declined must be persisted so
      // content cards are not re-surfaced or re-offered in future sessions.
      contentSuggestionsShown: [...ctx.contentSuggestionsShown].slice(0, 50),
      declinedSuggestions:     [...ctx.declinedSuggestions].slice(0, 50),
      lastGreetingUsed:        ctx.lastUsedGreeting ?? null,
      // Reported conditions persist across sessions.
      // Memory policy (req 10): only lightweight, non-sensitive identifiers
      // are stored — condition keys ("pcos", "anemia") not clinical details.
      // If the product's medical-data storage policy changes, revisit this.
      reportedConditions:  ctx.reportedConditions.slice(0, 20),
      // activeTopicCluster: the most recently active condition key this session,
      // stored so the next session can resume context without re-stating it.
      // Session-only when no reported condition exists; persisted only when the
      // user has explicitly stated a diagnosis (user_reported source only).
      activeTopicCluster:  ctx.reportedConditions.length > 0
        ? ctx.reportedConditions[ctx.reportedConditions.length - 1]
        : null,
      // Cross-session concern continuity
      lastConcernsResolved:   ctx.conversationProfile.concernsResolved.slice(0, 5),
      lastConcernsUnresolved: ctx.conversationProfile.concernsUnresolved.slice(0, 5),
      // Cross-session advice dedup — only clinically meaningful codes persisted
      lastAdviceGiven: (() => {
        const PERSIST_PREFIXES = ["told_to_test", "told_to_seek_care", "told_to_monitor", "logging_nudge"];
        return [...ctx.adviceGiven]
          .filter(k => PERSIST_PREFIXES.some(pfx => k === pfx || k.startsWith(pfx + "_")))
          .slice(0, 10);
      })(),
      // Safety / OOS state — persisted so cross-session logic (e.g. shorter OOS
      // redirect after 5+ prior OOS interactions) has an accurate running count.
      urgentFlag:    ctx.urgency ?? false,
      // oosCount: prior total (from loaded memory) + any new OOS turns this session.
      // ctx.oosStreakCount resets within-session; we accumulate the historical sum here.
      oosCount: Math.min(
        ((bloomieMemory?.oosCount ?? 0) + (ctx.oosStreakCount ?? 0)),
        9999
      ),
    };
    saveLocalBloomieMemory(partialUpdate);
    if (onSaveMemory) onSaveMemory(partialUpdate);
  }

  // How many days until next period
  function daysUntilNextPeriod() {
    const lmp = effectiveLmp();
    const next = cd.nextPeriodDate || (lmp ? addDays(lmp, effectiveCycleLength()) : null);
    if (!next) return null;
    return daysBetweenCalendar(new Date(), next);
  }

  // Smart pregnancy test recommendation based on LMP
  function smartTestTiming() {
    const lmp = effectiveLmp();
    if (!lmp) return null;
    const expectedPeriod = addDays(lmp, effectiveCycleLength());
    // Prefer the shared pregnancy algorithm for consistency with dashboard
    // and pregnancy nodes; fallback preserves existing behavior.
    const plan = pregnancyWhenToTest?.(new Date(), expectedPeriod);
    const testDate = plan?.primaryTestDate ? new Date(plan.primaryTestDate) : addDays(expectedPeriod, 1);
    const today = new Date();
    const daysToTest = daysBetween(today, testDate);
    return { testDate, expectedPeriod, daysToTest, canTestNow: daysToTest <= 0 };
  }

  // Build a short extraction window for context-dependent follow-ups so
  // "also nausea" can be interpreted together with prior "late period".
  function shouldUseAccumulatedExtraction(text) {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;
    if (/^\s*(yes|no|nope|yep|not yet|still no|same|again|also|and)\b/.test(t)) return true;
    if (/\b(also|as well|too|still|same|again|not yet|still no)\b/.test(t)) return true;
    if (/\b(i|mi)\s+also\b/.test(t)) return true;
    return false;
  }

  function buildAccumulatedExtractionText(currentText) {
    const recentRaw = (Array.isArray(ctx.entityHistory) ? ctx.entityHistory : [])
      .slice(-2)
      .map((e) => String(e?.raw || "").trim())
      .filter(Boolean);
    if (!recentRaw.length) return currentText;
    return [...recentRaw, currentText].join(" | ");
  }

  // ---------- State ----------
  const ctx = createCtx();
  ctx.isMinor      = isMinor;
  ctx.isAnon       = isAnon;
  ctx.policySeed   = policySeed || {};
  ctx.hasGuardianConsent = Boolean(policySeed?.hasGuardianConsent);
  ctx.ageGroup = policySeed?.ageGroup || (isMinor ? "minor" : "unknown");
  ctx.policyAnonDisclosureShown = false;
  ctx.policyContext = null;
  ctx.policyTrustedAdultNudgePending = false;
  ctx.userNickname = profile?.nickname ?? null;
  const memory = ctx.isAnon ? null : loadLocalBloomieMemory();
  ctx.memory = memory ?? {};

  function emitDueReminders() {
    const due = popDueReminders();
    if (!due.length) return;
    for (const r of due) {
      const line = `Reminder from your past self: ${r.messageType} 🩷`;
      pushMsg("bot", line, { reminder: true });
      playChatCue();
      speakBotLine(line);
    }
  }
  emitDueReminders();
  const reminderPollId = setInterval(emitDueReminders, REMINDER_POLL_MS);
  ctx.timers.add(reminderPollId);

  // ── Session end analytics ─────────────────────────────────────────────────
  // Fire-and-forget on tab close / navigation. No ctx teardown at this point
  // so sessionDepth and state are still accurate.
  const _sessionEndHandler = () => {
    logAnalyticsEvent("session_end", { sessionDepth: ctx.conversationProfile?.sessionDepth ?? 0 }, ctx);
  };
  window.addEventListener("beforeunload", _sessionEndHandler, { once: true });

  // ── Populate cycle variability from historical cycle data ─────────────────
  // cycleData.previousCycleLengths (or cycleLengths) is an optional array of
  // recent cycle lengths. When available, compute max−min across the last 3
  // entries. Values > 5 days indicate an irregular cycle; callers use this to
  // decide whether phase data is high- or low-confidence.
  {
    const history = Array.isArray(cycleData?.previousCycleLengths)
      ? cycleData.previousCycleLengths
      : Array.isArray(cycleData?.cycleLengths)
        ? cycleData.cycleLengths
        : [];
    const recent = history.slice(-3);
    if (recent.length >= 2) {
      ctx.cycleVariability = Math.max(...recent) - Math.min(...recent);
    }
  }

  // ── Seed entity history from persistent memory ───────────────────────────
  // If the last session was within 7 days, pre-populate entityHistory so
  // symptoms the user mentioned then stay active in inferRoute this session.
  // Staleness boundary: symptoms older than 24 hours are no longer merged
  // into entityHistory (where they would silently influence routing).
  // Instead they land in ctx.backgroundContext - readable by recall helpers
  // and PDF export, but invisible to inferRoute / topic-switch logic.
  // This separation prevents a Monday complaint about cramps from nudging
  // Wednesday's "I feel fine" message toward a pain route the user has
  // already moved past.
  if (bloomieMemory?.lastSymptoms?.length) {
    const oneDayAgo   = new Date(Date.now() -  1 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sessionDate  = bloomieMemory.lastSessionDate ? new Date(bloomieMemory.lastSessionDate) : null;
    if (sessionDate && sessionDate >= sevenDaysAgo) {
      const seedSymptoms = Object.fromEntries(
        Object.keys(extractEntities("").symptoms).map(k => [k, false])
      );
      for (const key of bloomieMemory.lastSymptoms) {
        if (key in seedSymptoms) seedSymptoms[key] = true;
      }
      const seedEntry = {
        symptoms:  seedSymptoms,
        duration:  bloomieMemory.lastDuration  || null,
        severity:  bloomieMemory.lastSeverity  || null,
        timing:    null,
        pregnancy: { chance: !!bloomieMemory.lastPregnancyChance, testedYet: false, result: null },
        urgent:    false,
        raw:       "",
      };
      if (sessionDate >= oneDayAgo) {
        // Recent - merge into active entity history so routing picks it up.
        ctx.entityHistory = [seedEntry];
        // MEMORY AUDIT: ctx.entityHistory — seeded from recent session (<24 h).
        //   Recent symptoms stay active for inferRoute merging. Handled correctly.
        logAnalyticsEvent("memory_recall_used", { type: "entity_history" }, ctx);
      } else {
        // Stale (>24 h) - park in backgroundContext for reference only.
        ctx.backgroundContext = { ...seedEntry, seededAt: bloomieMemory.lastSessionDate };
        // MEMORY AUDIT: ctx.backgroundContext — stale session data (>24 h) parked here,
        //   invisible to inferRoute. Readable by recall helpers and PDF export only.
        logAnalyticsEvent("memory_recall_used", { type: "background_context" }, ctx);
      }
    }
  }

  // ── Seed reported conditions from prior-session memory ───────────────────
  // Conditions the user stated in a previous session persist so Bloomie keeps
  // that context without making them re-state it every visit.
  if (Array.isArray(bloomieMemory?.reportedConditions)) {
    const VALID_KEYS = new Set(Object.keys(CONDITION_META));
    for (const key of bloomieMemory.reportedConditions) {
      if (typeof key === "string" && VALID_KEYS.has(key) && !ctx.reportedConditions.includes(key)) {
        ctx.reportedConditions.push(key);
      }
    }
  }

  // ── Seed content suggestion dedup sets from prior-session memory ─────────
  // contentSuggestionsShown and declinedSuggestions are accumulated across
  // sessions so the same card is never surfaced twice. Seeded here; updated
  // live by markContentShown() / markContentDeclined() during the session.
  if (Array.isArray(bloomieMemory?.contentSuggestionsShown)) {
    for (const id of bloomieMemory.contentSuggestionsShown) {
      if (typeof id === "string" && id.length > 0) ctx.contentSuggestionsShown.add(id);
    }
  }
  if (Array.isArray(bloomieMemory?.declinedSuggestions)) {
    for (const id of bloomieMemory.declinedSuggestions) {
      if (typeof id === "string" && id.length > 0) ctx.declinedSuggestions.add(id);
    }
  }

  // ── Seed concern continuity from prior-session memory ────────────────────
  // Resolved and unresolved topics carry over so Bloomie can proactively
  // revisit an unresolved concern or avoid re-opening a resolved one.
  if (Array.isArray(bloomieMemory?.lastConcernsResolved)) {
    for (const t of bloomieMemory.lastConcernsResolved) {
      if (typeof t === "string" && !ctx.conversationProfile.concernsResolved.includes(t)) {
        ctx.conversationProfile.concernsResolved.push(t);
      }
    }
  }
  if (Array.isArray(bloomieMemory?.lastConcernsUnresolved)) {
    for (const t of bloomieMemory.lastConcernsUnresolved) {
      if (typeof t === "string" && !ctx.conversationProfile.concernsUnresolved.includes(t)) {
        ctx.conversationProfile.concernsUnresolved.push(t);
      }
    }
  }

  // ── Seed clinically meaningful advice codes from prior-session memory ─────
  // Prevents repeating advice like "take a pregnancy test" across sessions.
  if (Array.isArray(bloomieMemory?.lastAdviceGiven)) {
    for (const code of bloomieMemory.lastAdviceGiven) {
      if (typeof code === "string") ctx.adviceGiven.add(code);
    }
  }

  // ── Pre-compute symptom signals from historical log data ──────────────────
  // Runs once on mount when symptomHistory is available. The result is stored
  // on ctx.symptomSignals and checked during message processing for safety
  // escalation, bloomieInsight prepending, and PDF export enrichment.
  if (Array.isArray(symptomHistory) && symptomHistory.length > 0) {
    const phaseInfo    = getCurrentPhase();
    const cycleLengths = Array.isArray(cycleData?.previousCycleLengths)
      ? cycleData.previousCycleLengths
      : Array.isArray(cycleData?.cycleLengths) ? cycleData.cycleLengths : [];
    const mountToday = new Date();
    const todayKey   = mountToday.toISOString().slice(0, 10);
    const todayEntry = symptomHistory.find(e => e.dateKey === todayKey)
      ?? symptomHistory[symptomHistory.length - 1];
    const loggedSymptoms = (todayEntry?.items ?? []).map(item => ({
      ...item, dateKey: todayEntry.dateKey,
    }));

    // Build expectedNextPeriodWindow from cd.nextPeriodDate when available
    const nextPd = cd.nextPeriodDate;
    const expectedNextPeriodWindow = nextPd
      ? {
          start: new Date(nextPd.getTime() - 2 * 24 * 60 * 60 * 1000),
          end:   new Date(nextPd.getTime() + 2 * 24 * 60 * 60 * 1000),
        }
      : null;

    ctx.integratedSignals = generateIntegratedSignals({
      // Cycle engine params
      expectedNextPeriodWindow,
      today:             mountToday,
      lastPeriodStart:   cd.lmp,
      cycleLengths,
      // Symptom engine params
      loggedSymptoms,
      phase:             phaseInfo?.phase ?? null,
      dayOfCycle:        phaseInfo?.days  ?? null,
      cycleCount:        Number(cycleData?.cycleCount) || 0,
      symptomHistory,
      missedPeriod:      false,
      pregnancyRelevant: cd.isTTC || cd.pregnancyConfirmed,
    });
    // Keep backward-compatible reference
    ctx.symptomSignals = ctx.integratedSignals.symptomSignals;

    // Mood anomaly context — cycle-timing anomaly + severity deviation baseline
    ctx.bloomieAnomalyCtx = computeMoodAnomalyCtx(cycleLengths, symptomHistory);

    // Logging gap proactive surfacing — flag for START node to show once
    const loggingGapSignal = ctx.integratedSignals.symptomSignals?.find(s => s.code === "SYMPTOM_LOGGING_GAP");
    if (loggingGapSignal?.level === "high" && !ctx.adviceGiven.has("logging_gap_surfaced")) {
      ctx.loggingGapPending = true;
    }
  }

  if ($input) {
    $input.disabled = false;
    $input.placeholder = "Type here or use the buttons…";
    $input.setAttribute("maxlength", "240");
  }

  // ── Low-information / gibberish detector ─────────────────────────────────────
  // Returns true for inputs like "feeeee", "aaaa", "lollllll", "...." that carry
  // no useful health signal and should not trigger normal fallback logic.
  function isLowInformationInput(text) {
    if (!text) return true;
    const cleaned = text.trim().toLowerCase();
    const SHORT_GREETINGS = new Set(["hi", "yo", "ok", "no"]);
    if (cleaned.length <= 2 && !SHORT_GREETINGS.has(cleaned)) return true;
    // Single repeated character: "aaaaa", "fffff"
    if (/^([a-z])\1{2,}$/.test(cleaned)) return true;
    // Mostly same characters: "feeeeeee"
    const uniqueChars = new Set(cleaned.replace(/\s/g, ""));
    if (uniqueChars.size <= 2 && cleaned.length > 4) return true;
    // No vowels and long enough to be intentional gibberish
    if (!/[aeiou]/.test(cleaned) && cleaned.length > 3) return true;
    return false;
  }

  // Short "yes/no/ok" replies should count as meaningful when Bloomie just
  // asked a binary question. This prevents accidental low-info/OOS fallthrough.
  function looksBinaryChoiceSet(choices = []) {
    if (!Array.isArray(choices) || !choices.length) return false;
    const hasAffirm = choices.some(c =>
      /\b(yes|yeah|yep|yup|sure|okay|ok|correct|right)\b/i.test(c?.label || "") ||
      /\b(yes|affirm|confirm)\b/i.test(c?.id || "")
    );
    const hasDeny = choices.some(c =>
      /\b(no|nah|nope|not really|not now)\b/i.test(c?.label || "") ||
      /\b(no|deny)\b/i.test(c?.id || "")
    );
    return hasAffirm && hasDeny;
  }

  function isContextualShortReply(text, pendingQuestion, choices = []) {
    if (!pendingQuestion) return false;
    const isBinary = pendingQuestion.type === "yes_no" || looksBinaryChoiceSet(choices);
    if (!isBinary) return false;
    const t = normalizePatois(text).toLowerCase().trim();
    return /^(yes|yeah|yep|yup|yah|ya|no|nah|nope|ok|okay|k|kk|sure|alright|all right)\b/.test(t);
  }

  // ── Input quality analyzer — runs before normalization or routing ────────────
  function analyzeInputQuality(text) {
    const trimmed = text.trim();
    const isEmpty = !trimmed;
    const isEmojiOnly = !isEmpty && /^[\p{Emoji}\s]+$/u.test(trimmed) && !/[a-zA-Z0-9]/.test(trimmed);
    const isPunctuationOnly = !isEmpty && /^[!?.,;:\-_\s…]+$/.test(trimmed);
    const letters = trimmed.replace(/[^a-z]/gi, "").toLowerCase();
    const vowels = letters.replace(/[^aeiou]/g, "");
    const isKeyboardSmash = !isEmpty && !isEmojiOnly && !isPunctuationOnly && letters.length >= 4 && (
      vowels.length === 0 ||
      (letters.length > 0 && vowels.length / letters.length < 0.10) ||
      (letters.length >= 5 && new Set(letters.split("")).size <= 3)
    );
    const isRepeatedLetters = /(.)\1{3,}/.test(trimmed);
    const SHORT_KNOWN = new Set(["ok","hi","yo","no","ow","ah","oh","ugh","hmm","idk"]);
    const isTooShort = trimmed.length <= 1 && !SHORT_KNOWN.has(trimmed.toLowerCase());
    const normalizedCore = trimmed.replace(/(.)\1{3,}/g, "$1").trim();
    return { isEmpty, isEmojiOnly, isPunctuationOnly, isKeyboardSmash, isRepeatedLetters, isTooShort, normalizedCore };
  }

  // Emoji → health intent mapper
  const EMOJI_INTENT_MAP = [
    { emoji: /🩸/, next: "HEAVY_INTRO" },
    { emoji: /😢|😭/, next: "MOOD_SAFETY_CHECK" },
    { emoji: /😰|😟|😨/, next: "MOOD_SAFETY_CHECK" },
    { emoji: /🤢|🤮/, next: null },
    { emoji: /💊/, next: null },
    { emoji: /❓/, next: "START_MENU" },
    { emoji: /😤|😠/, next: null },
  ];

  const OFFLINE_KB = [
    {
      key: "period_basics",
      patterns: [/\b(period|cycle|normal cycle|late period|missed period)\b/],
      lines: [
        "Cycles commonly vary, and many people fall somewhere around 21–35 days.",
        "If your period is late, stress, illness, travel, and routine changes can all play a role.",
      ],
    },
    {
      key: "cramps",
      patterns: [/\b(cramps?|pelvic pain|belly hurt|painful period)\b/],
      lines: [
        "Mild to moderate cramps can happen with periods and around ovulation.",
        "If pain becomes severe, one-sided, or comes with faintness or fever, seek urgent care.",
      ],
    },
    {
      key: "contraception",
      patterns: [/\b(contraception|birth control|condom|plan b|emergency contraception|pill|iud|implant)\b/],
      lines: [
        "Contraception can affect bleeding patterns, spotting, and cycle timing.",
        "If you had unprotected sex recently, emergency contraception is time-sensitive.",
      ],
    },
    {
      key: "sti",
      patterns: [/\b(sti|std|burning when i pee|discharge smell|itching|genital bump|bump after sex)\b/],
      lines: [
        "STI-like symptoms can overlap with other issues, so clinic testing is the safest way to know.",
        "You deserve care without shame; getting checked early helps treatment.",
      ],
    },
    {
      key: "pregnancy_basics",
      patterns: [/\b(pregnan|test negative|test positive|late but test negative|missed period)\b/],
      lines: [
        "A negative test can be too early; repeating in 48–72 hours can be clearer.",
        "If severe pain, heavy bleeding, dizziness, or faintness appears, seek urgent care.",
      ],
    },
  ];

  function getOfflineFallback(normalizedText) {
    const t = String(normalizedText || "").toLowerCase();
    if (!t) return null;
    const match = OFFLINE_KB.find((entry) => entry.patterns.some((rx) => rx.test(t)));
    if (!match) return null;
    return [
      "You're in offline mode right now, but I can still help with basics 🩷",
      ...match.lines,
      "If you want, I can go deeper once you're back online.",
    ];
  }

  if ($form && $input) {
    $form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (ctx.locked) return;

      const rawInput = String($input.value || "");
      const text = sanitizeInput(rawInput.trim());
      // Defensive no-op for empty submits (including accidental voice-event submits).
      // This prevents false fallback/OOS prompts from blank or whitespace-only content.
      if (!text) {
        $input.value = "";
        return;
      }
      $input.value = "";
      const choicesAtTurnStart = resolveChoices(NODES[ctx.state]);
      const pendingQuestionAtTurnStart = ctx.pendingQuestion
        ? { ...ctx.pendingQuestion }
        : null;

      // ── Safety classification — runs before any routing or quality checks ─
      // Blocks prompt-injection attempts, diagnosis demands, and unsafe
      // instructions before they can influence entity extraction or routing.
      const inputSafety = classifyInputSafety(text);
      if (inputSafety.blocked) {
        pushMsg("user", text);
        say(inputSafety.response);
        render();
        return;
      }

      // ── Low-information / gibberish guard — runs BEFORE quality check ────
      if (isLowInformationInput(text) && !isContextualShortReply(text, pendingQuestionAtTurnStart, choicesAtTurnStart)) {
        pushMsg("user", text);
        if (ctx.lastWasLowInfo) {
          say(pick([
            "Still not catching it 😭 try a short sentence like 'my period is late' 🩷",
            "I got you 🩷 just type what you're feeling like 'cramps' or 'late period'"
          ]));
        } else {
          say(pick([
            "Hmm I didn't quite catch that 🩷 You can tell me something like 'my period is late' or 'I have cramps'",
            "I think that message got a little lost 😭 Try telling me what's going on in a few words 🩷",
            "I'm here to help 🩷 Try typing something like 'my cycle is off' or 'I'm spotting'"
          ]));
        }
        ctx.lastWasLowInfo = true;
        render();
        return;
      }
      ctx.lastWasLowInfo = false;

      // ── Input quality check — runs BEFORE normalization or routing ────────
      const inputQuality = analyzeInputQuality(text);

      if (inputQuality.isEmpty) {
        say("I'm here whenever you're ready 🩷 What's going on?");
        render();
        return;
      }

      if (inputQuality.isPunctuationOnly) {
        say("Take your time 🩷 What's on your mind?");
        render();
        return;
      }

      if (inputQuality.isKeyboardSmash) {
        say("That one didn't quite come through 🩷 Try typing what's going on - even a few words like \"my period is late\" or \"I have cramps\" works.");
        render();
        return;
      }

      if (inputQuality.isEmojiOnly) {
        let emojiHandled = false;
        for (const mapping of EMOJI_INTENT_MAP) {
          if (mapping.emoji.test(text)) {
            pushMsg("user", text);
            if (mapping.next === "START_MENU") {
              transition("START_MENU");
            } else if (mapping.next) {
              transition(mapping.next);
            } else {
              say("I see you 🩷 Tell me what's going on in words and I'll do my best to help.");
              render();
            }
            emojiHandled = true;
            break;
          }
        }
        if (!emojiHandled) {
          say("I see you 🩷 Tell me what's going on in words and I'll do my best to help.");
          render();
        }
        return;
      }


      // ── If we are capturing a date input, parse it here ──────────────────
      if (ctx.capture?.kind) {
        const captureKind = ctx.capture.kind;
        const today = new Date();

        // ── Universal steps that always run on every user message ─────────
        // Safety re-check: urgent language in any message - even date capture -
        // must always be caught and escalated immediately.
        {
          const captureUrgent = extractUrgency(normalizePatois(text).toLowerCase());
          if (captureUrgent) {
            pushMsg("user", text);
            ctx.urgency = true;
            logSafetyEvent("urgent_trigger", {
              input:  text,
              route:  "HEAVY_URGENT",
              reason: "urgent_during_date_capture",
              topic:  ctx.topic,
            });
            ctx.capture = null;
            ctx.captureReturnTo = null;
            transition("HEAVY_URGENT");
            return;
          }
        }
        // Tone detection - update every turn so openers stay current.
        ctx.currentTone = detectUserTone(normalizePatois(text));
        // Loop detection - track inputs even in capture mode.
        ctx.recentInputs = ctx.recentInputs || [];
        ctx.recentInputs.push(text);
        if (ctx.recentInputs.length > 5) ctx.recentInputs.shift();

        // ── Date capture loop detection: same invalid entry 3+ times ──────
        ctx._invalidDateAttempts = ctx._invalidDateAttempts || {};
        const _attemptKey = captureKind + "::" + text.trim().toLowerCase();
        ctx._invalidDateAttempts[captureKind] = ctx._invalidDateAttempts[captureKind] || {};
        ctx._invalidDateAttempts[captureKind][_attemptKey] = (ctx._invalidDateAttempts[captureKind][_attemptKey] || 0) + 1;
        const _sameAttemptCount = ctx._invalidDateAttempts[captureKind][_attemptKey];
        if (_sameAttemptCount >= 3) {
          pushMsg("user", text);
          say("No worries 🩷 We can skip the date for now. I can still help with everything else - the cycle timing will just be approximate.");
          ctx._invalidDateAttempts[captureKind] = {};
          const _skipNext = ctx.captureReturnTo || ctx.capture.next;
          ctx.captureReturnTo = null;
          ctx.capture = null;
          transition(_skipNext || "START_MENU");
          return;
        }

        // ── Step 1: Try natural language / relative date expressions ──────
        // Also handles Patois via prior normalizePatois pass in the session,
        // and directly handles "mi forget", "i forgot", etc.
        const naturalResult = parseNaturalDate(normalizePatois(text), today);

        if (naturalResult?.forgotten) {
          pushMsg("user", text);
          say("That's okay 🩷 I can still help - I just won't be able to give you personalised cycle timing until you log a period date. Everything else still works.");
          ctx.captureReturnTo = null;
          ctx.capture = null;
          transition(ctx.capture?.next || "START_MENU");
          return;
        }

        // ── Step 2: Resolve a Date from natural result or structured input ─
        let parsed = null;
        let isApproximate = false;

        if (naturalResult?.date) {
          parsed = naturalResult.date;
          isApproximate = naturalResult.approximate ?? false;
          if (isApproximate) {
            // Confirm approximate date with the user before committing
            pushMsg("user", text);
            const approxStr = parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
            say(`I'll use **${approxStr}** as an estimate - does that sound about right?`, {
              choices: [
                { id: "approx_yes", label: "Yes, that's right", next: "__APPROX_CONFIRM__" },
                { id: "approx_no",  label: "No, let me re-enter", next: "__APPROX_RETRY__" },
              ],
            });
            // Store pending data and wait for confirmation
            ctx._pendingApproxDate = { iso: parsed.toISOString(), kind: captureKind, next: ctx.captureReturnTo || ctx.capture.next };
            return;
          }
        } else {
          // ── Step 3: Structured date formats (ISO, DD/MM/YYYY, natural month) ──
          parsed = new Date(text);
          if (Number.isNaN(parsed.getTime())) {
            const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
            if (dmyMatch) {
              let [, d, m, y] = dmyMatch;
              if (y.length === 2) y = "20" + y;
              // Calendar guard before constructing the Date
              const calCheck = validateCalendarDate(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10));
              if (!calCheck.valid) {
                pushMsg("user", text);
                say(calCheck.message);
                return;
              }
              parsed = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
            }
          }

          // Guard against impossible dates that JS silently rolls over (e.g. Feb 30 → Mar 2)
          if (!Number.isNaN(parsed?.getTime())) {
            const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (isoMatch) {
              const calCheck = validateCalendarDate(
                parseInt(isoMatch[1], 10),
                parseInt(isoMatch[2], 10),
                parseInt(isoMatch[3], 10)
              );
              if (!calCheck.valid) {
                pushMsg("user", text);
                say(calCheck.message);
                return;
              }
            }
          }

          if (!parsed || Number.isNaN(parsed.getTime())) {
            pushMsg("user", text);
            say("Hm, I couldn't read that date 🩷 Try typing it like: 2026-02-08, or 08/02/2026 - or just say something like \"last week\" or \"early March\".");
            return;
          }
        }

        // ── Step 4: Logical validation ─────────────────────────────────────
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const oneYearAgo = addDays(todayStart, -365);
        const ninetyDaysAhead = addDays(todayStart, 90);

        if (captureKind === "lmpDate") {
          const v = validateCycleDate({ date: parsed, kind: "lmpDate", today });
          if (!v.valid) {
            pushMsg("user", text);
            say(v.message);
            return;
          }
          if (v.staleData) {
            // Proceed but show a nudge - do not block
            say(v.message);
          }
        }

        if (captureKind === "sexDate") {
          if (parsed > todayStart) {
            pushMsg("user", text);
            say("That date looks like it's in the future 🩷 The sex date needs to be today or before - try again.");
            return;
          }
          if (parsed < oneYearAgo) {
            pushMsg("user", text);
            say("That date is more than a year ago 🩷 For test timing, I need a more recent date. Try again or go back to the main menu.");
            return;
          }
        }

        if (captureKind === "expectedPeriodDate") {
          if (parsed < oneYearAgo) {
            pushMsg("user", text);
            say("That expected period date seems too far in the past 🩷 Try a date within the last year, or let me know your most recent expected date.");
            return;
          }
          if (parsed > ninetyDaysAhead) {
            pushMsg("user", text);
            say("That date is more than 90 days away 🩷 Your expected period date should be coming up soon - try again, or tap the back button to choose a different option.");
            return;
          }
        }

        // ── Step 5: Commit the date ────────────────────────────────────────
        pushMsg("user", text);
        ctx.captureData = ctx.captureData || {};
        ctx.captureData[captureKind] = parsed.toISOString();
        if (isApproximate) ctx.captureData[captureKind + "_isApproximate"] = true;

        // Derive phaseConfidence for downstream symptom engine
        if (isApproximate) {
          ctx.sessionData = ctx.sessionData || {};
          ctx.sessionData.phaseConfidence = computePhaseConfidence({ approximate: true });
        }

        // If capturing LMP - save to sessionData so all cycle helpers use it
        if (captureKind === "lmpDate") {
          ctx.sessionData = ctx.sessionData || {};
          ctx.sessionData.lmp = parsed.toISOString();
          console.log("[Bloomie] session LMP set →", parsed.toDateString(), isApproximate ? "(approximate)" : "");
        }
        if (captureKind === "cycleLengthDate") {
          ctx.sessionData = ctx.sessionData || {};
          const days = parseInt(text, 10);
          if (!isNaN(days) && days >= 21 && days <= 45) {
            ctx.sessionData.cycleLength = days;
          }
        }

        const goNext = ctx.captureReturnTo || ctx.capture.next;
        ctx.captureReturnTo = null;
        ctx.capture = null;
        transition(goNext);
        return;
      }

      // ── Normal message flow ───────────────────────────────────────────────
      // Advance the flow epoch before pushing the message so any buttons still
      // in the DOM from the previous node are immediately invalidated.
      advanceFlow();
      pushMsg("user", text);

      // ── Loop detection — track recent inputs ─────────────────────────────
      ctx.recentInputs = ctx.recentInputs || [];
      ctx.recentInputs.push(text);
      if (ctx.recentInputs.length > 5) ctx.recentInputs.shift();

      // Exact repeat detection: same message sent multiple times in last 5
      const _last4 = ctx.recentInputs.slice(0, -1).slice(-4);
      const _exactCount = _last4.filter(m => m === text).length;
      if (_exactCount >= 3) {
        // Third repeat → give up and redirect
        ctx.isRetryAttempt = false;
        say("I heard you the first time 🩷 I want to help — let me try a different approach.");
        transition("ELSE_NOT_SURE_ROUTE");
        return;
      } else if (_exactCount === 2) {
        // Second repeat → empathetic acknowledgment, continue routing
        say(pick([
          "I want to make sure I'm actually helping 🩷 Let me try to understand this differently.",
          "It sounds like this really matters to you — let me look at this from another angle 🩷",
          "I hear you 🩷 Let me try approaching this a different way and see if I can do better.",
        ]));
        ctx.isRetryAttempt = true;
      } else {
        ctx.isRetryAttempt = false;
      }

      // "idk" loop - 3+ times total in recent inputs
      const _idkPattern = /^\s*(idk|i don'?t know|not sure|nuh sure|mi nuh know)\s*$/i;
      const _idkCount = ctx.recentInputs.filter(m => _idkPattern.test(m)).length;
      if (_idkCount >= 3) {
        say("That's okay - not knowing is okay 🩷 Sometimes it helps to just pick the closest thing. What feels most like what's going on?");
        transition("ELSE_NOT_SURE_ROUTE");
        return;
      }

      // ── MEDIUM_CONFIRM typed short-answer binding ───────────────────────
      // Keep short replies ("yes", "no", "ok") bound to the active
      // confirmation question instead of falling through to OOS/fallback.
      if (ctx.state === "MEDIUM_CONFIRM" && ctx.pendingRoute) {
        const t = normalizePatois(text).toLowerCase().trim();
        const isYes = /^(yes|yeah|yep|yup|yah|ya|ok|okay|k|kk|sure|correct|right|exactly)\b/.test(t);
        const isNo  = /^(no|nah|nope|not really|different)\b/.test(t);
        if (isYes) {
          transition("_MEDIUM_YES");
          return;
        }
        if (isNo) {
          transition("_MEDIUM_NO");
          return;
        }
      }

      // ── Resolve pending clarifying context ───────────────────────────────
      // If Bloomie asked a clarifying question last turn, combine the original
      // message with this answer and re-route on the combined context.
      let effectiveInput = text;
      let hasPendingContext = false;
      {
        const pending = ctx.pendingAmbiguityContext || ctx.pendingContradictionContext || ctx.pendingContextProbe;
        if (pending?.originalText) {
          effectiveInput = pending.originalText + " " + text;
          hasPendingContext = true;
        }
        ctx.pendingAmbiguityContext = null;
        ctx.pendingContradictionContext = null;
        ctx.pendingContextProbe = null;
      }

      // ── PERSISTENT SAFETY RE-CHECK: urgency on every message ─────────────
      // Runs BEFORE OOS routing, matchTypedToChoice, and inferRoute so a red
      // flag at any point in the conversation is never silently missed.
      // Checks both raw and Patois-normalized forms so phrases like
      // "mi cyan breathe" (→ "i can't breathe") are always caught.
      {
        const _safetyRaw  = effectiveInput.toLowerCase();
        const _safetyNorm = normalizePatois(_safetyRaw);
        const urgentNow   = extractUrgency(_safetyRaw) || extractUrgency(_safetyNorm);
        if (urgentNow) {
          ctx.urgency = true;
          logSafetyEvent("urgent_trigger", {
            input:     effectiveInput,
            route:     "HEAVY_URGENT",
            reason:    "persistent_recheck",
            topic:     ctx.topic,
            riskLevel: ctx.riskLevel,
          });
          transition("HEAVY_URGENT");
          return;
        }
      }

      // ── END_CHAT intent detection ─────────────────────────────────────────
      // Catches goodbye/done phrases typed as free text and shows a
      // confirmation prompt instead of closing immediately.
      // Runs after urgency (urgency always wins) but before all other routing.
      // Never fires in capture mode (capture path returns early above).
      {
        const _endChatRaw = text.trim().toLowerCase().replace(/[🩷💗.!]+$/, "").trim();
        const _endChatNorm = normalizePatois(_endChatRaw).toLowerCase().trim();
        const END_CHAT_PATTERN = /^(bye|bye bye|goodbye|good\s*bye|ok\s+bye|okay\s+bye|alright\s+bye|that'?s\s+all|thanks?,?\s+i'?m\s+done|i'?m\s+done|all\s+done|done\s+for\s+now|thanks\s+bye|thank\s+you\s+bye|take\s+care|that'?s\s+it|i'?m\s+finished|i'?m\s+good\s+thanks)$/i;
        const PATOIS_CLOSE_PATTERN = /^(mi\s+done|alright\s+mi\s+done|mi\s+good|seen|seen\s+den|later|lata|mi\s+a\s+guh|mi\s+guh)$/i;
        if (
          END_CHAT_PATTERN.test(_endChatRaw) ||
          END_CHAT_PATTERN.test(_endChatNorm) ||
          PATOIS_CLOSE_PATTERN.test(_endChatRaw)
        ) {
          ctx.preEndChatState           = ctx.state;
          ctx.closeIntentDetected       = true;
          ctx.closeConfirmationPending  = true;
          transition("END_CHAT_CONFIRM");
          return;
        }
      }

      // Canonical turn base (step 3): normalize the full effective input once.
      // Downstream helpers should reuse this instead of re-normalizing text.
      const _patoisNorm = normalizePatois(effectiveInput);
      // Canonical normalized turn text (full pipeline): this is the shared
      // representation for routing/intent-sensitive phrase checks.
      const _fuzzyText  = fuzzyCorrect(_patoisNorm) ?? _patoisNorm;
      const _collapsed  = collapseRepeatedLetters(_fuzzyText);
      let normalizedText = expandShorthand(_collapsed);
      normalizedText = contextualizeLowInfoReply(normalizedText);
      const declaredAge = detectDeclaredAge(normalizedText);
      if (declaredAge !== null) {
        ctx.declaredAge = declaredAge;
        if (declaredAge <= 17) ctx.isMinor = true;
        ctx.ageGroup = declaredAge <= 17 ? "minor" : "adult";
      }

      // ── Future-self reminders ───────────────────────────────────────────
      // Detect scheduling intent from canonical normalized text and store a
      // structured reminder object. Local storage is the primary source of
      // truth; backend persistence is best-effort for account mode.
      {
        const reminderIntent = parseReminderIntent(normalizedText);
        if (reminderIntent) {
          const reminder = {
            userId: getUser()?.uid || null,
            scheduledTime: reminderIntent.scheduleAt.toISOString(),
            messageType: reminderIntent.reminderText,
            contextData: {
              topic: ctx.topic || null,
              lastIntent: ctx.lastIntent || null,
            },
            deliveryMethod: "in-app",
            createdAt: new Date().toISOString(),
          };
          const saved = await persistReminder(reminder);
          const when = fmtDate(reminderIntent.scheduleAt);
          if (saved) {
            say([
              `Perfect — I set that reminder for ${reminderIntent.phrase} (${when}) 🩷`,
              `I'll remind you to: ${reminderIntent.reminderText}.`,
            ]);
          } else {
            say([
              "That reminder was already on your list 🩷",
              `I still have it saved for ${when}.`,
            ]);
          }
          render();
          return;
        }
      }

      // ── Offline-first fallback ──────────────────────────────────────────
      // When offline, answer core reproductive-health basics from a local KB
      // instead of pushing the request through full routing.
      if (!navigator.onLine) {
        const offlineLines = getOfflineFallback(normalizedText);
        if (offlineLines) {
          say(offlineLines);
          render();
          return;
        }
      }

      // ── Repair / clarification gate (canonical text) ────────────────────
      // Keep short frustration/confusion turns out of generic OOS handling.
      // This is deterministic and label-only (no freeform generation).
      {
        const repair = classifyRepairClarification(normalizedText);
        if (repair) {
          const overdueDays = daysUntilNextPeriod();
          const hasLateContext =
            isLateContextActive({ includePromptContext: true }) ||
            (typeof overdueDays === "number" && overdueDays < -1);

          const repairLines = [
            repair.label === "frustration"
              ? "My bad 🩷 I hear you."
              : "My bad 🩷 Let me say that more simply.",
            hasLateContext
              ? (typeof overdueDays === "number" && overdueDays < -1
                  ? `Your logged dates suggest your period may be around ${Math.abs(overdueDays)} day${Math.abs(overdueDays) === 1 ? "" : "s"} late by estimate.`
                  : "Your logged dates suggest your period may be later than expected.")
              : "I can rephrase this in a simpler way and keep helping from here.",
            "Do you want to focus on cramps, spotting, or pregnancy chance?",
          ];

          // Repair turns are conversational recovery, not OOS failures.
          ctx.oosStreakCount = 0;
          say(repairLines, { keepLocked: true });
          transition("START_MENU");
          return;
        }
      }

      // ── OOS follow-up context ────────────────────────────────────────────
      // Use canonical normalized turn text so follow-up parsing matches routing input.
      const oosFollowUp = resolveOOSFollowUp(normalizedText, ctx.lastOOS);
      if (oosFollowUp) {
        ctx.lastOOS = null;
        ctx.oosStreakCount = 0;
        ctx.currentTone = detectUserTone(normalizedText);
        transition(oosFollowUp);
        return;
      }

      // ── "I tested today" reactive detection ──────────────────────────────
      const testedToday = /\b(?:i\s+(?:just\s+)?tested(?:\s+today|\s+this\s+morning)?|i\s+took\s+a\s+(?:pregnancy\s+)?test|took\s+a\s+(?:pregnancy\s+)?test|did\s+a\s+(?:pregnancy\s+)?test|tested\s+today|tested\s+this\s+morning|pregnancy\s+test\s+today)\b/.test(normalizedText.toLowerCase());
      if (testedToday) {
        const retestDate = addDays(new Date(), 3);
        say([
          `${ack()} Whatever the result, here's what to know 🩷`,
          `If it was negative, retest around **${fmtDate(retestDate)}** - 48–72 hours from now - with first morning urine for the most accurate reading.`,
          "A second negative at that point is more reliable than a single early one.",
          "If it was positive, the next step is connecting with a healthcare provider.",
        ], { keepLocked: true });
        const tid = setTimeout(() => transition("LATE_TEST_Q"), 3200);
        ctx.timers.add(tid);
        return;
      }

      // ── Context-aware choice matching ────────────────────────────────────
      // Skip when a clarifying question was pending - the user is answering
      // Bloomie's question, not selecting from the previous menu.
      const contextMatch = hasPendingContext ? null : matchTypedToChoice(text);
      // pendingQuestion is strictly turn-bound: consume it now regardless of
      // whether matchTypedToChoice succeeded, so it never leaks to a later turn.
      ctx.pendingQuestion = null;
      if (contextMatch) {
        // Tone detection runs even when a typed choice is matched so ctx.currentTone
        // stays current and toneOpeners apply correctly on the next node.
        ctx.currentTone = detectUserTone(normalizedText);
        const choice = contextMatch;
        if (isMinorPolicyBlocked()) {
          transition("POLICY_MINOR_CONSENT_REQUIRED");
          return;
        }
        if (NODES[ctx.state]?.question) recordAnswer(NODES[ctx.state].question, choice.label);
        if (choice.action === "OPEN_MAP")      onOpenCareMap();
        if (choice.action === "REQUEST_PDF") {
          if (ctx.isAnon) { say(["To save a PDF summary, you'll need a free Bloom account 🩷 Sign up to keep a record of your conversations."]); }
          else { onRequestPdf(buildSummaryText()); }
        }
        if (choice.action?.startsWith("LOG_")) onLogAction(choice.action, choice.logData || {});
        const effectiveNext = (choice.id === "done" && choice.next === "CLOSE" && ctx.adviceGiven.size > 0)
          ? "SUMMARY"
          : choice.next;
        transition(effectiveNext, { choiceId: choice.id });
        return;
      }

      // ── Full input processing pipeline (steps 3–7) ───────────────────────
      // normalizedText was already computed above as the canonical turn text.

      // Step 12: Resolve tone from the same canonical normalized text used by
      // extraction/routing so tone and intent evaluate one representation.
      // Keep synchronous fallback first; async AI tone refines when ready.
      const _tonePromise = resolveTone(normalizedText, ctx);
      const toneRequestId = (ctx.toneRequestId || 0) + 1;
      ctx.toneRequestId = toneRequestId;
      ctx.previousTone = ctx.currentTone;
      ctx.currentTone  = detectUserTone(normalizedText) ?? ctx.currentTone;
      _tonePromise.then(result => {
        if (toneRequestId !== ctx.toneRequestId) return;
        ctx.currentTone = result.tone;
        ctx.toneResult  = result;
        logAnalyticsEvent("emotion_classified", { tone: result.tone, source: result.source }, ctx);
      }).catch(() => {});

      // ── Inference layer ──────────────────────────────────────────────
      // Step 7: Extract entities (symptoms, duration, severity, timing, pregnancy, urgency)
      // For contextual follow-ups, run extraction on a short accumulated window
      // (last 2 raw entity turns + current turn) for better continuity.
      const useAccumulatedExtraction = shouldUseAccumulatedExtraction(normalizedText);
      const extractionText = useAccumulatedExtraction
        ? buildAccumulatedExtractionText(normalizedText)
        : normalizedText;
      const entities = extractEntities(extractionText);
      if (useAccumulatedExtraction) entities.raw = normalizedText;

      // Mark minor support nudge availability once a real symptom turn appears.
      // This keeps minor-safe continuity even when routing stays in node flows.
      if (
        ctx.isMinor &&
        !entities.urgent &&
        !ctx.adviceGiven.has("minor_adult_nudge") &&
        Object.values(entities?.symptoms || {}).some(Boolean)
      ) {
        ctx.adviceGiven.add("minor_adult_nudge");
      }

      // ── Late-flow continuity: reinforce active missed-period context ────
      // If we are already in a late-period thread and the user replies with a
      // short non-arrival paraphrase ("it still not here", "it nuh come yet"),
      // carry forward late context so routing stays consistent.
      if (
        !entities.urgent &&
        isLateContextActive({ includePromptContext: true }) &&
        (isLateArrivalFollowUp(normalizedText) || isLateNegativeFollowUp(normalizedText))
      ) {
        entities.symptoms.late = true;
        entities.symptoms.implicit_late = true;
      }

      // ── Vague-input triage router ───────────────────────────────────────
      // Keeps "sumn off / mi nuh feel right" inside support flow rather than fallback.
      if (isVagueTriageTrigger(normalizedText, entities)) {
        transition("VAGUE_TRIAGE");
        return;
      }

      // ── Structured anxiety flow (pregnancy concern + panic cues) ────────
      if (isPregnancyAnxietyTrigger(normalizedText, entities)) {
        transition("ANXIETY_TIMELINE");
        return;
      }

      // ── Reassurance engine (safe reusable template) ─────────────────────
      if (isReassuranceQuestion(normalizedText) && !entities.urgent) {
        say(buildReassuranceLines(entities), { keepLocked: true });
        const tid = setTimeout(() => transition("ELSE_NOT_SURE_ROUTE"), 1800);
        ctx.timers.add(tid);
        return;
      }

      // ── Cumulative risk flag accumulation + shared escalation check ───────
      // Keep per-flag telemetry on ctx, but use the shared checker
      // (bloomie-inference.checkCumulativeRisk) as the single escalation
      // authority so live chat and eval harness cannot drift.
      {
        const sym = entities.symptoms;
        if (sym.heavy || sym.large_clots)          ctx.cumulativeRiskFlags.add("heavy_bleeding");
        if (sym.dizziness)                          ctx.cumulativeRiskFlags.add("dizziness");
        if (sym.late)                               ctx.cumulativeRiskFlags.add("late_period");
        if (entities.pregnancy?.result === "positive") ctx.cumulativeRiskFlags.add("positive_test");
        if (sym.pelvic)                             ctx.cumulativeRiskFlags.add("pelvic_pain");
        if (sym.spotting)                           ctx.cumulativeRiskFlags.add("bleeding");
        if (sym.night_sweats)                       ctx.cumulativeRiskFlags.add("night_sweats");
        if (sym.cold_flashes)                       ctx.cumulativeRiskFlags.add("chills");
        // one_sided_pain: detect from normalized text
        if (/one.sided|one side/.test(normalizedText)) ctx.cumulativeRiskFlags.add("one_sided_pain");

        // Hard-stop cumulative safety combo: heavy bleeding + dizziness.
        // Keep this explicit so safety escalation cannot be bypassed by later
        // ambiguity / missing-context prompts in the same turn.
        if (
          !entities.urgent &&
          ctx.cumulativeRiskFlags.has("heavy_bleeding") &&
          ctx.cumulativeRiskFlags.has("dizziness")
        ) {
          const reason = "cumulative: heavy_bleeding+dizziness";
          ctx.urgency = true;
          logSafetyEvent("urgent_trigger", {
            input:     normalizedText,
            route:     "HEAVY_URGENT",
            reason,
            topic:     ctx.topic,
            riskLevel: ctx.riskLevel,
          });
          logAnalyticsEvent("urgency_escalation", { route: "HEAVY_URGENT", reason }, ctx);
          transition("HEAVY_URGENT", { entities });
          return;
        }

        const cumulative = checkCumulativeRisk([...ctx.entityHistory.slice(-4), entities]);
        if (cumulative.escalate && !entities.urgent) {
          const reason = cumulative.reason || "cumulative: escalating multi-turn risk";
          ctx.urgency = true;
          logSafetyEvent("urgent_trigger", {
            input:     normalizedText,
            route:     "HEAVY_URGENT",
            reason,
            topic:     ctx.topic,
            riskLevel: ctx.riskLevel,
          });
          logAnalyticsEvent("urgency_escalation", { route: "HEAVY_URGENT", reason }, ctx);
          transition("HEAVY_URGENT", { entities });
          return;
        }
      }

      // ── Downplaying detection ─────────────────────────────────────────────
      // When the user minimises symptoms but mentions something urgency-adjacent,
      // add a cumulative flag and inject a gentle probe BEFORE routing.
      {
        const isDownplaying = detectDownplaying(normalizedText);
        const urgencyAdjacent = /\b(bleed|bleeding|faint|fainting|pain|dizzy|dizziness|weak|weakness|cramp)\b/.test(normalizedText);
        if (isDownplaying && urgencyAdjacent) {
          ctx.cumulativeRiskFlags.add("downplaying_detected");
          const symptomMentioned =
            /\bfaint/.test(normalizedText) ? "fainting" :
            /\bbleed/.test(normalizedText) ? "bleeding" :
            /\bdizzy|dizziness/.test(normalizedText) ? "dizziness" :
            /\bpain/.test(normalizedText) ? "pain" : "the symptom you mentioned";
          say([
            `I hear you - and I don't want to alarm you. But when ${symptomMentioned} is involved, I want to make sure I'm giving you the right picture. Can you tell me a little more about ${symptomMentioned}?`,
          ], { keepLocked: false });
          // Continue routing below - do not return here. Safety checks still run.
        }
      }

      // ── Contradiction detection ───────────────────────────────────────────
      {
        const contradictionQ = detectContradiction(normalizedText, entities);
        if (contradictionQ && !entities.urgent) {
          ctx.pendingContradictionContext = { originalText: effectiveInput };
          const prompt = chooseClarifyingPrompt(contradictionQ, { kind: "contradiction", normalizedText });
          say([prompt]);
          render();
          return;
        }
      }

      // ── Ambiguity detection ───────────────────────────────────────────────
      {
        const ambiguityQ = detectAmbiguousInput(normalizedText, entities);
        if (ambiguityQ && !entities.urgent && !ctx.pendingContradictionContext) {
          ctx.pendingAmbiguityContext = { originalText: effectiveInput };
          const prompt = chooseClarifyingPrompt(ambiguityQ, { kind: "ambiguity", normalizedText });
          say([prompt]);
          render();
          return;
        }
      }

      // ── Missing context probe ─────────────────────────────────────────────
      {
        const contextProbeQ = detectMissingContext(entities, normalizedText);
        if (contextProbeQ && !entities.urgent && !ctx.pendingContradictionContext && !ctx.pendingAmbiguityContext) {
          ctx.pendingContextProbe = { originalText: effectiveInput };
          const prompt = chooseClarifyingPrompt(contextProbeQ, { kind: "missing_context", normalizedText });
          say([prompt]);
          render();
          return;
        }
      }

      // ── Overload detection: too many issues at once ──────────────────────
      if (!entities.urgent && detectOverload(entities, effectiveInput)) {
        const sym = entities.symptoms;
        const TOPIC_LABELS = {
          bleeding: "heavy bleeding", late_period: "a late period",
          pain: "pain or cramps", mood: "mood or emotional concerns",
          spotting: "spotting", discharge: "discharge",
          nausea: "nausea", pregnancy: "a pregnancy concern",
        };
        const detectedTopics = [];
        if (sym.heavy || sym.large_clots)                           detectedTopics.push("bleeding");
        if (sym.late)                                               detectedTopics.push("late_period");
        if (sym.pelvic || sym.ovulation_pain)                       detectedTopics.push("pain");
        if (sym.mood || sym.anxiety || sym.depression)              detectedTopics.push("mood");
        if (sym.spotting)                                           detectedTopics.push("spotting");
        if ((sym.discharge || sym.unusual_discharge || sym.discharge_eggwhite) && !detectedTopics.includes("spotting")) detectedTopics.push("discharge");
        if (sym.nausea)                                             detectedTopics.push("nausea");
        if (entities.pregnancy?.chance || entities.pregnancy?.result) detectedTopics.push("pregnancy");
        if (detectedTopics.length >= 3) {
          const labelList = detectedTopics.map(k => TOPIC_LABELS[k] || k).join(", ");
          ctx.pendingConcerns = [...detectedTopics.slice(1)];
          say([
            "You've shared a lot and I want to make sure I help with all of it 🩷",
            `I noticed you mentioned: ${labelList}.`,
            "Which one is bothering you most right now? Let's start there.",
          ], {
            question: "Primary concern right now",
            choices: detectedTopics.map(topic => ({
              id: `overload_${topic}`,
              label: TOPIC_LABELS[topic] || topic,
              next: topic === "bleeding" ? "HEAVY_INTRO"
                  : topic === "late_period" ? "LATE_INTRO"
                  : topic === "pain" ? "PELVIC_INTRO"
                  : topic === "mood" ? "MOOD_SAFETY_CHECK"
                  : topic === "spotting" ? "SPOT_INTRO"
                  : topic === "discharge" ? "ELSE_DISCHARGE_ENTRY"
                  : "PREGNANCY_ENTRY",
            })),
          });
          return;
        }
      }

      // ── Topic interrupt: clear stale entity history on topic switch ───────
      // When the user shifts to a meaningfully different concern (e.g. from
      // "late period" to "cramping"), old symptoms in entityHistory would
      // bleed into the new inference and produce wrong routes. Detect the
      // switch and reset history so the current message is evaluated on its
      // own merits.
      {
        const TOPIC_BUCKET = {
          late: "period", nausea: "period",
          heavy: "bleeding", large_clots: "bleeding", spotting: "bleeding",
          pelvic: "pain", ovulation_pain: "pain", pain_during_sex: "pain",
          mood: "mood", anxiety: "mood", depression: "mood", irritability: "mood",
          discharge: "discharge", unusual_discharge: "discharge",
        };
        function primaryBucket(ents) {
          if (ents.urgent) return "urgent";
          const s = ents.symptoms;
          for (const key of ["heavy","late","pelvic","mood","spotting","discharge","nausea"]) {
            if (s[key]) return TOPIC_BUCKET[key] || key;
          }
          return null;
        }
        const newBucket  = primaryBucket(entities);
        const prevBucket = ctx.entityHistory.length
          ? primaryBucket(ctx.entityHistory[ctx.entityHistory.length - 1])
          : null;
        if (newBucket && prevBucket && newBucket !== prevBucket && newBucket !== "urgent") {
          console.log("[Bloomie] Topic switch:", prevBucket, "→", newBucket, "- clearing entity history");
          ctx.entityHistory = [];
        }
      }

      // ── Follow-up memory: accumulate entity context ───────────────────
      // Merge with up to the last 2 extractions so symptoms from earlier
      // messages remain visible to inferRoute (e.g. "late period" then
      // "I also have nausea" now routes correctly as late+nausea).
      const mergedEntities = mergeEntities(entities, ctx.entityHistory.slice(-2));
      ctx.entityHistory = [...ctx.entityHistory.slice(-2), entities];

      console.log("[Bloomie inference]", summarizeEntities(mergedEntities));

      // ── Policy context + decision layer (centralized guardrails) ─────────
      // Uses canonical normalized text + merged entities + constrained tags.
      // This runs before route selection so minor/consent/mode policy is
      // deterministic and not scattered across node templates.
      const policyRepair = classifyRepairClarification(normalizedText);
      const policyTags = extractMultiIntentTags(normalizedText, mergedEntities, {
        repair: policyRepair,
      });
      const policyCtx = buildPolicyContext({
        ctx,
        normalizedText,
        entities: mergedEntities,
        tags: policyTags.tags,
        repair: policyRepair,
        policySeed: ctx.policySeed,
      });
      ctx.policyContext = policyCtx;
      ctx.ageGroup = policyCtx.ageGroup;
      ctx.hasGuardianConsent = policyCtx.hasGuardianConsent;
      ctx.policyTrustedAdultNudgePending = false;

      const policyDecision = evaluatePolicyDecision(policyCtx);
      if (policyDecision.trustedAdultNudge) {
        ctx.policyTrustedAdultNudgePending = true;
      }
      if (policyDecision.action === "hard_block_unsafe_topic") {
        say(policyDecision.reply);
        if (policyDecision.next) {
          transition(policyDecision.next);
        } else {
          render();
        }
        return;
      }
      if (policyDecision.action === "block_minor_no_consent") {
        say(policyDecision.reply);
        transition(policyDecision.next || "POLICY_MINOR_CONSENT_REQUIRED");
        return;
      }

      // ── Conversation intelligence: update profile on every exchange ──────────
      {
        const prof = ctx.conversationProfile;

        // Increment session depth for typed messages (hasPendingContext = clarifying reply)
        prof.sessionDepth++;

        // Accumulate session symptoms across the entire conversation
        const sym = mergedEntities.symptoms;
        for (const [key, val] of Object.entries(sym)) {
          if (val === true) ctx.sessionSymptoms.add(key);
        }

        // Track mood mentions for continuity detection
        // Appended whenever mood entity fires so MOOD_SAFETY_CHECK can detect
        // persistence (same mood 2–3 turns in a row) or escalation (tone worsening).
        if (sym.mood) {
          ctx.moodMentions = [...(ctx.moodMentions || []), {
            depth:  prof.sessionDepth,
            tone:   ctx.currentTone ?? "neutral",
            intent: ctx.lastIntent  ?? null,
          }];
        }

        // Update verbosity based on engagement level
        if (prof.sessionDepth >= 5) {
          prof.userEngagementLevel = "high";
          ctx.verbosity = "detailed";
        } else if (prof.sessionDepth <= 2 && prof.sessionDepth === (ctx.recentInputs.filter(m => m).length)) {
          // low depth: check if user has only used buttons so far
          ctx.verbosity = "concise";
        } else {
          ctx.verbosity = "normal";
        }

        // Detect return to a topic that was already resolved
        const symptomTopicMap = {
          late: "late", heavy: "heavy", spotting: "spot", pelvic: "pelvic",
          mood: "mood", discharge: "discharge", nausea: "pregnancy",
        };
        for (const [symKey, topicCode] of Object.entries(symptomTopicMap)) {
          if (sym[symKey] && prof.concernsResolved.includes(topicCode)) {
            prof.returnedTopic = topicCode;
            break;
          }
        }
      }

      // ── Return-to-resolved-topic detection ─────────────────────────────────
      // If the user mentions a topic already resolved this session, offer
      // follow-up options instead of re-starting the full flow from scratch.
      if (ctx.conversationProfile.returnedTopic && !mergedEntities.urgent) {
        const rt = ctx.conversationProfile.returnedTopic;
        const TOPIC_LABELS = {
          late: "late or missed period", heavy: "heavy bleeding", spot: "spotting",
          mood: "mood or energy changes", pelvic: "pelvic pain or cramps",
          pregnancy: "pregnancy concerns", discharge: "discharge",
        };
        const TOPIC_TO_NODE = {
          late: "LATE_INTRO", heavy: "HEAVY_INTRO", spot: "SPOT_INTRO",
          mood: "MOOD_SAFETY_CHECK", pelvic: "PELVIC_INTRO",
          pregnancy: "PREGNANCY_ENTRY", discharge: "ELSE_DISCHARGE",
        };
        const rtLabel = TOPIC_LABELS[rt] || rt;
        ctx.conversationProfile.returnedTopic = null;
        say([
          "We talked about " + rtLabel + " earlier 💗 Is there something new, or did you want to revisit something specific?",
        ], {
          choices: [
            { id: "new_rt",     label: "Something new",          next: TOPIC_TO_NODE[rt] || "START_MENU" },
            { id: "followup_rt",label: "A follow-up question",   next: TOPIC_TO_NODE[rt] || "START_MENU" },
            { id: "restart_rt", label: "Start over on this topic",next: TOPIC_TO_NODE[rt] || "START_MENU" },
          ],
        });
        return;
      }


      // ── Inject symptom history context ───────────────────────────
      // If we have symptomHistory and this message mentions something the user
      // has repeatedly logged before, surface that pattern BEFOREEEEE routing.
      // This makes Bloomie feel aware of the user's actual body, not just the
      // current message. We only fire this when routing is also going to
      // proceed (i.e. we detected real symptoms), to avoid false positives.
      const catalogCodes = detectedCatalogKeys(mergedEntities.symptoms);
      const historyContext = buildSymptomContext(catalogCodes);
      if (historyContext) {
        // keepLocked: true - guidance or a transition always follows this bubble.
        // Without it, the say() completion timer fires lockUI(false) while
        // ctx.state is still the old node. render() has already re-stamped the
        // old choices with the current flowId so the flowId guard passes and a
        // stale button click resumes the wrong branch before the real transition.
        say([historyContext], { delayMs: 0, keepLocked: true });
      }

      // ── Symptom engine: safety escalation override ────────────────────────
      // If the pre-computed symptom signals contain a SEEK_URGENT_CARE signal,
      // route directly to HEAVY_URGENT before any text-based inference runs.
      if (ctx.integratedSignals?.symptomSignals?.length) {
        const sCtx = getBloomieSymptomContext(ctx.integratedSignals.symptomSignals);
        if (sCtx.safetyEscalationNeeded) {
          logSafetyEvent("symptom_engine_escalation", {
            input:     normalizedText,
            route:     "HEAVY_URGENT",
            reason:    "symptom_engine_seek_urgent_care",
            topic:     ctx.topic,
            riskLevel: ctx.riskLevel,
          });
          transition("HEAVY_URGENT", { entities: mergedEntities });
          return;
        }
      }

      // ── Medication pre-check ───────────────────────────────────────────────
      // Runs BEFORE inferRoute so explicit medication requests are caught even
      // when the text also scores health signals (e.g. "cramp a kill mi wah tek").
      {
        const medCat = OOS.find(cat =>
          cat.name === "medication_dosage" &&
          cat.patterns.some(rx => rx.test(normalizedText))
        );
        if (medCat) {
          const medLines = (medCat.replies || OOS_DEFAULT)
            .map(r => typeof r === "function" ? r(normalizedText) : r)
            .filter(Boolean);
          ctx.lastOOS = medCat.name;

          // For diagnosis concerns, extract the named condition so DIAGNOSIS_REDIRECT
          // can personalise its follow-up question without re-parsing the text.
          if (medCat.name === "diagnosis_request") {
            const _diagText = normalizedText.toLowerCase();
            if      (/\bpcos\b|\bpolycystic\b/.test(_diagText))       ctx.diagnosisCondition = "pcos";
            else if (/\bendometriosis\b|\bendo\b/.test(_diagText))     ctx.diagnosisCondition = "endometriosis";
            else if (/\bfibroids?\b/.test(_diagText))                  ctx.diagnosisCondition = "fibroids";
            else if (/\badenomyosis\b/.test(_diagText))                ctx.diagnosisCondition = "adenomyosis";
            else if (/\bcyst\b|\bovarian\b/.test(_diagText))           ctx.diagnosisCondition = "cyst";
            else if (/\bthyroid\b/.test(_diagText))                    ctx.diagnosisCondition = "thyroid";
            else                                                        ctx.diagnosisCondition = null;
          }

          const delay = estimateSayTime(medLines);
          say(medLines, { keepLocked: true });
          const tid = setTimeout(() => {
            transition(medCat.forceNext || "START_MENU", {});
          }, delay);
          ctx.timers.add(tid);
          return;
        }
      }

      // ── Reported-condition pre-checks ────────────────────────────────────
      // Runs BEFORE OOS detection to prevent "I have PCOS" from being
      // misrouted to the diagnosis_request refusal path.
      //
      // KEY DISTINCTION — three types of condition language:
      //
      //   REPORTED diagnosis  → user states a confirmed existing diagnosis
      //     e.g. "I have PCOS", "diagnosed with endometriosis"
      //     handled here → REPORTED_CONDITION_ACK
      //     stored in ctx.reportedConditions + bloomieMemory (lightweight key only)
      //
      //   SUSPECTED diagnosis → user believes they may have something
      //     e.g. "I think I might have PCOS", "I'm scared I have fibroids"
      //     detectReportedCondition() returns null (SEEKING_PATTERNS bail early)
      //     falls through to diagnosis_request OOS → DIAGNOSIS_REDIRECT
      //     NOT stored in memory
      //
      //   DIAGNOSIS-SEEKING   → user asks Bloomie to diagnose them
      //     e.g. "Do I have PCOS?", "Could this be endo?"
      //     same OOS path as suspected → DIAGNOSIS_REDIRECT
      //     NOT stored in memory
      //
      // Urgency is never suppressed — the PERSISTENT SAFETY RE-CHECK above
      // already ran and returned early if extractUrgency() fired.
      //
      // Branch priority:
      //   1. New reported diagnosis        → REPORTED_CONDITION_ACK
      //   2. Management question (needs existing ctx.reportedConditions)
      //                                   → CONDITION_MANAGEMENT_INFO
      //   3. Symptom + condition keyword  → CONDITION_SYMPTOM_CONTEXT
      {
        // Branch 1: new reported diagnosis
        const _reported = detectReportedCondition(normalizedText);
        if (_reported) {
          if (!ctx.reportedConditions.includes(_reported.conditionKey)) {
            ctx.reportedConditions.push(_reported.conditionKey);
          }
          ctx.activeReportedCondition = _reported.conditionKey;
          transition("REPORTED_CONDITION_ACK");
          return;
        }

        // Branch 2: management/treatment question tied to an existing diagnosis
        if (detectConditionManagementQuestion(normalizedText, ctx.reportedConditions)) {
          // Set active condition to the one mentioned in this message, or
          // fall back to the most recently reported if none is named inline.
          const _inlineKey = extractConditionKey(normalizeText(normalizedText));
          ctx.activeReportedCondition =
            (_inlineKey && ctx.reportedConditions.includes(_inlineKey))
              ? _inlineKey
              : ctx.reportedConditions[ctx.reportedConditions.length - 1] ?? null;
          transition("CONDITION_MANAGEMENT_INFO");
          return;
        }

        // Branch 3: symptom question with a condition keyword + known diagnosis
        if (detectConditionSymptomQuestion(normalizedText, ctx.reportedConditions)) {
          const _inlineKey = extractConditionKey(normalizeText(normalizedText));
          ctx.activeReportedCondition =
            (_inlineKey && ctx.reportedConditions.includes(_inlineKey))
              ? _inlineKey
              : ctx.reportedConditions[ctx.reportedConditions.length - 1] ?? null;
          transition("CONDITION_SYMPTOM_CONTEXT");
          return;
        }
      }

      // ── Lightweight reasoning layer (board → interpretation → strategy) ───
      // Runs after extraction/merge and high-priority pre-checks, but before
      // inferRoute / keyword routing. Keeps behavior explainable and rule-based.
      {
        // Repair/clarification classification + multi-label tags are computed
        // from canonical normalized text only. Tags are advisory and feed the
        // reasoning layer; routing still falls back to existing inferRoute/OOS.
        const repairClassification = policyRepair;
        const tagResult = policyTags;
        ctx.turnIntentTags = tagResult.tags;
        ctx.turnIntentTagConfidence = tagResult.confidence;
        ctx.lastRepairClassification = repairClassification?.label || null;

        const signalBoard = buildSignalBoard({
          text: normalizedText,
          entities: mergedEntities,
          tags: tagResult.tags,
          repair: repairClassification,
          phase: getCurrentPhase()?.phase ?? null,
          ctx,
          userMode,
          overdueDays: daysUntilNextPeriod(),
          bloomieMemory,
        });
        const interpretationScorecard = scoreInterpretationBoard(signalBoard);
        ctx.lastInterpretationScorecard = interpretationScorecard;
        const interpretations = scoreInterpretations(signalBoard);
        const decision = selectResponseStrategy(signalBoard, interpretations);
        ctx.lastReasoning = {
          interpretation: decision.interpretation ?? null,
          strategy: decision.strategy ?? "defer",
          why: decision.why ?? null,
          next: decision.next ?? null,
          confidence: decision.confidence ?? interpretationScorecard.confidence ?? 0,
          topInterpretation: interpretationScorecard.topInterpretation ?? null,
        };
        bloomieDebug("reasoning", ctx.lastReasoning);

        if (decision.strategy === "repair" && Array.isArray(decision.reply)) {
          const delay = estimateSayTime(decision.reply);
          say(decision.reply, { keepLocked: true });
          const tid = setTimeout(() => {
            transition(decision.next || "START_MENU", decision.payload || {});
          }, delay);
          ctx.timers.add(tid);
          return;
        }

        if (
          ["safety_redirect", "continue_prior_topic", "triage", "clarify"].includes(decision.strategy) &&
          decision.next
        ) {
          transition(decision.next, { entities: mergedEntities, ...(decision.payload || {}) });
          return;
        }
      }

      // ── Pipeline debug logging ────────────────────────────────────────────
      debugPipeline(
        text,          // raw
        _patoisNorm,   // after normalizePatois (step 3)
        _fuzzyText,    // after fuzzyCorrect (step 4)
        normalizedText,// after collapseRepeatedLetters + expandShorthand (steps 5–6)
        mergedEntities,
        ctx.currentTone,
        mergedEntities.urgent,
        null // route resolved below
      );

      // ── Safety escalation from symptom clusters ───────────────────────────
      const safetyEsc = ctx.integratedSignals?.symptomSignals?.find(
        s => s.code === "SAFETY_ESCALATION" && s.level === "high"
      );
      if (safetyEsc && !ctx.urgency) {
        ctx.urgency = true;
        transition("HEAVY_URGENT");
        return;
      }

      const inferred   = inferRoute(mergedEntities);

      // ── Safety log: urgent_trigger ────────────────────────────────────────
      if (inferred?.next === "HEAVY_URGENT") {
        logSafetyEvent("urgent_trigger", {
          input:       normalizedText,
          route:       inferred.next,
          reason:      inferred.payload?.reason || null,
          symptoms:    Object.entries(mergedEntities.symptoms).filter(([,v]) => v).map(([k]) => k),
          urgencyFlag: mergedEntities.urgent,
          topic:       ctx.topic,
          riskLevel:   ctx.riskLevel,
        });
      }

      const cycleCtx   = buildCycleCtx();
      const layerContext = {
        text,
        normalizedText,
        entities: mergedEntities,
        currentEntities: entities,
        cycleCtx,
        tone: ctx.currentTone,
        inferredReason: inferred?.payload?.reason || null,
        inferredNext: inferred?.next || null,
        lastIntent: ctx.lastIntent || null,
        sessionDepth: ctx.conversationProfile?.sessionDepth ?? 0,
        isShortFollowUp: isContextualShortReply(text, pendingQuestionAtTurnStart, choicesAtTurnStart),
        hasPendingClarifier: !!(ctx.pendingAmbiguityContext || ctx.pendingContradictionContext || ctx.pendingContextProbe),
      };

      if (shouldAskFollowUp(layerContext)) {
        const followUp = buildFollowUpQuestion(layerContext);
        if (followUp) {
          ctx.pendingContextProbe = { originalText: effectiveInput };
          say([followUp]);
          render();
          return;
        }
      }

      const guidance   = buildGuidanceResponse(mergedEntities, inferred?.payload?.reason, cycleCtx, ctx.currentTone, minorSafeFooter());

      if (guidance) {
        // Store on ctx so buildSummaryText can include them in PDF export
        ctx.lastEntities = mergedEntities;
        ctx.lastInferredReason = inferred?.payload?.reason || null;
        ctx.lastIntent = inferred?.payload?.reason?.split("+")[0] || inferred?.next
          || guidance.scenario?.split("_")[0] || null;
        ctx.lastCycleCtx = cycleCtx;
        persistMemory(mergedEntities, ctx.lastInferredReason, { sourceEntities: entities });
        // Show the structured template response THEN transition.
        // keepLocked: true ensures the UI stays locked between the last
        // guidance bubble and the transition firing, so old node buttons
        // cannot be clicked during that gap.
        console.log("[Bloomie guidance] scenario →", guidance.scenario);
        // Prepend a tone-aware opener unless the route is an emergency / safety node -
        // those must stay grounded and consistent regardless of user tone.
        const EMERGENCY_NODES = new Set([
          "HEAVY_URGENT", "CRISIS_SUPPORT", "SAFETY_SUPPORT",
          "MOOD_SAFETY_ROUTE", "PELVIC_URGENT", "SPOT_URGENT", "DISCHARGE_URGENT",
        ]);
        const guidanceOpener =
          ctx.currentTone && ctx.currentTone !== "neutral" && !EMERGENCY_NODES.has(inferred?.next)
            ? getToneOpener(ctx.currentTone)
            : "";
        const responseLayerContext = {
          ...layerContext,
          responseScenario: guidance.scenario,
        };
        const realityCheckPrefix = !EMERGENCY_NODES.has(inferred?.next)
          ? maybeBuildRealityCheckPrefix(responseLayerContext)
          : null;
        const tinyWinType = !EMERGENCY_NODES.has(inferred?.next) ? detectTinyWin(responseLayerContext) : null;
        const tinyWinLine = tinyWinType && !ctx.adviceGiven.has(`tiny_win_${tinyWinType}`)
          ? buildTinyWinLine(tinyWinType, normalizedText)
          : null;
        if (tinyWinLine) ctx.adviceGiven.add(`tiny_win_${tinyWinType}`);

        const miniReplay = !EMERGENCY_NODES.has(inferred?.next) && !realityCheckPrefix && shouldUseMiniReplay(responseLayerContext)
          ? buildMiniReplay(responseLayerContext)
          : null;
        const patternLine = !EMERGENCY_NODES.has(inferred?.next) && !miniReplay
          ? getPatternCatcherLine(mergedEntities)
          : null;
        const hiddenConcernFollowUp = !EMERGENCY_NODES.has(inferred?.next)
          ? buildEmotionalFollowUp(responseLayerContext)
          : null;
        const shouldSoftContinue = !EMERGENCY_NODES.has(inferred?.next) && !hiddenConcernFollowUp
          ? shouldAddSoftContinue(
              {
                ...responseLayerContext,
                hiddenConcern: !!detectHiddenConcern(normalizedText, inferred?.payload?.reason || ctx.lastIntent, ctx.currentTone),
                followUpAsked: false,
              },
              guidance
            )
          : false;
        const softContinue = shouldSoftContinue && !ctx.adviceGiven.has("soft_continue_prompt")
          ? buildSoftContinuePrompt(responseLayerContext)
          : null;
        if (softContinue) ctx.adviceGiven.add("soft_continue_prompt");

        const guidanceLeadIn = (realityCheckPrefix || miniReplay) ? "" : guidanceOpener;
        const prefixLines = [
          tinyWinLine,
          miniReplay,
          guidanceLeadIn,
          realityCheckPrefix,
          patternLine,
        ].filter(Boolean);
        const suffixLines = [hiddenConcernFollowUp, softContinue].filter(Boolean);
        const guidanceCore = [...guidance.lines, ...suffixLines];
        const guidanceLines = [...prefixLines, ...guidanceCore];
        const delay = estimateSayTime(guidanceLines);
        if (inferred) {
          say(guidanceLines, { keepLocked: true });
          const tid = setTimeout(() => {
            transition(inferred.next, { entities: mergedEntities, ...(inferred.payload || {}) });
          }, delay);
          ctx.timers.add(tid);
        } else {
          say(guidanceLines);
        }
        if (ctx.isAnon && !ctx.urgency && ctx.conversationProfile.sessionDepth >= 2 && !ctx.state.includes("_URGENT")) {
          const nudge = anonNudge();
          if (nudge) say([nudge]);
        }
        return;
      }

      if (inferred) {
        ctx.lastIntent = inferred.payload?.reason?.split("+")[0] || null;
        persistMemory(mergedEntities, inferred.payload?.reason || null, { sourceEntities: entities });
        bloomieDebug("route", {
          route:    inferred.next,
          source:   "inferRoute",
          reason:   inferred.payload?.reason ?? null,
          entities: Object.keys(mergedEntities.symptoms).filter(k => mergedEntities.symptoms[k]),
        });
        transition(inferred.next, { entities: mergedEntities, ...(inferred.payload || {}) });
        return;
      }

      // Fall through to existing keyword router
      const routed = routeUserText(normalizedText);

      // ── Compute route confidence (pure signal scoring) ──────────────────────
      {
        const { sig: routeSig } = scoreSignals(normalizedText);
        ctx.routeConfidence = computeRouteConfidence(routeSig, mergedEntities);
        ctx.lastConfidence  = ctx.routeConfidence;
        bloomieDebug("confidence", {
          tier:          ctx.routeConfidence.tier,
          primaryIntent: ctx.routeConfidence.primaryIntent ?? null,
          score:         ctx.routeConfidence.score,
          ambiguous:     ctx.routeConfidence.ambiguous,
        });
        if (routed?.next && routed.next !== "START_MENU" && !routed?.payload?.oos) {
          bloomieDebug("route", {
            route:  routed.next,
            source: "keyword_router",
          });
        }
      }

      // ── Intent assist: fire AI in parallel when rule confidence is LOW ────────
      // Fired immediately after confidence scoring so the network request runs
      // while the sync pipeline (safety logs, OOS handling) continues.
      // Awaited only if we actually reach the LOW-tier routing decision below.
      // Returns null silently when: rule is confident, no health keywords, API fails.
      const _intentAssistPromise = resolveIntentAssist(normalizedText, ctx.routeConfidence);

      // ── Signal extractor: fire in parallel, store fire-and-forget ─────────────
      // Runs at the same pipeline position as intent assist, using the same
      // canonical normalizedText. Never awaited in the hot path — result arrives
      // on ctx.aiSignals whenever the network responds (within 1200 ms).
      //
      // Safety contract (enforced here and documented in bloomie-extract.js):
      //   • Signals are advisory only — they enrich ctx but do NOT override
      //     rule-based routing or safety triggers.
      //   • If entities.urgent is true (rule layer flagged urgency) or
      //     ctx.urgency is true (active urgent thread), signals are discarded.
      //   • null result on any failure = Bloomie behaves exactly as before.
      if (!entities.urgent && !ctx.urgency) {
        extractSignalsAI(normalizedText)
          .then(signals => {
            if (!signals) return;
            // Store on ctx for optional use by follow-up logic, memory
            // persistence, analytics, and summary generation.
            // Never referenced by inferRoute(), safety checks, or NODES directly.
            ctx.aiSignals = signals;
            bloomieDebug("ai", {
              source:     "extract",
              symptoms:   signals.symptoms.join(",") || "none",
              timing:     signals.timing.join(",")   || "none",
              severity:   signals.severity ?? "null",
              repair:     signals.repair,
              redFlags:   signals.redFlags.join(",") || "none",
              confidence: signals.confidence,
            });
          })
          .catch(() => {
            // Extractor errors are already logged inside bloomie-extract.js.
            // Nothing to do here — Bloomie continues unaffected.
          });
      }

      // ── Safety log: urgent_trigger (keyword router path) ──────────────────
      if (routed?.next === "HEAVY_URGENT") {
        logSafetyEvent("urgent_trigger", {
          input:     normalizedText,
          route:     "HEAVY_URGENT",
          reason:    "keyword_router",
          topic:     ctx.topic,
          riskLevel: ctx.riskLevel,
        });
        logAnalyticsEvent("urgency_escalation", { route: "HEAVY_URGENT", reason: "keyword_router" }, ctx);
      }

      // ── Safety log: oos_fallback ────────────────────────────────────────────
      if (routed?.payload?.oos && routed.payload.oos !== "greeting") {
        const REPAIR_OOS_CATEGORIES = new Set(["clarification_repair", "confused_with_bloomie"]);
        if (REPAIR_OOS_CATEGORIES.has(routed.payload.oos)) {
          // Repair/clarification turns are not true OOS failures.
        } else {
        const containsHealthKeywords =
          /\b(bleed|faint|pass out|passing out|collapse|pain|cramp|late|pregnant|spotting|dizzy|discharge)\b/
          .test(normalizedText);
        logSafetyEvent("oos_fallback", {
          input:                normalizedText,
          category:             routed.payload.oos,
          containsHealthKeywords,
          topic:                ctx.topic,
          riskLevel:            ctx.riskLevel,
        });
        }
      }

      if (routed?.payload?.oos) {
        const _oosHealthy =
          /\b(bleed|faint|pass out|pain|cramp|late|pregnant|spotting|dizzy|discharge|cycle|period|mood|tired)\b/
          .test(normalizedText);
        bloomieDebug("fallback", {
          route:       routed.next,
          oosCategory: routed.payload.oos,
          healthWords: _oosHealthy,
        });
        if (_oosHealthy && routed.payload.oos !== "greeting") {
          bloomieDebug("unhandled_health", {
            input:    normalizedText.slice(0, 80),
            category: routed.payload.oos,
            note:     "health keywords present but fell to OOS reply",
          });
        }
      }

      if (routed?.reply && routed?.next) {
        // Say the reply first, THEN transition after it finishes so
        // clearTimers() inside transition() does not nuke the reply bubbles.
        const lines = Array.isArray(routed.reply) ? routed.reply : [routed.reply];
        const isOOS = !!routed.payload?.oos;
        const isGreetingOOS = routed.payload?.oos === "greeting";
        const isRepairOOS = new Set(["clarification_repair", "confused_with_bloomie"]).has(routed.payload?.oos);
        if (isOOS && !isGreetingOOS && !isRepairOOS) {
          ctx.oosStreakCount = (ctx.oosStreakCount || 0) + 1;
          logAnalyticsEvent("oos_event", { streak: ctx.oosStreakCount }, ctx);
        } else {
          ctx.oosStreakCount = 0;
        }

        // ── Track unresolved concerns on OOS ──────────────────────────────────────
        // If user goes OOS while a health topic was in progress and not yet
        // resolved, stash it so the CLOSE guard can surface it.
        if (isOOS && ctx.lastIntent) {
          const INTENT_TO_TOPIC = {
            LATE_INTRO: "late", LATE_PERIOD_CHECK: "late", TEST_INTRO: "late",
            HEAVY_INTRO: "heavy", HEAVY_ROUTE_B: "heavy", HEAVY_ROUTE_C: "heavy", HEAVY_ROUTE_C_GATE: "heavy",
            SPOT_INTRO: "spot", SPOT_PREG_INFO: "spot",
            MOOD_SAFETY_CHECK: "mood", MOOD_INTRO: "mood", MOOD_GUIDE: "mood",
            PELVIC_INTRO: "pelvic", PELVIC_SAFETY_CHECK: "pelvic", PELVIC_SAFETY_GATE: "pelvic",
            PREGNANCY_ENTRY: "pregnancy",
            ELSE_DISCHARGE: "discharge", ELSE_DISCHARGE_ENTRY: "discharge",
            late: "late", heavy: "heavy", spot: "spot", mood: "mood",
            pelvic: "pelvic", pregnancy: "pregnancy", discharge: "discharge",
          };
          const prof = ctx.conversationProfile;
          const topicCode = INTENT_TO_TOPIC[ctx.lastIntent];
          if (topicCode && !prof.concernsResolved.includes(topicCode) &&
              !prof.concernsUnresolved.includes(topicCode)) {
            prof.concernsUnresolved.push(topicCode);
          }
        }

        // ── Conversational repair: 2+ OOS after meaningful session depth ──────────
        if (isOOS && ctx.oosStreakCount >= 2 && ctx.conversationProfile.sessionDepth >= 3) {
          logAnalyticsEvent("oos_repair", { sessionDepth: ctx.conversationProfile.sessionDepth }, ctx);
          say([
            "I’ve been having trouble understanding what you need, and that’s on me 💗",
            "Let me try differently. Can you pick the closest thing from below?",
          ]);
          ctx.oosStreakCount = 0;
          ctx.narrowingCandidates = null;
          ctx.narrowingRepair = true;
          transition("NARROWING");
          return;
        }

        if (isOOS && routed.next === "START_MENU") {
          // Zero-confidence narrowing: if the input has health-adjacent words,
          // ask a clarifying question with topic buttons instead of the generic OOS reply.
          const _hasExplicitHealth = /\b(period|bleed|pain|cramp|discharge|pregnant|cycle|mood|tired|sick|hurt)\b/.test(normalizedText);
          const _vagueScore        = scoreVagueHealth(normalizedText);
          if (_hasExplicitHealth || _vagueScore > 0) {
            ctx.narrowingCandidates = null;
            // Flag vague entries so NARROWING uses a gentler, open-ended opener
            // rather than the default "which area fits?" buttons-first phrasing.
            ctx.narrowingVague = !_hasExplicitHealth && _vagueScore > 0;
            transition("NARROWING");
            return;
          }
          // OOS fallback: just show reply, leave the menu buttons in place
          say(lines);
          render();
        } else {
          // Prepend tone opener for non-emergency, non-OOS routed replies.
          const EMERGENCY_NODES = new Set([
            "HEAVY_URGENT", "CRISIS_SUPPORT", "SAFETY_SUPPORT",
            "MOOD_SAFETY_ROUTE", "PELVIC_URGENT", "SPOT_URGENT", "DISCHARGE_URGENT",
          ]);
          const routerOpener =
            ctx.currentTone && ctx.currentTone !== "neutral" && !isOOS && !EMERGENCY_NODES.has(routed.next)
              ? getToneOpener(ctx.currentTone)
              : "";
          const routerLines = routerOpener ? [routerOpener, ...lines] : lines;
          const delay = estimateSayTime(routerLines);
          // keepLocked: true - a transition is scheduled right after this say().
          // Without it, lockUI(false) fires when the last line plays, re-enabling
          // the old node's buttons (which render() has re-stamped with the current
          // flowId) before the transition moves ctx.state forward.
          say(routerLines, { keepLocked: true });
          const tid = setTimeout(() => {
            transition(routed.next, routed.payload || {});
          }, delay);
          ctx.timers.add(tid);
        }
      } else if (routed?.reply) {
        say(routed.reply);
        render();
      } else if (routed?.next) {
        // ── Confidence-tiered routing ──────────────────────────────────────────────
        // HEAVY_URGENT is always immediate regardless of computed confidence.
        if (routed.next === "HEAVY_URGENT") {
          ctx.lastIntent = routed.next;
          transition(routed.next, routed.payload || {});
          return;
        }

        // Pairs of intents that are commonly ambiguous and warrant a soft confirmation
        // even when signal scores are otherwise strong enough for HIGH.
        const CLARIFICATION_PAIRS = new Set([
          "late+pelvic", "pelvic+late",
          "late+pregnancy", "pregnancy+late",
          "pelvic+heavy", "heavy+pelvic",
          "spot+discharge", "discharge+spot",
          "mood+heavy", "heavy+mood",
        ]);

        const conf = ctx.routeConfidence;
        ctx.lastConfidence = conf || null;

        // Check whether the top two intents form a clarification pair.
        const _primary    = conf?.primaryIntent || null;
        const _firstComp  = conf?.competingIntents?.[0] || null;
        const _pairKey    = _primary && _firstComp ? _primary + "+" + _firstComp : null;
        const _isPair     = _pairKey ? CLARIFICATION_PAIRS.has(_pairKey) : false;

        if (conf && conf.tier === "low") {
          // LOW: rule layer couldn't resolve a clear route.
          // Safety valve: loop-prevention always takes priority.
          if (ctx.confidenceFallbackCount >= 2) {
            ctx.confidenceFallbackCount++;
            logAnalyticsEvent("route_fallback", { fallbackCount: ctx.confidenceFallbackCount }, ctx);
            transition("CONFIDENCE_FALLBACK");
          } else {
            // Build candidate buttons from the rule-layer competitors.
            const INTENT_TO_CANDIDATE = {
              late:        { id: "cycle",  label: "Late or irregular cycle",  next: "LATE_INTRO" },
              heavy:       { id: "heavy",  label: "Bleeding or flow",         next: "HEAVY_INTRO" },
              spot:        { id: "spot",   label: "Spotting",                 next: "SPOT_INTRO" },
              mood:        { id: "mood",   label: "Mood or energy changes",   next: "MOOD_INTRO" },
              pelvic:      { id: "pain",   label: "Pain or cramps",           next: "PELVIC_INTRO" },
              pregnancy:   { id: "preg",   label: "Pregnancy concerns",       next: "PREGNANCY_ENTRY" },
              discharge:   { id: "dis",    label: "Discharge",                next: "ELSE_DISCHARGE" },
              urgent_care: { id: "urgent", label: "Urgent concern",           next: "HEAVY_URGENT" },
            };
            const candidateIntents = [conf.primaryIntent, ...conf.competingIntents]
              .filter(Boolean).slice(0, 3);
            const candidates = candidateIntents
              .map(i => INTENT_TO_CANDIDATE[i]).filter(Boolean);
            ctx.narrowingCandidates = candidates.length ? candidates : null;
            // If the rule layer found no candidates but the input has vague
            // reproductive-health phrasing, use a softer NARROWING opener so the
            // user feels heard rather than redirected.
            ctx.narrowingVague = !candidates.length && scoreVagueHealth(normalizedText) > 0;
            ctx.confidenceFallbackCount++;
            logAnalyticsEvent("route_no_match", { input: normalizedText, primaryIntent: conf.primaryIntent }, ctx);
            // Give AI assist a brief chance to resolve before rendering NARROWING.
            // This avoids "NARROWING flash then redirect" UX when AI returns quickly.
            const assistFlowId = ctx.flowId;
            const AI_ASSIST_GRACE_MS = 180;
            let finalized = false;
            const graceTimerId = setTimeout(() => {
              if (finalized) return;
              finalized = true;
              if (ctx.flowId === assistFlowId) transition("NARROWING");
            }, AI_ASSIST_GRACE_MS);
            _intentAssistPromise.then((_aiIntent) => {
              if (finalized) return;
              if (ctx.flowId !== assistFlowId) {
                finalized = true;
                clearTimeout(graceTimerId);
                return;
              }

              ctx.intentAssist = _aiIntent ?? null;
              if (!_aiIntent || _aiIntent.intent === "else") return;

              bloomieDebug("ai", {
                intent:     _aiIntent.intent,
                confidence: _aiIntent.confidence,
                source:     _aiIntent.source,
              });

              const aiCandidate = INTENT_TO_CANDIDATE[_aiIntent.intent];
              if (!aiCandidate) return;

              if (_aiIntent.confidence === "high" && _aiIntent.route) {
                // High-confidence AI arrived within grace window: route directly.
                finalized = true;
                clearTimeout(graceTimerId);
                ctx.confidenceFallbackCount = 0;
                ctx.lastIntent = _aiIntent.route;
                logAnalyticsEvent("route_matched", {
                  route:  _aiIntent.route,
                  reason: "ai_primary",
                }, ctx);
                transition(_aiIntent.route, {});
                return;
              }

              if (_aiIntent.confidence === "medium") {
                const existing = ctx.narrowingCandidates ?? [];
                if (!existing.some(c => c.id === aiCandidate.id)) {
                  ctx.narrowingCandidates = [aiCandidate, ...existing].slice(0, 3);
                }
              }
            }).catch(() => {});
            return;
          }
        } else if (conf && (conf.tier === "medium" || _isPair)) {
          // MEDIUM (or a clarification pair at HIGH): ask soft confirmation
          ctx.pendingRoute = { next: conf.route || routed.next, payload: routed.payload || {} };
          logAnalyticsEvent("route_clarification", { route: conf.route || routed.next }, ctx);
          transition("MEDIUM_CONFIRM");
        } else {
          // HIGH (or no confidence data): route directly — reset struggle streak.
          ctx.confidenceFallbackCount = 0;
          ctx.lastIntent = routed.next;
          logAnalyticsEvent("route_matched", { route: routed.next, reason: routed.payload?.reason }, ctx);
          transition(routed.next, routed.payload || {});
        }
      } else {
        // Zero-confidence narrowing: same check for the hard no-match path.
        if (/\b(period|bleed|pain|cramp|discharge|pregnant|cycle|mood|tired|sick|hurt)\b/.test(normalizedText)) {
          ctx.narrowingCandidates = null;
          transition("NARROWING");
          return;
        }
        say([
          "I'm here to help with periods, spotting, cramps, mood changes, or cycle concerns 💗",
          "Try typing something like: \"late period\", \"spotting\", \"heavy bleeding\", or \"pelvic pain\".",
        ]);
        render();
      }
    });
  }

  // ---------------- OUT-OF-SCOPE ENGINE ----------------
  // normalizeText, safeEcho, pick, looksLikeGibberish → imported from bloomie-routing.js

  // ── Tone toolkit ──────────────────────────────────────────────────────────
  // Use these instead of writing fresh phrasing every time.
  // Goal: natural, warm, distinctly not-a-PDF.

  const ACK = [
    "Got it.",
    "Okay.",
    "Thanks for sharing that.",
    "That makes sense.",
    "Noted.",
    "Appreciate you telling me.",
  ];

  const GENTLE_QUALIFIER = [
    "Based on what you logged",
    "From what I can see",
    "Based on your cycle data",
    "Going by what's in your dashboard",
    "Using your last logged period",
  ];

  const CONSENT_PREFIX = [
    "If you're comfortable sharing -",
    "Only if you want to -",
    "No pressure, but it helps to know:",
    "If you're open to it -",
  ];

  const ESTIMATE_QUALIFIER = [
    "I can estimate, though keep in mind this is based on averages.",
    "This is an estimate - cycles vary person to person.",
    "Keep in mind this is a prediction, not a guarantee.",
    "Actual timing can shift based on stress, health, and other factors.",
  ];

  // ack() - random acknowledgement opener, optionally followed by custom text
  function ack(extra = null) {
    const base = pick(ACK);
    return extra ? `${base} ${extra}` : base;
  }

  // qualifier() - opening a data-driven answer
  function qualifier() { return pick(GENTLE_QUALIFIER); }

  // consent() - before asking something personal
  function consent() { return pick(CONSENT_PREFIX); }

  // estimate() - when giving a calculated answer
  function estimate() { return pick(ESTIMATE_QUALIFIER); }

  // ── Quick summary formatter ──────────────────────────────────────────────
  // For high-frequency questions, returns a 3-part array:
  //   [answer, how_we_got_there, next_step_hint]
  // Caller can spread into say() or node.say
  function quickSummary(answer, basis, nextHint) {
    return [
      answer,
      basis  ? `📊 ${basis}` : null,
      nextHint ? `👉 ${nextHint}` : null,
    ].filter(Boolean);
  }

  // ── Safety footer ─────────────────────────────────────────────────────────
  // safeFooter()  → light educational disclaimer (most health nodes)
  // urgentFooter() → add when clinical thresholds are mentioned
  // Usage: spread into say() array → [...safeFooter()]
  function safeFooter() {
    return ["_This is educational information, not a diagnosis. If something feels off, trust your body._"];
  }
  function urgentFooter() {
    return ["_If symptoms are severe, sudden, or worsening - please seek medical care._"];
  }
  function anonNudge() {
    if (!ctx.isAnon) return null;
    if (ctx.adviceGiven.has("anon_account_nudge")) return null;
    if (ctx.urgency) return null;
    if (ctx.state.includes("_URGENT")) return null;
    ctx.adviceGiven.add("anon_account_nudge");
    return pick([
      "Creating a free account lets Bloomie keep your cycle logs together so guidance can stay more consistent over time 🩷",
      "If you ever want more tailored guidance, a free Bloom account helps me use your logged cycle context across sessions 🩷",
      "Just so you know — signing up for free helps Bloomie keep your history in one place, which makes follow-up support more coherent 🩷",
    ]);
  }
  function minorSafeFooter() {
    if (!ctx.isMinor) return [];
    if (!ctx.hasGuardianConsent) return [];
    if (ctx.adviceGiven.has("minor_adult_nudge")) return [];
    if (ctx.urgency || ctx.state.includes("_URGENT")) return [];
    ctx.adviceGiven.add("minor_adult_nudge");
    if (ctx.policyTrustedAdultNudgePending || ctx.policyContext?.riskLevel === "high" || ctx.policyContext?.riskLevel === "medium") {
      ctx.policyTrustedAdultNudgePending = false;
      return [pick([
        "_You do not have to manage this alone — please tell a parent, guardian, school nurse, or another trusted adult._",
        "_Because this can be important, it would help to involve a parent, guardian, school nurse, or trusted adult._",
      ])];
    }
    return [pick([
      "_If you're ever unsure or worried, it's okay to talk to a trusted adult or a doctor._",
      "_A parent, guardian, school nurse, or trusted adult can support you if you need help._",
    ])];
  }

  function isMinorPolicyBlocked() {
    const effectiveAgeGroup = ctx.policyContext?.ageGroup || ctx.ageGroup || (ctx.isMinor ? "minor" : "unknown");
    return effectiveAgeGroup === "minor" && !ctx.hasGuardianConsent;
  }


  // ---------------- CONTEXT-AWARE CHOICE MATCHER ----------------
  // Tries to match what the user typed to one of the current node's choices.
  // Handles: yes/no/not sure answers, patois variants, and partial label matches.
  // Resolve choices - can be a plain array OR a function returning an array
  function resolveChoices(node) {
    if (Array.isArray(ctx.inlineChoices) && ctx.inlineChoices.length) return ctx.inlineChoices;
    if (!node) return [];
    const raw = typeof node.choices === "function" ? node.choices() : node.choices;
    return Array.isArray(raw) ? raw : [];
  }

  function matchTypedToChoice(rawText) {
    const node = NODES[ctx.state];
    const choices = resolveChoices(node);
    if (!choices.length) return null;

    // flowId guard - mirrors the stale-button check used by button clicks.
    // advanceFlow() is called before matchTypedToChoice, so ctx.flowId is
    // already N+1 at this point. The choices are only valid if they were
    // rendered in epoch N (i.e. ctx.nodeFlowId === ctx.flowId - 1).
    // If they were rendered in an earlier epoch, the user has already moved
    // past that node via free text; skip the match and let the intent router
    // handle the input instead.
    if (ctx.nodeFlowId !== ctx.flowId - 1) return null;

    // Monkey-patch node.choices with resolved array for code below
    node._resolvedChoices = choices;

    const t = normalizePatois(rawText).toLowerCase().trim();

    // ── Semantic choice lookup helpers ────────────────────────────────────
    // resolveChoiceByIntent checks `choice.intent` first, then falls back to
    // the static CHOICE_INTENT_MAP keyed on choice id.  This means nodes that
    // already use ids like "yes", "no", "ns" continue to work unchanged, while
    // future nodes can declare any id and tag it with an explicit intent field.
    const choiceAffirm = resolveChoiceByIntent(choices, "affirm");
    const choiceDeny   = resolveChoiceByIntent(choices, "deny");
    const choiceUnsure = resolveChoiceByIntent(choices, "unsure");
    const isBinaryQuestion = ctx.pendingQuestion?.type === "yes_no" || looksBinaryChoiceSet(choices);
    const inferByPolarity = (intent) => {
      if (!isBinaryQuestion) return null;
      if (intent === "affirm") {
        return choices.find(c =>
          /\b(yes|yeah|yep|yup|sure|okay|ok|correct|right)\b/i.test(c.label || "") ||
          /\b(yes|affirm|confirm)\b/i.test(c.id || "")
        ) || null;
      }
      if (intent === "deny") {
        return choices.find(c =>
          /\b(no|nah|nope|not really|not now)\b/i.test(c.label || "") ||
          /\b(no|deny)\b/i.test(c.id || "")
        ) || null;
      }
      if (intent === "unsure") {
        return choices.find(c =>
          /\b(not sure|unsure|maybe|hard to say|don'?t know|dont know)\b/i.test(c.label || "") ||
          /\b(ns|unsure|maybe)\b/i.test(c.id || "")
        ) || null;
      }
      return null;
    };
    const semanticAffirm = choiceAffirm || inferByPolarity("affirm");
    const semanticDeny   = choiceDeny   || inferByPolarity("deny");
    const semanticUnsure = choiceUnsure || inferByPolarity("unsure");

    // ── Typed phrase → intent word lists ─────────────────────────────────
    // Soft denials MUST be checked before soft affirmations so that
    // "probably not" never accidentally fires the "probably" affirm match.
    const SOFT_DENY  = [
      "probably not", "don't think so", "i don't think so",
      "i dont think so", "dont think so", "not really think so",
    ];
    const YES_WORDS  = [
      "yes", "yeah", "yep", "yup", "yah", "ya", "definitely",
      "for sure", "correct", "true", "i have", "i did", "i do",
      "mi have", "mi did", "mi do", "yes i", "yeah i",
      // soft affirmations
      "i think so", "think so", "i believe so", "believe so",
      "probably", "most likely", "i'd say yes", "id say yes",
    ];
    const NO_WORDS   = [
      "no", "nah", "nope", "not really", "i have not", "i don't",
      "i dont", "no i", "nah i", "mi nuh", "mi never",
      "no me", "nah me", "definitely not", "not at all",
    ];
    const UNSURE_WORDS = [
      "not sure", "unsure", "idk", "i don't know", "i dont know",
      "not really sure", "mi nuh know", "dunno", "hard to say", "not certain",
      // added
      "maybe", "can't tell", "cant tell", "could be", "possibly",
      "not totally sure", "i'm not sure", "im not sure", "i'm unsure",
    ];

    // ── Match order: soft denials → affirm → deny → unsure ───────────────
    // Soft denials are checked first to prevent "probably" from stealing
    // "probably not" before the deny path gets a chance to evaluate it.
    if (semanticDeny && SOFT_DENY.some(w => t === w || t.startsWith(w + " "))) {
      return semanticDeny;
    }
    if (semanticAffirm && YES_WORDS.some(w => t === w || t.startsWith(w + " ") || t.endsWith(" " + w))) {
      return semanticAffirm;
    }
    if (semanticDeny && NO_WORDS.some(w => t === w || t.startsWith(w + " ") || t.endsWith(" " + w))) {
      return semanticDeny;
    }
    if (semanticUnsure && UNSURE_WORDS.some(w => t.includes(w))) {
      return semanticUnsure;
    }

    // In binary contexts, treat acknowledgement words as soft affirmations.
    if (semanticAffirm && isBinaryQuestion && /^(ok|okay|k|kk|sure|alright|all right)\b/.test(t)) {
      return semanticAffirm;
    }

    // ── Positive/negative phrasing on choice labels ───────────────────────
    // e.g. user types "mostly before my period" → matches label "Mostly before my period"
    // NOTE: only do substring matching for inputs of 4+ chars to avoid
    // short words like "hi" accidentally matching "somet[hi]ng else"
    for (const choice of choices) {
      const label = choice.label.toLowerCase();
      if (t === label) return choice;
      // only allow substring match if the typed text is meaningfully long
      if (t.length >= 4 && (label.includes(t) || t.includes(label))) {
        return choice;
      }
    }

    // ── Keyword hints per choice id ──────────────────────────────────────
    const CHOICE_HINTS = {
      // timing
      "before":  ["before", "before period", "day before", "days before", "prior"],
      "during":  ["during", "while", "when i have"],
      "period":  ["during period", "on my period", "when period"],
      "any":     ["anytime", "random", "any time", "all the time", "always"],
      "sex":     ["during sex", "after sex", "when we", "pain sex"],
      // severity
      "mild":    ["mild", "little", "not bad", "manageable", "likkle"],
      "mod":     ["moderate", "medium", "sometimes bad", "affects my day"],
      "sev":     ["severe", "very bad", "really bad", "bad bad", "kill mi", "unbearable"],
      // test result
      "pos":     ["positive", "it positive", "came back positive", "two line"],
      "neg":     ["negative", "it negative", "came back negative", "one line"],
      "unc":     ["unclear", "faint line", "not sure", "can't tell"],
      // spotting amount
      "wipe":    ["wipe", "few drops", "just a little", "likkle drops"],
      "light":   ["light flow", "more flow", "light bleed"],
      // pain response
      "sometimes": ["sometimes", "a little", "kinda", "sorta", "likkle"],
      // duration
      "few":     ["few days", "day or two", "short", "quick"],
      "week":    ["a week", "week or so", "about week"],
      "most":    ["most of", "almost always", "whole cycle", "all month"],
      // improvements
      "improving_yes": ["yes it help", "helps", "getting better"],
      "normal":  ["normal for me", "always like this", "usual"],
      "new":     ["new", "different", "changed", "never before", "first time"],
    };

    for (const choice of node._resolvedChoices) {
      const hints = CHOICE_HINTS[choice.id];
      if (hints && hints.some(h => t.includes(h))) return choice;
    }

    // ── Extended turn-binding: sentence-form answers ──────────────────────
    // When Bloomie just asked a yes/no question (ctx.pendingQuestion.type ===
    // "yes_no"), try to match sentence-form answers that the word-list phase
    // above doesn't catch.  These are longer or less-conventional phrasings
    // that clearly express agreement, disagreement, or uncertainty but aren't
    // single-word tokens.  Conservative patterns only — no health keywords.
    if (ctx.pendingQuestion?.type === "yes_no") {
      // Soft denials checked first (same rule as the main word-list phase).
      const EXT_DENY = [
        "not yet", "haven't yet", "i haven't", "i have not", "i've not",
        "never had", "never have", "no not at all", "nothing like that",
        "haven't done", "didn't do it", "i didn't do",
        "not me", "doesn't apply", "not applicable",
      ];
      const EXT_UNSURE = [
        "i guess", "i suppose", "kind of", "kinda", "sort of", "sorta",
        "somewhat", "a little bit maybe", "not really sure about that",
        "hard to say", "i'm really not sure", "not 100%", "not 100 percent",
      ];
      const EXT_AFFIRM = [
        "i guess so", "i suppose so", "i took one", "i took a test",
        "i did one", "already did", "i already did", "i already have",
        "i've done it", "i done it", "yeah already", "yes already",
        "sounds like me", "that sounds like me", "that's what i have",
        "yes exactly", "exactly that", "literally that", "that's it exactly",
        "i think that's right", "that describes it",
      ];

      if (semanticDeny   && EXT_DENY.some(w => t === w || t.startsWith(w)))   return semanticDeny;
      if (semanticUnsure && EXT_UNSURE.some(w => t === w || t.includes(w)))   return semanticUnsure;
      if (semanticAffirm && EXT_AFFIRM.some(w => t === w || t.startsWith(w))) return semanticAffirm;
    }

    return null;
  }

  // ── Overload detector ─────────────────────────────────────────────────────────
  // Returns true when user has shared too many distinct concerns simultaneously.
  function detectOverload(entities, text) {
    const sym = entities.symptoms;
    const activeTopics = [
      sym.heavy || sym.large_clots,
      sym.late,
      sym.pelvic || sym.ovulation_pain,
      sym.mood || sym.anxiety || sym.depression,
      sym.spotting,
      sym.discharge || sym.unusual_discharge || sym.discharge_eggwhite,
      sym.nausea,
      entities.pregnancy?.chance || entities.pregnancy?.result,
    ].filter(Boolean).length;
    const symptomCount = Object.values(sym).filter(Boolean).length;
    return symptomCount >= 3 || String(text).length > 200 || activeTopics >= 3;
  }

  // ── Late-flow follow-up continuity helpers ───────────────────────────────
  // When the current conversation is already in a late/missed-period context,
  // short pronoun follow-ups like "it still not here" should reinforce that
  // context instead of falling into generic narrowing.
  const ACTIVE_LATE_STATES = new Set([
    "LATE_INTRO", "LATE_NO_GUIDANCE", "LATE_IRREGULAR_GUIDANCE", "LATE_YES_PREG",
    "LATE_TEST_Q", "LATE_TEST_SUGGEST", "LATE_TEST_RESULT", "LATE_POSITIVE",
    "LATE_NEG_UNCLEAR", "LATE_CHANGES_Q", "LATE_CHANGES_EXPLAIN", "LATE_SYMPTOMS_Q",
    "LATE_PATTERN_Q", "LATE_WRAP", "PREG_LATE_ROUTE",
  ]);

  function getPreviousBotLine() {
    for (let i = ctx.history.length - 1; i >= 0; i--) {
      if (ctx.history[i]?.from === "bot") return String(ctx.history[i].text || "");
    }
    return "";
  }

  function hasOverdueCyclePromptContext() {
    const overdueDays = daysUntilNextPeriod();
    if (typeof overdueDays === "number" && overdueDays < -1) return true;
    const lastBot = getPreviousBotLine().toLowerCase();
    return (
      /\b(period may be (a little )?late|might be a bit later than expected|period may not have arrived yet)\b/.test(lastBot) ||
      /\b(overdue|hasn'?t come yet|has not come yet)\b/.test(lastBot)
    );
  }

  function isLateContextActive({ includePromptContext = false } = {}) {
    if (ACTIVE_LATE_STATES.has(ctx.state)) return true;
    if (ctx.lastIntent === "late" || ctx.lastIntent === "LATE_INTRO" || ctx.lastIntent === "LATE_PERIOD_CHECK") return true;
    if (ctx.entityHistory.slice(-2).some(e => e?.symptoms?.late || e?.symptoms?.implicit_late)) return true;
    if (includePromptContext && hasOverdueCyclePromptContext()) return true;
    return false;
  }

  function isLateArrivalFollowUp(text) {
    const t = String(text || "")
      .toLowerCase()
      .replace(/[^\w\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (
      /\b(?:my\s+)?period\s+(?:still\s+)?(?:hasn'?t|has not|haven'?t|have not|didn'?t|did not|nuh|nah|not|no)\s+(?:come|arriv(?:e|ed)|reach(?:ed)?|show(?:ed|ing)?(?:\s+up)?)\s*(?:yet)?\b/.test(t) ||
      /\b(?:it|mine)\s+(?:still\s+)?(?:hasn'?t|has not|haven'?t|have not|didn'?t|did not|nuh|nah|not|no)\s+(?:come|arriv(?:e|ed)|reach(?:ed)?|show(?:ed|ing)?(?:\s+up)?)\s*(?:yet)?\b/.test(t) ||
      /^(?:not yet|still no|still no period|no period yet|still hasn't come|still has not come)$/.test(t) ||
      /^(?:it nuh come|it nuh come yet|it still no come|it still nuh come|it not here yet|period still nuh come|period still no come|no it still nuh come)$/.test(t) ||
      /^(?:haven't seen it yet|have not seen it yet|haven't seen my period yet|have not seen my period yet)$/.test(t) ||
      /\bit\s+still\s+not\s+here\b/.test(t) ||
      /\bit\s+no\s+show(?:ing)?\s+up(?:\s+yet)?\b/.test(t) ||
      /\bstill\s+hasn'?t\s+come\b/.test(t)
    );
  }

  // Low-context negatives ("no", "not yet", "nope") are ambiguous by
  // themselves. We only treat them as "still no period" when a valid late
  // context is already active (checked at call site).
  function isLateNegativeFollowUp(text) {
    const t = String(text || "")
      .toLowerCase()
      .replace(/[^\w\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return (
      /^(?:no|nah|nope|still no|not yet|still not yet|haven't yet|have not yet)$/.test(t) ||
      /^(?:still no period|no period|no period yet|period not yet)$/.test(t) ||
      /^(?:it still no|it still nuh|it nuh yet)$/.test(t)
    );
  }

  function getActiveTopicFromContext() {
    const byState = String(ctx.state || "");
    if (/^LATE_|^TEST_|^PREG_/.test(byState)) return "late";
    if (/^HEAVY_/.test(byState)) return "heavy";
    if (/^SPOT_/.test(byState)) return "spotting";
    if (/^PELVIC_/.test(byState)) return "pelvic";
    if (/^MOOD_/.test(byState)) return "mood";
    if (/DISCHARGE/.test(byState)) return "discharge";

    const byIntent = String(ctx.lastIntent || "");
    if (/\blate\b|LATE_/.test(byIntent)) return "late";
    if (/\bheavy\b|HEAVY_/.test(byIntent)) return "heavy";
    if (/\bspot\b|SPOT_/.test(byIntent)) return "spotting";
    if (/\bpelvic\b|PELVIC_/.test(byIntent)) return "pelvic";
    if (/\bmood\b|MOOD_/.test(byIntent)) return "mood";
    if (/discharge|DISCHARGE/.test(byIntent)) return "discharge";

    const recent = ctx.entityHistory?.[ctx.entityHistory.length - 1]?.symptoms || {};
    if (recent.late || recent.implicit_late) return "late";
    if (recent.heavy || recent.large_clots) return "heavy";
    if (recent.spotting) return "spotting";
    if (recent.pelvic || recent.ovulation_pain) return "pelvic";
    if (recent.mood || recent.anxiety || recent.depression || recent.irritability) return "mood";
    if (recent.discharge || recent.unusual_discharge) return "discharge";
    return null;
  }

  // Low-context replies should inherit active context when we can do so safely.
  // This never invents history; it only maps against explicit active topic state.
  function contextualizeLowInfoReply(text) {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return text;

    const isLowInfo = /^(no|nope|not yet|still no|same|same thing|still same)$/.test(t);
    if (!isLowInfo) return text;

    if (isLateContextActive({ includePromptContext: true }) && /^(no|nope|not yet|still no|same|same thing|still same)$/.test(t)) {
      return `${t} period has not come yet`;
    }

    const activeTopic = getActiveTopicFromContext();
    if (!activeTopic) return text;
    if (/^(same|same thing|still same)$/.test(t)) {
      if (activeTopic === "pelvic") return `${t} cramps pelvic pain`;
      if (activeTopic === "heavy") return `${t} heavy bleeding`;
      if (activeTopic === "spotting") return `${t} spotting`;
      if (activeTopic === "discharge") return `${t} unusual discharge`;
      if (activeTopic === "mood") return `${t} mood stress`;
      if (activeTopic === "late") return `${t} period has not come yet`;
    }
    return text;
  }

  function isVagueTriageTrigger(normalizedText, entities) {
    const t = String(normalizedText || "").toLowerCase();
    const vaguePhrase =
      /\b(sumn off|something off|something is off|something wrong|something is wrong|mi nuh feel right|me nuh feel right|i do not feel right|i don't feel right|i dont feel right)\b/.test(t);
    if (!vaguePhrase) return false;
    if (entities?.urgent) return false;
    const symptomCount = Object.values(entities?.symptoms || {}).filter(Boolean).length;
    return symptomCount <= 1;
  }

  function isPregnancyAnxietyTrigger(normalizedText, entities) {
    const t = String(normalizedText || "").toLowerCase();
    if (entities?.urgent) return false;
    const strongPanicCue = /\b(scared|panic|panicking|freaking out|worried sick|terrified|frightened)\b/.test(t);
    const mildAnxietyCue = /\b(anxious|worried)\b/.test(t);
    const pregCue =
      /\b(pregnan|pregnancy scare|condom broke|condom break|condom slipped|condom bruk|unprotected sex|late period|missed period)\b/.test(t) ||
      entities?.pregnancy?.chance === true ||
      entities?.symptoms?.late === true;
    const overloadSignals = Object.values(entities?.symptoms || {}).filter(Boolean).length >= 3;
    if (overloadSignals) return false;
    return pregCue && (strongPanicCue || (mildAnxietyCue && /\b(pregnancy scare|might be pregnant|think i('?| a)m pregnant)\b/.test(t)));
  }

  function isReassuranceQuestion(normalizedText) {
    const t = String(normalizedText || "").toLowerCase();
    return /\b(is this normal|should i worry|am i okay|is this bad|should i be worried)\b/.test(t);
  }

  function buildReassuranceLines(entities) {
    const symptomCount = Object.values(entities?.symptoms || {}).filter(Boolean).length;
    const boundary = entities?.urgent
      ? "I don't want you to wait if symptoms are severe."
      : "It's not always a sign something is seriously wrong.";
    const next = entities?.urgent
      ? "Please seek urgent care now, especially if you're faint, in severe pain, or bleeding heavily."
      : symptomCount > 0
        ? "If this becomes severe, keeps happening, or feels worse than usual, it's worth getting checked."
        : "If symptoms become persistent or severe, it's worth checking with a healthcare provider.";
    return [
      "A lot of people experience this, and you're not alone 🩷",
      boundary,
      next,
    ];
  }

  function getPatternCatcherLine(entities) {
    if (ctx.adviceGiven.has("pattern_catcher_line")) return null;
    if (ctx.urgency || entities?.urgent) return null;
    if ((ctx.conversationProfile?.sessionDepth ?? 0) < 2) return null;

    const recent = [...ctx.entityHistory.slice(-4), entities];
    const counts = {};
    for (const e of recent) {
      for (const [k, v] of Object.entries(e?.symptoms || {})) {
        if (!v) continue;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    const repeatedSymptom = Object.values(counts).some((n) => n >= 2);

    const hasSymptomEvidence = (ctx.integratedSignals?.symptomSignals || []).some((s) =>
      s?.show && ["SYMPTOM_FREQUENCY_INCREASING", "SYMPTOMS_MORE_INTENSE_THAN_USUAL", "SYMPTOMS_PERSISTING_LONGER_THAN_USUAL"].includes(s.code)
    );
    const hasAnomalyEvidence = repeatedSymptom && (ctx.bloomieAnomalyCtx?.level === "medium" || ctx.bloomieAnomalyCtx?.level === "high");

    const evidenceCount = [repeatedSymptom, hasSymptomEvidence, hasAnomalyEvidence].filter(Boolean).length;
    if (evidenceCount < 1) return null;

    ctx.adviceGiven.add("pattern_catcher_line");
    return "I'm noticing this has come up more than once 🩷";
  }

  // Promote explicit in-chat age disclosure into session context so minor-safe
  // guidance can activate even without profile age.
  function detectDeclaredAge(text) {
    const t = String(text || "").toLowerCase().trim();
    const m =
      t.match(/\b(?:i am|i'm|im|mi)\s+(\d{1,2})\s*(?:years?\s*old|yrs?\s*old|yo)\b/) ||
      t.match(/\b(?:i am|i'm|im|mi)\s+(\d{1,2})\b/);
    if (!m) return null;
    const age = Number(m[1]);
    if (!Number.isFinite(age) || age < 9 || age > 60) return null;
    return age;
  }

  function promptFingerprint(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function chooseClarifyingPrompt(prompt, { kind = "clarifier", normalizedText = "" } = {}) {
    const original = String(prompt || "").trim();
    if (!original) return original;
    const fp = promptFingerprint(original);
    const isRecentRepeat =
      ctx.lastClarifierFingerprint === fp &&
      typeof ctx.lastClarifierTurn === "number" &&
      ctx.flowId - ctx.lastClarifierTurn <= 2;

    let resolved = original;
    if (isRecentRepeat) {
      const VARIANTS = {
        "is it more like nausea and stomach discomfort or do you feel generally unwell with things like chills or fever": [
          "Would you say this feels more like nausea/stomach discomfort, or more like feeling generally unwell (for example chills or fever)?",
          "Quick check so I can guide you better: is this mostly nausea/belly discomfort, or more an overall unwell feeling like chills/fever?",
        ],
        "where does the pain feel like it s coming from more in your belly lower pelvic area or somewhere else": [
          "Could you help me pinpoint it: is the discomfort more lower-pelvic/crampy, or more your stomach/belly in general?",
          "To make sure I stay on track, is the pain mostly low in the pelvis, or more in the stomach area?",
        ],
      };
      const options = VARIANTS[fp];
      if (options?.length) {
        resolved = pick(options);
      } else {
        resolved = "I want to make sure I understand you right 🩷 Could you say the main symptom in a few words (for example: late period, cramps, discharge, mood)?";
      }
    }

    // If we're in an active late-thread and the clarifier is pain-location related,
    // carry forward that context without over-claiming causation.
    if (
      isLateContextActive() &&
      /\b(pelvic|belly|stomach|pain)\b/.test(promptFingerprint(resolved)) &&
      /\b(stomach|belly|hurt|ache|pain)\b/.test(String(normalizedText || "").toLowerCase())
    ) {
      resolved = "Got you 💗 Since your period still seems off, quick check: is it more crampy low-pelvic pain, or more stomach/belly discomfort?";
    }

    ctx.lastClarifierFingerprint = promptFingerprint(resolved);
    ctx.lastClarifierTurn = ctx.flowId;
    void kind;
    return resolved;
  }

  // ── Pipeline debug utility ────────────────────────────────────────────────
  // Activated only when localStorage.getItem("bloomie_debug") === "true".
  // Logs each stage of the processing pipeline for inspection.
  function debugPipeline(rawInput, normalizedInput, fuzzyInput, expandedInput, entities, tone, urgency, route) {
    if (!isBloomieDebugEnabled()) return;
    console.log(`[Bloomie Pipeline] Raw: ${rawInput}`);
    console.log(`[Bloomie Pipeline] After normalizePatois: ${normalizedInput}`);
    console.log(`[Bloomie Pipeline] After fuzzyCorrect: ${fuzzyInput}`);
    console.log(`[Bloomie Pipeline] After expandShorthand: ${expandedInput}`);
    console.log(`[Bloomie Pipeline] Entities: ${JSON.stringify(entities)}`);
    console.log(`[Bloomie Pipeline] Tone: ${tone}`);
    console.log(`[Bloomie Pipeline] Urgency: ${urgency}`);
    console.log(`[Bloomie Pipeline] Route: ${route}`);
  }

  // ── Advice deduplication helpers ───────────────────────────────────────────────────
  // canGiveAdvice(code, maxTimes) returns true if advice hasn't exceeded the cap.
  // Registers the advice in ctx.adviceGiven when it returns true.
  function canGiveAdvice(code, maxTimes = 1) {
    const count = [...ctx.adviceGiven].filter(k => k === code || k.startsWith(code + "_")).length;
    if (count >= maxTimes) return false;
    // Use a versioned key so we can count occurrences: code_1, code_2 ...
    const versionedKey = count === 0 ? code : code + "_" + (count + 1);
    ctx.adviceGiven.add(versionedKey);
    return true;
  }

  // filterDedup(lines) removes any line containing repeated advice phrases.
  // Call this when constructing say() arrays in wrap/guide nodes.
  function filterDedup(lines) {
    const PROVIDER_PHRASES = [
      /see (a |your )?(healthcare )?provider/i,
      /visit (a |the )?(clinic|doctor|hospital)/i,
      /medical attention/i,
      /professional (advice|help|care)/i,
    ];
    let providerCount = [...ctx.adviceGiven].filter(k => k.startsWith("told_to_seek_care")).length;
    const TEST_PHRASES = [/pregnancy test/i, /take a test/i, /retest/i];
    const LOG_PHRASES = [/track(ing)? your cycle/i, /log(ging)? your period/i, /keep a log/i];
    return lines.filter(line => {
      if (typeof line !== "string") return true;
      if (PROVIDER_PHRASES.some(rx => rx.test(line))) {
        if (providerCount >= 2) return false;
        providerCount++;
      }
      if (TEST_PHRASES.some(rx => rx.test(line)) && ctx.adviceGiven.has("told_to_test")) return false;
      if (LOG_PHRASES.some(rx => rx.test(line)) && ctx.adviceGiven.has("logging_nudge")) return false;
      return true;
    });
  }


  // ── Anti-repetition helpers ───────────────────────────────────────────────

  /**
   * pickAvoiding(pool, exclude) → string
   * Picks a random item from pool, skipping exclude when a viable alternative
   * exists. Falls back to the full pool if every item matches exclude.
   */
  function pickAvoiding(pool, exclude) {
    if (!pool || pool.length === 0) return "";
    const filtered = pool.filter(item => item !== exclude);
    const source = filtered.length > 0 ? filtered : pool;
    return source[Math.floor(Math.random() * source.length)];
  }

  /**
   * wasNodeRecentlySeen(nodeKey, withinLast = 3) → boolean
   * Returns true when nodeKey appears in the last `withinLast` entries of
   * ctx.nodeHistory. Used to prevent tight node loops and repeated guidance.
   */
  function wasNodeRecentlySeen(nodeKey, withinLast = 3) {
    const recent = ctx.nodeHistory.slice(-withinLast);
    return recent.includes(nodeKey);
  }

  /**
   * hasContentBeenShown(id) → boolean
   * True when a content card with this id was shown in the current session
   * or was recorded in bloomieMemory from a prior session.
   */
  function hasContentBeenShown(id) {
    return ctx.contentSuggestionsShown.has(id);
  }

  /**
   * markContentShown(id) — record that a content card was shown.
   * Idempotent; safe to call multiple times for the same id.
   */
  function markContentShown(id) {
    if (typeof id === "string" && id.length > 0) ctx.contentSuggestionsShown.add(id);
  }

  /**
   * hasContentBeenDeclined(id) → boolean
   * True when the user previously dismissed or declined this content card.
   */
  function hasContentBeenDeclined(id) {
    return ctx.declinedSuggestions.has(id);
  }

  /**
   * markContentDeclined(id) — record that the user dismissed a content card.
   */
  function markContentDeclined(id) {
    if (typeof id === "string" && id.length > 0) ctx.declinedSuggestions.add(id);
  }

  // ---------------- HELPERS ----------------
  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function fmtDate(d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }


  const nowIso = () => new Date().toISOString();

  // ── Timing configuration ────────────────────────────────────────────────
  // Maximum entries kept in ctx.nodeHistory — oldest are dropped via shift().
  const NODE_HISTORY_MAX = 30;

  // Tune all Bloomie message pacing from one place.
  // calcDelay() and estimateSayTime() read these values - never hardcode ms.
  const BLOOMIE_TIMING = {
    firstBubbleMs: 500,   // delay before the very first bubble in any sequence
    msPerChar:       9,   // reading-pace coefficient (ms per visible character)
    renderBuffer:  150,   // padding added to estimateSayTime for render latency
    short:  { maxLen:  80, minMs:  650, maxMs:  800 },  // ≤ 80 chars
    medium: { maxLen: 220, minMs:  900, maxMs: 1200 },  // 81–220 chars
    long:   {             minMs: 1200, maxMs: 1500 },   // > 220 chars
  };

  // Returns the inter-bubble delay after showing `text` - scales with length.
  // If a node sets an explicit delayMs override, use that instead.
  function calcDelay(text) {
    const len = String(text ?? "").length;
    const raw = len * BLOOMIE_TIMING.msPerChar;
    if (len <= BLOOMIE_TIMING.short.maxLen)
      return Math.min(BLOOMIE_TIMING.short.maxMs, Math.max(BLOOMIE_TIMING.short.minMs, raw));
    if (len <= BLOOMIE_TIMING.medium.maxLen)
      return Math.min(BLOOMIE_TIMING.medium.maxMs, Math.max(BLOOMIE_TIMING.medium.minMs, raw));
    return Math.min(BLOOMIE_TIMING.long.maxMs, Math.max(BLOOMIE_TIMING.long.minMs, raw));
  }

  function clearTimers() {
    ctx.timers.forEach((id) => clearTimeout(id));
    ctx.timers.clear();
  }

  function lockUI(v) {
    ctx.locked = v;
    $box.querySelectorAll("button").forEach((b) => {
      b.disabled = v;
      b.setAttribute("aria-disabled", v ? "true" : "false");
    });
  }

  function pushMsg(from, text, meta = {}) {
    ctx.history.push({ from, text, meta, t: nowIso() });
    render();
  }

  // Advance the render epoch whenever the user sends a message.
  // Any buttons rendered with an older flowId are considered stale and
  // their click handlers will bail early, preventing dead branches from
  // re-activating old flows after the user has already switched topics.
  function advanceFlow() {
    ctx.flowId = (ctx.flowId || 0) + 1;
    console.log("[Bloomie] advanceFlow → flowId", ctx.flowId);
  }

  function recordAnswer(q, a) {
    ctx.answers.push({ q, a, t: nowIso() });
  }

  function scrollToBottom() {
    $box.scrollTop = $box.scrollHeight;
  }

  // say(lines, opts)
  // keepLocked - stay locked after the last message fires (use when a
  //              transition() is already scheduled right after this call,
  //              so the old node's buttons can never be clicked in the gap).
  // delayMs    - optional flat override for inter-bubble delay; when null
  //              (default) each gap is calculated from the previous bubble's
  //              length via calcDelay() using BLOOMIE_TIMING buckets.
  function say(lines, { delayMs = null, keepLocked = false, choices = null, question = null } = {}) {
    const _rawArr = Array.isArray(lines) ? lines : [lines];
    if (Array.isArray(choices) && choices.length) {
      ctx.inlineChoices = choices;
      ctx.inlineQuestion = typeof question === "string" && question.trim() ? question.trim() : null;
    } else {
      ctx.inlineChoices = null;
      ctx.inlineQuestion = null;
    }
    // Apply tone-aware line transforms (only when source ≠ rule_only AND depth ≥ 2)
    let arr = applyToneToLines(
      _rawArr,
      ctx.toneResult ?? null,
      ctx.conversationProfile?.sessionDepth ?? 0
    );
    arr = arr.map((line) => softenEscalationLine(line));
    if (ctx.policyContext?.ageGroup === "minor" || (ctx.isMinor && ctx.hasGuardianConsent)) {
      arr = arr.map((line) => sanitizeMinorEnglishLine(line));
    }
    lockUI(true);
    // Show typing indicator immediately so the user sees Bloomie "thinking"
    ctx.isTyping = true;
    render();
    let acc = 0;
    arr.forEach((t, idx) => {
      // First bubble: fixed lead-in. Subsequent bubbles: scale by the length
      // of the previous message (reading time) unless a flat override is set.
      const step = idx === 0
        ? BLOOMIE_TIMING.firstBubbleMs
        : (delayMs ?? calcDelay(arr[idx - 1]));
      acc += step;
      const id = setTimeout(() => {
        ctx.isTyping = false;  // hide indicator before each bubble appears
        const botLine = sanitizeBotLine(t);
        const fp = promptFingerprint(botLine);
        const lastMsg = ctx.history[ctx.history.length - 1];
        const isImmediateDuplicate =
          lastMsg?.from === "bot" &&
          promptFingerprint(lastMsg.text) === fp &&
          ctx.lastBotLineFingerprint === fp;
        if (!isImmediateDuplicate) {
          pushMsg("bot", botLine);
          playChatCue();
          speakBotLine(botLine);
          ctx.lastBotLineFingerprint = fp;
        }
        // Show indicator again between bubbles (not after the last one)
        if (idx < arr.length - 1) {
          ctx.isTyping = true;
          render();
        }
        if (idx === arr.length - 1 && !keepLocked) lockUI(false);
      }, acc);
      ctx.timers.add(id);
    });
  }

  // Returns the total wall-clock time say(sayValue, {delayMs}) will take,
  // used to schedule transitions and multi-choice prompts after say() ends.
  function estimateSayTime(sayValue, delayMs = null) {
    if (!sayValue) return 0;
    const lines = Array.isArray(sayValue) ? sayValue : [sayValue];
    if (!lines.length) return 0;
    let total = BLOOMIE_TIMING.firstBubbleMs;
    for (let i = 0; i + 1 < lines.length; i++) {
      total += delayMs ?? calcDelay(lines[i]);
    }
    return total + BLOOMIE_TIMING.renderBuffer;
  }

  function askMulti({ question, options, nextOnSubmit, allowNone = true }) {
    ctx.multiDraft = { question, options, selected: new Set(), nextOnSubmit, allowNone };
    render();
  }

  // Helper used by mode nodes to update userMode for the rest of the session
  function applySessionMode(mode) {
    // Just update sessionMode - userMode uses getters derived from effectiveMode()
    // so all checks update automatically without any manual property assignment.
    ctx.sessionMode = mode;
    console.log("[Bloomie] session mode →", mode);
  }

  function transition(nextState, payload = {}) {
    if (!nextState) return;
    const policyBlockActive =
      (ctx.policyContext?.ageGroup === "minor" || (ctx.isMinor && ctx.ageGroup === "minor")) &&
      !ctx.hasGuardianConsent;
    if (policyBlockActive) {
      const POLICY_ALLOWLIST = new Set([
        "POLICY_MINOR_CONSENT_REQUIRED",
        "END_CHAT_CONFIRM",
        "CLOSE",
        "SUMMARY",
      ]);
      if (!POLICY_ALLOWLIST.has(nextState)) {
        nextState = "POLICY_MINOR_CONSENT_REQUIRED";
      }
    }

    // ── MEDIUM confirm sentinel handlers ──────────────────────────────────
    if (nextState === "_MEDIUM_YES") {
      const route = ctx.pendingRoute;
      ctx.pendingRoute = null;
      // User confirmed — treat as successful routing and reset the struggle streak.
      ctx.confidenceFallbackCount = 0;
      if (route?.next) {
        transition(route.next, route.payload || {});
      } else {
        // pendingRoute was null or malformed — recover gracefully rather than
        // silently stranding the user. Use narrowingRepair so NARROWING shows
        // the warmer repair message instead of the generic picker.
        ctx.narrowingRepair = true;
        ctx.narrowingCandidates = null;
        transition("NARROWING");
      }
      return;
    }
    if (nextState === "_MEDIUM_NO") {
      ctx.pendingRoute = null;
      transition("NARROWING");
      return;
    }

    // ── Unresolved-concern close sentinels ───────────────────────────────
    if (nextState === "_UNRESOLVED_YES") {
      const UNRESOLVED_TOPIC_ENTRY_NODE = {
        late: "LATE_INTRO",
        heavy: "HEAVY_INTRO",
        spot: "SPOT_INTRO",
        pelvic: "PELVIC_INTRO",
        pregnancy: "PREGNANCY_ENTRY",
        discharge: "ELSE_DISCHARGE",
        mood: "MOOD_INTRO",
      };
      const topic = ctx.pendingUnresolvedTopic;
      ctx.pendingUnresolvedTopic = null;
      if (topic) {
        const list = ctx.conversationProfile?.concernsUnresolved || [];
        const idx = list.indexOf(topic);
        if (idx >= 0) list.splice(idx, 1);
      }
      transition(UNRESOLVED_TOPIC_ENTRY_NODE[topic] || "START_MENU");
      return;
    }
    if (nextState === "_UNRESOLVED_NO") {
      ctx.pendingUnresolvedTopic = null;
      // One-shot bypass so the immediate CLOSE transition does not re-prompt.
      ctx.closeSkipUnresolvedPrompt = true;
      transition("CLOSE");
      return;
    }

    // ── Reset struggle streak on successful exit from disambiguation ──────
    // When the user navigates FROM a disambiguation node (NARROWING or
    // CONFIDENCE_FALLBACK) TO any real content node, that is a recovery
    // event — reset confidenceFallbackCount so a later LOW starts fresh.
    {
      const _STRUGGLE_STATES = new Set(["NARROWING", "CONFIDENCE_FALLBACK"]);
      const _DISAMBIGUATION  = new Set(["NARROWING", "CONFIDENCE_FALLBACK", "MEDIUM_CONFIRM"]);
      if (_STRUGGLE_STATES.has(ctx.state) && !_DISAMBIGUATION.has(nextState)) {
        ctx.confidenceFallbackCount = 0;
        ctx.narrowingAttemptCount = 0;
        ctx.lastNarrowingPrompt = null;
      }
    }

    // Track progressive narrowing attempts so repeated disambiguation can
    // switch strategy instead of repeating the same menu prompt.
    if (nextState === "NARROWING" || nextState === "CONFIDENCE_FALLBACK") {
      ctx.narrowingAttemptCount = (ctx.narrowingAttemptCount || 0) + 1;
    }

    // ── END_CHAT sentinels ────────────────────────────────────────────────
    if (nextState === "_END_CHAT_CANCEL") {
      const returnTo = ctx.preEndChatState || "START_MENU";
      ctx.preEndChatState          = null;
      ctx.closeConfirmationPending = false;
      // closeIntentDetected stays true — user expressed intent to leave even if they cancelled
      transition(returnTo);
      return;
    }
    if (nextState === "_END_CHAT_RESET") {
      clearTimers();
      // Capture resolution status before wiping ctx, so persistMemory can include it
      const _finalResolution = ctx.resolutionStatus ?? "skipped";
      // Reset session context — mirrors the public reset() method
      ctx.history                   = [];
      ctx.answers                   = [];
      ctx.multiDraft                = null;
      ctx.locked                    = false;
      ctx.urgency                   = false;
      ctx.topic                     = null;
      ctx.riskLevel                 = "low";
      ctx.adviceGiven               = new Set();
      ctx.entityHistory             = [];
      ctx.lastEntities              = null;
      ctx.lastInferredReason        = null;
      ctx.lastCycleCtx              = null;
      ctx.pendingRoute              = null;
      ctx.inlineChoices             = null;
      ctx.inlineQuestion            = null;
      ctx.pendingAmbiguityContext   = null;
      ctx.pendingContradictionContext = null;
      ctx.pendingContextProbe       = null;
      ctx.recentInputs              = [];
      ctx.preEndChatState           = null;
      ctx.closeConfirmationPending  = false;
      ctx.closeIntentDetected       = false;
      ctx.pendingUnresolvedTopic    = null;
      ctx.closeSkipUnresolvedPrompt = false;
      ctx.resolutionStatus          = null;
      ctx.toneRequestId             = 0;
      ctx.narrowingAttemptCount     = 0;
      ctx.lastNarrowingPrompt       = null;
      ctx.lastClarifierFingerprint  = null;
      ctx.lastClarifierTurn         = -1;
      ctx.lastBotLineFingerprint    = null;
      // Persist close-time fields before full reset
      const _closeMemory = loadLocalBloomieMemory() || {};
      const _closeUpdate = {
        ..._closeMemory,
        lastResolutionStatus:    _finalResolution,
        closeIntentDetected:     true,
        lastSessionDate:         new Date().toISOString(),
        contentSuggestionsShown: [...ctx.contentSuggestionsShown].slice(0, 50),
        declinedSuggestions:     [...ctx.declinedSuggestions].slice(0, 50),
        lastGreetingUsed:        ctx.lastUsedGreeting ?? null,
        reportedConditions:      ctx.reportedConditions.slice(0, 20),
        activeTopicCluster:      ctx.reportedConditions.length > 0
          ? ctx.reportedConditions[ctx.reportedConditions.length - 1]
          : null,
      };
      if (!ctx.isAnon) {
        saveLocalBloomieMemory(_closeUpdate);
        if (onSaveMemory) onSaveMemory(_closeUpdate);
      }
      ctx.state                     = "START";
      // Polite goodbye before restarting
      say("Thanks for chatting with me 🩷 I'm always here if you need support.");
      const tid = setTimeout(() => transition("START"), 2500);
      ctx.timers.add(tid);
      return;
    }

    // ── Safety log: escalation — "seek care" node reached ─────────────────
    if (nextState === "HEAVY_URGENT") {
      logSafetyEvent("escalation", {
        fromNode:  ctx.state,
        symptoms:  ctx.lastEntities
          ? Object.entries(ctx.lastEntities.symptoms).filter(([,v]) => v).map(([k]) => k)
          : [],
        topic:     ctx.topic,
        riskLevel: ctx.riskLevel,
      });
    }

    // ── nodeHistory: record outgoing state before overwriting ─────────────
    // Only record when moving to a different node — self-transitions (e.g.
    // a re-render) do not create a new history entry.
    if (ctx.state !== nextState) {
      ctx.nodeHistory.push(ctx.state);
      if (ctx.nodeHistory.length > NODE_HISTORY_MAX) ctx.nodeHistory.shift();
    }

    ctx.inlineChoices = null;
    ctx.inlineQuestion = null;
    ctx.state = nextState;

    // ── Conversation profile: track topics and resolve concerns ──────────────
    {
      const prof = ctx.conversationProfile;
      const TOPIC_NODE_MAP = {
        LATE_INTRO: "late", LATE_PERIOD_CHECK: "late", TEST_INTRO: "late",
        HEAVY_INTRO: "heavy", HEAVY_ROUTE_B: "heavy", HEAVY_ROUTE_C: "heavy", HEAVY_ROUTE_C_GATE: "heavy",
        SPOT_INTRO: "spot", SPOT_PREG_INFO: "spot",
        MOOD_SAFETY_CHECK: "mood", MOOD_INTRO: "mood", MOOD_GUIDE: "mood",
        PELVIC_INTRO: "pelvic", PELVIC_SAFETY_CHECK: "pelvic", PELVIC_SAFETY_GATE: "pelvic",
        PREGNANCY_ENTRY: "pregnancy",
        ELSE_DISCHARGE: "discharge", ELSE_DISCHARGE_ENTRY: "discharge",
      };
      // Track topic entered
      const topicCode = TOPIC_NODE_MAP[nextState];
      if (topicCode && !prof.topicsDiscussed.includes(topicCode)) {
        prof.topicsDiscussed.push(topicCode);
      }
      // Mark topic as resolved using an explicit resolved-node mapping.
      // This avoids coupling "resolved" detection to TOPIC_NODE_MAP entry nodes.
      // Includes legacy *_GUIDE aliases plus current wrap/end nodes.
      const RESOLVED_NODE_TOPIC_MAP = {
        // Legacy guide aliases (kept for backward compatibility)
        LATE_GUIDE: "late",
        HEAVY_GUIDE: "heavy",
        SPOT_GUIDE: "spot",
        PELVIC_GUIDE: "pelvic",
        PREG_GUIDE: "pregnancy",

        // Current end/wrap nodes
        MOOD_GUIDE: "mood",
        LATE_WRAP: "late",
        HEAVY_MONITOR: "heavy",
        HEAVY_SOON: "heavy",
        HEAVY_AFTER_CARE: "heavy",
        SPOT_TRACK_WRAP: "spot",
        SPOT_PROVIDER_SOON: "spot",
        PELVIC_MANAGEABLE: "pelvic",
        PELVIC_PERSISTENT: "pelvic",
        PELVIC_REVIEW_SOON: "pelvic",
        LATE_POSITIVE: "pregnancy",
      };
      const resolvedTopic = RESOLVED_NODE_TOPIC_MAP[nextState] || null;
      if (resolvedTopic && !prof.concernsResolved.includes(resolvedTopic)) {
        prof.concernsResolved.push(resolvedTopic);
      }
      // Surface unresolved concerns before CLOSE unless this close transition
      // is an explicit one-shot bypass from "_UNRESOLVED_NO".
      if (nextState === "CLOSE" && ctx.closeSkipUnresolvedPrompt) {
        ctx.closeSkipUnresolvedPrompt = false;
      } else if (nextState === "CLOSE" && prof.concernsUnresolved.length > 0) {
        const TOPIC_LABELS = {
          late: "late or missed period", heavy: "heavy bleeding", spot: "spotting",
          mood: "mood or energy changes", pelvic: "pelvic pain or cramps",
          pregnancy: "pregnancy concerns", discharge: "discharge",
        };
        const firstUnresolved = prof.concernsUnresolved[0];
        ctx.pendingUnresolvedTopic = firstUnresolved;
        transition("CLOSE_UNRESOLVED_CONFIRM", {
          unresolvedLabel: TOPIC_LABELS[firstUnresolved] || firstUnresolved,
        });
        return;
      }
    }

    const node = NODES[nextState];
    if (!node) {
      const fallbackState = "START_MENU";
      const isDev =
        (typeof import.meta !== "undefined" && !!import.meta.env?.DEV) ||
        (typeof process !== "undefined" && process?.env?.NODE_ENV !== "production");
      if (isDev) {
        console.warn("[Bloomie] Missing node transition target", {
          missingNode: nextState,
          currentState: ctx.state,
          fallbackState,
        });
      }
      logAnalyticsEvent("missing_node_fallback", { missingNode: nextState, fallbackState }, ctx);

      const repairLine = "I lost my place for a second, but I'm still with you 🩷 Let's continue from here.";

      // Prefer a real node fallback so the conversation can continue naturally.
      if (nextState !== fallbackState && NODES[fallbackState]) {
        clearTimers();
        say([repairLine], { keepLocked: true });
        const tid = setTimeout(() => transition(fallbackState), estimateSayTime([repairLine]));
        ctx.timers.add(tid);
      } else {
        // Last-resort recovery if START_MENU is unavailable.
        clearTimers();
        pushMsg("bot", repairLine);
        lockUI(false);
        render();
      }
      return;
    }
    // Fire onEnter hook - used by session mode setters and gate nodes
    if (typeof node.onEnter === "function") {
      node.onEnter();
      // Gate nodes (say: []) handle their own redirect inside onEnter - stop here
      if (Array.isArray(node.say) && node.say.length === 0) return;
    }
    clearTimers();
    if (node.say) {
      const lines = typeof node.say === "function" ? node.say(ctx, payload) : node.say;
      say(lines, { delayMs: node.delayMs ?? null });
    }
    if (node.multi) {
      const m = typeof node.multi === "function" ? node.multi(ctx, payload) : node.multi;
      const id = setTimeout(() => askMulti(m), estimateSayTime(node.say, node.delayMs ?? null));
      ctx.timers.add(id);
      return;
    }
    if (node.autoNext) {
      const computed = node.autoNext(ctx, payload);
      if (computed) {
        const id = setTimeout(() => transition(computed, payload), 250);
        ctx.timers.add(id);
      } else {
        render();
      }
      return;
    }
    render();
  }

  function buildSummaryText() {
    const header = "Bloom Summary (Not a diagnosis)";
    const items = ctx.answers.map((a) => `• ${a.q}: ${Array.isArray(a.a) ? a.a.join(", ") : a.a}`);

    // Include structured guidance summary if entities were extracted this session
    const structuredParts = [];
    if (ctx.lastEntities) {
      const summary = getStructuredSummary(ctx.lastEntities, ctx.lastInferredReason, ctx.lastCycleCtx);
      if (summary) {
        structuredParts.push("");
        structuredParts.push("── Inferred Scenario ──");
        if (summary.situation)  structuredParts.push(`Situation: ${summary.situation}`);
        if (summary.meaning)    structuredParts.push(`Context: ${summary.meaning}`);
        if (summary.nextSteps)  structuredParts.push(`Recommended next steps: ${summary.nextSteps}`);
        if (summary.urgentSigns) structuredParts.push(`Urgent signs to watch: ${summary.urgentSigns}`);
        const syms = summary.extractedEntities?.symptoms;
        if (syms?.length) structuredParts.push(`Detected symptoms: ${syms.join(", ")}`);
        if (summary.extractedEntities?.duration)
          structuredParts.push(`Duration mentioned: ${summary.extractedEntities.duration}`);
        if (summary.extractedEntities?.severity)
          structuredParts.push(`Severity: ${summary.extractedEntities.severity}`);
      }
    }

    // Include symptom engine patterns and guidance if signals were generated
    if (ctx.integratedSignals?.symptomSignals?.length) {
      const sCtx = getBloomieSymptomContext(ctx.integratedSignals.symptomSignals);
      if (sCtx.patternDetected) {
        structuredParts.push(`Detected symptom pattern: ${sCtx.patternDetected}`);
      }
      if (sCtx.guidanceLines?.length) {
        structuredParts.push("Symptom guidance:");
        sCtx.guidanceLines.forEach(l => structuredParts.push(`  • ${l}`));
      }
      if (sCtx.hasUrgentSignal) {
        structuredParts.push("⚠ One or more urgent symptom signals were detected this session.");
      }
    }

    const footer = "If symptoms worsen or you feel unsafe, seek urgent care.";
    return [header, ...items, ...structuredParts, footer].join("\n");
  }

  // ── Summary card builder ───────────────────────────────────────────────────
  // Produces an HTML string for the SUMMARY node bubble.
  // All content is internally generated - never interpolates raw user text
  // into HTML without going through escapeHtml().
  function buildSummaryCard() {
    // ── Section 1: What I heard - detected symptoms ───────────────────────
    const TOPIC_LABELS = {
      late_period:      "a late or missed period",
      heavy_bleeding:   "heavy or unusual bleeding",
      spotting:         "spotting between periods",
      pelvic_pain:      "pelvic pain or cramps",
      mood_changes:     "hormonal mood changes",
      pregnancy:        "pregnancy-related concerns",
      discharge:        "unusual discharge",
      ttc:              "trying to conceive",
      postpartum:       "postpartum recovery",
    };

    const ADVICE_LABELS = {
      told_to_test:      "Take a pregnancy test",
      told_to_seek_care: "See a healthcare provider soon",
      told_to_monitor:   "Keep track of your symptoms over the next few days",
      told_to_rest:      "Rest and monitor how you feel",
      told_to_call_119:  "Call emergency services or go to A&E immediately",
      told_about_sti:    "Speak with a provider about STI screening",
    };

    // Detected symptoms → plain-English labels via SYMPTOM_TO_CATALOG_KEYS + CATALOG_LABELS
    let symptomItems = "";
    if (ctx.lastEntities?.symptoms) {
      const codes = new Set();
      for (const [key, fired] of Object.entries(ctx.lastEntities.symptoms)) {
        if (fired && SYMPTOM_TO_CATALOG_KEYS[key]) {
          SYMPTOM_TO_CATALOG_KEYS[key].forEach(c => codes.add(c));
        }
      }
      const labels = [...codes].map(c => CATALOG_LABELS[c]).filter(Boolean);
      if (labels.length) {
        symptomItems = labels.map(l => `<li>${escapeHtml(l)}</li>`).join("");
      }
    }
    const heardSection = symptomItems
      ? `<ul class="summary-list">${symptomItems}</ul>`
      : `<p class="summary-none">No specific symptoms were detected in our conversation.</p>`;

    // ── Section 2: What this might be about ──────────────────────────────
    const topicLabel = ctx.topic ? TOPIC_LABELS[ctx.topic] || ctx.topic.replace(/_/g, " ") : null;
    const aboutLine = topicLabel
      ? `This sounds like it could be related to <strong>${escapeHtml(topicLabel)}</strong>.`
      : `We covered a few different topics in our chat.`;

    // ── Section 3: What to do next ────────────────────────────────────────
    let nextItems = "";
    if (ctx.adviceGiven?.size) {
      nextItems = [...ctx.adviceGiven]
        .map(code => ADVICE_LABELS[code] || escapeHtml(code.replace(/_/g, " ")))
        .map(label => `<li>${label}</li>`)
        .join("");
    }
    const nextSection = nextItems
      ? `<ul class="summary-list">${nextItems}</ul>`
      : `<p class="summary-none">Keep tracking how you feel and reach out if anything changes.</p>`;

    // ── Section 4: When to seek urgent care (always present) ─────────────
    const urgentLine = "Go to emergency care right away if you experience soaking through a pad in under 2 hours, severe one-sided pain, fainting, difficulty breathing, or any symptom that feels out of the ordinary for you.";

    return `
      <div class="summary-card">
        <div class="summary-header">Your session summary</div>
        <p class="summary-disclaimer">This is not a diagnosis - it's a record of what we talked about 🩷</p>
        <div class="summary-section">
          <div class="summary-section-title">What I heard</div>
          ${heardSection}
        </div>
        <div class="summary-section">
          <div class="summary-section-title">What this might be about</div>
          <p>${aboutLine}</p>
        </div>
        <div class="summary-section">
          <div class="summary-section-title">What to do next</div>
          ${nextSection}
        </div>
        <div class="summary-section summary-section--urgent">
          <div class="summary-section-title">When to seek urgent care</div>
          <p>${escapeHtml(urgentLine)}</p>
        </div>
      </div>`;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replaceAll('"', "&quot;");
  }

  // ── Feedback submission ──────────────────────────────────────────────────
  // Fire-and-forget: never throws, never blocks the UI.
  async function _sendFeedback(feedbackType, messageText) {
    try {
      const token = await getIdToken();   // null if not signed in
      const uid   = getUser()?.uid ?? null;

      const conversationSlice = ctx.history
        .slice(-3)
        .map((m) => ({ from: m.from, text: String(m.text ?? "").slice(0, 200) }));

      const body = {
        sessionId,
        userId:            uid || "anonymous",
        nodeId:            ctx.state ?? null,
        flowName:          ctx.topic  ?? null,
        messageText:       String(messageText ?? "").slice(0, 500),
        feedbackType,
        conversationSlice,
      };

      const headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const API_BASE = window.BLOOM_API_BASE || "";
      await fetch(`${API_BASE}/api/feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (_) {
      // Silently swallow - feedback must never break the chat flow
    }
  }

  function handleReaction(msgIndex, feedbackType) {
    const m = ctx.history[msgIndex];
    if (!m || m.from !== "bot") return;
    m.meta = m.meta || {};
    // Prevent double-submission on the same message
    if (m.meta.feedbackSubmitted) return;
    m.meta.feedbackSubmitted = feedbackType;
    render();
    _sendFeedback(feedbackType, m.text).catch(() => {});
  }

  function render() {
    const lastBotIndex = (() => {
      for (let i = ctx.history.length - 1; i >= 0; i--) {
        if (ctx.history[i].from === "bot") return i;
      }
      return -1;
    })();

    $box.innerHTML = `
      <div class="chat-thread">
        ${ctx.history.map((m, i) => {
          const isBot = m.from === "bot";
          const showReactions = isBot && i === lastBotIndex && !ctx.isTyping;
          return `
            <div class="msg ${m.from}">
              <div class="bubble${m.meta?.html && isHtmlPayloadAuthorized(m.meta) ? " bubble--html" : ""}">${m.meta?.html && isHtmlPayloadAuthorized(m.meta) ? m.text : escapeHtml(m.text).replaceAll("\n", "<br>")}</div>
              ${showReactions ? (
                m.meta?.feedbackSubmitted
                  ? `<div class="bubble-actions bubble-actions--thanks" aria-live="polite">Thanks for the feedback 🩷</div>`
                  : `<div class="bubble-actions" aria-label="Message reactions">
                  <button class="react-btn" data-react="thumbs_up" data-idx="${i}" type="button" title="Helpful">👍</button>
                  <button class="react-btn" data-react="thumbs_down" data-idx="${i}" type="button" title="Not helpful">👎</button>
                </div>`
              ) : ""}
            </div>`;
        }).join("")}
        ${ctx.isTyping ? `
        <div class="msg bot">
          <div class="bubble bubble--typing" aria-label="Bloomie is typing">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
        </div>` : ""}
      </div>`;

    $box.querySelectorAll("[data-react][data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (ctx.locked) return;
        handleReaction(Number(btn.getAttribute("data-idx")), btn.getAttribute("data-react"));
      });
    });

    const choicesEl = document.createElement("div");
    choicesEl.className = "choices choices--stack";
    $box.appendChild(choicesEl);

    if (ctx.multiDraft) {
      const d = ctx.multiDraft;
      choicesEl.innerHTML = `
        <div class="multi">
          <div class="multi-q">${escapeHtml(d.question)}</div>
          <div class="multi-options multi-options--stack">
            ${d.options.map((opt) => {
              const on = d.selected.has(opt) ? "on" : "";
              return `<button class="chip ${on}" data-opt="${encodeURIComponent(opt)}" type="button">${escapeHtml(opt)}</button>`;
            }).join("")}
          </div>
          <div class="multi-actions">
            <button class="btn primary" data-action="multi-submit" type="button">Continue</button>
            <button class="btn" data-action="multi-clear" type="button">Clear</button>
          </div>
        </div>`;

      choicesEl.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (ctx.locked) return;
          const opt = decodeURIComponent(btn.getAttribute("data-opt") || "");
          if (d.selected.has(opt)) d.selected.delete(opt); else d.selected.add(opt);
          render();
        });
      });
      choicesEl.querySelector('[data-action="multi-clear"]')?.addEventListener("click", () => {
        if (ctx.locked) return; d.selected.clear(); render();
      });
      choicesEl.querySelector('[data-action="multi-submit"]')?.addEventListener("click", () => {
        if (ctx.locked) return;
        const selectedArr = Array.from(d.selected);
        if (!d.allowNone && selectedArr.length === 0) return;
        const label = selectedArr.length ? selectedArr.join(", ") : "None";
        pushMsg("user", label);
        recordAnswer(d.question, selectedArr.length ? selectedArr : ["None"]);
        const next = d.nextOnSubmit;
        ctx.multiDraft = null;
        transition(next, { multi: selectedArr });
      });
      scrollToBottom();
      return;
    }

    const node = NODES[ctx.state];
    const tonedChoices = applyToneToChoices(
      resolveChoices(node),
      ctx.toneResult ?? null,
      ctx.conversationProfile?.sessionDepth ?? 0
    );
    const _choices = (ctx.policyContext?.ageGroup === "minor" || (ctx.isMinor && ctx.hasGuardianConsent))
      ? tonedChoices.map((c) => ({ ...c, label: sanitizeMinorEnglishLine(c.label) }))
      : tonedChoices;
    // Snapshot the flow ID at render time so buttons can detect if they're stale.
    const renderedFlowId = ctx.flowId;
    if (_choices.length) {
      // Track the epoch at which this node's choices were rendered so that
      // matchTypedToChoice can apply the same staleness guard as button clicks.
      ctx.nodeFlowId = renderedFlowId;
      const activeQuestion = ctx.inlineQuestion || node?.question || null;
      // Record the active question shape so the very next typed message is
      // first interpreted as an answer to this question (turn binding).
      ctx.pendingQuestion = { type: classifyNodeQuestion(_choices), nodeState: ctx.state };

      choicesEl.innerHTML = `
        <div class="quick-replies">
          ${_choices.map((c) => `
            <button class="reply ${c.primary ? "reply--primary" : ""}" data-choice="${escapeAttr(c.id)}" data-flow="${renderedFlowId}" type="button">
              ${escapeHtml(c.label)}
            </button>`).join("")}
        </div>`;

      choicesEl.querySelectorAll("button[data-choice]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (ctx.locked) return;
          // Stale button guard: if flowId has advanced since this button was
          // rendered, the user has already switched topics via free text.
          // Silently discard the click so the old branch cannot reactivate.
          const btnFlowId = parseInt(btn.getAttribute("data-flow") ?? "-1", 10);
          if (btnFlowId !== ctx.flowId) return;
          const choiceId = btn.getAttribute("data-choice");
          const choice = _choices.find((x) => x.id === choiceId);
          if (!choice) return;
          if (isMinorPolicyBlocked()) {
            transition("POLICY_MINOR_CONSENT_REQUIRED");
            return;
          }
          advanceFlow();
          pushMsg("user", choice.label);
          // Refresh tone from the button label so downstream say/choices transforms
          // are not stale from a previous typed message. Rule-only (no AI call needed
          // for a button selection — the label itself carries the emotional signal).
          ctx.currentTone = detectUserTone(choice.label) ?? ctx.currentTone;
          ctx.toneResult  = { tone: ctx.currentTone, intensity: "medium", subtext: "none", source: "rule_only" };
          if (activeQuestion) recordAnswer(activeQuestion, choice.label);
          if (choice.action === "OPEN_MAP")      onOpenCareMap();
          if (choice.action === "REQUEST_PDF") {
            if (ctx.isAnon) { say(["To save a PDF summary, you'll need a free Bloom account 🩷 Sign up to keep a record of your conversations."]); }
            else { onRequestPdf(buildSummaryText()); }
          }
          if (choice.action?.startsWith("LOG_")) onLogAction(choice.action, choice.logData || {});
          if (typeof choice.onSelect === "function") choice.onSelect();
          // "I'm done for now" → SUMMARY when there's advice to show
          const effectiveNext = (choice.id === "done" && choice.next === "CLOSE" && ctx.adviceGiven.size > 0)
            ? "SUMMARY"
            : choice.next;
          transition(effectiveNext, { choiceId });
        });
      });
    } else {
      // No choices — clear any stale question type from a previous node so
      // free-text input nodes don't accidentally apply turn binding.
      ctx.pendingQuestion = null;
    }

    scrollToBottom();
  }

  // ---------- Conversation Nodes ----------

  const SYMPTOM_MEMORY_RECALL_MAX_AGE_MS = 72 * 60 * 60 * 1000; // conservative: only recall explicit symptoms from last 72h
  const SYMPTOM_RECALL_BLOCKED_STATES = new Set([
    "START", "START_MENU", "NARROWING", "CONFIDENCE_FALLBACK",
    "ELSE_NOT_SURE_ROUTE", "END_CHAT_CONFIRM", "CLOSE",
  ]);

  function inferRecallTopicFromState(state = "") {
    if (/^MOOD_/.test(state)) return "mood";
    if (/^LATE_/.test(state)) return "late";
    if (/^HEAVY_/.test(state)) return "heavy";
    if (/^SPOT_/.test(state)) return "spot";
    if (/^PELVIC_/.test(state)) return "pelvic";
    if (/^PREG_|^TEST_/.test(state)) return "pregnancy";
    if (/DISCHARGE/.test(state)) return "discharge";
    return null;
  }

  function shouldRecallSymptomMemory({ topicHint = null } = {}) {
    if (ctx.isAnon) return false;
    if (SYMPTOM_RECALL_BLOCKED_STATES.has(ctx.state)) return false;
    // Brand-new turn safety: do not surface symptom-memory callbacks out of nowhere.
    // flowId increments on the first real user action (typed or choice click).
    if ((ctx.flowId ?? 0) < 1) return false;

    const source = String(bloomieMemory?.lastSymptomsSource || "");
    if (!source.startsWith("explicit")) return false;

    const lastSymptomsAtRaw = bloomieMemory?.lastSymptomsAt || null;
    if (!lastSymptomsAtRaw) return false; // legacy objects without timestamp fail safe
    const lastSymptomsAt = new Date(lastSymptomsAtRaw);
    if (Number.isNaN(lastSymptomsAt.getTime())) return false;
    if (Date.now() - lastSymptomsAt.getTime() > SYMPTOM_MEMORY_RECALL_MAX_AGE_MS) return false;

    const symptoms = Array.isArray(bloomieMemory?.lastSymptoms)
      ? bloomieMemory.lastSymptoms
      : [];
    const validSymptoms = symptoms
      .filter(k => typeof k === "string" && VALID_SYMPTOM_KEYS.has(k) && !WEAK_MEMORY_SYMPTOM_KEYS.has(k))
      .slice(0, 8);
    if (!validSymptoms.length) return false;

    const topic = topicHint || inferRecallTopicFromState(ctx.state);
    if (!topic) return false;
    const memoryTopics = new Set(validSymptoms.map(symptomKeyToTopic).filter(Boolean));
    if (!memoryTopics.has(topic)) return false;

    return true;
  }

  // Returns a recall sentence only when persisted symptom memory is explicit,
  // recent, and relevant to the current topic context.
  function buildRecallLine({ topicHint = null } = {}) {
    if (!shouldRecallSymptomMemory({ topicHint })) return null;

    const topic = topicHint || inferRecallTopicFromState(ctx.state);
    const labels = [...new Set(
      (bloomieMemory?.lastSymptoms || [])
        .filter(k => VALID_SYMPTOM_KEYS.has(k) && !WEAK_MEMORY_SYMPTOM_KEYS.has(k))
        .filter(k => symptomKeyToTopic(k) === topic)
        .flatMap(key => SYMPTOM_TO_CATALOG_KEYS[key] || [])
        .map(code => CATALOG_LABELS[code])
        .filter(Boolean)
        .slice(0, 3)
    )];
    if (!labels.length) return null;

    const list = labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;

    return pick([
      `You mentioned **${list}** recently. Is that still happening, or is this something different?`,
      `You've mentioned **${list}** before. Is that still going on right now?`,
    ]);
  }


  // Returns "you tend to log [X] around this time" or null.
  // Guards: no symptomHistory, no SYMPTOM_PATTERN signal with show:true, already shown.
  function buildSymptomPatternLine(catalogCodes) {
    if (ctx.isAnon) return null;
    if (!Array.isArray(symptomHistory) || !symptomHistory.length) return null;
    if (!Array.isArray(catalogCodes) || !catalogCodes.length) return null;
    if (ctx.adviceGiven.has("symptom_pattern_line")) return null;

    const PATTERN_CODES = new Set([
      "SYMPTOMS_MATCH_PMS_PATTERN",
      "SYMPTOMS_MATCH_MENSTRUAL_PATTERN",
      "SYMPTOMS_MATCH_OVULATION_PATTERN",
      "SYMPTOMS_MATCH_PERIMENOPAUSE_PATTERN",
      "SYMPTOMS_MATCH_HORMONAL_PATTERN",
    ]);
    const hasPatternSignal = ctx.integratedSignals?.symptomSignals?.some(
      s => PATTERN_CODES.has(s.code) && s.show
    );
    if (!hasPatternSignal) return null;

    const matchedLabels = catalogCodes
      .filter(code => {
        const count = symptomHistory.filter(entry =>
          Array.isArray(entry.items) && entry.items.some(item => item.code === code)
        ).length;
        return count >= 2;
      })
      .map(code => CATALOG_LABELS[code] || code.replace(/_/g, " ").toLowerCase())
      .filter(Boolean);

    if (!matchedLabels.length) return null;

    ctx.adviceGiven.add("symptom_pattern_line");

    const list = matchedLabels.length === 1
      ? matchedLabels[0]
      : `${matchedLabels.slice(0, -1).join(", ")} and ${matchedLabels.at(-1)}`;

    return pick([
      `I can see from your logs that you tend to experience **${list}** around this time 🩷`,
      `Your logs show **${list}** tends to come up around this point in your cycle 🩷`,
      `Looking at your history, **${list}** is something you tend to log around now 🩷`,
    ]);
  }

  // Returns one user-facing symptom intelligence line, or null.
  // Priority: bloomieInsight → more intense → persisting longer → new symptom → frequency increasing → logging nudge.
  // Guards: anon, urgency, no symptom signals, per-line adviceGiven keys.
  function buildSymptomInsightLine() {
    if (ctx.isAnon) return null;
    if (ctx.urgency) return null;
    const symptomSignals = ctx.integratedSignals?.symptomSignals;
    if (!Array.isArray(symptomSignals) || !symptomSignals.length) return null;

    // ── bloomieInsight from primarySignal ──────────────────────────────────
    if (!ctx.adviceGiven.has("symptom_insight")) {
      const sCtx = getBloomieSymptomContext(symptomSignals);
      if (sCtx.bloomieInsight && !sCtx.safetyEscalationNeeded && !sCtx.hasUrgentSignal) {
        ctx.adviceGiven.add("symptom_insight");
        return sCtx.bloomieInsight;
      }
    }

    // ── Baseline deviation signals (one at a time) ─────────────────────────
    if (!ctx.adviceGiven.has("symptom_baseline_intense")) {
      const sig = symptomSignals.find(s => s.code === "SYMPTOMS_MORE_INTENSE_THAN_USUAL" && s.show);
      if (sig) {
        ctx.adviceGiven.add("symptom_baseline_intense");
        return pick([
          "Looking at your logs, some of what you're feeling seems more intense than usual for you — worth keeping an eye on 🩷",
          "Your history suggests these symptoms are running a bit stronger than your typical pattern 🩷",
        ]);
      }
    }

    if (!ctx.adviceGiven.has("symptom_baseline_persisting")) {
      const sig = symptomSignals.find(s => s.code === "SYMPTOMS_PERSISTING_LONGER_THAN_USUAL" && s.show);
      if (sig) {
        ctx.adviceGiven.add("symptom_baseline_persisting");
        return pick([
          "Your logs suggest this has been going on a bit longer than is usual for you — that's worth noting 🩷",
          "Based on your history, this is lasting longer than your typical pattern — good to keep track of 🩷",
        ]);
      }
    }

    if (!ctx.adviceGiven.has("symptom_baseline_new")) {
      const sig = symptomSignals.find(s => s.code === "NEW_SYMPTOM_DETECTED" && s.show);
      if (sig) {
        ctx.adviceGiven.add("symptom_baseline_new");
        return pick([
          "I noticed something a little new in your recent logs — it may be nothing, but it's worth logging again if it comes back 🩷",
          "This doesn't appear often in your history — if it keeps showing up, it's worth mentioning to a provider 🩷",
        ]);
      }
    }

    if (!ctx.adviceGiven.has("symptom_baseline_trending")) {
      const sig = symptomSignals.find(s => s.code === "SYMPTOM_FREQUENCY_INCREASING" && s.show);
      if (sig) {
        ctx.adviceGiven.add("symptom_baseline_trending");
        return pick([
          "Looking at your recent history, the intensity of some symptoms seems to be increasing across cycles — that pattern is worth discussing with a provider 🩷",
          "Your logs suggest things have been gradually getting stronger across recent cycles — worth keeping track of 🩷",
        ]);
      }
    }

    // ── Logging nudge — lowest priority ────────────────────────────────────
    if (!ctx.adviceGiven.has("symptom_logging_nudge")) {
      const sCtx = getBloomieSymptomContext(symptomSignals);
      if (sCtx.shouldNudgeLogging) {
        ctx.adviceGiven.add("symptom_logging_nudge");
        return pick([
          "One thing that would really help me give you better insight: logging your symptoms a little more regularly — even a quick check-in every few days 🩷",
          "More regular symptom logs help me spot patterns for you much more accurately — even rough entries count 🩷",
        ]);
      }
    }

    return null;
  }

  // Returns one personalised cycle-context line, or null.
  // Guards: urgency, no signals, already shown this session.
  function buildCyclePersonalisationLine(context) {
    if (ctx.isAnon) return null;
    if (ctx.urgency) return null;
    const cycleSignals = ctx.integratedSignals?.cycleSignals;
    if (!cycleSignals?.length) return null;
    if (ctx.adviceGiven.has("cycle_line_late")) return null;

    const codes = new Set(cycleSignals.map(s => s.code));

    // late + IRREGULAR_CYCLE → variability days line
    if (context === "late" && codes.has("IRREGULAR_CYCLE")) {
      const v = ctx.cycleVariability;
      ctx.adviceGiven.add("cycle_line_late");
      return (v !== null && v !== undefined && v > 0)
        ? `Your recent cycles have varied by up to ${v} days — that kind of pattern makes it harder to know exactly when to expect your period 🩷`
        : "Your recent cycles have shown more variability than usual, which can make it harder to know when to expect your period 🩷";
    }

    // late + LATE_PERIOD → signal message
    if (context === "late" && codes.has("LATE_PERIOD")) {
      const sig = cycleSignals.find(s => s.code === "LATE_PERIOD" && s.show && s.message);
      if (!sig) return null;
      ctx.adviceGiven.add("cycle_line_late");
      return sig.message;
    }

    // irregular context → pattern acknowledgment
    if (context === "irregular") {
      const sig = cycleSignals.find(s => s.code === "IRREGULAR_CYCLE" && s.show && s.message);
      if (!sig) return null;
      ctx.adviceGiven.add("cycle_line_late");
      return sig.message;
    }

    // CYCLE_TREND medium/high → trend note (context-independent)
    const trendSig = cycleSignals.find(s =>
      (s.code === "LENGTHENING_CYCLE_TREND" || s.code === "SHORTENING_CYCLE_TREND") &&
      s.show && s.level === "medium" && s.message
    );
    if (trendSig) {
      ctx.adviceGiven.add("cycle_line_late");
      return trendSig.message;
    }

    return null;
  }

  // Returns one natural-language line for a dead/disconnected cycle signal, or null.
  // Handles: LOGGING_GAP, PREDICTION_DRIFT, SUDDEN_CYCLE_SHIFT.
  // Guards: urgency active, no cycle signals, already shown this session.
  // context: "general" | "late" (currently unused but reserved for future filtering)
  function buildCycleSignalLine(context = "general") {  // eslint-disable-line no-unused-vars
    if (ctx.urgency) return null;
    const cycleSignals = ctx.integratedSignals?.cycleSignals;
    if (!Array.isArray(cycleSignals) || !cycleSignals.length) return null;

    // LOGGING_GAP — gently nudge logging; only once per session
    if (
      !ctx.adviceGiven.has("cycle_logging_gap") &&
      cycleSignals.some(s => s.code === "LOGGING_GAP" && s.show)
    ) {
      ctx.adviceGiven.add("cycle_logging_gap");
      return pick([
        "One thing that would help me give you better insight: keeping your cycle log a little more up to date — even rough dates make a difference 🩷",
        "Just a gentle note: it looks like there may be a gap in your recent cycle logs. Even approximate dates help me spot patterns for you 🩷",
        "Your cycle log looks like it may have a gap recently — logging when you can really helps me personalise what I share with you 🩷",
      ]);
    }

    // PREDICTION_DRIFT — cautious uncertainty line for late/irregular contexts
    if (
      !ctx.adviceGiven.has("cycle_prediction_drift") &&
      cycleSignals.some(s => s.code === "PREDICTION_DRIFT" && s.show)
    ) {
      ctx.adviceGiven.add("cycle_prediction_drift");
      return pick([
        "I should mention: your recent cycle data suggests the timing of your period has been shifting a bit, so the expected date I'm working with may not be perfectly accurate 🩷",
        "Worth knowing: the pattern in your recent cycles suggests your period timing has been a little unpredictable lately, so take any estimated dates as a rough guide 🩷",
      ]);
    }

    // SUDDEN_CYCLE_SHIFT — pattern-change acknowledgment for late/irregular contexts
    if (
      !ctx.adviceGiven.has("cycle_sudden_shift") &&
      cycleSignals.some(s => s.code === "SUDDEN_CYCLE_SHIFT" && s.show)
    ) {
      ctx.adviceGiven.add("cycle_sudden_shift");
      return pick([
        "I noticed your recent cycle pattern looks a little different from your usual — that can happen for lots of reasons and doesn't necessarily mean anything is wrong 🩷",
        "Your cycle logs show a bit of a shift in your recent pattern compared to your usual rhythm — worth keeping an eye on 🩷",
      ]);
    }

    return null;
  }

  const env = {
    ctx, cd, userMode, say, transition, pick, ack, qualifier, consent, estimate,
    quickSummary, safeFooter, urgentFooter, minorSafeFooter, effectiveLmp, effectiveCycleLength,
    effectiveMode, hasLmpData, getCurrentPhase, phaseNudge, insightFor, addDays, fmtDate,
    buildSummaryCard, authorizeHtmlPayload, applySessionMode, canGiveAdvice, filterDedup,
    daysBetween, daysUntilNextPeriod, buildRecallLine, buildCyclePersonalisationLine, buildCycleSignalLine, buildSymptomPatternLine, buildSymptomInsightLine, greet, buildCycleCtx,
    withNickname, canUseNickname, getNickname,
    isLateContextActive,
    pickPriorityConcern, getPhaseInsight, getToneOpener, buildGuidanceResponse,
    getStructuredSummary, computePhaseConfidence, logSafetyEvent,
    parseNaturalDate, validateCycleDate, validateCalendarDate,
    generateIntegratedSignals, getBloomieSymptomContext,
    extractEntities, inferRoute, summarizeEntities, extractUrgency,
    SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS,
    CONCERN_PRIORITY,
    bloomieMemory,
    // Anti-repetition helpers
    pickAvoiding, wasNodeRecentlySeen,
    hasContentBeenShown, markContentShown,
    hasContentBeenDeclined, markContentDeclined,
    // Reported-condition support
    CONDITION_META, CONDITION_ALIASES, extractConditionKey,
    // Internal helpers needed by node modules
    pushMsg, smartTestTiming,
    pregnancyAlgorithm: {
      whenToTest: pregnancyWhenToTest,
      estimatedDueDate: pregnancyEstimatedDueDate,
    },
  };
  const NODES = createNodes(env);
  const { OOS, OOS_DEFAULT, HEALTH_OVERRIDE_PATTERNS, CYCLE_QUESTION_PATTERNS, routeUserText } = createOOS(env);

  transition("START");

  return {
    getState: () => ({ ...ctx }),
    reset: () => {
      clearTimers();
      ctx.state = "START";
      ctx.history = [];
      ctx.answers = [];
      ctx.multiDraft = null;
      ctx.inlineChoices = null;
      ctx.inlineQuestion = null;
      ctx.locked = false;
      ctx.toneRequestId = 0;
      ctx.narrowingAttemptCount = 0;
      ctx.lastNarrowingPrompt = null;
      ctx.lastClarifierFingerprint = null;
      ctx.lastClarifierTurn = -1;
      ctx.lastBotLineFingerprint = null;
      ctx.pendingUnresolvedTopic = null;
      ctx.closeSkipUnresolvedPrompt = false;
      transition("START");
    },
    getSummaryText: buildSummaryText,
  };
}
