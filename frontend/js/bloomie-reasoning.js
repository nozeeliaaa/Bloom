import { normalizeText } from "./bloomie-routing.js";
import { matchesRepairClarification } from "./bloomie-intent.js";

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
  return matchesRepairClarification(t);
}

// Reviewed allowlist for interpretation scoring.
// Only these keys can be returned/consumed by the scorer.
export const ALLOWED_INTERPRETATION_KEYS = new Set([
  "late_plus_cramps",
  "pregnancy_signal_cluster",
  "spotting_with_pain",
  "heavy_bleeding_red_flag",
  "ovulation_pattern",
  "luteal_pattern",
  "discharge_irritation_cluster",
  "foul_discharge_alone",
  "fever_with_discharge_or_pain",
  "bleeding_after_sex",
  "severe_unmanaged_pain",
  "stress_related_delay",
  "irregular_cycle_pattern",
  "prolonged_bleeding",
  "possible_perimenopause_pattern",
  "clarification_needed",
  "generic_cramps",
  "generic_late_period",
]);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function hasTag(board, tag) {
  return Array.isArray(board.tags) && board.tags.includes(tag);
}

export function buildSignalBoard({
  text,
  entities,
  tags = [],
  repair = null,
  phase = null,
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
    tags: Array.isArray(tags) ? tags : [],
    hasSymptoms: hasAnySymptoms(sym),
    urgent: !!entities?.urgent,
    duration: entities?.duration || null,
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
      phase,
      currentTurnLate: !!(sym.late || sym.implicit_late),
      hasLateContext: hasLateContext({
        entities,
        overdueDays,
        lastIntent: ctx?.lastIntent,
        state: ctx?.state,
      }),
      cycleSignals: Array.isArray(ctx?.integratedSignals?.cycleSignals)
        ? ctx.integratedSignals.cycleSignals
        : [],
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
      clarification: repair?.label === "clarification" || isClarificationInput(t),
      frustration: repair?.label === "frustration",
      educationalAsk: /\b(what is|explain|tell me about|how does)\b/.test(t),
      trueOOSLikely: !hasAnySymptoms(sym) && !isClarificationInput(t),
    },
  };
}

/**
 * Structured interpretation scorer.
 * Runs on canonical normalized text + extracted entities/tags/context only.
 * This is assistive scoring and does not bypass hard safety routing.
 */
