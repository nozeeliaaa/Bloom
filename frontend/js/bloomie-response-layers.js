import { buildFollowUpClarifier } from "./bloomie-clarifier.js";

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stableIndex(seed, len) {
  const text = normalizeWhitespace(seed).toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % Math.max(1, len);
}

function chooseVariant(options, seed) {
  if (!Array.isArray(options) || !options.length) return null;
  return options[stableIndex(seed, options.length)];
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function getConcernKey(context = {}) {
  const leadDomain = String(context.turnFocus?.leadDomain || "").toLowerCase();
  const reason = String(context.inferredReason || context.lastIntent || "").toLowerCase();
  const symptoms = context.entities?.symptoms || {};

  if (leadDomain === "late") return "late_period";
  if (leadDomain === "bleeding") return "heavy_bleeding";
  if (leadDomain === "pain") return "pelvic_pain";
  if (leadDomain === "discharge") return "discharge";
  if (leadDomain === "pregnancy") return "pregnancy_concern";

  if (reason.includes("late") || symptoms.late || symptoms.implicit_late) return "late_period";
  if (reason.includes("heavy") || symptoms.heavy || symptoms.large_clots) return "heavy_bleeding";
  if (reason.includes("spot") || symptoms.spotting) return "spotting";
  if (reason.includes("pelvic") || symptoms.pelvic || symptoms.ovulation_pain) return "pelvic_pain";
  if (reason.includes("pregnan") || context.entities?.pregnancy?.chance) return "pregnancy_concern";
  if (symptoms.discharge) return "discharge";
  return null;
}

function countActiveSymptoms(symptoms = {}) {
  return Object.values(symptoms).filter(Boolean).length;
}

function hasQuestionFrame(text) {
  return /\?$/.test(text) || /\b(is this normal|is .* bad|should i worry|am i okay|does this mean|something wrong)\b/.test(text);
}

export function normalizeDisplayText(text) {
  return normalizeWhitespace(text)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s{2,}/g, " ");
}

export function detectReasoningSpiral(text, normalizedText = "", tone = null, intent = null) {
  const t = normalizeWhitespace(normalizedText || text).toLowerCase();
  const concern = String(intent || "").toLowerCase();
  const catastrophic = hasAny(t, [
    /\bmust mean\b/,
    /\bdefinitely\b/,
    /\bfor sure\b/,
    /\beverything means\b/,
    /\bit has to be\b/,
    /\bhas to mean\b/,
    /\bmust be\b/,
  ]);
  if (!catastrophic) return null;

  if (/\bpregnan|pregnancy|pregnant\b/.test(t) || concern.includes("preg")) {
    return "pregnancy_fear";
  }
  if (/\bsick|disease|cancer|wrong\b/.test(t)) {
    return "health_fear";
  }
  return tone === "distressed" || tone === "anxious" ? "general_spiral" : "over_interpretation";
}

export function maybeBuildRealityCheckPrefix(context = {}) {
  const spiral = detectReasoningSpiral(
    context.text,
    context.normalizedText,
    context.tone,
    context.inferredReason || context.lastIntent
  );
  if (!spiral || context.entities?.urgent) return null;

  const variants = {
    pregnancy_fear: [
      "I get why your mind would jump there 🩷 but symptoms like these can overlap with normal cycle changes too.",
      "I can see why that feels scary 🩷 but one cluster of symptoms does not settle pregnancy on its own.",
    ],
    health_fear: [
      "I get why that would feel unsettling 🩷 but symptoms like this can have more than one explanation.",
      "I can hear the worry in that 🩷 but it helps to separate what the symptom is doing from the worst-case meaning your mind is jumping to.",
    ],
    general_spiral: [
      "I get why it feels heavy right now 🩷 but let's slow it down and look at what your body is actually showing.",
      "I can hear that this is spiraling a bit 🩷 let's sort through the clues one by one.",
    ],
    over_interpretation: [
      "It makes sense to worry about that 🩷 but one symptom usually is not enough to point to only one cause.",
      "I get why that feels convincing 🩷 but symptoms can overlap more than they seem at first.",
    ],
  };

  return chooseVariant(variants[spiral] || variants.over_interpretation, `${context.normalizedText}|${spiral}`);
}

