import { normalizePatois, detectPatois, detectUserTone, fuzzyCorrect, collapseRepeatedLetters, expandShorthand } from "./bloomie-patois.js";
import { extractEntities, inferRoute, summarizeEntities, extractUrgency, SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS, detectDownplaying, detectAmbiguousInput, detectContradiction, detectMissingContext } from "./bloomie-inference.js";
import { buildGuidanceResponse, getStructuredSummary, getToneOpener, getPhaseInsight, CONCERN_PRIORITY } from "./bloomie-templates.js";
import { loadBloomieMemory, saveBloomieMemory } from "./db.js";
import { pick, detectOutOfScope, resolveOOSFollowUp, scoreSignals, resolveSignals, computeRouteConfidence } from "./bloomie-routing.js";
import { createCtx } from "./bloomie-session.js";
import { logSafetyEvent } from "./bloomie-logger.js";
import { getIdToken, getUser } from "./auth.js";
import { generateIntegratedSignals, getBloomieSymptomContext } from "./algorithms/bloom-symptom-engine.js";
import { parseNaturalDate, validateCycleDate, validateCalendarDate, computePhaseConfidence } from "./algorithms/bloom-date-utils.js";
import { createOOS } from "./bloomie-oos.js";
import { createNodes } from "./bloomie-nodes.js";

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

