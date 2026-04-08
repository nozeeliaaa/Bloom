/**
 * bloomie-nodes-period.js
 * Heavy/unusual bleeding nodes, spotting nodes, late/missed period nodes,
 * and pregnancy entry routing nodes.
 * Covers: HEAVY_*, SPOT_*, LATE_*, PREGNANCY_ENTRY, PREG_*, LATE_TEST_Q,
 * LATE_TEST_SUGGEST, LATE_TEST_RESULT, LATE_POSITIVE, LATE_NEG_UNCLEAR,
 * LATE_CHANGES_Q, LATE_CHANGES_EXPLAIN, LATE_SYMPTOMS_Q, LATE_PATTERN_Q,
 * LATE_WRAP.
 */
export function createPeriodNodes(env, helpers) {
  const {
    ctx, cd, userMode, say, transition, pick, ack, qualifier, consent, estimate,
    quickSummary, safeFooter, urgentFooter, minorSafeFooter, effectiveLmp, effectiveCycleLength,
    effectiveMode, hasLmpData, getCurrentPhase, phaseNudge, insightFor, addDays, fmtDate,
    buildSummaryCard, authorizeHtmlPayload, applySessionMode, canGiveAdvice, filterDedup,
    daysBetween, daysUntilNextPeriod, buildRecallLine, buildCyclePersonalisationLine,
    buildCycleSignalLine, buildSymptomPatternLine, buildSymptomInsightLine, greet, buildCycleCtx,
    withNickname, canUseNickname, getNickname, bloomieMemory,
    pickAvoiding, wasNodeRecentlySeen,
    hasContentBeenShown, markContentShown,
    hasContentBeenDeclined, markContentDeclined,
    CONDITION_META, CONDITION_ALIASES, extractConditionKey,
    pickPriorityConcern, getPhaseInsight, getToneOpener, buildGuidanceResponse,
    getStructuredSummary, computePhaseConfidence, logSafetyEvent,
    parseNaturalDate, validateCycleDate, validateCalendarDate,
    generateIntegratedSignals, getBloomieSymptomContext,
    extractEntities, inferRoute, summarizeEntities, extractUrgency,
    SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS,
    CONCERN_PRIORITY,
  } = env;
  const { pickCloseLabel, pickMainLabel, CLOSE_TEXT, INTRO } = helpers;

  return {
    /* ---------------- HEAVY OR UNUSUAL BLEEDING ---------------- */

    // ── Route A: Volume / soaking focus (also entry for button clicks) ────────
    HEAVY_INTRO: {
      autoNext(ctx) {
        ctx.heavyFlags = {};
        return null;
      },
      say: [
        "That sounds really uncomfortable, let's figure out what's going on 🩷",
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
        { id: "2_3h", label: "Every 2–3 hours",  next: "HEAVY_A_2_3H",      primary: true },
        { id: "3_4h", label: "Every 3–4 hours",  next: "HEAVY_SHARED_CORE" },
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
        "I hear you, bleeding that just won't stop is exhausting 🩷",
        "How many days has the bleeding been going on?",
      ],
      choices: [
        { id: "7_9",    label: "7–9 days",                               next: "HEAVY_B_7_9",    primary: true },
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

    // ── Gate: skip Route C dizziness question if already mentioned ────────────
    HEAVY_ROUTE_C_GATE: {
      say: [],
      onEnter() {
        const alreadyMentioned = ctx.entityHistory?.some(e => e.symptoms?.dizziness);
        if (alreadyMentioned) {
          (ctx.heavyFlags = ctx.heavyFlags || {}).symptomatic = true;
          say(pick(["You mentioned dizziness earlier 🩷", "I've got that noted 🩷"]));
          const tid = setTimeout(() => transition("HEAVY_SHARED_CORE"), 1300);
          ctx.timers.add(tid);
        } else {
          transition("HEAVY_ROUTE_C");
        }
      },
      choices: [],
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
      say: [pick([
        "Okay, are you soaking through a pad or tampon about every hour?",
        "Got it — are you soaking through a pad or tampon about every hour?",
        "Let's check — are you going through a pad or tampon every hour or so?",
      ])],
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

    // Step 3: symptom check skipped if Route C already captured symptoms
    HEAVY_CORE_SYMP_GATE: {
      autoNext(ctx) {
        return (ctx.heavyFlags || {}).symptomatic ? "HEAVY_DECIDE" : "HEAVY_CORE_SYMP_ENT_CHECK";
      },
    },
    // Gate: skip dizziness question if already mentioned in this session
    HEAVY_CORE_SYMP_ENT_CHECK: {
      say: [],
      onEnter() {
        const alreadyMentioned = ctx.entityHistory?.some(e => e.symptoms?.dizziness);
        if (alreadyMentioned) {
          (ctx.heavyFlags = ctx.heavyFlags || {}).symptomatic = true;
          say(pick(["You mentioned dizziness earlier 🩷", "I've got that noted 🩷"]));
          const tid = setTimeout(() => transition("HEAVY_DECIDE"), 1300);
          ctx.timers.add(tid);
        } else {
          transition("HEAVY_CORE_SYMPTOMS");
        }
      },
      choices: [],
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

    // Decision routing evaluates all collected flags
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
          "What you're describing needs medical attention today, please don't wait 🩷",
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
          "If you feel faint, collapse, or bleeding gets worse on the way, call for help immediately."
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
      say() {
        const insightLine = buildSymptomInsightLine();
        return [
          "Based on what you've shared, this isn't an emergency right now, but it does need a proper look in the next few days 🩷",
          "Bleeding that's heavier than usual or lasting longer than a week can sometimes point to things worth checking, like fibroids, hormonal shifts, or low iron.",
          ...(insightLine ? [insightLine] : []),
          "Book a visit with a healthcare provider or gynaecologist as soon as you can, ideally within the next 2–3 days.",
          "If anything changes, you start feeling faint, bleeding gets suddenly heavier, or you develop severe pain, treat that as urgent and seek care the same day.",
        ];
      },
      choices: [
        { id: "map",  label: "Find care near me",  next: "HEAVY_AFTER_CARE", action: "OPEN_MAP",    primary: true },
        { id: "log",  label: "Log this concern",   next: "HEAVY_AFTER_CARE", action: "LOG_SYMPTOM" },
        { id: "menu", label: "Back to main menu",  next: "START_MENU" },
      ],
    },
    HEAVY_MONITOR: {
      say() {
        const insightLine = buildSymptomInsightLine();
        const patternLine = !insightLine
          ? buildSymptomPatternLine(["HEAVY_FLOW", "LARGE_CLOTS", "VAGINAL_BLEEDING", "CRAMPS"])
          : null;
        return [
          "Based on what you shared, this sounds like it may be a heavier day rather than something immediately alarming 🩷",
          "Some people naturally have heavier flow, especially in the first 1–2 days of their period. That said, your experience is always worth tracking.",
          ...(insightLine ? [insightLine] : patternLine ? [patternLine] : []),
          "Keep monitoring over the next 24 hours. If the flow picks up, you start feeling weak or dizzy, or you notice large clots, come back and let me know.",
        ];
      },
      choices: [
        { id: "log",   label: "Log this concern",        next: "HEAVY_AFTER_CARE", action: "LOG_SYMPTOM", primary: true },
        { id: "learn", label: "Learn about heavy periods", next: "EDUC_HEAVY" },
        { id: "menu",  label: "Back to main menu",         next: "START_MENU" },
      ],
    },
    HEAVY_AFTER_SUMMARY: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "Want help with anything else?"],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    HEAVY_AFTER_CARE: {
      say: [
        "I'm here with you 🩷",
        "If you want, you can come back after you get care and we can track what changes.",
        "Would you like help with anything else?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },

    /* ---------------- LATE OR MISSED PERIOD ---------------- */
    LATE_INTRO: {
      autoNext(ctx) {
        // MEMORY AUDIT FIX: was re-asking "more than 7 days late?" — now checks
        // ctx.entityHistory for duration already extracted from the user's message.
        const lastEnt = ctx.entityHistory?.at?.(-1) ?? ctx.entityHistory?.[ctx.entityHistory.length - 1];
        const dur = lastEnt?.duration;
        if (!dur) return null;
        if (dur.days >= 7 || dur.weeks >= 1) return "LATE_YES_PREG";
        if (dur.days > 0 && dur.days < 7)    return "LATE_NO_GUIDANCE";
        return null;
      },
      say() {
        const cycleLine = buildCyclePersonalisationLine("late");
        const signalLine = buildCycleSignalLine("late");
        return [
          pick([
            `${ack()} A late or missed period can be really stressful, especially when your body usually feels predictable 🩷`,
            "Okay, a late period. Let's look at this properly 🩷",
            "Waiting on your period is genuinely one of the more stressful things. Let's break it down 🩷",
            "That uncertainty is real, not knowing what's going on with your own body is hard 🩷",
            "Late periods happen for so many reasons. Let's figure out what might be going on for you 🩷",
          ]),
          ...(cycleLine ? [cycleLine] : []),
          ...(signalLine ? [signalLine] : []),
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
      autoNext(ctx) {
        // MEMORY AUDIT FIX: was re-asking pregnancy chance — now checks
        // ctx.entityHistory for test/chance already extracted from the user's message.
        const lastEnt = ctx.entityHistory?.at?.(-1) ?? ctx.entityHistory?.[ctx.entityHistory.length - 1];
        const preg = lastEnt?.pregnancy;
        if (!preg) return null;
        if (preg.testedYet) {
          if (preg.result === "positive")                              return "LATE_POSITIVE";
          if (preg.result === "negative" || preg.result === "unclear") return "LATE_NEG_UNCLEAR";
          return "LATE_TEST_RESULT";
        }
        if (preg.chance) return "LATE_TEST_Q";
        return null;
      },
      say: [
        "Okay 🩷 A few days of variation can be completely normal, even in people who are usually very regular.",
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
      say() {
        const signalLine = buildCycleSignalLine("late");
        return [
          "Totally valid! irregular cycles make it genuinely hard to know what 'late' even means 🩷",
          "Irregular cycles are common and can happen for lots of reasons: stress, hormonal imbalances, conditions like PCOS, weight changes, or just how your body works.",
          ...(signalLine ? [signalLine] : []),
          "A few things that can help: tracking even rough dates over a few months starts to reveal your personal pattern.",
          "Is there any chance of pregnancy this cycle?",
        ];
      },
      question: "Chance of pregnancy this cycle?",
      choices: [
        { id: "yes",  label: "Yes, could be", next: "LATE_TEST_Q", primary: true },
        { id: "no",   label: "No", next: "LATE_CHANGES_Q" },
        { id: "ns",   label: "Not sure", next: "LATE_TEST_Q" },
        { id: "pcos", label: "I think I might have PCOS or a hormonal issue", next: "DIAGNOSIS_REDIRECT" },
      ],
    },
    LATE_YES_PREG: {
      autoNext(ctx) {
        // MEMORY AUDIT FIX: was re-asking pregnancy chance — now checks
        // ctx.entityHistory for test/chance already extracted from the user's message.
        const lastEnt = ctx.entityHistory?.at?.(-1) ?? ctx.entityHistory?.[ctx.entityHistory.length - 1];
        const preg = lastEnt?.pregnancy;
        if (!preg) return null;
        if (preg.testedYet) {
          if (preg.result === "positive")                              return "LATE_POSITIVE";
          if (preg.result === "negative" || preg.result === "unclear") return "LATE_NEG_UNCLEAR";
          return "LATE_TEST_RESULT";
        }
        if (preg.chance) return "LATE_TEST_Q";
        return null;
      },
      say() {
        // TTC mode reframe as potentially good news
        if (userMode.isTTC) {
          return [
            "Thanks for letting me know 🩷",
            "Since you're in trying-to-conceive mode, a late period is definitely worth paying attention to.",
            "Is there any chance this could be a positive result?",
          ];
        }
        // Pregnancy tracking they're already pregnant, late period doesn't apply
        if (userMode.isPregnancy) {
          return [
            "Since you're already in pregnancy tracking mode, a missed period is expected 🩷",
            "Are you noticing other symptoms you want to talk through?",
          ];
        }
        return [
          `${ack()} Pregnancy is one of the most common reasons for a late period, worth checking rather than worrying in silence 🩷`,
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
      say(ctx) {
        const lines = ["Got you 🩷 What feels closest to your situation right now?"];
        if (ctx.isMinor) lines.unshift("It's okay to be here — you can share as much or as little as you're comfortable with 🩷");
        return lines;
      },
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
        "That's okay, pregnancy worries can feel overwhelming even when you're not sure what you're actually worried about 🩷",
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
        "That makes sense, anxiety about pregnancy is completely valid, even when nothing has 'happened' yet 🩷",
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
      autoNext(ctx) {
        // MEMORY AUDIT FIX: was re-asking "have you taken a pregnancy test?" — now
        // checks ctx.entityHistory for testedYet/result already extracted from the message.
        const lastEnt = ctx.entityHistory?.at?.(-1) ?? ctx.entityHistory?.[ctx.entityHistory.length - 1];
        const preg = lastEnt?.pregnancy;
        if (!preg?.testedYet) return null;
        if (preg.result === "positive")                              return "LATE_POSITIVE";
        if (preg.result === "negative" || preg.result === "unclear") return "LATE_NEG_UNCLEAR";
        return "LATE_TEST_RESULT"; // tested but result unclear from text
      },
      say: [pick(["Okay 🩷 thanks for being open.", "Thanks for sharing that 🩷", "Appreciated 🩷 thanks for telling me."]), "Have you taken a pregnancy test yet?"],
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
        "If there's any chance, taking a pregnancy test can help reduce uncertainty, especially if your period doesn't arrive in the next few days.",
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
        { id: "menu", label: pickMainLabel(),               next: "START_MENU" },
        { id: "done", label: pickCloseLabel(),           next: "CLOSE" },
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
      say() {
        const pelvicKnown = ctx.entityHistory?.some(e => e.symptoms?.pelvic);
        return [
          "Thanks for sharing 🩷",
          "Changes like stress, illness, or shifts in routine can affect hormone levels and delay ovulation, which can push your period later than usual.",
          pelvicKnown
            ? pick([
                "I've already noted you mentioned cramps or pelvic discomfort 🩷 Are you also experiencing any of the following?",
                "I've got that you mentioned pelvic pain 🩷 Are any of these also happening?",
              ])
            : "Are you noticing any of the following right now?",
        ];
      },
      question: "Symptoms with late period",
      choices: [
        { id: "cr", label: "Cramps or pelvic discomfort", next: "LATE_PATTERN_Q", primary: true },
        { id: "sp", label: "Spotting", next: "LATE_PATTERN_Q" },
        { id: "ho", label: "Hormonal symptoms (acne, mood changes)", next: "LATE_PATTERN_Q" },
        { id: "none", label: "None of these", next: "LATE_PATTERN_Q" },
      ],
    },
    LATE_SYMPTOMS_Q: {
      say() {
        const pelvicKnown = ctx.entityHistory?.some(e => e.symptoms?.pelvic);
        if (pelvicKnown) {
          return [
            pick(["Okay 🩷", "Got it 🩷", "Sure 🩷"]),
            pick([
              "I've noted you mentioned pelvic pain or cramps 🩷 Are you also noticing any of these?",
              "I remember you mentioned cramping — keeping that in mind 🩷 Anything else going on?",
            ]),
          ];
        }
        return [pick(["Okay 🩷", "Got it 🩷", "Sure 🩷"]), "Are you noticing any of these symptoms right now?"];
      },
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
      say() {
        const insightLine = buildSymptomInsightLine();
        return [
          "Thanks for walking through this with me 🩷",
          "Based on what you've shared, your late period could be related to recent changes, hormonal shifts, or possible pregnancy.",
          "I can't diagnose conditions, but noticing patterns over time is really important.",
          ...(insightLine ? [insightLine] : []),
          "If late or missed periods happen often, especially along with symptoms like acne, increased facial/body hair, weight changes, or ongoing mood shifts, some people choose to ask a healthcare provider about possible hormonal imbalances.",
          "That doesn't mean anything is 'wrong', just that your hormones may need a closer look.",
          "You might consider:\n• Continuing to track your cycle\n• Noting other symptoms over time\n• Reaching out to a healthcare provider if delays keep happening",
          "You're doing the right thing by checking in and listening to your body 🩷",
          "Would you like help with anything else today?",
        ];
      },
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },

    /* ---------------- SPOTTING ---------------- */
    SPOT_INTRO: {
      say() {
        return [
          pick([
            `${ack()} Spotting can feel confusing, especially when it shows up out of nowhere 🩷`,
            "Unexpected spotting is unsettling, let's work out what's going on 🩷",
            "Spotting outside your period can mean a few different things. Let's narrow it down 🩷",
            "Okay, spotting. This is worth looking at properly, you were right to bring it up 🩷",
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
        "Light spotting at the very start or end of a period can be normal for many people, sometimes it's just your uterus finishing up.",
        "If it stays light, doesn't come with strong pain, and doesn't drag on for days and days, it's usually not a big concern.",
        "If you ever notice it getting heavier, lasting longer than usual, or coming with dizziness or severe cramps, that's a reason to check in with a provider.",
        "Want to go back to the main options, or talk about something else you noticed?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    SPOT_NOTSURE_TIMING: {
      say: [
        "That's totally okay 🩷",
        "Sometimes spotting is so light that it's hard to place in the cycle, especially if your period isn't super regular.",
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
        "It's usually light and short, but we'll still check a few details to be safe.",
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
      say: [pick(["Okay 🩷", "Got it 🩷", "Thanks 🩷"]), "Would you say it's mostly just when you wipe / a few drops… or more like a light flow?"],
      question: "Spotting amount",
      choices: [
        { id: "wipe", label: "Just when I wipe / a few drops", next: "SPOT_PREG_Q", primary: true },
        { id: "light", label: "More like a light flow", next: "SPOT_SYMPTOMS_MULTI" },
        { id: "ns", label: "Not sure", next: "SPOT_PREG_Q" },
      ],
    },
    SPOT_SYMPTOMS_MULTI: {
      say() {
        const pelvicKnown   = ctx.entityHistory?.some(e => e.symptoms?.pelvic);
        const dizzyKnown    = ctx.entityHistory?.some(e => e.symptoms?.dizziness);
        const acks = [
          ...(pelvicKnown ? [pick(["I've noted you mentioned pelvic pain or cramps 🩷", "I've got that you mentioned cramping 🩷"])] : []),
          ...(dizzyKnown  ? [pick(["I've noted you mentioned dizziness 🩷", "I remember you mentioned feeling dizzy, keeping that in mind 🩷"])] : []),
        ];
        return [
          "Thanks for sharing 🩷",
          "Spotting that lasts more than a couple days, or feels heavier than expected, is worth paying attention to.",
          ...acks,
          "Let's check for anything that would make this more urgent.",
        ];
      },
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
        { id: "menu", label: pickMainLabel(),        next: "START_MENU" },
        { id: "done", label: pickCloseLabel(),    next: "CLOSE" },
      ],
    },
    SPOT_PATTERN_CHECK: {
      say: [pick(["Okay 👍🏽", "Got it 👍🏽", "Thanks 🩷"]), "Even without other symptoms, spotting can be useful information, especially if it becomes a pattern.", "Has this type of spotting happened more than once in recent cycles?"],
      question: "Spotting more than once recently?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_TRACK_WRAP", primary: true },
        { id: "no", label: "No", next: "SPOT_TRACK_WRAP" },
        { id: "ns", label: "Not sure", next: "SPOT_TRACK_WRAP" },
      ],
    },
    SPOT_PREG_Q: {
      say: [pick(["Okay 🩷", "Got it 🩷", "Sure 🩷"]), "Next check: pregnancy can sometimes cause light spotting, especially early on.", "Is there any chance of pregnancy this cycle?"],
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
        "If there's any chance of pregnancy, a test can help give clarity, especially if your period is late or your symptoms feel different than usual.",
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
        "Hormonal birth control changes can cause spotting while your body recalibrates, especially in the first 1–3 months.",
        "It often improves over time, but tracking it helps you know if it's settling down or getting more frequent.",
        "If spotting becomes heavy, persistent, or comes with pain or unusual discharge, it's worth checking in with a provider.",
        "Want to go back to the main options?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    SPOT_TRACK_WRAP: {
      say() {
        // Surface symptom/pattern intelligence on the spotting monitor path.
        // insightLine takes priority; patternLine fills in when no insight fires.
        const insightLine = buildSymptomInsightLine();
        const patternLine = !insightLine
          ? buildSymptomPatternLine(["VAGINAL_BLEEDING", "SPOTTING", "PELVIC_PAIN", "CRAMPS"])
          : null;
        return [
          "Thanks for walking through that with me 🩷",
          "Based on what you've shared, this spotting may be related to normal cycle changes (like ovulation), hormone fluctuations, birth control adjustments, or other non-emergency causes.",
          ...(insightLine ? [insightLine] : patternLine ? [patternLine] : []),
          "Tracking helps you catch patterns early, and it also makes it easier to explain if you ever decide to see a provider.",
          "If you want a simple tracking checklist:",
          "• Color (pink/red/brown)\n• Amount (wipe-only vs light flow)\n• Days it lasted\n• Cycle day / timing\n• Any pain, odor, dizziness, or fever",
          "If spotting becomes frequent, lasts longer, becomes heavier, or comes with pain/unusual discharge/dizziness, it may be a good idea to talk with a healthcare provider.",
          "Would you like to go back to the main options, or check another symptom?",
        ];
      },
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    SPOT_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "Want to check anything else while you're here?"],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
  };
}