export function detectTinyWin(context = {}) {
  const t = normalizeWhitespace(context.normalizedText || context.text).toLowerCase();
  if (!t) return null;
  if (/\b(track|tracking|calendar|log|logged|logging)\b/.test(t) && /\b(symptom|symptoms|cycle|period)\b/.test(t)) {
    return /\bsymptom/.test(t) ? "symptom_logging" : "cycle_tracking";
  }
  if (/\b(started paying attention|paying attention|noticed when|noticing when|watching when)\b/.test(t)) {
    return "pattern_noticing";
  }
  if (hasQuestionFrame(t) && getConcernKey(context)) {
    return "body_awareness";
  }
  return null;
}

export function buildTinyWinLine(type, seed = "") {
  const variants = {
    cycle_tracking: [
      "That's genuinely helpful 🩷 tracking your cycle makes the pattern easier to read.",
      "That kind of tracking really helps 🩷 it gives your cycle more context over time.",
    ],
    symptom_logging: [
      "That's really useful 🩷 logging symptoms makes repeat patterns much easier to spot.",
      "That helps more than it seems 🩷 symptom logs make future patterns clearer.",
    ],
    pattern_noticing: [
      "Paying attention to the timing is really useful 🩷 that's often where the pattern starts to show.",
      "Noticing when it happens is a strong clue already 🩷 that kind of detail helps a lot.",
    ],
    body_awareness: [
      "Asking questions like that is useful too 🩷 it means you're paying close attention to what's changing.",
      "That kind of check-in helps 🩷 small details about timing and symptoms can matter.",
    ],
  };
  return chooseVariant(variants[type] || [], `${type}|${seed}`);
}

export function getMissingClues(context = {}) {
  const t = normalizeWhitespace(context.normalizedText || context.text).toLowerCase();
  const concern = getConcernKey(context);
  const entities = context.entities || {};
  const symptoms = entities.symptoms || {};
  const missing = [];

  if (concern === "late_period") {
    const mentionedPregnancyChance =
      !!entities.pregnancy?.chance ||
      hasAny(t, [/\bpregnan|pregnant\b/, /\bunprotected sex\b/, /\bcondom broke\b/, /\bchance of pregnancy\b/]);
    const mentionedStressRoutine =
      hasAny(t, [/\bstress|stressed\b/, /\bsleep\b/, /\broutine\b/, /\btravel\b/, /\bill|illness|sick\b/]);
    const mentionedIrregularity =
      symptoms.irregular || hasAny(t, [/\birregular\b/, /\ball over the place\b/, /\busual\b/, /\bthis happens\b/]);

    if (!mentionedPregnancyChance) missing.push("pregnancy_possibility");
    if (!mentionedStressRoutine) missing.push("stress_or_routine");
    if (!mentionedIrregularity) missing.push("cycle_context");
  }

  if (concern === "heavy_bleeding") {
    const mentionedAmount =
      !!entities.severity ||
      hasAny(t, [
        /\bsoaking\b/,
        /\bsoak through\b/,
        /\bheavy\s+(?:flow|bleeding|period)\b/,
        /\b(?:very|really|so+)\s+heavy\b/,
        /\bflow\s+is\s+heavy\b/,
        /\bbleeding\s+(?:is\s+)?heavy\b/,
        /\bheavier than usual\b/,
        /\bmanageable\b/,
        /\blots?\b/,
      ]);
    const mentionedTiming =
      !!entities.duration ||
      hasAny(t, [/\btoday\b/, /\bsince\b/, /\bdays?\b/, /\bweek\b/, /\bhours?\b/]);

    if (!mentionedAmount) missing.push("amount");
    if (!mentionedTiming) missing.push("timing");
  }

  if (concern === "pelvic_pain") {
    if (!entities.severity) missing.push("severity");
    if (!hasAny(t, [/\bbleed|bleeding|spotting|period\b/])) missing.push("bleeding_context");
    if (!entities.timing && !hasAny(t, [/\bbefore\b/, /\bduring\b/, /\bafter\b/, /\bmid.?cycle\b/, /\bovulat/])) {
      missing.push("cycle_timing");
    }
    if (!hasAny(t, [/\bworse|worsening|getting worse|again\b/])) missing.push("worsening");
  }

  if (concern === "spotting") {
    if (!hasAny(t, [/\bbrown\b/, /\bpink\b/, /\bred\b/, /\bdark\b/])) missing.push("colour");
    if (!hasAny(t, [/\blight\b/, /\bheavy\b/, /\bjust a little\b/, /\bmore than\b/, /\bbleeding\b/])) missing.push("amount");
    if (!entities.timing && !hasAny(t, [/\bperiod\b/, /\bmid.?cycle\b/, /\bovulat\b/, /\bafter sex\b/])) {
      missing.push("timing");
    }
    if (!symptoms.pelvic && !hasAny(t, [/\bpain|cramp\b/])) missing.push("pain");
  }

  return { concern, missing };
}

