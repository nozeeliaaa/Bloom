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
        "I hear you 🩷",
        "Heavy flow can happen, but soaking every hour is a key signal we should check quickly; keep sipping fluids while we sort this.",
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
        "I hear you 🩷",
        "Most periods are about 3–7 days, so when bleeding keeps going, duration helps us judge risk.",
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
        "Thanks for telling me 🩷",
        "Bleeding plus dizziness or weakness can mean your body needs quicker care.",
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
          "Thanks for walking me through that 🩷",
          "This is not an emergency right now, but heavier-than-usual flow or bleeding beyond a week is worth a proper check soon.",
          ...(insightLine ? [insightLine] : []),
          "Try to get seen in the next 2–3 days, and if bleeding ramps up, pain becomes severe, or you feel faint, treat that as urgent.",
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
        const insightLine = buildSymptomInsightLine()
          || buildSymptomPatternLine(["HEAVY_FLOW", "LARGE_CLOTS", "VAGINAL_BLEEDING", "CRAMPS"]);
        return [
          "Got you 🩷",
          "The first 1–2 days can be heavier, but very fast soaking or feeling weak is not something to ignore.",
          ...(insightLine ? [insightLine] : []),
          "Monitor for 24 hours, and if flow increases, big clots appear, or dizziness starts, seek same-day care.",
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
        const cycleLine = buildCyclePersonalisationLine("late") || buildCycleSignalLine("late");
        const interpretation = cycleLine
          || "A one-off delay can happen if ovulation shifts, especially with stress, illness, or routine changes.";
        return [
          pick([
            `${ack()} waiting on your period can feel heavy 🩷`,
            "Okay, let's check this calmly 🩷",
            "That uncertainty is real, and you're not overreacting 🩷",
          ]),
          interpretation,
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
        "Got you 🩷",
        "A short delay can still be within normal variation, often from later ovulation that cycle.",
        "Track what happens next, and if pain is severe, bleeding gets heavy, or you feel faint, seek care sooner.",
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
          "That makes sense 🩷",
          ...(ctx.isMinor ? ["If your periods started within the last 1–3 years, irregular timing is very common and you're not abnormal."] : []),
          signalLine || "With irregular cycles, 'late' is harder to define, and shifts can happen from stress, hormones, or body changes.",
          "Use rough tracking for a few cycles to spot your pattern, and flag anything that keeps getting more irregular.",
          ...(ctx.isMinor ? ["If bleeding gets very heavy, pain is severe, or you feel worried, involve a trusted adult or school nurse."] : []),
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
          "If late timing comes with nausea, breast tenderness, or unusual fatigue, testing becomes more useful now.",
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
        "I hear you 🩷",
        "Pregnancy worry can feel intense even before you have clear answers.",
        "Are you feeling physically unwell right now, or is this mostly anxiety about the possibility?",
      ],
      question: "Physically unwell or anxious?",
      choices: [
        { id: "unwell",  label: "I feel physically unwell",  next: "PREG_SAFETY_CHECK",    primary: true },
        { id: "anxious", label: "Mostly anxious / not sure", next: "PREG_CLARIFY_RESELECT" },
      ],
    },
    PREG_CLARIFY_RESELECT: {
      say: [
        "You're doing okay 🩷",
        "We'll keep this simple and focus on the next useful step.",
        "What would help most right now?",
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
        "A late period can be an early pregnancy sign, so testing is the fastest way to reduce uncertainty.",
        "If severe one-sided pain, heavy bleeding, or dizziness shows up, seek urgent care right away.",
        "If your period still doesn't come in the next few days, testing is a good next step.",
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
        "Early tests can be negative or unclear before hormone levels rise enough to detect.",
        "Retesting in a few days is often clearer if your period still hasn't started.",
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
          "Stress, illness, or routine shifts can delay ovulation, which can push your period later.",
          "If pain worsens, bleeding gets heavy, or dizziness starts, treat that as a same-day check.",
          pelvicKnown
            ? pick([
                "I've already noted your cramps/pelvic discomfort, are any of these also happening?",
                "I've got your pelvic pain noted, are any of these also happening?",
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
          "From what you shared, this could be a cycle shift from recent changes, hormone timing, or possible pregnancy context.",
          ...(insightLine ? [insightLine] : []),
          "Keep tracking your pattern, and if delays keep repeating or symptoms escalate, check in with a provider.",
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
            `${ack()} spotting can feel unsettling 🩷`,
            "Unexpected spotting is frustrating, let's check it properly 🩷",
            "Okay, spotting. You did right by bringing it up 🩷",
          ]),
          "Light spotting can happen around ovulation or hormone shifts, but timing and symptoms matter.",
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
        "Got you 🩷",
        "Light spotting at the start or end of a period can be normal for some people.",
        "If it gets heavier, lasts longer than usual, or comes with strong pain/dizziness, get checked.",
        "Want to go back to main options or talk through another symptom?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    SPOT_NOTSURE_TIMING: {
      say: [
        "That's okay 🩷",
        "When cycles vary, spotting timing can be hard to place, so rough timing still helps.",
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
        "Mid-cycle spotting can happen around ovulation and is often light and short.",
        "We'll still check a few quick details to make sure there are no warning signs.",
      ],
      autoNext: () => "SPOT_YES_DURATION",
    },
    SPOT_YES_DURATION: {
      say: [
        "Thanks for sharing 🩷",
        "Duration plus symptoms is the quickest way to tell if this needs closer follow-up.",
        "Has the spotting lasted more than 2 days?",
      ],
      question: "Spotting lasted more than 2 days?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_SYMPTOMS_MULTI", primary: true },
        { id: "no", label: "No", next: "SPOT_AMOUNT_Q" },
        { id: "ns", label: "Not sure", next: "SPOT_AMOUNT_Q" },
      ],
    },
    SPOT_SYMPTOMS_MULTI: {
      say() {
        const pelvicKnown   = ctx.entityHistory?.some(e => e.symptoms?.pelvic);
        const dizzyKnown    = ctx.entityHistory?.some(e => e.symptoms?.dizziness);
        const contextLine = dizzyKnown
          ? "Since you've mentioned dizziness too, this needs a closer safety screen."
          : pelvicKnown
          ? "Since cramps are in the mix too, context matters more here."
          : "Spotting that lasts longer or feels heavier matters more when other symptoms are present.";
        return [
          "Thanks for sharing 🩷",
          contextLine,
          "Let's quickly screen for warning signs.",
        ];
      },
      multi: {
        question: "Are you experiencing any of the following along with the spotting? (select any)",
        options: ["Pelvic pain or cramps", "Unusual discharge or odor", "Dizziness or weakness", "Fever or chills", "Pain during sex", "None of these"],
        nextOnSubmit: "SPOT_SYMPTOMS_GUIDE",
        allowNone: false,
      },
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
    SPOT_SYMPTOMS_GUIDE: {
      autoNext(_ctx, payload) {
        const sel = payload.multi || [];
        return sel.length && !sel.includes("None of these") ? "SPOT_PROVIDER_SOON" : "SPOT_PATTERN_CHECK";
      },
    },
    SPOT_PROVIDER_SOON: {
      say: [
        `${ack()} thanks for sharing that 🩷`,
        "Spotting with these extra symptoms is worth a provider check soon.",
        "If symptoms worsen, fever starts, bleeding gets heavier, or you feel weak/faint, treat that as urgent.",
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
      say: [
        pick(["Okay 🩷", "Got it 🩷", "Thanks 🩷"]),
        "Even without other symptoms, repeated spotting is useful pattern information.",
        "Has this type of spotting happened more than once in recent cycles?",
      ],
      question: "Spotting more than once recently?",
      choices: [
        { id: "yes", label: "Yes", next: "SPOT_TRACK_WRAP", primary: true },
        { id: "no", label: "No", next: "SPOT_TRACK_WRAP" },
        { id: "ns", label: "Not sure", next: "SPOT_TRACK_WRAP" },
      ],
    },
    SPOT_PREG_Q: {
      say: [
        pick(["Okay 🩷", "Got it 🩷", "Sure 🩷"]),
        "Pregnancy can sometimes cause light early spotting, so this helps narrow context.",
        "Is there any chance of pregnancy this cycle?",
      ],
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
        "If pregnancy is possible, testing helps quickly separate normal spotting from pregnancy-related timing changes.",
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
      say: [
        "Got you 🩷",
        "Birth control changes can cause spotting while your body readjusts.",
        "Have you started, stopped, or changed birth control in the past few months?",
      ],
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
        "Spotting is common in the first 1–3 months after a birth-control change while hormones settle.",
        "If it becomes heavy, persistent, painful, or comes with unusual discharge, get checked.",
        "Want to go back to the main options?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    SPOT_TRACK_WRAP: {
      say() {
        const insightLine = buildSymptomInsightLine()
          || buildSymptomPatternLine(["VAGINAL_BLEEDING", "SPOTTING", "PELVIC_PAIN", "CRAMPS"]);
        return [
          "Thanks for walking through that with me 🩷",
          "This pattern can fit ovulation spotting, hormone shifts, or contraception adjustment when symptoms stay mild.",
          ...(insightLine ? [insightLine] : []),
          "Track colour, amount, and timing; if it repeats, gets heavier, or comes with pain/odor/dizziness, check with a provider.",
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