export async function mountChat(user = null, cycleData = null, symptomHistory = null) {
  const box = document.getElementById("chat-box");
  if (!box) return;

  // Load persistent memory from Firestore (or localStorage fallback)
  // before mounting so Bloomie can surface recall on first message.
  const bloomieMemory = await loadBloomieMemory();

  initBloomieChat({
    userName: user?.nickname || user?.displayName || null,
    cycleData,
    symptomHistory,
    bloomieMemory,
    onSaveMemory: saveBloomieMemory,
    onOpenCareMap: () => {
      location.hash = "#/care-map";
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
    doc.text("Bloom - Chat Summary", M, 14);

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
  // Array of symptom log entries from Firestore (last ~30-60 days).
  // Shape: [{ dateKey: "YYYY-MM-DD", items: [{ code, severity, note }] }, ...]
  // Pass this from dashboard when mounting so Bloomie can reference log history.
  symptomHistory = null,
  bloomieMemory = null,
  onSaveMemory = null,
  onOpenCareMap = () => (location.hash = "#/care-map"),
  onRequestPdf = (summaryText) => console.log("PDF requested:", summaryText),
  onLogAction = (action, data) => console.log("Log action:", action, data),
} = {}) {
  const $box = document.getElementById(chatBoxId);
  const $input = document.getElementById(inputId);
  const $form = document.getElementById(formId);

  if (!$box) throw new Error(`Missing #${chatBoxId}`);

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

  // ---------- Cycle data helpers ----------
  function toDate(val) {
    if (!val) return null;
    if (val?.toDate) return val.toDate();           // Firestore Timestamp
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ── User state - derived from Firestore cycleData ────────────────────────
  const cd = {
    lmp:                 toDate(cycleData?.lmp),
    cycleLength:         Number(cycleData?.cycleLength) || 28,
    nextPeriodDate:      toDate(cycleData?.nextPeriodDate),
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

  // Builds the cycle context object passed to buildGuidanceResponse so
  // templates can produce specific numbers ("you're 3 days late") rather
  // than generic copy.  Returns null when no LMP data is available.
  function buildCycleCtx() {
    const lmp = effectiveLmp();
    if (!lmp) return null;
    const cycleLength = effectiveCycleLength();
    const today       = new Date();
    const dayOfCycle  = Math.max(1, Math.round((today - lmp) / (1000 * 60 * 60 * 24)) + 1);
    const daysLate    = Math.max(0, dayOfCycle - cycleLength);
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
    const lmp = effectiveLmp();
    if (!lmp) return null;
    const today = new Date();
    const dayOfCycle = daysBetween(lmp, today) % effectiveCycleLength();
    if (dayOfCycle < 0) return null;
    if (dayOfCycle <= 5)  return { phase: "menstrual",   days: dayOfCycle, label: "your period phase (days 1-5)" };
    if (dayOfCycle <= 13) return { phase: "follicular",  days: dayOfCycle, label: "the follicular phase (days 6-13) - your body is preparing to ovulate" };
    if (dayOfCycle <= 15) return { phase: "ovulation",   days: dayOfCycle, label: "your ovulation window - days 13-15" };
    if (dayOfCycle <= 28) return { phase: "luteal",      days: dayOfCycle, label: "the luteal phase (days 16-28) - this is when PMS symptoms can show up" };
    return null;
  }

  // Returns a one-time nudge to log LMP for personalised insights, or null if
  // already shown this session. Uses the existing adviceGiven Set as the guard.
  function phaseNudge() {
    if (ctx.adviceGiven.has("phase_nudge")) return null;
    ctx.adviceGiven.add("phase_nudge");
    return "By the way - if you log your last period date in the dashboard I can give you more personalised insight based on where you are in your cycle 🩷";
  }

  // Nodes where a phase insight must never appear regardless of other logic.
  const PHASE_INSIGHT_BLOCKED_NODES = new Set(["HEAVY_URGENT", "CRISIS_SUPPORT", "SAFETY_SUPPORT"]);

  // Returns true when cycle data is too thin to state phase with confidence:
  // either the LMP was logged more than 45 days ago, or the last 3 cycle
  // lengths varied by more than 5 days.
  function computeLowConfidencePhase() {
    const lmp = effectiveLmp();
    if (!lmp) return false; // no LMP at all → getCurrentPhase() returns null anyway
    const daysSinceLmp = Math.round((new Date() - lmp) / (1000 * 60 * 60 * 24));
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
          const entryDate = new Date(entry.dateKey);
          if (isNaN(entryDate.getTime())) return null;
          const raw = Math.round((entryDate - lmp) / (1000 * 60 * 60 * 24));
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
      const dayRange = minDay === maxDay ? `day ${minDay}` : `days ${minDay}-${maxDay}`;

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

  // Persist a compact memory snapshot after a meaningful exchange.
  // Safe to call fire-and-forget - saves to localStorage immediately,
  // Firestore sync happens in the background.
  function persistMemory(entities, reason) {
    if (!onSaveMemory) return;
    const activeSymptoms = Object.entries(entities.symptoms)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!activeSymptoms.length) return;
    onSaveMemory({
      lastSymptoms:        activeSymptoms,
      lastIntent:          reason || null,
      lastSeverity:        entities.severity,
      lastDuration:        entities.duration,
      lastPregnancyChance: entities.pregnancy?.chance || false,
      recentTopics:        activeSymptoms.slice(0, 5),
    });
  }

  // How many days until next period
  function daysUntilNextPeriod() {
    const lmp = effectiveLmp();
    const next = cd.nextPeriodDate || (lmp ? addDays(lmp, effectiveCycleLength()) : null);
    if (!next) return null;
    return daysBetween(new Date(), next);
  }

  // Smart pregnancy test recommendation based on LMP
  function smartTestTiming() {
    const lmp = effectiveLmp();
    if (!lmp) return null;
    const expectedPeriod = addDays(lmp, effectiveCycleLength());
    const testDate = addDays(expectedPeriod, 1);
    const today = new Date();
    const daysToTest = daysBetween(today, testDate);
    return { testDate, expectedPeriod, daysToTest, canTestNow: daysToTest <= 0 };
  }

  // ---------- State ----------
  const ctx = createCtx();

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
      } else {
        // Stale (>24 h) - park in backgroundContext for reference only.
        ctx.backgroundContext = { ...seedEntry, seededAt: bloomieMemory.lastSessionDate };
      }
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
  }

  if ($input) {
    $input.disabled = false;
    $input.placeholder = "Type here or use the buttons…";
    $input.setAttribute("maxlength", "240");
  }

  // ── Input quality analyzer - runs before normalization or routing ────────────
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

  if ($form && $input) {
    $form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (ctx.locked) return;

      const text = ($input.value || "").trim();
      $input.value = "";

      // ── Input quality check - runs BEFORE normalization or routing ────────
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

      // ── Loop detection - track recent inputs ─────────────────────────────
      ctx.recentInputs = ctx.recentInputs || [];
      ctx.recentInputs.push(text);
      if (ctx.recentInputs.length > 5) ctx.recentInputs.shift();

      // Exact repeat detection: same message sent 3+ times in last 5
      const _last4 = ctx.recentInputs.slice(0, -1).slice(-4);
      const _exactCount = _last4.filter(m => m === text).length;
      if (_exactCount >= 2) {
        say("I heard you the first time 🩷 I want to help - let me try a different approach.");
        transition("ELSE_NOT_SURE_ROUTE");
        return;
      }

      // "idk" loop - 3+ times total in recent inputs
      const _idkPattern = /^\s*(idk|i don'?t know|not sure|nuh sure|mi nuh know)\s*$/i;
      const _idkCount = ctx.recentInputs.filter(m => _idkPattern.test(m)).length;
      if (_idkCount >= 3) {
        say("That's okay - not knowing is okay 🩷 Sometimes it helps to just pick the closest thing. What feels most like what's going on?");
        transition("ELSE_NOT_SURE_ROUTE");
        return;
      }

      // ── Pending route confirmation (MEDIUM confidence tier) ─────────────────
      // If Bloomie asked a soft confirmation question last turn, check whether
      // the user confirmed or corrected. Confirmed -> proceed to pending route.
      // Corrected -> clear pending and re-run full pipeline with correction.
      if (ctx.pendingRoute) {
        const confirmText = text.toLowerCase().trim();
        const YES_CONFIRM = ["yes", "yeah", "yep", "yah", "ya", "correct", "dat right", "that's right", "right", "sure", "ok", "okay", "exactly", "true", "yes that's it"];
        const isConfirm = YES_CONFIRM.some(w => confirmText === w || confirmText.startsWith(w + " ") || confirmText.startsWith(w + ","));
        const NO_CORRECT = ["no", "nah", "nope", "not really", "that's not", "thats not", "not that", "different"];
        const isCorrection = NO_CORRECT.some(w => confirmText === w || confirmText.startsWith(w + " ") || confirmText.startsWith(w + ","));
        if (isConfirm) {
          const route = ctx.pendingRoute;
          ctx.pendingRoute = null;
          transition(route.next, route.payload || {});
          return;
        } else if (isCorrection) {
          // User corrected -- clear pending, fall through to full routing pipeline
          ctx.pendingRoute = null;
          // (effectiveInput will be set below from 'text')
        } else {
          // Ambiguous response -- treat as correction / new message, clear pending
          ctx.pendingRoute = null;
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

      // ── OOS follow-up context ────────────────────────────────────────────
      // Pass normalizePatois(text) so Patois follow-up phrases resolve correctly.
      const oosFollowUp = resolveOOSFollowUp(normalizePatois(text), ctx.lastOOS);
      if (oosFollowUp) {
        ctx.lastOOS = null;
        ctx.currentTone = detectUserTone(text);
        transition(oosFollowUp);
        return;
      }

      // ── "I tested today" reactive detection ──────────────────────────────
      const testedToday = /(i tested|took a test|did a test|just tested|tested this morning|tested today|pregnancy test today)/.test(
        normalizePatois(text).toLowerCase()
      );
      if (testedToday) {
        pushMsg("user", text);
        const retestDate = addDays(new Date(), 3);
        say([
          `${ack()} Whatever the result, here's what to know 🩷`,
          `If it was negative, retest around **${fmtDate(retestDate)}** - 48-72 hours from now - with first morning urine for the most accurate reading.`,
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
      if (contextMatch) {
        // Tone detection runs even when a typed choice is matched so ctx.currentTone
        // stays current and toneOpeners apply correctly on the next node.
        ctx.currentTone = detectUserTone(text);
        const choice = contextMatch;
        if (NODES[ctx.state]?.question) recordAnswer(NODES[ctx.state].question, choice.label);
        if (choice.action === "OPEN_MAP")      onOpenCareMap();
        if (choice.action === "REQUEST_PDF")   onRequestPdf(buildSummaryText());
        if (choice.action?.startsWith("LOG_")) onLogAction(choice.action, choice.logData || {});
        const effectiveNext = (choice.id === "done" && choice.next === "CLOSE" && ctx.adviceGiven.size > 0)
          ? "SUMMARY"
          : choice.next;
        transition(effectiveNext, { choiceId: choice.id });
        return;
      }

      // ── Full input processing pipeline (steps 3-7) ───────────────────────
      // Step 3: Patois → English phrase/word normalization
      const _patoisNorm = normalizePatois(text);
      // Step 4: Medical spell correction - phonetic variants then Levenshtein token correction
      const _fuzzyText  = fuzzyCorrect(_patoisNorm) ?? _patoisNorm;
      // Step 5: Collapse repeated characters ("helpppppp" → "help")
      const _collapsed  = collapseRepeatedLetters(_fuzzyText);
      // Step 6: Expand health/time shorthand ("ewcm", "bfp", "2wks", etc.)
      const normalizedText = expandShorthand(_collapsed);

      // Step 12: Detect emotional tone from the normalized text
      ctx.currentTone = detectUserTone(normalizedText);

      // ── Inference layer ──────────────────────────────────────────────
      // Step 7: Extract entities (symptoms, duration, severity, timing, pregnancy, urgency)
      const entities = extractEntities(normalizedText);

      // ── Cumulative risk flag accumulation ─────────────────────────────────
      // Add flags as symptoms appear; check dangerous combinations every turn.
      // This catches escalating patterns across multiple messages (e.g. heavy
      // bleeding in message 1, dizziness in message 5).
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
        // one_sided_pain: detect from raw urgency text
        if (/one.sided|one side/.test(normalizedText)) ctx.cumulativeRiskFlags.add("one_sided_pain");

        const f = ctx.cumulativeRiskFlags;
        const cumulativeUrgent =
          (f.has("heavy_bleeding") && f.has("dizziness")) ||
          (f.has("late_period")    && f.has("one_sided_pain")) ||
          (f.has("positive_test")  && (f.has("pelvic_pain") || f.has("bleeding"))) ||
          (f.has("night_sweats")   && f.has("chills") && f.has("pelvic_pain"));

        if (cumulativeUrgent && !entities.urgent) {
          const reason = f.has("heavy_bleeding") && f.has("dizziness")          ? "cumulative: heavy_bleeding+dizziness"
                       : f.has("late_period")    && f.has("one_sided_pain")      ? "cumulative: late_period+one_sided_pain"
                       : f.has("positive_test")  && f.has("pelvic_pain")         ? "cumulative: positive_test+pelvic_pain"
                       : f.has("positive_test")  && f.has("bleeding")            ? "cumulative: positive_test+bleeding"
                       : "cumulative: fever_proxy+pelvic_pain";
          ctx.urgency = true;
          logSafetyEvent("urgent_trigger", {
            input:     normalizedText,
            route:     "HEAVY_URGENT",
            reason,
            topic:     ctx.topic,
            riskLevel: ctx.riskLevel,
          });
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
          say([contradictionQ]);
          render();
          return;
        }
      }

      // ── Ambiguity detection ───────────────────────────────────────────────
      {
        const ambiguityQ = detectAmbiguousInput(normalizedText, entities);
        if (ambiguityQ && !entities.urgent && !ctx.pendingContradictionContext) {
          ctx.pendingAmbiguityContext = { originalText: effectiveInput };
          say([ambiguityQ]);
          render();
          return;
        }
      }

      // ── Missing context probe ─────────────────────────────────────────────
      {
        const contextProbeQ = detectMissingContext(entities, normalizedText);
        if (contextProbeQ && !entities.urgent && !ctx.pendingContradictionContext && !ctx.pendingAmbiguityContext) {
          ctx.pendingContextProbe = { originalText: effectiveInput };
          say([contextProbeQ]);
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
          const delay = estimateSayTime(medLines);
          say(medLines, { keepLocked: true });
          const tid = setTimeout(() => {
            transition(medCat.forceNext || "START_MENU", {});
          }, delay);
          ctx.timers.add(tid);
          return;
        }
      }

      // ── Pipeline debug logging ────────────────────────────────────────────
      debugPipeline(
        text,          // raw
        _patoisNorm,   // after normalizePatois (step 3)
        _fuzzyText,    // after fuzzyCorrect (step 4)
        normalizedText,// after collapseRepeatedLetters + expandShorthand (steps 5-6)
        mergedEntities,
        ctx.currentTone,
        mergedEntities.urgent,
        null // route resolved below
      );

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
      const guidance   = buildGuidanceResponse(mergedEntities, inferred?.payload?.reason, cycleCtx);

      if (guidance) {
        // Store on ctx so buildSummaryText can include them in PDF export
        ctx.lastEntities = mergedEntities;
        ctx.lastInferredReason = inferred?.payload?.reason || null;
        ctx.lastCycleCtx = cycleCtx;
        persistMemory(mergedEntities, ctx.lastInferredReason);
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
        const guidanceLines = guidanceOpener ? [guidanceOpener, ...guidance.lines] : guidance.lines;
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
        return;
      }

      if (inferred) {
        ctx.lastIntent = inferred.payload?.reason?.split("+")[0] || null;
        persistMemory(mergedEntities, inferred.payload?.reason || null);
        console.log("[Bloomie inference] routed →", inferred.next, inferred.payload?.reason);
        transition(inferred.next, { entities: mergedEntities, ...(inferred.payload || {}) });
        return;
      }

      // Fall through to existing keyword router
      const routed = routeUserText(normalizedText);

      // ── Compute route confidence (pure signal scoring) ──────────────────────
      {
        const { sig: routeSig } = scoreSignals(normalizedText);
        ctx.routeConfidence = computeRouteConfidence(routeSig, mergedEntities);
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
      }

      // ── Safety log: oos_fallback ────────────────────────────────────────────
      if (routed?.payload?.oos && routed.payload.oos !== "greeting") {
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

      if (routed?.payload?.oos) {
        console.log("OOS category:", routed.payload.oos);
      }

      if (routed?.reply && routed?.next) {
        // Say the reply first, THEN transition after it finishes so
        // clearTimers() inside transition() does not nuke the reply bubbles.
        const lines = Array.isArray(routed.reply) ? routed.reply : [routed.reply];
        const isOOS = !!routed.payload?.oos;
        if (isOOS) ctx.oosStreakCount = (ctx.oosStreakCount || 0) + 1;
        else ctx.oosStreakCount = 0;

        // ── Conversational repair: 2+ OOS after meaningful session depth ──────────
        if (isOOS && ctx.oosStreakCount >= 2 && ctx.conversationProfile.sessionDepth >= 3) {
          say([
            "I’ve been having trouble understanding what you need, and that’s on me 💗",
            "Let me try differently. Can you pick the closest thing from below?",
          ]);
          ctx.oosStreakCount = 0;
          ctx.narrowingCandidates = null;
          transition("NARROWING");
          return;
        }

        if (isOOS && routed.next === "START_MENU") {
          // Zero-confidence narrowing: if the input has health-adjacent words,
          // ask a clarifying question with topic buttons instead of the generic OOS reply.
          if (/\b(period|bleed|pain|cramp|discharge|pregnant|cycle|mood|tired|sick|hurt)\b/.test(normalizedText)) {
            ctx.narrowingCandidates = null; // generic OOS -- no candidates
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
        const conf = ctx.routeConfidence;
        if (conf && conf.tier === "low") {
          // LOW: surface NARROWING with top scored candidate buttons
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
          transition("NARROWING");
        } else if (conf && conf.tier === "medium") {
          // MEDIUM: ask soft confirmation, store pending route for next turn
          ctx.pendingRoute = { next: routed.next, payload: routed.payload || {} };
          say([conf.confidenceNote]);
          render();
        } else {
          // HIGH (or no confidence data): route directly
          ctx.lastIntent = routed.next;
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

  const OOS_DEFAULT = [
    () => pick([
      "I'm not sure I caught that 🩷 I focus on period and cycle concerns - tap a button below or tell me what's going on.",
      "Hmm, I'm not sure how to help with that one 🩷 I'm best with period, cycle, spotting, cramps, or mood changes.",
      "That one's a bit outside my lane 🩷 What's going on with your cycle?",
    ]),
  ];

  // looksLikeGibberish → imported from bloomie-routing.js

  const OOS = [
    // ── App help / how to log ─────────────────────────────────────────────
    {
      name: "app_help",
      patterns: [
        /(how do i log|how (to|do i) (add|enter|record|track|update)|where do i (log|add|find|enter)|how does (this|bloom) work)/,
        /(log (my )?period|add (my )?period|track (my )?period|record (my )?period|enter (my )?period)/,
        /(what (is|are) (the )?button|what does.*button do|how (to|do i) use|tutorial|walkthrough|get started|set up)/,
      ],
      replies: [],
      forceNext: "APP_HELP",
    },

    // ── Should I see a doctor? ────────────────────────────────────────────
    {
      name: "see_doctor_q",
      patterns: [
        /(should i (see|go to|visit|call) (a |my )?(doctor|physician|provider|gynecologist|gyno|ob|obgyn|specialist|nurse|clinic))/,
        /(do i need (a |to see )?(doctor|help|care|treatment|specialist))/,
        /(is this serious|is this normal|when (should|do) i (go|seek|get) (help|care|checked|medical))/,
        /(worried about|should i be worried|how bad is this|how serious is)/,
      ],
      replies: [],
      forceNext: "SEE_DOCTOR_GUIDE",
    },

    // ── Symptom education ─────────────────────────────────────────────────
    {
      name: "symptom_education",
      patterns: [
        /(what (is|are|does|can cause)|what (does|do).{0,30}mean|tell me about|explain|what causes|why (do|am|does)|what is (pcos|endometriosis|fibroids?|pms|pmdd|ovulation|luteal|follicular))/,
        /(is it normal (to|for)|normal to have|supposed to (feel|have|be)|why (is my|am i)|why does my)/,
      ],
      replies: [],
      forceNext: "SYMPTOM_EDUCATION",
    },

    // ── Mode confirmation phrases ─────────────────────────────────────────
    // User explicitly tells Bloomie their context - highest priority
    {
      name: "mode_confirmation_pregnant",
      patterns: [
        /(i am pregnant|i'm pregnant|just found out i'm pregnant|just found out im pregnant|i got a positive test|positive test result|confirmed pregnant|yes i'm pregnant|yes im pregnant|i tested positive)/,
      ],
      replies: ["Congratulations on your pregnancy 🩷 Let me switch to the right support for you."],
      forceNext: "LATE_POSITIVE",
    },
    {
      name: "mode_confirmation_ttc",
      patterns: [
        /(trying to conceive|trying to get pregnant|ttc|trying for a baby|trying for baby|want to get pregnant|want to be pregnant|we're trying)/,
      ],
      replies: ["Got it - TTC mode 🩷 Let me pull up your ovulation info."],
      forceNext: "TTC_INTRO",
    },
    {
      name: "mode_confirmation_postpartum",
      patterns: [
        /(just had a baby|i had a baby|postpartum|after (?:giving )?birth|gave birth|just gave birth|recently had a baby|recovering from (?:giving )?birth|after delivery)/,
      ],
      replies: ["Thanks for sharing that 🩷 Postpartum bodies are on their own timeline - let me help."],
      forceNext: "POSTPARTUM_INTRO",
    },
    // ── Cycle prediction questions ────────────────────────────────────────
    // These feel OOS but are actually smart handoffs to cycle-aware nodes
    {
      name: "cycle_phase_q",
      patterns: [
        /\b(what phase|which phase|what cycle phase|am i ovulating|am i in luteal|am i in follicular)\b/,
        /\b(where am i in my cycle|what stage am i|what day of my cycle)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_PHASE_ANSWER",
    },
    {
      name: "next_period_q",
      patterns: [
        /\b(when is my (next )?period|when will my period (come|start|be)|when do i get my period)\b/,
        /\b(when should i expect my period|period due|period coming)\b/,
        /\b(how long (until|till) my period|how many days (until|till) my period)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_NEXT_PERIOD",
    },
    {
      name: "last_period_q",
      patterns: [
        /\b(when was my last period|when did my period (start|begin|come)|last period date)\b/,
        /\b(when did i last (have|get) my period|my lmp|last menstrual)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_LMP_ANSWER",
    },
    {
      name: "edd_q",
      patterns: [
        /\b(when is my due date|what is my due date|due date|edd|estimated delivery|when will i give birth|when am i due)\b/,
        /\b(how many weeks (am i|pregnant)|how far along am i|how far along)\b/,
      ],
      replies: [],
      // Route through SESSION_MODE_CONFIRM unless mode is already confirmed
      forceNext: "CYCLE_EDD_GATE",
    },
    {
      name: "test_timing_q",
      patterns: [
        /\b(when (should|can) i (take|do) a (pregnancy )?test|when (should|can) i test)\b/,
        /\b(is it (too early|the right time) to test|best time to test|when to test)\b/,
        /\b(can i test (yet|now)|should i test (yet|now))\b/,
      ],
      replies: [],
      forceNext: "CYCLE_TEST_TIMING",
    },

    // ── Greetings ─────────────────────────────────────────────────────────
    {
      name: "greeting",
      patterns: [/^(hi|hello|hey|yo|sup|hiya|morning|afternoon|evening)$/, /^\b(hi|hello|hey|yo|sup|hiya)\b\s*$/, /\b(wah gwaan|wagwaan|wha gwan|howdy)\b/],
      replies: [
        () => ctx.greeted
          ? pick([
              "Still here 🩷 What's going on?",
              "I'm here - what would you like help with?",
              "Hey again 🩷 Pick something below or just tell me what's up.",
              "Still with you 🩷 What can I do for you?",
              "I didn't go anywhere 😄 What's on your mind?",
              "Always here 🩷 Tap a button or just tell me what you're dealing with.",
            ])
          : pick([
              "Heyy 🩷 What can I help with today? You can tap a button below or just type what's going on.",
              "Hi there 🩷 I'm here for period and cycle concerns - tap an option or just tell me what's up.",
              "Hey! 🩷 What's going on? You can type it out or pick from the options below.",
              "Welcome 🩷 I'm Bloomie - here to help with anything cycle or reproductive health. What's on your mind?",
              "Hey, glad you're here 🩷 Tell me what's going on or pick a topic below and we'll sort it out together.",
              "Wah gwaan 🩷 I'm here for cycle, period, and reproductive health questions - what can I help you with today?",
            ]),
      ],
    },

    // ── Self-harm (always first in priority) ───────────────────────────────
    // ── Emergency / urgent symptoms ───────────────────────────────────────
    // High priority - must catch before other health buckets
    {
      name: "emergency_symptoms",
      patterns: [
        /\b(can't breathe|cant breathe|shortness of breath|chest (pain|tight)|heart racing)\b/,
        /\b(passed out|passing out|fainted|fainting|collapse|collapsing)\b/,
        /\b(soaking (through|thru)|bleeding through|bleed through|soaked (my )?pad|soaked (my )?tampon)\b/,
        /\b(severe.*pain|extreme.*pain|unbearable.*pain|worst pain|pain.*spreading|one.?sided.*pain|sharp.*one side)\b/,
        /\b(blood.*everywhere|so much blood|too much blood|hemorrhag)\b/,
        /\b(call.*ambulance|need.*emergency|going to (hospital|er|emergency)|send.*help)\b/,
      ],
      replies: [
        () => "What you're describing sounds like it could be urgent 🩷 Please don't wait - go to your nearest emergency room or call emergency services (119 in Jamaica) right now.",
        () => "I'm not able to assess emergencies, and I don't want you to delay getting real care.",
      ],
      forceNext: "EMERGENCY_REDIRECT",
    },

    // ── Diagnosis requests ──────────────────────────────────────────────────
    {
      name: "diagnosis_request",
      patterns: [
        /\b(do i have|is this|could this be|might i have|am i developing|could i have)\b.{0,30}\b(pcos|endometriosis|fibroids?|adenomyosis|thyroid|anemia|cancer|cyst|ovarian|disorder|syndrome|condition)\b/,
        /\b(diagnose me|what is wrong with me|what condition|tell me what i have|is this normal or serious|what disease)\b/,
        /\b(pcos|endometriosis|adenomyosis|fibroids?)\b.{0,30}\b(do i|have i|test for|signs of|symptom)\b/,
      ],
      replies: [
        () => "I completely understand wanting clarity about what's happening in your body 🩷",
        () => "I'm not able to diagnose conditions - that takes a proper clinical exam and tests. But I can help you understand your symptoms and what questions to bring to a provider.",
      ],
      forceNext: "DIAGNOSIS_REDIRECT",
    },

    // ── Medication / dosage questions ───────────────────────────────────────
    {
      name: "medication_dosage",
      patterns: [
        // ── Brand names - Jamaican market + common (standalone is enough) ────
        /\b(panadol|panadeine|ibuprofen|advil|brufen|nurofen|tylenol|buscopan|ponstan|naproxen|aleve|aspirin|disprin|codeine|co-codamol|diclofenac|voltaren|tramadol|tranexamic|norethisterone|provera|metformin|clomid|clomiphene|primolut|duphaston|mefenamic)\b/i,
        // ── Generic pain relief phrases ──────────────────────────────────────
        /\b(pain relief|painkiller|pain killer|pain medication|pain medicine|pain tablet|pain pill|cramp relief|period pain relief|cramp medicine|menstrual relief)\b/i,
        // ── "Something / anything for the pain / cramps" ────────────────────
        /\b(something for (the )?(pain|cramps?|belly|stomach|period)|anything for (the )?(pain|cramps?|period))\b/i,
        /\b(help with (the )?(pain|cramps?)|stop the pain|ease the pain|reduce the pain|manage the pain)\b/i,
        // ── What helps / what to do for pain (post-Patois normalization) ────
        /\b(what (can|is good|works) (for|with) (the )?(pain|cramps?|period)|what to do for (the )?(pain|cramps?))\b/i,
        /\b(how to (stop|ease|manage|reduce) (the )?(pain|cramps?)|what can help)\b/i,
        // ── "Killing me" pain-relief intent ─────────────────────────────────
        /\bkilling me\b.{0,50}\b(help|take|get|something|anything|relief)\b/i,
        /\b(cramps? are killing me|cramps? killing me|stomach is killing me|is killing me)\b/i,
        // ── Dosage / safety questions ────────────────────────────────────────
        /\b(safe to take|okay to take|alright to take|is it safe|can i take|should i take|when to take|take with food|take on empty stomach)\b/i,
        /\b(how (much|many|often) (can i|should i|to)? ?(take|panadol|ibuprofen|aspirin|buscopan|ponstan|naproxen|tablets?|pills?))\b/i,
        /\b(overdose|too many tablets|too many pills|take two|take three|how often|every how long|can i take more)\b/i,
        // ── Existing patterns kept + expanded ────────────────────────────────
        /\b(how much|what dose|dosage|mg|milligram|how many (pills?|tablets?))(.*)(ibuprofen|paracetamol|panadol|naproxen|aspirin|metformin|provera|norethisterone|tranexamic|mefenamic|bc pill|contraceptive pill)\b/i,
        /\b(ibuprofen|paracetamol|panadol|naproxen|tranexamic|mefenamic|norethisterone|progesterone|estrogen|metformin|provera)\b.{0,40}\b(dose|dosage|how much|how many|take|mg|tablet|pill)\b/i,
        /\b(medication|medicine|prescription|prescribed|drug|tablet|capsule|overdose)\b.{0,40}\b(period|cramps?|bleeding|cycle|pain|pms)\b/i,
        // ── Post-normalization Patois patterns ───────────────────────────────
        /\b(i want (a|some|to (take|get|buy))|i need (a|some|to get)|want to (take|get|buy)|need to get|i am taking)\b.{0,40}\b(panadol|ibuprofen|painkiller|pain relief|advil|buscopan|ponstan|aspirin|tramadol|naproxen|voltaren)\b/i,
        /\b(take|taking)\b.{0,25}\b(panadol|ibuprofen|painkiller|advil|buscopan|ponstan|aspirin|tramadol|naproxen|voltaren|norethisterone|provera|metformin|clomid|duphaston)\b/i,
        /\b(want to take|want a|want some|i want|i need)\b.{0,30}\b(panadol|ibuprofen|painkiller|buscopan|ponstan|advil|aspirin|naproxen)\b/i,
        // ── Residual Patois (pre-normalization chat path) ────────────────────
        /\b(tek (panadol|ibuprofen|painkiller|paracetamol|naproxen|buscopan|ponstan|aspirin|tramadol|voltaren)|pain.?killer fi cramps?|wah (me|mi) can tek|can mi tek|safe fi tek|wah tek|mi wah tek|me wah tek)\b/i,
        /\b(wah (a|some) (panadol|ibuprofen|painkiller|buscopan|ponstan)|anyting fi (cramp|pain|period)|something fi di (pain|belly|cramp))\b/i,
      ],
      replies: [
        (t) => {
          // ── Medication-specific warm openers ───────────────────────────────
          if (/panadol/i.test(t)) return pick([
            "Panadol is one of the most common things people reach for for period pain 🩷",
            "A lot of people reach for Panadol when cramps hit - you're not alone in that 🩷",
            "Panadol fi di pain is real and valid - cramps bad enough to need relief deserve to be taken seriously 🩷",
            "Yeah, Panadol is probably the most reached-for thing for period pain in Jamaica 🩷",
          ]);
          if (/ibuprofen/i.test(t)) return pick([
            "Ibuprofen is actually one of the better options for period pain since it targets inflammation too 🩷",
            "Ibuprofen can really help with cramps - it works differently from Panadol and often more effectively 🩷",
            "Cramps bad enough to want ibuprofen are real and valid 🩷",
            "Ibuprofen fi period pain - that's a solid instinct 🩷",
          ]);
          if (/buscopan/i.test(t)) return pick([
            "Buscopan is often used for spasm-type cramps - makes sense that you're asking about it 🩷",
            "Buscopan fi di cramp pain - that's something a lot of people find helpful 🩷",
            "Cramps bad enough to want Buscopan are real and deserve proper care 🩷",
          ]);
          if (/ponstan|mefenamic/i.test(t)) return pick([
            "Ponstan (mefenamic acid) is one of the strongest options for period pain - your instinct is solid 🩷",
            "Mefenamic acid is specifically designed for period pain, so you're on the right track 🩷",
            "Ponstan fi period pain - that's actually one of the more targeted options out there 🩷",
          ]);
          if (/naproxen|aleve/i.test(t)) return pick([
            "Naproxen is one of the options that works well for period pain 🩷",
            "Naproxen / Aleve is a solid choice for cramps - you're thinking about it right 🩷",
          ]);
          if (/aspirin|disprin/i.test(t)) return pick([
            "Aspirin / Disprin is something a lot of people reach for - good that you're thinking about it carefully 🩷",
          ]);
          if (/tramadol|codeine|co-codamol/i.test(t)) return pick([
            "Tramadol and codeine are stronger pain medications that really do need a provider's involvement 🩷",
          ]);
          // ── Pain-focused openers (no specific brand detected) ──────────────
          if (/killing me|kill mi|murder mi|cannot manage|too bad|bad bad/i.test(t)) return pick([
            "Cramps bad enough to feel like they're killing you are real and valid - you deserve actual relief 🩷",
            "Pain that bad shouldn't just be pushed through 🩷",
            "When the pain gets that intense, it absolutely makes sense to want something for it 🩷",
            "Mi know that feeling - when di cramp a kill you, you need real help, not just toughing it out 🩷",
          ]);
          // ── Generic openers ───────────────────────────────────────────────
          return pick([
            "That's a really common thing to wonder about 🩷 Pain relief for period cramps is something a lot of people navigate.",
            "Cramps bad enough to need pain relief are real and valid 🩷",
            "Wanting something for the pain is completely understandable 🩷",
            "Period pain that needs medication is legitimate - you shouldn't have to just push through 🩷",
            "Mi hear you - when di pain bad, you need something fi help 🩷",
          ]);
        },
        () => "I can't tell you how much to take or whether a specific medication is right for your situation - that really needs a pharmacist or provider who knows your full health picture.",
        () => "A pharmacist is actually the fastest option here - you can walk in, describe your symptoms, and they can advise on the spot. No appointment needed.",
      ],
      forceNext: "MEDICATION_REDIRECT",
    },

    // ── Sexual violence / coercion ──────────────────────────────────────────
    {
      name: "sexual_violence",
      patterns: [
        /\b(raped|rape|sexual assault|sexually assaulted|he forced|she forced|they forced|forced me|coerced|non.?consensual|without consent|against my will)\b/,
        /\b(someone (touched|hurt) me|touched without|hurt me and|abuse|abused|sexual abuse|molested|molestation)\b/,
      ],
      replies: [
        () => "I'm so sorry. What you're sharing matters and you deserve care and support 🩷",
        () => "What happened to you is not your fault.",
      ],
      forceNext: "SAFETY_SUPPORT",
    },

    // ── Mental health crisis ──────────────────────────────────────────────
    // Upgraded from the original self_harm - broader and more compassionate
    {
      name: "mental_health_crisis",
      patterns: [
        /\b(suicide|suicidal|kill myself|end my life|want to die|don't want to be here|dont want to be here|rather be dead|no point living|no reason to live)\b/,
        /\b(self.?harm|cutting myself|hurt myself|burning myself|hurting myself)\b/,
        /\b(i can't do this anymore|cant do this anymore|i give up|can't go on|cant go on|everything is too much|i'm done with everything|im done with everything)\b/,
      ],
      replies: [
        () => "I hear you, and what you're feeling right now matters so much 🩷 You deserve real, caring support.",
        () => "Please reach out - in Jamaica, you can call the Crisis Hotline at 888-NEW-LIFE (888-639-5433) or go to your nearest hospital.",
        () => "You don't have to carry this alone.",
      ],
      forceNext: "CRISIS_SUPPORT",
    },

    // ── Legal / privacy concerns ──────────────────────────────────────────
    {
      name: "legal_privacy",
      patterns: [
        /\b(privacy|my data|data stored|data storage|who can see|who sees|delete (my )?(account|data)|data protection|gdpr|information (stored|collected))\b/,
        /\b(is this (confidential|private|secure|safe)|safe to share|legal|lawful|consent|terms of service|terms and conditions)\b/,
        /\b(can (bloom|bloomie|you) see|share (my )?data|sell (my )?data|third party|who has access)\b/,
      ],
      replies: [
        () => "That's a really important question and you deserve a clear answer 🩷",
        () => "Bloom takes your privacy seriously - your health data is yours.",
      ],
      forceNext: "PRIVACY_INFO",
    },

    // ── Self harm (kept for backwards compat, now points to CRISIS_SUPPORT)
    {
      name: "self_harm",
      patterns: [/\b(suicide|kill myself|end my life|self harm|self-harm|cut myself|want to die|don't want to be here)\b/],
      replies: [
        () => "I hear you 🩷 Please reach out for support - in Jamaica call 888-639-5433 or go to your nearest hospital.",
      ],
      forceNext: "CRISIS_SUPPORT",
    },

    // ── Sexual content ─────────────────────────────────────────────────────
    {
      name: "sexual_content",
      patterns: [/\b(nudes|send pic|porn|sex video|send me|show me)\b/],
      replies: [
        () => "That's not something I can help with here. If you have a reproductive health question - periods, cramps, spotting, or cycle concerns - I'm happy to help with those 🩷",
      ],
    },

    // ── Rude/insults ───────────────────────────────────────────────────────
    {
      name: "insults",
      patterns: [/\b(stupid|idiot|dumb|trash|shut up|f\*+k|fuck|bitch|useless|waste)\b/],
      replies: [
        () => pick([
          "I'm here to help, not argue 🩷 Tell me what's going on with your cycle and I'll do my best.",
          "Still here for you 🩷 If something's bothering you health-wise, let me know.",
          "I don't take it personally 🩷 If something's stressing you out - especially anything cycle-related - I'm all ears.",
          "Not gonna argue 😌 but if your body's giving you grief, I can actually help with that.",
          "It's okay - I know this stuff can be frustrating 🩷 What's actually going on?",
          "No hard feelings 🩷 If you want to tell me what's really going on with your health, I'm listening.",
        ]),
      ],
    },

    // ── Abortion ───────────────────────────────────────────────────────────
    {
      name: "abortion",
      patterns: [/\b(abortion|terminate|termination|end the pregnancy|misoprostol|mifepristone|abortion pill)\b/],
      replies: [
        () => "I can't provide instructions for ending a pregnancy, but I can help you understand options, safety warning signs, and where to find confidential support 🩷",
      ],
      forceNext: "ABORTION_OPTIONS",
    },

    // ── Pregnancy questions ────────────────────────────────────────────────
    {
      name: "pregnancy_confusion",
      patterns: [/\b(pregnant|pregnancy|positive test|negative test|missed period and)\b/],
      replies: [
        () => "I can help with pregnancy-related guidance 🩷",
        () => "Tap **Late or missed period** to walk through the steps together.",
      ],
      forceNext: "TEST_INTRO",
    },

    // ── Mental health ──────────────────────────────────────────────────────
    {
      name: "mental_health_general",
      patterns: [/\b(depressed|depression|panic attack|panic|overthinking|stressed out|burnout|burnt out|breaking down|can't cope|cant cope)\b/],
      replies: [
        () => "What you're feeling sounds really heavy 🩷 I'm not a mental health tool, but I don't want to brush you off either.",
        (t) => {
          const base = "If your mood or energy has been off and you think it might be cycle-related, I can help with that. Do the feelings tend to show up around your period?";
          const phaseInfo = getCurrentPhase();
          const insight = insightFor(phaseInfo?.phase, "mood", t);
          if (insight) return `${base} ${insight}`;
          const nudge = phaseNudge();
          return nudge ? `${base} ${nudge}` : base;
        },
      ],
    },

    // ── Relationships ──────────────────────────────────────────────────────
    {
      name: "relationships",
      patterns: [/\b(bf|girlfriend|boyfriend|my man|my girl|cheat|cheating|break up|breakup|situationship|talking stage|he left|she left)\b/],
      replies: [
        () => pick([
          "Relationship stress is real - and honestly it can throw off your whole cycle 🩷 If you've noticed anything shifting (late period, mood changes, spotting), I can help with that.",
          "I'm a cycle assistant, not a relationship coach 😅 but if the stress is messing with your period, tell me what you've noticed and I'll help.",
          "Sounds like a rough time 🩷 I can't weigh in on the relationship drama, but if the stress has your cycle acting up, that's something I can actually help with.",
          "Emotional stress - whether it's a breakup, a situationship, or just life - can genuinely delay or shift your period 🩷 Noticed anything different lately?",
          "Not really a love advice gyal 😄 but cycle disruption from relationship stress is real - if your period's been off, I'm here.",
          "That sounds hard 🩷 If anything's shifted with your cycle since things got stressful, tell me what you've noticed.",
        ]),
      ],
    },

    // ── Money / finances ──────────────────────────────────────────────────
    {
      name: "money",
      patterns: [
        /\b(cash|money|broke|loan|rent|salary|payday|credit|debt|rich|bills)\b/,
        /\b(make money|earn money|get paid|send money|cash app|paypal|venmo)\b/,
      ],
      replies: [
        () => pick([
          "Financial stress is no joke - and it can genuinely affect your cycle 🩷 If you've noticed changes (late period, mood shifts), I can help with those.",
          "I can't help with finances, but if money stress has your body acting up, tell me what you've been noticing.",
          "Money stress is one of those things the body feels for real 🩷 If your cycle has been off lately, that connection is worth looking at.",
          "Can't sort out the bills unfortunately 😅 but financial stress affecting your period or mood is genuinely something I can help with.",
          "Broke season hits different 😩 and your hormones feel it too - if your period's been late or your mood has shifted, tell me what's going on.",
          "I'm no financial advisor 😄 but if stress over money has your cycle acting up, that's exactly what I'm here for.",
        ]),
      ],
    },

    // ── Food / cravings ────────────────────────────────────────────────────
    {
      name: "food",
      patterns: [
        /\b(hungry|food|eat|eating|snack|cook|recipe|dinner|lunch|breakfast|meal)\b/,
        /\b(craving|cravings)\b/,
        /\b(kfc|pizza|burger|patty|taco|fries|ice cream|chocolate)\b/,
      ],
      replies: [
        (t) => {
          // Never attach phase-aware cravings context to an urgent message
          if (extractUrgency(t)) return null;

          const phaseInfo = getCurrentPhase();
          const phase = phaseInfo?.phase;

          if (phase === "luteal") {
            return pick([
              "Those cravings are so real right now 🩷 In the luteal phase your progesterone is higher and your body is actually burning more calories - sweet and salty cravings are your hormones talking, not weakness. Magnesium-rich foods like dark chocolate, nuts, and leafy greens can genuinely help take the edge off.",
              "Luteal phase cravings hit different for a reason 🩷 Your body is working harder (burning more calories!) and progesterone has a sedating, hunger-driving effect. Magnesium from dark chocolate, nuts, and leafy greens can actually take the edge off.",
              "It makes complete sense that you're craving things right now 🩷 In your luteal phase your metabolism is running a little faster and progesterone pushes hunger up - that craving isn't weakness, it's hormones. Reaching for magnesium-rich options like dark chocolate or nuts can genuinely help.",
            ]);
          }
          if (phase === "menstrual") {
            return pick([
              "Your body is working hard right now and iron and energy needs go up during your period - cravings for comfort food make complete sense. Try to get some iron-rich foods in alongside the treats 🩷",
              "During your period your body is losing iron through bleeding and needs more energy to keep going - craving comfort food is your body asking for support. Pair the treats with something iron-rich when you can 🩷",
              "Comfort food cravings during your period are completely real - your body is physically working hard and iron needs go up during bleeding. Don't guilt-trip yourself; just try to sneak in some iron-rich foods too 🩷",
            ]);
          }
          if (phase === "follicular") {
            return pick([
              "Interestingly your appetite is usually lower in the follicular phase - if you're craving more than usual it might be worth noticing whether stress or sleep is playing a role.",
              "In the follicular phase most people's appetite naturally dips as estrogen rises - if strong cravings are showing up, it's worth checking in on your sleep and stress levels, since both can drive hunger.",
              "Your appetite is typically lower during the follicular phase, so strong cravings right now are worth paying attention to - stress, poor sleep, or not eating enough earlier in the day can all be behind it.",
            ]);
          }
          if (phase === "ovulation") {
            return pick([
              "Around ovulation your energy is usually higher and appetite often dips naturally - strong cravings at this point sometimes signal your body needs something specific, like more protein or iron.",
              "Ovulation tends to bring higher energy and a naturally lower appetite for most people - if you're experiencing strong cravings, it might be your body asking for more protein or iron specifically.",
              "Your body is at peak energy around ovulation and hunger often drops - intense cravings at this stage can be a sign your body wants something specific like protein, iron, or complex carbs.",
            ]);
          }

          // Phase unknown - warm deflect + one-time nudge to log period date
          const base = pick([
            "I can't help with food orders 😄 but if you're getting strong cravings before your period, that's actually a hormonal thing I can talk through with you 🩷",
            "Cravings are real - especially the pre-period chocolate ones 🍫 If they're cycle-related, tap **Hormones / mood changes** and let's dig in.",
            "Not a food delivery service unfortunately 😄 but pre-period cravings? That's fully in my lane - hormones are wild.",
          ]);
          if (!ctx.adviceGiven.has("phase_nudge")) {
            ctx.adviceGiven.add("phase_nudge");
            return base + " If you log your period start date in the dashboard, I can actually tell you why your body might be craving what it's craving right now 🩷";
          }
          return base;
        },
      ],
    },

    // ── Weather ────────────────────────────────────────────────────────────
    {
      name: "weather",
      patterns: [/\b(weather|rain|forecast|temperature|hot|cold|storm|hurricane|sunshine)\b/],
      replies: [
        () => pick([
          "I can't check the forecast, but I can help with cycle and health concerns 🩷 What's going on?",
          "Not a weather app unfortunately 😅 but if something health-related is on your mind, I'm here.",
          "Can't predict the rain, but I can help you understand your cycle patterns 😄 What's up?",
          "Jamaica sun or Jamaica rain - either way I can't help with the forecast 😄 But if your health is on your mind, I'm here.",
          "Wish I could tell you, but weather's not my area 🩷 Anything cycle or health related, though - you're in the right place.",
          "Not Accuweather 😄 but cycle and symptom support? That I can do. What's going on?",
        ]),
      ],
    },

    // ── Travel ─────────────────────────────────────────────────────────────
    {
      name: "travel",
      patterns: [/\b(travel|flight|airport|hotel|trip|vacation|visa|overseas|abroad)\b/],
      replies: [
        () => "Travel can actually delay your period - timezone changes and disrupted routines affect hormones more than people realize 🩷",
        () => "If your period has been off since a trip or big change in routine, tap **Late or missed period** and let's look at it.",
      ],
    },

    // ── Sports / entertainment ─────────────────────────────────────────────
    {
      name: "sports",
      patterns: [/\b(score|match|game|league|team|football|soccer|basketball|cricket|volleyball|netball)\b/],
      replies: [
        () => pick([
          "I'm not a sports desk unfortunately 😄 but I'm here for cycle and health concerns. What's going on?",
          "Can't help with scores, but if something's up with your period or symptoms, I've got you 🩷",
        ]),
      ],
    },

    // ── Music / entertainment ──────────────────────────────────────────────
    {
      name: "entertainment",
      patterns: [/\b(song|music|album|artist|playlist|netflix|movie|show|watch|listen|tiktok|instagram|youtube)\b/],
      replies: [
        () => pick([
          "I'm not great at entertainment recs 😄 but I'm good at cycle concerns. What's going on health-wise?",
          "Can't help with that one, but I'm all ears for anything period or cycle related 🩷",
        ]),
      ],
    },

    // ── School / work ──────────────────────────────────────────────────────
    {
      name: "school",
      patterns: [/\b(homework|assignment|exam|class|grades|deadline|study|school|university|college|work|job|boss|office)\b/],
      replies: [
        () => pick([
          "I can't help with school or work stuff, but deadline stress is a known cycle disruptor 🩷 If your period's been off lately, let me know.",
          "Not a study buddy, but stress from school or work can genuinely affect your cycle - if you've noticed changes, I can help.",
          "Exams and assignments aren't quite my area 😄 but study stress affecting your period or mood? That I can talk about.",
          "Can't write the assignment for you 😅 but if the pressure has your cycle going haywire, tell me what you've noticed.",
          "School stress is no joke - and it's one of the most common reasons periods go late or moods go sideways 🩷 Is anything shifting for you?",
          "Not a tutor unfortunately 😄 but chronic stress from work or studies can genuinely disrupt your hormones - if that's happening, let's talk.",
        ]),
      ],
    },

    // ── Tech / app issues ──────────────────────────────────────────────────
    {
      name: "tech_general",
      patterns: [/\b(error|bug|crash|not working|broken|glitch|loading|frozen)\b/, /\b(app|button|page|screen)\b/],
      replies: [
        () => "If something in the Bloom app isn't working, that's worth reporting - you can use the feedback option in the menu 🩷",
        () => "If you were actually trying to ask a health question, just type it out and I'll do my best to help.",
      ],
    },

    // ── General non-repro health ───────────────────────────────────────────
    {
      name: "non_repro_health",
      patterns: [/\b(cough|flu|cold|headache|sore throat|stomach bug|rash|allergy|infection|virus|covid)\b/],
      replies: [
        () => "I focus on reproductive and cycle health, so general illness is a bit outside my lane 🩷",
        () => "That said - if you've been sick and your period changed, I can help connect those dots. What's been going on with your cycle?",
      ],
    },

    // ── Sleep ──────────────────────────────────────────────────────────────
    {
      name: "sleep",
      patterns: [/\b(can't sleep|cant sleep|insomnia|sleep|tired all day|exhausted all day|awake all night)\b/],
      replies: [
        () => "Sleep struggles are real - and they can genuinely affect your hormones and cycle 🩷",
        (t) => {
          const base = "If poor sleep is showing up alongside mood changes or cycle shifts, tap **Hormones / mood changes** and let's look at the full picture.";
          const phaseInfo = getCurrentPhase();
          const insight = insightFor(phaseInfo?.phase, "sleep", t);
          if (insight) return `${base} ${insight}`;
          const nudge = phaseNudge();
          return nudge ? `${base} ${nudge}` : base;
        },
      ],
    },

    // ── Weight / body image ────────────────────────────────────────────────
    {
      name: "body_image",
      patterns: [/\b(weight|fat|skinny|body|diet|calories|lose weight|gain weight|body image|bloated all the time)\b/],
      replies: [
        () => "Body changes can be connected to your cycle more than you'd think 🩷",
        (t) => {
          const base = "If you've noticed weight shifts, bloating, or body changes around your period, tap **Hormones / mood changes** or **Something else** and I'll help.";
          const phaseInfo = getCurrentPhase();
          const phase = phaseInfo?.phase;
          // bloating ranks above skin in CONCERN_PRIORITY - use pickPriorityConcern
          const concern = pickPriorityConcern(phase, ["bloating", "skin"]);
          const insight = concern ? insightFor(phase, concern, t) : null;
          if (insight) return `${base} ${insight}`;
          const nudge = phaseNudge();
          return nudge ? `${base} ${nudge}` : base;
        },
      ],
    },

    // ── Compliments / thanks ───────────────────────────────────────────────
    {
      name: "compliments",
      patterns: [/\b(thank you|thanks|ur so helpful|you're great|good job|well done|love this|love you|appreciate)\b/],
      replies: [
        () => pick([
          "That means a lot 🩷 Is there anything else I can help with today?",
          "So glad I could help 🩷 Anything else on your mind?",
          "You're so welcome 🩷 Take care of yourself!",
          "Aww, that warms my heart 🩷 You deserve good care - anything else I can help with?",
          "Glad I could be helpful today 🩷 Don't hesitate to come back if anything comes up.",
          "That genuinely means a lot 🩷 You're doing great just by paying attention to your body.",
          "Big up to you for looking out for your health 🩷 Come back anytime.",
        ]),
      ],
    },

    // ── Confusion / frustration with Bloomie ──────────────────────────────
    {
      name: "confused_with_bloomie",
      patterns: [/\b(you don't understand|you're not helping|this isn't working|useless bot|not what i asked|wrong answer|bad answer)\b/],
      replies: [
        () => pick([
          "I'm sorry I didn't catch that right 🩷 I'm still learning and I know I have limits - try tapping one of the buttons below.",
          "My bad - I missed what you were getting at 🩷 The buttons below are more reliable than my text understanding right now.",
          "I hear your frustration and I'm sorry 🩷 Try rephrasing what's going on with your body and I'll do my best.",
          "Not always perfect, I know 😕 If you can describe it simply - like 'late period' or 'bad cramps' - I'll follow better.",
          "Sorry I didn't get that right 🩷 Sometimes typing something short like 'my period is late' or 'I have cramps' works better than a longer message.",
          "I'm doing my best but I know I don't always get it right 🩷 Try a button below or rephrase and I'll try again.",
        ]),
      ],
    },

    // ── STIs / sexual health adjacent ─────────────────────────────────────
    {
      name: "sti_questions",
      patterns: [/\b(std|sti|hiv|herpes|chlamydia|gonorrhea|syphilis|infection down there|burning when i pee|discharge that smells)\b/],
      replies: [
        () => "STI symptoms can sometimes overlap with cycle symptoms, so I want to be careful here 🩷",
        () => "I'm not equipped to help with STI diagnosis or treatment - but if you're noticing unusual discharge, pain, or changes, a healthcare provider can check properly.",
        () => "You can use the care map to find a clinic near you.",
      ],
    },

    // ── Contraception questions ────────────────────────────────────────────
    {
      name: "contraception",
      patterns: [/\b(birth control|contraception|pill|depo|iud|implant|condom|plan b|morning after|emergency contraception)\b/],
      replies: [
        () => "Contraception can definitely affect your cycle - especially spotting, period timing, and mood 🩷",
        () => "I can help with the cycle side of things. If your period changed after starting or stopping birth control, tap **Spotting** or **Late or missed period** and let's look at it.",
      ],
    },

    // ── Postpartum questions ──────────────────────────────────────────────
    {
      name: "postpartum_q",
      patterns: [
        /\b(after birth|postpartum|after delivery|after baby|after i gave birth|period after baby|period after birth|breastfeeding.*period|period.*breastfeed)\b/,
        /\b(lochia|bleeding after birth|bleeding after delivery|fourth trimester)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_POSTPARTUM",
    },

    // ── TTC / trying to conceive ───────────────────────────────────────────
    {
      name: "ttc_q",
      patterns: [
        /\b(trying to (conceive|get pregnant)|trying for a baby|ttc|when (can|should) i try|fertile window|best time to conceive|ovulation.*window|when do i ovulate|am i ovulating)\b/,
        /\b(how (long|hard) to get pregnant|chances of (getting |becoming )?pregnant|conceive naturally)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_TTC_INFO",
    },

    // ── Telecom / phone plans ─────────────────────────────────────────────
    {
      name: "telecom",
      patterns: [
        /\b(digicel|flow|airtime|data plan|bundle|sim|top up|top-up)\b/,
        /\b(wifi|internet|signal|network|router|data)\b/,
      ],
      replies: [
        () => "That sounds like a phone or service question - not quite my area 🩷",
        () => "If you were trying to ask a health question, just type it and I'll do my best.",
      ],
    },

    // ── Jokes / banter ─────────────────────────────────────────────────────
    {
      name: "jokes",
      patterns: [/\b(lol|lmao|haha|😂|🤣|joke|funny|make me laugh|bored)\b/],
      replies: [
        () => pick([
          "I'm not the funniest assistant out there 😅 but I'm pretty solid at cycle questions. What's going on?",
          "Ha 😄 Okay okay, I'll stay in my lane. What's going on health-wise?",
          "Comedians out here and I'm just a cycle assistant 😄 What's actually on your mind?",
          "I can't compete with the group chat jokes 😂 but if something health-related is going on, I've got you.",
          "Laughter is good medicine 😄 - but if you've got an actual question about your cycle, I'm here for that too.",
          "The bored season is real 😄 If you want something to actually think about - how's your cycle been lately?",
        ]),
      ],
    },
  ];

  // Health signals that should ALWAYS beat OOS pattern matches.
  // e.g. "me bleed thru me pants lol" has "lol" but the health signal wins.
  const HEALTH_OVERRIDE_PATTERNS = [
    /\b(bleed|bleeding|blood|period|cramp|pain|spot|spotting|late|missed|discharge|pregnant|pregnancy|nausea|dizzy|faint|heavy|clot|pelvic|mood|tired|fatigue|cycle|ovulat)\b/,
  ];

  // Cycle question patterns - checked FIRST before health override
  // because they contain words like "period" that health override would swallow
  const CYCLE_QUESTION_PATTERNS = [
    /\b(what phase|which phase|am i ovulating|where am i in my cycle|what day of my cycle)\b/,
    /\b(when is my (next )?period|when will my period|when do i get my period|period due|how long (until|till) my period)\b/,
    /\b(when was my last period|when did my period|last period date|my lmp)\b/,
    /\b(when is my due date|what is my due date|due date|edd|estimated delivery|how far along|how many weeks (am i|pregnant))\b/,
    /\b(when (should|can) i (take|do) a (pregnancy )?test|when (should|can) i test|best time to test|when to test|can i test (yet|now))\b/,
  ];

  // ---------------- CONTEXT-AWARE CHOICE MATCHER ----------------
  // Tries to match what the user typed to one of the current node's choices.
  // Handles: yes/no/not sure answers, patois variants, and partial label matches.
  // Resolve choices - can be a plain array OR a function returning an array
  function resolveChoices(node) {
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

    // ── Alias map: common typed phrases → choice id ──────────────────────
    const YES_WORDS  = ["yes", "yeah", "yep", "yup", "yah", "ya", "definitely",
                        "for sure", "correct", "true", "i have", "i did", "i do",
                        "mi have", "mi did", "mi do", "yes i", "yeah i"];
    const NO_WORDS   = ["no", "nah", "nope", "not really", "i have not", "i don't",
                        "i dont", "no i", "nah i", "mi nuh", "mi never",
                        "no me", "nah me", "definitely not", "not at all"];
    const UNSURE_WORDS = ["not sure", "unsure", "idk", "i don't know", "i dont know",
                          "maybe", "not really sure", "mi nuh know", "dunno",
                          "hard to say", "not certain"];

    // Check for yes/no/not sure pattern on nodes that have those choices
    const hasYes    = choices.find(c => c.id === "yes");
    const hasNo     = choices.find(c => c.id === "no");
    const hasNs     = choices.find(c => c.id === "ns");

    if (hasYes && YES_WORDS.some(w => t === w || t.startsWith(w + " ") || t.endsWith(" " + w))) {
      return hasYes;
    }
    if (hasNo && NO_WORDS.some(w => t === w || t.startsWith(w + " ") || t.endsWith(" " + w))) {
      return hasNo;
    }
    if (hasNs && UNSURE_WORDS.some(w => t.includes(w))) {
      return hasNs;
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

    for (const choice of node.choices) {
      const hints = CHOICE_HINTS[choice.id];
      if (hints && hints.some(h => t.includes(h))) return choice;
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

  // ── Pipeline debug utility ────────────────────────────────────────────────
  // Activated only when localStorage.getItem("bloomie_debug") === "true".
  // Logs each stage of the processing pipeline for inspection.
  function debugPipeline(rawInput, normalizedInput, fuzzyInput, expandedInput, entities, tone, urgency, route) {
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem("bloomie_debug") !== "true") return;
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

  // ---------------- ROUTER (Phase 2 - inference object) ----------------
  // Instead of scores.late += 2, we build a signal object and reason
  // over combinations before falling back to a single best-intent pick.
  // NOTE: receives already-normalized text. Inference layer in bloomie-inference.js
  // runs BEFORE this - so only inputs that didn't match entities reach here.
  function routeUserText(t) {
    t = String(t || "").toLowerCase();

    // ── Urgency: always first ──────────────────────────────────────────────
    const urgentPhrases = [
      "faint", "passed out", "cant breathe", "can't breathe",
      "shortness of breath", "soaking through", "bleeding through",
    ];
    if (urgentPhrases.some((p) => t.includes(p))) return { next: "HEAVY_URGENT" };

    // ── Heavy bleeding multi-route detection (priority: C > A > B) ────────
    const heavyRouteC = [
      "dizzy", "lightheaded", "feel sick", "can't stand", "cant stand",
      "feel like pass out", "mi feel weak", "mi dizzy", "mi feel faint",
      "mi head spinning", "feel like mi a go drop", "fainting",
    ];
    const heavyRouteA = [
      "soaking", "soaked", "flooding", "bleed through", "bleed nuff",
      "pad full", "tampon full", "changing every hour",
      "bleed out", "bleeding out bad", "pad full up", "tampon full up",
      "blood everywhere", "nuff blood",
    ];
    const heavyRouteB = [
      "won't stop", "wont stop", "not stopping", "still bleeding",
      "bleeding for days", "been bleeding", "period too long",
      "period won't end", "period wont end",
      "7 days", "8 days", "9 days", "10 days", "week of bleeding",
      "nuh stop bleed", "period nuh stop", "period still a go",
      "bleeding too long", "a week now",
    ];
    // Route C also matches standalone "weak" as a whole word
    const isHeavyC = heavyRouteC.some((p) => t.includes(p)) || /\bweak\b/.test(t);
    const isHeavyA = heavyRouteA.some((p) => t.includes(p));
    const isHeavyB = heavyRouteB.some((p) => t.includes(p));
    if (isHeavyC && (isHeavyA || isHeavyB || /\bbleed|\bperiod|\bblood|\bheavy\b/.test(t))) return { next: "HEAVY_ROUTE_C" };
    if (isHeavyA) return { next: "HEAVY_INTRO" };
    if (isHeavyB) return { next: "HEAVY_ROUTE_B" };

    // ── Pregnancy test: already tested negative ───────────────────────────
    if (
      /tested negative/.test(t) ||
      /negative test/.test(t) ||
      /test came back negative/.test(t) ||
      /took a test already/.test(t) ||
      /already tested/.test(t)
    ) return { next: "TEST_NEGATIVE_INTRO" };

    // ── Pregnancy test: recent unprotected sex ────────────────────────────
    if (
      /had unprotected sex/.test(t) ||
      /unprotected sex recently/.test(t) ||
      /sex without (a )?condom/.test(t) ||
      /forgot (the )?condom/.test(t)
    ) return { next: "TEST_RECENT_SEX_INTRO" };

    // ── Session summary request ───────────────────────────────────────────────
    // Catches "what did you say", "remind me", Patois "wah we talk bout", etc.
    if (
      /\b(what did (you|bloomie) say|remind me|what have we (covered|talked|discussed)|what did we talk|what was that again|give me a summary|what have you told me)\b/i.test(t) ||
      /\b(summary)\b/i.test(t) ||
      /\b(wah we (talk|cover|discuss)|wah yu say|wah you say|wah we talk bout)\b/i.test(t)
    ) return { next: "CONVERSATION_SUMMARY" };

    // ── Single-word / ultra-short routing ─────────────────────────────────────
    // Ensures common single-word inputs route immediately rather than falling to OOS.
    if (/^\s*(idk|i don'?t know|not sure)\s*$/i.test(t))                           return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/^\s*help\s*$/i.test(t))                                                   return { next: "START_MENU" };
    if (/^\s*period\s*$/i.test(t))                                                 return { next: "PERIOD_TRIAGE" };
    if (/^\s*late\s*$/i.test(t))                                                   return { next: "LATE_INTRO" };
    if (/^\s*(pain|ache|aching)\s*$/i.test(t))                                     return { next: "PELVIC_INTRO" };
    if (/^\s*(cramps?|cramping)\s*$/i.test(t))                                     return { next: "PELVIC_INTRO" };
    if (/^\s*(bleeding|blood|bleed)\s*$/i.test(t))                                 return { next: "HEAVY_INTRO" };
    if (/^\s*(spotting|spots?)\s*$/i.test(t))                                      return { next: "SPOT_INTRO" };
    if (/^\s*(pregnant|pregnancy)\s*$/i.test(t))                                   return { next: "PREGNANCY_ENTRY" };
    if (/^\s*(discharge)\s*$/i.test(t))                                            return { next: "ELSE_DISCHARGE_ENTRY" };
    if (/^\s*(mood|moods)\s*$/i.test(t))                                           return { next: "MOOD_SAFETY_CHECK" };
    if (/^\s*(nausea|nauseous|queasy)\s*$/i.test(t))                               return { next: "PREGNANCY_ENTRY" };
    if (/^\s*(dizzy|dizziness)\s*$/i.test(t))                                      return { next: "PELVIC_INTRO" };
    if (/^\s*(tired|fatigue|exhausted)\s*$/i.test(t))                              return { next: "MOOD_SAFETY_CHECK" };
    if (/^\s*(test|testing)\s*$/i.test(t))                                         return { next: "TEST_INTRO" };
    if (/^\s*(endo|endometriosis)\s*$/i.test(t))                                   return { next: "EDUC_ENDO" };
    if (/^\s*pcos\s*$/i.test(t))                                                   return { next: "EDUC_PCOS" };
    if (/^\s*menopause\s*$/i.test(t))                                              return { next: "MENOPAUSE_INFO_NODE" };
    if (/^\s*(panadol|ibuprofen|buscopan|ponstan|naproxen)\s*$/i.test(t))          return { next: "MEDICATION_REDIRECT" };

    // Vague/indirect → not sure route
    if (/\b(something feels off|feel off|not feeling right|sumn wrong|something wrong with me)\b/.test(t)) return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/^is this normal\??\s*$/i.test(t))                                         return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/\b(something is coming out|sumn a come out)\b/.test(t))                   return { next: "ELSE_DISCHARGE_ENTRY" };
    if (/\b(i don.t feel like myself|mi nuh feel like miself)\b/.test(t))          return { next: "MOOD_SAFETY_CHECK" };

    // ── Condition education: PCOS ─────────────────────────────────────────
    // Explicit name, or "irregular period" paired with acne or hair symptoms.
    if (
      /\bpcos\b/.test(t) ||
      /\bpolycystic\b/.test(t) ||
      (/irregular period/.test(t) && /\bacne\b/.test(t)) ||
      (/irregular period/.test(t) && /\bhair\b/.test(t))
    ) return { next: "EDUC_PCOS" };

    // ── Condition education: Endometriosis ────────────────────────────────
    if (
      /\bendometriosis\b/.test(t) ||
      /\bendo\b/.test(t) ||
      /pain every period/.test(t) ||
      /period pain that doesn.t go away/.test(t)
    ) return { next: "EDUC_ENDO" };

    // ── Condition education: Contraception ────────────────────────────────
    if (
      /\bcontraception\b/.test(t) ||
      /birth control/.test(t) ||
      /\bcondom\b/.test(t) ||
      /\bpill\b/.test(t) ||
      /\biud\b/.test(t) ||
      /\bimplant\b/.test(t) ||
      /family planning/.test(t)
    ) return { next: "EDUC_CONTRACEPTION" };

    // ── Perimenopause ─────────────────────────────────────────────────────
    if (
      /\bperimenopause\b/.test(t) ||
      /peri.?menopause/.test(t) ||
      /going through the change/.test(t) ||
      /change of life/.test(t) ||
      /\bpremenopause\b/.test(t) ||
      /mi (think mi |a )?go through the change/.test(t) ||
      (/irregular period/.test(t) && /hot flash/.test(t)) ||
      /my period is changing/.test(t)
    ) return { next: "PERIMENOPAUSE_INTRO" };

    // ── Menopause ─────────────────────────────────────────────────────────
    if (
      /\bmenopause\b/.test(t) ||
      /\bmenopausal\b/.test(t) ||
      /no period for months/.test(t) ||
      /period (stopped|done|finish)/.test(t) ||
      /mi period stop/.test(t)
    ) return { next: "MENOPAUSE_INFO_NODE" };

    // ── Pregnancy concern: intent-first entry ─────────────────────────────
    if (
      /\bpregnancy concern\b/.test(t) ||
      /\bpregnancy scare\b/.test(t) ||
      /could i be pregnant/.test(t) ||
      /might i be pregnant/.test(t) ||
      /am i pregnant/.test(t) ||
      /\bfertility concern\b/.test(t) ||
      /trying to conceive/.test(t) ||
      /trying to get pregnant/.test(t) ||
      /trying for a baby/.test(t) ||
      (/\bpregnant\b/.test(t) && !/tested (negative|positive)/.test(t) && !/test (came back|was) (negative|positive)/.test(t))
    ) return { next: "PREGNANCY_ENTRY" };

    // ── Mood: Patois explicit patterns ────────────────────────────────────
    if (
      /mi feel off/.test(t) ||
      /mi nuh feel right/.test(t) ||
      /mi sad fi no reason/.test(t) ||
      /mi vex all the time/.test(t) ||
      /mi feel empty/.test(t) ||
      /mi cyan cope/.test(t) ||
      /everything a get to me/.test(t) ||
      /mi nuh have no energy fi nothing/.test(t)
    ) return { next: "MOOD_SAFETY_CHECK" };

    // ── Pelvic pain: Patois explicit patterns ─────────────────────────────
    if (
      /mi belly a hurt/.test(t) ||
      /pain down deh/.test(t) ||
      /cramp bad/.test(t) ||
      /pain inna mi belly/.test(t) ||
      /belly (a )?hurting/.test(t) ||
      /waist a hurt/.test(t) ||
      /pain between mi legs/.test(t)
    ) return { next: "PELVIC_SAFETY_CHECK" };

    const { sig, has } = scoreSignals(t);
    const combo = resolveSignals(sig, has);
    if (combo) return combo;

    // ── Single best-signal fallback ───────────────────────────────────────
    // If no combination rule fired, pick the strongest single signal.
    const best = Object.entries(sig).sort((a, b) => b[1] - a[1])[0];
    const [bestIntent, bestScore] = best;

    if (bestScore < 2) {
      // ── Deterministic OOS handling ───────────────────────────────
      const cat = detectOutOfScope(t, OOS, HEALTH_OVERRIDE_PATTERNS);
      if (cat) {
        const lines = (cat.replies || OOS_DEFAULT)
          .map((r) => typeof r === "function" ? r(t) : r)
          .filter(Boolean);
        if (cat.name === "greeting") ctx.greeted = true;
        ctx.lastOOS = cat.name;
        return {
          reply: lines.length ? lines : OOS_DEFAULT.map((r) => (typeof r === "function" ? r(t) : r)),
          next: cat.forceNext || "START_MENU",
          payload: { oos: cat.name },
        };
      }
      return {
        reply: OOS_DEFAULT.map((r) => (typeof r === "function" ? r(t) : r)),
        next: "START_MENU",
        payload: { oos: "default" },
      };
    }

    // Route by best single signal
    if (bestIntent === "heavy")     return { next: "HEAVY_INTRO" };
    if (bestIntent === "late")      return { next: "LATE_INTRO" };
    if (bestIntent === "spot")      return { next: "SPOT_INTRO" };
    if (bestIntent === "mood")      return { next: "MOOD_SAFETY_CHECK" };
    if (bestIntent === "pregnancy") return { next: "PREGNANCY_ENTRY" };
    if (bestIntent === "discharge") return { next: "ELSE_DISCHARGE" };
    if (bestIntent === "pelvic") {
      return { next: "PELVIC_SAFETY_CHECK" };
    }

    // Late check with cycle data
    if (has("late_check", 2)) return { next: "LATE_PERIOD_CHECK", payload: { reason: "late_check" } };

    // Red flag / should I see a doctor - needs context from lastIntent
    if (has("red_flag", 2)) return { next: "SEE_DOCTOR_GUIDE", payload: { reason: "see_doctor" } };

    return { next: "START_MENU" };
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
  // Tune all Bloomie message pacing from one place.
  // calcDelay() and estimateSayTime() read these values - never hardcode ms.
  const BLOOMIE_TIMING = {
    firstBubbleMs: 500,   // delay before the very first bubble in any sequence
    msPerChar:       9,   // reading-pace coefficient (ms per visible character)
    renderBuffer:  150,   // padding added to estimateSayTime for render latency
    short:  { maxLen:  80, minMs:  650, maxMs:  800 },  // ≤ 80 chars
    medium: { maxLen: 220, minMs:  900, maxMs: 1200 },  // 81-220 chars
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
  function say(lines, { delayMs = null, keepLocked = false } = {}) {
    const arr = Array.isArray(lines) ? lines : [lines];
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
        pushMsg("bot", t);
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

    // ── Safety log: escalation - "seek care" node reached ─────────────────
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

    ctx.state = nextState;

    // ── Conversation profile: track topics and resolve concerns ──────────────
    {
      const prof = ctx.conversationProfile;
      const TOPIC_NODE_MAP = {
        LATE_INTRO: "late", LATE_PERIOD_CHECK: "late", TEST_INTRO: "late",
        HEAVY_INTRO: "heavy", HEAVY_ROUTE_B: "heavy", HEAVY_ROUTE_C: "heavy",
        SPOT_INTRO: "spot", SPOT_PREG_INFO: "spot",
        MOOD_SAFETY_CHECK: "mood", MOOD_INTRO: "mood",
        PELVIC_INTRO: "pelvic", PELVIC_SAFETY_CHECK: "pelvic",
        PREGNANCY_ENTRY: "pregnancy",
        ELSE_DISCHARGE: "discharge", ELSE_DISCHARGE_ENTRY: "discharge",
      };
      // Track topic entered
      const topicCode = TOPIC_NODE_MAP[nextState];
      if (topicCode && !prof.topicsDiscussed.includes(topicCode)) {
        prof.topicsDiscussed.push(topicCode);
      }
      // Mark topic as resolved when a wrap/close-adjacent node is entered
      const RESOLVED_NODES = new Set([
        "SUMMARY", "CLOSE", "MOOD_GUIDE", "HEAVY_GUIDE", "LATE_GUIDE",
        "SPOT_GUIDE", "PELVIC_GUIDE", "PREG_GUIDE",
      ]);
      if (RESOLVED_NODES.has(nextState) && topicCode) {
        if (!prof.concernsResolved.includes(topicCode)) {
          prof.concernsResolved.push(topicCode);
        }
      }
      // Surface unresolved concerns before CLOSE
      if (nextState === "CLOSE" && prof.concernsUnresolved.length > 0) {
        const TOPIC_LABELS = {
          late: "late or missed period", heavy: "heavy bleeding", spot: "spotting",
          mood: "mood or energy changes", pelvic: "pelvic pain or cramps",
          pregnancy: "pregnancy concerns", discharge: "discharge",
        };
        const firstUnresolved = prof.concernsUnresolved[0];
        const label = TOPIC_LABELS[firstUnresolved] || firstUnresolved;
        say([
          "Before you go - you also mentioned " + label + " earlier. Do you want to quickly look at that too? 💗",
        ], {
          choices: [
            { id: "yes_unresolved", label: "Yes, let’s look at that", next: "START_MENU" },
            { id: "no_done", label: "No, I’m done", next: "CLOSE" },
          ],
        });
        prof.concernsUnresolved.shift();
        return;
      }
    }

    const node = NODES[nextState];
    if (!node) return;
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
      told_to_call_911:  "Call emergency services or go to A&E immediately",
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
              <div class="bubble${m.meta?.html ? " bubble--html" : ""}">${m.meta?.html ? m.text : escapeHtml(m.text).replaceAll("\n", "<br>")}</div>
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
    const _choices = resolveChoices(node);
    // Snapshot the flow ID at render time so buttons can detect if they're stale.
    const renderedFlowId = ctx.flowId;
    if (_choices.length) {
      // Track the epoch at which this node's choices were rendered so that
      // matchTypedToChoice can apply the same staleness guard as button clicks.
      ctx.nodeFlowId = renderedFlowId;
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
          advanceFlow();
          pushMsg("user", choice.label);
          if (node.question) recordAnswer(node.question, choice.label);
          if (choice.action === "OPEN_MAP")      onOpenCareMap();
          if (choice.action === "REQUEST_PDF")   onRequestPdf(buildSummaryText());
          if (choice.action?.startsWith("LOG_")) onLogAction(choice.action, choice.logData || {});
          if (typeof choice.onSelect === "function") choice.onSelect();
          // "I'm done for now" → SUMMARY when there's advice to show
          const effectiveNext = (choice.id === "done" && choice.next === "CLOSE" && ctx.adviceGiven.size > 0)
            ? "SUMMARY"
            : choice.next;
          transition(effectiveNext, { choiceId });
        });
      });
    }

    scrollToBottom();
  }

  // ---------- Conversation Nodes ----------

  // Returns a recall sentence if memory is recent and has symptom data, else null.
  // e.g. "Last time we talked, you mentioned a missed period and nausea -
  //        is that still going on, or is something new coming up?"
  function buildRecallLine() {
    if (!bloomieMemory?.lastSymptoms?.length) return null;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sessionDate  = bloomieMemory.lastSessionDate ? new Date(bloomieMemory.lastSessionDate) : null;
    if (!sessionDate || sessionDate < sevenDaysAgo) return null;

    const labels = [...new Set(
      bloomieMemory.lastSymptoms
        .flatMap(key => SYMPTOM_TO_CATALOG_KEYS[key] || [])
        .map(code => CATALOG_LABELS[code])
        .filter(Boolean)
        .slice(0, 3)
    )];
    if (!labels.length) return null;

    const list = labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;

    return `Last time we talked, you mentioned **${list}** - is that still going on, or is something new coming up?`;
  }

  // Mode-aware intro - Bloomie greets differently based on what she knows about the user
  function buildIntro() {
    const base   = `${greet()} I'm Bloomie, Bloom's health assistant 🌸`;
    const recall = buildRecallLine();
    // Appends the recall line (if any) after the core intro messages.
    const r = (lines) => recall ? [...lines, recall] : lines;

    if (userMode.isPregnancy && cd.lmp) {
      const weeksAlong = Math.floor(daysBetween(cd.lmp, new Date()) / 7);
      return r([
        base,
        `I can see you're in pregnancy tracking mode${weeksAlong > 0 ? ` - you're around ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along` : ""} 🩷`,
        "I can help with symptoms, test timing, due dates, or anything else on your mind. What's going on?",
      ]);
    }

    if (userMode.isTTC) {
      return r([
        base,
        "I can see you're in trying-to-conceive mode 🩷 I can help with ovulation windows, test timing, cycle tracking, and symptoms.",
        "What can I help you with today?",
      ]);
    }

    if (userMode.isPostpartum) {
      return r([
        base,
        "I can see you're in postpartum mode 🩷 Your cycle may behave differently for a while - that's completely normal.",
        "What's on your mind today?",
      ]);
    }

    if (userMode.isCycleTracking && cd.lmp) {
      const daysLeft = daysUntilNextPeriod();
      const dueSoon  = daysLeft !== null && daysLeft >= 0 && daysLeft <= 5;
      const overdue  = daysLeft !== null && daysLeft < 0;
      if (dueSoon) {
        return r([
          base,
          `I can see your period is due in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} 🩷`,
          "If you're already feeling symptoms, I can help. What's going on?",
        ]);
      }
      if (overdue) {
        return r([
          base,
          `I can see your period may have been due a few days ago 🩷`,
          "If it hasn't come yet or something feels off, I'm here. What's going on?",
        ]);
      }
      return r([
        base,
        "I can help with period concerns, cycle questions, spotting, cramps, mood changes, and more.",
        "What can I help you with today?",
      ]);
    }

    // Default / just browsing
    return r([
      base,
      "I can help you understand common period-related concerns based on what you decide to share, but I can't provide diagnoses.",
      "What can I help you with today?",
    ]);
  }

  const INTRO = buildIntro();

  const CLOSE =
    `${greet(true, "Thanks for talking with me")} If anything changes or you notice new symptoms, you can come back anytime. Remember you know your body best.`;

  const NODES = {
    START: {
      say: INTRO,
      delayMs: 1300,
      choices: [
        { id: "period",   label: "My period",                         next: "PERIOD_TRIAGE",         primary: true },
        { id: "pain",     label: "Pain or cramps",                    next: "PELVIC_INTRO" },
        { id: "mood",     label: "Mood, energy or sleep",             next: "MOOD_INTRO" },
        { id: "dis",      label: "Discharge or odour",                next: "ELSE_DISCHARGE" },
        { id: "preg",     label: "Pregnancy concern",                 next: "PREGNANCY_ENTRY" },
        { id: "hormones", label: "Hormones and skin",                 next: "HORMONES_SKIN_TRIAGE" },
        { id: "contra",   label: "Contraception or sexual health",    next: "EDUC_CONTRACEPTION" },
        { id: "else",     label: "Something else",                    next: "ELSE_INTRO" },
      ],
    },

    // Silent menu - no intro replay, just shows the choices again
    START_MENU: {
      choices() {
        const base = (() => {
          // Pregnancy mode - swap in pregnancy-relevant buttons
          if (userMode.isPregnancy) {
            return [
              { id: "edd",    label: "My due date / how far along",     next: "CYCLE_EDD_ANSWER",    primary: true },
              { id: "bleed",  label: "Bleeding or spotting",            next: "HEAVY_INTRO" },
              { id: "pain",   label: "Pain or cramps",                  next: "PELVIC_INTRO" },
              { id: "mood",   label: "Mood, energy or sleep",           next: "MOOD_INTRO" },
              { id: "dis",    label: "Discharge or odour",              next: "ELSE_DISCHARGE" },
              { id: "test",   label: "Pregnancy test timing",           next: "CYCLE_TEST_TIMING" },
              { id: "else",   label: "Something else",                  next: "ELSE_INTRO" },
            ];
          }
          // TTC mode - ovulation-first layout
          if (userMode.isTTC) {
            return [
              { id: "ovul",     label: "My ovulation window",              next: "TTC_INTRO",          primary: true },
              { id: "test",     label: "When should I test?",              next: "CYCLE_TEST_TIMING" },
              { id: "period",   label: "My period",                        next: "PERIOD_TRIAGE" },
              { id: "hormones", label: "Hormones and skin",                next: "HORMONES_SKIN_TRIAGE" },
              { id: "mood",     label: "Mood, energy or sleep",            next: "MOOD_INTRO" },
              { id: "else",     label: "Something else",                   next: "ELSE_INTRO" },
            ];
          }
          // Postpartum mode
          if (userMode.isPostpartum) {
            return [
              { id: "post",   label: "Postpartum concerns",            next: "POSTPARTUM_INTRO",    primary: true },
              { id: "bleed",  label: "Bleeding questions",             next: "HEAVY_INTRO" },
              { id: "mood",   label: "Mood, energy or sleep",          next: "MOOD_INTRO" },
              { id: "period", label: "Period hasn't returned yet",     next: "LATE_INTRO" },
              { id: "pain",   label: "Pain or cramps",                 next: "PELVIC_INTRO" },
              { id: "dis",    label: "Discharge or odour",             next: "ELSE_DISCHARGE" },
              { id: "contra", label: "Contraception",                  next: "EDUC_CONTRACEPTION" },
              { id: "else",   label: "Something else",                 next: "ELSE_INTRO" },
            ];
          }
          // Default - cycle tracking or browsing
          return [
            { id: "period",   label: "My period",                        next: "PERIOD_TRIAGE",         primary: true },
            { id: "pain",     label: "Pain or cramps",                   next: "PELVIC_INTRO" },
            { id: "mood",     label: "Mood, energy or sleep",            next: "MOOD_INTRO" },
            { id: "dis",      label: "Discharge or odour",               next: "ELSE_DISCHARGE" },
            { id: "preg",     label: "Pregnancy concern",                next: "PREGNANCY_ENTRY" },
            { id: "hormones", label: "Hormones and skin",                next: "HORMONES_SKIN_TRIAGE" },
            { id: "contra",   label: "Contraception or sexual health",   next: "EDUC_CONTRACEPTION" },
            { id: "else",     label: "Something else",                   next: "ELSE_INTRO" },
          ];
        })();
        return [...base, { id: "summary", label: "Get summary", next: "SUMMARY" }];
      },
    },

    // ── Period triage - consolidates all period-related entry points ────────
    PERIOD_TRIAGE: {
      say: ["Of course 🩷 What's going on with it?"],
      question: "Period concern type",
      choices: [
        { id: "late",  label: "Late or missed",              next: "LATE_INTRO",              primary: true },
        { id: "heavy", label: "Heavy or unusual",            next: "HEAVY_INTRO" },
        { id: "spot",  label: "Spotting between periods",    next: "SPOT_INTRO" },
        { id: "irreg", label: "Irregular or unpredictable",  next: "LATE_IRREGULAR_GUIDANCE" },
      ],
    },

    // ── Hormones and skin triage - PCOS, perimenopause, body changes ────────
    HORMONES_SKIN_TRIAGE: {
      say: ["Happy to help with this 🩷 What feels most like what you're experiencing?"],
      question: "Hormones / skin concern type",
      choices: [
        { id: "pcos",  label: "Acne, irregular cycles, or hair changes", next: "EDUC_PCOS",           primary: true },
        { id: "hfsh",  label: "Hot flashes or night sweats",             next: "PERIMENOPAUSE_INTRO" },
        { id: "bloat", label: "Bloating or unexplained body changes",    next: "ELSE_BODY_CHANGES" },
        { id: "tired", label: "Fatigue, brain fog, or mood swings",      next: "MOOD_INTRO" },
        { id: "hair",  label: "Hair thinning or shedding",               next: "EDUC_PCOS" },
      ],
    },

    // ── Zero-confidence narrowing ──────────────────────────────────────────
    // Reached when the input contains health-adjacent words but neither
    // inferRoute nor the keyword router could resolve a specific topic.
    // Presents topic buttons instead of a generic OOS reply.
    // ── Session summary node ───────────────────────────────────────────────────
    CONVERSATION_SUMMARY: {
      say(ctx) {
        const prof = ctx.conversationProfile || {};
        const TOPIC_LABELS = {
          late: "late or missed period", heavy: "heavy bleeding", spot: "spotting",
          mood: "mood or energy changes", pelvic: "pelvic pain or cramps",
          pregnancy: "pregnancy concerns", discharge: "discharge",
        };
        const ADVICE_LABELS = {
          told_to_test:      "pregnancy test timing",
          told_to_seek_care: "seeing a healthcare provider",
          told_to_monitor:   "monitoring your symptoms",
          logging_nudge:     "cycle tracking tips",
          phase_nudge:       "cycle phase information",
        };
        const lines = ["💗 Here’s what we’ve covered today:"];
        const topics = (prof.topicsDiscussed || []);
        if (topics.length) {
          lines.push("Topics: " + topics.map(t => TOPIC_LABELS[t] || t).join(", ") + ".");
        }
        const advice = ctx.adviceGiven ? [...ctx.adviceGiven] : [];
        if (advice.length) {
          lines.push("We discussed: " + advice.map(k => ADVICE_LABELS[k] || k).join(", ") + ".");
        }
        const unresolved = prof.concernsUnresolved || [];
        if (unresolved.length) {
          lines.push(
            "You also mentioned " + unresolved.map(t => TOPIC_LABELS[t] || t).join(" and ") +
            " - we can look at that if you’d like 💗"
          );
        }
        if (lines.length === 1) {
          lines.push("We’re just getting started 💗 What would you like to talk about?");
        }
        return lines;
      },
      choices: [
        { id: "continue", label: "Continue the conversation", next: "START_MENU" },
        { id: "done",     label: "I’m done for now",         next: "CLOSE" },
      ],
    },

    NARROWING: {
      say: "I want to make sure I help you with the right thing 💗 Which area is closest to what you're dealing with?",
      choices(ctx) {
        // When LOW confidence routing set narrowingCandidates, show those specific
        // topic buttons instead of the generic 6. Always append "Something else".
        if (ctx.narrowingCandidates && ctx.narrowingCandidates.length) {
          const seen = new Set(ctx.narrowingCandidates.map(c => c.id));
          const extra = seen.has("else") ? [] : [{ id: "else", label: "Something else", next: "ELSE_INTRO" }];
          return [...ctx.narrowingCandidates, ...extra];
        }
        return [
          { id: "heavy",  label: "Bleeding or flow",         next: "HEAVY_INTRO" },
          { id: "pain",   label: "Pain or cramps",           next: "PELVIC_INTRO" },
          { id: "cycle",  label: "Late or irregular cycle",  next: "LATE_INTRO" },
          { id: "mood",   label: "Mood or energy changes",   next: "MOOD_INTRO" },
          { id: "dis",    label: "Discharge",                next: "ELSE_DISCHARGE" },
          { id: "else",   label: "Something else",           next: "ELSE_INTRO" },
        ];
      },
    },

    /* ---------------- HEAVY OR UNUSUAL BLEEDING ---------------- */

    // ── Route A: Volume / soaking focus (also entry for button clicks) ────────
    HEAVY_INTRO: {
      autoNext(ctx) {
        ctx.heavyFlags = {};
        return null;
      },
      say: [
        "That sounds really uncomfortable - let's figure out what's going on 🩷",
        "During your heaviest moments, are you soaking through a pad or tampon every hour for two or more hours in a row?",
      ],
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_A_SOAK_YES", primary: true },
        { id: "no",  label: "No",  next: "HEAVY_A_RATE" },
      ],
    },
    HEAVY_A_SOAK_YES: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).rapidSoaking = true;
        return "HEAVY_SHARED_CORE";
      },
    },
    HEAVY_A_RATE: {
      say: ["How often are you having to change your pad or tampon?"],
      choices: [
        { id: "2_3h", label: "Every 2-3 hours",  next: "HEAVY_A_2_3H",      primary: true },
        { id: "3_4h", label: "Every 3-4 hours",  next: "HEAVY_SHARED_CORE" },
        { id: "ns",   label: "Not sure",          next: "HEAVY_SHARED_CORE" },
      ],
    },
    HEAVY_A_2_3H: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).heavierThanUsual = true;
        return "HEAVY_SHARED_CORE";
      },
    },

    // ── Route B: Duration / won't stop focus ─────────────────────────────────
    HEAVY_ROUTE_B: {
      autoNext(ctx) {
        ctx.heavyFlags = {};
        return null;
      },
      say: [
        "I hear you - bleeding that just won't stop is exhausting 🩷",
        "How many days has the bleeding been going on?",
      ],
      choices: [
        { id: "7_9",    label: "7-9 days",                               next: "HEAVY_B_7_9",    primary: true },
        { id: "10plus", label: "10 days or more",                        next: "HEAVY_B_10" },
        { id: "short",  label: "Less than 7 days but longer than usual", next: "HEAVY_B_LONGER" },
        { id: "ns",     label: "Not sure",                               next: "HEAVY_SHARED_CORE" },
      ],
    },
    HEAVY_B_7_9: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).prolongedBleeding = true;
        return "HEAVY_SHARED_CORE";
      },
    },
    HEAVY_B_10: {
      autoNext(ctx) {
        const f = ctx.heavyFlags = ctx.heavyFlags || {};
        f.prolongedBleeding = true;
        f.heavierThanUsual = true;
        return "HEAVY_SHARED_CORE";
      },
    },
    HEAVY_B_LONGER: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).heavierThanUsual = true;
        return "HEAVY_SHARED_CORE";
      },
    },

    // ── Route C: Symptoms / dizziness-first focus ─────────────────────────────
    HEAVY_ROUTE_C: {
      autoNext(ctx) {
        ctx.heavyFlags = {};
        return null;
      },
      say: [
        "Those symptoms alongside bleeding need attention 🩷",
        "Are you feeling dizzy, faint, or very weak right now?",
      ],
      choices: [
        { id: "yes",    label: "Yes",          next: "HEAVY_C_SYM_YES", primary: true },
        { id: "no",     label: "No",           next: "HEAVY_C_SOAK" },
        { id: "little", label: "A little bit", next: "HEAVY_C_SOAK" },
      ],
    },
    HEAVY_C_SYM_YES: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).symptomatic = true;
        return "HEAVY_SHARED_CORE";
      },
    },
    HEAVY_C_SOAK: {
      say: ["Okay - are you soaking through a pad or tampon about every hour?"],
      choices: [
        { id: "yes", label: "Yes, soaking about every hour", next: "HEAVY_C_SOAK_YES", primary: true },
        { id: "no",  label: "No, not that quickly",          next: "HEAVY_SHARED_CORE" },
      ],
    },
    HEAVY_C_SOAK_YES: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).rapidSoaking = true;
        return "HEAVY_SHARED_CORE";
      },
    },

    // ── Shared decision core ──────────────────────────────────────────────────
    // Step 1: pregnancy checkpoint
    HEAVY_SHARED_CORE: {
      say: [
        "One important thing to check 🩷",
        "Is there any chance you could be pregnant, or have you recently been pregnant, had a miscarriage, or given birth?",
      ],
      choices: [
        { id: "yes", label: "Yes, or I'm not sure", next: "HEAVY_PREG_YES", primary: true },
        { id: "no",  label: "No",                   next: "HEAVY_CORE_CLOTS" },
      ],
    },
    HEAVY_PREG_YES: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).possiblePregnancy = true;
        return "HEAVY_CORE_CLOTS";
      },
    },

    // Step 2: clot size check
    HEAVY_CORE_CLOTS: {
      say: ["Are you passing clots larger than a 50-cent coin or a quarter?"],
      choices: [
        { id: "yes", label: "Yes",      next: "HEAVY_CLOTS_YES",     primary: true },
        { id: "no",  label: "No",       next: "HEAVY_CORE_SYMP_GATE" },
        { id: "ns",  label: "Not sure", next: "HEAVY_CORE_SYMP_GATE" },
      ],
    },
    HEAVY_CLOTS_YES: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).largeClots = true;
        return "HEAVY_CORE_SYMP_GATE";
      },
    },

    // Step 3: symptom check - skipped if Route C already captured symptoms
    HEAVY_CORE_SYMP_GATE: {
      autoNext(ctx) {
        return (ctx.heavyFlags || {}).symptomatic ? "HEAVY_DECIDE" : "HEAVY_CORE_SYMPTOMS";
      },
    },
    HEAVY_CORE_SYMPTOMS: {
      say: ["Are you feeling dizzy, faint, short of breath, or very weak?"],
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_SYMP_YES", primary: true },
        { id: "no",  label: "No",  next: "HEAVY_DECIDE" },
      ],
    },
    HEAVY_SYMP_YES: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).symptomatic = true;
        return "HEAVY_DECIDE";
      },
    },

    // Decision routing - evaluates all collected flags
    HEAVY_DECIDE: {
      autoNext(ctx) {
        const f = ctx.heavyFlags || {};
        const urgent =
          f.rapidSoaking ||
          f.symptomatic ||
          (f.largeClots && f.prolongedBleeding) ||
          (f.possiblePregnancy && f.rapidSoaking);
        if (urgent) return "HEAVY_URGENT";
        const soon = f.prolongedBleeding || f.largeClots || f.heavierThanUsual;
        return soon ? "HEAVY_SOON" : "HEAVY_MONITOR";
      },
    },

    // ── Output nodes ──────────────────────────────────────────────────────────
    HEAVY_URGENT: {
      say(ctx) {
        const f = ctx.heavyFlags || {};
        const lines = [
          "What you're describing needs medical attention today - please don't wait 🩷",
        ];
        if (f.possiblePregnancy) {
          lines.push(
            "Because there's a chance of pregnancy, heavy bleeding with these symptoms can sometimes signal something that needs urgent care. Please go to your nearest emergency room or call 119."
          );
        } else {
          lines.push(
            "Please go to your nearest emergency room, urgent care centre, or call 119 in Jamaica."
          );
        }
        lines.push(
          "If you feel faint, collapse, or bleeding gets worse on the way - call for help immediately."
        );
        return lines;
      },
      choices: [
        { id: "map",  label: "Find emergency care", next: "HEAVY_AFTER_CARE", action: "OPEN_MAP", primary: true },
        { id: "way",  label: "I'm on my way",        next: "CLOSE" },
        { id: "menu", label: "Back to main menu",    next: "START_MENU" },
      ],
    },
    HEAVY_SOON: {
      say: [
        "Based on what you've shared, this isn't an emergency right now - but it does need a proper look in the next few days 🩷",
        "Bleeding that's heavier than usual or lasting longer than a week can sometimes point to things worth checking - like fibroids, hormonal shifts, or low iron.",
        "Book a visit with a healthcare provider or gynaecologist as soon as you can, ideally within the next 2-3 days.",
        "If anything changes - you start feeling faint, bleeding gets suddenly heavier, or you develop severe pain - treat that as urgent and seek care the same day.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",  next: "HEAVY_AFTER_CARE", action: "OPEN_MAP",    primary: true },
        { id: "log",  label: "Log this concern",   next: "HEAVY_AFTER_CARE", action: "LOG_SYMPTOM" },
        { id: "menu", label: "Back to main menu",  next: "START_MENU" },
      ],
    },
    HEAVY_MONITOR: {
      say: [
        "Based on what you shared, this sounds like it may be a heavier day rather than something immediately alarming 🩷",
        "Some people naturally have heavier flow - especially in the first 1-2 days of their period. That said, your experience is always worth tracking.",
        "Keep monitoring over the next 24 hours. If the flow picks up, you start feeling weak or dizzy, or you notice large clots, come back and let me know.",
      ],
      choices: [
        { id: "log",   label: "Log this concern",        next: "HEAVY_AFTER_CARE", action: "LOG_SYMPTOM", primary: true },
        { id: "learn", label: "Learn about heavy periods", next: "EDUC_HEAVY" },
        { id: "menu",  label: "Back to main menu",         next: "START_MENU" },
      ],
    },
    HEAVY_AFTER_SUMMARY: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "Want help with anything else?"],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    HEAVY_AFTER_CARE: {
      say: [
        "I'm here with you 🩷",
        "If you want, you can come back after you get care and we can track what changes.",
        "Would you like help with anything else?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- PREGNANCY TEST ---------------- */
    TEST_INTRO: {
      say: ["Okay 🩷 Let me help you figure out the right time to test. What best describes your situation?"],
      choices: [
        { id: "know_date",   label: "I know my expected period date",    next: "TEST_EXPECTED_DATE", primary: true },
        { id: "irregular",   label: "I don't know / irregular cycle",    next: "TEST_IRREGULAR_INTRO" },
        { id: "late",        label: "My period is already late",         next: "LATE_INTRO" },
        { id: "negative",    label: "I already tested negative",         next: "TEST_NEGATIVE_INTRO" },
        { id: "recent_sex",  label: "I had unprotected sex recently",    next: "TEST_RECENT_SEX_INTRO" },
        { id: "menu",        label: "Back to main options",              next: "START_MENU" },
      ],
    },
    TEST_EXPECTED_DATE: {
      say: ["Got you 🩷", "Type your expected period date like: 2026-02-08 (YYYY-MM-DD)."],
      autoNext(ctx) {
        ctx.capture = { kind: "expectedPeriodDate", next: "TEST_URGENT_CHECK" };
        return null;
      },
    },
    TEST_SEX_DATE: {
      say: [
        "No problem 🩷",
        "If you don't know when your period is due, a practical rule is: test **21 days after unprotected sex**.",
        "If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.",
        "Type the unprotected sex date like: 2026-02-03 (YYYY-MM-DD).",
      ],
      autoNext(ctx) {
        ctx.capture = { kind: "sexDate", next: "TEST_URGENT_CHECK" };
        return null;
      },
    },
    TEST_SHOW_PLAN: {
      say(ctx) {
        const plan = computeTestPlan({
          expectedPeriodDate: ctx.captureData?.expectedPeriodDate || null,
          sexDate: ctx.captureData?.sexDate || null,
          today: new Date(),
        });
        if (!plan.primary) return ["I couldn't work out a test date 🩷", "Try entering a date like 2026-02-08."];

        // If recommended date is already in the past → "test today"
        if (plan.isPrimaryInPast) {
          const retestDate = addDays(new Date(), 3);
          const lines = [
            `${ack()} That recommended test date has already passed - so you can test **today** 🩷`,
            "First morning urine gives the clearest result.",
            `If it comes back negative but your period still hasn't arrived, retest again around **${fmtDate(retestDate)}** (48-72 hours from now).`,
          ];
          if (plan.bothDatesAvailable && plan._fromPeriod && plan._fromSex) {
            lines.splice(1, 0,
              `Based on your missed period you could test from **${fmtDate(plan._fromPeriod)}**. Based on the sex date the most reliable result would be from **${fmtDate(plan._fromSex)}** - both are already past, so test today.`
            );
          }
          return lines;
        }

        // Can test early (10-21 days after sex) but results are less reliable
        if (plan.canTestEarly && plan.basis === "sex-date") {
          return [
            `${ack()} 🩷`,
            `✅ You're in the early detection window - you can test from **${fmtDate(plan.primary)}** onward.`,
            "Early detection tests can pick up pregnancy from about 10 days after sex, but the result is less reliable at this stage.",
            "Testing too early can give a false negative because pregnancy hormone levels may not be high enough yet.",
            `For the most reliable result, wait until **${fmtDate(plan._fromSex)}** (21 days after sex).`,
            `If negative, retest in 48-72 hours (around **${fmtDate(plan.retest)}**).`,
            "If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.",
          ];
        }

        const lines = [`${ack()} 🩷`];

        if (plan.bothDatesAvailable && plan._fromPeriod && plan._fromSex) {
          lines.push(
            `Based on your missed period you can test from **${fmtDate(plan._fromPeriod)}**. Based on the sex date the most reliable result would be from **${fmtDate(plan._fromSex)}**.`,
            `✅ Best time to test: **${fmtDate(plan.primary)}** - using the later of both dates for the most reliable result.`
          );
        } else {
          const primaryLine = plan.basis === "missed-period"
            ? `✅ Best time to test: **${fmtDate(plan.primary)}** - the day after your expected period.`
            : `✅ Best time to test: **${fmtDate(plan.primary)}** - 21 days after unprotected sex.`;
          lines.push(primaryLine);
        }

        lines.push(
          "Testing too early can give a false negative because pregnancy hormone levels may not be high enough yet.",
          `If the result is negative but your period still doesn't come, retest in **48-72 hours** (around **${fmtDate(plan.retest)}**).`
        );

        if (plan.basis === "sex-date" || plan.bothDatesAvailable) {
          lines.push("If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.");
        }

        return lines;
      },
      choices: [
        { id: "late",    label: "My period is late too",   next: "LATE_INTRO", primary: true },
        { id: "log",     label: "Log that I tested today", next: "TEST_SHOW_PLAN_LOGGED",
          action: "LOG_SYMPTOM", logData: { type: "pregnancy_test", note: "Test taken - result pending" } },
        { id: "menu",    label: "Main options",            next: "START_MENU" },
        { id: "done",    label: "I'm done for now",       next: "CLOSE" },
      ],
    },

    // After logging a test - detect retest timing
    TEST_SHOW_PLAN_LOGGED: {
      say() {
        const retestDate = addDays(new Date(), 3);
        return [
          "Logged 🩷",
          `If today's test was negative, the best time to retest is around **${fmtDate(retestDate)}** - 48-72 hours from now, ideally first morning urine.`,
          "A second negative at that point is more reliable.",
        ];
      },
      choices: [
        { id: "late", label: "My period is still late", next: "LATE_INTRO", primary: true },
        { id: "menu", label: "Main options",             next: "START_MENU" },
      ],
    },

    // ── Urgent symptoms checkpoint - sits before TEST_SHOW_PLAN ──────────────
    TEST_URGENT_CHECK: {
      say: [
        "One quick check before we look at your test plan 🩷",
        "Are you having any of these right now: severe one-sided pain, feeling faint or dizzy, heavy bleeding, or shoulder tip pain?",
      ],
      choices: [
        { id: "yes_urgent", label: "Yes, I have some of those", next: "HEAVY_URGENT", primary: true },
        { id: "no_urgent",  label: "No, none of those",         next: "TEST_SHOW_PLAN" },
      ],
    },

    // ── Irregular cycle entry route ───────────────────────────────────────────
    TEST_IRREGULAR_INTRO: {
      say: [
        "No problem 🩷 Irregular cycles are really common - PCOS, recently stopping birth control, postpartum, breastfeeding, and other hormonal changes can all affect when your period comes.",
        "When you don't know your expected period date, the most reliable way to time a test is to work from your unprotected sex date.",
        "If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.",
        "Type the date of your last unprotected sex like: 2026-02-08 (YYYY-MM-DD).",
      ],
      autoNext(ctx) {
        ctx.capture = { kind: "sexDate", next: "TEST_URGENT_CHECK" };
        return null;
      },
    },

    // ── Already tested negative ───────────────────────────────────────────────
    TEST_NEGATIVE_INTRO: {
      say: [
        "Okay 🩷 A negative result isn't always final - it depends on when you tested and how.",
        "Quick check first - are you having any of these right now: severe one-sided pain, feeling faint, heavy bleeding, or shoulder tip pain?",
      ],
      choices: [
        { id: "yes_urgent",  label: "Yes, I have some of those",    next: "HEAVY_URGENT", primary: true },
        { id: "no_continue", label: "No, none of those",            next: "TEST_NEGATIVE_DETAILS" },
      ],
    },

    TEST_NEGATIVE_DETAILS: {
      say: [
        "Got it 🩷 Let me help you figure out if the result is likely accurate.",
        "When did you take the test?",
      ],
      choices: [
        { id: "today",  label: "Today or yesterday",     next: "TEST_RETEST_NOW", primary: true },
        { id: "days2",  label: "1-2 days ago",           next: "TEST_RETEST_NOW" },
        { id: "week",   label: "3 or more days ago",     next: "TEST_NEGATIVE_TIMING" },
      ],
    },

    TEST_NEGATIVE_TIMING: {
      say: [
        "Was it first morning urine - the very first time you went to the bathroom that day?",
      ],
      choices: [
        { id: "yes_fmu", label: "Yes, first morning urine", next: "TEST_SHOW_PLAN", primary: true },
        { id: "no_fmu",  label: "No, it was later in the day", next: "TEST_RETEST_NOW" },
      ],
    },

    // ── Retest now - for users who tested recently or not first morning ───────
    TEST_RETEST_NOW: {
      say: [
        "A negative result tested too early - or not with first morning urine - may not be reliable 🩷",
        "First morning urine is the most concentrated, which means the pregnancy hormone is easiest to detect.",
        "**Retest now** if you haven't already today - use first morning urine tomorrow if you've already used the bathroom.",
        "If that also comes back negative but your period still hasn't come, let me know and we can look at next steps.",
        "_If you develop severe one-sided pain, feel faint, or have heavy bleeding - please seek medical care straight away._",
      ],
      choices: [
        { id: "plan",  label: "Show me when to test next", next: "TEST_SHOW_PLAN", primary: true },
        { id: "late",  label: "My period is late",         next: "LATE_INTRO" },
        { id: "menu",  label: "Main options",              next: "START_MENU" },
      ],
    },

    // ── Recent unprotected sex ────────────────────────────────────────────────
    TEST_RECENT_SEX_INTRO: {
      say: [
        "Okay 🩷 The timing of a reliable test depends on how many days have passed since sex.",
        "Type the date of the unprotected sex like: 2026-02-08 (YYYY-MM-DD).",
      ],
      autoNext(ctx) {
        ctx.capture = { kind: "sexDate", next: "TEST_RECENT_SEX_ROUTE" };
        return null;
      },
    },

    // Routing node - checks days since sex and redirects
    TEST_RECENT_SEX_ROUTE: {
      autoNext(ctx) {
        const sexDate = ctx.captureData?.sexDate ? new Date(ctx.captureData.sexDate) : null;
        if (!sexDate || Number.isNaN(sexDate.getTime())) return "TEST_INTRO";
        const daysSince = Math.floor((new Date() - sexDate) / 86400000);
        if (daysSince < 10) return "TEST_TOO_EARLY";
        return "TEST_URGENT_CHECK"; // 10+ days → urgent check → TEST_SHOW_PLAN
      },
    },

    // ── Too early to test ─────────────────────────────────────────────────────
    TEST_TOO_EARLY: {
      say(ctx) {
        const sexDate = ctx.captureData?.sexDate ? new Date(ctx.captureData.sexDate) : null;
        const earlyDate = sexDate ? fmtDate(addDays(sexDate, 10)) : "10 days after sex";
        const reliableDate = sexDate ? fmtDate(addDays(sexDate, 21)) : "21 days after sex";
        return [
          "It's a little too early for a reliable result right now 🩷",
          "Pregnancy tests work by detecting a hormone (hCG) that builds up in your body after implantation. In the first 10 days it often isn't detectable yet.",
          `The **earliest** you could try an early detection test is around **${earlyDate}** - but even then, a negative result could be a false negative.`,
          `For the most reliable result, wait until **${reliableDate}** (21 days after sex).`,
          "If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.",
          "Would you like me to remind you when it's the right time to test?",
        ];
      },
      choices: [
        { id: "remind", label: "Set a reminder",      next: "CLOSE", action: "SET_REMINDER" },
        { id: "menu",   label: "Back to main options", next: "START_MENU" },
      ],
    },

    /* ──────────────── PREGNANCY DECISION SUPPORT ──────────────── */
    /* NOTE: Abortion is illegal in Jamaica under the Offences Against  */
    /* the Person Act 1864. Bloomie does NOT provide instructions,       */
    /* medication names, or methods. It provides honest legal context,  */
    /* non-directive emotional support, safety info for those who have   */
    /* already acted, and confidential counselling signposting.          */

    ABORTION_OPTIONS: {
      say: [
        "I hear you 🩷 This is a space where you can talk, without judgment - none.",
        "Whatever has happened or is happening, you don't need to explain yourself to me. Your safety is what matters most.",
        "If you've already taken something or had any kind of procedure, watch for these warning signs and go to emergency care if any appear:",
        "🚨 Fever (38°C / 100.4°F or higher) or chills - especially lasting more than a few hours",
        "🚨 Heavy bleeding - soaking more than 2 pads per hour for 2 hours in a row",
        "🚨 Severe or worsening pain in your abdomen that isn't easing",
        "🚨 Foul-smelling discharge, or discharge that looks unusual",
        "You can get care at a hospital without having to explain why. Confidential support also exists - you don't have to go through this alone.",
        "What kind of support are you looking for right now?",
      ],
      choices: [
        { id: "decision",  label: "I'm still deciding what to do",         next: "ABORTION_DECISION_SUPPORT", primary: true },
        { id: "after",     label: "I already took something / I need help", next: "ABORTION_AFTERCARE_CHECK" },
        { id: "pregnant",  label: "I'm pregnant but not sure I want to be", next: "ABORTION_HONEST_CONTEXT" },
        { id: "privacy",   label: "Privacy first, before anything else",    next: "ABORTION_PRIVACY" },
        { id: "counsel",   label: "Find confidential support",              next: "CLOSE", action: "OPEN_MAP" },
        { id: "menu",      label: "Actually it's something else",           next: "START_MENU" },
      ],
    },

    // Honest legal context - doesn't shame, doesn't lie, doesn't advise
    ABORTION_HONEST_CONTEXT: {
      say: [
        "I want to be honest with you because you deserve honesty 🩷",
        "In Jamaica, abortion is currently illegal under the Offences Against the Person Act. There are no formal legal exceptions, not even for rape or incest.",
        "This means there is no safe, legal clinical option available in-country right now.",
        "I can't tell you what to do, and I won't pretend the situation isn't hard.",
        "What I can do is help you think through your options, your safety, and how to access non-judgmental support, confidentially.",
      ],
      choices: [
        { id: "options",   label: "Talk through my options",              next: "ABORTION_DECISION_SUPPORT", primary: true },
        { id: "safe",      label: "What do I need to know to stay safe?", next: "ABORTION_SAFETY_INFO" },
        { id: "counsel",   label: "I want someone to talk to",            next: "ABORTION_RESOURCES" },
        { id: "privacy",   label: "Privacy - how to protect myself",      next: "ABORTION_PRIVACY" },
      ],
    },

    // Non-directive decision support - presents all options without steering
    ABORTION_DECISION_SUPPORT: {
      say: [
        "You're not alone in this, and there's no right answer - only what's right for you 🩷",
        "People in this situation generally face three paths: continuing the pregnancy (with support or adoption), or ending it.",
        "Because of Jamaica's laws, ending a pregnancy carries serious legal and medical risk. There are no safe, legal clinical services in-country.",
        "Some people travel to access services in countries where it is legal. Others seek confidential counselling to help make a decision.",
        "Non-directive pregnancy counselling, where someone listens without pushing an agenda - exists and is confidential. Would you like help finding it?",
      ],
      choices: [
        { id: "counsel",  label: "Yes, find me confidential support",   next: "ABORTION_RESOURCES", primary: true },
        { id: "safe",     label: "I need to know about staying safe",     next: "ABORTION_SAFETY_INFO" },
        { id: "privacy",  label: "Help me protect my privacy first",      next: "ABORTION_PRIVACY" },
        { id: "after",    label: "I've already taken something",          next: "ABORTION_AFTERCARE_CHECK" },
        { id: "menu",     label: "Back to main options",                  next: "START_MENU" },
      ],
    },

    // Safety information - harm reduction without method instruction
    ABORTION_SAFETY_INFO: {
      say: [
        "Your safety matters most 🩷 I can share what signs to watch for, not instructions.",
        "If you or someone you know has taken something or had a procedure, these are the warning signs that mean you need emergency care immediately:",
        "🚨 Heavy bleeding soaking 2+ pads per hour for 2+ hours in a row",
        "🚨 Severe abdominal pain that doesn't ease",
        "🚨 Fever lasting more than 24 hours, or any fever with chills",
        "🚨 Foul-smelling discharge",
        "🚨 Dizziness, fainting, or feeling unable to stand",
        "If any of these happen, go to the emergency room. You can say you are having a miscarriage. Emergency departments are required to treat you regardless of how the pregnancy ended.",
        ...urgentFooter(),
      ],
      choices: [
        { id: "checkme",  label: "I have some of those symptoms",    next: "ABORTION_AFTERCARE_CHECK", primary: true },
        { id: "counsel",  label: "I need someone to talk to",        next: "ABORTION_RESOURCES" },
        { id: "privacy",  label: "How do I protect my privacy?",     next: "ABORTION_PRIVACY" },
        { id: "map",      label: "Find emergency care near me",      next: "CLOSE", action: "OPEN_MAP" },
      ],
    },

    // Aftercare safety check - for those who've already acted
    ABORTION_AFTERCARE_CHECK: {
      say: [
        `${ack()} Your safety is the priority right now 🩷`,
        "Are you having any of these right now? Select any that apply.",
      ],
      multi: {
        question: "Warning signs - select any:",
        options: [
          "Heavy bleeding (soaking 2+ pads/hour for 2+ hours)",
          "Severe belly or pelvic pain",
          "Fever or chills",
          "Foul-smelling discharge",
          "Dizziness, fainting, or very weak",
          "None of these",
        ],
        nextOnSubmit: "ABORTION_AFTERCARE_GUIDE",
        allowNone: false,
      },
    },

    ABORTION_AFTERCARE_GUIDE: {
      autoNext(_ctx, payload) {
        const sel = payload.multi || [];
        return sel.length && !sel.includes("None of these") ? "ABORTION_URGENT" : "ABORTION_MONITORING";
      },
    },

    ABORTION_URGENT: {
      say: [
        "Please get to an emergency room as soon as possible 🩷",
        "These symptoms can mean your body needs immediate medical support.",
        "When you arrive, you can say you are having a miscarriage - this is medically accurate and emergency rooms are required to treat you without asking for the cause.",
        "You do not have to explain anything beyond your symptoms.",
      ],
      choices: [
        { id: "map",  label: "Find emergency care now", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options",            next: "START_MENU" },
      ],
    },

    ABORTION_MONITORING: {
      say: [
        "Okay - none of the urgent warning signs right now 🩷",
        "Keep monitoring yourself over the next few days. Watch for: increasing pain, fever, heavy bleeding that starts or worsens, or anything that feels wrong.",
        "If any of those things start - treat it as urgent and go to emergency care.",
        "Would you like to connect with confidential support?",
        ...urgentFooter(),
      ],
      choices: [
        { id: "counsel",  label: "Yes, I want confidential support",   next: "ABORTION_RESOURCES", primary: true },
        { id: "privacy",  label: "Help me protect my privacy",         next: "ABORTION_PRIVACY" },
        { id: "menu",     label: "Main options",                       next: "START_MENU" },
      ],
    },

    // Privacy - practical screen/data protection guidance
    ABORTION_PRIVACY: {
      say: [
        "Privacy is real and valid - here's what you can do 🩷",
        "• Clear your chat: use the reset option in Bloomie settings if available, or close the browser tab",
        "• If someone shares your device: use an incognito/private browser window",
        "• When contacting organisations: use a number they don't know, or a messaging app with disappearing messages",
        "• What to say: 'I need confidential pregnancy options support. How do you handle privacy?'",
        "• Ask any service before sharing: 'Is this fully confidential?' - you have the right to ask.",
      ],
      choices: [
        { id: "counsel",  label: "Show confidential support options",  next: "ABORTION_RESOURCES", primary: true },
        { id: "safe",     label: "What should I watch for healthwise?",next: "ABORTION_SAFETY_INFO" },
        { id: "menu",     label: "Main options",                       next: "START_MENU" },
      ],
    },

    // Resources - confidential orgs operating in Jamaica
    ABORTION_RESOURCES: {
      say: [
        "Here are organisations that provide confidential, non-judgmental support 🩷",
        "• **FAMPLAN (Jamaica Family Planning Association)** - sexual & reproductive health counselling, islandwide. famplanjamaica.org",
        "• **Jamaica Pregnancy Resource Centre (Montego Bay)** - counselling and options support.",
        "• **Caribbean Family Planning Affiliation (CFPA)** - regional, provides referrals and telehealth options.",
        "• **International Planned Parenthood Federation (IPPF)** - can help with information about accessing services in other countries confidentially. ippf.org",
        "When you contact them, you don't have to share any details upfront - just say you need confidential pregnancy support.",
      ],
      choices: [
        { id: "script", label: "Help me write what to say",    next: "ABORTION_CALL_SCRIPT", primary: true },
        { id: "privacy", label: "How to protect my privacy",  next: "ABORTION_PRIVACY" },
        { id: "safe",    label: "Safety signs to watch for",  next: "ABORTION_SAFETY_INFO" },
        { id: "menu",    label: "Main options",               next: "START_MENU" },
      ],
    },

    ABORTION_CALL_SCRIPT: {
      say: [
        "Here's what you can say - keep it simple until you know they're trustworthy 🩷",
        "📞 *'Hi, I need confidential pregnancy options support. Can you tell me how your privacy policy works before I share anything?'*",
        "If they ask for details before answering that - hang up and try somewhere else.",
        "You're allowed to ask questions first. You're allowed to say no. You're in charge of this.",
      ],
      choices: [
        { id: "resources", label: "Back to support organisations", next: "ABORTION_RESOURCES", primary: true },
        { id: "menu",      label: "Main options",                  next: "START_MENU" },
        { id: "done",      label: "I'm done for now",              next: "CLOSE" },
      ],
    },

    /* ---------------- LATE OR MISSED PERIOD ---------------- */
    LATE_INTRO: {
      say() {
        return [
          pick([
            `${ack()} A late or missed period can be really stressful - especially when your body usually feels predictable 🩷`,
            "Okay - a late period. Let's look at this properly 🩷",
            "Waiting on your period is genuinely one of the more stressful things. Let's break it down 🩷",
            "That uncertainty is real - not knowing what's going on with your own body is hard 🩷",
            "Late periods happen for so many reasons. Let's figure out what might be going on for you 🩷",
          ]),
          "Cycles shift for all kinds of reasons: stress, travel, illness, weight changes, or just natural variation.",
          "Let's take it step by step.",
          "Is your period more than 7 days later than you usually expect it to be?",
        ];
      },
      question: "Period > 7 days late?",
      choices: [
        { id: "yes",     label: "Yes", next: "LATE_YES_PREG", primary: true },
        { id: "no",      label: "No", next: "LATE_NO_GUIDANCE" },
        { id: "ns",      label: "Not sure", next: "LATE_NO_GUIDANCE" },
        { id: "irreg",   label: "My cycles are always irregular so I can't tell", next: "LATE_IRREGULAR_GUIDANCE" },
      ],
    },
    LATE_NO_GUIDANCE: {
      say: [
        "Okay 🩷 A few days of variation can be completely normal - even in people who are usually very regular.",
        "Sometimes ovulation happens a little later than usual, and the period follows after.",
        "For now, it can help to:\n• Keep tracking your cycle\n• Watch for signs like cramps, spotting, or breast tenderness\n• Check back in if it continues to be later than what's normal for you",
        "Next important question: is there any chance of pregnancy this cycle?",
      ],
      question: "Chance of pregnancy this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_TEST_Q", primary: true },
        { id: "no", label: "No", next: "LATE_CHANGES_Q" },
        { id: "ns", label: "Not sure", next: "LATE_TEST_Q" },
      ],
    },
    LATE_IRREGULAR_GUIDANCE: {
      say: [
        "Totally valid - irregular cycles make it genuinely hard to know what 'late' even means 🩷",
        "Irregular cycles are common and can happen for lots of reasons: stress, hormonal imbalances, conditions like PCOS, weight changes, or just how your body works.",
        "A few things that can help: tracking even rough dates over a few months starts to reveal your personal pattern.",
        "Is there any chance of pregnancy this cycle?",
      ],
      question: "Chance of pregnancy this cycle?",
      choices: [
        { id: "yes",  label: "Yes - could be", next: "LATE_TEST_Q", primary: true },
        { id: "no",   label: "No", next: "LATE_CHANGES_Q" },
        { id: "ns",   label: "Not sure", next: "LATE_TEST_Q" },
        { id: "pcos", label: "I think I might have PCOS or a hormonal issue", next: "ELSE_INTRO" },
      ],
    },
    LATE_YES_PREG: {
      say() {
        // TTC mode - reframe as potentially good news
        if (userMode.isTTC) {
          return [
            "Thanks for letting me know 🩷",
            "Since you're in trying-to-conceive mode, a late period is definitely worth paying attention to.",
            "Is there any chance this could be a positive result?",
          ];
        }
        // Pregnancy tracking - they're already pregnant, late period doesn't apply
        if (userMode.isPregnancy) {
          return [
            "Since you're already in pregnancy tracking mode, a missed period is expected 🩷",
            "Are you noticing other symptoms you want to talk through?",
          ];
        }
        return [
          `${ack()} Pregnancy is one of the most common reasons for a late period - worth checking rather than worrying in silence 🩷`,
          "Is there any chance of pregnancy this cycle?",
        ];
      },
      question: "Chance of pregnancy this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_TEST_Q", primary: true },
        { id: "no", label: "No", next: "LATE_CHANGES_Q" },
        { id: "ns", label: "Not sure", next: "LATE_TEST_Q" },
      ],
    },
    // ── Pregnancy concern: intent-first entry layer ──────────────────────────
    PREGNANCY_ENTRY: {
      say: ["Got you 🩷 What feels closest to your situation right now?"],
      question: "Pregnancy concern type",
      choices: [
        { id: "late",    label: "My period is late",                     next: "PREG_LATE_ROUTE",    primary: true },
        { id: "when",    label: "I want to know when to take a test",    next: "TEST_INTRO" },
        { id: "tested",  label: "I already took a test",                 next: "PREG_TESTED_ROUTE" },
        { id: "ttc",     label: "I'm trying to conceive",                next: "TTC_INTRO" },
        { id: "worry",   label: "I'm worried and not sure what to do",   next: "PREG_CLARIFY_ROUTE" },
        { id: "back",    label: "Back to main options",                  next: "START_MENU" },
      ],
    },
    PREG_LATE_ROUTE: {
      say: ["How late does it feel?"],
      question: "How late is your period?",
      choices: [
        { id: "lt1w",  label: "Less than a week late",      next: "LATE_INTRO",     primary: true },
        { id: "gte1w", label: "About a week or more late",  next: "LATE_YES_PREG" },
        { id: "ns",    label: "Not sure",                   next: "LATE_INTRO" },
      ],
    },
    PREG_TESTED_ROUTE: {
      say: ["What did the test show?"],
      question: "Pregnancy test result",
      choices: [
        { id: "pos",   label: "Positive",                       next: "LATE_POSITIVE",    primary: true },
        { id: "neg",   label: "Negative",                       next: "LATE_NEG_UNCLEAR" },
        { id: "unc",   label: "Unclear or hard to read",        next: "LATE_NEG_UNCLEAR" },
        { id: "early", label: "I took it too early / not sure", next: "TEST_INTRO" },
      ],
    },
    PREG_CLARIFY_ROUTE: {
      say: [
        "That's okay - pregnancy worries can feel overwhelming even when you're not sure what you're actually worried about 🩷",
        "Are you feeling physically unwell right now, or is this more anxiety about the possibility?",
      ],
      question: "Physically unwell or anxious?",
      choices: [
        { id: "unwell",  label: "I feel physically unwell",  next: "PREG_SAFETY_CHECK",    primary: true },
        { id: "anxious", label: "Mostly anxious / not sure", next: "PREG_CLARIFY_RESELECT" },
      ],
    },
    PREG_CLARIFY_RESELECT: {
      say: [
        "That makes sense - anxiety about pregnancy is completely valid, even when nothing has 'happened' yet 🩷",
        "Take a breath. Let's figure out what would help you most right now.",
      ],
      question: "Pregnancy concern type",
      choices: [
        { id: "late",    label: "My period is late",                     next: "PREG_LATE_ROUTE",    primary: true },
        { id: "when",    label: "I want to know when to take a test",    next: "TEST_INTRO" },
        { id: "tested",  label: "I already took a test",                 next: "PREG_TESTED_ROUTE" },
        { id: "ttc",     label: "I'm trying to conceive",                next: "TTC_INTRO" },
        { id: "worry",   label: "I'm worried and not sure what to do",   next: "PREG_CLARIFY_ROUTE" },
        { id: "back",    label: "Back to main options",                  next: "START_MENU" },
      ],
    },
    PREG_SAFETY_CHECK: {
      say: ["Are you having severe pain, heavy bleeding, faintness, or one-sided pain right now?"],
      question: "Severe symptoms present?",
      choices: [
        { id: "yes", label: "Yes", next: "PREG_SAFETY_URGENT", primary: true },
        { id: "no",  label: "No",  next: "LATE_INTRO" },
      ],
    },
    PREG_SAFETY_URGENT: {
      autoNext(ctx) {
        (ctx.heavyFlags = ctx.heavyFlags || {}).possiblePregnancy = true;
        return "HEAVY_URGENT";
      },
    },
    // ────────────────────────────────────────────────────────────────────────
    LATE_TEST_Q: {
      say: ["Okay 🩷 thanks for being open.", "Have you taken a pregnancy test yet?"],
      question: "Taken a pregnancy test yet?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_TEST_RESULT", primary: true },
        { id: "no", label: "No", next: "LATE_TEST_SUGGEST" },
      ],
    },
    LATE_TEST_SUGGEST: {
      say: [
        "That's okay 🩷",
        "A late or missed period can sometimes be an early sign of pregnancy, even before other symptoms show up.",
        "If there's any chance, taking a pregnancy test can help reduce uncertainty - especially if your period doesn't arrive in the next few days.",
      ],
      choices: [
        { id: "sym",  label: "Tell me about other symptoms", next: "LATE_SYMPTOMS_Q", primary: true },
        { id: "test", label: "Help me figure out when to test", next: "TEST_INTRO" },
        { id: "menu", label: "Back to main options", next: "START_MENU" },
      ],
    },
    LATE_TEST_RESULT: {
      say: ["Thanks for sharing 🩷", "What was the result of the test?"],
      question: "Pregnancy test result",
      choices: [
        { id: "pos", label: "Positive", next: "LATE_POSITIVE", primary: true },
        { id: "neg", label: "Negative", next: "LATE_NEG_UNCLEAR" },
        { id: "unc", label: "Unclear / not sure", next: "LATE_NEG_UNCLEAR" },
      ],
    },
    LATE_POSITIVE: {
      say: [
        "Thanks for telling me 🩷",
        "A positive test along with a missed period usually means it's time to connect with a healthcare provider for guidance and next steps.",
        "If you're having pain, bleeding, dizziness, or feel unwell, please seek medical care urgently.",
        "Would you like help finding nearby clinics, gynecologists, or family planning services?",
      ],
      choices: [
        { id: "map",  label: "Find care near me",          next: "START", action: "OPEN_MAP", primary: true },
        { id: "log",  label: "Log this in my dashboard",   next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "pregnancy_positive", note: "Positive test confirmed in chat" } },
        { id: "menu", label: "Main options",               next: "START_MENU" },
        { id: "done", label: "I'm done for now",           next: "CLOSE" },
      ],
    },
    LATE_NEG_UNCLEAR: {
      say: [
        `${ack()} 🩷`,
        "Pregnancy tests can sometimes be negative or unclear early on.",
        "If your period still hasn't started, repeating the test in a few days may give a clearer answer.",
        "Have you had any major changes recently? (stress, illness, travel, intense exercise, or weight changes)",
      ],
      question: "Major changes recently?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_CHANGES_EXPLAIN", primary: true },
        { id: "no", label: "No", next: "LATE_SYMPTOMS_Q" },
      ],
    },
    LATE_CHANGES_Q: {
      say: ["Have you experienced any major changes recently?", "This can include stress, illness, travel, intense exercise, or noticeable weight changes."],
      question: "Major changes recently?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_CHANGES_EXPLAIN", primary: true },
        { id: "no", label: "No", next: "LATE_SYMPTOMS_Q" },
      ],
    },
    LATE_CHANGES_EXPLAIN: {
      say: [
        "Thanks for sharing 🩷",
        "Changes like stress, illness, or shifts in routine can affect hormone levels and delay ovulation - which can push your period later than usual.",
        "Are you noticing any of the following right now?",
      ],
      question: "Symptoms with late period",
      choices: [
        { id: "cr", label: "Cramps or pelvic discomfort", next: "LATE_PATTERN_Q", primary: true },
        { id: "sp", label: "Spotting", next: "LATE_PATTERN_Q" },
        { id: "ho", label: "Hormonal symptoms (acne, mood changes)", next: "LATE_PATTERN_Q" },
        { id: "none", label: "None of these", next: "LATE_PATTERN_Q" },
      ],
    },
    LATE_SYMPTOMS_Q: {
      say: ["Okay 🩷", "Are you noticing any of these symptoms right now?"],
      question: "Symptoms with late period",
      choices: [
        { id: "cr", label: "Cramps or pelvic discomfort", next: "LATE_PATTERN_Q", primary: true },
        { id: "sp", label: "Spotting", next: "LATE_PATTERN_Q" },
        { id: "ho", label: "Hormonal symptoms (acne, mood changes)", next: "LATE_PATTERN_Q" },
        { id: "none", label: "None of these", next: "LATE_PATTERN_Q" },
      ],
    },
    LATE_PATTERN_Q: {
      say: ["One more thing that helps give context 🩷", "Do late or missed periods happen often for you?"],
      question: "Late/missed periods often?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_WRAP", primary: true },
        { id: "no", label: "No", next: "LATE_WRAP" },
        { id: "ns", label: "Not sure", next: "LATE_WRAP" },
      ],
    },
    LATE_WRAP: {
      say: [
        "Thanks for walking through this with me 🩷",
        "Based on what you've shared, your late period could be related to recent changes, hormonal shifts, or possible pregnancy.",
        "I can't diagnose conditions, but noticing patterns over time is really important.",
        "If late or missed periods happen often - especially along with symptoms like acne, increased facial/body hair, weight changes, or ongoing mood shifts - some people choose to ask a healthcare provider about possible hormonal imbalances.",
        "That doesn't mean anything is 'wrong' - just that your hormones may need a closer look.",
        "You might consider:\n• Continuing to track your cycle\n• Noting other symptoms over time\n• Reaching out to a healthcare provider if delays keep happening",
        "You're doing the right thing by checking in and listening to your body 🩷",
        "Would you like help with anything else today?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- SPOTTING ---------------- */
    SPOT_INTRO: {
      say() {
        return [
          pick([
            `${ack()} Spotting can feel confusing - especially when it shows up out of nowhere 🩷`,
            "Unexpected spotting is unsettling - let's work out what's going on 🩷",
            "Spotting outside your period can mean a few different things. Let's narrow it down 🩷",
            "Okay, spotting. This is worth looking at properly - you were right to bring it up 🩷",
            "Random bleeding between periods is something your body is trying to tell you something with. Let's listen 🩷",
          ]),
          "A lot of the time it's harmless (hormonal shifts, ovulation, or early pregnancy), but sometimes it's your body asking for a closer look.",
          "Is the spotting happening outside your normal period days?",
        ];
      },
      question: "Spotting outside normal period days?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_YES_DURATION", primary: true },
        { id: "no", label: "No", next: "SPOT_NO_NORMAL" },
        { id: "ns", label: "Not sure", next: "SPOT_NOTSURE_TIMING" },
      ],
    },
    SPOT_NO_NORMAL: {
      say: [
        "Okay 👍🏽",
        "Light spotting at the very start or end of a period can be normal for many people - sometimes it's just your uterus finishing up.",
        "If it stays light, doesn't come with strong pain, and doesn't drag on for days and days, it's usually not a big concern.",
        "If you ever notice it getting heavier, lasting longer than usual, or coming with dizziness or severe cramps, that's a reason to check in with a provider.",
        "Want to go back to the main options, or talk about something else you noticed?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    SPOT_NOTSURE_TIMING: {
      say: [
        "That's totally okay 🩷",
        "Sometimes spotting is so light that it's hard to place in the cycle - especially if your period isn't super regular.",
        "About how many days after your last period did the spotting start?",
      ],
      question: "Timing of spotting after last period",
      choices: [
        { id: "lt7", label: "Less than 7 days", next: "SPOT_YES_DURATION", primary: true },
        { id: "mid", label: "Around the middle of my cycle", next: "SPOT_MIDCYCLE_NOTE" },
        { id: "gt14", label: "More than 2 weeks later", next: "SPOT_YES_DURATION" },
        { id: "ns", label: "Not sure", next: "SPOT_YES_DURATION" },
      ],
    },
    SPOT_MIDCYCLE_NOTE: {
      say: [
        "Got you 🩷",
        "Spotting around the middle of the cycle can happen for some people around ovulation (a small hormone dip can cause light bleeding).",
        "It's usually light and short - but we'll still check a few details to be safe.",
      ],
      autoNext: () => "SPOT_YES_DURATION",
    },
    SPOT_YES_DURATION: {
      say: [
        "Thanks for letting me know 🩷",
        "A quick way to tell how concerned we should be is **duration + symptoms**.",
        "Has the spotting lasted more than 2 days?",
      ],
      question: "Spotting lasted more than 2 days?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_SYMPTOMS_MULTI", primary: true },
        { id: "no", label: "No", next: "SPOT_AMOUNT_Q" },
        { id: "ns", label: "Not sure", next: "SPOT_AMOUNT_Q" },
      ],
    },
    SPOT_AMOUNT_Q: {
      say: ["Okay 🩷", "Would you say it's mostly just when you wipe / a few drops… or more like a light flow?"],
      question: "Spotting amount",
      choices: [
        { id: "wipe", label: "Just when I wipe / a few drops", next: "SPOT_PREG_Q", primary: true },
        { id: "light", label: "More like a light flow", next: "SPOT_SYMPTOMS_MULTI" },
        { id: "ns", label: "Not sure", next: "SPOT_PREG_Q" },
      ],
    },
    SPOT_SYMPTOMS_MULTI: {
      say: [
        "Thanks for sharing 🩷",
        "Spotting that lasts more than a couple days - or feels heavier than expected - is worth paying attention to.",
        "Let's check for anything that would make this more urgent.",
      ],
      multi: {
        question: "Are you experiencing any of the following along with the spotting? (select any)",
        options: ["Pelvic pain or cramps", "Unusual discharge or odor", "Dizziness or weakness", "Fever or chills", "Pain during sex", "None of these"],
        nextOnSubmit: "SPOT_SYMPTOMS_GUIDE",
        allowNone: false,
      },
    },
    SPOT_SYMPTOMS_GUIDE: {
      autoNext(_ctx, payload) {
        const sel = payload.multi || [];
        return sel.length && !sel.includes("None of these") ? "SPOT_PROVIDER_SOON" : "SPOT_PATTERN_CHECK";
      },
    },
    SPOT_PROVIDER_SOON: {
      say: [
        `${ack()} Spotting plus other symptoms can sometimes mean irritation, infection, hormonal changes, or something worth checking 🩷`,
        "I can't diagnose, but if symptoms continue, worsen, or you feel worried, speaking with a provider soon is the right move.",
        ...urgentFooter(),
      ],
      choices: [
        { id: "map", label: "Find care near me",    next: "START", action: "OPEN_MAP", primary: true },
        { id: "log", label: "Log spotting symptom", next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "spotting", note: "Logged from Bloomie chat" } },
        { id: "sum", label: "Help me summarize",    next: "SPOT_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: "Main options",        next: "START_MENU" },
        { id: "done", label: "I'm done for now",    next: "CLOSE" },
      ],
    },
    SPOT_PATTERN_CHECK: {
      say: ["Okay 👍🏽", "Even without other symptoms, spotting can be useful information - especially if it becomes a pattern.", "Has this type of spotting happened more than once in recent cycles?"],
      question: "Spotting more than once recently?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_TRACK_WRAP", primary: true },
        { id: "no", label: "No", next: "SPOT_TRACK_WRAP" },
        { id: "ns", label: "Not sure", next: "SPOT_TRACK_WRAP" },
      ],
    },
    SPOT_PREG_Q: {
      say: ["Okay 🩷", "Next check: pregnancy can sometimes cause light spotting, especially early on.", "Is there any chance of pregnancy this cycle?"],
      question: "Chance of pregnancy this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_PREG_INFO", primary: true },
        { id: "no", label: "No", next: "SPOT_BC_Q" },
        { id: "ns", label: "Not sure", next: "SPOT_PREG_INFO" },
      ],
    },
    SPOT_PREG_INFO: {
      say: [
        "Thanks for sharing 🩷",
        "If there's any chance of pregnancy, a test can help give clarity - especially if your period is late or your symptoms feel different than usual.",
        "Have you started, stopped, or changed birth control in the past few months?",
      ],
      question: "Birth control change recently?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_BC_YES", primary: true },
        { id: "no", label: "No", next: "SPOT_TRACK_WRAP" },
        { id: "ns", label: "Not sure", next: "SPOT_TRACK_WRAP" },
      ],
    },
    SPOT_BC_Q: {
      say: ["Birth control changes can sometimes cause spotting while your body adjusts.", "Have you started, stopped, or changed birth control in the past few months?"],
      question: "Birth control change recently?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_BC_YES", primary: true },
        { id: "no", label: "No", next: "SPOT_TRACK_WRAP" },
        { id: "ns", label: "Not sure", next: "SPOT_TRACK_WRAP" },
      ],
    },
    SPOT_BC_YES: {
      say: [
        "That makes sense 🩷",
        "Hormonal birth control changes can cause spotting while your body recalibrates - especially in the first 1-3 months.",
        "It often improves over time, but tracking it helps you know if it's settling down or getting more frequent.",
        "If spotting becomes heavy, persistent, or comes with pain or unusual discharge, it's worth checking in with a provider.",
        "Want to go back to the main options?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    SPOT_TRACK_WRAP: {
      say: [
        "Thanks for walking through that with me 🩷",
        "Based on what you've shared, this spotting may be related to normal cycle changes (like ovulation), hormone fluctuations, birth control adjustments, or other non-emergency causes.",
        "Tracking helps you catch patterns early - and it also makes it easier to explain if you ever decide to see a provider.",
        "If you want a simple tracking checklist:",
        "• Color (pink/red/brown)\n• Amount (wipe-only vs light flow)\n• Days it lasted\n• Cycle day / timing\n• Any pain, odor, dizziness, or fever",
        "If spotting becomes frequent, lasts longer, becomes heavier, or comes with pain/unusual discharge/dizziness, it may be a good idea to talk with a healthcare provider.",
        "Would you like to go back to the main options, or check another symptom?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    SPOT_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "Want to check anything else while you're here?"],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- MOOD / HORMONES ---------------- */
    // Backward-compat redirect - all existing menu buttons still reach MOOD_SAFETY_CHECK
    MOOD_INTRO: {
      autoNext: () => "MOOD_SAFETY_CHECK",
    },

    // ── Step 1: Safety check - always first ──────────────────────────────────
    MOOD_SAFETY_CHECK: {
      say: [
        "Before we go further, I want to check on you 🩷",
        "Are these feelings ever making you feel unsafe, completely unable to cope, or like you might hurt yourself?",
      ],
      question: "Safety check before mood questions",
      choices: [
        { id: "yes", label: "Yes",          next: "MOOD_SAFETY_ROUTE", primary: true },
        { id: "no",  label: "No",           next: "MOOD_ENTRY" },
        { id: "ns",  label: "I'm not sure", next: "MOOD_SAFETY_ROUTE" },
      ],
    },

    // ── Safety route - crisis support, do not continue mood assessment ───────
    MOOD_SAFETY_ROUTE: {
      say() {
        const base = ["Thank you for telling me - that takes courage 🩷"];
        if (userMode.isPostpartum) {
          return [
            ...base,
            "What you're describing can be a sign of postpartum depression or postpartum anxiety - both are common, both are treatable, and both deserve real support, not just time.",
            "In Jamaica, you can reach the crisis line at 888-NEW-LIFE (888-639-5433) any time.",
            "Please also consider speaking with your midwife, doctor, or a mental health professional as soon as you can.",
            "You don't have to figure this out alone.",
          ];
        }
        return [
          ...base,
          "What you're feeling matters, and you deserve real support right now.",
          "In Jamaica, you can reach the crisis line at 888-NEW-LIFE (888-639-5433) any time.",
          "Please also consider reaching out to someone you trust, or going to your nearest hospital if you feel you might act on those feelings.",
          "You don't have to figure this out alone.",
        ];
      },
      choices: [
        { id: "map",  label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options",       next: "START_MENU" },
      ],
    },

    // ── Step 2: Feeling-type-first entry ─────────────────────────────────────
    MOOD_ENTRY: {
      say() {
        if (userMode.isPostpartum) {
          return [
            "Postpartum mood shifts deserve to be taken seriously, not brushed off 🩷",
            "If you're experiencing crying spells that won't stop, feeling disconnected from your baby, intrusive thoughts, or trouble sleeping even when your baby sleeps - please tell me.",
            "What feels most true for you lately?",
          ];
        }
        if (userMode.isPregnancy) {
          return [
            "Mood changes in pregnancy are real - anxiety about the pregnancy, feeling overwhelmed, or sudden intense emotions are all worth talking about 🩷",
            "What feels most true for you lately?",
          ];
        }
        if (userMode.isTTC) {
          return [
            "Mood shifts are real in any cycle, and the emotional weight of TTC can make them feel even more intense 🩷",
            "What feels most true for you lately?",
          ];
        }
        return [
          "Mood shifts can feel really overwhelming, especially when you're trying to function through them 🩷",
          "What feels most true for you lately?",
        ];
      },
      question: "Mood type selection",
      choices() {
        if (userMode.isPostpartum) {
          return [
            { id: "disconnect", label: "Disconnected from my baby, or scared by my own thoughts", next: "MOOD_SAFETY_ROUTE", primary: true },
            { id: "anxiety",    label: "Anxiety or overthinking",                    next: "MOOD_ANXIETY_ROUTE" },
            { id: "low",        label: "Low mood, sadness, or crying",               next: "MOOD_LOW_ROUTE" },
            { id: "fatigue",    label: "Exhausted, can't sleep even when baby sleeps", next: "MOOD_FATIGUE_ROUTE" },
            { id: "mixed",      label: "A mix of several",                           next: "MOOD_MIXED_ROUTE" },
            { id: "ns",         label: "Not sure",                                   next: "MOOD_TIMING_HELP" },
          ];
        }
        if (userMode.isPregnancy) {
          return [
            { id: "anxiety",   label: "Anxiety or overthinking",                     next: "MOOD_ANXIETY_ROUTE", primary: true },
            { id: "overwhelm", label: "Completely unable to cope, or disconnected",  next: "MOOD_SAFETY_ROUTE" },
            { id: "low",       label: "Low mood, sadness, or crying",                next: "MOOD_LOW_ROUTE" },
            { id: "intense",   label: "Sudden intense emotions",                     next: "MOOD_MIXED_ROUTE" },
            { id: "fatigue",   label: "Exhausted, drained, or no energy",            next: "MOOD_FATIGUE_ROUTE" },
            { id: "ns",        label: "Not sure",                                    next: "MOOD_TIMING_HELP" },
          ];
        }
        return [
          { id: "anxiety",   label: "Anxiety or overthinking",          next: "MOOD_ANXIETY_ROUTE",   primary: true },
          { id: "low",       label: "Low mood, sadness, or crying",     next: "MOOD_LOW_ROUTE" },
          { id: "irritable", label: "Irritability, anger, or snapping", next: "MOOD_IRRITABLE_ROUTE" },
          { id: "fatigue",   label: "Exhausted, drained, or no energy", next: "MOOD_FATIGUE_ROUTE" },
          { id: "mixed",     label: "A mix of several",                 next: "MOOD_MIXED_ROUTE" },
          { id: "ns",        label: "Not sure",                         next: "MOOD_TIMING_HELP" },
        ];
      },
    },

    // ── Step 3a: Anxiety route ────────────────────────────────────────────────
    // autoNext sets ctx.moodRoute flag, then advances to the question node
    MOOD_ANXIETY_ROUTE: {
      autoNext(ctx) { ctx.moodRoute = "anxiety"; return "MOOD_ANXIETY_Q"; },
    },
    MOOD_ANXIETY_Q: {
      say: [
        "Anxiety can show up in so many ways - racing thoughts, dread, restlessness, chest tightness, or just a feeling you can't shake 🩷",
        "Does it feel more like overthinking and spiraling, or more like sudden panic and dread?",
      ],
      question: "Anxiety subtype",
      choices: [
        { id: "over",  label: "Overthinking and spiraling", next: "MOOD_TIMING_SPLIT", primary: true },
        { id: "panic", label: "Sudden panic or dread",      next: "MOOD_TIMING_SPLIT" },
        { id: "both",  label: "Both",                       next: "MOOD_TIMING_SPLIT" },
        { id: "ns",    label: "Not sure",                   next: "MOOD_TIMING_SPLIT" },
      ],
    },

    // ── Step 3b: Low mood route ───────────────────────────────────────────────
    MOOD_LOW_ROUTE: {
      autoNext(ctx) { ctx.moodRoute = "low"; return "MOOD_LOW_Q"; },
    },
    MOOD_LOW_Q: {
      say: [
        "Low mood can look like sadness, but also numbness, withdrawal, or just feeling flat and disconnected 🩷",
        "Which feels more like you?",
      ],
      question: "Low mood subtype",
      choices: [
        { id: "sad",  label: "Sadness or crying",                            next: "MOOD_TIMING_SPLIT", primary: true },
        { id: "numb", label: "Numbness or feeling nothing",                  next: "MOOD_TIMING_SPLIT" },
        { id: "with", label: "Withdrawn or not wanting to be around people", next: "MOOD_TIMING_SPLIT" },
        { id: "mix",  label: "A mix",                                        next: "MOOD_TIMING_SPLIT" },
      ],
    },

    // ── Step 3c: Irritability route ───────────────────────────────────────────
    MOOD_IRRITABLE_ROUTE: {
      autoNext(ctx) { ctx.moodRoute = "irritable"; return "MOOD_IRRITABLE_Q"; },
    },
    MOOD_IRRITABLE_Q: {
      say: [
        "Irritability is one of the most dismissed cycle symptoms - but it is real and it can be exhausting to manage 🩷",
        "Does it feel more like a short temper and snapping, or more like overstimulation and everything being too much?",
      ],
      question: "Irritability subtype",
      choices: [
        { id: "temper",   label: "Short temper or snapping",                next: "MOOD_TIMING_SPLIT", primary: true },
        { id: "overstim", label: "Overstimulation - everything is too much", next: "MOOD_TIMING_SPLIT" },
        { id: "both",     label: "Both",                                     next: "MOOD_TIMING_SPLIT" },
      ],
    },

    // ── Step 3d: Fatigue route ────────────────────────────────────────────────
    MOOD_FATIGUE_ROUTE: {
      autoNext(ctx) { ctx.moodRoute = "fatigue"; return "MOOD_FATIGUE_Q"; },
    },
    MOOD_FATIGUE_Q: {
      say: [
        "That kind of drained, heavy-body exhaustion is different from just being tired - and it deserves more than 'get more sleep' 🩷",
        "Does it feel more like physical exhaustion, or more like mental fog and low motivation?",
      ],
      question: "Fatigue subtype",
      choices: [
        { id: "phys",     label: "Physical heaviness and exhaustion", next: "MOOD_TIMING_SPLIT", primary: true },
        { id: "mental",   label: "Brain fog or low motivation",       next: "MOOD_TIMING_SPLIT" },
        { id: "both",     label: "Both",                              next: "MOOD_TIMING_SPLIT" },
        { id: "insomnia", label: "I can't sleep even when I try",    next: "MOOD_TIMING_SPLIT" },
      ],
    },

    // ── Step 3e: Mixed route ──────────────────────────────────────────────────
    MOOD_MIXED_ROUTE: {
      autoNext(ctx) { ctx.moodRoute = "mixed"; return "MOOD_MIXED_Q"; },
    },
    MOOD_MIXED_Q: {
      say: [
        "That makes sense 🩷 Mood shifts are often messy, not neat.",
        "Would you say this mix feels more tied to your cycle, or does it happen throughout the month?",
      ],
      question: "Mixed mood - cycle link",
      choices: [
        { id: "cycle", label: "Mostly around my cycle",  next: "MOOD_CYCLE_ROUTE",   primary: true },
        { id: "month", label: "Throughout the month",    next: "MOOD_NONCYCLE_ROUTE" },
        { id: "ns",    label: "Not sure",                next: "MOOD_SEVERITY" },
      ],
    },

    // ── Step 4: Timing split - after feeling type is established ─────────────
    MOOD_TIMING_SPLIT: {
      say: [
        "Does this tend to show up around a specific time in your cycle, or does it feel more random?",
      ],
      question: "Cycle timing of mood",
      choices: [
        { id: "before", label: "Before my period",         next: "MOOD_CYCLE_ROUTE",   primary: true },
        { id: "during", label: "During my period",         next: "MOOD_CYCLE_ROUTE" },
        { id: "most",   label: "Most of the month",        next: "MOOD_NONCYCLE_ROUTE" },
        { id: "random", label: "Random, no clear pattern", next: "MOOD_NONCYCLE_ROUTE" },
        { id: "ns",     label: "Not sure",                 next: "MOOD_SEVERITY" },
      ],
    },

    MOOD_CYCLE_ROUTE: {
      say: [
        "Cycle-linked mood shifts are real and hormonal - you're not imagining it 🩷",
        "Progesterone rises then drops sharply in the luteal phase, and that drop can affect serotonin, energy, and emotional regulation.",
      ],
      autoNext(ctx) { ctx.moodCycleLinked = true; return "MOOD_SEVERITY"; },
    },

    MOOD_NONCYCLE_ROUTE: {
      say: [
        "Mood shifts that happen most of the month or without a clear cycle pattern are worth taking seriously 🩷",
        "They can still be hormonal, but they may also point to something worth discussing with a mental health professional or GP.",
        "That's not a scary thing - it's just a different kind of support.",
      ],
      autoNext(ctx) { ctx.moodCycleLinked = false; return "MOOD_SEVERITY"; },
    },

    // ── Timing help fallback (for "Not sure" path from MOOD_ENTRY) ───────────
    MOOD_TIMING_HELP: {
      say: [
        "That's okay 🩷 Sometimes it's hard to connect the dots until you track it for a bit.",
        "If it helps: many people notice mood shifts 3-7 days before bleeding starts, or right at the start of day 1-2.",
        "Would you say it's closer to before, during, or random/anytime?",
      ],
      question: "Mood timing guess",
      choices: [
        { id: "before", label: "Mostly before my period",           next: "MOOD_SEVERITY", primary: true },
        { id: "during", label: "Mostly during my period",           next: "MOOD_SEVERITY" },
        { id: "random", label: "It feels random / not cycle-linked", next: "MOOD_SEVERITY" },
      ],
    },

    // ── Step 5: Shared severity and impact ────────────────────────────────────
    MOOD_SEVERITY: {
      say: [
        "How intense does it feel most of the time?",
        "Pick the option that fits your real life, not what you think you should be able to handle.",
      ],
      question: "Mood change severity",
      choices: [
        { id: "mild", label: "Mild (noticeable but manageable)",    next: "MOOD_IMPACT", primary: true },
        { id: "mod",  label: "Moderate (affects my day sometimes)", next: "MOOD_IMPACT" },
        { id: "sev",  label: "Severe (hard to function normally)",  next: "MOOD_IMPACT" },
        { id: "var",  label: "It shifts a lot, hard to pin down",   next: "MOOD_IMPACT" },
      ],
    },
    MOOD_IMPACT: {
      say() {
        return [
          pick([
            "Got it 🩷",
            "That makes sense 🩷",
            "Okay, one more thing 🩷",
            "Thank you for sharing that 🩷",
          ]),
          "When it hits, is it interfering with your daily life (school, work, relationships, appetite, sleep, motivation, or basic self-care)?",
        ];
      },
      question: "Mood interfering with daily life?",
      choices: [
        { id: "yes", label: "Yes", next: "MOOD_SYMPTOMS_MULTI", primary: true },
        { id: "no",  label: "No",  next: "MOOD_SYMPTOMS_MULTI" },
      ],
    },
    MOOD_SYMPTOMS_MULTI: {
      say: ["Sometimes naming the type of mood shift makes it easier to spot patterns, and easier to explain if you ever talk to a provider."],
      multi: {
        question: "Which ones feel most like you lately? (select any)",
        options: ["Irritability / short temper", "Anxiety / overthinking", "Low mood / sadness", "Feeling overwhelmed or teary", "Fatigue / low energy", "Trouble sleeping", "Cravings or appetite changes", "None of these"],
        nextOnSubmit: "MOOD_DURATION",
        allowNone: false,
      },
    },
    MOOD_DURATION: {
      say: [
        "Last thing: how long does it usually last when it starts?",
        "This helps separate a short PMS window from something more persistent.",
      ],
      question: "Mood duration pattern",
      choices: [
        { id: "few",  label: "A few days or less", next: "MOOD_GUIDE", primary: true },
        { id: "week", label: "About a week",        next: "MOOD_GUIDE" },
        { id: "most", label: "Most of the cycle",   next: "MOOD_GUIDE" },
        { id: "ns",   label: "Not sure",            next: "MOOD_GUIDE" },
      ],
    },

    // ── Step 6: Route-aware final guide ──────────────────────────────────────
    MOOD_GUIDE: {
      say() {
        const phaseInfo = getCurrentPhase();
        const insight = insightFor(phaseInfo?.phase, "mood");
        const nudge = !insight ? phaseNudge() : null;
        const contextLine = insight
          ? `Based on what you've shared, hormone-linked mood shifts may be playing a role - and you're not imagining it. ${insight}`
          : "Based on what you've shared, hormone-linked mood shifts may be playing a role - and you're not imagining it.";

        const moodRoute   = ctx.moodRoute;
        const cycleLinked = ctx.moodCycleLinked;

        let routeGuidance;
        if (moodRoute === "anxiety") {
          routeGuidance = "For anxiety - especially the cycle-linked kind - consistent sleep timing, reducing stimulation in the days before your period, and noticing your triggers before they spiral all help. If panic attacks are happening, that's worth bringing to a provider.";
        } else if (moodRoute === "low") {
          routeGuidance = "For low mood, gentle anchors help more than big efforts - a bit of sunlight, movement, and routine on the hard days. If the low mood lifts once your period starts, that's a strong hormonal signal. If it stays most of the month, please consider talking to someone.";
        } else if (moodRoute === "irritable") {
          routeGuidance = "Irritability often spikes with lack of sleep, skipped meals, and overstimulation, especially in the luteal phase. Protecting your sleep and eating consistently can make a real difference. Tracking when it peaks in your cycle gives you power over it.";
        } else if (moodRoute === "fatigue") {
          routeGuidance = "Cycle-linked fatigue is physical, not a character flaw. In the luteal phase, progesterone has a sedating effect and your body temperature rises slightly - that combination is genuinely draining. Iron levels are also worth checking if fatigue is severe, especially if your periods are heavy.";
        } else if (cycleLinked === false) {
          routeGuidance = "When mood shifts don't follow a clear cycle pattern, it often means the body needs a different kind of support - whether that's a mental health conversation, thyroid check, or just consistent lifestyle anchors. You deserve more than just tracking and waiting.";
        } else {
          routeGuidance = "Mood shifts around your cycle are real. They can affect your emotions, energy, focus, patience, and even how social you feel. You're not being dramatic or too sensitive. Hormones really can change how your body and brain respond to stress.";
        }

        return [
          pick([
            "Thank you for being open with me 🩷",
            "I appreciate you sharing all of that 🩷",
            "That took honesty. Thank you for trusting me with it 🩷",
            "Everything you shared makes sense. Let me give you what I can 🩷",
          ]),
          contextLine,
          ...(nudge ? [nudge] : []),
          routeGuidance,
          "",
          "If these feelings feel severe, last most of the month, or are affecting your relationships or work consistently, speaking with a healthcare provider or mental health professional is a real option - not because you can't handle it, but because you deserve support.",
          ...safeFooter(),
        ];
      },
      choices: [
        { id: "triggers", label: "Help me understand my triggers",  next: "MOOD_TRIGGERS", primary: true },
        { id: "cope",     label: "What can I do on the hard days?", next: "MOOD_COPING" },
        { id: "track",    label: "How do I track this?",            next: "MOOD_TRACKING" },
        { id: "help",     label: "When should I get help?",         next: "MOOD_WHEN_HELP" },
        { id: "menu",     label: "Back to main menu",               next: "START_MENU" },
        { id: "log",      label: "Log mood symptom",                next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "mood", note: "Mood changes logged from Bloomie chat" } },
      ],
    },

    // ── Step 8: Follow-up nodes ───────────────────────────────────────────────
    MOOD_TRIGGERS: {
      say: [
        "Some of the most common cycle-linked mood triggers: sleep disruption in the luteal phase, skipping meals or eating too late, overstimulation (noise, social pressure, screen time), and unresolved social stress that gets louder when your defenses are lower.",
        "Tracking these alongside your cycle day makes the pattern visible - and once you see it, you can plan around it.",
        "Would you like to log how you're feeling today?",
      ],
      choices: [
        { id: "log",  label: "Log mood symptom", next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "mood", note: "Mood trigger awareness logged" } },
        { id: "more", label: "More options",      next: "MOOD_GUIDE" },
        { id: "menu", label: "Main menu",         next: "START_MENU" },
      ],
    },

    MOOD_COPING: {
      say: [
        "On the hard days, lowering the bar is not giving up - it's strategy. One small anchor (a walk, a meal, a shower) is enough.",
        "Rest without guilt counts. Your body is doing something real during these phases and it needs more from you, not less.",
        "You don't have to feel better to take the next small step. You just have to take it.",
      ],
      choices: [
        { id: "more", label: "More options", next: "MOOD_GUIDE" },
        { id: "menu", label: "Back to menu", next: "START_MENU" },
      ],
    },

    MOOD_TRACKING: {
      say: [
        "What to log each day: your mood on a 1-10 scale, your cycle day if you know it, how you slept, and anything notable (big stressor, skipped meal, social event).",
        "Patterns become visible after 2-3 cycles. That's when you start to see the shape of your own experience, and it becomes easier to prepare for the rough days rather than be surprised by them.",
      ],
      choices: [
        { id: "log",  label: "Log mood now", next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "mood", note: "Tracking habit started" } },
        { id: "menu", label: "Main menu",    next: "START_MENU" },
      ],
    },

    MOOD_WHEN_HELP: {
      say: [
        "Consider reaching out to a healthcare provider or mental health professional if: it's affecting your work or relationships consistently, it's happening most of the month rather than just around your cycle, you're having thoughts of self-harm, or it feels completely unmanageable.",
        "These are not signs of weakness - they're signals that your body needs a different level of support than tracking and self-care can provide.",
        "You deserve real help, not just coping strategies.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main menu",          next: "START_MENU" },
      ],
    },

    /* ---------------- PELVIC PAIN / CRAMPS ---------------- */

    // Redirect kept so all existing menu buttons still reach the safety check
    PELVIC_INTRO: {
      autoNext() { return "PELVIC_SAFETY_CHECK"; },
    },

    // ── Step 1: Safety check - always first ──────────────────────────────────
    PELVIC_SAFETY_CHECK: {
      say: [
        "Before we go further, I want to check something important 🩷",
        "Are you having severe or sudden pelvic pain, dizziness, fainting, fever, or a strong feeling that something is seriously wrong?",
      ],
      question: "Urgent symptoms present?",
      choices: [
        { id: "yes", label: "Yes",      next: "PELVIC_URGENT",       primary: true },
        { id: "no",  label: "No",       next: "PELVIC_ENTRY" },
        { id: "ns",  label: "Not sure", next: "PELVIC_NOT_SURE_SAFETY" },
      ],
    },
    PELVIC_NOT_SURE_SAFETY: {
      say: ["Trust that instinct 🩷 If something feels seriously wrong, getting checked is always the safer call."],
      choices: [
        { id: "map",  label: "Find care near me",       next: "START", action: "OPEN_MAP", primary: true },
        { id: "cont", label: "Continue with Bloomie",   next: "PELVIC_ENTRY" },
      ],
    },
    PELVIC_URGENT: {
      say: [
        "Please seek medical care as soon as possible 🩷",
        "Severe or sudden pelvic pain, especially with dizziness or fever, can sometimes need urgent attention. You deserve a proper assessment, not just reassurance.",
        "Please go to your nearest emergency room or urgent care centre, or call 119 in Jamaica.",
        "If you have one-sided sharp pain and there's any chance of pregnancy, that needs to be checked urgently.",
      ],
      choices: [
        { id: "map",  label: "Find emergency care", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options",         next: "START_MENU" },
      ],
    },

    // ── Step 2: Route-first entry ─────────────────────────────────────────────
    PELVIC_ENTRY: {
      say: [
        "Pelvic pain can feel really different depending on what's behind it 🩷",
        "Let's figure out what kind you're dealing with.",
      ],
      question: "Type of pelvic pain",
      choices: [
        { id: "period", label: "Mostly during my period",        next: "PELVIC_PERIOD_ROUTE",    primary: true },
        { id: "ovul",   label: "Around mid-cycle or ovulation",  next: "PELVIC_OVULATION_ROUTE" },
        { id: "random", label: "Random or anytime",              next: "PELVIC_RANDOM_ROUTE" },
        { id: "sex",    label: "During or after sex",            next: "PELVIC_SEX_ENTRY" },
        { id: "ns",     label: "Not sure",                       next: "PELVIC_GENERAL_ROUTE" },
      ],
    },

    // ── Step 3: Route-specific entry nodes ───────────────────────────────────
    PELVIC_PERIOD_ROUTE: {
      say: [
        "Period pain is one of the most common cycle experiences, but intensity and pattern matter a lot 🩷",
        "Mild cramping that eases with heat or painkillers is common. Pain that stops you from functioning or gets worse each cycle is worth taking more seriously.",
        "Let's look at how it actually affects you.",
      ],
      autoNext(ctx) {
        ctx.pelvicRoute = "period";
        return "PELVIC_SEVERITY";
      },
    },
    PELVIC_OVULATION_ROUTE: {
      say: [
        "Mid-cycle pain around ovulation is actually quite common - it's sometimes called mittelschmerz 🩷",
        "It's usually one-sided, short-lived, and mild. But we'll check your pattern to make sure.",
      ],
      autoNext(ctx) {
        ctx.pelvicRoute = "ovulation";
        return "PELVIC_SEVERITY";
      },
    },
    PELVIC_RANDOM_ROUTE: {
      say: [
        "Pain that shows up randomly or outside your period is worth paying attention to 🩷",
        "It doesn't always mean something serious, but the pattern and any other symptoms that come with it matter more here.",
      ],
      autoNext(ctx) {
        ctx.pelvicRoute = "random";
        return "PELVIC_SEVERITY";
      },
    },
    PELVIC_GENERAL_ROUTE: {
      say: [
        "That's okay - pelvic pain can be hard to place 🩷",
        "Let's check a few things.",
      ],
      autoNext(ctx) {
        ctx.pelvicRoute = "general";
        return "PELVIC_SEVERITY";
      },
    },

    // ── Sex-specific entry tree ───────────────────────────────────────────────
    PELVIC_SEX_ENTRY: {
      say: [
        "Pain during or after sex is more common than people talk about, and it's not something you should have to just push through 🩷",
        "It can have really different causes depending on where and when the pain happens.",
        "Where does it hurt most?",
      ],
      question: "Location of pain with sex",
      choices: [
        { id: "entry",  label: "At the entrance / tightness",  next: "PELVIC_SEX_ENTRY_PAIN", primary: true },
        { id: "deep",   label: "Deep inside during sex",        next: "PELVIC_SEX_DEEP_PAIN" },
        { id: "after",  label: "After sex, not during",         next: "PELVIC_SEX_AFTER_PAIN" },
        { id: "both",   label: "Both entry and deep",           next: "PELVIC_SEX_DEEP_PAIN" },
        { id: "ns",     label: "Not sure",                      next: "PELVIC_SEX_INTRO" },
      ],
    },
    PELVIC_SEX_ENTRY_PAIN: {
      say: [
        "Entry pain or tightness during sex can have a few causes - dryness, tension, vaginismus, or sometimes an infection 🩷",
        "It's very treatable once the cause is identified.",
        "Have you noticed any dryness, unusual discharge, or does it happen every time?",
      ],
      question: "Entry pain details",
      choices: [
        { id: "drydis", label: "Yes to dryness or discharge",  next: "ELSE_DISCHARGE_ENTRY", primary: true },
        { id: "every",  label: "Happens every time",           next: "PELVIC_PERSISTENT" },
        { id: "some",   label: "Sometimes, not always",        next: "PELVIC_REVIEW_SOON" },
      ],
    },
    PELVIC_SEX_DEEP_PAIN: {
      say: [
        "Deep pain during sex is something worth taking seriously 🩷",
        "It can be connected to conditions like endometriosis, fibroids, ovarian cysts, or pelvic inflammatory disease - all diagnosable and manageable.",
        "You deserve a proper assessment for this, not just painkillers.",
      ],
      autoNext(ctx) {
        ctx.pelvicRoute = "sex_deep";
        return "PELVIC_PERSISTENT";
      },
    },
    PELVIC_SEX_AFTER_PAIN: {
      say: [
        "Pain after sex rather than during can sometimes point to cervical sensitivity, infection, or cycle-related inflammation 🩷",
        "Does it ease within an hour, or does it linger for hours afterwards?",
      ],
      question: "Duration of pain after sex",
      choices: [
        { id: "quick",  label: "Eases quickly",       next: "PELVIC_REVIEW_SOON", primary: true },
        { id: "linger", label: "Lingers for hours",   next: "PELVIC_PERSISTENT" },
      ],
    },

    // ── Core assessment shared by all routes ──────────────────────────────────
    PELVIC_SEVERITY: {
      say() {
        return [
          `${ack()} How intense does the pain usually feel?`,
          "Go with what actually matches your experience - not what you think you should tolerate.",
        ];
      },
      question: "Pelvic pain severity",
      choices: [
        { id: "mild", label: "Mild (uncomfortable but manageable)", next: "PELVIC_IMPACT", primary: true },
        { id: "mod",  label: "Moderate (affects my day sometimes)",  next: "PELVIC_IMPACT" },
        { id: "sev",  label: "Severe (hard to function)",            next: "PELVIC_IMPACT" },
      ],
    },
    PELVIC_IMPACT: {
      say: ["Thanks for being honest 🩷", "Is this pelvic pain interfering with your daily life - like school/work, sleep, movement, or relationships?"],
      question: "Pelvic pain interfering with life?",
      choices: [
        { id: "yes", label: "Yes", next: "PELVIC_PATTERN", primary: true },
        { id: "no",  label: "No",  next: "PELVIC_PATTERN" },
      ],
    },

    // ── Step 4: Pattern check ─────────────────────────────────────────────────
    PELVIC_PATTERN: {
      say: [
        "One more thing that helps 🩷",
        "Is this pain something you deal with often, or is it new or different this time?",
      ],
      question: "Pain pattern",
      choices: [
        { id: "often", label: "Happens often / been going on a while", next: "PELVIC_PERSISTENT",  primary: true },
        { id: "new",   label: "This feels new or different",           next: "PELVIC_REVIEW_SOON" },
        { id: "ns",    label: "Hard to say",                           next: "PELVIC_REVIEW_SOON" },
      ],
    },

    // Kept for backward compatibility (reached via PELVIC_RESPONSE if still linked)
    PELVIC_RESPONSE: {
      say: ["One more important check 🩷", "Does the pain usually improve with rest, heat, or over-the-counter pain relief?"],
      question: "Pain improves with relief?",
      choices: [
        { id: "yes",       label: "Yes",                      next: "PELVIC_MANAGEABLE" },
        { id: "no",        label: "No",                       next: "PELVIC_PERSISTENT", primary: true },
        { id: "sometimes", label: "Only a little / sometimes", next: "PELVIC_PERSISTENT" },
      ],
    },
    PELVIC_MANAGEABLE: {
      say: [
        "That's helpful to know 🩷",
        "Pain that responds to heat or rest is often manageable with tracking and support.",
        "Still, if it becomes stronger, lasts longer, or starts interfering with your life, that's a reason to re-check.",
        "Would you like to go back to the main options or talk about another symptom?",
      ],
      choices: [
        { id: "menu", label: "Main options",    next: "START_MENU", primary: true },
        { id: "else", label: "Something else",  next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    // ── Step 5: Route-specific final outcomes ─────────────────────────────────
    PELVIC_PERSISTENT: {
      say(ctx) {
        const r = ctx?.pelvicRoute;
        const routeNote = (() => {
          if (r === "period") {
            return "If your period pain is this intense regularly, it may be worth asking a provider about conditions like endometriosis - not to alarm you, but because that level of pain is not something you should have to manage alone, and there are real treatment options.";
          }
          if (r === "ovulation") {
            return "Mid-cycle pain that's this persistent or intense is worth mentioning to a provider. It may still be ovulation-related, but ruling out other causes is the right move.";
          }
          if (r === "random") {
            return "Pain that shows up without a clear pattern is worth monitoring. If it keeps happening or changes in intensity, a provider can help figure out what's behind it.";
          }
          if (r === "sex_deep" || r === "sex_entry" || r === "sex_after") {
            return "Pain during sex is very treatable - the first step is identifying the cause, which a gynaecologist or sexual health provider can do properly. You don't have to live with this.";
          }
          return "Some people with ongoing pelvic pain later learn it's related to underlying causes (such as endometriosis), which only a healthcare provider can properly evaluate.";
        })();
        return [
          "Thanks for sharing that 🩷",
          "Pelvic pain that is persistent, severe, or doesn't respond well to relief deserves attention. Not because something is 'wrong', but because pain shouldn't be dismissed.",
          routeNote,
          "I can't diagnose anything - but noticing these patterns is an important step toward getting the right support.",
          ...safeFooter(),
        ];
      },
      choices: [
        { id: "map",  label: "Find care near me",  next: "START", action: "OPEN_MAP", primary: true },
        { id: "log",  label: "Log pelvic pain",    next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "pelvic_pain", note: "Pelvic pain logged from Bloomie chat" } },
        { id: "sum",  label: "Help me summarize",  next: "PELVIC_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: "Main options",        next: "START_MENU" },
      ],
    },
    PELVIC_REVIEW_SOON: {
      say(ctx) {
        const r = ctx?.pelvicRoute;
        const note = (() => {
          if (r === "ovulation") {
            return "If it stays mild and short-lived, this is likely just ovulation. If it becomes more frequent or intense, that's worth tracking and mentioning to a provider.";
          }
          if (r === "sex_after") {
            return "Pain after sex is worth monitoring. If it keeps happening or changes, a gynaecologist or sexual health provider can figure out what's behind it.";
          }
          if (r === "random") {
            return "Pain that shows up without a clear pattern is worth monitoring. If it keeps happening or changes in intensity, a provider can help figure out what's behind it.";
          }
          return "This kind of pain is worth monitoring. If it keeps happening or changes, a provider can help clarify what's going on.";
        })();
        return [
          `${ack()} 🩷`,
          note,
          "It may be worth checking in with a healthcare provider in the next few weeks - not urgently, but soon.",
          ...safeFooter(),
        ];
      },
      choices: [
        { id: "map",  label: "Find care near me",  next: "START", action: "OPEN_MAP", primary: true },
        { id: "log",  label: "Log pelvic pain",    next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "pelvic_pain", note: "Pelvic pain logged from Bloomie chat" } },
        { id: "menu", label: "Main options",        next: "START_MENU" },
      ],
    },

    // ── Existing sex-specific path (kept - reached via PELVIC_SEX_ENTRY "not sure") ──
    PELVIC_SEX_INTRO: {
      say: [
        "Thanks for trusting me with this 🩷",
        "Pain during or after sex is more common than people talk about, and it's not something you should have to just push through.",
        "Does the pain feel like tightness, burning, sharp pain, or deep pressure?",
      ],
      question: "Pain type with sex",
      choices: [
        { id: "tight", label: "Tightness / pain at entry", next: "PELVIC_SEX_EXPLAIN", primary: true },
        { id: "deep",  label: "Deep pain inside",           next: "PELVIC_PERSISTENT" },
        { id: "both",  label: "Both",                       next: "PELVIC_SEX_EXPLAIN" },
      ],
    },
    PELVIC_SEX_EXPLAIN: {
      say: [
        "Thanks for explaining 🩷",
        "For some people, the pelvic muscles tighten automatically, often without conscious control, which can make penetration painful.",
        "This can be influenced by stress, anxiety, past pain, or muscle guarding, and it doesn't mean anything is wrong with you.",
        "It's also something a healthcare provider or pelvic floor specialist can help with.",
        ...safeFooter(),
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "sum",  label: "Help me summarize", next: "PELVIC_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: "Main options",       next: "START_MENU" },
      ],
    },
    PELVIC_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "You're doing the right thing by paying attention to your body.", "Would you like help with anything else?"],
      choices: [
        { id: "menu", label: "Main options",    next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- SOMETHING ELSE ---------------- */
    ELSE_INTRO: {
      say: [
        "That's okay 🩷 Not every concern fits neatly into one label.",
        "Pick the option that feels closest and we'll go from there.",
      ],
      choices: [
        { id: "pain",  label: "Pain or cramps",                        next: "ELSE_PAIN_ENTRY",    primary: true },
        { id: "dis",   label: "Unusual discharge or odour",             next: "ELSE_DISCHARGE_ENTRY" },
        { id: "cycle", label: "Cycle timing feels off",                 next: "LATE_INTRO" },
        { id: "preg",  label: "Pregnancy or fertility concern",         next: "PREGNANCY_ENTRY" },
        { id: "mood",  label: "Mood, anxiety, or low energy",           next: "MOOD_INTRO" },
        { id: "body",  label: "Skin, hair, weight, or sleep changes",   next: "ELSE_BODY_ENTRY" },
        { id: "ns",    label: "I'm not sure",                           next: "ELSE_NOT_SURE_ROUTE" },
      ],
    },

    ELSE_PAIN_ENTRY: {
      say: [
        "Got you 🩷",
        "Is this mostly pelvic or cramp-like pain connected to your cycle, or something more general or hard to place?",
      ],
      choices: [
        { id: "pelvic",   label: "Pelvic / cramps / feels cycle-related", next: "PELVIC_INTRO",     primary: true },
        { id: "sex",      label: "Pain during sex",                        next: "PELVIC_SEX_INTRO" },
        { id: "general",  label: "General or hard to place",               next: "ELSE_PAIN_SCALE" },
        { id: "ns",       label: "Not sure",                               next: "ELSE_PAIN_SCALE" },
      ],
    },

    ELSE_BODY_CHANGES: {
      say: [
        "Thanks for sharing that 🩷 A lot of people notice body changes, like skin, hair, weight, or sleep, that feel connected to their cycle but aren't sure if they are.",
        "Which feels most relevant right now?",
      ],
      choices: [
        { id: "skin",  label: "Acne or skin changes",             next: "ELSE_NOT_SURE", primary: true },
        { id: "hair",  label: "Hair thinning or shedding",        next: "ELSE_NOT_SURE" },
        { id: "sleep", label: "Sleep problems",                   next: "MOOD_INTRO" },
        { id: "wt",    label: "Weight changes",                   next: "ELSE_NOT_SURE" },
        { id: "hfsh",  label: "Hot flashes or night sweats",      next: "PERIMENOPAUSE_INTRO" },
        { id: "back",  label: "Back to main options",             next: "ELSE_INTRO" },
      ],
    },
    ELSE_NOT_SURE: {
      say: [
        "That's completely okay - sometimes it's hard to name it 🩷",
        "Let me ask a couple of quick things.",
        "Is there anything that feels different from your normal cycle? For example: your timing, your flow, your pain level, or your mood?",
      ],
      choices: [
        { id: "timing", label: "Timing feels off", next: "LATE_INTRO", primary: true },
        { id: "flow",   label: "Flow feels different", next: "HEAVY_INTRO" },
        { id: "pain",   label: "More pain than usual", next: "PELVIC_INTRO" },
        { id: "mood",   label: "Mood or energy changes", next: "MOOD_INTRO" },
        { id: "spot",   label: "Spotting or unusual bleeding", next: "SPOT_INTRO" },
        { id: "menu",   label: "Back to main options", next: "START_MENU" },
      ],
    },
    ELSE_PAIN_SCALE: {
      say: ["On a scale from 0-10, how strong is the pain?"],
      question: "Pain level (0-10 group)",
      choices: [
        { id: "m1", label: "0-3 (mild)", next: "ELSE_PAIN_MILD", primary: true },
        { id: "m2", label: "4-6 (moderate)", next: "ELSE_PAIN_MILD" },
        { id: "m3", label: "7-10 (severe)", next: "ELSE_PAIN_SEVERE" },
      ],
    },
    ELSE_PAIN_MILD: {
      say: [
        "Okay, thanks for telling me 🩷",
        "Mild to moderate cramps can happen around your period (and even around ovulation) - but you still deserve support, not just a shrug.",
        "Quick check: is the pain improving with rest, heat (warm bottle/shower), or pain relief?",
      ],
      question: "Pain improving with rest/heat/relief?",
      choices: [
        { id: "yes", label: "Yes", next: "ELSE_PAIN_IMPROVING_YES", primary: true },
        { id: "no", label: "No", next: "ELSE_PAIN_IMPROVING_NO" },
        { id: "sometimes", label: "A little / sometimes", next: "ELSE_PAIN_IMPROVING_SOMETIMES" },
      ],
    },
    ELSE_PAIN_IMPROVING_YES: {
      say: [
        "That's a good sign 🩷",
        "When cramps respond to heat/rest/relief, it often matches the more 'typical' kind of period pain.",
        "If you want a few gentle supports for today:",
        "• Heat pad / warm shower\n• Sip water (or ginger tea)\n• Light movement if it feels okay\n• Track what day it happens + how strong it is",
        "One more question: does this kind of cramping feel pretty normal for you, or is it new/different?",
      ],
      question: "Cramps normal for you or new?",
      choices: [
        { id: "normal", label: "It's normal for me", next: "ELSE_PAIN_NORMAL_WRAP", primary: true },
        { id: "new", label: "It feels new/different", next: "ELSE_PAIN_NEW_WRAP" },
        { id: "ns", label: "Not sure", next: "ELSE_PAIN_NEW_WRAP" },
      ],
    },
    ELSE_PAIN_IMPROVING_SOMETIMES: {
      say: [
        "Got you 🩷",
        "If it only improves sometimes, it can help to notice what makes it worse or better.",
        "A few quick pattern checks:",
        "• Is it worst on day 1-2?\n• Does it spike with stress or poor sleep?\n• Is it sharper on one side?",
        "Would you say the pain is getting worse compared to your last few cycles?",
      ],
      question: "Pain getting worse over time?",
      choices: [
        { id: "yes", label: "Yes, it's getting worse", next: "ELSE_PAIN_WORSENING", primary: true },
        { id: "no", label: "No, it's about the same", next: "ELSE_PAIN_SAME_WRAP" },
        { id: "ns", label: "Not sure", next: "ELSE_PAIN_SAME_WRAP" },
      ],
    },
    ELSE_PAIN_IMPROVING_NO: {
      say: [
        "Thanks for being honest 🩷",
        "If cramps aren't improving with rest/heat/relief - or they're stopping you from doing normal things - that's worth paying attention to.",
        "I can't diagnose, but I can help you sort what's 'monitor' vs 'get checked'.",
        "Are you also having any of these right now?",
      ],
      multi: {
        question: "Select anything that applies:",
        options: ["Pain is getting worse fast", "One-sided sharp pain", "Fever or chills", "Nausea/vomiting", "Very heavy bleeding", "Pain during sex", "None of these"],
        nextOnSubmit: "ELSE_PAIN_RED_FLAGS_GUIDE",
        allowNone: false,
      },
    },
    ELSE_PAIN_RED_FLAGS_GUIDE: {
      autoNext(_ctx, payload) {
        const sel = payload.multi || [];
        return sel.length && !sel.includes("None of these") ? "ELSE_PAIN_PROVIDER_SOON" : "ELSE_PAIN_MONITOR_WRAP";
      },
    },
    ELSE_PAIN_NORMAL_WRAP: {
      say: [
        "Okay 🩷 If it's normal for you and it responds to comfort measures, that usually points to 'manage + track'.",
        "Still, if it suddenly becomes much worse, lasts longer than usual, or comes with heavy bleeding or dizziness, that's a sign to get checked.",
        "Do you want to go back to the main options, or talk through something else you noticed?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_PAIN_NEW_WRAP: {
      say: [
        "Thanks - 'new or different' is an important detail 🩷",
        "Sometimes cramps shift with stress, sleep, diet changes, a delayed cycle, or hormonal changes.",
        "But if this repeats or keeps escalating, it's worth mentioning to a healthcare provider.",
        "If you want, I can help you summarize what changed so it's easy to explain.",
      ],
      choices: [
        { id: "sum", label: "Help me summarize", next: "ELSE_SUMMARY_DONE", action: "REQUEST_PDF", primary: true },
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP" },
        { id: "menu", label: "Main options", next: "START_MENU" },
      ],
    },
    ELSE_PAIN_WORSENING: {
      say: [
        "Mm. If it's getting worse over multiple cycles, that's a good reason to take it seriously 🩷",
        "Not because it automatically means something scary - but because you deserve support and answers.",
        "If you can, consider talking with a healthcare provider, especially if it affects school/work/sleep.",
        "Want to use the care map, or go back to the main menu?",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_PAIN_SAME_WRAP: {
      say: [
        "Got you 🩷",
        "If it's stable and not escalating, tracking + comfort strategies can be enough for many people.",
        "If you'd like, I can help you track: day of cycle, intensity, and what improves it - that pattern can be really useful later.",
        "Want to go back to the main options?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_PAIN_PROVIDER_SOON: {
      say: [
        "Thanks for sharing that 🩷",
        "Because you selected symptoms that can sometimes signal something more than routine cramps, it would be a good idea to get medical advice soon - especially if symptoms worsen.",
        "If you feel faint, have severe one-sided pain, or very heavy bleeding, please treat it as urgent.",
        "Want to use the care map?",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "sum", label: "Help me summarize", next: "ELSE_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: "Main options", next: "START_MENU" },
      ],
    },
    ELSE_PAIN_MONITOR_WRAP: {
      say: [
        "Okay 🩷 Since you didn't select any major red flags, this sounds more like a 'monitor + support' situation for now.",
        "Try comfort care and keep an eye on patterns.",
        "If it becomes severe, sudden, one-sided, or starts coming with heavy bleeding/dizziness, that's a reason to get checked.",
        "Do you want to go back to the main menu or talk through another symptom?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_PAIN_SEVERE: {
      say: [
        "Thanks for letting me know 🩷",
        "Severe or worsening pain isn't something you should ignore.",
        "If the pain is sudden, intense, or interfering with daily activities, it would be a good idea to seek medical care.",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_DISCHARGE: {
      say: ["Thanks for sharing 🩷", "Is the discharge unusual in color, smell, or amount compared to what's normal for you?"],
      question: "Discharge unusual vs normal?",
      choices: [
        { id: "yes", label: "Yes", next: "ELSE_PROVIDER", primary: true },
        { id: "no", label: "No", next: "ELSE_WRAP" },
        { id: "ns", label: "Not sure", next: "ELSE_PROVIDER" },
      ],
    },
    ELSE_OFF: {
      say: ["Thanks for explaining 🩷", "Have you noticed more than one change this cycle? (for example: timing + pain, or flow + mood)"],
      question: "More than one change this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "ELSE_WRAP", primary: true },
        { id: "no", label: "No", next: "ELSE_WRAP" },
      ],
    },
    ELSE_PROVIDER: {
      say: ["Thanks for letting me know.", "If this continues, worsens, or feels concerning, it may be helpful to speak with a healthcare provider."],
      choices: [
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "Want to check anything else while you're here?"],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    ELSE_WRAP: {
      say: [
        "Thanks for sharing that with me 🩷",
        "I can't diagnose, but the way you're noticing patterns and asking questions is exactly how you advocate for your health.",
        "If you want, we can go back to the main options or talk through one more detail (timing, triggers, what makes it better/worse).",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Keep talking (something else)", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---- ELSE: body change nodes ---- */

    ELSE_BODY_ENTRY: {
      say: [
        "Body changes can be connected to your cycle more than people expect 🩷",
        "Which feels most like what you're noticing?",
      ],
      choices: [
        { id: "acne",  label: "Acne or oily skin",                   next: "BODY_HORMONAL_ROUTE", primary: true },
        { id: "hair",  label: "Hair thinning or increased facial hair", next: "BODY_HORMONAL_ROUTE" },
        { id: "wt",    label: "Weight changes",                       next: "BODY_HORMONAL_ROUTE" },
        { id: "sleep", label: "Sleep issues or insomnia",             next: "BODY_SLEEP_ROUTE" },
        { id: "hfsh",  label: "Hot flashes or night sweats",          next: "PERIMENOPAUSE_INTRO" },
        { id: "mix",   label: "Not sure or a mix of these",           next: "BODY_HORMONAL_ROUTE" },
      ],
    },

    BODY_HORMONAL_ROUTE: {
      say: [
        "Skin, hair, and weight changes can all be connected to hormonal shifts, especially if they're showing up alongside cycle changes 🩷",
        "The most common hormonal causes include PCOS, thyroid changes, and natural fluctuations in estrogen and progesterone.",
        "A few things to notice: are these changes happening around specific points in your cycle, or all the time? Have your periods changed alongside these symptoms?",
        "If multiple of these things are happening together, irregular periods, acne, hair changes, weight shifts, it's worth bringing to a provider. Not because something is definitely wrong, but because those patterns together tell a clearer story.",
      ],
      choices: [
        { id: "pcos",  label: "Learn about PCOS",     next: "EDUC_PCOS",    primary: true },
        { id: "log",   label: "Track this concern",   next: "START_MENU",   action: "LOG_SYMPTOM", logData: { type: "body_hormonal", note: "Body change concern logged from Bloomie chat" } },
        { id: "map",   label: "Find care near me",    next: "START",        action: "OPEN_MAP" },
        { id: "menu",  label: "Back to main menu",    next: "START_MENU" },
      ],
    },

    BODY_SLEEP_ROUTE: {
      say: [
        "Sleep issues are more connected to your cycle than most people realise 🩷",
        "In the luteal phase, progesterone can make you feel sleepy but actually disrupts deep sleep quality, which is why some people feel exhausted even after a full night.",
        "Poor sleep can also amplify mood changes, cravings, and pain sensitivity, so it's worth tracking whether it clusters around certain cycle days.",
        "If sleep issues are happening all cycle long or getting worse, it may be worth mentioning to a provider. Thyroid changes and perimenopause can also affect sleep.",
      ],
      choices: [
        { id: "mood",  label: "My mood is also affected",     next: "MOOD_INTRO",           primary: true },
        { id: "peri",  label: "Learn about perimenopause",    next: "PERIMENOPAUSE_INTRO" },
        { id: "menu",  label: "Back to main menu",            next: "START_MENU" },
      ],
    },

    /* ---- ELSE: discharge nodes ---- */

    ELSE_DISCHARGE_ENTRY: {
      say: [
        "Discharge changes can mean a lot of different things 🩷",
        "What feels most like what you're noticing?",
      ],
      choices: [
        { id: "smell",  label: "Strong smell, itching, or burning",      next: "DISCHARGE_PROVIDER_SOON", primary: true },
        { id: "colour", label: "Unusual colour (yellow, green, grey)",   next: "DISCHARGE_PROVIDER_SOON" },
        { id: "fever",  label: "Fever or pelvic pain alongside it",      next: "DISCHARGE_URGENT" },
        { id: "more",   label: "Just more than usual, otherwise normal", next: "DISCHARGE_MONITOR" },
        { id: "diff",   label: "Not sure / just feels different",        next: "DISCHARGE_CLARIFY" },
      ],
    },

    DISCHARGE_PROVIDER_SOON: {
      say: [
        "What you're describing, especially the smell, colour, or irritation, is worth getting checked 🩷",
        "Unusual discharge with those qualities can sometimes signal a bacterial or yeast infection, or occasionally an STI, and those are all treatable.",
        "A healthcare provider or pharmacist can do a proper check. It's a quick visit and you deserve to know what's going on.",
        "In the meantime, avoid scented products down there and wear breathable cotton underwear if you can.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",  next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",  next: "START_MENU" },
      ],
    },

    DISCHARGE_URGENT: {
      say: [
        "Discharge combined with fever or pelvic pain needs proper attention today 🩷",
        "That combination can sometimes point to an infection that needs treatment sooner rather than later, like pelvic inflammatory disease (PID), which is very treatable when caught early.",
        "Please don't wait on this one. Try to see a provider today or go to urgent care.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",  next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",  next: "START_MENU" },
      ],
    },

    DISCHARGE_MONITOR: {
      say: [
        "Discharge that's increased but otherwise looks and smells normal is usually not a concern on its own 🩷",
        "Discharge naturally changes throughout your cycle. It tends to be more watery or egg-white-like around ovulation and thicker or creamier in the luteal phase.",
        "Keep an eye on it. If the smell, colour, or texture changes, or if you notice itching or burning, come back and let's look at it again.",
      ],
      choices: [
        { id: "educ", label: "Learn more about discharge changes", next: "EDUC_DISCHARGE", primary: true },
        { id: "menu", label: "Back to main menu",                  next: "START_MENU" },
      ],
    },

    DISCHARGE_CLARIFY: {
      say: [
        "That's okay 🩷 Sometimes it's hard to describe.",
        "Has anything else changed alongside it, any smell, colour change, itching, pain, or fever?",
      ],
      choices: [
        { id: "yes",   label: "Yes, some of those",             next: "DISCHARGE_PROVIDER_SOON", primary: true },
        { id: "no",    label: "No, it just seems different",    next: "DISCHARGE_MONITOR" },
        { id: "infec", label: "I think I might have an infection", next: "DISCHARGE_PROVIDER_SOON" },
      ],
    },

    EDUC_DISCHARGE: {
      say: [
        "Discharge is actually a healthy part of how the vagina cleans itself 🩷",
        "What's 'normal' varies a lot between people, but generally: clear to white, mild or no smell, and texture that changes through the cycle is all typical.",
        "What's worth checking: strong or fishy smell, yellow or green colour, cottage cheese texture, or discharge that comes with itching, burning, or pain.",
      ],
      choices: [
        { id: "menu", label: "Back to main menu", next: "START_MENU", primary: true },
      ],
    },

    /* ---- ELSE: not-sure route nodes ---- */

    ELSE_NOT_SURE_ROUTE: {
      say: [
        "That's completely okay 🩷",
        "What would help most right now?",
      ],
      choices: [
        { id: "urgent", label: "I want to know if it's urgent",                next: "ELSE_URGENT_CHECK",   primary: true },
        { id: "normal", label: "I want to know if what I'm feeling is normal", next: "ELSE_CHANGE_TYPE" },
        { id: "figure", label: "I want help figuring out what changed",        next: "ELSE_CHANGE_TYPE" },
        { id: "talk",   label: "I just need to talk it through",               next: "ELSE_TALK_THROUGH" },
      ],
    },

    ELSE_URGENT_CHECK: {
      say: [
        "Before we sort the details, let me check for anything urgent 🩷",
        "Are you having severe pain, very heavy bleeding, fever, fainting, or a strong feeling that something is seriously wrong?",
      ],
      choices: [
        { id: "yes", label: "Yes",      next: "HEAVY_URGENT",     primary: true },
        { id: "no",  label: "No",       next: "ELSE_CHANGE_TYPE" },
        { id: "ns",  label: "Not sure", next: "ELSE_URGENT_TRUST" },
      ],
    },

    ELSE_URGENT_TRUST: {
      say: [
        "Trust that instinct 🩷 If something feels seriously wrong, it's always okay to seek care.",
        "Find a provider near you or go to urgent care.",
      ],
      choices: [
        { id: "map",    label: "Find care near me",       next: "START",            action: "OPEN_MAP", primary: true },
        { id: "change", label: "Help me figure out more", next: "ELSE_CHANGE_TYPE" },
      ],
    },

    ELSE_CHANGE_TYPE: {
      say: [
        "What feels most like what's changed? 🩷",
      ],
      choices: [
        { id: "cycle",  label: "Cycle timing or missed period", next: "LATE_INTRO",            primary: true },
        { id: "flow",   label: "Flow or bleeding",              next: "HEAVY_INTRO" },
        { id: "pain",   label: "Pelvic pain or cramps",         next: "PELVIC_INTRO" },
        { id: "mood",   label: "Mood or energy",                next: "MOOD_INTRO" },
        { id: "spot",   label: "Spotting",                      next: "SPOT_INTRO" },
        { id: "dis",    label: "Discharge or body changes",     next: "ELSE_DISCHARGE_ENTRY" },
      ],
    },

    ELSE_TALK_THROUGH: {
      say: [
        "Of course 🩷 Sometimes you just need to get it out before figuring out what it is.",
        "Tell me what's been going on - in your own words, no right or wrong way to say it.",
      ],
      choices: [],
    },

    /* ---- ELSE: wrap nodes ---- */

    ELSE_MONITOR_WRAP: {
      say: [
        "Based on what you shared, this sounds like something worth keeping an eye on rather than something urgent right now 🩷",
        "Track it for a cycle or two. Note when it happens, how long it lasts, and whether it changes. That kind of pattern is really useful if you ever talk to a provider.",
      ],
      choices: [
        { id: "log",  label: "Log this",         next: "START_MENU", action: "LOG_SYMPTOM", logData: { type: "general", note: "Concern logged from Bloomie chat" }, primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    ELSE_PROVIDER_WRAP: {
      say: [
        "What you're describing is worth a proper check 🩷 Not because it's definitely something serious, but because you deserve a real answer, not just reassurance.",
        "A healthcare provider can do the kind of assessment that actually rules things in or out.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    ELSE_TRACK_WRAP: {
      say: [
        "This is the kind of thing that becomes clearer with a bit more data 🩷",
        "If you log your symptoms over the next cycle, patterns start to emerge, and that information is genuinely useful whether you keep it for yourself or share it with a provider.",
      ],
      choices: [
        { id: "log",  label: "Log this",         next: "START_MENU", action: "LOG_SYMPTOM", logData: { type: "general", note: "Concern logged from Bloomie chat" }, primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- CYCLE-AWARE SMART NODES ---------------- */
    // All nodes below use userMode.* and cd.* for context-aware responses.
    // They never guess pregnancy - they check pregnancyConfirmed and mode explicitly.

    // Gate node: silently redirect to SESSION_MODE_CONFIRM if mode is unknown/browsing,
    // or go straight to CYCLE_EDD_ANSWER if already confirmed.
    CYCLE_EDD_GATE: {
      say: [],   // no message - just a routing node
      onEnter() {
        const mode = effectiveMode();
        if (mode === "pregnancy_tracking" || cd.pregnancyConfirmed) {
          transition("CYCLE_EDD_ANSWER");
        } else {
          transition("SESSION_MODE_CONFIRM");
        }
      },
      choices: [],
    },

    CYCLE_PHASE_ANSWER: {
      say() {
        // Postpartum - cycle may not have returned
        if (userMode.isPostpartum) {
          return [
            "Since you're in postpartum mode, your cycle may still be returning 🩷",
            "It can take several weeks to months for periods to resume, especially if breastfeeding.",
            "If you've had your first postpartum period and want to start tracking again, log it on the dashboard.",
          ];
        }
        // Pregnancy - phase questions don't apply
        if (userMode.isPregnancy) {
          return [
            "You're currently in pregnancy tracking mode, so cycle phases don't apply right now 🩷",
            "Would you like to know how far along you are instead?",
          ];
        }
        if (!hasLmpData()) {
          ctx.captureReturnTo = "CYCLE_PHASE_ANSWER";
          return [
            "I'd love to tell you what phase you're in 🩷",
            "I need the date your last period started - you can enter it here or log it on your dashboard.",
          ];
        }
        const p = getCurrentPhase();
        if (!p) return ["Couldn't work that out right now 🩷 Check that your last period date is up to date on the dashboard."];
        const lmp = effectiveLmp();
        const next = cd.nextPeriodDate || addDays(lmp, effectiveCycleLength());
        const daysLeft = daysBetween(new Date(), next);
        const periodNote = daysLeft > 0
          ? `Your next period is expected in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`
          : "Your period may be due around now - if it hasn't come, keep an eye on it.";
        const ttcNote = userMode.isTTC && p.phase === "ovulation"
          ? "You're in your fertile window right now - best time if you're trying to conceive 🌟"
          : userMode.isTTC && p.phase === "follicular"
          ? "Ovulation is coming up soon - good time to prepare if you're TTC."
          : null;
        return [
          ...quickSummary(
            `You're in ${p.label} - day ${p.days + 1} of your cycle.`,
            `${qualifier()}: last period ${fmtDate(lmp)}, ${effectiveCycleLength()}-day cycle.`,
            periodNote
          ),
          ttcNote,
        ].filter(Boolean);
      },
      choices() {
        const base = [
          { id: "late", label: "My period is late", next: "LATE_INTRO", primary: true },
          { id: "mood", label: "I'm getting PMS symptoms", next: "MOOD_INTRO" },
          { id: "ttc",  label: "I'm trying to conceive", next: "CYCLE_TTC_INFO" },
          { id: "menu", label: "Main options", next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          base.unshift({ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true });
        }
        return base;
      },
    },

    CYCLE_NEXT_PERIOD: {
      say() {
        if (userMode.isPregnancy) {
          return [
            "You're in pregnancy tracking mode, so your period isn't expected right now 🩷",
            "Would you like to know your due date or how far along you are?",
          ];
        }
        if (userMode.isPostpartum) {
          return [
            "In postpartum mode, predicting your next period depends on whether your cycle has returned 🩷",
            "If you've had your first postpartum period, log it on the dashboard so I can start tracking again.",
          ];
        }
        if (!hasLmpData()) {
          ctx.captureReturnTo = "CYCLE_NEXT_PERIOD";
          return [
            "To tell you when your next period is expected, I need your last period start date 🩷",
            "You can type it here and I'll estimate right now - or log it on the dashboard.",
          ];
        }
        const next = cd.nextPeriodDate || addDays(cd.lmp, cd.cycleLength);
        const daysLeft = daysBetween(new Date(), next);
        const nextStr = fmtDate(next);
        const ttcNote = userMode.isTTC
          ? `In TTC mode, ovulation likely falls around ${fmtDate(addDays(cd.lmp, Math.round(cd.cycleLength / 2)))} - about ${Math.round(cd.cycleLength / 2)} days into your cycle.`
          : null;
        if (daysLeft < 0) {
          const daysOver = Math.abs(daysLeft);
          return [
            `Based on your last period and your average ${cd.cycleLength}-day cycle, your period was expected around ${nextStr} 🩷`,
            `That's ${daysOver} day${daysOver === 1 ? "" : "s"} ago - if it hasn't come yet, it may be worth checking in.`,
            "Is there any chance of pregnancy this cycle?",
          ].filter(Boolean);
        }
        if (daysLeft === 0) return [`Your period is expected today based on your logged cycle 🩷`, "If you're getting cramps or spotting, that's likely your body gearing up."];
        if (daysLeft <= 3) return [`Your period is expected very soon - around ${nextStr}, in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} 🩷`, "If you're already feeling crampy or moody, that's normal this close.", ttcNote].filter(Boolean);
        if (daysLeft <= 7) return [`Your next period is expected around ${nextStr} - about ${daysLeft} days from now 🩷`, "You're in the late luteal phase, which is when PMS symptoms tend to show up.", ttcNote].filter(Boolean);
        return [`Your next period is expected around ${nextStr}, about ${daysLeft} days away 🩷`, `Based on your last period date and your average ${cd.cycleLength}-day cycle.`, ttcNote].filter(Boolean);
      },
      choices() {
        const base = [
          { id: "late", label: "It's already late", next: "LATE_INTRO", primary: true },
          { id: "mood", label: "I'm getting PMS already", next: "MOOD_INTRO" },
          { id: "edd",  label: "What's my due date?", next: "CYCLE_EDD_ANSWER" },
          { id: "menu", label: "Main options", next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          base.unshift({ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true });
        }
        return base;
      },
    },

    CYCLE_LMP_ANSWER: {
      say() {
        if (userMode.isPregnancy && cd.lmp) {
          const weeksAlong = Math.floor(daysBetween(cd.lmp, new Date()) / 7);
          return [
            `Your last menstrual period was ${fmtDate(cd.lmp)} - that's how your pregnancy dates are calculated 🩷`,
            `You're approximately ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along based on that date.`,
          ];
        }
        if (!hasLmpData()) {
          ctx.captureReturnTo = "CYCLE_LMP_ANSWER";
          return [
            "I don't have your last period date yet 🩷",
            "You can type it here (e.g. Feb 8 or 2026-02-08) and I'll work with it right now.",
          ];
        }
        const lmp = effectiveLmp();
        const daysAgo = daysBetween(lmp, new Date());
        const nextNote = daysAgo > effectiveCycleLength()
          ? `Your next period may already be due - if it hasn't come, tap below.`
          : `You're on day ${daysAgo + 1} of your current cycle.`;
        return quickSummary(
          `Your last period started ${fmtDate(lmp)} - ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago.`,
          `${qualifier()}, ${effectiveCycleLength()}-day average cycle.`,
          nextNote
        );
      },
      choices() {
        const base = [
          { id: "late",  label: "My period is late", next: "LATE_INTRO", primary: true },
          { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER" },
          { id: "menu",  label: "Main options", next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          base.unshift({ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true });
        }
        return base;
      },
    },

    CYCLE_TEST_TIMING: {
      say() {
        // Already confirmed pregnant
        if (userMode.isPregnancy) {
          return [
            "It looks like you've already confirmed your pregnancy on the dashboard 🩷",
            "No need to test again - you're in pregnancy tracking mode.",
            "Would you like to know your due date or how far along you are?",
          ];
        }
        const timing = hasLmpData() ? smartTestTiming() : null;
        if (!timing) {
          ctx.captureReturnTo = "CYCLE_TEST_TIMING";
          return [
            "To give you a specific test date, I need your last period start date 🩷",
            "Log it on the dashboard and I can tell you exactly when to test.",
            "General rule: test the day after your expected period, or 21 days after unprotected sex.",
          ];
        }
        if (timing.canTestNow) {
          return quickSummary(
            `Your period was expected around ${fmtDate(timing.expectedPeriod)} - you can take a test now 🩷`,
            `${qualifier()}, ${effectiveCycleLength()}-day cycle.`,
            "Use first morning urine for the clearest result. Negative but period still missing? Retest in 48-72 hours."
          );
        }
        return quickSummary(
          `Best time to test is from ${fmtDate(timing.testDate)} - about ${timing.daysToTest} day${timing.daysToTest === 1 ? "" : "s"} away.`,
          `${qualifier()}: next period expected ${fmtDate(timing.expectedPeriod)}.`,
          "Testing too early can give a false negative - hormone levels need time to build up."
        );
      },
      choices: [
        { id: "late", label: "My period is late", next: "LATE_INTRO", primary: true },
        { id: "test", label: "Walk me through testing", next: "TEST_INTRO" },
        { id: "edd", label: "What's my due date?", next: "CYCLE_EDD_ANSWER" },
        { id: "menu", label: "Main options", next: "START_MENU" },
      ],
    },

    // ── EDD confirm gate ─────────────────────────────────────────────────
    // Quick 2-option confirm so we never give due-date math to someone
    // who was just curious - shown once per session.
    EDD_CONFIRM: {
      onEnter() {
        // If already confirmed pregnancy this session, skip straight to EDD answer
        if (userMode.isPregnancy) transition("CYCLE_EDD_ANSWER");
      },
      say: [
        "Just a quick check before I calculate 🩷",
        "Do you want your estimated due date because you're pregnant, or are you just exploring how it works?",
      ],
      choices: [
        { id: "yes",     label: "I'm pregnant / positive test",   next: "CYCLE_EDD_ANSWER",
          onSelect() { applySessionMode("pregnancy_tracking"); } },
        { id: "explore", label: "Just curious / planning ahead",  next: "EDD_EXPLORE"   },
        { id: "unsure",  label: "I'm not sure yet",               next: "CYCLE_TEST_TIMING" },
      ],
    },

    // EDD in explore / planning mode - helpful, no false confirmation
    EDD_EXPLORE: {
      say() {
        const lmp = effectiveLmp();
        if (!lmp) {
          ctx.captureReturnTo = "EDD_EXPLORE";
          return [
            "No problem - to estimate a hypothetical due date I just need a period start date to work from 🩷",
            "Enter it below and I'll show you how the calculation works.",
          ];
        }
        const provisional = addDays(lmp, 280);
        return quickSummary(
          `${qualifier()}, if a pregnancy started this cycle your estimated due date would be around ${fmtDate(provisional)}.`,
          `Naegele's rule: last period date + 280 days (40 weeks).`,
          `If you've actually confirmed a pregnancy, switch to pregnancy tracking mode on your dashboard for a locked-in EDD.`
        );
      },
      choices: [
        { id: "confirm", label: "I actually do have a positive test", next: "CYCLE_EDD_ANSWER",
          onSelect() { applySessionMode("pregnancy_tracking"); } },
        { id: "test",    label: "When should I take a test?",         next: "CYCLE_TEST_TIMING" },
        { id: "menu",    label: "Main options",                        next: "START_MENU" },
      ],
    },

    CYCLE_EDD_ANSWER: {
      say() {
        // ── Confirmed pregnancy with EDD logged ───────────────────────────
        if (userMode.isPregnancy && cd.edd) {
          const daysToEdd = daysBetween(new Date(), cd.edd);
          const weeksAlong = cd.lmp ? Math.floor(daysBetween(cd.lmp, new Date()) / 7) : null;
          const weeksLeft  = Math.round(daysToEdd / 7);
          const timeNote   = daysToEdd > 0
            ? `About ${weeksLeft} week${weeksLeft === 1 ? "" : "s"} to go.`
            : "Your due date has passed - make sure your provider has current information.";
          return quickSummary(
            `Your estimated due date is ${fmtDate(cd.edd)}${weeksAlong !== null ? ` - you're around ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along` : ""} 🩷`,
            `${qualifier()}, confirmed EDD from your dashboard.`,
            timeNote
          );
        }

        // ── Confirmed pregnancy but no EDD yet ────────────────────────────
        if (userMode.isPregnancy && !cd.edd) {
          const weeksAlong = cd.lmp ? Math.floor(daysBetween(cd.lmp, new Date()) / 7) : null;
          const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
          return [
            "You're in pregnancy tracking mode but a confirmed due date hasn't been logged yet 🩷",
            provisionalEdd ? `Based on your last period date, a rough estimate puts your due date around ${fmtDate(provisionalEdd)}.` : null,
            weeksAlong !== null ? `That would put you at approximately ${weeksAlong} weeks along.` : null,
            "Once your provider confirms your dates, update the dashboard for a locked-in EDD.",
          ].filter(Boolean);
        }

        // ── NOT in pregnancy mode - the key safety check ─────────────────
        // Never assume pregnancy. Ask first.
        if (!userMode.isPregnancy) {
          // Can calculate provisional EDD but must contextualise it
          const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
          if (!hasLmpData()) {
            ctx.captureReturnTo = "CYCLE_EDD_ANSWER";
            return [
              "Just checking - are you currently tracking a pregnancy, or just exploring due date info? 🩷",
              "Either way, I need your last period start date to estimate. You can type it here.",
            ];
          }
          return [
            "Just checking - are you currently tracking a pregnancy, or exploring due date info? 🩷",
            `I can see your last period was ${fmtDate(cd.lmp)}.`,
            provisionalEdd
              ? `If a pregnancy started this cycle, a rough due date estimate would be around ${fmtDate(provisionalEdd)} - but this is not confirmed.`
              : null,
            "If you've had a positive test, switching to pregnancy tracking mode on the dashboard unlocks your full confirmed timeline.",
          ].filter(Boolean);
        }

        return ["I wasn't able to calculate a due date right now 🩷 Make sure your last period date is logged on the dashboard."];
      },
      choices: [
        { id: "test", label: "Help me figure out test timing", next: "CYCLE_TEST_TIMING", primary: true },
        { id: "switch", label: "Yes, I have a positive test", next: "LATE_POSITIVE" },
        { id: "explore", label: "Just exploring / planning ahead", next: "TEST_INTRO" },
        { id: "menu", label: "Main options", next: "START_MENU" },
      ],
    },

    // ── TTC info node ─────────────────────────────────────────────────────
    CYCLE_TTC_INFO: {
      say() {
        if (!hasLmpData()) {
          return [
            "That's exciting 🩷 To give you useful TTC info, I need your cycle data.",
            "Log your last period on the dashboard so I can tell you your ovulation window.",
          ];
        }
        const ovulationDay = addDays(cd.lmp, Math.round(cd.cycleLength / 2) - 1);
        const fertileStart = addDays(ovulationDay, -2);
        const fertileEnd   = addDays(ovulationDay, 1);
        const daysToOvulation = daysBetween(new Date(), ovulationDay);
        return [
          `Based on your ${cd.cycleLength}-day cycle and last period of ${fmtDate(cd.lmp)}, your estimated ovulation window is ${fmtDate(fertileStart)} - ${fmtDate(fertileEnd)} 🩷`,
          daysToOvulation > 0
            ? `That's about ${daysToOvulation} day${daysToOvulation === 1 ? "" : "s"} from now.`
            : daysToOvulation === 0
            ? "Today falls within your estimated fertile window."
            : "Your estimated fertile window has passed for this cycle.",
          "The days just before and during ovulation are the most fertile.",
          "Tracking basal body temperature or ovulation strips can give you an even more precise window.",
        ];
      },
      choices: [
        { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER", primary: true },
        { id: "test", label: "When should I test?", next: "CYCLE_TEST_TIMING" },
        { id: "menu", label: "Main options", next: "START_MENU" },
      ],
    },

    // ── Postpartum info node ──────────────────────────────────────────────
    CYCLE_POSTPARTUM: {
      say() {
        return [
          "The postpartum period is different for everyone 🩷",
          "If you're breastfeeding, your period may be delayed, sometimes for months.",
          "Your first postpartum period may be heavier, more painful, or irregular compared to before.",
          "Once you have your first period, log it on the dashboard so we can start tracking your cycle again.",
          "If you're having heavy bleeding, severe pain, fever, or unusual discharge in the early postpartum weeks - that's worth checking with a provider urgently.",
        ];
      },
      choices: [
        { id: "heavy", label: "I'm having heavy bleeding", next: "HEAVY_INTRO", primary: true },
        { id: "menu", label: "Main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- MODE-SPECIFIC ENTRY NODES ---------------- */

    // Postpartum - dedicated pathway for users in postpartum mode
    POSTPARTUM_INTRO: {
      onEnter() { applySessionMode("postpartum"); },
      say() {
        return [
          "Postpartum bodies are on their own timeline 🩷",
          "Your cycle may take weeks or even months to return, especially if you're breastfeeding.",
          hasLmpData() && cd.lmp
            ? `Your last logged period was ${fmtDate(cd.lmp)}.`
            : "It looks like you haven't logged a period yet, that's okay, it may not have returned.",
          "What's on your mind today?",
        ].filter(Boolean);
      },
      choices: [
        { id: "period", label: "My period returned and something feels off", next: "HEAVY_INTRO", primary: true },
        { id: "mood",   label: "Mood or energy changes", next: "MOOD_INTRO" },
        { id: "bleed",  label: "Postpartum bleeding concerns", next: "HEAVY_INTRO" },
        { id: "menu",   label: "Main options", next: "START_MENU" },
      ],
    },

    // TTC - dedicated pathway for users trying to conceive
    TTC_INTRO: {
      onEnter() { applySessionMode("trying_to_conceive"); },
      say() {
        if (!hasLmpData()) {
          return [
            "Thanks for sharing that 🩷",
            "To give you useful TTC guidance, I need your cycle data, log your last period on the dashboard and I can tell you your ovulation window.",
            "What else can I help with?",
          ];
        }
        const ovDay = addDays(cd.lmp, Math.round(cd.cycleLength / 2) - 1);
        const fertileStart = addDays(ovDay, -2);
        const fertileEnd   = addDays(ovDay,  1);
        const daysTo = daysBetween(new Date(), ovDay);
        return [
          `Based on your ${cd.cycleLength}-day cycle, your estimated fertile window is ${fmtDate(fertileStart)} - ${fmtDate(fertileEnd)} 🩷`,
          daysTo > 0  ? `That's about ${daysTo} day${daysTo === 1 ? "" : "s"} away.`
          : daysTo === 0 ? "You're currently in your fertile window."
          : "Your fertile window has passed for this cycle.",
          "The days just before and during ovulation tend to be most fertile.",
          "What else would you like help with?",
        ];
      },
      choices: [
        { id: "test",  label: "When should I test?", next: "CYCLE_TEST_TIMING", primary: true },
        { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER" },
        { id: "late",  label: "My period is late", next: "LATE_INTRO" },
        { id: "menu",  label: "Main options", next: "START_MENU" },
      ],
    },

    // Session mode confirmation - fires when user action conflicts with logged mode
    // e.g. asks for EDD but not in pregnancy mode
    MODE_CONFIRM: {
      onEnter() { /* no-op; mode applied when user picks a choice */ },
      say: [
        "Just checking, I want to make sure I give you the right info 🩷",
        "Which best describes where you are right now?",
      ],
      choices: [
        { id: "cycle",     label: "Tracking my cycle", next: "START_MENU", primary: true,
          onSelect() { applySessionMode("cycle_tracking"); } },
        { id: "ttc",       label: "Trying to conceive", next: "TTC_INTRO",
          onSelect() { applySessionMode("trying_to_conceive"); } },
        { id: "pregnant",  label: "I have a confirmed pregnancy", next: "LATE_POSITIVE",
          onSelect() { applySessionMode("pregnancy_tracking"); } },
        { id: "postpartum",label: "Postpartum / after birth", next: "POSTPARTUM_INTRO",
          onSelect() { applySessionMode("postpartum"); } },
        { id: "browsing",  label: "Just exploring", next: "START_MENU",
          onSelect() { applySessionMode("just_browsing"); } },
      ],
    },

    // ── Session mode confirmation ─────────────────────────────────────────
    // Triggered when user asks about EDD/pregnancy-specific things but
    // their mode isn't confirmed as pregnancy_tracking.
    // Sets ctx.sessionMode so Bloomie knows for the rest of the session.
    SESSION_MODE_CONFIRM: {
      say() {
        if (hasLmpData()) {
          return [
            `Just checking, are you currently tracking a pregnancy, or exploring due date info? 🩷`,
            `I can see your last period was ${fmtDate(cd.lmp)}, so I want to make sure I give you the right guidance.`,
          ];
        }
        return [
          "Just checking, are you currently tracking a pregnancy, or just exploring due date info? 🩷",
          "I want to make sure I give you the right guidance.",
        ];
      },
      choices: [
        { id: "yes_preg",  label: "Yes, I'm pregnant",           next: "SESSION_MODE_SET_PREGNANCY",  primary: true },
        { id: "not_yet",   label: "Not confirmed yet / testing",  next: "CYCLE_TEST_TIMING" },
        { id: "exploring", label: "Just exploring / planning",    next: "SESSION_MODE_SET_BROWSING" },
        { id: "ttc",       label: "Trying to conceive",           next: "SESSION_MODE_SET_TTC" },
      ],
    },

    SESSION_MODE_SET_PREGNANCY: {
      onEnter() { ctx.sessionMode = "pregnancy_tracking"; },
      say() {
        const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
        const weeksAlong     = cd.lmp ? Math.floor(daysBetween(cd.lmp, new Date()) / 7) : null;
        return [
          "Got it - I'll treat this conversation as pregnancy tracking mode 🩷",
          provisionalEdd && weeksAlong !== null
            ? `Based on your last period of ${fmtDate(cd.lmp)}, you're approximately ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along and your estimated due date is around ${fmtDate(provisionalEdd)}.`
            : "Once your last period date is logged on the dashboard I can calculate your due date and weeks along.",
          "Make sure you switch to pregnancy tracking mode on the dashboard too, so your full timeline unlocks.",
        ].filter(Boolean);
      },
      choices: [
        { id: "edd",   label: "Tell me my due date",        next: "CYCLE_EDD_ANSWER",    primary: true },
        { id: "weeks", label: "How far along am I?",        next: "CYCLE_LMP_ANSWER" },
        { id: "menu",  label: "Main options",               next: "START_MENU" },
      ],
    },

    SESSION_MODE_SET_TTC: {
      onEnter() { ctx.sessionMode = "trying_to_conceive"; },
      say() {
        return [
          "Noted! I'll keep TTC context in mind for this conversation 🩷",
          "I'll highlight your fertile window and ovulation timing when relevant.",
        ];
      },
      choices: [
        { id: "ttc",   label: "When is my ovulation window?",  next: "CYCLE_TTC_INFO",    primary: true },
        { id: "phase", label: "What phase am I in?",           next: "CYCLE_PHASE_ANSWER" },
        { id: "menu",  label: "Main options",                  next: "START_MENU" },
      ],
    },

    SESSION_MODE_SET_BROWSING: {
      onEnter() { ctx.sessionMode = "just_browsing"; },
      say() {
        return [
          "No problem! Just exploring is totally valid 🩷",
          "I can walk you through how due dates are calculated or what cycle tracking looks like.",
        ];
      },
      choices: [
        { id: "edd",   label: "How is a due date calculated?",  next: "CYCLE_EDD_ANSWER",   primary: true },
        { id: "test",  label: "When would I test?",             next: "CYCLE_TEST_TIMING" },
        { id: "menu",  label: "Main options",                   next: "START_MENU" },
      ],
    },

    /* ─────────────── SAFETY & CRITICAL REDIRECT NODES ─────────────── */

    // Emergency - always urgent, never watered down
    EMERGENCY_REDIRECT: {
      say: [
        "Please stop and seek emergency care right now 🩷",
        "Call 119 (Jamaica Emergency) or go to your nearest emergency room.",
        "If someone is with you, ask them to help you get there or call for you.",
        "I'll be here when you're safe, but please prioritize getting real care first.",
      ],
      choices: [
        { id: "ok",   label: "I'm getting help now", next: "CLOSE", primary: true },
        { id: "safe", label: "I'm actually okay / it was less serious", next: "START_MENU" },
      ],
    },

    // Diagnosis redirect - validates concern without pretending to diagnose
    DIAGNOSIS_REDIRECT: {
      say: [
        "I can hear that you're trying to make sense of what's happening 🩷",
        "Conditions like PCOS, endometriosis, and fibroids are real and they're often under-diagnosed. Your concerns are valid.",
        "I can't give you a diagnosis, but I can help you build a picture of your symptoms so you can advocate for yourself at a provider visit.",
        "What's been going on? Describe the symptoms and I'll help you understand what category they might fall in.",
      ],
      choices: [
        { id: "heavy",  label: "Heavy or unusual bleeding", next: "HEAVY_INTRO", primary: true },
        { id: "pelvic", label: "Pelvic pain or cramps", next: "PELVIC_INTRO" },
        { id: "late",   label: "Irregular or late periods", next: "LATE_INTRO" },
        { id: "mood",   label: "Hormones / mood / fatigue", next: "MOOD_INTRO" },
        { id: "menu",   label: "Main options", next: "START_MENU" },
      ],
    },

    // Medication redirect - warm caring redirect, never a hard refusal
    MEDICATION_REDIRECT: {
      say: [
        "Dosage and medication safety depends on your full health picture - weight, other medications, any underlying conditions - and getting it wrong can cause real harm, so I can't advise on specifics 🩷",
        "That's not me brushing you off. A pharmacist genuinely has the full picture to help you properly, and in Jamaica you can walk in without a referral or appointment.",
        "If the pain is severe or not responding to anything, that's worth getting properly checked 🩷",
        "I can help you describe what you're feeling so you know exactly what to tell a pharmacist or provider when you go.",
      ],
      choices: [
        { id: "symptoms", label: "Help me describe my symptoms", next: "START_MENU", primary: true },
        { id: "map",      label: "Find a pharmacist near me", next: "CLOSE", action: "OPEN_MAP" },
        { id: "menu",     label: "Main options", next: "START_MENU" },
      ],
    },

    // Safety support - sexual violence / coercion
    SAFETY_SUPPORT: {
      say: [
        "What you've shared takes courage 🩷 You deserve care, safety, and support, none of this is your fault.",
        "In Jamaica, the Bureau of Women's Affairs helpline is 888-639-5433.",
        "The Jamaica Constabulary Force has a Sexual Offences Unit, you can report at any police station.",
        "If you need medical care after an assault (including emergency contraception or testing), a hospital emergency department can help confidentially.",
        "You don't have to navigate this alone.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "CLOSE", action: "OPEN_MAP", primary: true },
        { id: "more", label: "I have more health questions", next: "START_MENU" },
        { id: "done", label: "Thank you, I'm okay for now", next: "CLOSE" },
      ],
    },

    // Crisis support - mental health / suicidal ideation / self-harm
    CRISIS_SUPPORT: {
      say: [
        "What you're feeling right now matters 🩷 I'm not able to give you the support you deserve - but real, caring help is available.",
        "Jamaica Crisis Hotline: 888-NEW-LIFE (888-639-5433) - confidential, 24/7.",
        "You can also go to your nearest hospital emergency department and tell them how you're feeling.",
        "You're not alone in this, and reaching out - even here - took strength.",
      ],
      choices: [
        { id: "ok",   label: "I'll reach out", next: "CLOSE", primary: true },
        { id: "more", label: "I also have a health question", next: "START_MENU" },
      ],
    },

    // Privacy / data info
    PRIVACY_INFO: {
      say: [
        "Really glad you asked 🩷 Your privacy matters and you deserve a straight answer.",
        "Your data - period logs, symptoms, notes - is stored securely. It is never sold to third parties, ever.",
        "You are in control of your own logs. You can edit or delete entries any time from your dashboard.",
        "If you want to delete your account and all your data, go to Settings → Account → Delete Account. Everything goes.",
        "This chat session isn't saved permanently - when you close Bloomie, the conversation is gone.",
        "Bloom is also designed to comply with the Jamaica Data Protection Act 2020, which gives you the right to access, correct, and delete your personal data.",
        "You're not a product here. You're a person who deserves care and privacy.",
      ],
      choices: [
        { id: "ok",   label: "Thanks, that helps", next: "START_MENU", primary: true },
        { id: "more", label: "I have a health question", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ─────────────── INLINE DATA CAPTURE NODE ─────────────── */

    // When user asks a cycle question but has no LMP logged,
    // Bloomie can collect it right here in chat.
    CAPTURE_LMP: {
      onEnter() {
        ctx.capture = { kind: "lmpDate", next: ctx.captureReturnTo || "CYCLE_PHASE_ANSWER" };
      },
      say: [
        "No problem! I just need the date your last period started 🩷",
        "Type it in any format: 2026-02-08, 08/02/2026, or just 'Feb 8'.",
        "Nothing gets saved to your dashboard, this is just for this chat.",
      ],
      choices: [
        { id: "skip", label: "Skip. Just show me general info", next: "START_MENU" },
      ],
    },

    /* ─────────────── NEW BRANCH NODES ─────────────── */

    // "Is my period late?" - smart lateness check
    LATE_PERIOD_CHECK: {
      say() {
        if (!hasLmpData()) {
          ctx.captureReturnTo = "LATE_PERIOD_CHECK";
          return [
            `${ack()} To check if your period is late, I need your last period start date 🩷`,
            "You can type it here, I won't save it to your dashboard, just use it for this chat.",
          ];
        }
        const lmp = effectiveLmp();
        const cycleLen = effectiveCycleLength();
        const expectedNext = cd.nextPeriodDate || addDays(lmp, cycleLen);
        const daysLate = daysBetween(expectedNext, new Date());

        if (daysLate < 0) {
          const daysLeft = Math.abs(daysLate);
          return quickSummary(
            `Your period isn't late - it's expected in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
            `${qualifier()}: last period ${fmtDate(lmp)}, ${cycleLen}-day cycle.`,
            daysLeft <= 5
              ? "You might start feeling PMS symptoms around now, that's normal."
              : "Nothing to worry about yet. Keep tracking."
          );
        }
        if (daysLate === 0) {
          return quickSummary(
            "Your period is expected today 🩷",
            `${qualifier()}: last period ${fmtDate(lmp)}.`,
            "If you're getting cramps or light spotting, it may be on its way."
          );
        }
        if (daysLate <= 7) {
          return [
            `${ack()} Based on your logged cycle, your period is about ${daysLate} day${daysLate === 1 ? "" : "s"} late 🩷`,
            `${estimate()}`,
            "A few days late doesn't always mean something is wrong; stress, illness, travel, or sleep changes can all shift timing.",
            "Want to walk through the possible reasons?",
          ];
        }
        return [
          `${ack()} Your period is ${daysLate} days late based on your logged cycle 🩷`,
          "That's worth paying attention to, I'd suggest walking through it together.",
        ];
      },
      choices() {
        const late = hasLmpData() && (() => {
          const expected = cd.nextPeriodDate || addDays(effectiveLmp(), effectiveCycleLength());
          return daysBetween(expected, new Date()) > 0;
        })();
        const base = [
          { id: "walk",  label: "Walk me through possible reasons", next: "LATE_INTRO", primary: true },
          { id: "test",  label: "Could I be pregnant?", next: "LATE_TEST_Q" },
          { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER" },
          { id: "menu",  label: "Main options", next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          return [{ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true }];
        }
        if (!late) {
          return [
            { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER", primary: true },
            { id: "next",  label: "When is my next period?", next: "CYCLE_NEXT_PERIOD" },
            { id: "menu",  label: "Main options", next: "START_MENU" },
          ];
        }
        return base;
      },
    },

    // "What does this symptom mean?" - education without diagnosis
    SYMPTOM_EDUCATION: {
      say: [
        "I can give you general education on period and cycle symptoms 🩷",
        "Keep in mind, understanding what's common is different from diagnosing what's happening to you specifically.",
        "What do you want to understand better?",
      ],
      choices: [
        { id: "heavy",  label: "Heavy bleeding",          next: "EDUC_HEAVY",  primary: true },
        { id: "cramps", label: "Cramps and pelvic pain",  next: "EDUC_CRAMPS" },
        { id: "spot",   label: "Spotting between periods",next: "EDUC_SPOTTING" },
        { id: "mood",   label: "Mood and energy changes", next: "EDUC_MOOD" },
        { id: "late",   label: "Late or irregular periods",next: "EDUC_LATE" },
        { id: "menu",   label: "Something else",           next: "START_MENU" },
      ],
    },

    EDUC_HEAVY: {
      say: [
        "Heavy bleeding (called menorrhagia) means soaking through a pad or tampon in 2 hours or less, or passing large clots 🩷",
        "Common causes include fibroids, polyps, endometriosis, hormonal imbalances, or thyroid issues.",
        "It can also be a sign of low iron (anaemia), especially if you feel dizzy, weak, or short of breath during your period.",
        "If it's happening every cycle, it's worth bringing up with a provider, not because it's always serious, but because it's treatable.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me", next: "HEAVY_INTRO", primary: true },
        { id: "doc",   label: "Should I see a doctor?",  next: "SEE_DOCTOR_GUIDE" },
        { id: "more",  label: "Learn about another symptom", next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: "Main options", next: "START_MENU" },
      ],
    },

    EDUC_CRAMPS: {
      say: [
        "Period cramps (dysmenorrhoea) happen because your uterus contracts to shed its lining 🩷",
        "Mild cramps are common and normal for the first 1-2 days. But cramps that stop you from daily life, don't respond to pain relief, or happen outside your period - that's a different story.",
        "Conditions like endometriosis and adenomyosis can cause severe cramping and are often under-diagnosed.",
        `${consent()} - how bad does it get for you?`,
      ],
      choices: [
        { id: "mild",    label: "Manageable but annoying",  next: "MOOD_GUIDE", primary: true },
        { id: "severe",  label: "Stops my daily life",      next: "PELVIC_INTRO" },
        { id: "outside", label: "Happens outside my period",next: "PELVIC_SEX_INTRO" },
        { id: "menu",    label: "Main options",              next: "START_MENU" },
      ],
    },

    EDUC_SPOTTING: {
      say: [
        "Spotting between periods means light bleeding outside your expected period days 🩷",
        "It can be totally normal, ovulation spotting, implantation bleeding, or just hormonal fluctuation.",
        "It can also sometimes indicate a cervical issue, an infection, or a reaction to contraception.",
        "The key questions are: how often does it happen, does it come with pain or discharge, and is it new behaviour for your body?",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",    next: "SPOT_INTRO",  primary: true },
        { id: "more",  label: "Learn about another symptom",next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: "Main options",               next: "START_MENU" },
      ],
    },

    EDUC_MOOD: {
      say: [
        "Mood changes tied to your cycle are driven by shifting hormone levels, mainly oestrogen and progesterone 🩷",
        "In the luteal phase (roughly days 15-28), progesterone rises then drops sharply, which can cause irritability, sadness, anxiety, or brain fog.",
        "When it's mild, that's PMS. When it's significantly affecting your daily life, it might be PMDD, which is real and treatable.",
        "Things like poor sleep, high stress, and low iron can also make cycle-related mood shifts worse.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is affecting me",       next: "MOOD_INTRO",  primary: true },
        { id: "more",  label: "Learn about another symptom",next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: "Main options",               next: "START_MENU" },
      ],
    },

    EDUC_LATE: {
      say: [
        "A period is generally considered late after 5+ days past your expected date 🩷",
        "Common reasons: pregnancy, stress (even positive stress), illness, big changes in weight or exercise, travel and timezone shifts, or thyroid issues.",
        "One late period in isolation often doesn't mean something is wrong. A pattern of irregular periods is worth looking into.",
        "Conditions like PCOS can cause consistently irregular cycles, that's one of its most common signs.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "My period is late right now", next: "LATE_PERIOD_CHECK", primary: true },
        { id: "preg",  label: "Could I be pregnant?",        next: "LATE_TEST_Q" },
        { id: "more",  label: "Learn about another symptom", next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: "Main options",                next: "START_MENU" },
      ],
    },

    // "Should I see a doctor?" - rule-based red flag guidance
    SEE_DOCTOR_GUIDE: {
      say() {
        const lastIntent = ctx.lastIntent || null;

        // Context-aware opening based on what brought them here
        const contextOpener = lastIntent
          ? `${ack("Based on what you've shared about")} ${
              lastIntent.includes("heavy")  ? "heavy bleeding" :
              lastIntent.includes("late")   ? "a late period"  :
              lastIntent.includes("pelvic") ? "pelvic pain"    :
              lastIntent.includes("mood")   ? "mood changes"   :
              lastIntent.includes("spot")   ? "spotting"       :
              "your symptoms"
            }, here's when I'd say see a provider 🩷`
          : `${ack()} Here's how I think about when to see a provider 🩷`;

        return [
          contextOpener,
          "Go soon (within days): heavy bleeding soaking through products every 2 hours, severe one-sided pain, fever with pelvic pain, or dizziness/fainting.",
          "Go when you can (within a few weeks): periods that are consistently late, irregular, or very painful, especially if this is new.",
          "Book a routine visit: if you haven't had a gynaecological check in over a year, or if something just feels off.",
          `${qualifier()}, I can't tell you whether your specific situation is urgent, that's why providers exist. But trusting your gut about your own body is always valid.`,
          ...urgentFooter(),
        ];
      },
      choices: [
        { id: "map",    label: "Find care near me",         next: "CLOSE", action: "OPEN_MAP", primary: true },
        { id: "heavy",  label: "I have heavy bleeding",     next: "HEAVY_INTRO" },
        { id: "late",   label: "My period is late",         next: "LATE_INTRO" },
        { id: "pain",   label: "I have pelvic pain",        next: "PELVIC_INTRO" },
        { id: "menu",   label: "Main options",              next: "START_MENU" },
      ],
    },

    // App help / how to log
    APP_HELP: {
      say: [
        "Happy to help you find your way around 🩷",
        "What are you trying to do?",
      ],
      choices: [
        { id: "log_period",   label: "Log my period",              next: "APP_LOG_PERIOD",  primary: true },
        { id: "log_symptom",  label: "Log a symptom",              next: "APP_LOG_SYMPTOM" },
        { id: "log_cycle",    label: "Set my cycle length",        next: "APP_LOG_CYCLE" },
        { id: "switch_mode",  label: "Switch to pregnancy / TTC",  next: "APP_SWITCH_MODE" },
        { id: "menu",         label: "Back to health questions",   next: "START_MENU" },
      ],
    },

    APP_LOG_PERIOD: {
      say: [
        "To log your period in Bloom 🩷",
        "1. Tap the calendar icon on your home screen",
        "2. Tap the date your period started",
        "3. Select 'Period start' and confirm",
        "Your cycle prediction and phase tracker will update automatically.",
      ],
      choices: [
        { id: "done",    label: "Got it, thanks",                next: "START_MENU", primary: true },
        { id: "symptom", label: "How do I log a symptom too?",   next: "APP_LOG_SYMPTOM" },
        { id: "more",    label: "Other app help",                next: "APP_HELP" },
      ],
    },

    APP_LOG_SYMPTOM: {
      say: [
        "To log a symptom 🩷",
        "1. Tap the '+' button at the bottom of your home screen",
        "2. Choose 'Log symptom'",
        "3. Pick the symptom type (bleeding, cramps, mood, etc.) and rate intensity",
        "Logging consistently makes it easier for me to give you better guidance over time.",
      ],
      choices: [
        { id: "done",   label: "Got it",            next: "START_MENU", primary: true },
        { id: "period", label: "How do I log my period?", next: "APP_LOG_PERIOD" },
        { id: "more",   label: "Other app help",    next: "APP_HELP" },
      ],
    },

    APP_LOG_CYCLE: {
      say: [
        "To set your average cycle length 🩷",
        "1. Go to Settings (gear icon, top right of home screen)",
        "2. Tap 'Cycle settings'",
        "3. Enter your average cycle length, most people are between 21 and 35 days",
        "Not sure? After a few logged periods, Bloom will calculate your average automatically.",
      ],
      choices: [
        { id: "done", label: "Got it", next: "START_MENU", primary: true },
        { id: "more", label: "Other app help", next: "APP_HELP" },
      ],
    },

    APP_SWITCH_MODE: {
      say: [
        "To switch between cycle tracking, pregnancy, or TTC mode 🩷",
        "1. Go to Settings → 'Tracking mode'",
        "2. Choose: Cycle tracking, Trying to conceive, or Pregnancy",
        "3. For pregnancy mode, you'll be asked for your EDD or last period date",
        "Switching mode changes which features and predictions you see.",
      ],
      choices: [
        { id: "done",     label: "Got it",               next: "START_MENU", primary: true },
        { id: "ttc",      label: "TTC questions",         next: "TTC_INTRO" },
        { id: "pregnant", label: "Pregnancy questions",   next: "CYCLE_EDD_ANSWER",
          onSelect() { if (!userMode.isPregnancy) transition("EDD_CONFIRM"); } },
        { id: "more",     label: "Other app help",        next: "APP_HELP" },
      ],
    },

    CLOSE: {
      say: [CLOSE],
      choices: [{ id: "menu", label: "Back to main options", next: "START_MENU", primary: true }],
    },

    /* ---------------- SESSION SUMMARY ---------------- */
    SUMMARY: {
      onEnter() {
        pushMsg("bot", buildSummaryCard(), { html: true });
      },
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- PERIMENOPAUSE PATHWAY ---------------- */
    PERIMENOPAUSE_INTRO: {
      say: [
        pick([
          "Perimenopause is one of the most under-discussed transitions in women's health - and you're right to want to understand it 🩷",
          "The fact that you're paying attention to these changes already puts you ahead 🩷",
          "Perimenopause can start earlier than most people expect - sometimes in the mid-30s - and it deserves real conversation 🩷",
        ]),
        "It's the transition period leading up to menopause - your hormones are shifting, and that shift can cause real, sometimes confusing symptoms.",
        "What's been going on for you?",
      ],
      choices: [
        { id: "vaso",    label: "Hot flashes or night sweats",          next: "PERI_VASOMOTOR_ROUTE" },
        { id: "cycle",   label: "Irregular or changing periods",         next: "PERI_CYCLE_ROUTE" },
        { id: "mood",    label: "Mood changes or brain fog",             next: "PERI_MOOD_ROUTE" },
        { id: "sleep",   label: "Sleep problems",                        next: "PERI_SLEEP_ROUTE" },
        { id: "vaginal", label: "Vaginal dryness or pain during sex",    next: "PERI_VAGINAL_ROUTE" },
        { id: "mixed",   label: "A mix of several things",               next: "PERI_MIXED_ROUTE" },
        { id: "unsure",  label: "I'm not sure if this is perimenopause", next: "PERI_UNSURE_ROUTE" },
      ],
    },

    PERI_VASOMOTOR_ROUTE: {
      say: [
        "Hot flashes and night sweats are some of the most well-known perimenopause symptoms 🩷",
        "They happen because estrogen fluctuations affect your body's temperature regulation - your brain gets a false signal that you're overheating.",
        "How often are they happening, and are they affecting your sleep or daily life?",
      ],
      choices: [
        { id: "manage",  label: "A few times a week, manageable",      next: "PERI_MONITOR_WRAP" },
        { id: "daily",   label: "Daily or disrupting sleep",           next: "PERI_PROVIDER_SOON", primary: true },
        { id: "sweat",   label: "Happening with heavy sweating at night", next: "PERI_PROVIDER_SOON" },
        { id: "unsure",  label: "Not sure yet",                        next: "PERI_MONITOR_WRAP" },
      ],
    },

    PERI_CYCLE_ROUTE: {
      say: [
        "Irregular periods are often one of the first signs of perimenopause 🩷",
        "Cycles can get shorter, longer, heavier, lighter, or just unpredictable - because estrogen and progesterone are no longer following their usual rhythm.",
        "Has the change been gradual, or did it seem to shift suddenly?",
      ],
      choices: [
        { id: "gradual",  label: "Gradual change over time",        next: "PERI_MONITOR_WRAP" },
        { id: "sudden",   label: "Sudden change",                   next: "PERI_PROVIDER_SOON" },
        { id: "heavy",    label: "Periods getting very heavy",      next: "HEAVY_INTRO" },
        { id: "stopped",  label: "Periods stopping for months",     next: "PERI_ABSENCE_CHECK" },
      ],
    },

    PERI_ABSENCE_CHECK: {
      say: [
        "If your periods have stopped for 12 months in a row, that's the clinical definition of menopause 🩷",
        "Before that point, pregnancy is still possible - so if there's any chance of pregnancy, a test would help clarify things.",
        "Has it been less than 12 months, or more?",
      ],
      choices: [
        { id: "less",   label: "Less than 12 months",  next: "PERI_MONITOR_WRAP" },
        { id: "more",   label: "12 months or more",    next: "MENOPAUSE_INFO_NODE", primary: true },
        { id: "unsure", label: "Not sure",              next: "PERI_MONITOR_WRAP" },
      ],
    },

    PERI_MOOD_ROUTE: {
      say: [
        "Mood changes, brain fog, and emotional intensity during perimenopause are real - not imagined, not dramatic 🩷",
        "Estrogen affects serotonin and other brain chemicals, so as levels fluctuate, mood stability can too.",
        "Is it more like anxiety and irritability, or more like low mood and exhaustion?",
      ],
      choices: [
        { id: "anxiety", label: "Anxiety or irritability",    next: "MOOD_ANXIETY_ROUTE" },
        { id: "low",     label: "Low mood or exhaustion",     next: "MOOD_LOW_ROUTE" },
        { id: "fog",     label: "Brain fog and memory",       next: "PERI_COGNITIVE_NOTE", primary: true },
        { id: "mix",     label: "A mix",                      next: "MOOD_MIXED_ROUTE" },
      ],
    },

    PERI_COGNITIVE_NOTE: {
      say: [
        "Brain fog and memory changes during perimenopause are incredibly common - and incredibly frustrating 🩷",
        "Estrogen plays a role in cognitive function, so when it fluctuates, concentration and recall can be affected.",
        "This usually improves as hormones stabilise, but if it's significantly affecting your daily life, it's worth mentioning to a provider.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },

    PERI_SLEEP_ROUTE: {
      say: [
        "Sleep disruption is one of the most exhausting parts of perimenopause 🩷",
        "It can come from night sweats waking you up, or from progesterone changes that affect sleep quality directly - sometimes both.",
        "Are you waking up from heat and sweating, or is it more that you just can't stay asleep?",
      ],
      choices: [
        { id: "heat",    label: "Waking from heat or sweating", next: "PERI_VASOMOTOR_ROUTE" },
        { id: "sleep",   label: "Can't stay asleep generally",  next: "BODY_SLEEP_ROUTE" },
        { id: "both",    label: "Both",                         next: "PERI_PROVIDER_SOON", primary: true },
      ],
    },

    PERI_VAGINAL_ROUTE: {
      say: [
        "Vaginal dryness and discomfort during sex are common in perimenopause and menopause - and they're very treatable 🩷",
        "As estrogen drops, vaginal tissue can become thinner and less lubricated. This is called genitourinary syndrome of menopause and it does not have to be something you just live with.",
        "There are options - from over-the-counter lubricants and moisturisers to treatments a provider can discuss with you.",
      ],
      choices: [
        { id: "map",    label: "Find care near me",              next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "contra", label: "Learn about contraception options", next: "EDUC_CONTRACEPTION" },
        { id: "menu",   label: "Back to main menu",              next: "START_MENU" },
      ],
    },

    PERI_MIXED_ROUTE: {
      say: [
        "A mix of symptoms is actually very typical for perimenopause - it's rarely just one thing 🩷",
        "The most helpful thing you can do right now is track what you're experiencing - when symptoms happen, how intense they are, and whether they're getting worse.",
        "That information is gold when you talk to a provider.",
      ],
      choices: [
        { id: "cont", label: "What should I do next?", next: "PERI_PROVIDER_SOON", primary: true },
      ],
    },

    PERI_UNSURE_ROUTE: {
      say: [
        "That uncertainty is really common - perimenopause can start earlier than most people expect and the symptoms overlap with a lot of other things 🩷",
        "Some things that can help you figure it out: tracking your cycle changes, noting which symptoms cluster together, and thinking about your age and family history.",
        "You don't need a definitive answer to start paying attention.",
      ],
      choices: [
        { id: "more",  label: "Tell me more about the symptoms",  next: "PERIMENOPAUSE_INTRO" },
        { id: "cycle", label: "I think my periods are changing",  next: "PERI_CYCLE_ROUTE" },
        { id: "care",  label: "I want to talk to a provider",     next: "PERI_PROVIDER_SOON", primary: true },
        { id: "menu",  label: "Back to main menu",                next: "START_MENU" },
      ],
    },

    PERI_MONITOR_WRAP: {
      say: [
        "Based on what you've shared, this sounds like it may be part of the perimenopause transition 🩷",
        "The most useful thing right now is consistent tracking - cycle dates, symptom types, intensity, and duration. Patterns over time tell a much clearer story than any single day.",
        "If symptoms become more intense, start affecting your daily life significantly, or you have very heavy bleeding, that's when to move from tracking to seeking care.",
      ],
      choices: [
        { id: "log",  label: "Log a symptom",     next: "START_MENU", action: "LOG_SYMPTOM" },
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP" },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    PERI_PROVIDER_SOON: {
      say: [
        "What you're describing is worth discussing with a healthcare provider - not because it's an emergency, but because you deserve proper support for this transition 🩷",
        "A provider can confirm whether this is perimenopause, rule out other causes, and talk through options that might help.",
        "In Jamaica, a gynaecologist or your GP is a good starting point. The care map can help you find someone nearby.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    MENOPAUSE_INFO_NODE: {
      say: [
        "Twelve months without a period is the clinical marker for menopause - your body has completed that transition 🩷",
        "What comes after is called postmenopause. Some symptoms like hot flashes and sleep disruption may continue for a while, but for many people they ease over time.",
        "Vaginal dryness, bone health, and cardiovascular changes are things worth discussing with a provider now that you're postmenopausal - not to alarm you, but because this is a new chapter your body deserves support for.",
      ],
      choices: [
        { id: "vaginal", label: "Vaginal dryness or discomfort", next: "PERI_VAGINAL_ROUTE" },
        { id: "mood",    label: "Mood or sleep changes",         next: "PERI_MOOD_ROUTE" },
        { id: "map",     label: "Find care near me",             next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu",    label: "Back to main menu",             next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: MENOPAUSE ---------------- */
    EDUC_MENOPAUSE: {
      say: [
        "Menopause is defined as 12 consecutive months without a period - that 12-month mark is the official transition point 🩷 The average age is around 51, but it's completely normal to reach it earlier or later.",
        "It's important to name this clearly: menopause is a natural life transition, not an illness. That said, the hormonal shifts involved are real, and so are the symptoms, you don't have to just push through them.",
        "After menopause, some symptoms from the perimenopause years continue: hot flashes, sleep disruption, mood changes, vaginal dryness, joint discomfort, and changes in bone density are all things providers take seriously and can help with.",
        "Support options range from lifestyle approaches (movement, sleep hygiene, nutrition) to menopausal hormone therapy (MHT/HRT), non-hormonal medications, and talking therapies, the right fit depends on your health history and your preferences. A provider or menopause specialist can walk you through what's available 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: CONTRACEPTION ---------------- */
    EDUC_CONTRACEPTION: {
      say: [
        "Contraception is something Bloomie can give you a general overview of, but I want to be upfront: I can't recommend a specific method for you, because what works best really depends on your health history, your cycle, and your own goals 🩷",
        "That said, here's a quick lay of the land: barrier methods (like condoms or diaphragms) work in the moment and don't affect your hormones. Hormonal methods (the pill, patch, ring, shot) use synthetic hormones to prevent pregnancy and can also help with cycle symptoms. Long-acting options (IUDs - hormonal or copper - and implants) are set-and-forget for years at a time.",
        "Each category has real trade-offs, side effects, how easy they are to use, how quickly fertility returns and a provider or pharmacist can walk you through what fits your situation, your body, and your life.",
        "If you don't have a regular provider, a sexual health clinic or a pharmacist are both great first steps 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: PCOS ---------------- */
    EDUC_PCOS: {
      say: [
        "PCOS - polycystic ovary syndrome, is one of the most common hormonal conditions people with periods deal with, and it's way more manageable than it sounds 🩷",
        "It basically means your hormones are running a little out of balance, which can cause things like irregular or skipped periods, acne that flares around your cycle, extra hair growth (chin, chest, belly), weight changes, or difficulty conceiving.",
        "The frustrating part is that PCOS looks different for everyone, some people have most of those symptoms, some have just one or two. That's why getting an actual diagnosis (usually an ultrasound plus a blood panel) matters so much.",
        "If your periods are consistently irregular, or you've been noticing acne or hair changes alongside cycle issues, it's worth bringing up with a provider, not because it's an emergency, but because the right support makes a real difference 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: ENDOMETRIOSIS ---------------- */
    EDUC_ENDO: {
      say: [
        "Endometriosis (often called endo) is a condition where tissue similar to your uterine lining grows in places it shouldn't, like on your ovaries or fallopian tubes, and that tissue still responds to your hormones each cycle 🩷",
        "That's why endo pain tends to show up around your period and can be really intense, cramping that doesn't respond well to regular pain relief, pain during sex, heavy bleeding, or a deep aching in your pelvis or lower back.",
        "One thing worth knowing: endo symptoms are often dismissed or written off as \"bad periods\" for years. If your period pain is significantly affecting your day-to-day life, if you're missing work, school, or things you love, that's not something you should have to just push through.",
        "Endo is diagnosed through a procedure called a laparoscopy, but a provider can also start with an ultrasound and a thorough conversation about your symptoms. You deserve to be taken seriously 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },
  };

  transition("START");

  return {
    getState: () => ({ ...ctx }),
    reset: () => {
      clearTimers();
      ctx.state = "START";
      ctx.history = [];
      ctx.answers = [];
      ctx.multiDraft = null;
      ctx.locked = false;
      transition("START");
    },
    getSummaryText: buildSummaryText,
  };
}