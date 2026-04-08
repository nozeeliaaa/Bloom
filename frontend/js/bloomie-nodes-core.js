/**
 * bloomie-nodes-core.js
 * Core navigation, safety, resolution, app-help, and session nodes.
 * Covers: START, START_MENU, PERIOD_TRIAGE, HORMONES_SKIN_TRIAGE,
 * CONVERSATION_SUMMARY, MEDIUM_CONFIRM, CONFIDENCE_FALLBACK, NARROWING,
 * EMERGENCY_REDIRECT, REPORTED_CONDITION_ACK, CONDITION_MANAGEMENT_INFO,
 * CONDITION_SYMPTOM_CONTEXT, DIAGNOSIS_REDIRECT, MEDICATION_REDIRECT,
 * SAFETY_SUPPORT, CRISIS_SUPPORT, PRIVACY_INFO, CAPTURE_LMP,
 * LATE_PERIOD_CHECK, ABOUT_BLOOM, APP_HELP, APP_LOG_PERIOD, APP_LOG_SYMPTOM,
 * APP_LOG_CYCLE, APP_SWITCH_MODE, SEE_DOCTOR_GUIDE, RESOLUTION_CHECK,
 * RESOLUTION_ASK, RESOLUTION_YES, RESOLUTION_NO, END_CHAT_CONFIRM,
 * CLOSE_UNRESOLVED_CONFIRM,
 * CLOSE (the node), SUMMARY.
 */