export function scoreInterpretationBoard(board) {
  const s = board.symptoms || {};
  const t = board.normalizedText || "";
  const durationDays = Number(board.duration?.days || 0);
  const interpretations = [];
  const hasHeavySignal = s.heavy || hasTag(board, "heavy_bleeding") || /\b(heavy bleeding|soaking|flooding)\b/.test(t);
  const hasProlongedBleedLanguage =
    /\b(7 days|seven days|a week|one week|week now|for days|over a week|more than a week)\b/.test(t) ||
    /\b(8|9|10|11|12|13|14)\s+days\b/.test(t);

  const push = (key, score, reasons) => {
    if (!ALLOWED_INTERPRETATION_KEYS.has(key)) return;
    interpretations.push({
      key,
      score: clamp01(score),
      reasons: Array.isArray(reasons) ? reasons.filter(Boolean) : [],
    });
  };

  if (board.flags.clarification || hasTag(board, "clarification") || hasTag(board, "frustration")) {
    push("clarification_needed", 0.98, [
      board.flags.frustration || hasTag(board, "frustration") ? "frustration" : "clarification",
    ]);
  }

  if (
    hasHeavySignal &&
    (
      board.urgent ||
      hasTag(board, "red_flag") ||
      s.large_clots ||
      s.dizziness ||
      /\b(faint|fainting|lightheaded|severe pain|unbearable pain)\b/.test(t)
    )
  ) {
    push("heavy_bleeding_red_flag", board.urgent ? 1 : 0.95, [
      "heavy_bleeding",
      s.large_clots ? "clots" : null,
      s.dizziness || /\b(faint|lightheaded)\b/.test(t) ? "dizziness_or_faint" : null,
      board.urgent ? "urgent" : null,
    ]);
  }

  const hasLateSignal = board.cycle.currentTurnLate || board.cycle.hasLateContext || hasTag(board, "late_period");
  const pregReasons = [
    hasLateSignal ? "late_period" : null,
    s.nausea || hasTag(board, "nausea") ? "nausea" : null,
    s.breast_tender || hasTag(board, "breast_tenderness") ? "breast_tenderness" : null,
    board.pregnancy?.chance || hasTag(board, "pregnancy_concern") ? "pregnancy_concern" : null,
  ].filter(Boolean);
  if (hasLateSignal && pregReasons.length >= 3) {
    push("pregnancy_signal_cluster", 0.9, pregReasons);
  } else if (hasLateSignal && pregReasons.length >= 2) {
    push("pregnancy_signal_cluster", 0.8, pregReasons);
  }

  if (hasLateSignal && (s.pelvic || hasTag(board, "cramps") || hasTag(board, "pelvic_pain"))) {
    push("late_plus_cramps", 0.86, ["late_period", s.pelvic ? "pelvic_pain" : "cramps"]);
  }

  if ((s.spotting || hasTag(board, "spotting")) && (s.pelvic || hasTag(board, "pelvic_pain") || hasTag(board, "cramps"))) {
    push("spotting_with_pain", 0.82, ["spotting", s.pelvic ? "pelvic_pain" : "cramps"]);
  }

  if (
    (board.timing === "mid_cycle" || board.cycle.phase === "ovulation") &&
    (s.ovulation_pain || /\b(one.?sided|one sided)\b/.test(t) || s.pelvic || hasTag(board, "pelvic_pain")) &&
    (s.spotting || hasTag(board, "spotting") || /\blight spotting\b/.test(t))
  ) {
    push("ovulation_pattern", 0.88, [
      board.timing === "mid_cycle" || board.cycle.phase === "ovulation" ? "mid_cycle_or_ovulation_timing" : null,
      s.ovulation_pain ? "ovulation_pain" : (s.pelvic ? "pelvic_pain" : "one_sided_pain"),
      s.spotting || hasTag(board, "spotting") ? "light_spotting" : null,
    ]);
  }

  if (
    (board.timing === "before_period" || board.cycle.phase === "luteal" || hasLateSignal) &&
    (
      (s.mood || hasTag(board, "mood_change")) +
      (s.bloating || /\bbloat|bloated\b/.test(t)) +
      (s.breast_tender || hasTag(board, "breast_tenderness")) +
      (s.acne || /\bacne|breakout\b/.test(t))
    ) >= 2
  ) {
    push("luteal_pattern", 0.74, [
      board.timing === "before_period" || board.cycle.phase === "luteal" ? "luteal_or_preperiod_timing" : null,
      s.mood || hasTag(board, "mood_change") ? "mood_change" : null,
      s.bloating || /\bbloat|bloated\b/.test(t) ? "bloating" : null,
      s.breast_tender || hasTag(board, "breast_tenderness") ? "breast_tenderness" : null,
      s.acne || /\bacne|breakout\b/.test(t) ? "acne" : null,
    ]);
  }

  if ((durationDays >= 7 || hasProlongedBleedLanguage) && (hasHeavySignal || /\bbleeding\b/.test(t))) {
    push("prolonged_bleeding", durationDays >= 10 ? 0.9 : 0.82, [
      "bleeding_duration_7plus_days",
      hasHeavySignal ? "heavy_bleeding" : "ongoing_bleeding",
    ]);
  }

  const hasDischarge = s.discharge || s.unusual_discharge || hasTag(board, "discharge");
  const hasIrritation = hasTag(board, "itching") || /\b(itch|itching|irritation|burning)\b/.test(t);
  if (hasDischarge && hasIrritation) {
    push("discharge_irritation_cluster", 0.78, ["discharge", "irritation_or_itching"]);
  }

  // ── FOUL-SMELLING DISCHARGE (no itching required) ─────────────────────────
  if (s.discharge_foul_smell) {
    push("foul_discharge_alone", 0.84, ["foul_smelling_discharge"]);
  }

  // ── FEVER + DISCHARGE OR PELVIC PAIN ─────────────────────────────────────
  // Targets infection-risk combinations (PID, BV with complication, etc.)
  const hasFever = s.fever || /\b(fever|feverish|running a fever|running a temperature)\b/.test(t);
  if (hasFever && (s.discharge_foul_smell || s.unusual_discharge || hasDischarge || s.pelvic || hasTag(board, "pelvic_pain") || hasTag(board, "cramps"))) {
    push("fever_with_discharge_or_pain", 0.91, [
      "fever",
      s.discharge_foul_smell ? "foul_discharge" : (hasDischarge ? "discharge" : null),
      (s.pelvic || hasTag(board, "pelvic_pain")) ? "pelvic_pain" : null,
      s.chills ? "chills" : null,
    ]);
  }

  // ── BLEEDING AFTER SEX ────────────────────────────────────────────────────
  if (s.bleeding_after_sex) {
    push("bleeding_after_sex", 0.87, ["bleeding_after_sex"]);
  }

  // ── SEVERE UNMANAGED PAIN ─────────────────────────────────────────────────
  // Pain + severe intensity OR explicit medication-failure language.
  // Only fires when there is no heavy bleeding signal (that is already handled
  // by heavy_bleeding_red_flag) to avoid double-routing the same event.
  const hasMedicationFailure = /\b(nothing.*helps?|pain.*not.*going|can'?t.*move|medication.*didn'?t.*help|medicine.*not.*working|ibuprofen.*didn'?t|painkiller.*not|tried.*pain.*still|pain.*meds.*not|pills.*not.*helping)\b/.test(t);
  const hasSeverePain = board.severity === "severe" || hasMedicationFailure;
  if ((s.pelvic || hasTag(board, "pelvic_pain") || hasTag(board, "cramps")) && hasSeverePain && !hasHeavySignal) {
    push("severe_unmanaged_pain", 0.88, [
      s.pelvic ? "pelvic_pain" : "cramps",
      hasMedicationFailure ? "medication_failure" : "severe_intensity",
    ]);
  }

  if (
    hasLateSignal &&
    (/\bstress|stressed|anxious|anxiety|overwhelmed\b/.test(t) || s.anxiety || hasTag(board, "mood_change"))
  ) {
    push("stress_related_delay", 0.72, ["late_period", "stress_or_mood_change"]);
  }

  if (
    s.irregular ||
    hasTag(board, "cycle_irregularity") ||
    (board.recent.recentTopics || []).includes("late") ||
    (board.recent.recentTopics || []).includes("spot")
  ) {
    const vasomotor = s.hot_flashes || s.night_sweats || s.cold_flashes;
    const sleepMood = s.insomnia || s.mood || s.fatigue || hasTag(board, "mood_change");
    if (vasomotor || sleepMood || s.irregular || hasTag(board, "cycle_irregularity")) {
      push("irregular_cycle_pattern", vasomotor && sleepMood ? 0.8 : 0.66, [
        s.irregular || hasTag(board, "cycle_irregularity") ? "cycle_irregularity" : "recent_pattern",
        vasomotor ? "vasomotor_signal" : null,
        sleepMood ? "sleep_or_mood_signal" : null,
      ]);
    }
  }

  const explicitPeriMention = s.peri_mention || /\b(perimenopause|change of life|the change)\b/.test(t);
  const hasIrregularity  = s.irregular || hasTag(board, "cycle_irregularity");
  const hasVasomotor     = s.hot_flashes || s.night_sweats || s.cold_flashes;
  const hasSleepMood     = s.insomnia || s.mood || s.fatigue || hasTag(board, "mood_change");
  // Strong cluster (original): all three groups present → higher confidence
  const periClusterStrong  = hasIrregularity && hasVasomotor && hasSleepMood;
  // Partial cluster: irregularity + at least one of vasomotor or sleep/mood
  const periClusterPartial = hasIrregularity && (hasVasomotor || hasSleepMood);
  const periCluster = periClusterStrong || periClusterPartial;
  const lifeStageAllowsPeri =
    !board.mode.isPregnancy &&
    !board.mode.isPostpartum &&
    !board.mode.isTTC;
  if (lifeStageAllowsPeri && (explicitPeriMention || periCluster)) {
    push("possible_perimenopause_pattern",
      explicitPeriMention ? 0.86 : (periClusterStrong ? 0.72 : 0.65),
      [
        explicitPeriMention ? "explicit_perimenopause_mention" : null,
        periClusterStrong  ? "irregular_vasomotor_sleep_cluster" : null,
        periClusterPartial && !periClusterStrong ? "irregular_with_partial_cluster" : null,
        lifeStageAllowsPeri ? "life_stage_compatible" : null,
      ]
    );
  }

  const hasIrregularSignalByCycleEngine = board.cycle.cycleSignals.some((sig) =>
    ["IRREGULAR_CYCLE", "LENGTHENING_CYCLE_TREND", "SHORTENING_CYCLE_TREND"].includes(sig?.code) && sig?.show
  );
  if (hasIrregularSignalByCycleEngine) {
    push("irregular_cycle_pattern", 0.78, ["cycle_signal_irregularity"]);
  }

  if (hasLateSignal && !s.pelvic && !s.heavy && !s.spotting && pregReasons.length <= 1) {
    push("generic_late_period", 0.58, ["late_period"]);
  }

  if ((s.pelvic || hasTag(board, "pelvic_pain") || hasTag(board, "cramps")) && !hasLateSignal && !s.heavy && !s.spotting) {
    push("generic_cramps", 0.44, [s.pelvic ? "pelvic_pain" : "cramps"]);
  }

  const ranked = interpretations
    .filter((x) => ALLOWED_INTERPRETATION_KEYS.has(x.key))
    .sort((a, b) => b.score - a.score);

  const topInterpretation = ranked[0]?.key || null;
  const confidence = ranked[0]?.score || 0;
  return { interpretations: ranked, topInterpretation, confidence };
}

export function scoreInterpretations(board) {
  // Backward-compatible shape used by selectResponseStrategy.
  const scorecard = scoreInterpretationBoard(board);
  return scorecard.interpretations.map((i) => ({
    key: i.key,
    score: Math.round(i.score * 100),
    why: i.reasons.join(" + ") || "matched rule combination",
    reasons: i.reasons,
  }));
}

export function selectResponseStrategy(board, interpretations) {
  const top = interpretations?.[0] || null;
  if (!top) return { strategy: "defer", interpretation: null, why: "no strong interpretation", confidence: 0 };

  const topScore = clamp01((Number(top.score) || 0) / 100);
  // Low-confidence interpretation remains assistive only: fall through safely.
  if (topScore < 0.55 && top.key !== "clarification_needed" && top.key !== "heavy_bleeding_red_flag") {
    return { strategy: "defer", interpretation: top.key, why: top.why, confidence: topScore };
  }

  if (top.key === "heavy_bleeding_red_flag") {
    return {
      strategy: "safety_redirect",
      interpretation: top.key,
      next: "HEAVY_URGENT",
      payload: { reason: "reasoning:heavy_bleeding_red_flag" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "clarification_needed") {
    const days = board.cycle.overdueDays;
    const lateLine = board.cycle.hasLateContext
      ? (typeof days === "number" && days < -1
          ? `I mean your period looks later than expected from your logged dates - around ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} late by estimate.`
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
      confidence: topScore,
    };
  }

  if (top.key === "pregnancy_signal_cluster") {
    return {
      strategy: "continue_prior_topic",
      interpretation: top.key,
      next: "LATE_TEST_Q",
      payload: { reason: "reasoning:pregnancy_signal_cluster" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "late_plus_cramps") {
    // Keep this interpretation assistive only so existing ambiguity handling
    // (e.g., MEDIUM_CONFIRM / inferRoute) stays in control.
    return {
      strategy: "defer",
      interpretation: top.key,
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "spotting_with_pain") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "SPOT_INTRO",
      payload: { reason: "reasoning:spotting_with_pain" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "discharge_irritation_cluster") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "ELSE_DISCHARGE_ENTRY",
      payload: { reason: "reasoning:discharge_irritation_cluster" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "irregular_cycle_pattern") {
    return {
      strategy: "defer",
      interpretation: top.key,
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "prolonged_bleeding") {
    return {
      strategy: "triage",
      interpretation: top.key,
      next: "HEAVY_ROUTE_B",
      payload: { reason: "reasoning:prolonged_bleeding" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "ovulation_pattern") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "PELVIC_OVULATION_ROUTE",
      payload: { reason: "reasoning:ovulation_pattern" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "luteal_pattern") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "MOOD_INTRO",
      payload: { reason: "reasoning:luteal_pattern" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "possible_perimenopause_pattern") {
    return {
      strategy: "triage",
      interpretation: top.key,
      next: "PERIMENOPAUSE_INTRO",
      payload: { reason: "reasoning:possible_perimenopause_pattern" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "stress_related_delay") {
    return {
      strategy: "continue_prior_topic",
      interpretation: top.key,
      next: "LATE_NO_GUIDANCE",
      payload: { reason: "reasoning:stress_related_delay" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "generic_late_period") {
    // Generic late signal should not force a route ahead of existing rule
    // confidence and pendingRoute confirmation behavior.
    return {
      strategy: "defer",
      interpretation: top.key,
      why: top.why,
      confidence: topScore,
    };
  }

  // ── NEW: safety-gap fixes ──────────────────────────────────────────────────

  if (top.key === "fever_with_discharge_or_pain") {
    return {
      strategy: "triage",
      interpretation: top.key,
      next: "ELSE_DISCHARGE_ENTRY",
      payload: { reason: "reasoning:fever_with_discharge_or_pain" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "foul_discharge_alone") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "ELSE_DISCHARGE_ENTRY",
      payload: { reason: "reasoning:foul_discharge_alone" },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "bleeding_after_sex") {
    return {
      strategy: "clarify",
      interpretation: top.key,
      next: "SPOT_INTRO",
      payload: { reason: "reasoning:bleeding_after_sex", postSex: true },
      why: top.why,
      confidence: topScore,
    };
  }

  if (top.key === "severe_unmanaged_pain") {
    return {
      strategy: "triage",
      interpretation: top.key,
      next: "HEAVY_ROUTE_C",
      payload: { reason: "reasoning:severe_unmanaged_pain" },
      why: top.why,
      confidence: topScore,
    };
  }

  return {
    strategy: "defer",
    interpretation: top.key,
    why: top.why,
    confidence: topScore,
  };
}
