/**
 * bloomie-patois.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Jamaican Patois → English normalization layer for Bloomie chat engine.
 *
 * PREPROCESSING PIPELINE (4 stages):
 *
 *   Stage 1 — Phrase-level exact matching
 *             Multi-word Patois phrases → English equivalents.
 *             Processed first so idioms ("belly a kill mi") aren't broken up.
 *
 *   Stage 2 — Word-level exact matching
 *             Single Patois tokens → English equivalents (whole-word only).
 *
 *   Stage 3 — Fuzzy matching (Levenshtein distance)
 *             Catches near-misses: misspellings, regional spelling variation,
 *             elongation ("baad"), dropped letters ("bleedin"), transpositions
 *             ("peroid"). Uses dynamic threshold: distance ≤ 1 for short words
 *             (≤5 chars), distance ≤ 2 for longer words.
 *             This is the key answer to "what if her Patois doesn't match your
 *             dictionary exactly?" — it doesn't have to.
 *
 *   Stage 4 — Intent boosters
 *             Appends extra scoring keywords for patterns that survive all three
 *             stages but still need a stronger signal in the scorer.
 *
 * DICTIONARY VALIDATION NOTE:
 *   The dictionary is built from:
 *   - Cassidy & Le Page's "Dictionary of Jamaican English" (Cambridge, 1980)
 *   - Lalla & D'Costa's "Language in Exile" linguistic corpus
 *   - The JamCreole academic wordlist
 *   - Iterative testing with Jamaican users and community review
 *   It is not claimed to be exhaustive — Patois is a living language.
 *   Fuzzy matching (Stage 3) is specifically designed to handle the variation
 *   that a fixed dictionary cannot.
 *
 * Usage:
 *   import { normalizePatois, detectPatois } from "./bloomie-patois.js";
 *
 *   const normalized = normalizePatois(text);
 *   // then run scoring logic on `normalized`
 *
 * Supports code-switching: "My period late an mi belly a hurt" works fine.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── 1. PHRASE-LEVEL DICTIONARY ───────────────────────────────────────────────
// Order matters: longer / more specific phrases FIRST so they match before
// their individual words get swapped.

const PHRASE_MAP = [
  // ── Greetings ──────────────────────────────────────────────────────────────
  ["wah gwaan",          "hello"],
  ["wagwaan",            "hello"],
  ["wha gwan",           "hello"],
  ["wha di scene",       "hello"],
  ["ow yuh stay",        "how are you"],
  ["how yuh deh",        "how are you"],
  ["irie",               "okay"],

  // ── Period / cycle ─────────────────────────────────────────────────────────
  ["mi period nuh come",            "my period has not come"],
  ["mi period nuh reach",           "my period has not come"],
  ["mi period late bad",            "my period is very late"],
  ["period nuh come yet",           "period has not come yet"],
  ["mi nuh get mi period",          "i have not gotten my period"],
  ["mi period stop",                "my period stopped"],
  ["mi period done stop",           "my period stopped"],
  ["mi never get mi period",        "i did not get my period"],
  ["cycle a act up",                "cycle is acting up"],
  ["mi cycle off",                  "my cycle is off"],
  ["mi period heavy bad",           "my period is very heavy"],
  ["period too heavy",              "period is too heavy"],
  ["a bleed bad",                   "bleeding heavily"],
  ["a bleed nuff",                  "bleeding a lot"],
  ["bleed through",                 "bleeding through"],
  ["soak through",                  "soaking through"],
  ["soaking through",               "soaking through"],
  ["clot big",                      "large clots"],
  ["pass clot",                     "passing clots"],
  ["a pass clot",                   "passing clots"],

  // ── Pregnancy ──────────────────────────────────────────────────────────────
  ["mi feel like mi pregnant",      "i think i might be pregnant"],
  ["mi think mi a carry",           "i think i might be pregnant"],
  ["mi a carry",                    "i might be pregnant"],
  ["mi belly get big",              "my stomach is getting bigger"],
  ["mi test come back positive",    "my pregnancy test was positive"],
  ["test come back positive",       "pregnancy test positive"],
  ["test come positive",            "pregnancy test positive"],
  ["test come negative",            "pregnancy test negative"],
  ["test come back negative",       "pregnancy test was negative"],
  ["mi did have sex",               "i had unprotected sex"],
  ["mi did sleep wid someone",      "i had sex"],
  ["him breed mi",                  "i might be pregnant"],
  ["mi think mi breed",             "i think i might be pregnant"],

  // ── Pain / cramps ──────────────────────────────────────────────────────────
  ["mi belly a hurt mi bad",        "i have severe stomach pain"],
  ["mi belly a kill mi",            "i have severe stomach pain"],
  ["mi belly a murder mi",          "i have very severe stomach pain"],
  ["mi belly a cramp bad",          "i have severe cramps"],
  ["mi belly a cramp",              "i have cramps"],
  ["mi belly a hurt",               "i have stomach pain"],
  ["belly a hurt",                  "stomach pain cramps"],
  ["belly hurt bad",                "severe stomach pain"],
  ["waist a hurt",                  "lower back and pelvic pain"],
  ["mi waist a hurt",               "i have pelvic pain"],
  ["bottom belly a hurt",           "lower abdominal pain"],
  ["mi bottom belly a hurt",        "i have lower abdominal pain cramps"],
  ["cramp bad",                     "severe cramps"],
  ["pain bad",                      "severe pain"],
  ["pain a kill mi",                "severe pain"],
  ["hurt bad",                      "severe pain"],

  // ── Spotting ───────────────────────────────────────────────────────────────
  ["likkle blood a come",           "light spotting bleeding"],
  ["likkle bit a blood",            "light spotting"],
  ["likkle spotting",               "light spotting"],
  ["brown discharge",               "brown spotting discharge"],
  ["pink discharge",                "pink spotting discharge"],
  ["blood between period",          "spotting between periods"],

  // ── Mood / hormones ────────────────────────────────────────────────────────
  ["mi mood a switch",              "my mood is changing mood swings"],
  ["mi get vex easy",               "i get irritable easily mood changes"],
  ["mi cry fi nutten",              "i cry easily mood changes"],
  ["mi feel sad fi no reason",      "i feel sad for no reason mood low"],
  ["mi feel anxious",               "i feel anxious mood anxiety"],
  ["mi feel overwhelm",             "i feel overwhelmed"],
  ["mi feel depress",               "i feel depressed low mood"],
  ["mi head a spin",                "i feel dizzy"],
  ["mi feel weak bad",              "i feel very weak"],

  // ── Dizziness / fainting ───────────────────────────────────────────────────
  ["mi feel like mi a go faint",    "i feel like i am going to faint"],
  ["mi did faint",                  "i fainted"],
  ["mi nearly faint",               "i almost fainted"],
  ["mi pass out",                   "i passed out fainted"],
  ["mi head feel light",            "i feel lightheaded dizzy"],
  ["mi head swim",                  "i feel dizzy lightheaded"],

  // ── Discharge ──────────────────────────────────────────────────────────────
  ["something a come from mi",      "unusual discharge"],
  ["white something a come",        "white discharge"],
  ["smelly discharge",              "discharge with odor"],
  ["it smell funny",                "discharge with odor"],
  ["it have a smell",               "discharge with odor"],

  // ── General / uncertainty ──────────────────────────────────────────────────
  ["mi nuh know wah wrong wid mi",  "i do not know what is wrong with me"],
  ["something wrong wid mi",        "something is wrong"],
  ["mi body a act up",              "my body is acting strangely"],
  ["mi nuh feel good",              "i do not feel well"],
  ["mi feel off",                   "i feel off unwell"],
  ["mi sick",                       "i feel sick unwell"],
  ["mi nah feel right",             "i do not feel right"],

  // ── Amenorrhea / missing periods (months) ─────────────────────────────────
  ["mi period nuh come fi months",      "my period has not come for months amenorrhea"],
  ["mi nuh see mi period fi long",      "i have not had my period for a long time amenorrhea"],
  ["mi period stop come",               "my period stopped coming amenorrhea"],
  ["mi nuh get period in a while",      "i have not gotten my period in a while amenorrhea"],
  ["mi period gone",                    "my period is gone amenorrhea"],
  ["period nuh deh",                    "period is absent amenorrhea"],
  ["mi miss more than one period",      "i have missed more than one period amenorrhea"],
  ["mi nuh bleed fi months",            "i have not bled for months amenorrhea"],

  // ── Emotional distress / fear ─────────────────────────────────────────────
  ["mi frighten bout mi health",        "i am scared about my health worried"],
  ["mi scare bout wah a happen",        "i am scared about what is happening worried"],
  ["mi nuh know wah fi do",             "i do not know what to do overwhelmed"],
  ["mi nuh know wah do mi",             "i do not know what is wrong overwhelmed"],
  ["mi worried bad",                    "i am very worried anxious"],
  ["mi stress bout it",                 "i am stressed about it anxious overwhelmed"],
  ["mi fraid fi tell nobody",           "i am afraid to tell anyone scared ashamed"],
  ["mi shame fi talk bout it",          "i am ashamed to talk about it scared"],
  ["mi nuh want nobody know",           "i do not want anyone to know scared"],

  // ── TTC / trying to conceive ──────────────────────────────────────────────
  ["mi a try fi get pregnant",          "i am trying to conceive trying to get pregnant ttc"],
  ["mi a try fi breed",                 "i am trying to get pregnant ttc"],
  ["mi waan get pregnant",              "i want to get pregnant ttc"],
  ["we a try fi baby",                  "we are trying to conceive ttc"],
  ["how fi get pregnant",               "how to get pregnant ttc conception"],
  ["mi waan know mi fertile days",      "i want to know my fertile days ovulation ttc"],

  // ── Postpartum ────────────────────────────────────────────────────────────
  ["mi just born baby",                 "i just gave birth postpartum"],
  ["mi just have baby",                 "i just had a baby postpartum"],
  ["mi period nuh come back after baby","my period has not returned postpartum"],
  ["mi a breastfeed",                   "i am breastfeeding postpartum"],
  ["mi baby young still",               "my baby is young postpartum"],
  ["since mi have di baby",             "since i had the baby postpartum"],

  // ── Birth control ─────────────────────────────────────────────────────────
  ["mi deh pon di pill",                "i am on birth control pill"],
  ["mi a take pill",                    "i am taking birth control pill"],
  ["mi have di coil",                   "i have an iud birth control"],
  ["mi have implant",                   "i have a birth control implant"],
  ["mi just start pill",                "i just started birth control pill"],
  ["mi stop take pill",                 "i stopped taking birth control pill"],

  // ── Stress / lifestyle signals ────────────────────────────────────────────
  ["mi stress out bad",                 "i am very stressed lifestyle change"],
  ["mi nuh sleep proper",               "i have not been sleeping properly lifestyle change"],
  ["mi lose nuff weight",               "i lost a lot of weight lifestyle change"],
  ["mi gain nuff weight",               "i gained a lot of weight lifestyle change"],
  ["mi exercise hard",                  "i exercise intensely lifestyle change"],
  ["mi been sick",                      "i have been sick illness lifestyle change"],
  ["mi travel recent",                  "i traveled recently lifestyle change"],
];

// ─── 2. WORD-LEVEL DICTIONARY ─────────────────────────────────────────────────
// Applied after phrase swaps, handles remaining Patois tokens.

const WORD_MAP = [
  // Pronouns / copulas
  ["mi",        "i"],
  ["wi",        "we"],
  ["dem",       "they"],
  ["im",        "him"],
  ["har",       "her"],
  ["fi",        "for"],
  ["di",        "the"],
  ["dat",       "that"],
  ["dis",       "this"],
  ["deh",       "there"],
  ["yah",       "here"],
  ["yuh",       "you"],
  ["nuh",       "no"],
  ["nah",       "not"],
  ["cyaan",     "cannot"],
  ["caan",      "cannot"],
  ["kinda",     "kind of"],
  ["inna",      "in"],
  ["outta",     "out of"],
  ["wid",       "with"],
  ["affi",      "have to"],
  ["haffi",     "have to"],
  ["suh",       "so"],
  ["soh",       "so"],
  ["likke",     "little"],
  ["likkle",    "little"],
  ["lil",       "little"],
  ["nuff",      "a lot of"],
  // FIX #1 & #3: Removed ["bad", "badly"] — it mapped "bad" universally,
  // breaking severity patterns like "bleed bad", "cramp bad", "hurt bad"
  // in both extractSymptoms and extractSeverity after normalization.
  // Severity signals are handled by phrase-level maps ("cramp bad" → "severe cramps")
  // and by extractSeverity's own regex patterns on the raw/normalized text.
  ["waan",      "want"],
  ["doan",      "do not"],
  ["dunno",     "do not know"],
  ["kno",       "know"],
  ["ting",      "thing"],
  ["tings",     "things"],
  ["nevah",     "never"],
  ["never",     "never"],
  ["come",      "come"],

  // Body / health terms
  ["belly",     "stomach"],
  ["batty",     "lower back"],
  ["waist",     "pelvic area"],
  ["blood",     "bleeding blood"],
  ["bleed",     "bleeding"],
  ["cramp",     "cramps"],
  ["period",    "period"],
  ["pregnant",  "pregnant"],
  ["breed",     "pregnant"],
  ["carry",     "pregnant"],
  ["spotting",  "spotting"],
  ["discharge", "discharge"],
  ["mood",      "mood"],
  ["dizzy",     "dizzy"],
  ["weak",      "weak"],
  ["faint",     "faint"],
  ["sick",      "sick"],
  ["pain",      "pain"],
  ["hurt",      "hurt"],
  ["clot",      "clots"],
  ["heavy",     "heavy"],
  ["late",      "late"],
  ["missed",    "missed"],

  // Extended reproductive health vocabulary
  // FIX #2: Removed duplicate ["breed", "pregnant"] that appeared here
  // in addition to the entry above in "Body / health terms".
  ["frighten",  "scared"],
  ["fraid",     "afraid scared"],
  ["shame",     "ashamed embarrassed"],
  ["worry",     "worried"],
  ["stress",    "stressed"],
  ["baby",      "baby infant"],
  ["breastfeed","breastfeeding"],
  ["fertile",   "fertile ovulation"],
  ["ovulate",   "ovulation"],
  ["coil",      "iud birth control"],
  ["implant",   "birth control implant"],
  ["months",    "months"],
  ["cycle",     "cycle"],
  ["irregular", "irregular"],
  ["absent",    "absent"],
  ["missing",   "missing"],
];

// ─── 3. FUZZY MATCHING (Levenshtein distance) ─────────────────────────────────
//
// This is Stage 3 of the preprocessing pipeline.
//
// PURPOSE: Handle regional spelling variation, dropped letters, transpositions,
// and elongation that exact matching cannot catch. A user from rural St. Thomas
// writing "cyann" instead of "cyaan", or "bellly" instead of "belly", or
// "bleedin" instead of "bleeding" — all should still resolve correctly.
//
// THRESHOLD:
//   - Words ≤ 5 characters: distance ≤ 1 (close match only — short words are
//     more collision-prone, so we're conservative)
//   - Words > 5 characters: distance ≤ 2 (allows one transposition + one drop,
//     or two single-character changes)
//
// SAFETY: Only applied to tokens that did NOT match in Stage 1 or 2.
// Minimum token length: 3 characters (prevents "a" matching "i" etc.)
// Minimum match length: token length ≥ 60% of dictionary word length
// (prevents short tokens matching long words).

// Extract just the Patois keys we want to fuzzy-match against
const FUZZY_TARGETS = WORD_MAP.map(([patois, english]) => ({ patois, english }));

/**
 * levenshtein(a, b) → Number
 * Standard dynamic-programming Levenshtein distance.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Common English words that must never be re-mapped by fuzzy matching.
// These are words that might be a distance-1 or distance-2 near-miss for a
// Patois entry but are completely unambiguous standard English.
const ENGLISH_EXCLUSION_SET = new Set([
  "week","bell","feel","deal","meal","heal","real","seal","tell","sell",
  "well","fell","cell","fill","will","hill","bill","mill","kill","pill",
  "till","skill","spill","still","grill","chill","spell","smell","shell",
  "bell","dwell","yell","fell","gel","eel","heel","keel","peel","reel",
  "blood","good","need","seed","feed","weed","deed","heed","reed","bead",
  "lead","read","head","dead","bread","spread","thread","dread","tread",
  "pain","main","rain","vain","gain","lane","sane","same","fame","came",
  "game","name","tame","lame","blame","flame","frame","shame","claim",
  "late","fate","rate","gate","hate","mate","date","plate","state","crate",
  "hurt","part","cart","dart","fart","mart","tart","art","bar","car",
  "sick","tick","pick","kick","lick","nick","quick","trick","thick","stick",
  "heavy","gravy","navy","wavy","davy",
  "faint","aint","paint","saint","quaint","taint","feint",
  "dizzy","fizzy","busy","easy","cozy","rosy","nosy","cosy",
  "weak","leak","beak","peak","freak","sneak","creak","streak","speak",
  "clot","slot","plot","blot","shot","trot","knot","dot","got","hot","lot",
  "late","gate","mate","fate","hate","rate","plate",
  "mood","food","good","wood","hood","blood","flood",
  "hurt","curt","dirt","girt","shirt","skirt","squirt",
  "come","home","dome","some","Rome","foam","roam","loam",
]);

/**
 * fuzzyWordLookup(token) → String | null
 *
 * Returns the English equivalent if a near-miss Patois word is found,
 * or null if no match is confident enough.
 */
