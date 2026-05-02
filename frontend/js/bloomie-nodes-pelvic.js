/**
 * bloomie-nodes-pelvic.js
 * Pelvic pain nodes and general pain (ELSE_PAIN_*) nodes.
 * Covers: PELVIC_INTRO, PELVIC_SAFETY_GATE, PELVIC_SAFETY_CHECK,
 * PELVIC_ENTRY_GATE, CRAMPS_LATE_CONTEXT, CRAMPS_LATE_SPOT_CHECK,
 * CRAMPS_LATE_PREG_CHECK, CRAMPS_LATE_NEXT_STEP,
 * PELVIC_NOT_SURE_SAFETY, PELVIC_URGENT, PELVIC_ENTRY,
 * PELVIC_PERIOD_ROUTE, PELVIC_OVULATION_ROUTE, PELVIC_RANDOM_ROUTE,
 * PELVIC_GENERAL_ROUTE, PELVIC_SEX_ENTRY, PELVIC_SEX_ENTRY_PAIN,
 * PELVIC_SEX_DEEP_PAIN, PELVIC_SEX_AFTER_PAIN, PELVIC_SEVERITY,
 * PELVIC_IMPACT, PELVIC_PATTERN, PELVIC_RESPONSE, PELVIC_MANAGEABLE,
 * PELVIC_PERSISTENT, PELVIC_REVIEW_SOON, PELVIC_SEX_INTRO,
 * PELVIC_SEX_EXPLAIN, PELVIC_SUMMARY_DONE.
 */