export function getFollowUpKey(context = {}) {
  const { concern, missing } = getMissingClues(context);
  if (!concern || !missing.length) return null;
  return `followup:${concern}:${[...missing].sort().join("+")}`;
}

export function shouldAskFollowUp(context = {}) {
  if (context.entities?.urgent || context.inferredNext?.includes?.("URGENT")) return false;
  if (context.hasPendingClarifier) return false;
  if (context.isShortFollowUp) return false;
  const followUpKey = getFollowUpKey(context);
  if (followUpKey && context.askedFollowUpKeys?.has?.(followUpKey)) return false;
  if (countActiveSymptoms(context.entities?.symptoms) >= 2 && !context.primaryFocusApplied) return false;
  const { concern, missing } = getMissingClues(context);
  if (!concern || missing.length === 0) return false;
  const shortConcernTurn = normalizeWhitespace(context.normalizedText || context.text).split(" ").length <= 6;
  return shortConcernTurn || missing.length >= 2;
}

export function buildFollowUpQuestion(context = {}) {
  const { concern, missing } = getMissingClues(context);
  if (!concern || !missing.length) return null;
  return buildFollowUpClarifier({
    concern,
    missing,
    seed: `${context.normalizedText || context.text}|${concern}`,
  })?.text || null;
}

export function shouldUseMiniReplay(context = {}) {
  if (context.entities?.urgent) return false;
  const depth = context.sessionDepth ?? 0;
  if (depth < 2) return false;
  const text = normalizeWhitespace(context.normalizedText || context.text).toLowerCase();
  const shortFollowUp = /^(still no|not yet|same|again|also|and|on one side|one side|and smell weird|still no bleeding|still no period)\b/.test(text);
  return shortFollowUp || countActiveSymptoms(context.entities?.symptoms) >= 2;
}

export function buildMiniReplay(context = {}) {
  if (!shouldUseMiniReplay(context)) return null;
  const t = normalizeWhitespace(context.normalizedText || context.text).toLowerCase();
  const symptoms = context.entities?.symptoms || {};
  const facts = [];

  if (symptoms.late || symptoms.implicit_late) facts.push("your period is late");
  if (/\bstill no bleeding|no bleeding yet|still no period|not here yet\b/.test(t)) facts.push("there's still no bleeding yet");
  if (symptoms.pelvic) facts.push("you've had cramps");
  if (/\bone side|one-sided\b/.test(t)) facts.push("the pain feels one-sided");
  if (/\bbrown blood|brown spotting\b/.test(t)) facts.push("you're seeing brown blood");
  if (/\bsmell|odor|odour|weird\b/.test(t) && (symptoms.discharge || symptoms.spotting)) facts.push("there's an unusual smell or discharge change");
  if (symptoms.spotting && !facts.includes("you're seeing brown blood")) facts.push("you're noticing spotting");

  const uniqueFacts = [...new Set(facts)].slice(0, 3);
  if (!uniqueFacts.length) return null;

  if (uniqueFacts.length === 1) {
    return `Let me make sure I'm understanding you 🩷 ${uniqueFacts[0]} - right?`;
  }
  if (uniqueFacts.length === 2) {
    return `Let me make sure I'm understanding you 🩷 ${uniqueFacts[0]}, and ${uniqueFacts[1]} - right?`;
  }
  return `Let me make sure I'm understanding you 🩷 ${uniqueFacts[0]}, ${uniqueFacts[1]}, and ${uniqueFacts[2]} - right?`;
}

