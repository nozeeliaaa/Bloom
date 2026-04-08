/**
 * bloomie-nodes-pregnancy.js
 * Pregnancy test timing nodes and abortion/decision-support nodes.
 * Covers: TEST_*, ABORTION_*.
 */
export function createPregnancyNodes(env, helpers) {
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
  const { pickCloseLabel, pickMainLabel, CLOSE_TEXT, INTRO, computeTestPlan } = helpers;

  return {
    /* ---------------- PREGNANCY TEST ---------------- */
    TEST_INTRO: {
      say: [pick([
        "Okay 🩷 Let me help you figure out the right time to test. What best describes your situation?",
        "Sure 🩷 Let's figure out the right time for you to test. What best describes your situation?",
        "Got it 🩷 I can help with test timing — what best describes your situation?",
      ])],
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
      // MEMORY AUDIT: ctx.captureData — all nodes checked, no gaps found.
      //   say() correctly reads ctx.captureData.expectedPeriodDate and ctx.captureData.sexDate
      //   before computing the test plan. No re-asking needed here.
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
            `${ack()} That recommended test date has already passed, so you can test **today** 🩷`,
            // Research anchor: cluster-sensitive safety net for test context.
            "If you also have severe one-sided pain, heavy bleeding, or feel faint, seek urgent care instead of waiting.",
            "First morning urine gives the clearest result.",
            `If it comes back negative but your period still hasn't arrived, retest again around **${fmtDate(retestDate)}** (48–72 hours from now).`,
          ];
          if (plan.bothDatesAvailable && plan._fromPeriod && plan._fromSex) {
            lines.splice(1, 0,
              `Based on your missed period you could test from **${fmtDate(plan._fromPeriod)}**. Based on the sex date the most reliable result would be from **${fmtDate(plan._fromSex)}**, both are already past, so test today.`
            );
          }
          return lines;
        }

        // Can test early (10–21 days after sex) but results are less reliable
        if (plan.canTestEarly && plan.basis === "sex-date") {
          return [
            `${ack()} 🩷`,
            `You're in the early detection window, you can test from **${fmtDate(plan.primary)}** onward.`,
            "Early detection tests can pick up pregnancy from about 10 days after sex, but the result is less reliable at this stage.",
            "Testing too early can give a false negative because pregnancy hormone levels may not be high enough yet.",
            `For the most reliable result, wait until **${fmtDate(plan._fromSex)}** (21 days after sex).`,
            `If negative, retest in 48–72 hours (around **${fmtDate(plan.retest)}**).`,
            "If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.",
          ];
        }

        const lines = [`${ack()} 🩷`];

        if (plan.bothDatesAvailable && plan._fromPeriod && plan._fromSex) {
          lines.push(
            `Based on your missed period you can test from **${fmtDate(plan._fromPeriod)}**. Based on the sex date the most reliable result would be from **${fmtDate(plan._fromSex)}**.`,
            ` Best time to test: **${fmtDate(plan.primary)}**, using the later of both dates for the most reliable result.`
          );
        } else {
          const primaryLine = plan.basis === "missed-period"
            ? ` Best time to test: **${fmtDate(plan.primary)}**, the day after your expected period.`
            : ` Best time to test: **${fmtDate(plan.primary)}**, 21 days after unprotected sex.`;
          lines.push(primaryLine);
        }

        lines.push(
          "Testing too early can give a false negative because pregnancy hormone levels may not be high enough yet.",
          `If the result is negative but your period still doesn't come, retest in **48–72 hours** (around **${fmtDate(plan.retest)}**).`,
          "If severe one-sided pain, heavy bleeding, dizziness, or faintness starts, get urgent care."
        );

        if (plan.basis === "sex-date" || plan.bothDatesAvailable) {
          lines.push("If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.");
        }

        return lines;
      },
      choices: [
        { id: "late",    label: "My period is late too",   next: "LATE_INTRO", primary: true },
        { id: "log",     label: "Log that I tested today", next: "TEST_SHOW_PLAN_LOGGED",
          action: "LOG_SYMPTOM", logData: { type: "pregnancy_test", note: "Test taken, result pending" } },
        { id: "menu",    label: pickMainLabel(),            next: "START_MENU" },
        { id: "done",    label: pickCloseLabel(),       next: "CLOSE" },
      ],
    },

    // After logging a test detect retest timing
    TEST_SHOW_PLAN_LOGGED: {
      say() {
        const retestDate = addDays(new Date(), 3);
        return [
          "Logged 🩷",
          `If today's test was negative, the best time to retest is around **${fmtDate(retestDate)}**, 48–72 hours from now, ideally first morning urine.`,
          "A second negative at that point is more reliable.",
        ];
      },
      choices: [
        { id: "late", label: "My period is still late", next: "LATE_INTRO", primary: true },
        { id: "menu", label: pickMainLabel(),             next: "START_MENU" },
      ],
    },

    // ── Urgent symptoms checkpoint sits before TEST_SHOW_PLAN ──────────────
    TEST_URGENT_CHECK: {
      say: [
        "One quick check before we look at your test plan 🩷",
        // Research anchor: pregnancy concern + red-flag symptom cluster.
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
        "No problem 🩷 Irregular cycles are really common; PCOS, recently stopping birth control, postpartum, breastfeeding, and other hormonal changes can all affect when your period comes.",
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
        "Okay 🩷 A negative result isn't always final, it depends on when you tested and how.",
        // Research anchor: keep urgent screen explicit before reassurance.
        "Quick check first, are you having any of these right now: severe one-sided pain, feeling faint, heavy bleeding, or shoulder tip pain?",
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
        { id: "days2",  label: "1–2 days ago",           next: "TEST_RETEST_NOW" },
        { id: "week",   label: "3 or more days ago",     next: "TEST_NEGATIVE_TIMING" },
      ],
    },

    TEST_NEGATIVE_TIMING: {
      say: [
        "Was it first morning urine, the very first time you went to the bathroom that day?",
      ],
      choices: [
        { id: "yes_fmu", label: "Yes, first morning urine", next: "TEST_SHOW_PLAN", primary: true },
        { id: "no_fmu",  label: "No, it was later in the day", next: "TEST_RETEST_NOW" },
      ],
    },

    // ── Retest now, for users who tested recently or not first morning ───────
    TEST_RETEST_NOW: {
      say: [
        "A negative result tested too early, or not with first morning urine, may not be reliable 🩷",
        "First morning urine is the most concentrated, which means the pregnancy hormone is easiest to detect.",
        "**Retest now** if you haven't already today, use first morning urine tomorrow if you've already used the bathroom.",
        "If that also comes back negative but your period still hasn't come, let me know and we can look at next steps.",
        // Research anchor: red-flag warning signs while waiting.
        "_If you develop severe one-sided pain, feel faint, or have heavy bleeding, please seek medical care straight away._",
      ],
      choices: [
        { id: "plan",  label: "Show me when to test next", next: "TEST_SHOW_PLAN", primary: true },
        { id: "late",  label: "My period is late",         next: "LATE_INTRO" },
        { id: "menu",  label: pickMainLabel(),              next: "START_MENU" },
      ],
    },

    // ── Recent unprotected sex ────────────────────────────────────────────────
    TEST_RECENT_SEX_INTRO: {
      say(ctx) {
        const lines = [
          "Okay 🩷 The timing of a reliable test depends on how many days have passed since sex.",
          "Type the date of the unprotected sex like: 2026-02-08 (YYYY-MM-DD).",
        ];
        if (ctx.isMinor) lines.unshift("This is a safe space — I won't share anything you tell me 🩷");
        return lines;
      },
      autoNext(ctx) {
        ctx.capture = { kind: "sexDate", next: "TEST_RECENT_SEX_ROUTE" };
        return null;
      },
    },

    // Routing node checks days since sex and redirects
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
          `The **earliest** you could try an early detection test is around **${earlyDate}** but even then, a negative result could be a false negative.`,
          `For the most reliable result, wait until **${reliableDate}** (21 days after sex).`,
          "If your cycles are irregular, you've recently stopped birth control, or you have PCOS, the 21-day rule after sex is generally the most reliable guide.",
          "If pain becomes severe, bleeding gets heavy, or you feel dizzy/faint while waiting, seek urgent care.",
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
        "I hear you 🩷 I can stay with you on safety, legal context, and confidential support.",
        "I can't provide abortion instructions or planning steps.",
        "If you already took something or had a procedure, choose aftercare so we can check warning signs now.",
      ],
      choices: [
        { id: "context",  label: "Legal context",                           next: "ABORTION_HONEST_CONTEXT", primary: true },
        { id: "after",    label: "I already took something / had a procedure", next: "ABORTION_AFTERCARE_CHECK" },
        { id: "privacy",  label: "Privacy first",                           next: "ABORTION_PRIVACY" },
        { id: "support",  label: "Confidential support options",            next: "ABORTION_RESOURCES" },
        { id: "menu",     label: "Back to main options",                    next: "START_MENU" },
      ],
    },

    ABORTION_HONEST_CONTEXT: {
      say(ctx) {
        const lines = [
          "I want to be clear and honest with you 🩷",
          "In Jamaica, abortion is currently illegal under the Offences Against the Person Act.",
          "I can't help with methods, medication names, dosing, or planning.",
          "I can help with safety checks, urgent warning signs, and confidential support options.",
        ];
        if (ctx.isMinor) lines.unshift("You deserve support and safety, not judgment 🩷");
        return lines;
      },
      choices: [
        { id: "after",   label: "I need an aftercare safety check", next: "ABORTION_AFTERCARE_CHECK", primary: true },
        { id: "privacy", label: "Privacy tips",                      next: "ABORTION_PRIVACY" },
        { id: "support", label: "Confidential support options",      next: "ABORTION_RESOURCES" },
        { id: "menu",    label: pickMainLabel(),                      next: "START_MENU" },
      ],
    },

    ABORTION_AFTERCARE_CHECK: {
      say: [
        `${ack()} Your safety comes first 🩷`,
        "Are you having any warning signs now: very heavy bleeding (soaking 2+ pads/hour for 2 hours), severe or worsening belly/pelvic pain, dizziness/fainting/weakness, fever or chills, or foul-smelling/unusual discharge?",
      ],
      question: "Any abortion aftercare warning signs now?",
      choices: [
        { id: "yes", label: "Yes / maybe", next: "ABORTION_URGENT", primary: true },
        { id: "no",  label: "No, none right now", next: "ABORTION_MONITORING" },
      ],
    },

    ABORTION_URGENT: {
      say: [
        "Please get emergency care now 🩷",
        "Those symptoms can mean you need immediate medical support.",
        "Share your symptoms clearly: bleeding level, pain, dizziness/fainting, fever/chills, and discharge changes.",
        "You can keep details brief and ask for confidential care.",
      ],
      choices: [
        { id: "map",  label: "Find emergency care now", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: pickMainLabel(),            next: "START_MENU" },
      ],
    },

    ABORTION_MONITORING: {
      say: [
        "Okay, no urgent warning signs right now 🩷",
        "Keep monitoring closely over the next 24–48 hours.",
        "Go to emergency care immediately if bleeding becomes heavy, pain becomes severe or worsening, you feel dizzy/faint/very weak, you develop fever/chills, or discharge becomes foul-smelling or unusual.",
      ],
      choices: [
        { id: "urgent",  label: "I now have warning signs",        next: "ABORTION_URGENT", primary: true },
        { id: "support", label: "Confidential support options",    next: "ABORTION_RESOURCES" },
        { id: "privacy", label: "Privacy tips",                    next: "ABORTION_PRIVACY" },
        { id: "menu",    label: pickMainLabel(),                    next: "START_MENU" },
      ],
    },

    ABORTION_PRIVACY: {
      say: [
        "Privacy matters 🩷",
        "• Use private/incognito browsing and clear chat history if needed",
        "• Use a private device/session when possible",
        "• Ask any service first: “Is this confidential before I share details?”",
      ],
      choices: [
        { id: "support", label: "Show confidential support options", next: "ABORTION_RESOURCES", primary: true },
        { id: "after",   label: "Do an aftercare safety check",      next: "ABORTION_AFTERCARE_CHECK" },
        { id: "menu",    label: pickMainLabel(),                      next: "START_MENU" },
      ],
    },

    ABORTION_RESOURCES: {
      say: [
        "If you want confidential support, look for a trusted reproductive-health counsellor, clinic social worker, or licensed healthcare provider 🩷",
        "When reaching out, keep it simple: “I need confidential pregnancy support and want to understand your privacy policy first.”",
        "If you feel unwell at any point, switch to aftercare safety check immediately.",
      ],
      choices: [
        { id: "after",   label: "Do an aftercare safety check", next: "ABORTION_AFTERCARE_CHECK", primary: true },
        { id: "privacy", label: "Privacy tips",                 next: "ABORTION_PRIVACY" },
        { id: "menu",    label: pickMainLabel(),                 next: "START_MENU" },
      ],
    },
  };
}