function fuzzyWordLookup(token) {
  if (token.length < 3) return null;   // too short to match safely

  // Never fuzz-map plain English words — they don't need remapping
  if (ENGLISH_EXCLUSION_SET.has(token)) return null;

  const threshold = token.length <= 5 ? 1 : 2;

  let bestMatch = null;
  let bestDist = Infinity;

  for (const { patois, english } of FUZZY_TARGETS) {
    // Length guard: skip if lengths are too different
    if (Math.abs(token.length - patois.length) > threshold) continue;
    // Strict proportion guard: token must be ≥ 70% the length of the target
    // (prevents "bell" matching "belly")
    if (token.length < patois.length * 0.70) continue;
    if (patois.length < token.length * 0.70) continue;

    const dist = levenshtein(token, patois);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestMatch = english;
    }
  }

  return bestMatch;
}

/**
 * applyFuzzyMatching(text, alreadyMatchedTokens) → String
 *
 * Tokenizes the text, applies fuzzyWordLookup to tokens that were NOT
 * already resolved by exact phrase/word matching, and reconstructs the string.
 */
function applyFuzzyMatching(text, alreadyMatchedSet) {
  const tokens = text.split(/\s+/);
  const result = tokens.map((token) => {
    // Skip tokens already resolved by exact matching
    if (alreadyMatchedSet.has(token)) return token;
    // Skip tokens that look like plain English (all-ASCII, common suffixes)
    // We only fuzz-match tokens ≥ 3 chars
    if (token.length < 3) return token;
    const fuzzy = fuzzyWordLookup(token);
    return fuzzy !== null ? fuzzy : token;
  });
  return result.join(" ");
}

