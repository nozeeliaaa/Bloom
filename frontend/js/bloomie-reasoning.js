import { normalizeText } from "./bloomie-routing.js";

function hasAnySymptoms(symptoms = {}) {
  return Object.values(symptoms).some(Boolean);
}

function hasLateContext({ entities, overdueDays, lastIntent, state }) {
  return !!(
    (typeof overdueDays === "number" && overdueDays < -1) ||
    ["LATE_INTRO", "LATE_TEST_Q", "LATE_YES_PREG", "LATE_NO_GUIDANCE"].includes(lastIntent) ||
    ["LATE_INTRO", "LATE_TEST_Q", "LATE_YES_PREG", "LATE_NO_GUIDANCE"].includes(state)
  );
}

function isClarificationInput(t) {
  return [
    /^\s*kmt(?:\s+what)?\s*\??\s*$/i,
    /^\s*(what|huh)\s*\??\s*$/i,
    /\b(what do you mean|say that again|explain that again|explain simpler)\b/i,
    /\b(me|mi)\s+nuh\s+(understand|get it)\b/i,
    /\b(wah dat mean|wah yuh mean)\b/i,
  ].some((rx) => rx.test(t));
}

export function buildSignalBoard({
  text,
  entities,
  ctx,
  userMode,
  overdueDays = null,
  bloomieMemory = null,
}) {
  const t = normalizeText(text);
  const sym = entities?.symptoms || {};

  return {
    rawText: text,
    normalizedText: t,
    symptoms: sym,
    domainSelections: entities?.domainSelections || {},
    hasSymptoms: hasAnySymptoms(sym),
    urgent: !!entities?.urgent,
    severity: entities?.severity || null,
    timing: entities?.timing || null,
    pregnancy: entities?.pregnancy || { chance: false, testedYet: false, result: null, ttc: false },
    mode: {
      isPregnancy: !!userMode?.isPregnancy,
      isTTC: !!userMode?.isTTC,
      isPostpartum: !!userMode?.isPostpartum,
      isCycleTracking: !!userMode?.isCycleTracking,
    },
    cycle: {
      overdueDays,
      currentTurnLate: !!(sym.late || sym.implicit_late),
      hasLateContext: hasLateContext({
        entities,
        overdueDays,
        lastIntent: ctx?.lastIntent,
        state: ctx?.state,
      }),
    },
    recent: {
      state: ctx?.state || null,
      lastIntent: ctx?.lastIntent || null,
      unresolved: [...(ctx?.conversationProfile?.concernsUnresolved || [])],
      lastNodeHistory: (ctx?.nodeHistory || []).slice(-3),
      lastOOS: ctx?.lastOOS || null,
      recentTopics: bloomieMemory?.recentTopics || [],
    },
    flags: {
      clarification: isClarificationInput(t),
      educationalAsk: /\b(what is|explain|tell me about|how does)\b/.test(t),
      trueOOSLikely: !hasAnySymptoms(sym) && !isClarificationInput(t),
    },
  };
}

export function scoreInterpretations(board) {
  const s = board.symptoms;
  const out = [];

  if (board.flags.clarification) {
    out.push({ key: "clarification_needed", score: 95, why: "confusion/frustration phrase detected" });
  }

  if (board.urgent || (s.heavy && (s.large_clots || s.dizziness))) {
    out.push({ key: "heavy_plus_red_flags", score: 100, why: "heavy bleeding combined with red flags" });
  }

  if ((board.cycle.currentTurnLate || board.cycle.hasLateContext) && (s.nausea || s.breast_tender || board.pregnancy.chance)) {
    out.push({ key: "late_plus_pregnancy_signs", score: 88, why: "late context + pregnancy-associated symptoms" });
  }

  if (board.cycle.hasLateContext && s.pelvic) {
    out.push({ key: "late_plus_cramps", score: 78, why: "late context + cramps/pelvic pain" });
  }

  if (s.spotting && s.pelvic) {
    out.push({ key: "spotting_plus_pain", score: 68, why: "spotting and pelvic pain present together" });
  }

  if (s.irregular && (s.hot_flashes || s.night_sweats || s.cold_flashes) && (s.insomnia || s.mood || s.fatigue)) {
    out.push({ key: "peri_cluster", score: 72, why: "irregular + vasomotor + sleep/mood cluster" });
  }

  if (s.pelvic && !board.cycle.hasLateContext && !s.heavy && !s.spotting) {
    out.push({ key: "generic_cramps", score: 35, why: "isolated cramps/pelvic signal" });
  }

  if (board.flags.trueOOSLikely) {
    out.push({ key: "true_oos", score: 20, why: "no health signal and no clarification intent" });
  }

  return out.sort((a, b) => b.score - a.score);
}

export function selectResponseStrategy(board, interpretations) {
  const top = interpretations?.[0] || null;
  if (!top) return { strategy: "defer", interpretation: null, why: "no strong interpretation" };

  if (top.key === "heavy_plus_red_flags") {
    return {
      strategy: "safety_redirect",
      interpretation: top.key,
      next: "HEAVY_URGENT",
      payload: { reason: "reasoning:heavy_plus_red_flags" },
      why: top.why,
    };
  }

  if (top.key === "clarification_needed") {
    const days = board.cycle.overdueDays;
    const lateLine = board.cycle.hasLateContext
      ? (typeof days === "number" && days < -1
          ? `I mean your period looks later than expected from your logged dates — around ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} late by estimate.`
          : "I mean your period looks later than expected from your logged dates.")
      : "I can rephrase it in a simpler way.";
    return {
      strategy: "repair",
      interpretation: top.key,
      next: "START_MENU",
      reply: [
        "My bad 🩷 Let me say that more simply.",
        lateLine,
        "Do you want to focus on cramps, spotting, or pregnancy chance?",
      ],
      payload: { reason: "reasoning:clarification_needed" },
      why: top.why,
    };
  }

  if (top.key === "late_plus_pregnancy_signs") {
    return {
      strategy: "continue_prior_topic",
      interpretation: top.key,
      next: "LATE_TEST_Q",
      payload: { reason: "reasoning:late_plus_pregnancy_signs" },
      why: top.why,
    };
  }

  if (top.key === "late_plus_cramps") {
    return {
      strategy: "triage",
      interpretation: top.key,
      next: "LATE_INTRO",
      payload: { reason: "reasoning:late_plus_cramps" },
      why: top.why,
    };
  }

  if (top.key === "spotting_plus_pain") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "SPOT_INTRO",
      payload: { reason: "reasoning:spotting_plus_pain" },
      why: top.why,
    };
  }

  if (top.key === "peri_cluster") {
    return {
      strategy: "triage",
      interpretation: top.key,
      next: "PERIMENOPAUSE_INTRO",
      payload: { reason: "reasoning:peri_cluster" },
      why: top.why,
    };
  }

  return {
    strategy: "defer",
    interpretation: top.key,
    why: top.why,
  };
}