export function detectHiddenConcern(text, intent = null, tone = null) {
  const t = normalizeWhitespace(text).toLowerCase();
  if (!t) return null;
  if (/\b(is .* bad|is this bad)\b/.test(t)) return "is_bad";
  if (/\b(is this normal|is it normal)\b/.test(t)) return "normality";
  if (/\b(should i worry|should i be worried)\b/.test(t)) return "worry";
  if (/\b(does this mean something wrong|something wrong)\b/.test(t)) return "wrong";
  if ((tone === "anxious" || tone === "distressed") && getConcernKey({ normalizedText: t, inferredReason: intent })) {
    return "worry";
  }
  return null;
}

export function buildEmotionalFollowUp(context = {}) {
  const concern = detectHiddenConcern(context.normalizedText || context.text, context.inferredReason || context.lastIntent, context.tone);
  if (!concern || context.entities?.urgent) return null;

  const variants = {
    is_bad: [
      "Is the part worrying you most the color, the timing, or something else?",
      "Are you mostly worried that something might be wrong?",
    ],
    normality: [
      "Is the part bothering you more the timing, the pain, or just not knowing if it's normal?",
      "If you want, tell me what part feels most off to you.",
    ],
    worry: [
      "If you want, tell me what part is worrying you most.",
      "Are you worried something specific might be going on?",
    ],
    wrong: [
      "Do you want to tell me what part is making you think something might be wrong?",
      "If you want, we can talk through the part that's worrying you most.",
    ],
  };
  return chooseVariant(variants[concern] || variants.worry, `${context.normalizedText}|${concern}`);
}

export function shouldAddSoftContinue(context = {}, response = null) {
  if (context.entities?.urgent) return false;
  if (context.hiddenConcern || context.followUpAsked) return false;
  if (!response?.scenario) return false;
  const concern = getConcernKey(context);
  if (!concern) return false;
  return (context.sessionDepth ?? 0) >= 1;
}

export function buildSoftContinuePrompt(context = {}) {
  const concern = getConcernKey(context) || "general";
  const variants = {
    late_period: [
      "Before you go - is there anything you're still unsure about?",
      "If you want, tell me what part of the delay is worrying you most.",
    ],
    pelvic_pain: [
      "If you want, we can talk through the pain step by step.",
      "Before you go - is there anything about the pain you're still unsure about?",
    ],
    spotting: [
      "If you want, tell me what part of the spotting feels most off to you.",
      "Before you go - is there anything you're still unsure about?",
    ],
    pregnancy_concern: [
      "If you want, we can walk through the timeline step by step.",
      "Before you go - is there anything you're still unsure about?",
    ],
    general: [
      "Before you go - is there anything you're still unsure about?",
      "If you want, tell me what part is worrying you most.",
    ],
  };
  return chooseVariant(variants[concern] || variants.general, `${concern}|${context.sessionDepth || 0}`);
}

function lineFeelsOpenEnded(line) {
  const text = normalizeWhitespace(line).toLowerCase();
  if (!text) return false;
  return /\?$/.test(text) || /\b(if you want|tell me|let me know|would you like|do you want)\b/.test(text);
}

