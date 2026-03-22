// ─── 1. ENTITY EXTRACTOR ─────────────────────────────────────────────────────
export function extractEntities(text) {
  const t = String(text || "").toLowerCase().trim();

  return {
    symptoms:  extractSymptoms(t),
    duration:  extractDuration(t),
    severity:  extractSeverity(t),
    timing:    extractTiming(t),
    pregnancy: extractPregnancy(t),
    urgent:    extractUrgency(t),
    raw:       t,
  };
}

// ── 1a. Symptoms ──────────────────────────────────────────────────────────────
// Covers all 60 catalog keys. Backward-compatible: original 8 keys preserved.
// New keys added below — all map to at least one symptomCatalog code via
// SYMPTOM_TO_CATALOG_KEYS (exported at bottom of file).
function extractSymptoms(t) {
  return {
    // ── ORIGINAL 8 (kept exactly — inferRoute depends on these names) ────────
    late:           /\b(late|missed|no period|period.*not come|period.*nuh come|period.*hasn't|period.*didn't)\b/.test(t),
    heavy:          /\b(heavy|soaking|soaked|bleed.*bad|bleed.*nuff|flooding|clot|clots|bleed through)\b/.test(t),
    spotting:       /\b(spot|spotting|pink|brown.*discharge|blood.*between|between.*period)\b/.test(t),
    pelvic:         /\b(cramp|cramps|pelvic|lower.*abdomen|stomach.*pain|stomach.*hurt|belly.*hurt|belly.*pain|waist.*hurt|bottom.*belly)\b/.test(t),
    mood:           /\b(mood|sad|anxious|irritable|tired|fatigue|drained|weak|overwhelm|exhaust|low energy|emotional|cry|tearful)\b/.test(t),
    discharge:      /\b(discharge|smell|odor|white.*coming|something.*coming)\b/.test(t),
    nausea:         /\b(nausea|nauseous|vomit|sick to.*stomach|throw up|queasy)\b/.test(t),
    dizziness:      /\b(dizzy|dizziness|lightheaded|faint|head.*spin|head.*swim|feel.*weak)\b/.test(t),

    // ── BLEEDING ─────────────────────────────────────────────────────────────
    large_clots:    /\b(large clot|big clot|clot.*size|liver.*clot|quarter.*size|golf.*clot)\b/.test(t),

    // ── PAIN ─────────────────────────────────────────────────────────────────
    ovulation_pain: /\b(ovulation pain|mittelschmerz|pain.*ovulat|ovulat.*pain|one.?sided.*pain.*mid|mid.*cycle.*pain)\b/.test(t),
    headache:       /\b(headache|head.*ache|migraine|head.*pounding|head.*throbbing|head.*hurting)\b/.test(t),
    joint_pain:     /\b(joint.*pain|muscle.*pain|body.*ache|body.*pain|achy|aches|joints.*hurt|muscles.*sore|muscle.*sore)\b/.test(t),
    breast_tender:  /\b(breast.*tender|breast.*sore|breast.*hurt|boob.*sore|boob.*tender|nipple.*sore|chest.*tender)/.test(t),

    // ── DIGESTIVE ────────────────────────────────────────────────────────────
    bloating:       /\b(bloat|bloated|bloating|puffy.*belly|belly.*big|stomach.*big|distend|feel.*full|gassy.*bloat)\b/.test(t),
    gassy:          /\b(gas|gassy|farting|fart|wind|flatulence|pass gas|pass wind|burp|burping)\b/.test(t),
    heartburn:      /\b(heartburn|acid.*reflux|reflux|burning.*chest|burning.*throat|acid.*stomach|indigestion)\b/.test(t),
    constipation:   /\b(constipat|can't.*poop|can't.*go|hard.*stool|no.*bowel|blocked up|backed up|not pooping)\b/.test(t),
    diarrhea:       /\b(diarrhea|loose.*stool|watery.*stool|running.*belly|belly.*running|running stomach|running to bathroom)\b/.test(t),

    // ── DISCHARGE (typed) ────────────────────────────────────────────────────
    discharge_eggwhite: /\b(egg.?white|clear.*stretchy|stretchy.*clear|slippery.*discharge|watery.*discharge)\b/.test(t),
    discharge_creamy:   /\b(creamy.*discharge|white.*discharge|milky.*discharge|lotion.*discharge)\b/.test(t),
    discharge_sticky:   /\b(sticky.*discharge|thick.*discharge|clumpy.*discharge|cottage.*cheese|chunky.*discharge)\b/.test(t),
    unusual_discharge:  /\b(unusual.*discharge|strange.*discharge|funny.*smell|fishy.*smell|yellow.*discharge|green.*discharge|grey.*discharge)\b/.test(t),

    // ── SKIN / HAIR ──────────────────────────────────────────────────────────
    acne:           /\b(acne|pimple|pimples|breakout|breaking out|spots.*face|face.*spots|blemish|blemishes|zit|zits)\b/.test(t),
    dry_skin:       /\b(dry.*skin|skin.*dry|flaky.*skin|skin.*flaky|skin.*peel|peeling.*skin)\b/.test(t),
    hair_thinning:  /\b(hair.*thinn|thin.*hair|hair.*fall|hair.*loss|losing.*hair|hair.*shed|shedding.*hair|bald|thinning hair|hair.*break)/.test(t),

    // ── TEMPERATURE / VASOMOTOR ──────────────────────────────────────────────
    hot_flashes:    /\b(hot flash|hot flush|suddenly.*hot|feeling.*hot.*all over|heat.*wave|heat.*rush|burning up)/.test(t),
    night_sweats:   /\b(night sweat|sweating.*night|wake.*drenched|soaked.*sleep|sweat.*sleep|wake up.*sweat)/.test(t),
    cold_flashes:   /\b(cold flash|suddenly.*cold|cold.*chills|shiver.*random|chills.*random)\b/.test(t),
    bbt_shift:      /\b(basal.*temp|bbt|body.*temperature.*shift|temp.*rise|temperature.*drop.*cycle)\b/.test(t),

    // ── COGNITIVE / MENTAL ───────────────────────────────────────────────────
    brain_fog:      /\b(brain fog|foggy|can't think|cant think|think.*slow|head.*cloudy|cloudy.*head|not thinking.*clear|mental.*fog)\b/.test(t),
    forgetful:      /\b(forgetful|forgetting|forget.*everything|can't remember|cant remember|memory.*bad|bad memory)\b/.test(t),
    poor_concentration: /\b(can't concentrate|cant concentrate|can't focus|cant focus|losing.*focus|trouble.*focusing|hard.*concentrate|distracted)\b/.test(t),
    anxiety:        /\b(anxiety|anxious|panic|panic attack|overthink|racing.*thought|heart.*racing|worry.*lot)\b/.test(t),
    depression:     /\b(depression|depressed|low mood|feel.*nothing|numb|hopeless|sad.*lot|nothing.*matters)\b/.test(t),
    crying_spells:  /\b(crying|cry.*lot|cry.*nothing|random.*cry|can't stop.*cry|teary|burst.*tears)\b/.test(t),
    irritability:   /\b(irritable|irritability|snappy|short.*temper|easily.*annoyed|annoyed.*easy|angry.*lot|fly.*off.*handle)\b/.test(t),

    // ── SLEEP ────────────────────────────────────────────────────────────────
    insomnia:       /\b(insomnia|can't sleep|cant sleep|cyan sleep|trouble.*sleep|waking up.*night|wake.*middle.*night|sleep.*bad|poor.*sleep|restless.*sleep|tossing.*turning)\b/.test(t),

    // ── APPETITE / CRAVINGS ──────────────────────────────────────────────────
    craving_sweet:  /\b(sweet.*crav|crav.*sweet|want.*sugar|sugar.*crav|chocolate.*crav|ice cream.*crav)\b/.test(t),
    craving_salty:  /\b(salty.*crav|crav.*salty|want.*salt|salt.*crav|chips.*crav)\b/.test(t),
    craving_greasy: /\b(greasy.*crav|crav.*greasy|crav.*fried|fried.*food.*crav|junk.*food.*crav)\b/.test(t),
    craving_spicy:  /\b(spicy.*crav|crav.*spicy|want.*pepper|pepper.*crav)\b/.test(t),
    appetite_increase: /\b(eating.*more|more.*hungry|always.*hungry|hungry.*all.*time|appetite.*up|increased.*appetite)\b/.test(t),
    appetite_decrease: /\b(eating.*less|not.*hungry|lost.*appetite|no.*appetite|don't.*want.*eat|food.*unappealing)\b/.test(t),

    // ── LIBIDO ───────────────────────────────────────────────────────────────
    libido_high:    /\b(increased.*libido|high.*sex.*drive|sex.*drive.*up|horny.*lot|wanting.*sex.*more)\b/.test(t),
    libido_low:     /\b(low.*libido|no.*sex.*drive|sex.*drive.*low|not.*interested.*sex|don't.*want.*sex)\b/.test(t),

    // ── REPRODUCTIVE / CERVICAL ──────────────────────────────────────────────
    cervical_mucus: /\b(cervical.*mucus|mucus.*change|cervical.*fluid|cm.*change)\b/.test(t),
    vaginal_dryness:/\b(vaginal.*dry|dry.*vagina|dry.*down there|dryness.*down there|dry.*inside)\b/.test(t),
    pain_during_sex:/\b(pain.*sex|sex.*hurt|sex.*painful|painful.*sex|hurt.*during.*sex|intercourse.*hurt)\b/.test(t),

    // ── CYCLE IRREGULARITY ───────────────────────────────────────────────────
    irregular:      /\b(irregular|unpredictable.*period|period.*unpredictable|never.*same|different.*every.*month|skip.*month)\b/.test(t),
    fluid_retention:/\b(water.*retention|retain.*water|swollen|swelling|puffy.*feet|puffy.*hands|fluid.*retention|bloat.*water)\b/.test(t),

    // ── URINARY / OTHER ──────────────────────────────────────────────────────
    frequent_urination: /\b(pee.*lot|peeing.*lot|frequent.*urinat|urinat.*frequent|bathroom.*lot|running.*bathroom|going.*bathroom.*lot)\b/.test(t),
    weight_change:  /\b(weight.*change|gained.*weight|gaining.*weight|losing.*weight|weight.*gain|weight.*loss|scale.*up|scale.*down)\b/.test(t),
    smell_sensitivity: /\b(smell.*sensitive|sensitive.*smell|everything.*smell|smell.*strong|can smell.*everything|smell.*bother)\b/.test(t),
    nasal_congestion:  /\b(stuffy.*nose|congested|nasal.*congestion|blocked.*nose|nose.*block)\b/.test(t),
  };
}

// ── Catalog key mapping ───────────────────────────────────────────────────────
// Maps each entities.symptoms boolean key → one or more symptomCatalog codes.
// Used by buildSymptomContext() in assistant.js to cross-reference logged history.
export const SYMPTOM_TO_CATALOG_KEYS = {
  late:               ["MISSED_PERIOD"],
  heavy:              ["HEAVY_FLOW", "VAGINAL_BLEEDING"],
  spotting:           ["SPOTTING"],
  pelvic:             ["CRAMPS", "PELVIC_PAIN"],
  mood:               ["MOOD_SWINGS", "FATIGUE"],
  discharge:          ["UNUSUAL_DISCHARGE"],
  nausea:             ["NAUSEA"],
  dizziness:          ["FATIGUE"],
  large_clots:        ["LARGE_CLOTS"],
  ovulation_pain:     ["OVULATION_PAIN"],
  headache:           ["HEADACHE"],
  joint_pain:         ["JOINT_PAIN"],
  breast_tender:      ["BREAST_TENDERNESS"],
  bloating:           ["BLOATING"],
  gassy:              ["GASSY"],
  heartburn:          ["HEARTBURN"],
  constipation:       ["CONSTIPATION"],
  diarrhea:           ["DIARRHEA"],
  discharge_eggwhite: ["DISCHARGE_EGGWHITE"],
  discharge_creamy:   ["DISCHARGE_CREAMY"],
  discharge_sticky:   ["DISCHARGE_STICKY"],
  unusual_discharge:  ["UNUSUAL_DISCHARGE"],
  acne:               ["ACNE"],
  dry_skin:           ["DRY_SKIN"],
  hair_thinning:      ["HAIR_THINNING"],
  hot_flashes:        ["HOT_FLASHES"],
  night_sweats:       ["NIGHT_SWEATS"],
  cold_flashes:       ["COLD_FLASHES"],
  bbt_shift:          ["BBT_SHIFT"],
  brain_fog:          ["BRAIN_FOG"],
  forgetful:          ["FORGETFUL"],
  poor_concentration: ["POOR_CONCENTRATION"],
  anxiety:            ["ANXIETY"],
  depression:         ["DEPRESSION"],
  crying_spells:      ["CRYING_SPELLS"],
  irritability:       ["IRRITABILITY"],
  insomnia:           ["INSOMNIA"],
  craving_sweet:      ["CRAVING_SWEET"],
  craving_salty:      ["CRAVING_SALTY"],
  craving_greasy:     ["CRAVING_GREASY"],
  craving_spicy:      ["CRAVING_SPICY"],
  appetite_increase:  ["APPETITE_INCREASE"],
  appetite_decrease:  ["APPETITE_DECREASE"],
  libido_high:        ["INCREASED_LIBIDO"],
  libido_low:         ["DECREASED_LIBIDO"],
  cervical_mucus:     ["CERVICAL_MUCUS_CHANGE"],
  vaginal_dryness:    ["VAGINAL_DRYNESS"],
  pain_during_sex:    ["PAIN_DURING_SEX"],
  irregular:          ["IRREGULAR_PERIOD"],
  fluid_retention:    ["FLUID_RETENTION"],
  frequent_urination: ["FREQUENT_URINATION"],
  weight_change:      ["WEIGHT_CHANGE"],
  smell_sensitivity:  ["SMELL_SENSITIVITY"],
  nasal_congestion:   ["NASAL_CONGESTION"],
};

// Friendly display labels for symptom catalog codes (used in Bloomie responses)
export const CATALOG_LABELS = {
  CRAMPS:             "cramps",
  PELVIC_PAIN:        "pelvic pain",
  MISSED_PERIOD:      "missed period",
  HEAVY_FLOW:         "heavy flow",
  VAGINAL_BLEEDING:   "bleeding",
  SPOTTING:           "spotting",
  MOOD_SWINGS:        "mood swings",
  FATIGUE:            "fatigue",
  UNUSUAL_DISCHARGE:  "unusual discharge",
  NAUSEA:             "nausea",
  LARGE_CLOTS:        "large clots",
  OVULATION_PAIN:     "ovulation pain",
  HEADACHE:           "headaches",
  JOINT_PAIN:         "joint or muscle pain",
  BREAST_TENDERNESS:  "breast tenderness",
  BLOATING:           "bloating",
  GASSY:              "gas",
  HEARTBURN:          "heartburn",
  CONSTIPATION:       "constipation",
  DIARRHEA:           "diarrhea",
  DISCHARGE_EGGWHITE: "egg-white discharge",
  DISCHARGE_CREAMY:   "creamy discharge",
  DISCHARGE_STICKY:   "sticky discharge",
  ACNE:               "acne / breakouts",
  DRY_SKIN:           "dry skin",
  HAIR_THINNING:      "hair thinning",
  HOT_FLASHES:        "hot flashes",
  NIGHT_SWEATS:       "night sweats",
  COLD_FLASHES:       "cold chills",
  BBT_SHIFT:          "temperature shifts",
  BRAIN_FOG:          "brain fog",
  FORGETFUL:          "forgetfulness",
  POOR_CONCENTRATION: "trouble concentrating",
  ANXIETY:            "anxiety",
  DEPRESSION:         "low mood",
  CRYING_SPELLS:      "crying spells",
  IRRITABILITY:       "irritability",
  INSOMNIA:           "sleep trouble",
  CRAVING_SWEET:      "sweet cravings",
  CRAVING_SALTY:      "salty cravings",
  CRAVING_GREASY:     "greasy food cravings",
  CRAVING_SPICY:      "spicy food cravings",
  APPETITE_INCREASE:  "increased appetite",
  APPETITE_DECREASE:  "decreased appetite",
  INCREASED_LIBIDO:   "higher sex drive",
  DECREASED_LIBIDO:   "lower sex drive",
  CERVICAL_MUCUS_CHANGE: "cervical mucus changes",
  VAGINAL_DRYNESS:    "vaginal dryness",
  PAIN_DURING_SEX:    "pain during sex",
  IRREGULAR_PERIOD:   "irregular periods",
  FLUID_RETENTION:    "fluid retention",
  FREQUENT_URINATION: "frequent urination",
  WEIGHT_CHANGE:      "weight changes",
  SMELL_SENSITIVITY:  "smell sensitivity",
  NASAL_CONGESTION:   "nasal congestion",
};

// ── 1b. Duration ──────────────────────────────────────────────────────────────
function extractDuration(t) {
  // Matches: "two week", "2 weeks", "a few days", "3 days", "one month" etc.
  const patterns = [
    { rx: /\b(a few|couple|2|two)\s*(days?)\b/,              days: 2,  weeks: null, unit: "days",  value: 2 },
    { rx: /\b(3|three)\s*(days?)\b/,                          days: 3,  weeks: null, unit: "days",  value: 3 },
    { rx: /\b(4|5|four|five|6|six)\s*(days?)\b/,              days: 5,  weeks: null, unit: "days",  value: 5 },
    { rx: /\b(7|seven|a\s+week|one\s+week)\s*(days?)?\b/,     days: 7,  weeks: 1,   unit: "week",  value: 1 },
    { rx: /\b(1|one)\s*(week)\b/,                             days: 7,  weeks: 1,   unit: "week",  value: 1 },
    { rx: /\b(2|two)\s*(weeks?)\b/,                           days: 14, weeks: 2,   unit: "weeks", value: 2 },
    { rx: /\b(3|three)\s*(weeks?)\b/,                         days: 21, weeks: 3,   unit: "weeks", value: 3 },
    { rx: /\b(a\s+month|one\s+month|1\s+month)\b/,            days: 30, weeks: 4,   unit: "month", value: 1 },
    { rx: /\b(2|two)\s*(months?)\b/,                          days: 60, weeks: 8,   unit: "months",value: 2 },
    { rx: /\b(long\s+time|long\s+while|forever|months)\b/,    days: 60, weeks: 8,   unit: "long",  value: null },
  ];

  for (const p of patterns) {
    const match = t.match(p.rx);
    if (match) {
      return { days: p.days, weeks: p.weeks, unit: p.unit, value: p.value, raw: match[0] };
    }
  }
  return null;
}

// ── 1c. Severity ──────────────────────────────────────────────────────────────
function extractSeverity(t) {
  if (/\b(severe|very bad|really bad|unbearable|kill.*me|kill.*mi|murder.*mi|cannot.*function|can't.*function|10\/10|worst)\b/.test(t)) {
    return "severe";
  }
  if (/\b(bad|moderate|pretty bad|affecting|interfering|hard to|difficult|bad bad)\b/.test(t)) {
    return "moderate";
  }
  if (/\b(mild|little|likkle|not bad|manageable|okay|bearable|slight|a bit|a likkle)\b/.test(t)) {
    return "mild";
  }
  if (/\b(hurt bad|pain bad|bleed bad|bleed nuff|hurt nuff|cramp bad|cramp nuff)\b/.test(t)) {
    return "severe";
  }
  return null;
}

// ── 1d. Timing ────────────────────────────────────────────────────────────────
function extractTiming(t) {
  if (/\b(before.*period|days before|week before|pms|premenstrual|leading up)\b/.test(t)) return "before_period";
  if (/\b(during.*period|on my period|while.*bleeding|when.*period|on period)\b/.test(t)) return "during_period";
  if (/\b(mid.*cycle|middle.*cycle|ovulation|between periods|halfway)\b/.test(t)) return "mid_cycle";
  if (/\b(after sex|during sex|pain.*sex|sex.*pain)\b/.test(t)) return "after_sex";
  if (/\b(random|anytime|all the time|always|whenever|no pattern)\b/.test(t)) return "random";
  return null;
}

// ── 1e. Pregnancy signals ─────────────────────────────────────────────────────
function extractPregnancy(t) {
  const chance = /\b(sex|slept with|unprotected|might be pregnant|could be pregnant|think.*pregnant|pregnant|breed)\b/.test(t);
  const testedYet = /\b(took.*test|took a test|tested|pregnancy test|test.*positive|test.*negative)\b/.test(t);
  let result = null;
  if (/\b(positive|two lines|two line|it positive)\b/.test(t)) result = "positive";
  if (/\b(negative|one line|it negative)\b/.test(t)) result = "negative";

  return { chance, testedYet, result };
}

// ── 1f. Urgency flags ─────────────────────────────────────────────────────────
function extractUrgency(t) {
  return /\b(faint|fainting|passed out|pass out|passing out|can't breathe|cant breathe|shortness of breath|soaking through|bleeding through|bleed through|bleed.*pants|soaked.*pants|blood.*pants|severe.*pain|one.sided.*pain|pain.*one.sided|sharp.*pain.*one side|bleed.*so bad|blood.*so bad|emergency|hospital|urgent|collaps\w*|can't stand|cant stand|too weak)\b/.test(t);
}


// ─── 2. INFERENCE ENGINE ─────────────────────────────────────────────────────

export function inferRoute(entities) {
  const { symptoms, duration, severity, timing, pregnancy, urgent } = entities;
  const sym = symptoms;

  // ── URGENT: always highest priority ───────────────────────────────────────
  if (urgent) {
    return { next: "HEAVY_URGENT", payload: { inferred: true, reason: "urgency_flag" } };
  }

  if (sym.heavy && sym.dizziness) {
    return { next: "HEAVY_URGENT", payload: { inferred: true, reason: "heavy+dizzy" } };
  }

  // ── MULTI-SYMPTOM COMBOS ───────────────────────────────────────────────────

  // Late + pregnancy chance + no test yet → skip straight to test suggestion
  if (sym.late && pregnancy.chance && !pregnancy.testedYet) {
    return { next: "LATE_TEST_SUGGEST", payload: { inferred: true, reason: "late+pregnancy_chance+no_test" } };
  }

  // Late + positive test → skip to positive result node
  if (sym.late && pregnancy.result === "positive") {
    return { next: "LATE_POSITIVE", payload: { inferred: true, reason: "late+positive_test" } };
  }

  // Late + negative/unclear test → skip to that node
  if (sym.late && (pregnancy.result === "negative" || pregnancy.result === "unclear")) {
    return { next: "LATE_NEG_UNCLEAR", payload: { inferred: true, reason: "late+negative_test" } };
  }

  // Late + long duration (2+ weeks) → go straight to yes-preg branch
  if (sym.late && duration?.weeks >= 2) {
    return { next: "LATE_YES_PREG", payload: { inferred: true, reason: "late+2weeks" } };
  }

  // Heavy + long duration (7+ days)
  if (sym.heavy && duration?.days >= 7) {
    return { next: "HEAVY_LONGER_THAN_WEEK", payload: { inferred: true, reason: "heavy+7days" } };
  }

  // Heavy + severe → skip to risk symptoms check
  if (sym.heavy && severity === "severe") {
    return { next: "HEAVY_RISK_SYMPTOMS", payload: { inferred: true, reason: "heavy+severe" } };
  }

  // Spotting + mid-cycle + mild → likely ovulation spotting
  if (sym.spotting && timing === "mid_cycle" && (severity === "mild" || !severity)) {
    return { next: "SPOT_MIDCYCLE_NOTE", payload: { inferred: true, reason: "spotting+mid_cycle" } };
  }

  // Spotting + pregnancy chance → skip to preg info
  if (sym.spotting && pregnancy.chance) {
    return { next: "SPOT_PREG_INFO", payload: { inferred: true, reason: "spotting+pregnancy_chance" } };
  }

  // Spotting + unusual discharge/odor → provider soon
  if (sym.spotting && sym.discharge) {
    return { next: "SPOT_PROVIDER_SOON", payload: { inferred: true, reason: "spotting+discharge" } };
  }

  // Pelvic pain + after sex
  if (sym.pelvic && timing === "after_sex") {
    return { next: "PELVIC_SEX_INTRO", payload: { inferred: true, reason: "pelvic+after_sex" } };
  }

  // Pelvic pain + severe + not improving
  if (sym.pelvic && severity === "severe") {
    return { next: "PELVIC_PERSISTENT", payload: { inferred: true, reason: "pelvic+severe" } };
  }

  // Mood + tired/fatigue + before period → PMS pathway
  if (sym.mood && timing === "before_period") {
    return { next: "MOOD_SEVERITY", payload: { inferred: true, reason: "mood+before_period" } };
  }

  // Late + pelvic pain combo (could be ectopic risk — go to late intro with urgency note)
  if (sym.late && sym.pelvic && severity === "severe") {
    return { next: "HEAVY_URGENT", payload: { inferred: true, reason: "late+severe_pelvic (ectopic risk)" } };
  }

  // ── SINGLE SYMPTOM with enriched context ───────────────────────────────────

  // Late period with duration info → skip the "is it 7 days late?" question
  if (sym.late && duration?.days >= 7) {
    return { next: "LATE_YES_PREG", payload: { inferred: true, reason: "late+duration_known" } };
  }

  if (sym.late && duration?.days > 0 && duration.days < 7) {
    return { next: "LATE_NO_GUIDANCE", payload: { inferred: true, reason: "late+short_duration" } };
  }

  // Heavy with severity info → skip the soak question if severe
  if (sym.heavy && severity === "moderate") {
    return { next: "HEAVY_DURATION_CHECK", payload: { inferred: true, reason: "heavy+moderate" } };
  }

  // Discharge without spotting → else intro discharge
  if (sym.discharge && !sym.spotting && !sym.pelvic) {
    return { next: "ELSE_DISCHARGE", payload: { inferred: true, reason: "discharge_only" } };
  }

  // Nausea + late → pregnancy concern
  if (sym.nausea && sym.late) {
    return { next: "LATE_TEST_Q", payload: { inferred: true, reason: "nausea+late" } };
  }

  // ── No strong inference → return null, fall through to keyword router ──────
  return null;
}

export function summarizeEntities(entities) {
  const { symptoms, duration, severity, timing, pregnancy, urgent } = entities;
  const lines = [];

  // Map detected boolean keys to catalog codes for richer logging
  const activeSymptoms = Object.entries(symptoms)
    .filter(([, v]) => v)
    .flatMap(([k]) => SYMPTOM_TO_CATALOG_KEYS[k] || [k]);
  const uniqueActive = [...new Set(activeSymptoms)];

  if (uniqueActive.length) lines.push(`Symptoms detected: ${uniqueActive.map(k => CATALOG_LABELS[k] || k).join(", ")}`);
  if (duration)   lines.push(`Duration: ${duration.value ? `${duration.value} ${duration.unit}` : duration.unit}`);
  if (severity)   lines.push(`Severity: ${severity}`);
  if (timing)     lines.push(`Timing: ${timing.replace(/_/g, " ")}`);
  if (pregnancy.chance)    lines.push("Pregnancy chance: yes");
  if (pregnancy.testedYet) lines.push(`Pregnancy test taken: yes${pregnancy.result ? ` (${pregnancy.result})` : ""}`);
  if (urgent)     lines.push("⚠️ Urgency flags detected");

  return lines.length ? lines.join(" | ") : "No structured entities extracted";
}