import { normalizePatois, detectPatois } from "./bloomie-patois.js";
import { extractEntities, inferRoute, summarizeEntities, SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS } from "./bloomie-inference.js";
import { buildGuidanceResponse, getStructuredSummary } from "./bloomie-templates.js";
import { loadBloomieMemory, saveBloomieMemory } from "./db.js";
import { pick, detectOutOfScope, resolveOOSFollowUp, scoreSignals, resolveSignals } from "./bloomie-routing.js";
import { createCtx } from "./bloomie-session.js";
import { logSafetyEvent } from "./bloomie-logger.js";

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

  // cycleData shape (pass from Firestore / dashboard state):
  // {
  //   lmp:                 Date | string | null,  ← last menstrual period
  //   cycleLength:         number | null,          ← average cycle length in days
  //   nextPeriodDate:      Date | string | null,   ← predicted next period
  //   isTrackingPregnancy: boolean,                ← user switched to pregnancy mode
  //   edd:                 Date | string | null,   ← estimated due date (if pregnancy mode)
  // }
  //
  // symptomHistory shape (pass from Firestore symptomLogs):
  // [{ dateKey: "YYYY-MM-DD", items: [{ code, severity, note }] }, ...]
  initBloomieChat({
    userName: user?.nickname || user?.displayName || null,
    cycleData,
    symptomHistory,
    bloomieMemory,
    onSaveMemory: saveBloomieMemory,
    onOpenCareMap: () => {
      location.hash = "#/care-map";
    },
    onRequestPdf: (summaryText) => {
      console.log("PDF requested:", summaryText);
      alert("PDF export coming soon 📄");
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
  onOpenCareMap = () => (location.hash = "#/care-map"),
  onRequestPdf = (summaryText) => console.log("PDF requested:", summaryText),
  onLogAction = (action, data) => console.log("Log action:", action, data),
} = {}) {
  const $box = document.getElementById(chatBoxId);
  const $input = document.getElementById(inputId);
  const $form = document.getElementById(formId);

  if (!$box) throw new Error(`Missing #${chatBoxId}`);

  // ---------- Nickname helper ----------
  // greet(full) → "Hey Kia 🩷"  |  greet() → "Hey 🩷"
  // greet(full, "Thanks for talking") → "Thanks for talking, Kia 🩷"
  function greet(useName = true, prefix = null) {
    const name = userName && userName.trim() ? userName.trim() : null;
    if (prefix) {
      return name && useName ? `${prefix}, ${name} 🩷` : `${prefix} 🩷`;
    }
    return name && useName ? `Hey ${name} 🩷` : `Hey 🩷`;
  }

  // ---------- Cycle data helpers ----------
  // Normalise whatever date format comes from Firestore into a JS Date or null
  function toDate(val) {
    if (!val) return null;
    if (val?.toDate) return val.toDate();           // Firestore Timestamp
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ── User state — derived from Firestore cycleData ────────────────────────
  // mode:
  //   "cycle_tracking"      → logging periods, using predictions
  //   "trying_to_conceive"  → TTC mode enabled on dashboard
  //   "pregnancy_tracking"  → confirmed pregnancy, tracking weeks/EDD
  //   "postpartum"          → post-birth mode
  //   "just_browsing"       → no logs, no mode set
  const cd = {
    lmp:                 toDate(cycleData?.lmp),
    cycleLength:         Number(cycleData?.cycleLength) || 28,
    nextPeriodDate:      toDate(cycleData?.nextPeriodDate),
    edd:                 toDate(cycleData?.edd),
    hasData:             !!(cycleData?.lmp),  // also re-checked via hasLmpData()

    // Explicit mode from dashboard — never guessed by Bloomie
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
  // effectiveMode: returns ctx.sessionMode if the user confirmed a mode THIS session,
  // otherwise falls back to the Firestore-derived cd.mode.
  // This means Bloomie can update its understanding mid-conversation without
  // waiting for a dashboard reload.
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
    // dayOfCycle is 1-indexed: day 1 = first day of last period.
    const dayOfCycle  = Math.max(1, Math.round((today - lmp) / (1000 * 60 * 60 * 24)) + 1);
    // daysLate: how many days past the expected end of this cycle (0 if not late).
    const daysLate    = Math.max(0, dayOfCycle - cycleLength);
    return { lmp, cycleLength, dayOfCycle, daysLate };
  }

  // Reactive mode checks — always use these instead of cd.mode directly
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
    if (dayOfCycle <= 5)  return { phase: "menstrual",   days: dayOfCycle, label: "your period phase (days 1–5)" };
    if (dayOfCycle <= 13) return { phase: "follicular",  days: dayOfCycle, label: "the follicular phase (days 6–13) — your body is preparing to ovulate" };
    if (dayOfCycle <= 15) return { phase: "ovulation",   days: dayOfCycle, label: "your ovulation window — days 13–15" };
    if (dayOfCycle <= 28) return { phase: "luteal",      days: dayOfCycle, label: "the luteal phase (days 16–28) — this is when PMS symptoms can show up" };
    return null;
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
  //
  // Given the catalog codes detected in the current message, scans
  // symptomHistory to find recurring patterns tied to the user's cycle.
  //
  // Returns a single Bloomie-ready sentence when a pattern is found, e.g.:
  //   "📊 Looking at your logs, cramps tend to show up around day 22–25 of
  //    your cycle — you've logged this 4 times. That's a real pattern."
  //
  // Returns null when: no history, no matching entries, or < 2 matching days.
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
        ? ` — and you're on day ${todayCycleDay} right now, which lines up`
        : "";
      return `📊 Your logs show **${label}** tends to appear around ${dayRange} of your cycle (logged ${count} time${count > 1 ? "s" : ""}${dayNote}).`;
    });

    return lines.join(" ");
  }

  // ── Follow-up memory: merge entity history ───────────────────────────────
  // Merges the current entity extraction with up to the last 2 stored sets so
  // that symptoms mentioned in earlier messages are still visible to inferRoute.
  // Symptoms are OR-merged (once mentioned, stays true this session).
  // duration / severity / timing / pregnancy take the most-recent non-null value.
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
  // Safe to call fire-and-forget — saves to localStorage immediately,
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

  // ── Seed entity history from persistent memory ───────────────────────────
  // If the last session was within 7 days, pre-populate entityHistory so
  // symptoms the user mentioned then stay active in inferRoute this session.
  if (bloomieMemory?.lastSymptoms?.length) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sessionDate  = bloomieMemory.lastSessionDate ? new Date(bloomieMemory.lastSessionDate) : null;
    if (sessionDate && sessionDate >= sevenDaysAgo) {
      const seedSymptoms = Object.fromEntries(
        Object.keys(extractEntities("").symptoms).map(k => [k, false])
      );
      for (const key of bloomieMemory.lastSymptoms) {
        if (key in seedSymptoms) seedSymptoms[key] = true;
      }
      ctx.entityHistory = [{
        symptoms:  seedSymptoms,
        duration:  bloomieMemory.lastDuration  || null,
        severity:  bloomieMemory.lastSeverity  || null,
        timing:    null,
        pregnancy: { chance: !!bloomieMemory.lastPregnancyChance, testedYet: false, result: null },
        urgent:    false,
        raw:       "",
      }];
    }
  }

  if ($input) {
    $input.disabled = false;
    $input.placeholder = "Type here or use the buttons…";
    $input.setAttribute("maxlength", "240");
  }

  if ($form && $input) {
    $form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (ctx.locked) return;

      const text = ($input.value || "").trim();
      if (!text) return;

      $input.value = "";

      // ── If we are capturing a date input, parse it here ──────────────────
      if (ctx.capture?.kind) {
        // Try ISO date, or natural formats like "March 1", "1/3/2026", "01-03-26"
        let parsed = new Date(text);
        // Fallback: try rearranging DD/MM/YYYY (common Jamaican format)
        if (Number.isNaN(parsed.getTime())) {
          const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
          if (dmyMatch) {
            let [, d, m, y] = dmyMatch;
            if (y.length === 2) y = "20" + y;
            parsed = new Date(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
          }
        }
        if (Number.isNaN(parsed.getTime())) {
          pushMsg("user", text);
          say("Hm, I couldn't read that date 🩷 Try typing it like: 2026-02-08, or 08/02/2026");
          return;
        }
        pushMsg("user", text);
        ctx.captureData = ctx.captureData || {};
        ctx.captureData[ctx.capture.kind] = parsed.toISOString();

        // If capturing LMP — save to sessionData so all cycle helpers use it
        if (ctx.capture.kind === "lmpDate") {
          ctx.sessionData = ctx.sessionData || {};
          ctx.sessionData.lmp = parsed.toISOString();
          console.log("[Bloomie] session LMP set →", parsed.toDateString());
        }
        if (ctx.capture.kind === "cycleLengthDate") {
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
      pushMsg("user", text);

      // ── OOS follow-up context ────────────────────────────────────────────
      const oosFollowUp = resolveOOSFollowUp(text, ctx.lastOOS);
      if (oosFollowUp) {
        ctx.lastOOS = null;
        transition(oosFollowUp);
        return;
      }

      // ── "I tested today" reactive detection ──────────────────────────────
      // Catches: "i tested today", "took a test today", "i just tested"
      // Auto-calculates retest window without needing the full TEST flow
      const testedToday = /(i tested|took a test|did a test|just tested|tested this morning|tested today|pregnancy test today)/.test(
        normalizePatois(text).toLowerCase()
      );
      if (testedToday) {
        pushMsg("user", text);
        const retestDate = addDays(new Date(), 3);
        say([
          `${ack()} Whatever the result, here's what to know 🩷`,
          `If it was negative, retest around **${fmtDate(retestDate)}** — 48–72 hours from now — with first morning urine for the most accurate reading.`,
          "A second negative at that point is more reliable than a single early one.",
          "If it was positive, the next step is connecting with a healthcare provider.",
        ]);
        setTimeout(() => transition("LATE_TEST_Q"), 3200);
        return;
      }

      // ── Context-aware choice matching ────────────────────────────────────
      // Before running the full router, check if the user's typed text
      // matches one of the CURRENT node's active choices.
      // This means "no me really feel tired" answers the Yes/No question
      // instead of re-routing to MOOD_INTRO again.
      const contextMatch = matchTypedToChoice(text);
      if (contextMatch) {
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

      // Normalize patois before routing
      const normalizedText = normalizePatois(text);

      // ── Inference layer ──────────────────────────────────────────────
      // 1. Extract entities (symptoms, duration, severity, timing, pregnancy, urgency)
      // 2. Build a structured guidance response from templates
      // 3. Infer the best route based on entity combinations
      const entities = extractEntities(normalizedText);

      // ── Follow-up memory: accumulate entity context ───────────────────
      // Merge with up to the last 2 extractions so symptoms from earlier
      // messages remain visible to inferRoute (e.g. "late period" then
      // "I also have nausea" now routes correctly as late+nausea).
      const mergedEntities = mergeEntities(entities, ctx.entityHistory.slice(-2));
      ctx.entityHistory = [...ctx.entityHistory.slice(-2), entities];

      console.log("[Bloomie inference]", summarizeEntities(mergedEntities));

      // ── P1: Inject symptom history context ───────────────────────────
      // If we have symptomHistory and this message mentions something the user
      // has repeatedly logged before, surface that pattern BEFORE routing.
      // This makes Bloomie feel aware of the user's actual body, not just the
      // current message. We only fire this when routing is also going to
      // proceed (i.e. we detected real symptoms), to avoid false positives.
      const catalogCodes = detectedCatalogKeys(mergedEntities.symptoms);
      const historyContext = buildSymptomContext(catalogCodes);
      if (historyContext) {
        say([historyContext], { delayMs: 0 });
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
      const guidance   = buildGuidanceResponse(mergedEntities, inferred?.payload?.reason, cycleCtx);

      if (guidance) {
        // Store on ctx so buildSummaryText can include them in PDF export
        ctx.lastEntities = mergedEntities;
        ctx.lastInferredReason = inferred?.payload?.reason || null;
        ctx.lastCycleCtx = cycleCtx;
        persistMemory(mergedEntities, ctx.lastInferredReason);
        // Show the structured template response THEN transition
        console.log("[Bloomie guidance] scenario →", guidance.scenario);
        const delay = 500 + Math.max(0, guidance.lines.length - 1) * 900 + 150;
        say(guidance.lines);
        if (inferred) {
          const tid = setTimeout(() => {
            transition(inferred.next, { entities: mergedEntities, ...(inferred.payload || {}) });
          }, delay);
          ctx.timers.add(tid);
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

      // ── Safety log: oos_fallback ──────────────────────────────────────────
      // containsHealthKeywords flags inputs that had urgency-adjacent words
      // but still fell through to OOS — the highest-risk false-negative mode.
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
        if (isOOS && routed.next === "START_MENU") {
          // Zero-confidence narrowing: if the input has health-adjacent words,
          // ask a clarifying question with topic buttons instead of the generic OOS reply.
          if (/\b(period|bleed|pain|cramp|discharge|pregnant|cycle|mood|tired|sick|hurt)\b/.test(normalizedText)) {
            transition("NARROWING");
            return;
          }
          // OOS fallback: just show reply, leave the menu buttons in place
          say(lines);
          render();
        } else {
          const delay = 500 + Math.max(0, lines.length - 1) * 900 + 150;
          say(lines);
          const tid = setTimeout(() => {
            transition(routed.next, routed.payload || {});
          }, delay);
          ctx.timers.add(tid);
        }
      } else if (routed?.reply) {
        say(routed.reply);
        render();
      } else if (routed?.next) {
        ctx.lastIntent = routed.next;
        transition(routed.next, routed.payload || {});
      } else {
        // Zero-confidence narrowing: same check for the hard no-match path.
        if (/\b(period|bleed|pain|cramp|discharge|pregnant|cycle|mood|tired|sick|hurt)\b/.test(normalizedText)) {
          transition("NARROWING");
          return;
        }
        say([
          "I'm here to help with periods, spotting, cramps, mood changes, or cycle concerns 🩷",
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
    "If you're comfortable sharing —",
    "Only if you want to —",
    "No pressure, but it helps to know:",
    "If you're open to it —",
  ];

  const ESTIMATE_QUALIFIER = [
    "I can estimate, though keep in mind this is based on averages.",
    "This is an estimate — cycles vary person to person.",
    "Keep in mind this is a prediction, not a guarantee.",
    "Actual timing can shift based on stress, health, and other factors.",
  ];

  // ack() — random acknowledgement opener, optionally followed by custom text
  function ack(extra = null) {
    const base = pick(ACK);
    return extra ? `${base} ${extra}` : base;
  }

  // qualifier() — opening a data-driven answer
  function qualifier() { return pick(GENTLE_QUALIFIER); }

  // consent() — before asking something personal
  function consent() { return pick(CONSENT_PREFIX); }

  // estimate() — when giving a calculated answer
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
    return ["_If symptoms are severe, sudden, or worsening — please seek medical care._"];
  }

  const OOS_DEFAULT = [
    () => pick([
      "I'm not sure I caught that 🩷 I focus on period and cycle concerns — tap a button below or tell me what's going on.",
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
    // User explicitly tells Bloomie their context — highest priority
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
      replies: ["Got it — TTC mode 🩷 Let me pull up your ovulation info."],
      forceNext: "TTC_INTRO",
    },
    {
      name: "mode_confirmation_postpartum",
      patterns: [
        /(just had a baby|i had a baby|postpartum|after (?:giving )?birth|gave birth|just gave birth|recently had a baby|recovering from (?:giving )?birth|after delivery)/,
      ],
      replies: ["Thanks for sharing that 🩷 Postpartum bodies are on their own timeline — let me help."],
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
              "I'm here — what would you like help with?",
              "Hey again 🩷 Pick something below or just tell me what's up.",
              "Still with you 🩷 What can I do for you?",
              "I didn't go anywhere 😄 What's on your mind?",
              "Always here 🩷 Tap a button or just tell me what you're dealing with.",
            ])
          : pick([
              "Heyy 🩷 What can I help with today? You can tap a button below or just type what's going on.",
              "Hi there 🩷 I'm here for period and cycle concerns — tap an option or just tell me what's up.",
              "Hey! 🩷 What's going on? You can type it out or pick from the options below.",
              "Welcome 🩷 I'm Bloomie — here to help with anything cycle or reproductive health. What's on your mind?",
              "Hey, glad you're here 🩷 Tell me what's going on or pick a topic below and we'll sort it out together.",
              "Wah gwaan 🩷 I'm here for cycle, period, and reproductive health questions — what can I help you with today?",
            ]),
      ],
    },

    // ── Self-harm (always first in priority) ───────────────────────────────
    // ── Emergency / urgent symptoms ───────────────────────────────────────
    // High priority — must catch before other health buckets
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
        () => "What you're describing sounds like it could be urgent 🩷 Please don't wait — go to your nearest emergency room or call emergency services (119 in Jamaica) right now.",
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
        () => "I'm not able to diagnose conditions — that takes a proper clinical exam and tests. But I can help you understand your symptoms and what questions to bring to a provider.",
      ],
      forceNext: "DIAGNOSIS_REDIRECT",
    },

    // ── Medication / dosage questions ───────────────────────────────────────
    {
      name: "medication_dosage",
      patterns: [
        /\b(how much|what dose|dosage|mg|milligram|how many (pills?|tablets?))(.*)(ibuprofen|paracetamol|panadol|naproxen|aspirin|metformin|provera|norethisterone|tranexamic|mefenamic|bc pill|contraceptive pill)\b/,
        /\b(ibuprofen|paracetamol|panadol|naproxen|tranexamic|mefenamic|norethisterone|progesterone|estrogen|metformin|provera)\b.{0,40}\b(dose|dosage|how much|how many|take|mg|tablet|pill)\b/,
        /\b(can i take|is it safe to take|should i take|take.*for (cramps?|pain|period|bleeding))\b/,
        /\b(medication|medicine|prescription|prescribed|drug|tablet|capsule|overdose)\b.{0,40}\b(period|cramps?|bleeding|cycle|pain|pms)\b/,
      ],
      replies: [
        () => "Medication advice is something I need to pass to a professional 🩷 I can't tell you dosages or whether something is safe for your specific situation.",
        () => "What I can do: help you understand your symptoms so you know what to ask your doctor or pharmacist.",
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
    // Upgraded from the original self_harm — broader and more compassionate
    {
      name: "mental_health_crisis",
      patterns: [
        /\b(suicide|suicidal|kill myself|end my life|want to die|don't want to be here|dont want to be here|rather be dead|no point living|no reason to live)\b/,
        /\b(self.?harm|cutting myself|hurt myself|burning myself|hurting myself)\b/,
        /\b(i can't do this anymore|cant do this anymore|i give up|can't go on|cant go on|everything is too much|i'm done with everything|im done with everything)\b/,
      ],
      replies: [
        () => "I hear you, and what you're feeling right now matters so much 🩷 You deserve real, caring support.",
        () => "Please reach out — in Jamaica, you can call the Crisis Hotline at 888-NEW-LIFE (888-639-5433) or go to your nearest hospital.",
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
        () => "Bloom takes your privacy seriously — your health data is yours.",
      ],
      forceNext: "PRIVACY_INFO",
    },

    // ── Self harm (kept for backwards compat, now points to CRISIS_SUPPORT)
    {
      name: "self_harm",
      patterns: [/\b(suicide|kill myself|end my life|self harm|self-harm|cut myself|want to die|don't want to be here)\b/],
      replies: [
        () => "I hear you 🩷 Please reach out for support — in Jamaica call 888-639-5433 or go to your nearest hospital.",
      ],
      forceNext: "CRISIS_SUPPORT",
    },

    // ── Sexual content ─────────────────────────────────────────────────────
    {
      name: "sexual_content",
      patterns: [/\b(nudes|send pic|porn|sex video|send me|show me)\b/],
      replies: [
        () => "That's not something I can help with here. If you have a reproductive health question — periods, cramps, spotting, or cycle concerns — I'm happy to help with those 🩷",
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
          "I don't take it personally 🩷 If something's stressing you out — especially anything cycle-related — I'm all ears.",
          "Not gonna argue 😌 but if your body's giving you grief, I can actually help with that.",
          "It's okay — I know this stuff can be frustrating 🩷 What's actually going on?",
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
        () => "If your mood or energy has been off and you think it might be cycle-related, I can help with that. Do the feelings tend to show up around your period?",
      ],
    },

    // ── Relationships ──────────────────────────────────────────────────────
    {
      name: "relationships",
      patterns: [/\b(bf|girlfriend|boyfriend|my man|my girl|cheat|cheating|break up|breakup|situationship|talking stage|he left|she left)\b/],
      replies: [
        () => pick([
          "Relationship stress is real — and honestly it can throw off your whole cycle 🩷 If you've noticed anything shifting (late period, mood changes, spotting), I can help with that.",
          "I'm a cycle assistant, not a relationship coach 😅 but if the stress is messing with your period, tell me what you've noticed and I'll help.",
          "Sounds like a rough time 🩷 I can't weigh in on the relationship drama, but if the stress has your cycle acting up, that's something I can actually help with.",
          "Emotional stress — whether it's a breakup, a situationship, or just life — can genuinely delay or shift your period 🩷 Noticed anything different lately?",
          "Not really a love advice gyal 😄 but cycle disruption from relationship stress is real — if your period's been off, I'm here.",
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
          "Financial stress is no joke — and it can genuinely affect your cycle 🩷 If you've noticed changes (late period, mood shifts), I can help with those.",
          "I can't help with finances, but if money stress has your body acting up, tell me what you've been noticing.",
          "Money stress is one of those things the body feels for real 🩷 If your cycle has been off lately, that connection is worth looking at.",
          "Can't sort out the bills unfortunately 😅 but financial stress affecting your period or mood is genuinely something I can help with.",
          "Broke season hits different 😩 and your hormones feel it too — if your period's been late or your mood has shifted, tell me what's going on.",
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
        () => pick([
          "I can't help with food orders 😄 but if you're getting strong cravings before your period, that's actually a hormonal thing I can talk through with you 🩷",
          "Cravings are real — especially the pre-period chocolate ones 🍫 If they're cycle-related, tap **Hormones / mood changes** and let's dig in.",
          "Not a food delivery service unfortunately 😄 but pre-period cravings? That's fully in my lane — hormones are wild.",
          "Jerk chicken and festival not quite my area 😄 but if the cravings hit hardest around your period, that's progesterone doing its thing — I can explain.",
          "Hungry can mean a lot of things 🩷 If it's that premenstrual 'want to eat everything' feeling, that's hormonal and worth talking about.",
          "Can't sort out your dinner plans 😄 but if the craving situation gets intense around your period, tap **Hormones / mood changes** and let's chat.",
        ]),
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
          "Jamaica sun or Jamaica rain — either way I can't help with the forecast 😄 But if your health is on your mind, I'm here.",
          "Wish I could tell you, but weather's not my area 🩷 Anything cycle or health related, though — you're in the right place.",
          "Not Accuweather 😄 but cycle and symptom support? That I can do. What's going on?",
        ]),
      ],
    },

    // ── Travel ─────────────────────────────────────────────────────────────
    {
      name: "travel",
      patterns: [/\b(travel|flight|airport|hotel|trip|vacation|visa|overseas|abroad)\b/],
      replies: [
        () => "Travel can actually delay your period — timezone changes and disrupted routines affect hormones more than people realize 🩷",
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
          "Not a study buddy, but stress from school or work can genuinely affect your cycle — if you've noticed changes, I can help.",
          "Exams and assignments aren't quite my area 😄 but study stress affecting your period or mood? That I can talk about.",
          "Can't write the assignment for you 😅 but if the pressure has your cycle going haywire, tell me what you've noticed.",
          "School stress is no joke — and it's one of the most common reasons periods go late or moods go sideways 🩷 Is anything shifting for you?",
          "Not a tutor unfortunately 😄 but chronic stress from work or studies can genuinely disrupt your hormones — if that's happening, let's talk.",
        ]),
      ],
    },

    // ── Tech / app issues ──────────────────────────────────────────────────
    {
      name: "tech_general",
      patterns: [/\b(error|bug|crash|not working|broken|glitch|loading|frozen)\b/, /\b(app|button|page|screen)\b/],
      replies: [
        () => "If something in the Bloom app isn't working, that's worth reporting — you can use the feedback option in the menu 🩷",
        () => "If you were actually trying to ask a health question, just type it out and I'll do my best to help.",
      ],
    },

    // ── General non-repro health ───────────────────────────────────────────
    {
      name: "non_repro_health",
      patterns: [/\b(cough|flu|cold|headache|sore throat|stomach bug|rash|allergy|infection|virus|covid)\b/],
      replies: [
        () => "I focus on reproductive and cycle health, so general illness is a bit outside my lane 🩷",
        () => "That said — if you've been sick and your period changed, I can help connect those dots. What's been going on with your cycle?",
      ],
    },

    // ── Sleep ──────────────────────────────────────────────────────────────
    {
      name: "sleep",
      patterns: [/\b(can't sleep|cant sleep|insomnia|sleep|tired all day|exhausted all day|awake all night)\b/],
      replies: [
        () => "Sleep struggles are real — and they can genuinely affect your hormones and cycle 🩷",
        () => "If poor sleep is showing up alongside mood changes or cycle shifts, tap **Hormones / mood changes** and let's look at the full picture.",
      ],
    },

    // ── Weight / body image ────────────────────────────────────────────────
    {
      name: "body_image",
      patterns: [/\b(weight|fat|skinny|body|diet|calories|lose weight|gain weight|body image|bloated all the time)\b/],
      replies: [
        () => "Body changes can be connected to your cycle more than you'd think 🩷",
        () => "If you've noticed weight shifts, bloating, or body changes around your period, tap **Hormones / mood changes** or **Something else** and I'll help.",
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
          "Aww, that warms my heart 🩷 You deserve good care — anything else I can help with?",
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
          "I'm sorry I didn't catch that right 🩷 I'm still learning and I know I have limits — try tapping one of the buttons below.",
          "My bad — I missed what you were getting at 🩷 The buttons below are more reliable than my text understanding right now.",
          "I hear your frustration and I'm sorry 🩷 Try rephrasing what's going on with your body and I'll do my best.",
          "Not always perfect, I know 😕 If you can describe it simply — like 'late period' or 'bad cramps' — I'll follow better.",
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
        () => "I'm not equipped to help with STI diagnosis or treatment — but if you're noticing unusual discharge, pain, or changes, a healthcare provider can check properly.",
        () => "You can use the care map to find a clinic near you.",
      ],
    },

    // ── Contraception questions ────────────────────────────────────────────
    {
      name: "contraception",
      patterns: [/\b(birth control|contraception|pill|depo|iud|implant|condom|plan b|morning after|emergency contraception)\b/],
      replies: [
        () => "Contraception can definitely affect your cycle — especially spotting, period timing, and mood 🩷",
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
        () => "That sounds like a phone or service question — not quite my area 🩷",
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
          "Laughter is good medicine 😄 — but if you've got an actual question about your cycle, I'm here for that too.",
          "The bored season is real 😄 If you want something to actually think about — how's your cycle been lately?",
        ]),
      ],
    },
  ];

  // Health signals that should ALWAYS beat OOS pattern matches.
  // e.g. "me bleed thru me pants lol" has "lol" but the health signal wins.
  const HEALTH_OVERRIDE_PATTERNS = [
    /\b(bleed|bleeding|blood|period|cramp|pain|spot|spotting|late|missed|discharge|pregnant|pregnancy|nausea|dizzy|faint|heavy|clot|pelvic|mood|tired|fatigue|cycle|ovulat)\b/,
  ];

  // Cycle question patterns — checked FIRST before health override
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
  // Resolve choices — can be a plain array OR a function returning an array
  function resolveChoices(node) {
    if (!node) return [];
    const raw = typeof node.choices === "function" ? node.choices() : node.choices;
    return Array.isArray(raw) ? raw : [];
  }

  function matchTypedToChoice(rawText) {
    const node = NODES[ctx.state];
    const choices = resolveChoices(node);
    if (!choices.length) return null;
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

  // ---------------- ROUTER (Phase 2 — inference object) ----------------
  // Instead of scores.late += 2, we build a signal object and reason
  // over combinations before falling back to a single best-intent pick.
  // NOTE: receives already-normalized text. Inference layer in bloomie-inference.js
  // runs BEFORE this — so only inputs that didn't match entities reach here.
  function routeUserText(t) {
    t = String(t || "").toLowerCase();

    // ── Urgency: always first ──────────────────────────────────────────────
    const urgentPhrases = [
      "faint", "passed out", "cant breathe", "can't breathe",
      "shortness of breath", "soaking through", "bleeding through",
    ];
    if (urgentPhrases.some((p) => t.includes(p))) return { next: "HEAVY_URGENT" };

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

    // ── Condition education: Perimenopause ────────────────────────────────
    if (
      /\bperimenopause\b/.test(t) ||
      /peri menopause/.test(t) ||
      (/irregular period/.test(t) && /hot flash/.test(t)) ||
      /my period is changing/.test(t)
    ) return { next: "EDUC_PERIMENOPAUSE" };

    // ── Condition education: Menopause ────────────────────────────────────
    if (
      /\bmenopause\b/.test(t) ||
      /going through the change/.test(t) ||
      /no period for months/.test(t) ||
      /period stopped/.test(t)
    ) return { next: "EDUC_MENOPAUSE" };

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
        const lines = (cat.replies || OOS_DEFAULT).map((r) =>
          typeof r === "function" ? r(t) : r
        );
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
    if (bestIntent === "mood")      return { next: "MOOD_INTRO" };
    if (bestIntent === "pregnancy") return { next: "LATE_TEST_Q" };
    if (bestIntent === "discharge") return { next: "ELSE_DISCHARGE" };
    if (bestIntent === "pelvic") {
      if (t.includes("sex"))        return { next: "PELVIC_SEX_INTRO" };
      return { next: "PELVIC_INTRO" };
    }

    // Late check with cycle data
    if (has("late_check", 2)) return { next: "LATE_PERIOD_CHECK", payload: { reason: "late_check" } };

    // Red flag / should I see a doctor — needs context from lastIntent
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

  function computeTestPlan({ expectedPeriodDate = null, sexDate = null, today = new Date() } = {}) {
    const exp = expectedPeriodDate ? new Date(expectedPeriodDate) : null;
    const sex = sexDate ? new Date(sexDate) : null;
    let primary = null;
    let basis = null;
    if (exp && !Number.isNaN(exp.getTime())) {
      primary = addDays(exp, 1);
      basis = "missed-period";
    } else if (sex && !Number.isNaN(sex.getTime())) {
      primary = addDays(sex, 21);
      basis = "sex+21";
    }
    const retest = primary ? addDays(primary, 2) : null;
    const isPrimaryInPast = primary ? primary <= today : false;
    return { primary, retest, basis, isPrimaryInPast };
  }

  const nowIso = () => new Date().toISOString();

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

  function recordAnswer(q, a) {
    ctx.answers.push({ q, a, t: nowIso() });
  }

  function scrollToBottom() {
    $box.scrollTop = $box.scrollHeight;
  }

  function say(lines, { delayMs = 900 } = {}) {
    const arr = Array.isArray(lines) ? lines : [lines];
    lockUI(true);
    let acc = 0;
    arr.forEach((t, idx) => {
      const step = idx === 0 ? 500 : delayMs;
      acc += step;
      const id = setTimeout(() => {
        pushMsg("bot", t);
        if (idx === arr.length - 1) lockUI(false);
      }, acc);
      ctx.timers.add(id);
    });
  }

  function estimateSayTime(sayValue, delayMs) {
    if (!sayValue) return 0;
    const lines = Array.isArray(sayValue) ? sayValue : [sayValue];
    if (!lines.length) return 0;
    return 500 + Math.max(0, lines.length - 1) * delayMs + 150;
  }

  function askMulti({ question, options, nextOnSubmit, allowNone = true }) {
    ctx.multiDraft = { question, options, selected: new Set(), nextOnSubmit, allowNone };
    render();
  }

  // Helper used by mode nodes to update userMode for the rest of the session
  function applySessionMode(mode) {
    // Just update sessionMode — userMode uses getters derived from effectiveMode()
    // so all checks update automatically without any manual property assignment.
    ctx.sessionMode = mode;
    console.log("[Bloomie] session mode →", mode);
  }

  function transition(nextState, payload = {}) {
    if (!nextState) return;

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

    ctx.state = nextState;
    const node = NODES[nextState];
    if (!node) return;
    // Fire onEnter hook — used by session mode setters and gate nodes
    if (typeof node.onEnter === "function") {
      node.onEnter();
      // Gate nodes (say: []) handle their own redirect inside onEnter — stop here
      if (Array.isArray(node.say) && node.say.length === 0) return;
    }
    clearTimers();
    if (node.say) {
      const lines = typeof node.say === "function" ? node.say(ctx, payload) : node.say;
      say(lines, { delayMs: node.delayMs ?? 1100 });
    }
    if (node.multi) {
      const m = typeof node.multi === "function" ? node.multi(ctx, payload) : node.multi;
      const id = setTimeout(() => askMulti(m), estimateSayTime(node.say, node.delayMs ?? 1100));
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

    const footer = "If symptoms worsen or you feel unsafe, seek urgent care.";
    return [header, ...items, ...structuredParts, footer].join("\n");
  }

  // ── Summary card builder ───────────────────────────────────────────────────
  // Produces an HTML string for the SUMMARY node bubble.
  // All content is internally generated — never interpolates raw user text
  // into HTML without going through escapeHtml().
  function buildSummaryCard() {
    // ── Section 1: What I heard — detected symptoms ───────────────────────
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
        <p class="summary-disclaimer">This is not a diagnosis — it's a record of what we talked about 🩷</p>
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

  function toggleReaction(msgIndex, type) {
    const m = ctx.history[msgIndex];
    if (!m || m.from !== "bot") return;
    m.meta = m.meta || {};
    m.meta.reactions = m.meta.reactions || { up: false, down: false };
    if (type === "up") { m.meta.reactions.up = !m.meta.reactions.up; if (m.meta.reactions.up) m.meta.reactions.down = false; }
    else if (type === "down") { m.meta.reactions.down = !m.meta.reactions.down; if (m.meta.reactions.down) m.meta.reactions.up = false; }
    render();
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
          const rx = m?.meta?.reactions || { up: false, down: false };
          const showReactions = isBot && i === lastBotIndex;
          return `
            <div class="msg ${m.from}">
              <div class="bubble${m.meta?.html ? " bubble--html" : ""}">${m.meta?.html ? m.text : escapeHtml(m.text)}</div>
              ${showReactions ? `
                <div class="bubble-actions" aria-label="Message reactions">
                  <button class="react-btn ${rx.up ? "on" : ""}" data-react="up" data-idx="${i}" type="button" title="Helpful">👍</button>
                  <button class="react-btn ${rx.down ? "on" : ""}" data-react="down" data-idx="${i}" type="button" title="Not helpful">👎</button>
                </div>` : ""}
            </div>`;
        }).join("")}
      </div>`;

    $box.querySelectorAll("[data-react][data-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (ctx.locked) return;
        toggleReaction(Number(btn.getAttribute("data-idx")), btn.getAttribute("data-react"));
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
    if (_choices.length) {
      choicesEl.innerHTML = `
        <div class="quick-replies">
          ${_choices.map((c) => `
            <button class="reply ${c.primary ? "reply--primary" : ""}" data-choice="${escapeAttr(c.id)}" type="button">
              ${escapeHtml(c.label)}
            </button>`).join("")}
        </div>`;

      choicesEl.querySelectorAll("button[data-choice]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (ctx.locked) return;
          const choiceId = btn.getAttribute("data-choice");
          const choice = _choices.find((x) => x.id === choiceId);
          if (!choice) return;
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
  // e.g. "Last time we talked, you mentioned a missed period and nausea —
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

    return `Last time we talked, you mentioned **${list}** — is that still going on, or is something new coming up?`;
  }

  // Mode-aware intro — Bloomie greets differently based on what she knows about the user
  function buildIntro() {
    const base   = `${greet()} I'm Bloomie, Bloom's health assistant 🌸`;
    const recall = buildRecallLine();
    // Appends the recall line (if any) after the core intro messages.
    const r = (lines) => recall ? [...lines, recall] : lines;

    if (userMode.isPregnancy && cd.lmp) {
      const weeksAlong = Math.floor(daysBetween(cd.lmp, new Date()) / 7);
      return r([
        base,
        `I can see you're in pregnancy tracking mode${weeksAlong > 0 ? ` — you're around ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along` : ""} 🩷`,
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
        "I can see you're in postpartum mode 🩷 Your cycle may behave differently for a while — that's completely normal.",
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
        { id: "heavy", label: "Heavy or unusual bleeding", next: "HEAVY_INTRO" },
        { id: "late", label: "Late or missed period", next: "LATE_INTRO" },
        { id: "spot", label: "Spotting in between periods", next: "SPOT_INTRO" },
        { id: "mood", label: "Hormones / mood changes", next: "MOOD_INTRO" },
        { id: "pelvic", label: "Pelvic pain or cramps", next: "PELVIC_INTRO" },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
      ],
    },

    // Silent menu — no intro replay, just shows the choices again
    START_MENU: {
      choices() {
        const base = (() => {
          // Pregnancy mode — swap in pregnancy-relevant buttons
          if (userMode.isPregnancy) {
            return [
              { id: "edd",   label: "My due date / how far along", next: "CYCLE_EDD_ANSWER", primary: true },
              { id: "bleed", label: "Bleeding or spotting", next: "HEAVY_INTRO" },
              { id: "pain",  label: "Pelvic pain or cramps", next: "PELVIC_INTRO" },
              { id: "mood",  label: "Mood or energy changes", next: "MOOD_INTRO" },
              { id: "test",  label: "Pregnancy test timing", next: "CYCLE_TEST_TIMING" },
              { id: "else",  label: "Something else", next: "ELSE_INTRO" },
            ];
          }
          // TTC mode — ovulation-first layout
          if (userMode.isTTC) {
            return [
              { id: "ovul",  label: "My ovulation window", next: "TTC_INTRO", primary: true },
              { id: "test",  label: "When should I test?", next: "CYCLE_TEST_TIMING" },
              { id: "late",  label: "My period is late", next: "LATE_INTRO" },
              { id: "spot",  label: "Spotting or unusual bleeding", next: "SPOT_INTRO" },
              { id: "mood",  label: "Hormones / mood changes", next: "MOOD_INTRO" },
              { id: "else",  label: "Something else", next: "ELSE_INTRO" },
            ];
          }
          // Postpartum mode
          if (userMode.isPostpartum) {
            return [
              { id: "post",  label: "Postpartum concerns", next: "POSTPARTUM_INTRO", primary: true },
              { id: "bleed", label: "Bleeding questions", next: "HEAVY_INTRO" },
              { id: "mood",  label: "Mood or energy changes", next: "MOOD_INTRO" },
              { id: "late",  label: "Period hasn't returned yet", next: "LATE_INTRO" },
              { id: "pain",  label: "Pelvic pain or cramps", next: "PELVIC_INTRO" },
              { id: "else",  label: "Something else", next: "ELSE_INTRO" },
            ];
          }
          // Default — cycle tracking or browsing
          return [
            { id: "heavy", label: "Heavy or unusual bleeding", next: "HEAVY_INTRO" },
            { id: "late",  label: "Late or missed period", next: "LATE_INTRO" },
            { id: "spot",  label: "Spotting in between periods", next: "SPOT_INTRO" },
            { id: "mood",  label: "Hormones / mood changes", next: "MOOD_INTRO" },
            { id: "pelvic",label: "Pelvic pain or cramps", next: "PELVIC_INTRO" },
            { id: "else",  label: "Something else", next: "ELSE_INTRO" },
          ];
        })();
        return [...base, { id: "summary", label: "Get summary", next: "SUMMARY" }];
      },
    },

    // ── Zero-confidence narrowing ──────────────────────────────────────────
    // Reached when the input contains health-adjacent words but neither
    // inferRoute nor the keyword router could resolve a specific topic.
    // Presents topic buttons instead of a generic OOS reply.
    NARROWING: {
      say: "I want to make sure I help you with the right thing 🩷 Are you asking about bleeding, pain, your cycle timing, mood changes, or something else?",
      choices: [
        { id: "heavy", label: "Bleeding",       next: "HEAVY_INTRO" },
        { id: "pain",  label: "Pain or cramps", next: "PELVIC_INTRO" },
        { id: "cycle", label: "Cycle timing",   next: "LATE_INTRO" },
        { id: "mood",  label: "Mood changes",   next: "MOOD_INTRO" },
        { id: "else",  label: "Something else", next: "ELSE_INTRO" },
      ],
    },

    /* ---------------- HEAVY OR UNUSUAL BLEEDING ---------------- */
    HEAVY_INTRO: {
      say() {
        return [
          `${ack("Heavy bleeding can feel a lot, and wanting clarity makes sense")} 🩷`,
          "Some people naturally have heavier days — especially at the start. But there are a few signs worth checking sooner rather than later.",
          "During your heaviest hours, are you soaking through a pad or tampon in about 2 hours or less?",
        ];
      },
      question: "Soaking through a pad/tampon in ~2 hours or less?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_SOAK_YES", primary: true },
        { id: "no", label: "No", next: "HEAVY_SOAK_NO" },
        { id: "ns", label: "Not sure", next: "HEAVY_SOAK_NOTSURE" },
      ],
    },
    HEAVY_SOAK_YES: {
      say: [
        "Thanks — that helps 🩷",
        "Soaking through products that quickly isn't typical for most periods.",
        "Has this been happening for 2 hours or more in a row?",
      ],
      question: "Soaking that quickly for 2+ hours in a row?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_RISK_SYMPTOMS", primary: true },
        { id: "no", label: "No", next: "HEAVY_DURATION_CHECK" },
        { id: "ns", label: "Not sure", next: "HEAVY_DURATION_CHECK" },
      ],
    },
    HEAVY_RISK_SYMPTOMS: {
      say: [
        "Thanks for letting me know 🩷",
        "Bleeding that heavy can sometimes lead to dizziness, weakness, or low iron — and you deserve to feel safe while this is happening.",
        "Let's check how you're feeling right now.",
      ],
      multi: {
        question: "Are you feeling any of these right now? (select any)",
        options: ["Dizziness or faintness", "Shortness of breath", "Heart racing / feeling weak", "Severe cramps", "None of these"],
        nextOnSubmit: "HEAVY_RISK_GUIDANCE",
        allowNone: false,
      },
    },
    HEAVY_RISK_GUIDANCE: {
      autoNext(_ctx, payload) {
        const sel = payload.multi || [];
        return sel.length && !sel.includes("None of these") ? "HEAVY_URGENT" : "HEAVY_SOON";
      },
    },
    HEAVY_URGENT: {
      say: [
        "Based on what you've shared, it would be a good idea to seek medical care as soon as you can 🩷",
        "Not because I want to scare you — but because heavy bleeding plus symptoms like dizziness or shortness of breath can mean your body needs support (fluids, monitoring, or treatment).",
        "If you can, consider contacting a doctor, clinic, urgent care, or emergency service.",
        "You can also use the care map to find nearby clinics/gynecologists/family planning services.",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "HEAVY_AFTER_CARE", action: "OPEN_MAP", primary: true },
        { id: "sum", label: "Help me summarize", next: "HEAVY_AFTER_CARE", action: "REQUEST_PDF" },
        { id: "menu", label: "Back to main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    HEAVY_SOON: {
      say: [
        "Thanks for answering 🩷",
        "Even without those symptoms right now, bleeding that heavy for multiple hours is worth getting checked — especially if it's new for you or keeps happening.",
        "If you can, take it easy, hydrate, and keep an eye out for dizziness, weakness, or worsening cramps.",
        "Want to use the care map or get a quick summary you can share with a provider?",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "HEAVY_AFTER_CARE", action: "OPEN_MAP", primary: true },
        { id: "sum", label: "Help me summarize", next: "HEAVY_AFTER_CARE", action: "REQUEST_PDF" },
        { id: "menu", label: "Back to main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    HEAVY_SOAK_NO: {
      say: [
        "Okay — that's helpful to know 🩷",
        "Some heavier bleeding can still be normal depending on how long it lasts and whether it's changing from your usual pattern.",
        "Has the heavy bleeding lasted more than 7 days this cycle?",
      ],
      question: "Heavy bleeding lasted more than 7 days this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_LONGER_THAN_WEEK", primary: true },
        { id: "no", label: "No", next: "HEAVY_HEAVIER_THAN_USUAL" },
        { id: "ns", label: "Not sure", next: "HEAVY_HEAVIER_THAN_USUAL" },
      ],
    },
    HEAVY_SOAK_NOTSURE: {
      say: [
        "That's okay 🩷",
        "If it helps: 'soaking through' usually means the pad/tampon is fully saturated and you have to change it — not just a little spotting or discomfort.",
        "Has the heavy bleeding lasted more than 7 days this cycle?",
      ],
      question: "Heavy bleeding lasted more than 7 days this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_LONGER_THAN_WEEK", primary: true },
        { id: "no", label: "No", next: "HEAVY_HEAVIER_THAN_USUAL" },
        { id: "ns", label: "Not sure", next: "HEAVY_HEAVIER_THAN_USUAL" },
      ],
    },
    HEAVY_DURATION_CHECK: {
      say: [
        "Got it — thanks 🩷",
        "Even if it wasn't 2+ hours in a row, duration still matters.",
        "Has the heavy bleeding lasted more than 7 days this cycle?",
      ],
      question: "Heavy bleeding lasted more than 7 days this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_LONGER_THAN_WEEK", primary: true },
        { id: "no", label: "No", next: "HEAVY_HEAVIER_THAN_USUAL" },
        { id: "ns", label: "Not sure", next: "HEAVY_HEAVIER_THAN_USUAL" },
      ],
    },
    HEAVY_LONGER_THAN_WEEK: {
      say: [
        "Thanks for sharing 🩷",
        "Bleeding that lasts longer than a week can sometimes mean your cycle is a bit out of balance, or that your body is having trouble 'wrapping up' the period.",
        "Is this heavier or longer than what's normal for you?",
      ],
      question: "Heavier/longer than normal for you?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_TRACK_PROVIDER", primary: true },
        { id: "no", label: "No", next: "HEAVY_TRACK_PROVIDER" },
        { id: "ns", label: "Not sure", next: "HEAVY_TRACK_PROVIDER" },
      ],
    },
    HEAVY_HEAVIER_THAN_USUAL: {
      say: ["Got it 🩷", "Is this bleeding heavier than what's normal for you, or about the same as usual?"],
      question: "Heavier than usual?",
      choices: [
        { id: "yes", label: "Yes", next: "HEAVY_TRACK_PROVIDER", primary: true },
        { id: "no", label: "No", next: "HEAVY_ALL_NO_ENDING" },
        { id: "ns", label: "Not sure", next: "HEAVY_TRACK_PROVIDER" },
      ],
    },
    HEAVY_TRACK_PROVIDER: {
      say: [
        "Thanks for sharing 🩷",
        "If your bleeding is heavier/longer than your normal, or keeps repeating across cycles, it may be worth discussing with a healthcare provider.",
        "That doesn't automatically mean something is wrong — it just means your body might need a closer look and some support.",
        "If you want, I can help summarize what you've noticed so it's easier to explain at a visit.",
      ],
      choices: [
        { id: "sum", label: "Help me summarize", next: "HEAVY_AFTER_SUMMARY", action: "REQUEST_PDF", primary: true },
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP" },
        { id: "ok", label: "I'm okay for now", next: "START_MENU" },
      ],
    },
    HEAVY_ALL_NO_ENDING: {
      say: [
        "Thanks for answering 🩷",
        "Based on what you've shared, your flow sounds within the range of what can be normal for many menstrual cycles.",
        "Some people naturally have heavier days early in their period, especially with mild cramps or small clots.",
        "As long as you're not having signs like dizziness, severe pain, or bleeding that lasts a long time, this usually isn't a cause for concern.",
        "It can still be helpful to:\n• Track how heavy your flow is each day\n• Note how long your period lasts\n• Watch for changes from cycle to cycle",
        "If anything changes — heavier bleeding, longer duration, new dizziness/weakness — you can check back in or consider speaking with a healthcare provider.",
        "Is there anything else you'd like help with today?",
      ],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
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
      say: ["Okay 🩷 Let's figure out the safest time to take a pregnancy test.", "Do you know your expected period date?"],
      choices: [
        { id: "yes", label: "Yes (I know the expected period date)", next: "TEST_EXPECTED_DATE", primary: true },
        { id: "no", label: "No / irregular / not sure", next: "TEST_SEX_DATE" },
        { id: "menu", label: "Back to main options", next: "START_MENU" },
      ],
    },
    TEST_EXPECTED_DATE: {
      say: ["Got you 🩷", "Type your expected period date like: 2026-02-08 (YYYY-MM-DD)."],
      autoNext(ctx) {
        ctx.capture = { kind: "expectedPeriodDate", next: "TEST_SHOW_PLAN" };
        return null;
      },
    },
    TEST_SEX_DATE: {
      say: [
        "No problem 🩷",
        "If you don't know when your period is due, a practical rule is: test **21 days after unprotected sex**.",
        "Type the unprotected sex date like: 2026-02-03 (YYYY-MM-DD).",
      ],
      autoNext(ctx) {
        ctx.capture = { kind: "sexDate", next: "TEST_SHOW_PLAN" };
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
          const retestDate = addDays(new Date(), 3); // retest 3 days from today
          return [
            `${ack()} That recommended test date has already passed — so you can test **today** 🩷`,
            "First morning urine gives the clearest result.",
            `If it comes back negative but your period still hasn't arrived, retest again around **${fmtDate(retestDate)}** (48–72 hours from now).`,
            ...urgentFooter(),
          ];
        }

        const primaryLine = plan.basis === "missed-period"
          ? `✅ Best time to test: **${fmtDate(plan.primary)}** — the day after your expected period.`
          : `✅ Best time to test: **${fmtDate(plan.primary)}** — 21 days after unprotected sex.`;

        return [
          `${ack()} 🩷`,
          primaryLine,
          "Testing earlier can give a false negative — the hormone levels need time to build.",
          `If the result is negative but your period still doesn't come, retest in **48–72 hours** (around **${fmtDate(plan.retest)}**).`,
          ...urgentFooter(),
        ];
      },
      choices: [
        { id: "late",    label: "My period is late too",   next: "LATE_INTRO", primary: true },
        { id: "log",     label: "Log that I tested today", next: "TEST_SHOW_PLAN_LOGGED",
          action: "LOG_SYMPTOM", logData: { type: "pregnancy_test", note: "Test taken — result pending" } },
        { id: "menu",    label: "Main options",            next: "START_MENU" },
        { id: "done",    label: "I'm done for now",       next: "CLOSE" },
      ],
    },

    // After logging a test — detect retest timing
    TEST_SHOW_PLAN_LOGGED: {
      say() {
        const retestDate = addDays(new Date(), 3);
        return [
          "Logged 🩷",
          `If today's test was negative, the best time to retest is around **${fmtDate(retestDate)}** — 48–72 hours from now, ideally first morning urine.`,
          "A second negative at that point is more reliable.",
        ];
      },
      choices: [
        { id: "late", label: "My period is still late", next: "LATE_INTRO", primary: true },
        { id: "menu", label: "Main options",             next: "START_MENU" },
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
        "I hear you 🩷 This is a space where you can talk — without judgment.",
        "What kind of support are you looking for right now?",
      ],
      choices: [
        { id: "decision",  label: "I'm still deciding what to do",         next: "ABORTION_DECISION_SUPPORT", primary: true },
        { id: "after",     label: "I already took something / I need help", next: "ABORTION_AFTERCARE_CHECK" },
        { id: "pregnant",  label: "I'm pregnant but not sure I want to be", next: "ABORTION_HONEST_CONTEXT" },
        { id: "privacy",   label: "Privacy first — before anything else",  next: "ABORTION_PRIVACY" },
        { id: "menu",      label: "Actually it's something else",          next: "START_MENU" },
      ],
    },

    // Honest legal context — doesn't shame, doesn't lie, doesn't advise
    ABORTION_HONEST_CONTEXT: {
      say: [
        "I want to be honest with you because you deserve honesty 🩷",
        "In Jamaica, abortion is currently illegal under the Offences Against the Person Act. There are no formal legal exceptions — not even for rape or incest.",
        "This means there is no safe, legal clinical option available in-country right now.",
        "I can't tell you what to do, and I won't pretend the situation isn't hard.",
        "What I can do is help you think through your options, your safety, and how to access non-judgmental support — confidentially.",
      ],
      choices: [
        { id: "options",   label: "Talk through my options",              next: "ABORTION_DECISION_SUPPORT", primary: true },
        { id: "safe",      label: "What do I need to know to stay safe?", next: "ABORTION_SAFETY_INFO" },
        { id: "counsel",   label: "I want someone to talk to",            next: "ABORTION_RESOURCES" },
        { id: "privacy",   label: "Privacy — how to protect myself",      next: "ABORTION_PRIVACY" },
      ],
    },

    // Non-directive decision support — presents all options without steering
    ABORTION_DECISION_SUPPORT: {
      say: [
        "You're not alone in this, and there's no right answer — only what's right for you 🩷",
        "People in this situation generally face three paths: continuing the pregnancy (with support or adoption), or ending it.",
        "Because of Jamaica's laws, ending a pregnancy carries serious legal and medical risk. There are no safe, legal clinical services in-country.",
        "Some people travel to access services in countries where it is legal. Others seek confidential counselling to help make a decision.",
        "Non-directive pregnancy counselling — where someone listens without pushing an agenda — exists and is confidential. Would you like help finding it?",
      ],
      choices: [
        { id: "counsel",  label: "Yes — find me confidential support",   next: "ABORTION_RESOURCES", primary: true },
        { id: "safe",     label: "I need to know about staying safe",     next: "ABORTION_SAFETY_INFO" },
        { id: "privacy",  label: "Help me protect my privacy first",      next: "ABORTION_PRIVACY" },
        { id: "after",    label: "I've already taken something",          next: "ABORTION_AFTERCARE_CHECK" },
        { id: "menu",     label: "Back to main options",                  next: "START_MENU" },
      ],
    },

    // Safety information — harm reduction without method instruction
    ABORTION_SAFETY_INFO: {
      say: [
        "Your safety matters most 🩷 I can share what signs to watch for — not instructions.",
        "If you or someone you know has taken something or had a procedure, these are the warning signs that mean you need emergency care immediately:",
        "🚨 Heavy bleeding soaking 2+ pads per hour for 2+ hours in a row",
        "🚨 Severe abdominal pain that doesn't ease",
        "🚨 Fever lasting more than 24 hours, or any fever with chills",
        "🚨 Foul-smelling discharge",
        "🚨 Dizziness, fainting, or feeling unable to stand",
        "If any of these happen — go to the emergency room. You can say you are having a miscarriage. Emergency departments are required to treat you regardless of how the pregnancy ended.",
        ...urgentFooter(),
      ],
      choices: [
        { id: "checkme",  label: "I have some of those symptoms",    next: "ABORTION_AFTERCARE_CHECK", primary: true },
        { id: "counsel",  label: "I need someone to talk to",        next: "ABORTION_RESOURCES" },
        { id: "privacy",  label: "How do I protect my privacy?",     next: "ABORTION_PRIVACY" },
        { id: "map",      label: "Find emergency care near me",      next: "CLOSE", action: "OPEN_MAP" },
      ],
    },

    // Aftercare safety check — for those who've already acted
    ABORTION_AFTERCARE_CHECK: {
      say: [
        `${ack()} Your safety is the priority right now 🩷`,
        "Are you having any of these right now? Select any that apply.",
      ],
      multi: {
        question: "Warning signs — select any:",
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
        "When you arrive, you can say you are having a miscarriage — this is medically accurate and emergency rooms are required to treat you without asking for the cause.",
        "You do not have to explain anything beyond your symptoms.",
      ],
      choices: [
        { id: "map",  label: "Find emergency care now", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main options",            next: "START_MENU" },
      ],
    },

    ABORTION_MONITORING: {
      say: [
        "Okay — none of the urgent warning signs right now 🩷",
        "Keep monitoring yourself over the next few days. Watch for: increasing pain, fever, heavy bleeding that starts or worsens, or anything that feels wrong.",
        "If any of those things start — treat it as urgent and go to emergency care.",
        "Would you like to connect with confidential support?",
        ...urgentFooter(),
      ],
      choices: [
        { id: "counsel",  label: "Yes, I want confidential support",   next: "ABORTION_RESOURCES", primary: true },
        { id: "privacy",  label: "Help me protect my privacy",         next: "ABORTION_PRIVACY" },
        { id: "menu",     label: "Main options",                       next: "START_MENU" },
      ],
    },

    // Privacy — practical screen/data protection guidance
    ABORTION_PRIVACY: {
      say: [
        "Privacy is real and valid — here's what you can do 🩷",
        "• Clear your chat: use the reset option in Bloomie settings if available, or close the browser tab",
        "• If someone shares your device: use an incognito/private browser window",
        "• When contacting organisations: use a number they don't know, or a messaging app with disappearing messages",
        "• What to say: 'I need confidential pregnancy options support. How do you handle privacy?'",
        "• Ask any service before sharing: 'Is this fully confidential?' — you have the right to ask.",
      ],
      choices: [
        { id: "counsel",  label: "Show confidential support options",  next: "ABORTION_RESOURCES", primary: true },
        { id: "safe",     label: "What should I watch for healthwise?",next: "ABORTION_SAFETY_INFO" },
        { id: "menu",     label: "Main options",                       next: "START_MENU" },
      ],
    },

    // Resources — confidential orgs operating in Jamaica
    ABORTION_RESOURCES: {
      say: [
        "Here are organisations that provide confidential, non-judgmental support 🩷",
        "• **FAMPLAN (Jamaica Family Planning Association)** — sexual & reproductive health counselling, islandwide. famplanjamaica.org",
        "• **Jamaica Pregnancy Resource Centre (Montego Bay)** — counselling and options support.",
        "• **Caribbean Family Planning Affiliation (CFPA)** — regional, provides referrals and telehealth options.",
        "• **International Planned Parenthood Federation (IPPF)** — can help with information about accessing services in other countries confidentially. ippf.org",
        "When you contact them, you don't have to share any details upfront — just say you need confidential pregnancy support.",
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
        "Here's what you can say — keep it simple until you know they're trustworthy 🩷",
        "📞 *'Hi, I need confidential pregnancy options support. Can you tell me how your privacy policy works before I share anything?'*",
        "If they ask for details before answering that — hang up and try somewhere else.",
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
          `${ack()} A late or missed period can be really stressful — especially when your body usually feels predictable 🩷`,
          "Cycles shift for all kinds of reasons: stress, travel, illness, weight changes, or just natural variation.",
          "Let's take it step by step.",
          "Is your period more than 7 days later than you usually expect it to be?",
        ];
      },
      question: "Period > 7 days late?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_YES_PREG", primary: true },
        { id: "no", label: "No", next: "LATE_NO_GUIDANCE" },
        { id: "ns", label: "Not sure", next: "LATE_NO_GUIDANCE" },
      ],
    },
    LATE_NO_GUIDANCE: {
      say: [
        "Okay 🩷 A few days of variation can be completely normal — even in people who are usually very regular.",
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
    LATE_YES_PREG: {
      say() {
        // TTC mode — reframe as potentially good news
        if (userMode.isTTC) {
          return [
            "Thanks for letting me know 🩷",
            "Since you're in trying-to-conceive mode, a late period is definitely worth paying attention to.",
            "Is there any chance this could be a positive result?",
          ];
        }
        // Pregnancy tracking — they're already pregnant, late period doesn't apply
        if (userMode.isPregnancy) {
          return [
            "Since you're already in pregnancy tracking mode, a missed period is expected 🩷",
            "Are you noticing other symptoms you want to talk through?",
          ];
        }
        return [
          `${ack()} Pregnancy is one of the most common reasons for a late period — worth checking rather than worrying in silence 🩷`,
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
        "If there's any chance, taking a pregnancy test can help reduce uncertainty — especially if your period doesn't arrive in the next few days.",
        "While we're here, have you experienced any major changes recently? (stress, illness, travel, intense exercise, or weight changes)",
      ],
      question: "Major changes recently?",
      choices: [
        { id: "yes", label: "Yes", next: "LATE_CHANGES_EXPLAIN", primary: true },
        { id: "no", label: "No", next: "LATE_SYMPTOMS_Q" },
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
        "Changes like stress, illness, or shifts in routine can affect hormone levels and delay ovulation — which can push your period later than usual.",
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
        "",
        "If late or missed periods happen often — especially along with symptoms like acne, increased facial/body hair, weight changes, or ongoing mood shifts — some people choose to ask a healthcare provider about possible hormonal imbalances.",
        "That doesn't mean anything is 'wrong' — just that your hormones may need a closer look.",
        "",
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
          `${ack()} Spotting can feel confusing — especially when it shows up out of nowhere 🩷`,
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
        "Light spotting at the very start or end of a period can be normal for many people — sometimes it's just your uterus finishing up.",
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
        "Sometimes spotting is so light that it's hard to place in the cycle — especially if your period isn't super regular.",
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
        "It's usually light and short — but we'll still check a few details to be safe.",
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
        "Spotting that lasts more than a couple days — or feels heavier than expected — is worth paying attention to.",
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
      say: ["Okay 👍🏽", "Even without other symptoms, spotting can be useful information — especially if it becomes a pattern.", "Has this type of spotting happened more than once in recent cycles?"],
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
        "If there's any chance of pregnancy, a test can help give clarity — especially if your period is late or your symptoms feel different than usual.",
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
        "Hormonal birth control changes can cause spotting while your body recalibrates — especially in the first 1–3 months.",
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
        "Tracking helps you catch patterns early — and it also makes it easier to explain if you ever decide to see a provider.",
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
    MOOD_INTRO: {
      say() {
        if (userMode.isPregnancy) {
          return [
            "Mood changes in pregnancy are incredibly common — hormones are doing a lot 🩷",
            "Do the mood shifts feel more like anxiety, sadness, irritability, or fatigue?",
          ];
        }
        if (userMode.isPostpartum) {
          return [
            "Postpartum mood changes are really common and really valid 🩷",
            "Your hormones are recalibrating, especially if you're breastfeeding or your period hasn't returned yet.",
            "Are these feelings mostly low mood, anxiety, exhaustion, or a mix?",
          ];
        }
        if (userMode.isTTC) {
          return [
            "Thanks for sharing this with me 🩷",
            "Mood shifts are real in any cycle — and the emotional weight of TTC can make them feel even more intense.",
            "Do these mood changes usually show up around your period or in the days before it starts?",
          ];
        }
        return [
          "Thanks for sharing this with me 🩷",
          "Mood shifts around your cycle are so real and they can affect emotions, energy, focus, patience… even how social you feel.",
          "You're not being \"dramatic\" or \"too sensitive\" — hormones can genuinely change how your body and brain respond to stress.",
          "Do these mood changes usually show up around your period or in the days before it starts?",
        ];
      },
      question: "Mood changes around/before period?",
      choices: [
        { id: "yes", label: "Yes", next: "MOOD_SEVERITY", primary: true },
        { id: "no", label: "No", next: "MOOD_TIMING_ALT" },
        { id: "ns", label: "Not sure", next: "MOOD_TIMING_HELP" },
      ],
    },
    MOOD_TIMING_HELP: {
      say: [
        "That's okay 🩷 Sometimes it's hard to connect the dots until you track it for a bit.",
        "If it helps: many people notice mood shifts 3–7 days before bleeding starts, or right at the start of day 1–2.",
        "Would you say it's closer to before, during, or random/anytime?",
      ],
      question: "Mood timing guess",
      choices: [
        { id: "before", label: "Mostly before my period", next: "MOOD_SEVERITY", primary: true },
        { id: "during", label: "Mostly during my period", next: "MOOD_SEVERITY" },
        { id: "random", label: "It feels random / not cycle-linked", next: "MOOD_SEVERITY" },
      ],
    },
    MOOD_TIMING_ALT: {
      say: ["Got you 🩷", "If it's not clearly linked to your period, that doesn't make it any less valid.", "Let's still check the intensity and how it's affecting you — that usually gives the best clue for next steps."],
      autoNext: () => "MOOD_SEVERITY",
    },
    MOOD_SEVERITY: {
      say: ["Okay 🩷", "How intense does it feel most of the time?", "Pick the option that matches your real life, not what you think you \"should\" be able to handle."],
      question: "Mood change severity",
      choices: [
        { id: "mild", label: "Mild (noticeable but manageable)", next: "MOOD_IMPACT", primary: true },
        { id: "mod", label: "Moderate (affects my day sometimes)", next: "MOOD_IMPACT" },
        { id: "sev", label: "Severe (hard to function normally)", next: "MOOD_IMPACT" },
      ],
    },
    MOOD_IMPACT: {
      say: ["Thank you — that helps me understand 🩷", "When it hits, is it interfering with your daily life (school/work, relationships, appetite, sleep, motivation, or basic self-care)?"],
      question: "Mood interfering with daily life?",
      choices: [
        { id: "yes", label: "Yes", next: "MOOD_SYMPTOMS_MULTI", primary: true },
        { id: "no", label: "No", next: "MOOD_SYMPTOMS_MULTI" },
      ],
    },
    MOOD_SYMPTOMS_MULTI: {
      say: ["Okay 🩷", "Sometimes naming the type of mood shift makes it easier to spot patterns (and easier to explain if you ever talk to a provider)."],
      multi: {
        question: "Which ones feel most like you lately? (select any)",
        options: ["Irritability / short temper", "Anxiety / overthinking", "Low mood / sadness", "Feeling overwhelmed or teary", "Fatigue / low energy", "Trouble sleeping", "Cravings or appetite changes", "None of these"],
        nextOnSubmit: "MOOD_DURATION",
        allowNone: false,
      },
    },
    MOOD_DURATION: {
      say: ["Thanks for sharing 🩷", "Last thing: how long does it usually last when it starts?", "This helps separate a short PMS window from something more persistent."],
      question: "Mood duration pattern",
      choices: [
        { id: "few", label: "A few days or less", next: "MOOD_GUIDE", primary: true },
        { id: "week", label: "About a week", next: "MOOD_GUIDE" },
        { id: "most", label: "Most of the cycle", next: "MOOD_GUIDE" },
        { id: "ns", label: "Not sure", next: "MOOD_GUIDE" },
      ],
    },
    MOOD_GUIDE: {
      say: [
        "Thank you for being open with me 🩷",
        "Based on what you've shared, this sounds like hormone-linked mood shifts could be playing a role — and you're not imagining it.",
        "I can't diagnose anything, but I can help you with practical next steps depending on how intense it feels for you.",
        "",
        "A few gentle supports that can help many people:",
        "• Sleep + food consistency (even small improvements help)\n• Hydration + a little movement\n• Lowering stress load around the rough days if possible\n• Tracking: mood (1–10), sleep, cramps, and cycle day",
        "",
        "If your mood changes feel severe, last most of the cycle, or are interfering with daily life, it may really help to speak with a healthcare provider or mental health professional — not because you're \"weak\", but because you deserve support.",
        "Would you like to go back to the main options, or talk through one more detail (like triggers or what helps you cope)?",
        ...safeFooter(),
      ],
      choices: [
        { id: "menu", label: "Main options",         next: "START_MENU", primary: true },
        { id: "log",  label: "Log mood symptom",     next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "mood", note: "Mood changes logged from Bloomie chat" } },
        { id: "else", label: "Keep talking",         next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now",     next: "CLOSE" },
      ],
    },

    /* ---------------- PELVIC PAIN / CRAMPS ---------------- */
    PELVIC_INTRO: {
      say() {
        return [
          `${ack()} Pelvic pain can show up in so many ways — dull, sharp, crampy, one-sided — and honestly it can be exhausting to just live with it 🩷`,
          "When does it usually happen?",
        ];
      },
      question: "Timing of pelvic pain",
      choices: [
        { id: "period", label: "Mostly during my period", next: "PELVIC_SEVERITY", primary: true },
        { id: "before", label: "Before my period", next: "PELVIC_SEVERITY" },
        { id: "any", label: "Any time / random", next: "PELVIC_SEVERITY" },
        { id: "sex", label: "During or after sex", next: "PELVIC_SEX_INTRO" },
      ],
    },
    PELVIC_SEVERITY: {
      say() {
        return [
          `${ack()} How intense does the pain usually feel?`,
          "Go with what actually matches your experience — not what you think you should tolerate.",
        ];
      },
      question: "Pelvic pain severity",
      choices: [
        { id: "mild", label: "Mild (uncomfortable but manageable)", next: "PELVIC_IMPACT", primary: true },
        { id: "mod", label: "Moderate (affects my day sometimes)", next: "PELVIC_IMPACT" },
        { id: "sev", label: "Severe (hard to function)", next: "PELVIC_IMPACT" },
      ],
    },
    PELVIC_IMPACT: {
      say: ["Thanks for being honest 🩷", "Is this pelvic pain interfering with your daily life — like school/work, sleep, movement, or relationships?"],
      question: "Pelvic pain interfering with life?",
      choices: [
        { id: "yes", label: "Yes", next: "PELVIC_RESPONSE", primary: true },
        { id: "no", label: "No", next: "PELVIC_RESPONSE" },
      ],
    },
    PELVIC_RESPONSE: {
      say: ["One more important check 🩷", "Does the pain usually improve with rest, heat, or over-the-counter pain relief?"],
      question: "Pain improves with relief?",
      choices: [
        { id: "yes", label: "Yes", next: "PELVIC_MANAGEABLE" },
        { id: "no", label: "No", next: "PELVIC_PERSISTENT", primary: true },
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
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },
    PELVIC_PERSISTENT: {
      say: [
        "Thanks for sharing that 🩷",
        "Pelvic pain that is persistent, severe, or doesn't respond well to relief deserves attention — not because something is 'wrong', but because pain shouldn't be dismissed.",
        "",
        "Some people with ongoing pelvic pain later learn it's related to underlying causes (such as endometriosis), which only a healthcare provider can properly evaluate.",
        "I can't diagnose anything — but noticing these patterns is an important step toward getting the right support.",
        ...safeFooter(),
      ],
      choices: [
        { id: "map", label: "Find care near me",    next: "START", action: "OPEN_MAP", primary: true },
        { id: "log", label: "Log pelvic pain",      next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "pelvic_pain", note: "Pelvic pain logged from Bloomie chat" } },
        { id: "sum", label: "Help me summarize",    next: "PELVIC_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: "Main options",        next: "START_MENU" },
      ],
    },
    PELVIC_SEX_INTRO: {
      say: [
        "Thanks for trusting me with this 🩷",
        "Pain during or after sex is more common than people talk about — and it's never something you're expected to just 'push through'.",
        "Does the pain feel like tightness, burning, sharp pain, or deep pressure?",
      ],
      question: "Pain type with sex",
      choices: [
        { id: "tight", label: "Tightness / pain at entry", next: "PELVIC_SEX_EXPLAIN", primary: true },
        { id: "deep", label: "Deep pain inside", next: "PELVIC_PERSISTENT" },
        { id: "both", label: "Both", next: "PELVIC_SEX_EXPLAIN" },
      ],
    },
    PELVIC_SEX_EXPLAIN: {
      say: [
        "Thanks for explaining 🩷",
        "For some people, the pelvic muscles tighten automatically — often without conscious control — which can make penetration painful.",
        "This can be influenced by stress, anxiety, past pain, or muscle guarding, and it doesn't mean anything is wrong with you.",
        "It's also something a healthcare provider or pelvic floor specialist can help with.",
        ...safeFooter(),
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "sum", label: "Help me summarize", next: "PELVIC_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: "Main options", next: "START_MENU" },
      ],
    },
    PELVIC_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "You're doing the right thing by paying attention to your body.", "Would you like help with anything else?"],
      choices: [
        { id: "menu", label: "Main options", next: "START_MENU", primary: true },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- SOMETHING ELSE ---------------- */
    ELSE_INTRO: {
      say: ["That's okay 🩷 Not every concern fits neatly into a category.", "What's the main thing you've noticed?"],
      choices: [
        { id: "pain", label: "Pain or cramps", next: "ELSE_PAIN_SCALE", primary: true },
        { id: "dis", label: "Unusual discharge", next: "ELSE_DISCHARGE" },
        { id: "off", label: "Cycle feels \"off\"", next: "ELSE_OFF" },
        { id: "ns", label: "I'm not sure", next: "ELSE_NOT_SURE" },
      ],
    },
    ELSE_NOT_SURE: {
      say: [
        "That's completely okay — sometimes it's hard to name it 🩷",
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
      say: ["On a scale from 0–10, how strong is the pain?"],
      question: "Pain level (0–10 group)",
      choices: [
        { id: "m1", label: "0–3 (mild)", next: "ELSE_PAIN_MILD", primary: true },
        { id: "m2", label: "4–6 (moderate)", next: "ELSE_PAIN_MILD" },
        { id: "m3", label: "7–10 (severe)", next: "ELSE_PAIN_SEVERE" },
      ],
    },
    ELSE_PAIN_MILD: {
      say: [
        "Okay, thanks for telling me 🩷",
        "Mild to moderate cramps can happen around your period (and even around ovulation) — but you still deserve support, not just a shrug.",
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
        "• Is it worst on day 1–2?\n• Does it spike with stress or poor sleep?\n• Is it sharper on one side?",
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
        "If cramps aren't improving with rest/heat/relief — or they're stopping you from doing normal things — that's worth paying attention to.",
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
        "Still—if it suddenly becomes much worse, lasts longer than usual, or comes with heavy bleeding/dizziness, that's a sign to get checked.",
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
        "Thanks — 'new or different' is an important detail 🩷",
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
        "Not because it automatically means something scary — but because you deserve support and answers.",
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
        "If you'd like, I can help you track: day of cycle, intensity, and what improves it — that pattern can be really useful later.",
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
        "Because you selected symptoms that can sometimes signal something more than routine cramps, it would be a good idea to get medical advice soon — especially if symptoms worsen.",
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

    /* ---------------- CYCLE-AWARE SMART NODES ---------------- */
    // All nodes below use userMode.* and cd.* for context-aware responses.
    // They never guess pregnancy — they check pregnancyConfirmed and mode explicitly.

    // Gate node: silently redirect to SESSION_MODE_CONFIRM if mode is unknown/browsing,
    // or go straight to CYCLE_EDD_ANSWER if already confirmed.
    CYCLE_EDD_GATE: {
      say: [],   // no message — just a routing node
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
        // Postpartum — cycle may not have returned
        if (userMode.isPostpartum) {
          return [
            "Since you're in postpartum mode, your cycle may still be returning 🩷",
            "It can take several weeks to months for periods to resume, especially if breastfeeding.",
            "If you've had your first postpartum period and want to start tracking again, log it on the dashboard.",
          ];
        }
        // Pregnancy — phase questions don't apply
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
            "I need the date your last period started — you can enter it here or log it on your dashboard.",
          ];
        }
        const p = getCurrentPhase();
        if (!p) return ["Couldn't work that out right now 🩷 Check that your last period date is up to date on the dashboard."];
        const lmp = effectiveLmp();
        const next = cd.nextPeriodDate || addDays(lmp, effectiveCycleLength());
        const daysLeft = daysBetween(new Date(), next);
        const periodNote = daysLeft > 0
          ? `Your next period is expected in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`
          : "Your period may be due around now — if it hasn't come, keep an eye on it.";
        const ttcNote = userMode.isTTC && p.phase === "ovulation"
          ? "You're in your fertile window right now — best time if you're trying to conceive 🌟"
          : userMode.isTTC && p.phase === "follicular"
          ? "Ovulation is coming up soon — good time to prepare if you're TTC."
          : null;
        return [
          ...quickSummary(
            `You're in ${p.label} — day ${p.days + 1} of your cycle.`,
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
            "You can type it here and I'll estimate right now — or log it on the dashboard.",
          ];
        }
        const next = cd.nextPeriodDate || addDays(cd.lmp, cd.cycleLength);
        const daysLeft = daysBetween(new Date(), next);
        const nextStr = fmtDate(next);
        const ttcNote = userMode.isTTC
          ? `In TTC mode, ovulation likely falls around ${fmtDate(addDays(cd.lmp, Math.round(cd.cycleLength / 2)))} — about ${Math.round(cd.cycleLength / 2)} days into your cycle.`
          : null;
        if (daysLeft < 0) {
          const daysOver = Math.abs(daysLeft);
          return [
            `Based on your last period and your average ${cd.cycleLength}-day cycle, your period was expected around ${nextStr} 🩷`,
            `That's ${daysOver} day${daysOver === 1 ? "" : "s"} ago — if it hasn't come yet, it may be worth checking in.`,
            "Is there any chance of pregnancy this cycle?",
          ].filter(Boolean);
        }
        if (daysLeft === 0) return [`Your period is expected today based on your logged cycle 🩷`, "If you're getting cramps or spotting, that's likely your body gearing up."];
        if (daysLeft <= 3) return [`Your period is expected very soon — around ${nextStr}, in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} 🩷`, "If you're already feeling crampy or moody, that's normal this close.", ttcNote].filter(Boolean);
        if (daysLeft <= 7) return [`Your next period is expected around ${nextStr} — about ${daysLeft} days from now 🩷`, "You're in the late luteal phase, which is when PMS symptoms tend to show up.", ttcNote].filter(Boolean);
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
            `Your last menstrual period was ${fmtDate(cd.lmp)} — that's how your pregnancy dates are calculated 🩷`,
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
          ? `Your next period may already be due — if it hasn't come, tap below.`
          : `You're on day ${daysAgo + 1} of your current cycle.`;
        return quickSummary(
          `Your last period started ${fmtDate(lmp)} — ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago.`,
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
            "No need to test again — you're in pregnancy tracking mode.",
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
            `Your period was expected around ${fmtDate(timing.expectedPeriod)} — you can take a test now 🩷`,
            `${qualifier()}, ${effectiveCycleLength()}-day cycle.`,
            "Use first morning urine for the clearest result. Negative but period still missing? Retest in 48–72 hours."
          );
        }
        return quickSummary(
          `Best time to test is from ${fmtDate(timing.testDate)} — about ${timing.daysToTest} day${timing.daysToTest === 1 ? "" : "s"} away.`,
          `${qualifier()}: next period expected ${fmtDate(timing.expectedPeriod)}.`,
          "Testing too early can give a false negative — hormone levels need time to build up."
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
    // who was just curious — shown once per session.
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

    // EDD in explore / planning mode — helpful, no false confirmation
    EDD_EXPLORE: {
      say() {
        const lmp = effectiveLmp();
        if (!lmp) {
          ctx.captureReturnTo = "EDD_EXPLORE";
          return [
            "No problem — to estimate a hypothetical due date I just need a period start date to work from 🩷",
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
            : "Your due date has passed — make sure your provider has current information.";
          return quickSummary(
            `Your estimated due date is ${fmtDate(cd.edd)}${weeksAlong !== null ? ` — you're around ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along` : ""} 🩷`,
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

        // ── NOT in pregnancy mode — the key safety check ─────────────────
        // Never assume pregnancy. Ask first.
        if (!userMode.isPregnancy) {
          // Can calculate provisional EDD but must contextualise it
          const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
          if (!hasLmpData()) {
            ctx.captureReturnTo = "CYCLE_EDD_ANSWER";
            return [
              "Just checking — are you currently tracking a pregnancy, or just exploring due date info? 🩷",
              "Either way, I need your last period start date to estimate. You can type it here.",
            ];
          }
          return [
            "Just checking — are you currently tracking a pregnancy, or exploring due date info? 🩷",
            `I can see your last period was ${fmtDate(cd.lmp)}.`,
            provisionalEdd
              ? `If a pregnancy started this cycle, a rough due date estimate would be around ${fmtDate(provisionalEdd)} — but this is not confirmed.`
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
          `Based on your ${cd.cycleLength}-day cycle and last period of ${fmtDate(cd.lmp)}, your estimated ovulation window is ${fmtDate(fertileStart)} – ${fmtDate(fertileEnd)} 🩷`,
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
          "If you're breastfeeding, your period may be delayed — sometimes for months.",
          "Your first postpartum period may be heavier, more painful, or irregular compared to before.",
          "Once you have your first period, log it on the dashboard so we can start tracking your cycle again.",
          "If you're having heavy bleeding, severe pain, fever, or unusual discharge in the early postpartum weeks — that's worth checking with a provider urgently.",
        ];
      },
      choices: [
        { id: "heavy", label: "I'm having heavy bleeding", next: "HEAVY_INTRO", primary: true },
        { id: "menu", label: "Main options", next: "START_MENU" },
        { id: "done", label: "I'm done for now", next: "CLOSE" },
      ],
    },

    /* ---------------- MODE-SPECIFIC ENTRY NODES ---------------- */

    // Postpartum — dedicated pathway for users in postpartum mode
    POSTPARTUM_INTRO: {
      onEnter() { applySessionMode("postpartum"); },
      say() {
        return [
          "Postpartum bodies are on their own timeline 🩷",
          "Your cycle may take weeks or even months to return — especially if you're breastfeeding.",
          hasLmpData() && cd.lmp
            ? `Your last logged period was ${fmtDate(cd.lmp)}.`
            : "It looks like you haven't logged a period yet — that's okay, it may not have returned.",
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

    // TTC — dedicated pathway for users trying to conceive
    TTC_INTRO: {
      onEnter() { applySessionMode("trying_to_conceive"); },
      say() {
        if (!hasLmpData()) {
          return [
            "Thanks for sharing that 🩷",
            "To give you useful TTC guidance, I need your cycle data — log your last period on the dashboard and I can tell you your ovulation window.",
            "What else can I help with?",
          ];
        }
        const ovDay = addDays(cd.lmp, Math.round(cd.cycleLength / 2) - 1);
        const fertileStart = addDays(ovDay, -2);
        const fertileEnd   = addDays(ovDay,  1);
        const daysTo = daysBetween(new Date(), ovDay);
        return [
          `Based on your ${cd.cycleLength}-day cycle, your estimated fertile window is ${fmtDate(fertileStart)} – ${fmtDate(fertileEnd)} 🩷`,
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

    // Session mode confirmation — fires when user action conflicts with logged mode
    // e.g. asks for EDD but not in pregnancy mode
    MODE_CONFIRM: {
      onEnter() { /* no-op; mode applied when user picks a choice */ },
      say: [
        "Just checking — I want to make sure I give you the right info 🩷",
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
            `Just checking — are you currently tracking a pregnancy, or exploring due date info? 🩷`,
            `I can see your last period was ${fmtDate(cd.lmp)}, so I want to make sure I give you the right guidance.`,
          ];
        }
        return [
          "Just checking — are you currently tracking a pregnancy, or just exploring due date info? 🩷",
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
          "Got it — I'll treat this conversation as pregnancy tracking mode 🩷",
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
          "Noted — I'll keep TTC context in mind for this conversation 🩷",
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
          "No problem — just exploring is totally valid 🩷",
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

    // Emergency — always urgent, never watered down
    EMERGENCY_REDIRECT: {
      say: [
        "Please stop and seek emergency care right now 🩷",
        "Call 119 (Jamaica Emergency) or go to your nearest emergency room.",
        "If someone is with you, ask them to help you get there or call for you.",
        "I'll be here when you're safe — but please prioritize getting real care first.",
      ],
      choices: [
        { id: "ok",   label: "I'm getting help now", next: "CLOSE", primary: true },
        { id: "safe", label: "I'm actually okay / it was less serious", next: "START_MENU" },
      ],
    },

    // Diagnosis redirect — validates concern without pretending to diagnose
    DIAGNOSIS_REDIRECT: {
      say: [
        "I can hear that you're trying to make sense of what's happening 🩷",
        "Conditions like PCOS, endometriosis, and fibroids are real — and they're often under-diagnosed. Your concerns are valid.",
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

    // Medication redirect — firm but kind, always routes to a provider
    MEDICATION_REDIRECT: {
      say: [
        "I can't give medication advice, doses, or tell you what's safe to take 🩷",
        "That's not me being evasive — medication safety genuinely depends on your full health picture, and getting it wrong can cause harm.",
        "For period pain, bleeding, or cycle-related medication questions, a pharmacist can help you on the spot without a referral.",
        "If you'd like, I can help you understand your symptoms so you know what to tell them.",
      ],
      choices: [
        { id: "symptoms", label: "Help me describe my symptoms", next: "START_MENU", primary: true },
        { id: "map",      label: "Find a clinic or pharmacist near me", next: "CLOSE", action: "OPEN_MAP" },
        { id: "menu",     label: "Main options", next: "START_MENU" },
      ],
    },

    // Safety support — sexual violence / coercion
    SAFETY_SUPPORT: {
      say: [
        "What you've shared takes courage 🩷 You deserve care, safety, and support — none of this is your fault.",
        "In Jamaica, the Bureau of Women's Affairs helpline is 888-639-5433.",
        "The Jamaica Constabulary Force has a Sexual Offences Unit — you can report at any police station.",
        "If you need medical care after an assault (including emergency contraception or testing), a hospital emergency department can help confidentially.",
        "You don't have to navigate this alone.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "CLOSE", action: "OPEN_MAP", primary: true },
        { id: "more", label: "I have more health questions", next: "START_MENU" },
        { id: "done", label: "Thank you, I'm okay for now", next: "CLOSE" },
      ],
    },

    // Crisis support — mental health / suicidal ideation / self-harm
    CRISIS_SUPPORT: {
      say: [
        "What you're feeling right now matters 🩷 I'm not able to give you the support you deserve — but real, caring help is available.",
        "Jamaica Crisis Hotline: 888-NEW-LIFE (888-639-5433) — confidential, 24/7.",
        "You can also go to your nearest hospital emergency department and tell them how you're feeling.",
        "You're not alone in this, and reaching out — even here — took strength.",
      ],
      choices: [
        { id: "ok",   label: "I'll reach out", next: "CLOSE", primary: true },
        { id: "more", label: "I also have a health question", next: "START_MENU" },
      ],
    },

    // Privacy / data info
    PRIVACY_INFO: {
      say: [
        "Great question — here's what you should know 🩷",
        "Your data in Bloom is private to you. Period logs, symptoms, and chat history are stored securely and are not sold to third parties.",
        "Bloomie (this chat) does not store conversation content permanently — the session ends when you close the chat.",
        "If you want to delete your account or data, go to Settings → Account → Delete Account in the Bloom app.",
        "If you have specific legal questions about data handling, Bloom's full privacy policy is available in the app under Settings → Privacy Policy.",
      ],
      choices: [
        { id: "ok",   label: "Thanks, that helps", next: "START_MENU", primary: true },
        { id: "more", label: "I have a health question", next: "START_MENU" },
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
        "No problem — I just need the date your last period started 🩷",
        "Type it in any format: 2026-02-08, 08/02/2026, or just 'Feb 8'.",
        "Nothing gets saved to your dashboard — this is just for this chat.",
      ],
      choices: [
        { id: "skip", label: "Skip — just show me general info", next: "START_MENU" },
      ],
    },

    /* ─────────────── NEW BRANCH NODES ─────────────── */

    // "Is my period late?" — smart lateness check
    LATE_PERIOD_CHECK: {
      say() {
        if (!hasLmpData()) {
          ctx.captureReturnTo = "LATE_PERIOD_CHECK";
          return [
            `${ack()} To check if your period is late, I need your last period start date 🩷`,
            "You can type it here — I won't save it to your dashboard, just use it for this chat.",
          ];
        }
        const lmp = effectiveLmp();
        const cycleLen = effectiveCycleLength();
        const expectedNext = cd.nextPeriodDate || addDays(lmp, cycleLen);
        const daysLate = daysBetween(expectedNext, new Date());

        if (daysLate < 0) {
          const daysLeft = Math.abs(daysLate);
          return quickSummary(
            `Your period isn't late — it's expected in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
            `${qualifier()}: last period ${fmtDate(lmp)}, ${cycleLen}-day cycle.`,
            daysLeft <= 5
              ? "You might start feeling PMS symptoms around now — that's normal."
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
            "A few days late doesn't always mean something is wrong — stress, illness, travel, or sleep changes can all shift timing.",
            "Want to walk through the possible reasons?",
          ];
        }
        return [
          `${ack()} Your period is ${daysLate} days late based on your logged cycle 🩷`,
          "That's worth paying attention to — I'd suggest walking through it together.",
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

    // "What does this symptom mean?" — education without diagnosis
    SYMPTOM_EDUCATION: {
      say: [
        "I can give you general education on period and cycle symptoms 🩷",
        "Keep in mind — understanding what's common is different from diagnosing what's happening to you specifically.",
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
        "It can also be a sign of low iron (anaemia) — especially if you feel dizzy, weak, or short of breath during your period.",
        "If it's happening every cycle, it's worth bringing up with a provider — not because it's always serious, but because it's treatable.",
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
        "Mild cramps are common and normal for the first 1–2 days. But cramps that stop you from daily life, don't respond to pain relief, or happen outside your period — that's a different story.",
        "Conditions like endometriosis and adenomyosis can cause severe cramping and are often under-diagnosed.",
        `${consent()} — how bad does it get for you?`,
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
        "It can be totally normal — ovulation spotting, implantation bleeding, or just hormonal fluctuation.",
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
        "Mood changes tied to your cycle are driven by shifting hormone levels — mainly oestrogen and progesterone 🩷",
        "In the luteal phase (roughly days 15–28), progesterone rises then drops sharply, which can cause irritability, sadness, anxiety, or brain fog.",
        "When it's mild, that's PMS. When it's significantly affecting your daily life, it might be PMDD — which is real and treatable.",
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
        "Conditions like PCOS can cause consistently irregular cycles — that's one of its most common signs.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "My period is late right now", next: "LATE_PERIOD_CHECK", primary: true },
        { id: "preg",  label: "Could I be pregnant?",        next: "LATE_TEST_Q" },
        { id: "more",  label: "Learn about another symptom", next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: "Main options",                next: "START_MENU" },
      ],
    },

    // "Should I see a doctor?" — rule-based red flag guidance
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
          "Go when you can (within a few weeks): periods that are consistently late, irregular, or very painful — especially if this is new.",
          "Book a routine visit: if you haven't had a gynaecological check in over a year, or if something just feels off.",
          `${qualifier()}, I can't tell you whether your specific situation is urgent — that's why providers exist. But trusting your gut about your own body is always valid.`,
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
        "3. Enter your average cycle length — most people are between 21 and 35 days",
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

    /* ---------------- EDUCATION: PERIMENOPAUSE ---------------- */
    EDUC_PERIMENOPAUSE: {
      say: [
        "Perimenopause is the transition phase leading up to menopause — and it can actually start earlier than most people expect, sometimes in the mid-30s but more commonly in the 40s 🩷 It's your body's way of gradually shifting away from its regular reproductive cycle.",
        "The symptom list is long, and it's different for everyone: irregular or unpredictable periods, hot flashes, night sweats, mood changes, brain fog, trouble sleeping, vaginal dryness, and changes in energy or libido are all common. You might notice just a few of these, or several at once.",
        "Here's the part that catches people off guard — perimenopause isn't a brief phase. It can last anywhere from a few years to over a decade, and symptoms can come and go unpredictably. Tracking your cycle and symptoms over time is genuinely useful context for any provider.",
        "If your symptoms are affecting your daily life, or you're not sure whether what you're experiencing is perimenopausal, it's worth talking to a provider — there are real options for managing symptoms, from lifestyle changes to hormonal and non-hormonal treatments 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: MENOPAUSE ---------------- */
    EDUC_MENOPAUSE: {
      say: [
        "Menopause is defined as 12 consecutive months without a period — that 12-month mark is the official transition point 🩷 The average age is around 51, but it's completely normal to reach it earlier or later.",
        "It's important to name this clearly: menopause is a natural life transition, not an illness. That said, the hormonal shifts involved are real, and so are the symptoms — you don't have to just push through them.",
        "After menopause, some symptoms from the perimenopause years continue: hot flashes, sleep disruption, mood changes, vaginal dryness, joint discomfort, and changes in bone density are all things providers take seriously and can help with.",
        "Support options range from lifestyle approaches (movement, sleep hygiene, nutrition) to menopausal hormone therapy (MHT/HRT), non-hormonal medications, and talking therapies — the right fit depends on your health history and your preferences. A provider or menopause specialist can walk you through what's available 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: CONTRACEPTION ---------------- */
    EDUC_CONTRACEPTION: {
      say: [
        "Contraception is something Bloomie can give you a general overview of — but I want to be upfront: I can't recommend a specific method for you, because what works best really depends on your health history, your cycle, and your own goals 🩷",
        "That said, here's a quick lay of the land: barrier methods (like condoms or diaphragms) work in the moment and don't affect your hormones. Hormonal methods (the pill, patch, ring, shot) use synthetic hormones to prevent pregnancy and can also help with cycle symptoms. Long-acting options (IUDs — hormonal or copper — and implants) are set-and-forget for years at a time.",
        "Each category has real trade-offs — side effects, how easy they are to use, how quickly fertility returns — and a provider or pharmacist can walk you through what fits your situation, your body, and your life.",
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
        "PCOS — polycystic ovary syndrome — is one of the most common hormonal conditions people with periods deal with, and it's way more manageable than it sounds 🩷",
        "It basically means your hormones are running a little out of balance, which can cause things like irregular or skipped periods, acne that flares around your cycle, extra hair growth (chin, chest, belly), weight changes, or difficulty conceiving.",
        "The frustrating part is that PCOS looks different for everyone — some people have most of those symptoms, some have just one or two. That's why getting an actual diagnosis (usually an ultrasound plus a blood panel) matters so much.",
        "If your periods are consistently irregular, or you've been noticing acne or hair changes alongside cycle issues, it's worth bringing up with a provider — not because it's an emergency, but because the right support makes a real difference 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: ENDOMETRIOSIS ---------------- */
    EDUC_ENDO: {
      say: [
        "Endometriosis (often called endo) is a condition where tissue similar to your uterine lining grows in places it shouldn't — like on your ovaries or fallopian tubes — and that tissue still responds to your hormones each cycle 🩷",
        "That's why endo pain tends to show up around your period and can be really intense — cramping that doesn't respond well to regular pain relief, pain during sex, heavy bleeding, or a deep aching in your pelvis or lower back.",
        "One thing worth knowing: endo symptoms are often dismissed or written off as \"bad periods\" for years. If your period pain is significantly affecting your day-to-day life — if you're missing work, school, or things you love — that's not something you should have to just push through.",
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