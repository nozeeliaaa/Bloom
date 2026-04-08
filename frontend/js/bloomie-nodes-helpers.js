/**
 * bloomie-nodes-helpers.js
 * Local helper functions shared across all Bloomie node modules.
 * Called once inside createNodes() with the full env object.
 */
export function buildNodeHelpers(env) {
  const {
    ctx, pick, ack, addDays, fmtDate, daysBetween, bloomieMemory,
    effectiveLmp, effectiveCycleLength, getCurrentPhase, daysUntilNextPeriod,
    SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS, buildRecallLine, extractUrgency, greet,
    buildCyclePersonalisationLine, hasLmpData, cd, userMode, withNickname,
    pickAvoiding, wasNodeRecentlySeen, insightFor, buildSymptomPatternLine,
    buildSymptomInsightLine, buildCycleSignalLine, getNickname,
  } = env;

  // ── computeTestPlan ──────────────────────────────────────────────────────
  function computeTestPlan({ expectedPeriodDate = null, sexDate = null, today = new Date() } = {}) {
    const exp = expectedPeriodDate ? new Date(expectedPeriodDate) : null;
    const sex = sexDate ? new Date(sexDate) : null;
    const validExp = exp && !Number.isNaN(exp.getTime());
    const validSex = sex && !Number.isNaN(sex.getTime());

    const daysSinceSex = validSex ? Math.floor((today - sex) / 86400000) : null;
    const isTooEarly = validSex ? daysSinceSex < 10 : false;
    const canTestEarly = validSex ? (daysSinceSex >= 10 && daysSinceSex < 21) : false;

    let primary = null;
    let basis = null;
    let bothDatesAvailable = false;
    let _fromPeriod = null;
    let _fromSex = null;

    if (validExp) _fromPeriod = addDays(exp, 1);
    if (validSex) _fromSex = addDays(sex, 21);

    if (validExp && validSex) {
      bothDatesAvailable = true;
      // Use the later of the two dates as primary (more reliable)
      primary = _fromPeriod > _fromSex ? _fromPeriod : _fromSex;
      basis = "both";
    } else if (validExp) {
      primary = _fromPeriod;
      basis = "missed-period";
    } else if (validSex) {
      primary = _fromSex;
      basis = "sex-date";
    }

    const retest = primary ? addDays(primary, 2) : null;
    const isPrimaryInPast = primary ? primary <= today : false;
    return {
      primary,
      retest,
      basis,
      isPrimaryInPast,
      isTooEarly,
      canTestEarly,
      urgentWarningNeeded: false,
      bothDatesAvailable,
      _fromPeriod,
      _fromSex,
    };
  }

  // ── Mood continuity helper ────────────────────────────────────────────────
  // Reads ctx.moodMentions (recorded in assistant.js on every mood entity hit)
  // and returns one of three signals:
  //   { type: "none" }
  //   { type: "persistent", count }   — same mood 2–3 turns in a row
  //   { type: "escalated",  count }   — tone has worsened across mentions
  //
  // Returns null when: urgency is active, fewer than 2 mentions exist, or the
  // continuity was already surfaced this session (adviceGiven guard).
  //
  // buildMoodContinuityLine() converts that signal into a pick()d sentence.
  // Must be called BEFORE consumeGuard so callers can decide whether to surface.
  function getMoodContinuitySignal() {
    if (ctx.urgency) return null;
    if (ctx.adviceGiven.has("mood_continuity_surfaced")) return null;
    const mentions = ctx.moodMentions ?? [];
    if (mentions.length < 2) return null;

    // Use last 3 mentions only — older history decays
    const recent = mentions.slice(-3);

    // Escalation: tone has moved toward a more distressed/serious value
    const TONE_WEIGHT = { neutral: 0, casual: 0, exhausted: 1, frustrated: 1,
                          anxious: 2, angry: 2, distressed: 3 };
    const weights = recent.map(m => TONE_WEIGHT[m.tone] ?? 0);
    const isEscalating = weights.length >= 2 && weights[weights.length - 1] > weights[0];

    if (isEscalating) return { type: "escalated", count: recent.length };
    if (recent.length >= 2) return { type: "persistent", count: recent.length };
    return null;
  }

  function buildMoodContinuityLine() {
    const signal = getMoodContinuitySignal();
    if (!signal) return null;

    // Mark as surfaced — only show once per session
    ctx.adviceGiven.add("mood_continuity_surfaced");

    if (signal.type === "escalated") {
      return pick([
        "It sounds like this has been getting heavier as we've been talking — I want to make sure I'm giving you what you actually need right now 🩷",
        "I'm noticing this feels like it's intensifying — that's worth paying attention to, not pushing through 🩷",
        "The more you share, the clearer it is that this isn't a small thing — I hear you 🩷",
      ]);
    }

    // persistent
    return pick([
      "It sounds like this hasn't really eased up since you first mentioned it — and that matters 🩷",
      "You're still feeling this, and the fact that it keeps coming back tells me it deserves more than just sitting with it 🩷",
      "I've been noticing this has come up more than once — that kind of persistence is worth taking seriously 🩷",
    ]);
  }

  // Build a soft recall line from stale background context (>24h, <7d).
  // Uses the same symptom → label mapping as buildRecallLine, but with
  // softer language since the data is older.
  function buildBackgroundRecallLine() {
    if (ctx.isAnon) return null;
    // Never surface stale symptom callbacks at chat open before the user has
    // re-established context in this session.
    if ((ctx.conversationProfile?.sessionDepth ?? 0) < 1) return null;
    if (!ctx.backgroundContext?.symptoms) return null;
    const labels = [...new Set(
      Object.entries(ctx.backgroundContext.symptoms)
        .filter(([, v]) => v)
        .flatMap(([k]) => SYMPTOM_TO_CATALOG_KEYS[k] || [])
        .map(code => CATALOG_LABELS[code])
        .filter(Boolean)
        .slice(0, 3)
    )];
    if (!labels.length) return null;
    const list = labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    return pick([
      `It's been a few days — last time you mentioned **${list}**. How are you feeling now?`,
      `We last talked about **${list}** — is that still going on, or is something new coming up? 🩷`,
    ]);
  }

  // Build a fallback line from the last known intent when no symptom recall is available.
  function buildIntentFallbackLine() {
    if (ctx.isAnon) return null;
    const INTENT_LABELS = {
      LATE_INTRO:           "a late or missed period",
      HEAVY_INTRO:          "heavy bleeding",
      SPOT_INTRO:           "spotting",
      MOOD_SAFETY_CHECK:    "mood or energy changes",
      PELVIC_INTRO:         "pelvic pain or cramps",
      PREGNANCY_ENTRY:      "pregnancy concerns",
      ELSE_DISCHARGE_ENTRY: "discharge changes",
    };
    const label = INTENT_LABELS[bloomieMemory?.lastIntent];
    if (!label) return null;
    return pick([
      `Last time you were looking into **${label}** — feel free to pick up where we left off, or start fresh 🩷`,
      `It looks like **${label}** was on your mind last time — still relevant, or is something new coming up? 🩷`,
    ]);
  }

  function buildIntro() {
    const name        = getNickname();                                    // Firestore nickname or null
    const isReturning = !ctx.isAnon && !!bloomieMemory?.lastSessionDate;  // has at least one prior session
    const recall      = buildRecallLine();                                 // topic/recentness gated in assistant helper
    const bgRecall    = !recall ? buildBackgroundRecallLine() : null;     // stale recall (>24h <7d), or null
    const intentLine  = !recall && !bgRecall ? buildIntentFallbackLine() : null; // last-resort intent hint
    const appendLine  = recall ?? bgRecall ?? intentLine;
    const r = (lines) => appendLine ? [...lines, appendLine] : lines;
    const introLine = `${greet()} I'm Bloomie, Bloom's health assistant 🌸`;

    // ── Minor ─────────────────────────────────────────────────────────────
    if (ctx.isMinor) {
      return r([
        introLine,
        "I'm here to help you understand what's going on with your body 🩷 Everything you share with me stays between us.",
        "I can help with period questions, cramps, mood changes, and more. What's on your mind?",
      ]);
    }

    // ── Anonymous ─────────────────────────────────────────────────────────
    if (ctx.isAnon) {
      return r([
        introLine,
        "You're not signed in, so I won't be able to see your cycle history — but I can still help 🩷",
        "What's going on today?",
      ]);
    }

    // ── Pregnancy tracking ────────────────────────────────────────────────
    if (userMode.isPregnancy && cd.lmp) {
      const weeksAlong = Math.floor(daysBetween(cd.lmp, new Date()) / 7);
      return r([
        introLine,
        `Looks like pregnancy tracking mode is on${weeksAlong > 0 ? ` — you're around ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along by date estimate` : ""} 🩷`,
        "I can help with symptoms, test timing, due dates, or anything else on your mind. What's going on?",
      ]);
    }

    // ── TTC ───────────────────────────────────────────────────────────────
    if (userMode.isTTC) {
      return r([
        introLine,
        "Looks like you're in trying-to-conceive mode 🩷 I can help with ovulation windows, test timing, cycle tracking, and symptoms.",
        "What can I help you with today?",
      ]);
    }

    // ── Postpartum ────────────────────────────────────────────────────────
    if (userMode.isPostpartum) {
      return r([
        introLine,
        "Looks like you're in postpartum mode 🩷 Your cycle may behave differently for a while, and that can be normal.",
        "What's on your mind today?",
      ]);
    }

    // ── Cycle tracking ────────────────────────────────────────────────────
    if (userMode.isCycleTracking && cd.lmp) {
      const daysLeft = daysUntilNextPeriod();
      const dueSoon  = daysLeft !== null && daysLeft >= 0 && daysLeft <= 5;
      const overdue  = daysLeft !== null && daysLeft < -1;
      const enoughCycleHistory = Number(cd?.cycleCount ?? 0) >= 2;

      if (overdue) {
        const lateDays = Math.abs(daysLeft);
        const contextLine = pick([
          `Based on your logged dates, your period may be a little late${enoughCycleHistory && lateDays > 1 ? ` — around ${lateDays} days overdue by estimate` : ""} 🩷`,
          `Looks like your period might be a bit later than expected 🩷`,
          `From your recent logs, your period may not have arrived yet 🩷`,
        ]);
        return r([introLine, contextLine, "If it hasn't come yet or something feels off, I'm here. What's going on?"]);
      }

      if (dueSoon) {
        const contextLine = pick([
          `Looks like your period might be coming up in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} 🩷`,
          `Based on your logged dates, your period is due in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} 🩷`,
          `Your period window is getting close — around ${daysLeft} day${daysLeft === 1 ? "" : "s"} away 🌸`,
        ]);
        return r([introLine, contextLine, "If you're already feeling symptoms, I can help. What's going on?"]);
      }

      // No urgency signal — use phase awareness for returning users
      const phaseInfo = getCurrentPhase();
      if (isReturning && phaseInfo) {
        const phaseLine = pick([
          `Based on your cycle, you might be in ${phaseInfo.label} right now 🩷`,
          `From your logged dates, it looks like you're around ${phaseInfo.label} right now 🌸`,
        ]);
        return r([introLine, phaseLine, "What can I help you with today?"]);
      }

      if (isReturning) {
        return r([
          introLine,
          "What can I help you with today?",
        ]);
      }

      // First-time user, cycle tracking
      return r([
        introLine,
        "I can help with period concerns, cycle questions, spotting, cramps, mood changes, and more.",
        name ? `What can I help you with today, ${name}?` : "What can I help you with today?",
      ]);
    }

    // ── Default (signed-in, no specific mode or no LMP) ───────────────────
    if (isReturning) {
      const phaseInfo = getCurrentPhase();
      return r([
        introLine,
        ...(phaseInfo ? [pick([
          `Based on your cycle, you might be in ${phaseInfo.label} right now 🩷`,
          `From your logged dates, it looks like you're around ${phaseInfo.label} right now 🌸`,
        ])] : []),
        "I can help with period concerns, cycle questions, symptoms, and more.",
        "What can I help you with today?",
      ]);
    }

    // First-time user, default
    return r([
      introLine,
      "I can help you understand common period-related concerns based on what you decide to share, but I can't provide diagnoses.",
      name ? `What can I help you with today, ${name}?` : "What can I help you with today?",
    ]);
  }

  const INTRO = buildIntro();
  // Record the opening line for dedup on the next session.
  ctx.lastUsedGreeting = Array.isArray(INTRO) ? (INTRO[0] ?? null) : null;

  const pickCloseLabel = () => pick(["I'm done for now", "That's all for now", "Thanks, I'm good", "All done 🩷"]);
  const pickMainLabel  = () => pick(["Main options", "Back to start", "Something else", "Other questions"]);

  const CLOSE_TEXT =
    withNickname(greet(true, "Thanks for talking with me")) + " If anything changes or you notice new symptoms, you can come back anytime. Remember you know your body best.";

  return {
    computeTestPlan,
    getMoodContinuitySignal,
    buildMoodContinuityLine,
    buildBackgroundRecallLine,
    buildIntentFallbackLine,
    buildIntro,
    INTRO,
    pickCloseLabel,
    pickMainLabel,
    CLOSE_TEXT,
  };
}