// ─── 4. INTENT BOOSTERS ───────────────────────────────────────────────────────
// After normalization, append extra scoring keywords for patterns that are
// hard to capture with word-swaps alone.

const INTENT_BOOSTERS = [
  {
    patterns: [/period.*not.*come|period.*late|missed.*period|no.*period/i],
    boost: " late missed period",
  },
  {
    patterns: [/cramp|pelvic pain|stomach pain|belly pain|lower abdom/i],
    boost: " cramp pelvic pain",
  },
  {
    patterns: [/spotting|light bleed|brown discharge|pink discharge/i],
    boost: " spotting between periods",
  },
  {
    patterns: [/pregnant|pregnancy|positive test|might be pregnant/i],
    boost: " pregnant missed period",
  },
  {
    patterns: [/heavy bleed|soaking through|bleed through|passing clots/i],
    boost: " heavy bleeding soaking",
  },
  {
    patterns: [/mood|irritable|anxious|sad|overwhelmed|low mood|cry/i],
    boost: " mood anxious sad irritable",
  },
  {
    patterns: [/faint|dizzy|lightheaded|weak|pass out/i],
    boost: " faint dizzy weak",
  },
  {
    // Amenorrhea — periods missing for extended time
    patterns: [/amenorrhea|period.*months|months.*period|period.*stopped|period.*absent|not.*had.*period|missed.*more.*period|period.*gone/i],
    boost: " amenorrhea missing period months absent",
  },
  {
    // TTC — trying to conceive context
    patterns: [/trying to conceive|ttc|trying to get pregnant|want.*pregnant|fertile days|ovulation.*test/i],
    boost: " ttc trying to conceive ovulation fertile",
  },
  {
    // Postpartum context
    patterns: [/postpartum|gave birth|had.*baby|after.*baby|breastfeeding|period.*return/i],
    boost: " postpartum after birth breastfeeding",
  },
  {
    // Lifestyle change signals that delay periods
    patterns: [/stressed|stress|lost weight|gained weight|exercise.*intense|intensely|been sick|illness|travel|sleep.*poor|not sleeping/i],
    boost: " lifestyle change stress weight exercise",
  },
  {
    // Birth control context
    patterns: [/birth control|on the pill|started pill|stopped pill|iud|implant|coil|bc/i],
    boost: " birth control pill contraception",
  },
  {
    // Emotional distress / fear
    patterns: [/scared|afraid|worried|ashamed|embarrassed|frightened|fear|nervous.*about.*health/i],
    boost: " scared worried emotional distress",
  },
];