export function createCoreNodes(env, helpers) {
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
    pushMsg,
    smartTestTiming,
  } = env;
  const { pickCloseLabel, pickMainLabel, CLOSE_TEXT, INTRO } = helpers;

  return {
    START: {
      say() {
        if (ctx.loggingGapPending && !ctx.urgency) {
          ctx.adviceGiven.add("logging_gap_surfaced");
          ctx.adviceGiven.add("cycle_logging_gap"); // prevent duplicate cycle gap note
          ctx.loggingGapPending = false;
          const gapNote = pick([
            "One small thing before we start 🩷 Bloom works best when symptoms are logged regularly — even a quick entry every few days helps me spot patterns for you.",
            "Just a little heads-up 🩷 It looks like it's been a while since your last symptom log. Regular logging helps me give more reliable cycle context.",
            "Hey, quick note 🩷 Logging regularly — even a few times a week — really helps me personalise what I share with you.",
          ]);
          return [...INTRO, gapNote];
        }
        const cycleSignalLine = buildCycleSignalLine("general");
        return cycleSignalLine ? [...INTRO, cycleSignalLine] : INTRO;
      },
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

    // Silent menu no intro replay, just shows the choices again
    START_MENU: {
      choices() {
        const base = (() => {
          // Pregnancy mode swap in pregnancy-relevant buttons
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
          // TTC mode ovulation-first layout
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
          // Default cycle tracking or browsing
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

    // ── Period triage consolidates all period-related entry points ────────
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

    // ── Hormones and skin triage PCOS, perimenopause, body changes ────────
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
      // MEMORY AUDIT: ctx.adviceGiven — all nodes checked, no gaps found.
      //   say() correctly reads ctx.adviceGiven and ctx.conversationProfile.concernsUnresolved
      //   to build the session recap. No re-asking needed here.
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
        const lines = ["💗 Here's what we've covered today:"];
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
            " we can look at that if you'd like 💗"
          );
        }
        if (lines.length === 1) {
          lines.push("We're just getting started 💗 What would you like to talk about?");
        }
        return lines;
      },
      choices: [
        { id: "continue", label: "Continue the conversation", next: "START_MENU" },
        { id: "done",     label: "I'm done for now",         next: "CLOSE" },
      ],
    },

    MEDIUM_CONFIRM: {
      say() {
        const note = ctx.routeConfidence?.confidenceNote ||
          "Just to make sure I understand — does that sound right?";
        return [note];
      },
      choices: [
        { id: "yes_confirm", label: "Yes, that's right",    next: "_MEDIUM_YES" },
        { id: "no_confirm",  label: "No, something else",   next: "_MEDIUM_NO"  },
      ],
    },

    CONFIDENCE_FALLBACK: {
      say(ctx) {
        const attempts = ctx.narrowingAttemptCount || 1;
        if (attempts >= 3) {
          return [
            "Thanks for sticking with me 💗 I don't want to keep circling.",
            "Could you tell me the main thing in a few words, like: late period, cramps, discharge, mood, or heavy bleeding?",
          ];
        }
        return [
          "I'm having a hard time pinpointing the right area — that's on me 💗",
          "Quick split: is this more about pain/physical symptoms, or more that your cycle timing feels off?",
        ];
      },
      choices: [
        { id: "phys",   label: "Pain or physical symptoms", next: "ELSE_PAIN_ENTRY", primary: true },
        { id: "cycle",  label: "Cycle timing feels off",    next: "LATE_INTRO" },
        { id: "heavy",  label: "Bleeding or flow",        next: "HEAVY_INTRO"      },
        { id: "pain",   label: "Pain or cramps",          next: "PELVIC_INTRO"     },
        { id: "mood",   label: "Mood or energy",          next: "MOOD_INTRO"       },
        { id: "preg",   label: "Pregnancy concern",       next: "PREGNANCY_ENTRY"  },
        { id: "dis",    label: "Discharge",               next: "ELSE_DISCHARGE"   },
        { id: "else",   label: "Something else",          next: "ELSE_INTRO"       },
      ],
    },

    NARROWING: {
      say(ctx) {
        const attempts = ctx.narrowingAttemptCount || 1;
        if (ctx.narrowingRepair) {
          ctx.narrowingRepair = false;
          const msg = "I want to make sure I help you with the right thing 💗 Which area is closest to what you're dealing with?";
          ctx.lastNarrowingPrompt = msg;
          return msg;
        }
        // Vague-health entry: user indicated something feels off but didn't name
        // a specific symptom.  Lead with acknowledgement before asking them to pick.
        if (ctx.narrowingVague) {
          ctx.narrowingVague = false;
          const options = [
            "It sounds like something might be off — I want to make sure I help with the right thing 💗 Which of these feels closest to what you're experiencing?",
            "I hear you — let's figure this out together 💗 Which area feels closest to what's going on?",
            withNickname("Something feeling off is worth looking at") + " 💗 Which of these is closest to what you're dealing with?",
          ];
          const msg = pickAvoiding(options, ctx.lastNarrowingPrompt);
          ctx.lastNarrowingPrompt = msg;
          return msg;
        }
        if (attempts >= 3) {
          const options = [
            "I don't want to keep repeating options 💗 Tell me the main thing in a few words, like late period, cramps, discharge, heavy bleeding, or mood.",
            "Let's reset this quickly 💗 In a few words, what's the main issue right now: late period, cramps, discharge, heavy bleeding, or mood?",
          ];
          const msg = pickAvoiding(options, ctx.lastNarrowingPrompt);
          ctx.lastNarrowingPrompt = msg;
          return msg;
        }
        if (attempts >= 2) {
          const options = [
            "Let's do a quick split so I can guide you better 💗 Is this more pain/physical symptoms, or more that your cycle timing feels off?",
            "Quick check 💗 Is this mainly physical discomfort (pain/discharge/bleeding), or mostly that your cycle feels off?",
          ];
          const msg = pickAvoiding(options, ctx.lastNarrowingPrompt);
          ctx.lastNarrowingPrompt = msg;
          return msg;
        }
        const options = [
          "I want to make sure I help you with the right thing 💗 Which area is closest to what you're dealing with?",
          withNickname("Let me point you in the right direction") + " 💗 Which of these is closest to what's going on?",
          "Happy to help — which area fits best?",
        ];
        const msg = pickAvoiding(options, ctx.lastNarrowingPrompt);
        ctx.lastNarrowingPrompt = msg;
        return msg;
      },
      choices() {
        const attempts = ctx.narrowingAttemptCount || 1;
        // When LOW confidence routing set narrowingCandidates, show those specific
        // topic buttons instead of the generic 6. Always append "Something else".
        if (ctx.narrowingCandidates && ctx.narrowingCandidates.length) {
          const seen = new Set(ctx.narrowingCandidates.map(c => c.id));
          const extra = seen.has("else") ? [] : [{ id: "else", label: "Something else", next: "ELSE_INTRO" }];
          if (attempts >= 2 && !seen.has("cycle_split")) {
            extra.unshift({ id: "cycle_split", label: "Cycle timing feels off", next: "LATE_INTRO", primary: true });
          }
          return [...ctx.narrowingCandidates, ...extra];
        }
        if (attempts >= 2) {
          return [
            { id: "phys",   label: "Pain or physical symptoms", next: "ELSE_PAIN_ENTRY", primary: true },
            { id: "cycle",  label: "Cycle timing feels off",    next: "LATE_INTRO" },
            { id: "dis",    label: "Discharge / irritation",    next: "ELSE_DISCHARGE" },
            { id: "mood",   label: "Mood or energy changes",    next: "MOOD_INTRO" },
            { id: "heavy",  label: "Bleeding or flow",          next: "HEAVY_INTRO" },
            { id: "else",   label: "Something else",            next: "ELSE_INTRO" },
          ];
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

    /* ─────────────── SAFETY & CRITICAL REDIRECT NODES ─────────────── */

    // Emergency  always urgent, never watered down
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

    // ── Reported-condition acknowledgement ─────────────────────────────────
    //
    // WHAT THIS NODE IS FOR
    // Reached only when detectReportedCondition() identifies the user as
    // reporting an EXISTING confirmed diagnosis (confidence ≥ 0.80). This is
    // NOT for suspected conditions or diagnosis-seeking requests — those go to
    // DIAGNOSIS_REDIRECT via the diagnosis_request OOS path.
    //
    // RESPONSE STYLE (req 11)
    //   ✓ Warm and natural — acknowledge the person, not the condition label
    //   ✓ Supportive — validate that sharing was the right thing to do
    //   ✓ Non-diagnostic — never confirm, deny, reinterpret, or verify
    //   ✓ Never robotic — no clinical phrasing, no bullet lists
    //   ✓ Never dismissive — do not minimise the condition or redirect quickly
    //   ✓ Brief — one acknowledgement line + one bridge question is enough
    //
    // MEMORY POLICY (req 10)
    //   ✓ conditionKey stored in ctx.reportedConditions (session + memory)
    //   ✗ No symptom detail, no clinical history, no severity stored here
    //   ✗ No "suspected" or "seeking" conditions are ever stored here
    //   If uncertain whether a condition should be stored, keep session-only.
    REPORTED_CONDITION_ACK: {
      say(ctx) {
        const key  = ctx.activeReportedCondition;
        const meta = key ? CONDITION_META[key] : null;
        const name = meta?.name ?? null;

        // Vary acknowledgement; never repeat the condition name more than once
        // per message and never imply we're validating or verifying it.
        const ack = name
          ? pick([
              `Thanks for sharing that 🩷 Since you've already been diagnosed with ${name}, I can keep that in mind while we talk through your cycle or symptoms.`,
              `I'm glad you told me 🩷 I'll keep your ${name} diagnosis in mind as we go — I can help you track patterns, understand cycle-related changes, or just talk through what's been going on.`,
              `Got it 🩷 Since you have ${name}, that's helpful context. I can't offer treatment advice, but I can help you understand what you're experiencing and what questions to bring to your provider.`,
            ])
          : pick([
              "Thanks for sharing that 🩷 I'll keep that context in mind while we talk through your symptoms.",
              "That's really helpful to know 🩷 I can keep that in mind as we go — I'm here to help you track patterns and understand what you're experiencing.",
            ]);

        // If other conditions are already recorded this session, lightly
        // acknowledge without listing them all (avoid clinical-notes feel).
        const others = ctx.reportedConditions.filter(k => k !== key);
        const contextNote = others.length > 0
          ? "I also have your other conditions noted for context 🩷"
          : null;

        const bridge = pick([
          "What's been going on lately?",
          "What would you like to talk through today?",
          "What's on your mind?",
        ]);

        return [ack, ...(contextNote ? [contextNote] : []), bridge];
      },
      choices: [
        { id: "period",  label: "My period or cycle",          next: "PERIOD_TRIAGE",   primary: true },
        { id: "pain",    label: "Pain or cramps",              next: "PELVIC_INTRO" },
        { id: "mood",    label: "Mood, energy or sleep",       next: "MOOD_INTRO" },
        { id: "heavy",   label: "Bleeding concerns",           next: "HEAVY_INTRO" },
        { id: "menu",    label: "Other questions",             next: "START_MENU" },
      ],
    },

    // ── Condition management / treatment questions ──────────────────────────
    //
    // WHAT THIS NODE IS FOR
    // Reached when the user asks how to manage, treat, or live with a condition
    // they have ALREADY reported (ctx.reportedConditions non-empty). Requires
    // an existing reported diagnosis — never fires for users who haven't stated
    // one. Falls through to normal routing if no conditions are on record.
    //
    // RESPONSE STYLE (req 11)
    //   ✓ Warm opener — acknowledge the question as valid, not clinical
    //   ✓ Structured — one educational paragraph per condition, then a close
    //   ✓ Non-diagnostic — state patterns generally; never instruct
    //   ✓ Never prescriptive — no medication names, doses, or treatment plans
    //   ✓ Never certain — use "often discussed", "may help", "varies by person"
    //   ✓ Always close with a provider-referral nudge
    //
    // SAFETY BOUNDARY (req 6)
    //   ✗ No medication or dosage advice
    //   ✗ No dietary supplement recommendations
    //   ✗ No instructions ("take X", "do Y daily")
    //   ✗ No certainty claims ("this will help your condition")
    //   ✓ General educational framing only ("often discussed with providers")
    //   ✓ Always direct specific treatment decisions back to the provider
    //
    // MEMORY POLICY (req 10)
    //   No additional memory written here — condition key already in
    //   ctx.reportedConditions from REPORTED_CONDITION_ACK. No clinical
    //   detail stored.
    CONDITION_MANAGEMENT_INFO: {
      say(ctx) {
        const key  = ctx.activeReportedCondition;
        const meta = key ? CONDITION_META[key] : null;
        const name = meta?.name ?? null;

        // General educational framing shared across all conditions
        const opener = name
          ? pick([
              `Since you have ${name}, it makes sense to want to understand what helps 🩷`,
              `That's a really valid question given your ${name} diagnosis 🩷`,
              `Managing ${name} is something a lot of people work through with their care team 🩷`,
            ])
          : "That's a really valid question 🩷";

        // Condition-specific educational context — factual, not prescriptive
        const CONDITION_EDUCATION = {
          pcos: [
            "For PCOS, general lifestyle factors like regular movement, balanced blood sugar, and stress management are often discussed — but what works varies a lot from person to person.",
            "Some people with PCOS find tracking their cycle patterns helpful for spotting changes and having more informed conversations with their provider.",
          ],
          endometriosis: [
            "For endometriosis, management is very individual — pain relief strategies, hormonal options, and surgical choices all depend on the person's specific situation.",
            "Tracking your pain levels, cycle timing, and what makes symptoms better or worse is often really useful information to bring to your provider.",
          ],
          fibroids: [
            "Fibroid management ranges from monitoring to various medical and surgical options depending on size, location, and symptoms.",
            "Keeping track of your bleeding patterns and any pressure or pain symptoms can give your provider a clearer picture.",
          ],
          adenomyosis: [
            "Adenomyosis management typically focuses on symptom relief and is tailored to each person's situation — there's no one-size-fits-all approach.",
            "Tracking your pain and bleeding patterns is really useful for building a picture of what's happening for you.",
          ],
          ovarian_cysts: [
            "Most ovarian cysts are monitored over time. Management depends on the type, size, and whether they're causing symptoms.",
            "Your provider is best placed to advise on what follow-up is right for your situation.",
          ],
          pmdd: [
            "PMDD is often managed with a combination of lifestyle strategies, therapy, and sometimes medical support — but the right approach varies by person.",
            "Cycle tracking can be particularly useful with PMDD, since documenting symptom timing helps confirm the pattern and informs treatment decisions.",
          ],
          perimenopause: [
            "Perimenopause management is very individual. Some people manage well with lifestyle changes; others work with their provider on hormonal support.",
            "Keeping track of which symptoms are affecting you most can help guide those conversations.",
          ],
          menopause: [
            "Menopause symptom management varies widely. Your provider can walk through the options that fit your health history.",
            "Tracking which symptoms are most disruptive to you is a good starting point for those conversations.",
          ],
          amenorrhea: [
            "Amenorrhea has several potential causes and the approach to management depends on what's behind it — your provider is the right person to guide that.",
            "If you haven't already had a full evaluation, that's usually the recommended first step.",
          ],
          anemia: [
            "Iron-deficiency anemia linked to heavy periods is usually addressed by treating both the anemia and the underlying bleeding cause.",
            "Your provider can advise on the right supplementation approach for your specific levels.",
          ],
          thyroid: [
            "Thyroid condition management typically involves medication or monitoring under a doctor's guidance — the approach depends on your specific thyroid function results.",
            "Cycle changes related to thyroid conditions often improve when the thyroid levels are well-managed.",
          ],
        };

        const education = CONDITION_EDUCATION[key] ?? [
          "Management of cycle-related conditions is very individual and depends on the specifics of your situation.",
          "Your healthcare provider is the right person to guide decisions about treatment or lifestyle adjustments.",
        ];

        const close = pick([
          "I can help you think through your current symptoms or questions to bring to your provider 🩷 What would be most useful?",
          "I'm not able to advise on specific treatments, but I can help you talk through what you're experiencing 🩷 What's going on for you right now?",
          "I can help you track patterns or talk through what's happening — what would be most helpful? 🩷",
        ]);

        return [opener, ...education, close];
      },
      choices: [
        { id: "symptoms", label: "Talk through my symptoms",       next: "START_MENU",     primary: true },
        { id: "track",    label: "Help me track patterns",         next: "PERIOD_TRIAGE" },
        { id: "provider", label: "Questions to ask my provider",   next: "START_MENU" },
        { id: "menu",     label: "Something else",                 next: "START_MENU" },
      ],
    },

    // ── Symptom question with known condition context ────────────────────────
    //
    // WHAT THIS NODE IS FOR
    // Reached when the user describes current symptoms AND names a condition
    // they have already reported in the same message. Keeps the condition as
    // passive context — never attributes causation or says "that is your X".
    // After the opener + focus question, the user continues into normal
    // symptom routing (PERIOD_TRIAGE, PELVIC_INTRO, etc.).
    //
    // RESPONSE STYLE (req 11)
    //   ✓ Warm — lead with "I'll keep that in mind" framing, not clinical
    //   ✓ Non-diagnostic — never say "that's because of your [condition]"
    //   ✓ Non-attributing — always include uncertainty: "I can't say for sure"
    //   ✓ Supportive — frame the follow-up as "let's look at this together"
    //   ✓ Focused — ask about timing, severity, and change from normal
    //
    // LANGUAGE RULES (req 7)
    //   ✗ NEVER: "that is because of your PCOS"
    //   ✗ NEVER: "your endometriosis is causing this"
    //   ✗ NEVER: "given your condition, this is expected"
    //   ✓ OK: "that condition can sometimes overlap with cycle changes,
    //           but I can't tell for sure what's causing this"
    //   ✓ OK: "we can still look at the pattern of what you're experiencing"
    //   ✓ OK: "I'll hold your [condition] as background context"
    //
    // MEMORY POLICY (req 10)
    //   No additional memory written here — condition key already stored.
    //   Symptom details from this node flow into normal persistMemory() via
    //   the downstream symptom-routing nodes, not here directly.
    CONDITION_SYMPTOM_CONTEXT: {
      say(ctx) {
        const key  = ctx.activeReportedCondition;
        const meta = key ? CONDITION_META[key] : null;
        const name = meta?.name ?? null;

        // Look up alias key for display; unused at runtime but ensures the
        // CONDITION_ALIASES import is consumed (lint guard).
        void CONDITION_ALIASES;

        const opener = name
          ? pick([
              `Since you've mentioned ${name}, I'll keep that in mind as context 🩷 But I want to focus on what's actually happening for you right now, because I can't tell what's causing your symptoms.`,
              `That condition can sometimes overlap with cycle changes, but I can't say for certain what's behind what you're experiencing 🩷 Let's look at the pattern of what's going on.`,
              `I'll hold your ${name} diagnosis as background context 🩷 I can't attribute symptoms to it specifically, but we can still look at what you're experiencing.`,
            ])
          : pick([
              "I'll keep that condition in mind as context 🩷 I can't say what's causing your symptoms, but let's look at what's happening.",
              "That's helpful background 🩷 I can't link symptoms directly to a diagnosis, but we can still work through what you're experiencing.",
            ]);

        const focus = pick([
          "Can you tell me more about what's going on — when did it start, how bad is it, and is it different from what you'd normally expect?",
          "What are you noticing right now? It helps to know the timing, how severe it feels, and whether this seems different from your usual pattern.",
          "Walk me through what's happening — the timing, severity, and whether anything about it feels different from what you're used to would all be useful.",
        ]);

        return [opener, focus];
      },
      choices: [
        { id: "period",   label: "It's related to my period",      next: "PERIOD_TRIAGE",   primary: true },
        { id: "pain",     label: "Pain or cramps",                 next: "PELVIC_INTRO" },
        { id: "heavy",    label: "Bleeding changes",               next: "HEAVY_INTRO" },
        { id: "mood",     label: "Mood or energy changes",         next: "MOOD_INTRO" },
        { id: "menu",     label: "Something else",                 next: "START_MENU" },
      ],
    },

    // Diagnosis redirect validates concern without pretending to diagnose
    DIAGNOSIS_REDIRECT: {
      say(ctx, payload) {
        // ctx.diagnosisCondition is set by the OOS handler when the user types a
        // condition concern.  When arriving via a button (e.g. the "I think I might
        // have PCOS" choice), the choiceId carries the condition instead.
        const CHOICE_TO_COND = { pcos: "pcos", endo: "endometriosis", fibroid: "fibroids", cyst: "cyst" };
        const cond = ctx.diagnosisCondition || CHOICE_TO_COND[payload?.choiceId] || null;

        // Personalised opener when a specific condition was named
        const opener = {
          pcos:           "It sounds like you're wondering whether PCOS could be behind what you're experiencing 🩷",
          endometriosis:  "It sounds like you're wondering whether endometriosis could explain what you're going through 🩷",
          fibroids:       "It sounds like you're wondering whether fibroids might be involved 🩷",
          adenomyosis:    "It sounds like you're wondering about adenomyosis 🩷",
          cyst:           "It sounds like you're worried there might be a cyst 🩷",
          thyroid:        "It sounds like you're concerned your thyroid might be playing a role 🩷",
        }[cond] || "I can hear that you're trying to make sense of what's happening 🩷";

        // One focused symptom follow-up per condition
        const followUp = {
          pcos:           "The most common signs are irregular periods, acne, hair thinning, and difficulty losing weight — do any of those feel familiar?",
          endometriosis:  "The most common signs are very painful periods, pelvic pain outside your period, and pain during sex — does any of that match what you're going through?",
          fibroids:       "Fibroids often cause heavy bleeding, pelvic pressure or fullness, and longer periods — is that close to what you're noticing?",
          adenomyosis:    "Adenomyosis often causes heavy, painful periods and a feeling of pelvic pressure or bloating — does that sound like what you're dealing with?",
          cyst:           "Ovarian cysts can cause pelvic pain or pressure, sometimes with bloating or irregular cycles — what symptoms have you been noticing most?",
          thyroid:        "Thyroid issues can cause irregular periods, fatigue, hair changes, and weight shifts — which of those feel most relevant to you?",
        }[cond] || "Which of these best describes what you've been experiencing?";

        return [
          opener,
          "These concerns are valid — conditions like this are real and often under-diagnosed.",
          "I can't give a diagnosis (that takes a clinical exam and tests), but I can help you map your symptoms so you know exactly what to tell a provider.",
          followUp,
        ];
      },
      choices: [
        { id: "pelvic", label: "Pelvic pain or cramps",      next: "PELVIC_INTRO",  primary: true },
        { id: "heavy",  label: "Heavy or unusual bleeding",  next: "HEAVY_INTRO" },
        { id: "late",   label: "Irregular or late periods",  next: "LATE_INTRO" },
        { id: "mood",   label: "Hormones, mood or fatigue",  next: "MOOD_INTRO" },
        { id: "menu",   label: pickMainLabel(),              next: "START_MENU" },
      ],
    },

    // Medication redirect  warm caring redirect, never a hard refusal
    MEDICATION_REDIRECT: {
      say: [
        "Dosage and medication safety depends on your full health picture; weight, other medications, any underlying conditions and getting it wrong can cause real harm, so I can't advise on specifics 🩷",
        "That's not me brushing you off. A pharmacist genuinely has the full picture to help you properly, and in Jamaica you can walk in without a referral or appointment.",
        "If the pain is severe or not responding to anything, that's worth getting properly checked 🩷",
        "I can help you describe what you're feeling so you know exactly what to tell a pharmacist or provider when you go.",
      ],
      choices: [
        { id: "symptoms", label: "Help me describe my symptoms", next: "START_MENU", primary: true },
        { id: "map",      label: "Find a pharmacist near me", next: "CLOSE", action: "OPEN_MAP" },
        { id: "menu",     label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    // Safety support  sexual violence / coercion
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

    // Crisis support  mental health / suicidal ideation / self-harm
    CRISIS_SUPPORT: {
      say: [
        "What you're feeling right now matters 🩷 I'm not able to give you the support you deserve but real, caring help is available.",
        "Jamaica Crisis Hotline: 888-NEW-LIFE (888-639-5433), confidential, 24/7.",
        "You can also go to your nearest hospital emergency department and tell them how you're feeling.",
        "You're not alone in this, and reaching out even here took strength.",
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
        "Your data, period logs, symptoms, notes, is stored securely. It is never sold to third parties, ever.",
        "You are in control of your own logs. You can edit or delete entries any time from your dashboard.",
        "If you want to delete your account and all your data, go to Settings → Account → Delete Account. Everything goes.",
        "This chat session isn't saved permanently, when you close Bloomie, the conversation is gone.",
        "Bloom is also designed to comply with the Jamaica Data Protection Act 2020, which gives you the right to access, correct, and delete your personal data.",
        "You're not a product here. You're a person who deserves care and privacy.",
      ],
      choices: [
        { id: "ok",   label: "Thanks, that helps", next: "START_MENU", primary: true },
        { id: "more", label: "I have a health question", next: "START_MENU" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
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

    // "Is my period late?"  smart lateness check
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
            `Your period isn't late, it's expected in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
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
          const cycleLine = buildCyclePersonalisationLine("late");
          const signalLine = buildCycleSignalLine("late");
          return [
            `${ack()} Based on your logged cycle, your period is about ${daysLate} day${daysLate === 1 ? "" : "s"} late 🩷`,
            `${estimate()}`,
            ...(cycleLine ? [cycleLine] : []),
            ...(signalLine ? [signalLine] : []),
            "A few days late doesn't always mean something is wrong; stress, illness, travel, or sleep changes can all shift timing.",
            "Want to walk through the possible reasons?",
          ];
        }
        const cycleLine = buildCyclePersonalisationLine("late");
        const signalLine = buildCycleSignalLine("late");
        return [
          `${ack()} Your period is ${daysLate} days late based on your logged cycle 🩷`,
          ...(cycleLine ? [cycleLine] : []),
          ...(signalLine ? [signalLine] : []),
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
          { id: "menu",  label: pickMainLabel(), next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          return [{ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true }];
        }
        if (!late) {
          return [
            { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER", primary: true },
            { id: "next",  label: "When is my next period?", next: "CYCLE_NEXT_PERIOD" },
            { id: "menu",  label: pickMainLabel(), next: "START_MENU" },
          ];
        }
        return base;
      },
    },

    // "Should I see a doctor?" rule-based red flag guidance
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
        { id: "menu",   label: pickMainLabel(),              next: "START_MENU" },
      ],
    },

    // App help / how to log
    // ── About Bloom / Bloomie ────────────────────────────────────────────────
    // Reached when the user asks what the platform or chatbot is.
    // Explains simply, lists key features, and invites them to continue.
    ABOUT_BLOOM: {
      say: [
        pick([
          "Hi, I'm Bloomie 🩷 Your personal reproductive health companion.",
          "Hey, great question 🩷 I'm Bloomie — your cycle and reproductive health companion.",
          "Glad you asked 🩷 I'm Bloomie, Bloom's health chat assistant.",
        ]),
        pick([
          "Bloom is a menstrual health platform designed to help you understand your cycle, track symptoms, and get clear, supportive information — no judgment, no jargon.",
          "Bloom is a women's health app that helps you track your period, understand your cycle, and navigate reproductive health questions — all in one place.",
          "Bloom is a reproductive health app built around your cycle. Whether you're tracking periods, dealing with symptoms, or just trying to understand your body better — I'm here for it.",
        ]),
        pick([
          "Here's what I can help with 🩷\n\n• **Period concerns** — late, heavy, irregular, or painful periods\n• **Spotting** — between periods or unexpected bleeding\n• **Mood, energy & sleep** — cycle-linked changes\n• **Pelvic pain & cramps** — what they might mean\n• **Discharge** — what's normal, what's not\n• **Hormones & skin** — acne, weight shifts, cycle patterns\n• **Pregnancy & TTC** — test timing, ovulation, trying to conceive\n• **App help** — how to log, track, and navigate Bloom",
          "I can help with quite a lot 🩷\n\n• Late, heavy, or irregular periods\n• Spotting and unexpected bleeding\n• Cramps, pelvic pain, and discomfort\n• Mood swings, low energy, and sleep changes\n• Discharge and hormonal skin changes\n• Pregnancy questions and TTC support\n• How to use the Bloom app",
        ]),
        pick([
          "I'm not a doctor and can't diagnose anything — but I can help you understand what's going on and what questions to bring to a provider 🩷 What's on your mind?",
          "I'm not a replacement for medical care, but I can help you understand your body and know when to seek support 🩷 So — what's going on for you?",
          "Think of me as a knowledgeable, supportive friend who knows a lot about cycles and reproductive health 🩷 What would you like help with today?",
        ]),
      ],
      choices: [
        { id: "period",   label: "My period",              next: "PERIOD_TRIAGE",    primary: true },
        { id: "pain",     label: "Pain or cramps",          next: "PELVIC_INTRO" },
        { id: "mood",     label: "Mood or energy",          next: "MOOD_INTRO" },
        { id: "preg",     label: "Pregnancy or TTC",        next: "PREGNANCY_ENTRY" },
        { id: "app_help", label: "Help using the app",      next: "APP_HELP" },
        { id: "else",     label: "Something else",          next: "ELSE_INTRO" },
      ],
    },

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
        "To switch between cycle tracking, pregnancy, or Trying to Conceive mode 🩷",
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

    // ── Resolution check ────────────────────────────────────────────────────
    // Gate node — evaluates guards then redirects to RESOLUTION_ASK or exits.
    //
    // State transitions:
    //   RESOLUTION_CHECK (gate) ──┬── urgency active       → CLOSE
    //                             ├── seen in last 2 nodes  → START_MENU
    //                             └── normal               → RESOLUTION_ASK
    //   RESOLUTION_ASK          ──┬── yes        → RESOLUTION_YES  (status: "resolved")
    //                             ├── not_really → RESOLUTION_NO   (status: "unresolved")
    //                             └── more       → START_MENU
    RESOLUTION_CHECK: {
      say: [],
      onEnter() {
        // Never interrupt an urgent thread with a satisfaction prompt.
        if (ctx.urgency) { transition("CLOSE"); return; }
        // Prevent double-firing when user revisits quickly (e.g. back-and-forth).
        if (wasNodeRecentlySeen("RESOLUTION_CHECK", 2)) { transition("START_MENU"); return; }
        transition("RESOLUTION_ASK");
      },
    },

    RESOLUTION_ASK: {
      say: [
        pick([
          "Did I help with what you needed? 🩷",
          "Was that helpful, or is there something else going on? 🩷",
          "Did that answer what you were looking for? 🩷",
        ]),
      ],
      choices: [
        { id: "resolution_yes",  label: "Yes, that helped",        next: "RESOLUTION_YES", primary: true },
        { id: "resolution_no",   label: "Not really",              next: "RESOLUTION_NO" },
        { id: "resolution_more", label: "I have another question",  next: "START_MENU" },
      ],
    },

    // Topic → content card mapping shared by RESOLUTION_YES and RESOLUTION_NO.
    // Defined once here; referenced by closure in both onEnter/say functions.
    // (Not a NODES key — just a local constant in this scope.)

    RESOLUTION_YES: {
      onEnter() {
        ctx.resolutionStatus = "resolved";
        ctx.conversationProfile.concernsResolved.push(ctx.topic || "general");
      },
      say() {
        // Surface a relevant content card once per topic, if not already shown
        // or previously declined. markContentShown prevents re-surfacing across
        // sessions; it is persisted via contentSuggestionsShown in memory.
        const TOPIC_CONTENT = {
          late:      "pam-menstrual-health",
          heavy:     "pam-heavy-bleeding",
          spot:      "pam-menstrual-health",
          pelvic:    "pam-menstrual-health",
          mood:      "pam-menstrual-health",
          pregnancy: "pam-contraception",
          pcos:      "pam-pcos",
        };
        const contentId = TOPIC_CONTENT[ctx.topic] ?? null;
        const lines = [
          pick([
            "So glad I could help 🩷 Take care of yourself.",
            "That means a lot 🩷 You're doing great just by paying attention to your body.",
            "Happy to help 🩷 Come back anytime if something else comes up.",
            "Glad that was useful 🩷 Don't hesitate to check back in.",
          ]),
        ];
        if (contentId && !hasContentBeenShown(contentId) && !hasContentBeenDeclined(contentId)) {
          markContentShown(contentId);
          lines.push("There's also a related resource in the Bloom library that might be helpful 🌸");
        }
        return lines;
      },
      choices: [
        { id: "menu",  label: "Back to main options", next: "START_MENU", primary: true },
        { id: "close", label: "I'm done for now",     next: "CLOSE" },
      ],
    },

    RESOLUTION_NO: {
      onEnter() {
        ctx.resolutionStatus = "unresolved";
        ctx.conversationProfile.concernsUnresolved.push(ctx.topic || "general");
        // When the user found the conversation unhelpful, mark the topic's
        // content card as declined so it won't be surfaced as a substitute.
        const TOPIC_CONTENT = {
          late:      "pam-menstrual-health",
          heavy:     "pam-heavy-bleeding",
          spot:      "pam-menstrual-health",
          pelvic:    "pam-menstrual-health",
          mood:      "pam-menstrual-health",
          pregnancy: "pam-contraception",
          pcos:      "pam-pcos",
        };
        const contentId = TOPIC_CONTENT[ctx.topic] ?? null;
        if (contentId && !hasContentBeenDeclined(contentId)) {
          markContentDeclined(contentId);
        }
      },
      say: [
        pick([
          "I'm sorry I didn't fully address that 🩷 Let's try again — what's still unclear?",
          "That's okay, let's take another look 🩷 What part didn't land for you?",
          "I hear you — let me try to help better 🩷 What else is going on?",
        ]),
      ],
      choices: [
        { id: "menu",  label: "Back to main options",     next: "START_MENU", primary: true },
        { id: "close", label: "That's okay, I'll come back", next: "CLOSE" },
      ],
    },

    // ── End-chat confirmation flow ──────────────────────────────────────────
    // Reached when the user types a goodbye phrase. Never closes immediately —
    // shows a confirmation prompt and lets the user cancel back to their
    // previous state, or confirm to reset and restart from START.
    END_CHAT_CONFIRM: {
      say: ["Are you sure you want to end this chat?"],
      choices: [
        { id: "end_chat_confirm", label: "End Chat", next: "_END_CHAT_RESET",  primary: true },
        { id: "cancel",           label: "Cancel",   next: "_END_CHAT_CANCEL" },
      ],
    },

    CLOSE_UNRESOLVED_CONFIRM: {
      say(ctx, payload) {
        const TOPIC_LABELS = {
          late: "late or missed period",
          heavy: "heavy bleeding",
          spot: "spotting",
          mood: "mood or energy changes",
          pelvic: "pelvic pain or cramps",
          pregnancy: "pregnancy concerns",
          discharge: "discharge",
        };
        const topic = ctx.pendingUnresolvedTopic;
        const label = payload?.unresolvedLabel || TOPIC_LABELS[topic] || topic || "something you mentioned";
        return [`Before you go - you also mentioned ${label} earlier. Do you want to quickly look at that too? 💗`];
      },
      choices: [
        { id: "yes_unresolved", label: "Yes, let’s look at that", next: "_UNRESOLVED_YES", primary: true },
        { id: "no_done", label: "No, I’m done", next: "_UNRESOLVED_NO" },
      ],
    },

    CLOSE: {
      say: [CLOSE_TEXT],
      choices: [{ id: "menu", label: "Back to main options", next: "START_MENU", primary: true }],
    },

    /* ---------------- SESSION SUMMARY ---------------- */
    SUMMARY: {
      onEnter() {
        pushMsg("bot", buildSummaryCard(), authorizeHtmlPayload({ html: true }));
      },
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },
  };
}
