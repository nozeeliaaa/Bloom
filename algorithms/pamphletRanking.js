/**
 * bloom-pamphlet-ranking.js
 * ==========================
 * Personalized pamphlet ranking algorithm for Bloom.
 *
 * This is NOT a filter - it is a ranking system.
 * All pamphlets remain accessible. This only controls
 * what appears first based on user context.
 *
 * Safety exception: explicit reproductive content is
 * suppressed for users flagged as minors (age < 18).
 *
 * Scoring:
 *   +5  matches user goal
 *   +4  matches recent symptoms
 *   +4  matches recent Bloomie topics
 *   +3  matches life stage
 *   +3  matches cycle pattern
 *   -10 safety suppression (minor + explicit content)
 *
 * COMP3901: Educational content only - not medical advice.
 */

/* ------------------------------------------------------------------ */
/* Scoring weights                                                     */
/* ------------------------------------------------------------------ */

const WEIGHTS = {
  GOAL_MATCH:     5,
  SYMPTOM_MATCH:  4,
  TOPIC_MATCH:    4,
  LIFE_STAGE:     3,
  CYCLE_PATTERN:  3,
  SAFETY_PENALTY: -10,
};

/* ------------------------------------------------------------------ */
/* Goal → tag mapping                                                  */
/* ------------------------------------------------------------------ */

const GOAL_TAGS = {
  track_cycle:   ['cycle', 'menstruation', 'symptoms', 'irregular', 'pms'],
  conceive:      ['fertility', 'ovulation', 'ttc', 'pregnancy_prep', 'conception'],
  no_period:     ['symptoms', 'hormonal_imbalance', 'no_period', 'amenorrhea'],
  pregnancy:     ['pregnancy', 'trimester', 'prenatal', 'fetal_development'],
  perimenopause: ['perimenopause', 'menopause', 'transition', 'hormonal_changes'],
};

/* ------------------------------------------------------------------ */
/* Life stage → tag mapping                                            */
/* ------------------------------------------------------------------ */

function getLifeStageTags(age) {
  if (!age) return [];
  if (age < 18)  return ['minor', 'teen', 'puberty', 'getting_to_know_my_body'];
  if (age < 25)  return ['young_adult', 'cycle', 'general'];
  if (age < 40)  return ['adult', 'cycle', 'fertility'];
  if (age < 50)  return ['perimenopause', 'transition', 'hormonal_changes'];
  return               ['menopause', 'postmenopause', 'hormonal_changes'];
}

/* ------------------------------------------------------------------ */
/* Safety check                                                        */
/* ------------------------------------------------------------------ */

function isSafeForUser(pamphlet, userAge) {
  if (!userAge || userAge >= 18) return true;
  const explicitTags = ['explicit', 'sexual_health_explicit', 'contraception_detail'];
  return !pamphlet.tags?.some((t) => explicitTags.includes(t));
}

/* ------------------------------------------------------------------ */
/* Core scoring function                                               */
/* ------------------------------------------------------------------ */

/**
 * Score a single pamphlet against user context.
 *
 * @param {Object} pamphlet   - pamphlet object with tags, goalTags, targetGroups, symptomTags
 * @param {Object} userContext
 * @returns {number} score
 */