export function createPelvicNodes(env, helpers) {
  const {
    ctx, say, transition, pick, ack, qualifier,
    safeFooter, buildSymptomInsightLine, buildSymptomPatternLine,
    daysUntilNextPeriod, isLateContextActive,
  } = env;
  const { pickCloseLabel, pickMainLabel } = helpers;

  function getLateCrampsContext() {
    const recent = Array.isArray(ctx.entityHistory) ? ctx.entityHistory.slice(-3) : [];
    const overdueDays = typeof daysUntilNextPeriod === "function" ? daysUntilNextPeriod() : null;
    const overdue = typeof overdueDays === "number" && overdueDays < -1;
    const lateByIntent =
      ctx.lastIntent === "late" || ctx.lastIntent === "LATE_INTRO" || ctx.lastIntent === "LATE_PERIOD_CHECK";
    const lateByHistory = recent.some(e => e?.symptoms?.late || e?.symptoms?.implicit_late);
    const lateByAssistant = typeof isLateContextActive === "function"
      ? isLateContextActive({ includePromptContext: true })
      : false;
    const spottingRecent = recent.some(e => e?.symptoms?.spotting);
    const pregnancySignalRecent = recent.some(e =>
      e?.pregnancy?.chance || e?.pregnancy?.testedYet || e?.pregnancy?.result
    );

    return {
      overdue,
      overdueDays,
      spottingRecent,
      pregnancySignalRecent,
      active: overdue || lateByIntent || lateByHistory || lateByAssistant,
    };
  }

  return {
    // Redirect kept so all existing menu buttons still reach the safety check
    PELVIC_INTRO: {
      autoNext() { return "PELVIC_SAFETY_GATE"; },
    },

    // Gate: if dizziness already mentioned, route straight to urgent without re-asking
    PELVIC_SAFETY_GATE: {
      say: [],
      onEnter() {
        const dizzyKnown = ctx.entityHistory?.some(e => e.symptoms?.dizziness);
        if (dizzyKnown) {
          say(pick(["You mentioned dizziness - that's important to flag 🩷", "I've got the dizziness you mentioned noted 🩷"]));
          const tid = setTimeout(() => transition("PELVIC_URGENT"), 1300);
          ctx.timers.add(tid);
        } else {
          transition("PELVIC_SAFETY_CHECK");
        }
      },
      choices: [],
    },

    // ── Step 1: Safety check always first ──────────────────────────────────
    PELVIC_SAFETY_CHECK: {
      say: [
        "Before we go further, I want to check something important 🩷",
        "Are you having severe or sudden pelvic pain, dizziness, fainting, fever, or a strong feeling that something is seriously wrong?",
      ],
      question: "Urgent symptoms present?",
      choices: [
        { id: "yes", label: "Yes",      next: "PELVIC_URGENT",       primary: true },
        { id: "no",  label: "No",       next: "PELVIC_ENTRY_GATE" },
        { id: "ns",  label: "Not sure", next: "PELVIC_NOT_SURE_SAFETY" },
      ],
    },
    PELVIC_NOT_SURE_SAFETY: {
      say: ["Trust that instinct 🩷 If something feels seriously wrong, getting checked is always the safer call."],
      choices: [
        { id: "map",  label: "Find care near me",       next: "START", action: "OPEN_MAP", primary: true },
        { id: "cont", label: "Continue with Bloomie",   next: "PELVIC_ENTRY_GATE" },
      ],
    },
    PELVIC_URGENT: {
      say: [
        "Please seek medical care as soon as possible 🩷",
        "Severe or sudden pelvic pain, especially with dizziness or fever, can sometimes need urgent attention. You deserve a proper assessment, not just reassurance.",
        // Research anchor: heavy bleeding + dizziness/fainting + fever are red-flag combinations.
        "If bleeding is getting heavy, pain is worsening, or you feel faint/very weak, treat that as urgent too.",
        "Please go to your nearest emergency room or urgent care centre, or call 119 in Jamaica.",
        "If you have one-sided sharp pain and there's any chance of pregnancy, that needs to be checked urgently.",
      ],
      choices: [
        { id: "map",  label: "Find emergency care", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: pickMainLabel(),         next: "START_MENU" },
      ],
    },

    // Context gate: if we already have active late-period context, ask a short
    // combined-signal clarifier flow before generic pelvic routing.
    PELVIC_ENTRY_GATE: {
      say: [],
      onEnter() {
        const lateCtx = getLateCrampsContext();
        if (lateCtx.active) {
          transition("CRAMPS_LATE_CONTEXT");
        } else {
          transition("PELVIC_ENTRY");
        }
      },
      choices: [],
    },

    CRAMPS_LATE_CONTEXT: {
      say() {
        const lateCtx = getLateCrampsContext();
        const daysLine = (typeof lateCtx.overdueDays === "number" && lateCtx.overdueDays < -1)
          ? `Since your period seems about ${Math.abs(lateCtx.overdueDays)} day${Math.abs(lateCtx.overdueDays) === 1 ? "" : "s"} late,`
          : "Since your period still seems off,";
        return [
          "Got you 🩷",
          `${daysLine} cramps can happen for a few reasons, so let's narrow it down gently.`,
          // Research anchor: late + cramps can reflect delayed cycle start, hormonal shift, or early pregnancy context.
          "Sometimes this is your period trying to start late, and sometimes it's another cycle shift worth checking.",
          "Does this feel like your usual period-type cramps, or different from usual?",
        ];
      },
      question: "Late + cramps usual vs different",
      choices: [
        { id: "usual", label: "Feels like my usual cramps", next: "CRAMPS_LATE_SPOT_CHECK", primary: true },
        { id: "diff",  label: "Feels different this time",   next: "CRAMPS_LATE_PREG_CHECK" },
        { id: "ns",    label: "Not sure",                    next: "CRAMPS_LATE_PREG_CHECK" },
      ],
    },

    CRAMPS_LATE_SPOT_CHECK: {
      say() {
        const lateCtx = getLateCrampsContext();
        return [
          lateCtx.spottingRecent
            ? "I remember you also mentioned some spotting 🩷"
            : "Quick check that helps with context 🩷",
          "Any spotting or bleeding at all right now?",
        ];
      },
      question: "Late + cramps spotting check",
      choices: [
        { id: "yes", label: "Yes, some spotting/bleeding", next: "SPOT_INTRO", primary: true },
        { id: "no",  label: "No spotting yet",             next: "CRAMPS_LATE_PREG_CHECK" },
      ],
    },

    CRAMPS_LATE_PREG_CHECK: {
      say() {
        const lateCtx = getLateCrampsContext();
        return [
          lateCtx.pregnancySignalRecent
            ? "Thanks - and I still want to keep pregnancy possibility in mind 🩷"
            : "One more useful check 🩷",
          "Any chance of pregnancy this cycle?",
        ];
      },
      question: "Late + cramps pregnancy chance",
      choices: [
        { id: "yes", label: "Yes / maybe", next: "LATE_TEST_Q", primary: true },
        { id: "no",  label: "No",          next: "CRAMPS_LATE_NEXT_STEP" },
        { id: "ns",  label: "Not sure",    next: "LATE_TEST_Q" },
      ],
    },

    CRAMPS_LATE_NEXT_STEP: {
      say: [
        "Thanks for walking through that with me 🩷",
        "With a late period plus cramps, possibilities include your period starting late, temporary hormonal delay, or other non-emergency cycle shifts.",
        // Research anchor: watch-for threshold guidance keeps this non-diagnostic but practical.
        "If pain gets stronger, bleeding turns heavy, or you feel dizzy/faint, that's a sign to get checked sooner.",
        "I can't diagnose from chat alone, but we can keep this practical and track what happens next.",
      ],
      choices: [
        { id: "late",  label: "Continue late-period support", next: "LATE_INTRO", primary: true },
        { id: "pelvic",label: "Keep looking at the cramp pattern", next: "PELVIC_PERIOD_ROUTE" },
        { id: "heavy", label: "Bleeding has started / feels heavy", next: "HEAVY_INTRO" },
        { id: "menu",  label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    // ── Step 2: Route-first entry ─────────────────────────────────────────────
    PELVIC_ENTRY: {
      say: [
        "Pelvic pain can feel really different depending on what's behind it 🩷",
        // Research anchor: phase-based reasoning (period vs ovulation vs non-cycle pattern).
        "Sometimes it's linked to your cycle, like period cramps or ovulation pain, and sometimes it isn't, so pattern matters.",
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
        // Research anchor: common period duration reference.
        "Most periods last about 3–7 days, so pain or bleeding outside your usual window is worth noting.",
        "Let's look at how it actually affects you.",
      ],
      autoNext(ctx) {
        ctx.pelvicRoute = "period";
        return "PELVIC_SEVERITY";
      },
    },
    PELVIC_OVULATION_ROUTE: {
      say: [
        "Mid-cycle pain around ovulation is actually quite common, it's sometimes called mittelschmerz 🩷",
        "It's usually one-sided, short-lived, and mild. If it keeps worsening or comes with heavy bleeding, that's a reason to check in sooner.",
        "We'll check your pattern to make sure.",
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
        "That's okay! pelvic pain can be hard to place 🩷",
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
        "Entry pain or tightness during sex can have a few causes dryness, tension, vaginismus, or sometimes an infection 🩷",
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
        "It can be connected to conditions like endometriosis, fibroids, ovarian cysts, or pelvic inflammatory disease, all diagnosable and manageable.",
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
          "Go with what actually matches your experience, not what you think you should tolerate.",
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
      say: ["Thanks for being honest 🩷", "Is this pelvic pain interfering with your daily life, like school/work, sleep, movement, or relationships?"],
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
      say() {
        const insightLine = buildSymptomInsightLine();
        return [
          "That's helpful to know 🩷",
          "Pain that responds to heat or rest is often manageable with tracking and support.",
          ...(insightLine ? [insightLine] : []),
          "Still, if it becomes stronger, lasts longer, or starts interfering with your life, that's a reason to re-check.",
          "Would you like to go back to the main options or talk about another symptom?",
        ];
      },
      choices: [
        { id: "menu", label: pickMainLabel(),    next: "START_MENU", primary: true },
        { id: "else", label: "Something else",  next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },

    // ── Step 5: Route-specific final outcomes ─────────────────────────────────
    PELVIC_PERSISTENT: {
      say(ctx) {
        const r = ctx?.pelvicRoute;
        const routeNote = (() => {
          if (r === "period") {
            return "If your period pain is this intense regularly, it may be worth asking a provider about conditions like endometriosis, not to alarm you, but because that level of pain is not something you should have to manage alone, and there are real treatment options.";
          }
          if (r === "ovulation") {
            return "Mid-cycle pain that's this persistent or intense is worth mentioning to a provider. It may still be ovulation-related, but ruling out other causes is the right move.";
          }
          if (r === "random") {
            return "Pain that shows up without a clear pattern is worth monitoring. If it keeps happening or changes in intensity, a provider can help figure out what's behind it.";
          }
          if (r === "sex_deep" || r === "sex_entry" || r === "sex_after") {
            return "Pain during sex is very treatable, the first step is identifying the cause, which a gynaecologist or sexual health provider can do properly. You don't have to live with this.";
          }
          return "Some people with ongoing pelvic pain later learn it's related to underlying causes (such as endometriosis), which only a healthcare provider can properly evaluate.";
        })();
        const insightLine = buildSymptomInsightLine();
        const patternLine = !insightLine
          ? buildSymptomPatternLine(["CRAMPS", "PELVIC_PAIN", "BLOATING", "FATIGUE"])
          : null;
        return [
          "Thanks for sharing that 🩷",
          "Pelvic pain that is persistent, severe, or doesn't respond well to relief deserves attention. Not because something is 'wrong', but because pain shouldn't be dismissed.",
          routeNote,
          ...(insightLine ? [insightLine] : patternLine ? [patternLine] : []),
          // Research anchor: practical watch-for escalation language.
          "If it starts disrupting sleep/work, comes with fever, or bleeding becomes heavy, that should be checked promptly.",
          "I can't diagnose anything, but noticing these patterns is an important step toward getting the right support.",
          ...safeFooter(),
        ];
      },
      choices: [
        { id: "map",  label: "Find care near me",  next: "START", action: "OPEN_MAP", primary: true },
        { id: "log",  label: "Log pelvic pain",    next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "pelvic_pain", note: "Pelvic pain logged from Bloomie chat" } },
        { id: "sum",  label: "Help me summarize",  next: "PELVIC_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: pickMainLabel(),        next: "START_MENU" },
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
        const insightLine = buildSymptomInsightLine();
        const patternLine = !insightLine
          ? buildSymptomPatternLine(["CRAMPS", "PELVIC_PAIN", "BLOATING", "FATIGUE"])
          : null;
        return [
          `${ack()} 🩷`,
          note,
          ...(insightLine ? [insightLine] : patternLine ? [patternLine] : []),
          // Research anchor: symptom progression threshold.
          "If it gets worse, lasts longer than your usual pattern, or comes with dizziness/fever, escalate sooner.",
          "It may be worth checking in with a healthcare provider in the next few weeks, not urgently, but soon.",
          ...safeFooter(),
        ];
      },
      choices: [
        { id: "map",  label: "Find care near me",  next: "START", action: "OPEN_MAP", primary: true },
        { id: "log",  label: "Log pelvic pain",    next: "START_MENU",
          action: "LOG_SYMPTOM", logData: { type: "pelvic_pain", note: "Pelvic pain logged from Bloomie chat" } },
        { id: "menu", label: pickMainLabel(),        next: "START_MENU" },
      ],
    },

    // ── Existing sex-specific path (kept reached via PELVIC_SEX_ENTRY "not sure") ──
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
        { id: "menu", label: pickMainLabel(),       next: "START_MENU" },
      ],
    },
    PELVIC_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "You're doing the right thing by paying attention to your body.", "Would you like help with anything else?"],
      choices: [
        { id: "menu", label: pickMainLabel(),    next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
  };
}
