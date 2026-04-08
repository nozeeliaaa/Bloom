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
          `If the result is negative but your period still doesn't come, retest in **48–72 hours** (around **${fmtDate(plan.retest)}**).`
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
        "I hear you 🩷 This is a space where you can talk, without judgment, none.",
        "Whatever has happened or is happening, you don't need to explain yourself to me. Your safety is what matters most.",
        "If you've already taken something or had any kind of procedure, watch for these warning signs and go to emergency care if any appear:",
        "🚨 Fever (38°C / 100.4°F or higher) or chills, especially lasting more than a few hours",
        "🚨 Heavy bleeding, soaking more than 2 pads per hour for 2 hours in a row",
        "🚨 Severe or worsening pain in your abdomen that isn't easing",
        "🚨 Foul-smelling discharge, or discharge that looks unusual",
        "You can get care at a hospital without having to explain why. Confidential support also exists, you don't have to go through this alone.",
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

    // Honest legal context doesn't shame, doesn't lie, doesn't advise
    ABORTION_HONEST_CONTEXT: {
      say(ctx) {
        const lines = [
          "I want to be honest with you because you deserve honesty 🩷",
          "In Jamaica, abortion is currently illegal under the Offences Against the Person Act. There are no formal legal exceptions, not even for rape or incest.",
          "This means there is no safe, legal clinical option available in-country right now.",
          "I can't tell you what to do, and I won't pretend the situation isn't hard.",
          "What I can do is help you think through your options, your safety, and how to access non-judgmental support, confidentially.",
        ];
        if (ctx.isMinor) lines.unshift("You came to the right place — I'm here to help, not to judge 🩷");
        return lines;
      },
      choices: [
        { id: "options",   label: "Talk through my options",              next: "ABORTION_DECISION_SUPPORT", primary: true },
        { id: "safe",      label: "What do I need to know to stay safe?", next: "ABORTION_SAFETY_INFO" },
        { id: "counsel",   label: "I want someone to talk to",            next: "ABORTION_RESOURCES" },
        { id: "privacy",   label: "Privacy, how to protect myself",      next: "ABORTION_PRIVACY" },
      ],
    },

    // Non-directive decision support presents all options without steering
    ABORTION_DECISION_SUPPORT: {
      say: [
        "You're not alone in this, and there's no right answer, only what's right for you 🩷",
        "People in this situation generally face three paths: continuing the pregnancy (with support or adoption), or ending it.",
        "Because of Jamaica's laws, ending a pregnancy carries serious legal and medical risk. There are no safe, legal clinical services in-country.",
        "Some people travel to access services in countries where it is legal. Others seek confidential counselling to help make a decision.",
        "Non-directive pregnancy counselling, where someone listens without pushing an agenda, exists and is confidential. Would you like help finding it?",
      ],
      choices: [
        { id: "counsel",  label: "Yes, find me confidential support",   next: "ABORTION_RESOURCES", primary: true },
        { id: "safe",     label: "I need to know about staying safe",     next: "ABORTION_SAFETY_INFO" },
        { id: "privacy",  label: "Help me protect my privacy first",      next: "ABORTION_PRIVACY" },
        { id: "after",    label: "I've already taken something",          next: "ABORTION_AFTERCARE_CHECK" },
        { id: "menu",     label: "Back to main options",                  next: "START_MENU" },
      ],
    },

    // Safety information harm reduction without method instruction
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

    // Aftercare safety check for those who've already acted
    ABORTION_AFTERCARE_CHECK: {
      say: [
        `${ack()} Your safety is the priority right now 🩷`,
        "Are you having any of these right now? Select any that apply.",
      ],
      multi: {
        question: "Warning signs- select any:",
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
        "When you arrive, you can say you are having a miscarriage, this is medically accurate and emergency rooms are required to treat you without asking for the cause.",
        "You do not have to explain anything beyond your symptoms.",
      ],
      choices: [
        { id: "map",  label: "Find emergency care now", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: pickMainLabel(),            next: "START_MENU" },
      ],
    },

    ABORTION_MONITORING: {
      say: [
        "Okay, none of the urgent warning signs right now 🩷",
        "Keep monitoring yourself over the next few days. Watch for: increasing pain, fever, heavy bleeding that starts or worsens, or anything that feels wrong.",
        "If any of those things start, treat it as urgent and go to emergency care.",
        "Would you like to connect with confidential support?",
        ...urgentFooter(),
      ],
      choices: [
        { id: "counsel",  label: "Yes, I want confidential support",   next: "ABORTION_RESOURCES", primary: true },
        { id: "privacy",  label: "Help me protect my privacy",         next: "ABORTION_PRIVACY" },
        { id: "menu",     label: pickMainLabel(),                       next: "START_MENU" },
      ],
    },

    // Privacy  practical screen/data protection guidance
    ABORTION_PRIVACY: {
      say: [
        "Privacy is real and valid, here's what you can do 🩷",
        "• Clear your chat: use the reset option in Bloomie settings if available, or close the browser tab",
        "• If someone shares your device: use an incognito/private browser window",
        "• When contacting organisations: use a number they don't know, or a messaging app with disappearing messages",
        "• What to say: 'I need confidential pregnancy options support. How do you handle privacy?'",
        "• Ask any service before sharing: 'Is this fully confidential?', you have the right to ask.",
      ],
      choices: [
        { id: "counsel",  label: "Show confidential support options",  next: "ABORTION_RESOURCES", primary: true },
        { id: "safe",     label: "What should I watch for healthwise?",next: "ABORTION_SAFETY_INFO" },
        { id: "menu",     label: pickMainLabel(),                       next: "START_MENU" },
      ],
    },

    // Resources confidential orgs operating in Jamaica
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
        { id: "menu",    label: pickMainLabel(),               next: "START_MENU" },
      ],
    },

    ABORTION_CALL_SCRIPT: {
      say: [
        "Here's what you can say, keep it simple until you know they're trustworthy 🩷",
        "📞 *'Hi, I need confidential pregnancy options support. Can you tell me how your privacy policy works before I share anything?'*",
        "If they ask for details before answering that, hang up and try somewhere else.",
        "You're allowed to ask questions first. You're allowed to say no. You're in charge of this.",
      ],
      choices: [
        { id: "resources", label: "Back to support organisations", next: "ABORTION_RESOURCES", primary: true },
        { id: "menu",      label: pickMainLabel(),                  next: "START_MENU" },
        { id: "done",      label: pickCloseLabel(),              next: "CLOSE" },
      ],
    },
  };
}
