/**
 * bloomie-nodes-mood.js
 * All mood, energy, and emotional wellbeing nodes.
 * Covers: MOOD_INTRO, MOOD_SAFETY_CHECK, MOOD_SAFETY_ROUTE, MOOD_ENTRY,
 * MOOD_ANXIETY_ROUTE, MOOD_ANXIETY_Q, MOOD_LOW_ROUTE, MOOD_LOW_Q,
 * MOOD_IRRITABLE_ROUTE, MOOD_IRRITABLE_Q, MOOD_FATIGUE_ROUTE, MOOD_FATIGUE_Q,
 * MOOD_MIXED_ROUTE, MOOD_MIXED_Q, MOOD_TIMING_SPLIT, MOOD_CYCLE_ROUTE,
 * MOOD_NONCYCLE_ROUTE, MOOD_TIMING_HELP, MOOD_SEVERITY, MOOD_IMPACT,
 * MOOD_SYMPTOMS_MULTI, MOOD_DURATION, MOOD_GUIDE, MOOD_TRIGGERS,
 * MOOD_COPING, MOOD_TRACKING, MOOD_WHEN_HELP.
 */
export function createMoodNodes(env, helpers) {
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
  const { pickCloseLabel, pickMainLabel, CLOSE_TEXT, INTRO, buildMoodContinuityLine } = helpers;

  return {
    /* ---------------- MOOD / HORMONES ---------------- */
    // Backward-compat redirect - shows symptom pattern line first if available
    MOOD_INTRO: {
      say: [],
      onEnter() {
        // MOOD_INTRO is a silent gate - personalisation is woven into MOOD_SAFETY_CHECK.
        // We transition immediately so the safety question renders with full context.
        transition("MOOD_SAFETY_CHECK");
      },
      choices: [],
    },

    // ── Step 1: Safety check always first ──────────────────────────────────
    MOOD_SAFETY_CHECK: {
      say() {
        // ── 0. Safety guard - no personalisation when urgency is active ────
        if (ctx.urgency) {
          return [
            "I want to make sure you're okay 🩷",
            "Are these feelings ever making you feel unsafe, completely unable to cope, or like you might hurt yourself?",
          ];
        }

        // ── Signals ──────────────────────────────────────────────────────────
        const userText = String(
          ctx?.lastUserMessage || ctx?.lastUserInput || ctx?.lastFreeText || ctx?.rawInput || ""
        ).toLowerCase();

        // Tone detection - ctx.currentTone is the primary source (set by detectUserTone
        // before routing). Regex-based flags are fallbacks for when tone is neutral.
        const detectedTone   = ctx.currentTone ?? "neutral";
        const isPositiveMood = detectedTone === "casual"
          || /\b(happy|good|excited|calm|lighter|better|in a good mood)\b/.test(userText);
        const isAngryMood    = (detectedTone === "angry" || detectedTone === "frustrated" || detectedTone === "irritable")
          || /\b(angry|mad|vex|frustrated|annoyed|snappy|irritable)\b/.test(userText);
        const isLowMood      = (detectedTone === "distressed" || detectedTone === "exhausted" || detectedTone === "anxious")
          || /\b(sad|down|low|empty|numb|cry|crying|emotional|overwhelmed|tired|exhausted)\b/.test(userText);

        // Continuity signal - highest priority; consumes adviceGiven guard on first call
        const continuityLine = buildMoodContinuityLine();

        const moodMentionedBefore = !continuityLine && (ctx.entityHistory?.length > 1 &&
          ctx.entityHistory.slice(0, -1).some(e => e.symptoms?.mood));

        const MOOD_CODES  = ["MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "DEPRESSION", "CRYING_SPELLS", "FATIGUE"];
        const hasPattern  = !!buildSymptomPatternLine(MOOD_CODES); // consume the guard
        const phaseInfo   = getCurrentPhase();
        const phaseLabel  = phaseInfo?.label ?? null;
        const cycleLine   = buildCyclePersonalisationLine("general");
        const recallLine  = buildRecallLine();

        // ── Anomaly layer - bloom-anomaly-engine + severity baseline ─────────
        // Only fires when: not urgency, not already surfaced, level medium/high.
        // ctx.bloomieAnomalyCtx is computed at mount by computeMoodAnomalyCtx().
        const anomalyCtx    = ctx.bloomieAnomalyCtx;
        const hasMoodAnomaly = !ctx.adviceGiven.has("mood_anomaly_surfaced") &&
          (anomalyCtx?.level === "medium" || anomalyCtx?.level === "high");
        if (hasMoodAnomaly) ctx.adviceGiven.add("mood_anomaly_surfaced");

        // ── Tone-aware opener prefix ─────────────────────────────────────────
        // When tone is non-neutral, prepend a tone-specific opener from the pool.
        // getToneOpener tracks used openers on ctx to prevent repetition.
        // This opener fuses WITH the context sentence below (concatenated, not stacked).
        const toneOpener = (detectedTone && detectedTone !== "neutral" && !isPositiveMood)
          ? getToneOpener(detectedTone, ctx)
          : "";

        // ── Fused opening - tone opener + context in ONE sentence ─────────────
        // Each branch builds ONE fused sentence. toneOpener prepends where set.
        // Structure: [toneOpener] + [context-aware ack/observation]
        const fuse = (contextSentence) =>
          toneOpener ? `${toneOpener} ${contextSentence}` : contextSentence;

        let fusedOpening;

        if (continuityLine) {
          // Continuity/escalation takes priority - fuse with tone opener if present
          fusedOpening = fuse(continuityLine);

        } else if (isPositiveMood) {
          // Positive mood - affirming but not dismissive; no tone opener needed
          fusedOpening = pick([
            "It's really good to notice when things feel lighter - that shift matters 🩷",
            "I'm glad you told me, noticing a change in either direction is worth paying attention to 🩷",
            "Good to hear - tracking how you feel on the better days is just as useful as the hard ones 🩷",
          ]);

        } else if (moodMentionedBefore && (isLowMood || isAngryMood)) {
          // Continuity - they've mentioned this already this session
          const continuityPool = isLowMood
            ? [
                "you mentioned feeling low earlier too - it sounds like this has really been sitting with you, and that's worth taking seriously 🩷",
                "the fact that this keeps coming up tells me it isn't a small thing 🩷",
                "this is the second time this has come up in our conversation - when it sticks around like that, it deserves more than just sitting with it alone 🩷",
              ]
            : [
                "you brought this up earlier too - it sounds like the irritability hasn't let up, which makes sense if your body is in a pattern right now 🩷",
                "when it keeps surfacing like this, it's worth looking at what's actually driving it 🩷",
                "the fact that you've come back to this tells me it's been sitting heavier than you might be letting on 🩷",
              ];
          fusedOpening = fuse(pick(continuityPool));

        } else if (hasPattern && phaseLabel) {
          // Richest signal: pattern + phase - fuse into one sentence
          if (isLowMood) {
            fusedOpening = fuse(pick([
              `that heavy, flat feeling makes sense right now - you're in ${phaseLabel} and this is something your body tends to go through around this point in your cycle 🩷`,
              `feeling low at this point tracks - you're in ${phaseLabel}, and your logs show your mood tends to dip here 🩷`,
              `what you're feeling isn't random - you're in ${phaseLabel} and this is a pattern your body repeats, even if it doesn't feel that way in the moment 🩷`,
            ]));
          } else if (isAngryMood) {
            fusedOpening = fuse(pick([
              `that irritability makes a lot of sense right now - you're in ${phaseLabel} and your logs show this is something your body does around this time 🩷`,
              `feeling that edge is real - you're in ${phaseLabel}, and this kind of intensity shows up in your cycle at this point 🩷`,
              `what you're experiencing isn't out of nowhere - you're in ${phaseLabel} and this is a pattern your body tends to follow 🩷`,
            ]));
          } else {
            fusedOpening = fuse(pick([
              `that feeling makes sense given where you are right now - you're in ${phaseLabel} and this tends to be when your mood shifts 🩷`,
              `you're in ${phaseLabel} right now, and your logs show this is something your body goes through around this point 🩷`,
              `this isn't coming from nowhere - you're in ${phaseLabel} and your history shows mood shifts around this time in your cycle 🩷`,
            ]));
          }

        } else if (hasPattern) {
          // Pattern without confirmed phase
          if (isLowMood) {
            fusedOpening = fuse(pick([
              "that emotional heaviness is real - and looking at your logs, this isn't the first time your body has flagged this around now 🩷",
              "I can see from what you've logged that this kind of low feeling tends to come up for you, so you're not imagining it 🩷",
              "your history shows your body tends to go through this - even if it feels isolating in the moment, it's worth taking seriously 🩷",
            ]));
          } else if (isAngryMood) {
            fusedOpening = fuse(pick([
              "that frustration is real - and from your logs, this isn't a one-off, this is something your body cycles through 🩷",
              "I can see from your history that this kind of irritability tends to surface for you, which means it's worth paying attention to 🩷",
              "your logs back this up - this kind of mood shift is part of a pattern your body follows, not just a bad day 🩷",
            ]));
          } else {
            fusedOpening = fuse(pick([
              "this makes sense - looking at your logs, your body tends to flag these kinds of feelings around this time 🩷",
              "from what you've logged, this is part of a pattern your body follows, which means it's worth understanding rather than just pushing through 🩷",
              "your history backs this up - mood shifts like this tend to come up for you, and that's useful information 🩷",
            ]));
          }

        } else if (phaseLabel) {
          // Phase only - no pattern data
          if (isLowMood) {
            fusedOpening = fuse(pick([
              `that heavy feeling makes sense - you're in ${phaseLabel} right now, which is when emotional sensitivity often peaks 🩷`,
              `feeling low right now tracks with where you are in your cycle - you're in ${phaseLabel} and that phase can really affect your mood 🩷`,
              `you're in ${phaseLabel} right now and that's genuinely one of the harder points emotionally for a lot of people - what you're feeling is real 🩷`,
            ]));
          } else if (isAngryMood) {
            fusedOpening = fuse(pick([
              `that irritability makes sense - you're in ${phaseLabel} right now, when progesterone shifts tend to make everything feel more intense 🩷`,
              `feeling that edge is real, and it tracks - you're in ${phaseLabel}, which is often when irritability peaks 🩷`,
              `you're in ${phaseLabel} right now, and that phase can make everything feel sharper and harder to shake 🩷`,
            ]));
          } else {
            fusedOpening = fuse(pick([
              `what you're feeling makes sense given where you are right now - you're in ${phaseLabel}, which is often when mood shifts show up 🩷`,
              `you're in ${phaseLabel} right now, and that's genuinely one of the more emotionally complex points in the cycle 🩷`,
              `mood shifts in ${phaseLabel} are real - your hormones are doing something specific right now and your feelings are tracking with that 🩷`,
            ]));
          }

        } else if (cycleLine) {
          fusedOpening = fuse(cycleLine);

        } else if (recallLine) {
          fusedOpening = fuse(recallLine);

        } else {
          // No context - tone-driven generic; toneOpener already carries the ack
          if (isLowMood) {
            fusedOpening = fuse(pick([
              "that kind of emotional heaviness is real, and it takes something to name it and reach out about it 🩷",
              "feeling low isn't always easy to admit - I'm glad you brought it here 🩷",
              "that weight you're carrying is real, and it deserves to be taken seriously 🩷",
            ]));
          } else if (isAngryMood) {
            fusedOpening = fuse(pick([
              "anger and frustration that feel out of proportion can be one of the most exhausting things to carry - and they're worth understanding, not dismissing 🩷",
              "that kind of irritability is draining to live with, especially when it feels like it's coming from nowhere 🩷",
              "feeling that edge is real - and it's worth figuring out what's underneath it 🩷",
            ]));
          } else {
            fusedOpening = fuse(pick([
              "mood shifts can feel really disorienting, especially when they seem to come from nowhere 🩷",
              "what you're feeling is real and worth paying attention to 🩷",
              "I'm glad you brought this up - mood changes deserve more than just being pushed through 🩷",
            ]));
          }
        }

        // Anomaly add-on - one short clause appended to fusedOpening.
        // Wording is specific to which signal fired: cycle timing vs. severity spike.
        let anomalyAddOn = "";
        if (hasMoodAnomaly) {
          const hasCycleAnomaly   = !!anomalyCtx?.cycleAnomaly;
          const hasSeveritySpike  = !!anomalyCtx?.severitySpike;
          if (hasCycleAnomaly && hasSeveritySpike) {
            anomalyAddOn = pick([
              " I'm also noticing your cycle has been a bit different lately, and the intensity here feels higher than your usual pattern.",
              " Your cycle timing has shifted recently too, which can be part of why this feels more intense than usual.",
            ]);
          } else if (hasCycleAnomaly) {
            anomalyAddOn = pick([
              " I'm noticing your cycle has been behaving a bit differently than usual lately - that kind of shift can affect how you feel emotionally.",
              " Your cycle timing looks a little different from your personal pattern right now, which could be part of what's going on.",
            ]);
          } else {
            // severity spike only
            anomalyAddOn = pick([
              " This feels a bit more intense than how things usually show up for you - I want to make sure you're okay.",
              " I'm noticing this isn't how things typically come across in your history - worth paying attention to.",
            ]);
          }
        }

        // ── First mood mention - 2-sentence response, no filler bridge ─────────
        // moodMentions is appended in assistant.js before routing, so length === 1
        // means this is the very first time mood has come up this session.
        const isFirstMoodMention = (ctx.moodMentions?.length ?? 0) === 1;
        if (isFirstMoodMention) {
          return [
            fusedOpening + anomalyAddOn,
            "I do want to ask - are these feelings ever making you feel unsafe, completely unable to cope, or like you might hurt yourself?",
          ];
        }

        return [
          fusedOpening + anomalyAddOn,
          "Before we go further, quick check-in 🩷",
          "Are these feelings ever making you feel unsafe, completely unable to cope, or like you might hurt yourself?",
        ];
      },

      question: "Safety check before mood questions",

      choices: [
        { id: "yes", label: "Yes",          next: "MOOD_SAFETY_ROUTE", primary: true },
        { id: "no",  label: "No",           next: "MOOD_ENTRY" },
        { id: "ns",  label: "I'm not sure", next: "MOOD_SAFETY_ROUTE" },
      ],
    },

    // ── Safety route crisis support, do not continue mood assessment ───────
    MOOD_SAFETY_ROUTE: {
      say() {
        const base = ["Thank you for telling me, that takes courage 🩷"];
        if (userMode.isPostpartum) {
          return [
            ...base,
            "What you're describing can be a sign of postpartum depression or postpartum anxiety, both are common, both are treatable, and both deserve real support, not just time.",
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
        { id: "menu", label: pickMainLabel(),       next: "START_MENU" },
      ],
    },

    // ── Step 2: Feeling-type-first entry ─────────────────────────────────────
    MOOD_ENTRY: {
      say() {
        // ── Postpartum: high stakes - keep focused, surface serious signals ─
        if (userMode.isPostpartum) {
          return [
            "Postpartum mood shifts deserve to be taken seriously, not brushed off 🩷",
            "If you're experiencing crying spells that won't stop, feeling disconnected from your baby, intrusive thoughts, or trouble sleeping even when your baby sleeps - please tell me.",
            "What feels most true for you lately?",
          ];
        }

        // ── Pregnancy: validate the emotional reality of pregnancy ─────────
        if (userMode.isPregnancy) {
          const cycleLine = buildCyclePersonalisationLine("general");
          return [
            "Mood changes in pregnancy are real - anxiety about the pregnancy, feeling overwhelmed, or sudden intense emotions are all worth talking about 🩷",
            ...(cycleLine ? [cycleLine] : []),
            "What feels most true for you lately?",
          ];
        }

        // ── TTC: acknowledge the specific emotional weight ─────────────────
        if (userMode.isTTC) {
          return [
            "Mood shifts are real at any point in a cycle, and the emotional weight of TTC can make them feel even more intense 🩷",
            "The uncertainty, the waiting, the hope - it all sits somewhere in the body.",
            "What feels most true for you lately?",
          ];
        }

        // ── General: personalise using phase + recall if available ────────
        const phaseInfo  = getCurrentPhase();
        const phaseLine  = !ctx.adviceGiven.has("mood_phase_entry") && phaseInfo
          ? (() => {
              ctx.adviceGiven.add("mood_phase_entry");
              return insightFor(phaseInfo.phase, "mood");
            })()
          : null;
        const recallLine = !ctx.isAnon ? buildRecallLine() : null;

        // If we have phase context, open with it
        if (phaseLine) {
          return [
            phaseLine,
            "Mood shifts can feel really overwhelming, especially when you're trying to function through them 🩷",
            "What feels most true for you lately?",
          ];
        }
        if (recallLine) {
          return [
            recallLine,
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
      say() {
        const patternLine = buildSymptomPatternLine(["ANXIETY", "MOOD_SWINGS"]);
        const phaseInfo   = getCurrentPhase();
        const phaseLine   = phaseInfo ? insightFor(phaseInfo.phase, "mood") : null;
        // Blend context into the opening naturally - don't append separately
        const contextIntro = patternLine
          ? pick([
              "Anxiety has a way of feeling bigger when it's part of a pattern - I can see this tends to come up around this time for you 🩷",
              "Looking at what you've logged, anxiety seems to be something your body tends to signal around now 🩷",
            ])
          : phaseLine
          ? phaseLine
          : "Anxiety can show up in so many ways - racing thoughts, dread, restlessness, chest tightness, or just a feeling you can't shake 🩷";
        return [
          contextIntro,
          "Does it feel more like overthinking and spiraling, or more like sudden panic and dread?",
        ];
      },
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
      say() {
        const patternLine = buildSymptomPatternLine(["DEPRESSION", "CRYING_SPELLS", "MOOD_SWINGS"]);
        const contextIntro = patternLine
          ? pick([
              "Low mood can be one of the most invisible things to carry - and I can see from your logs this isn't new for you 🩷",
              "I can see this tends to come up around this point in your cycle - you're not imagining it 🩷",
            ])
          : "Low mood can look like sadness, but also numbness, withdrawal, or just feeling flat and disconnected 🩷";
        return [
          contextIntro,
          "Which feels more like you?",
        ];
      },
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
      say() {
        const patternLine  = buildSymptomPatternLine(["IRRITABILITY", "MOOD_SWINGS"]);
        const phaseInfo    = getCurrentPhase();
        const isLuteal     = phaseInfo?.phase === "luteal";
        const contextIntro = patternLine
          ? pick([
              "Irritability is one of the most dismissed cycle symptoms - and looking at your logs, I can see this is something your body flags around now 🩷",
              "You're not just being difficult. I can see from your history this tends to come up at this point in your cycle 🩷",
            ])
          : isLuteal
          ? "Irritability is one of the most dismissed cycle symptoms - and the luteal phase is when it peaks for most people. It is real and it can be exhausting to manage 🩷"
          : "Irritability is one of the most dismissed cycle symptoms, but it is real and it can be exhausting to manage 🩷";
        return [
          contextIntro,
          "Does it feel more like a short temper and snapping, or more like overstimulation and everything being too much?",
        ];
      },
      question: "Irritability subtype",
      choices: [
        { id: "temper",   label: "Short temper or snapping",                next: "MOOD_TIMING_SPLIT", primary: true },
        { id: "overstim", label: "Overstimulation, everything is too much", next: "MOOD_TIMING_SPLIT" },
        { id: "both",     label: "Both",                                     next: "MOOD_TIMING_SPLIT" },
      ],
    },

    // ── Step 3d: Fatigue route ────────────────────────────────────────────────
    MOOD_FATIGUE_ROUTE: {
      autoNext(ctx) { ctx.moodRoute = "fatigue"; return "MOOD_FATIGUE_Q"; },
    },
    MOOD_FATIGUE_Q: {
      say() {
        const patternLine = buildSymptomPatternLine(["FATIGUE"]);
        return [
          ...(patternLine ? [patternLine] : []),
          "That kind of drained, heavy-body exhaustion is different from just being tired and it deserves more than 'get more sleep' 🩷",
          "Does it feel more like physical exhaustion, or more like mental fog and low motivation?",
        ];
      },
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
      question: "Mixed mood cycle link",
      choices: [
        { id: "cycle", label: "Mostly around my cycle",  next: "MOOD_CYCLE_ROUTE",   primary: true },
        { id: "month", label: "Throughout the month",    next: "MOOD_NONCYCLE_ROUTE" },
        { id: "ns",    label: "Not sure",                next: "MOOD_SEVERITY" },
      ],
    },

    // ── Step 4: Timing split after feeling type is established ─────────────
    MOOD_TIMING_SPLIT: {
      say() {
        const phaseInfo = getCurrentPhase();
        const cycleLine = !ctx.isAnon && !ctx.adviceGiven.has("mood_timing_cycle_hint")
          ? buildCyclePersonalisationLine("general")
          : null;

        // If we have a live phase, offer a gentle hypothesis rather than blank question
        if (phaseInfo && cycleLine) {
          ctx.adviceGiven.add("mood_timing_cycle_hint");
          return [
            cycleLine,
            "Does this tend to show up around a specific time in your cycle, or does it feel more random?",
          ];
        }
        if (phaseInfo) {
          return [
            pick([
              `Based on your cycle, you're currently in ${phaseInfo.label} - a phase when mood shifts are really common 🩷`,
              `You're around ${phaseInfo.label} right now - this is often when these feelings peak for a lot of people 🩷`,
            ]),
            "Does this tend to show up around a specific time in your cycle, or does it feel more random?",
          ];
        }
        return ["Does this tend to show up around a specific time in your cycle, or does it feel more random?"];
      },
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
      say() {
        const phaseInfo = getCurrentPhase();
        const cycleLine = buildCyclePersonalisationLine("general");
        // Weave hormone explanation into context naturally
        const hormoneExplainer = "Progesterone rises then drops sharply in the luteal phase, and that drop can affect serotonin, energy, and emotional regulation.";
        if (cycleLine) {
          return [cycleLine, "Cycle-linked mood shifts are real and hormonal - you're not imagining it 🩷", hormoneExplainer];
        }
        if (phaseInfo?.phase === "luteal") {
          return [
            pick([
              "Being in the luteal phase right now makes complete sense of what you're describing 🩷",
              "The luteal phase is exactly when these kinds of mood shifts tend to peak - you're right on time 🩷",
            ]),
            hormoneExplainer,
          ];
        }
        return [
          "Cycle-linked mood shifts are real and hormonal - you're not imagining it 🩷",
          hormoneExplainer,
        ];
      },
      autoNext(ctx) { ctx.moodCycleLinked = true; return "MOOD_SEVERITY"; },
    },

    MOOD_NONCYCLE_ROUTE: {
      say: [
        "Mood shifts that happen most of the month or without a clear cycle pattern are worth taking seriously 🩷",
        "They can still be hormonal, but they may also point to something worth discussing with a mental health professional or GP.",
        "That's not a scary thing, it's just a different kind of support.",
      ],
      autoNext(ctx) { ctx.moodCycleLinked = false; return "MOOD_SEVERITY"; },
    },

    // ── Timing help fallback (for "Not sure" path from MOOD_ENTRY) ───────────
    MOOD_TIMING_HELP: {
      say: [
        "That's okay 🩷 Sometimes it's hard to connect the dots until you track it for a bit.",
        "If it helps: many people notice mood shifts 3–7 days before bleeding starts, or right at the start of day 1–2.",
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
        const phaseInfo    = getCurrentPhase();
        const insight      = insightFor(phaseInfo?.phase, "mood");
        const nudge        = !insight ? phaseNudge() : null;
        const recallLine   = !ctx.isAnon && !ctx.adviceGiven.has("mood_guide_recall")
          ? (() => { ctx.adviceGiven.add("mood_guide_recall"); return buildRecallLine(); })()
          : null;
        const patternLine  = buildSymptomPatternLine(
          ["MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "DEPRESSION", "CRYING_SPELLS", "FATIGUE"]
        );
        // Symptom intelligence line - baseline deviations, forecast, logging nudge.
        // Only fires when no patternLine already personalises the response.
        const insightLine  = !patternLine ? buildSymptomInsightLine() : null;

        // Context line - blend insight into emotional validation, not as a clinical tag
        const contextLine = insight
          ? `Based on what you've shared, hormone-linked mood shifts may be playing a role and you're not imagining it. ${insight}`
          : patternLine
          ? `Based on what you've shared, hormone-linked mood shifts may be playing a role - and your own history backs that up.`
          : "Based on what you've shared, hormone-linked mood shifts may be playing a role and you're not imagining it.";

        const moodRoute   = ctx.moodRoute;
        const cycleLinked = ctx.moodCycleLinked;

        let routeGuidance;
        if (moodRoute === "anxiety") {
          routeGuidance = "For anxiety, especially the cycle-linked kind consistent sleep timing, reducing stimulation in the days before your period, and noticing your triggers before they spiral all help. If panic attacks are happening, that's worth bringing to a provider.";
        } else if (moodRoute === "low") {
          routeGuidance = "For low mood, gentle anchors help more than big efforts, a bit of sunlight, movement, and routine on the hard days. If the low mood lifts once your period starts, that's a strong hormonal signal. If it stays most of the month, please consider talking to someone.";
        } else if (moodRoute === "irritable") {
          routeGuidance = "Irritability often spikes with lack of sleep, skipped meals, and overstimulation, especially in the luteal phase. Protecting your sleep and eating consistently can make a real difference. Tracking when it peaks in your cycle gives you power over it.";
        } else if (moodRoute === "fatigue") {
          routeGuidance = "Cycle-linked fatigue is physical, not a character flaw. In the luteal phase, progesterone has a sedating effect and your body temperature rises slightly, that combination is genuinely draining. Iron levels are also worth checking if fatigue is severe, especially if your periods are heavy.";
        } else if (cycleLinked === false) {
          routeGuidance = "When mood shifts don't follow a clear cycle pattern, it often means the body needs a different kind of support, whether that's a mental health conversation, thyroid check, or just consistent lifestyle anchors. You deserve more than just tracking and waiting.";
        } else {
          routeGuidance = "Mood shifts around your cycle are real. They can affect your emotions, energy, focus, patience, and even how social you feel. You're not being dramatic or too sensitive. Hormones really can change how your body and brain respond to stress.";
        }

        // Continuity acknowledgement - if mood has been persistent across turns,
        // surface it once in MOOD_GUIDE (guard ensures it only fires if not already
        // shown in MOOD_SAFETY_CHECK, since both share the adviceGiven key).
        const guideContinuityLine = buildMoodContinuityLine();

        // Opening - escalation gets heavier weight, otherwise warm standard
        const openingPool = guideContinuityLine
          ? [
              "I want to make sure I'm giving you what you actually need right now 🩷",
              "Thank you for staying with this - I can hear it's been weighing on you 🩷",
              "I appreciate you keeping this conversation going - that takes something 🩷",
            ]
          : [
              "Thank you for being open with me 🩷",
              "I appreciate you sharing all of that 🩷",
              "That took honesty. Thank you for trusting me with it 🩷",
              "Everything you shared makes sense. Let me give you what I can 🩷",
            ];

        return [
          pick(openingPool),
          ...(guideContinuityLine ? [guideContinuityLine] : []),
          contextLine,
          ...(recallLine ? [recallLine] : []),
          ...(nudge ? [nudge] : []),
          routeGuidance,
          ...(insightLine ? [insightLine] : []),
          "",
          "If these feelings feel severe, last most of the month, or are affecting your relationships or work consistently, speaking with a healthcare provider or mental health professional is a real option, not because you can't handle it, but because you deserve support.",
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
        "Tracking these alongside your cycle day makes the pattern visible and once you see it, you can plan around it.",
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
        "On the hard days, lowering the bar is not giving up, it's strategy. One small anchor (a walk, a meal, a shower) is enough.",
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
        "What to log each day: your mood on a 1–10 scale, your cycle day if you know it, how you slept, and anything notable (big stressor, skipped meal, social event).",
        "Patterns become visible after 2–3 cycles. That's when you start to see the shape of your own experience, and it becomes easier to prepare for the rough days rather than be surprised by them.",
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
        "These are not signs of weakness, they're signals that your body needs a different level of support than tracking and self-care can provide.",
        "You deserve real help, not just coping strategies.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Main menu",          next: "START_MENU" },
      ],
    },
  };
}