export function composeResponseLayers(context = {}, options = {}) {
  const guidance = options.guidance || {};
  const baseLines = Array.isArray(guidance.lines) ? guidance.lines.filter(Boolean) : [];
  const emergency = !!options.emergency;
  const guidanceOpener = options.guidanceOpener || "";
  const patternLine = options.patternLine || null;
  const secondaryAcknowledgement = options.secondaryAcknowledgement || null;
  const alreadyShown = options.alreadyShown || {};

  if (emergency) {
    return {
      lines: [...(guidanceOpener ? [guidanceOpener] : []), ...baseLines],
      meta: {
        tinyWinType: null,
        usedSoftContinue: false,
      },
    };
  }

  const realityCheckPrefix = maybeBuildRealityCheckPrefix(context);
  const tinyWinType = !realityCheckPrefix ? detectTinyWin(context) : null;
  const tinyWinAlreadyShown = tinyWinType ? alreadyShown.tinyWins?.has?.(tinyWinType) : false;
  const tinyWinLine = tinyWinType && !tinyWinAlreadyShown
    ? buildTinyWinLine(tinyWinType, context.normalizedText || context.text || "")
    : null;
  const miniReplay = !realityCheckPrefix && shouldUseMiniReplay(context)
    ? buildMiniReplay(context)
    : null;
  const hiddenConcernFollowUp = buildEmotionalFollowUp(context);
  const effectiveTinyWinLine =
    hiddenConcernFollowUp && tinyWinType === "body_awareness"
      ? null
      : tinyWinLine;
  const shouldSoftContinueNow = !hiddenConcernFollowUp && shouldAddSoftContinue(
    {
      ...context,
      hiddenConcern: !!detectHiddenConcern(
        context.normalizedText || context.text,
        context.inferredReason || context.lastIntent,
        context.tone
      ),
      followUpAsked: false,
    },
    guidance
  );
  const softContinue = shouldSoftContinueNow && !alreadyShown.softContinue
    ? buildSoftContinuePrompt(context)
    : null;

  const leadLine = realityCheckPrefix || miniReplay || guidanceOpener || null;
  const supportLead = effectiveTinyWinLine || (!leadLine ? patternLine : null);
  const suffixLine = hiddenConcernFollowUp || (!baseLines.some(lineFeelsOpenEnded) ? softContinue : null);

  return {
    lines: [supportLead, secondaryAcknowledgement, leadLine, ...baseLines, suffixLine].filter(Boolean),
    meta: {
      tinyWinType,
      usedSoftContinue: !!(suffixLine && suffixLine === softContinue),
    },
  };
}

export function softenEscalationLine(line) {
  let text = String(line || "");
  if (!text) return text;

  const replacements = [
    {
      pattern: /Please seek medical care as soon as possible/gi,
      replacement: "It would be a good idea to get medical care soon, just to be safe",
    },
    {
      pattern: /please seek medical care promptly/gi,
      replacement: "it would be a good idea to get medical care soon",
    },
    {
      pattern: /seek urgent care right away/gi,
      replacement: "get urgent medical care right away",
    },
    {
      pattern: /seek urgent care/gi,
      replacement: "get urgent medical care",
    },
    {
      pattern: /seek care urgently/gi,
      replacement: "get medical care soon",
    },
    {
      pattern: /Please don't wait on this one\./gi,
      replacement: "Because of what you described, I would not wait too long on this.",
    },
    {
      pattern: /Find a provider near you or go to urgent care\./gi,
      replacement: "It would be a good idea to check in with a healthcare provider, or use urgent care if you need help sooner.",
    },
    {
      pattern: /go to your nearest emergency room or urgent care centre, or call 119 in Jamaica/gi,
      replacement: "please go to the nearest emergency room or urgent care centre, or call 119 in Jamaica",
    },
  ];

  for (const { pattern, replacement } of replacements) {
    text = text.replace(pattern, replacement);
  }

  return text;
}