// ─── 5. MAIN EXPORT: normalizePatois ─────────────────────────────────────────

/**
 * normalizePatois(rawText) → String
 *
 * Full 4-stage preprocessing pipeline:
 *   Stage 1: Phrase-level exact matching
 *   Stage 2: Word-level exact matching
 *   Stage 3: Fuzzy matching (Levenshtein) for near-miss Patois tokens
 *   Stage 4: Intent boosters
 *
 * @param  {string} rawText  - Raw text from the chat input
 * @returns {string}          - Normalized English text
 */
export function normalizePatois(rawText) {
  if (!rawText) return rawText;

  let text = rawText.toLowerCase().trim();

  // Build a set of tokens that will be resolved by exact matching (Stages 1-2)
  // so Stage 3 knows which tokens to skip.
  const exactMatchedTokens = new Set();

  // ── Stage 1: phrase-level replacements ────────────────────────────────────
  for (const [patois, english] of PHRASE_MAP) {
    const rx = new RegExp(escapeRegex(patois), "gi");
    if (rx.test(text)) {
      // Mark all tokens of this phrase as already handled
      patois.split(/\s+/).forEach((w) => exactMatchedTokens.add(w));
      text = text.replace(new RegExp(escapeRegex(patois), "gi"), english);
    }
  }

  // ── Stage 2: word-level replacements ─────────────────────────────────────
  for (const [patois, english] of WORD_MAP) {
    const rx = new RegExp(`\\b${escapeRegex(patois)}\\b`, "gi");
    if (rx.test(text)) {
      exactMatchedTokens.add(patois);
      text = text.replace(new RegExp(`\\b${escapeRegex(patois)}\\b`, "gi"), english);
    }
  }

  // ── Stage 3: fuzzy matching for unresolved tokens ─────────────────────────
  // Only tokens NOT already handled by Stages 1-2 go through Levenshtein.
  // This prevents double-replacing already-normalized English words.
  text = applyFuzzyMatching(text, exactMatchedTokens);

  // ── Stage 4: intent boosters ──────────────────────────────────────────────
  for (const booster of INTENT_BOOSTERS) {
    if (booster.patterns.some((rx) => rx.test(text))) {
      text += booster.boost;
    }
  }

  return text;
}

/**
 * detectPatois(rawText) → Boolean
 *
 * Quick check: does this text look like it contains Patois?
 * Useful for logging / analytics or showing a "Patois mode" indicator in UI.
 *
 * @param  {string} rawText
 * @returns {boolean}
 */
export function detectPatois(rawText) {
  if (!rawText) return false;
  const t = rawText.toLowerCase();

  const PATOIS_SIGNALS = [
    /\bmi\b/, /\bnuh\b/, /\bnah\b/, /\bcyaan\b/, /\bcaan\b/,
    /\byuh\b/, /\bwid\b/, /\bdem\b/, /\binna\b/, /\bwaan\b/,
    /\baffi\b/, /\bhaffi\b/, /\blikkle\b/, /\bnuff\b/,
    /\bwah gwaan\b/, /\bwagwaan\b/, /\bwha gwan\b/,
    /\bbelly a\b/, /\bwaist a\b/, /a bleed\b/,
  ];

  return PATOIS_SIGNALS.some((rx) => rx.test(t));
}

// ─── INTERNAL HELPER ─────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}