function scorePamphlet(pamphlet, userContext) {
  const {
    goal           = null,
    age            = null,
    recentSymptoms = [],
    recentTopics   = [],
    cyclePatterns  = [],
  } = userContext;

  let score = 0;

  const pamphletTags = [
    ...(pamphlet.tags        || []),
    ...(pamphlet.goalTags    || []),
    ...(pamphlet.symptomTags || []),
    ...(pamphlet.targetGroups|| []),
  ].map((t) => t.toLowerCase());

  // ── Safety suppression for minors ───────────────────────────
  if (!isSafeForUser(pamphlet, age)) {
    return WEIGHTS.SAFETY_PENALTY;
  }

  // ── Goal match ───────────────────────────────────────────────
  if (goal && GOAL_TAGS[goal]) {
    const goalTagSet = GOAL_TAGS[goal];
    if (goalTagSet.some((t) => pamphletTags.includes(t))) {
      score += WEIGHTS.GOAL_MATCH;
    }
  }

  // ── Recent symptom match ─────────────────────────────────────
  const symptomMatches = recentSymptoms.filter((s) =>
    pamphletTags.includes(s.toLowerCase())
  );
  if (symptomMatches.length > 0) {
    score += WEIGHTS.SYMPTOM_MATCH;
    // Bonus for multiple symptom matches
    score += Math.min(symptomMatches.length - 1, 2);
  }

  // ── Recent Bloomie topic match ───────────────────────────────
  const topicMatches = recentTopics.filter((t) =>
    pamphletTags.includes(t.toLowerCase())
  );
  if (topicMatches.length > 0) {
    score += WEIGHTS.TOPIC_MATCH;
  }

  // ── Life stage match ─────────────────────────────────────────
  const lifeStageTags = getLifeStageTags(age);
  if (lifeStageTags.some((t) => pamphletTags.includes(t))) {
    score += WEIGHTS.LIFE_STAGE;
  }

  // ── Cycle pattern match ──────────────────────────────────────
  const patternMatches = cyclePatterns.filter((p) =>
    pamphletTags.includes(p.toLowerCase())
  );
  if (patternMatches.length > 0) {
    score += WEIGHTS.CYCLE_PATTERN;
  }

  return score;
}

/* ------------------------------------------------------------------ */
/* Main ranking function                                               */
/* ------------------------------------------------------------------ */

/**
 * Rank all pamphlets by relevance to the user.
 *
 * @param {Object[]} pamphlets    - array of pamphlet objects
 * @param {Object}   userContext  - user goal, age, symptoms, topics, patterns
 * @param {Object}   opts
 * @param {number}   opts.topN    - return top N results (default: all)
 * @param {boolean}  opts.debug   - include scores in output
 * @returns {Object[]} ranked pamphlets (highest score first)
 */
export function rankPamphlets(pamphlets = [], userContext = {}, opts = {}) {
  const { topN = null, debug = false } = opts;

  const scored = pamphlets.map((pamphlet) => ({
    ...pamphlet,
    _score: scorePamphlet(pamphlet, userContext),
  }));

  // Sort by score descending, then alphabetically by title for stability
  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return (a.title || '').localeCompare(b.title || '');
  });

  const results = topN ? scored.slice(0, topN) : scored;

  if (!debug) {
    return results.map(({ _score, ...pamphlet }) => pamphlet);
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Pattern-based boost                                                 */
/* ------------------------------------------------------------------ */

/**
 * Given detected patterns from bloom-monthly-comparison.js,
 * return additional tags to boost in the ranking.
 *
 * @param {string[]} patterns  - from detectRecurringPatterns()
 * @returns {string[]}         - boost tags to add to userContext.cyclePatterns
 */
export function getPamphletBoostTagsFromPatterns(patterns = []) {
  const boostMap = {
    irregular_cycles:          ['irregular', 'pcos', 'hormonal_imbalance'],
    consistently_long_cycles:  ['long_cycles', 'pcos', 'hormonal_imbalance'],
    consistently_short_cycles: ['short_cycles', 'hormonal_imbalance'],
    recurring_cramps:          ['painful_periods', 'dysmenorrhea', 'pms'],
    recurring_fatigue:         ['fatigue', 'iron_deficiency', 'energy'],
    recurring_heavyflow:       ['heavy_bleeding', 'menorrhagia'],
    recurring_moodswings:      ['mood', 'pmdd', 'pms'],
    recurring_nausea:          ['nausea', 'hormonal_imbalance'],
    recurring_spotting:        ['spotting', 'irregular'],
  };

  const tags = [];
  for (const pattern of patterns) {
    if (boostMap[pattern]) tags.push(...boostMap[pattern]);
  }
  return [...new Set(tags)];
}
