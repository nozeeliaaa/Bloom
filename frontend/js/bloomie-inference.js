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
// New keys added below - all map to at least one symptomCatalog code via
// SYMPTOM_TO_CATALOG_KEYS (exported at bottom of file).
function extractSymptoms(t) {
  return {
    // ── ORIGINAL 8 (kept exactly - inferRoute depends on these names) ────────
    late:           /\b(late|missed|no period|period.*not come|period.*nuh come|period.*hasn't|period.*didn't|period skipped|period skip|period is missing|haven't seen.*my period|haven't had.*period|period hasn't arrived|period hasn't come)\b/.test(t),
    heavy:          /\b(heavy|heavily|soaking|soaked|bleed.*bad|bleed.*nuff|bleeding.*lot|bleed.*lot|flooding|clot|clots|bleed through)\b/.test(t),
    spotting:       /\b(spot|spotting|pink|brown.*discharge|blood.*between|between.*period)\b/.test(t),
    pelvic:         /\b(cramp|cramps|pelvic|lower.*abdomen|stomach.*pain|stomach.*hurt|belly.*hurt|belly.*pain|waist.*hurt|bottom.*belly|one.sided.*pain|one.side.*hurt|one side.*hurt|lower.*abdominal.*pain|side.*hurts)\b/.test(t),
    mood:           /\b(mood|sad|anxious|irritable|tired|fatigue|drained|weak|overwhelm|exhaust|low energy|emotional|cry|tearful|can't cope|cant cope|cannot cope|breaking down|i'm losing it|losing it|feel empty|feeling empty|feel nothing|feeling nothing|i'm breaking down|i'm losing it)\b/.test(t),
    discharge:      /\b(discharge|smell|odor|white.*coming|something.*coming|unusual odour|vaginal.*discharge|down.*there.*wet|wet.*down.*there|vaginal.*burning|vaginal.*itching|unusual.*vaginal|vaginal.*sensation)\b/.test(t),
    nausea:         /\b(nausea|nauseous|vomit|sick to.*stomach|throw up|queasy)\b/.test(t),
    dizziness:      /\b(dizzy|dizziness|lightheaded|faint|head.*spin|head.*swim)\b/.test(t),

    // ── BLEEDING ─────────────────────────────────────────────────────────────
    large_clots:    /\b(large clot|big clot|clot.*size|liver.*clot|quarter.*size|golf.*clot|passing clots|pass clots)\b/.test(t),

    // ── PAIN ─────────────────────────────────────────────────────────────────
    ovulation_pain: /\b(ovulation pain|mittelschmerz|pain.*ovulat|ovulat.*pain|one.?sided.*pain.*mid|mid.*cycle.*pain)\b/.test(t),
    headache:       /\b(headache|head.*ache|migraine|head.*pounding|head.*throbbing|head.*hurting)\b/.test(t),
    joint_pain:     /\b(joint.*pain|muscle.*pain|body.*ache|body.*pain|achy|aches|joints.*hurt|muscles.*sore|muscle.*sore|lower.*back.*pain|back.*pain.*lower)\b/.test(t),
    breast_tender:  /\b(breast.*tender|breast.*sore|breast.*hurt|boob.*sore|boob.*tender|nipple.*sore|chest.*tender)/.test(t),

    // ── DIGESTIVE ────────────────────────────────────────────────────────────
    bloating:       /\b(bloat|bloated|bloating|puffy.*belly|belly.*big|stomach.*big|distend|feel.*full|gassy.*bloat)\b/.test(t),
    gassy:          /\b(gas|gassy|farting|fart|wind|flatulence|pass gas|pass wind|burp|burping)\b/.test(t),
    heartburn:      /\b(heartburn|acid.*reflux|reflux|burning.*chest|burning.*throat|acid.*stomach|indigestion)\b/.test(t),
    constipation:   /\b(constipat|can't.*poop|can't.*go|hard.*stool|no.*bowel|blocked up|backed up|not pooping)\b/.test(t),
    diarrhea:       /\b(diarrhea|loose.*stool|watery.*stool|running.*belly|belly.*running|running stomach|running to bathroom)\b/.test(t),

    // ── DISCHARGE (typed) ────────────────────────────────────────────────────
    discharge_eggwhite: /\b(ewcm|egg.?white|egg white discharge|clear.*stretchy|stretchy.*clear|slippery.*discharge|watery.*discharge)\b/.test(t),
    discharge_creamy:   /\b(creamy.*discharge|white.*discharge|milky.*discharge|lotion.*discharge)\b/.test(t),
    discharge_sticky:   /\b(sticky.*discharge|thick.*discharge|clumpy.*discharge|cottage.*cheese|chunky.*discharge)\b/.test(t),
    unusual_discharge:  /\b(unusual.*discharge|strange.*discharge|funny.*smell|fishy.*smell|yellow.*discharge|green.*discharge|grey.*discharge|vaginal.*burning|burning.*down.*there|vaginal.*itching|itching.*down.*there|unusual.*odour|unusual.*odor)\b/.test(t),

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
    brain_fog:      /\b(brain fog|foggy|can't think|cant think|think.*slow|head.*cloudy|cloudy.*head|not thinking.*clear|mental.*fog|not.*thinking.*clearly|i'm not thinking|can't concentrate clearly)\b/.test(t),
    forgetful:      /\b(forgetful|forgetting|forget.*everything|can't remember|cant remember|memory.*bad|bad memory)\b/.test(t),
    poor_concentration: /\b(can't concentrate|cant concentrate|can't focus|cant focus|losing.*focus|trouble.*focusing|hard.*concentrate|distracted)\b/.test(t),
    anxiety:        /\b(anxiety|anxious|panic|panic attack|overthink|racing.*thought|heart.*racing|worry.*lot)\b/.test(t),
    depression:     /\b(depression|depressed|low mood|feel.*nothing|numb|hopeless|sad.*lot|nothing.*matters)\b/.test(t),
    crying_spells:  /\b(crying|cry.*lot|cry.*nothing|random.*cry|can't stop.*cry|teary|burst.*tears)\b/.test(t),
    irritability:   /\b(irritable|irritability|snappy|short.*temper|easily.*annoyed|annoyed.*easy|angry.*lot|fly.*off.*handle)\b/.test(t),

    // ── SLEEP ────────────────────────────────────────────────────────────────
    insomnia:       /\b(insomnia|can't sleep|cant sleep|cyan sleep|trouble sleeping|trouble.*sleep\b|waking up.*night|wake.*middle.*night|sleep.*bad|poor.*sleep|restless.*sleep|tossing.*turning)\b/.test(t),

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

    // ── PERIMENOPAUSE / MENOPAUSE ─────────────────────────────────────────
    peri_mention:       /\b(perimenopause|peri menopause|peri-menopause|going through the change|the change|change of life|premenopause)\b/.test(t),
    menopause_mention:  /\b(menopause|menopausal|post.?menopause|no period for months|period stopped|period done|period finish)\b/.test(t),
    mood_rage:          /\b(rage|raging|uncontrollable anger|mood all over|emotions all over|feel crazy|feel mad|feel like mi going mad|mi feel like mi losing it)\b/.test(t),
    memory_issues:      /\b(memory|forget everything|can't remember anything|mind blank|memory gone|mi forget everything|losing my mind)\b/.test(t),
    body_temp:          /\b(temperature|body heat|burning up|feel like fire|overheating|always hot|always cold|temperature all over)\b/.test(t),
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
  peri_mention:       ["IRREGULAR_PERIOD", "HOT_FLASHES"],
  menopause_mention:  ["MISSED_PERIOD", "HOT_FLASHES"],
  mood_rage:          ["MOOD_SWINGS", "IRRITABILITY"],
  memory_issues:      ["FORGETFUL", "BRAIN_FOG", "POOR_CONCENTRATION"],
  body_temp:          ["HOT_FLASHES", "COLD_FLASHES"],
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
    // ── Shorthand time formats (e.g. "2wks", "3dys") ──────────────────────────
    { rx: /\b2wks?\b/,                                        days: 14, weeks: 2,   unit: "weeks", value: 2 },
    { rx: /\b1wks?\b/,                                        days: 7,  weeks: 1,   unit: "week",  value: 1 },
    { rx: /\b3wks?\b/,                                        days: 21, weeks: 3,   unit: "weeks", value: 3 },
    { rx: /\b4wks?\b/,                                        days: 28, weeks: 4,   unit: "weeks", value: 4 },
    { rx: /\b2dys?\b/,                                        days: 2,  weeks: null, unit: "days", value: 2 },
    { rx: /\b3dys?\b/,                                        days: 3,  weeks: null, unit: "days", value: 3 },
    { rx: /\b1dy\b/,                                          days: 1,  weeks: null, unit: "days", value: 1 },
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
  const chance = /\b(sex|slept with|unprotected|might be pregnant|could be pregnant|think.*pregnant|pregnant|breed|catch belly|belly catch|pickney deh)\b/.test(t);
  const testedYet = /\b(took.*test|took a test|tested|pregnancy test|test.*positive|test.*negative|test result|test come back)\b/.test(t);
  let result = null;
  if (/\b(positive|two lines|two line|it positive|bfp|positive pregnancy test|positive test)\b/.test(t)) result = "positive";
  if (/\b(negative|one line|it negative|bfn|negative pregnancy test|negative test)\b/.test(t)) result = "negative";
  // TTC context flags
  const ttc = /\b(two week wait|2ww|days past ovulation|dpo|trying to conceive|ttc)\b/.test(t);

  return { chance, testedYet, result, ttc };
}

// ── 1f. Urgency flags ─────────────────────────────────────────────────────────
export function extractUrgency(t) {
  // Exclude "emergency contraception" before testing for standalone "emergency"
  const cleaned = t.replace(/\bemergency contraception\b/g, "");
  return /\b(faint|fainting|passed out|pass out|passing out|can't breathe|cant breathe|shortness of breath|soaking through|bleeding through|bleed through|bleed.*pants|soaked.*pants|blood.*pants|severe.*pain|one.sided.*pain|pain.*one.sided|sharp.*pain.*one side|bleed.*so bad|blood.*so bad|emergency|hospital|urgent|collaps\w*|can't stand|cant stand|too weak|i feel faint|about to faint|very weak|nearly fainted|i collapsed|heavy bleeding everywhere|i can't breathe|i can.t stand|ago dead|ago die|going to die)\b/.test(cleaned);
}


// ─── 2. INFERENCE ENGINE ─────────────────────────────────────────────────────

export function inferRoute(entities) {
  const { symptoms, duration, severity, timing, pregnancy, urgent } = entities;
  const sym = symptoms;
  const raw = entities.raw || "";

  // ── CRISIS / SELF-HARM: always before urgency ──────────────────────────────
  if (/\b(hurt(?:ing)? myself|harm(?:ing)? myself|end it all|end my life|want to die|dont want to be here|cant go on|unsafe|feeling unsafe|cyan cope|can'?t cope|cannot cope)\b/.test(raw)) {
    return { next: "MOOD_SAFETY_ROUTE", payload: { inferred: true, reason: "self_harm_language" } };
  }

  // ── URGENT: always highest priority ───────────────────────────────────────
  if (urgent) {
    return { next: "HEAVY_URGENT", payload: { inferred: true, reason: "urgency_flag" } };
  }

  if (sym.heavy && sym.dizziness) {
    return { next: "HEAVY_URGENT", payload: { inferred: true, reason: "heavy+dizzy" } };
  }

  // ── MULTI-SYMPTOM COMBOS ───────────────────────────────────────────────────

  // Late + positive test → skip to positive result node (checked before chance+no_test)
  if (sym.late && pregnancy.result === "positive") {
    return { next: "LATE_POSITIVE", payload: { inferred: true, reason: "late+positive_test" } };
  }

  // Late + negative/unclear test → skip to that node (checked before chance+no_test)
  if (sym.late && (pregnancy.result === "negative" || pregnancy.result === "unclear")) {
    return { next: "LATE_NEG_UNCLEAR", payload: { inferred: true, reason: "late+negative_test" } };
  }

  // Late + pregnancy chance + no test yet → intent-first entry
  if (sym.late && pregnancy.chance && !pregnancy.testedYet) {
    return { next: "PREGNANCY_ENTRY", payload: { inferred: true, reason: "late+pregnancy_chance+no_test" } };
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

  // Spotting + pregnancy chance → skip to preg info (checked before mid_cycle so pregnancy wins)
  if (sym.spotting && pregnancy.chance) {
    return { next: "SPOT_PREG_INFO", payload: { inferred: true, reason: "spotting+pregnancy_chance" } };
  }

  // Spotting + unusual discharge/odor → provider soon (checked before mid_cycle so discharge wins)
  if (sym.spotting && sym.discharge) {
    return { next: "SPOT_PROVIDER_SOON", payload: { inferred: true, reason: "spotting+discharge" } };
  }

  // Spotting + mid-cycle + mild → likely ovulation spotting
  if (sym.spotting && timing === "mid_cycle" && (severity === "mild" || !severity)) {
    return { next: "SPOT_MIDCYCLE_NOTE", payload: { inferred: true, reason: "spotting+mid_cycle" } };
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

  // Late + pelvic pain combo (could be ectopic risk - go to late intro with urgency note)
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

  // Spotting + mild (not before-period timing) → mid-cycle/ovulation spotting default
  if (sym.spotting && severity === "mild" && timing !== "before_period" && !pregnancy.chance && !sym.discharge) {
    return { next: "SPOT_MIDCYCLE_NOTE", payload: { inferred: true, reason: "spotting+mild" } };
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


// ─── 3. SAFETY SIGNAL ANALYSIS ────────────────────────────────────────────────

// ── 3a. Downplaying detector ──────────────────────────────────────────────────
// Returns true when the user uses minimising language alongside potentially
// serious symptoms. text should be already lowercased.
export function detectDownplaying(text) {
  const t = String(text || "").toLowerCase();
  const englishMin = /\b(just a little|only a bit|not that bad|kinda|sort of|i think i(?:'|')?m okay|i think im okay|probably nothing|might be nothing|don(?:'|')?t want to overreact|dont want to overreact|maybe i(?:'|')?m being dramatic|maybe im being dramatic|not sure if it(?:'|')?s serious)\b/.test(t);
  const patoisMin  = /\b(likkle bit|nuh too bad|mi aight|a nuh nutten|a no nutten|probably nutten|mi probably fine)\b/.test(t);
  return englishMin || patoisMin;
}

// ── 3b. Ambiguous input detector ─────────────────────────────────────────────
// Returns a targeted clarifying question string when the input is too vague to
// route safely, or null when input is clear enough to proceed.
export function detectAmbiguousInput(text, entities) {
  const t   = String(text || "").toLowerCase().trim();
  const sym = entities?.symptoms || {};
  const words = t.split(/\s+/).filter(Boolean);

  // "dizzy" or "dizziness" alone (short message, dizziness signal, no other anchor)
  if (
    sym.dizziness &&
    !sym.heavy && !sym.pelvic && !sym.late && !sym.spotting && !sym.nausea &&
    words.length <= 5
  ) {
    return "Is the dizziness happening alongside any bleeding, or more on its own?";
  }

  // "feeling sick" / "feel sick" alone - must match text directly (nausea regex misses this phrase)
  if (
    /\b(feeling sick|feel sick|feel unwell|feeling unwell)\b/.test(t) &&
    words.length <= 6 &&
    !sym.pelvic && !sym.late && !sym.heavy
  ) {
    return "Is it more like nausea and stomach discomfort, or do you feel generally unwell with things like chills or fever?";
  }

  // Generic "pain" or "it hurts" alone with no location or severity
  const hasBarePain = /\b(pain|hurt|hurts|hurting|it hurts|i have pain)\b/.test(t);
  if (
    hasBarePain &&
    !sym.pelvic && !sym.headache && !sym.joint_pain &&
    !entities?.severity &&
    !sym.heavy && !sym.late && !sym.dizziness &&
    words.length <= 5
  ) {
    return "Where is the pain - is it more in your lower belly, pelvic area, or somewhere else? And on a scale of 1 to 5, how intense is it?";
  }

  // "heavy bleeding" without severity context (and not already urgent)
  if (
    sym.heavy &&
    !entities?.severity &&
    !entities?.urgent &&
    words.length <= 8
  ) {
    return "When you say heavy - are you soaking through a pad or tampon in about an hour or less, or is it heavier than usual but manageable?";
  }

  // "is this normal?" - seeking reassurance without specific context
  if (
    /\b(is this normal|is that normal|dat normal|is it normal)\b/.test(t) &&
    !sym.heavy && !sym.late && !sym.pelvic && !sym.dizziness
  ) {
    return "That depends on what's going on 🩷 Tell me more about what you're experiencing and I can give you a much better answer.";
  }

  return null;
}

// ── 3c. Contradiction detector ────────────────────────────────────────────────
// Returns a clarifying prompt when the message contains logically contradictory
// signals, or null when the message is internally consistent.
export function detectContradiction(text, _entities) {
  const t = String(text || "").toLowerCase();

  // "heavy" / "soaking" + "just spotting" / minimising bleed word
  if (
    /\b(heavy|soaking)\b/.test(t) &&
    /\b(just spotting|just a spot|likkle|light spotting|only spotting)\b/.test(t)
  ) {
    return "You mentioned both heavy bleeding and spotting - could you describe what you're seeing? Are you soaking through protection, or is it more of a light stain?";
  }

  // "late" / "missed period" + "my period started"
  if (
    /\b(late|missed period|period.*late|my period is late)\b/.test(t) &&
    /\b(my period started|period started|period came|period come|period begin|period began|it started yesterday|started yesterday|started today)\b/.test(t)
  ) {
    return "It sounds like you might be saying your period started but was also late - is that right? When did bleeding begin?";
  }

  // "negative" test + "positive" test in same message
  if (/\bnegative\b/.test(t) && /\bpositive\b/.test(t) && /\btest(s|ed|ing)?\b/.test(t)) {
    return "I want to make sure I understood - did you get a negative result, a positive result, or both on different tests?";
  }

  // "no pain" / "not in pain" + pain descriptor
  if (
    /\b(no pain|not in pain|don(?:'|')?t have pain|dont have pain|pain free|no cramps)\b/.test(t) &&
    /\b(severe|really bad|unbearable|bad pain|so much pain|cramps badly)\b/.test(t)
  ) {
    return "You mentioned no pain but also described pain - could you clarify? Is it mild, or is it actually quite uncomfortable?";
  }

  // "not sexually active" / "haven't had sex" + "had sex" / "unprotected"
  if (
    /\b(not sexually active|haven(?:'|')?t had sex|havent had sex|not having sex|i don(?:'|')?t have sex|i dont have sex)\b/.test(t) &&
    /\b(had sex|we had sex|unprotected|slept with|breed)\b/.test(t)
  ) {
    return "I want to make sure I understand your situation so I can give you the right guidance - is there any chance of pregnancy this cycle?";
  }

  // "fine" / "okay" + urgency-adjacent severity signal - minimising serious symptoms
  if (
    /\b(i(?:'|')?m fine|im fine|i(?:'|')?m okay|im okay|i(?:'|')?m alright|im alright|feel fine|feel okay|i(?:'|')?m good|im good)\b/.test(t) &&
    /\b(severe|really bad|unbearable|can(?:'|')?t stand|faint|passing out|bleed.*bad|bleed.*nuff)\b/.test(t)
  ) {
    const symptomWord =
      /\bfaint|\bpass out/.test(t) ? "fainting" :
      /\bbleed/.test(t) ? "bleeding" :
      /\bpain/.test(t) ? "pain" : "the symptom you mentioned";
    return `I want to make sure - you mentioned ${symptomWord} but also said you're okay. Is the ${symptomWord} manageable or actually quite uncomfortable?`;
  }

  // Multiple conflicting timing words for the same event
  if (
    /\byesterday\b/.test(t) &&
    /\blast week\b/.test(t) &&
    /\blast month\b/.test(t)
  ) {
    return "I want to get the timing right - when did this start? Yesterday, last week, or longer ago?";
  }

  // "no cramps" / "cramp free" + severe cramping description
  if (
    /\b(no cramps|cramp free|no period pain)\b/.test(t) &&
    /\b(severe cramps|bad cramps|cramps are bad|cramps so bad|cramps killing|cramping badly)\b/.test(t)
  ) {
    return "You mentioned no cramps but also described severe cramping - could you clarify? Are the cramps manageable or actually quite bad?";
  }

  return null;
}

// ── 3d. Missing context detector ─────────────────────────────────────────────
// Returns a single targeted probe question when a health symptom is present but
// critical context is missing, or null when context is sufficient.
export function detectMissingContext(entities, text) {
  const t   = String(text || "").toLowerCase();
  const sym = entities?.symptoms || {};

  // Pain signal but no location and no pelvic/belly entity
  const hasPain = /\b(pain|hurt|hurts|hurting|ache|aches|sore)\b/.test(t);
  if (hasPain && !sym.pelvic && !sym.headache && !sym.joint_pain && !entities?.severity) {
    return "Where does the pain feel like it's coming from - more in your belly, lower pelvic area, or somewhere else?";
  }

  // Bleeding but no severity/amount (and not already urgent)
  if ((sym.heavy || sym.spotting) && !entities?.severity && !entities?.urgent) {
    return "Is it light spotting, more like a normal period, or heavier than usual?";
  }

  // Discharge with no descriptor
  if (
    sym.discharge &&
    !sym.unusual_discharge && !sym.discharge_sticky &&
    !sym.discharge_eggwhite && !sym.discharge_creamy
  ) {
    return "Has the colour, smell, or texture changed, or does it just seem like more than usual?";
  }

  return null;
}

// ── 3e. Cumulative risk checker ───────────────────────────────────────────────
// Takes an array of entity objects (from extractEntities calls) representing the
// last N messages. Returns { escalate: boolean, reason: string|null }.
// Used by the eval harness for multi-turn test cases.
export function checkCumulativeRisk(entityHistory) {
  if (!entityHistory || entityHistory.length < 2) return { escalate: false, reason: null };

  const recent = entityHistory.slice(-5);

  const hasHeavy        = recent.some(e => e.symptoms?.heavy || e.symptoms?.large_clots);
  const hasDizziness    = recent.some(e => e.symptoms?.dizziness);
  const hasLate         = recent.some(e => e.symptoms?.late);
  const hasOnesidedPain = recent.some(e => e.urgent || /one.sided|one side/.test(e.raw || ""));
  const hasPositiveTest = recent.some(e => e.pregnancy?.result === "positive");
  const hasPelvicPain   = recent.some(e => e.symptoms?.pelvic);
  const hasBleeding     = recent.some(e => e.symptoms?.heavy || e.symptoms?.spotting);
  const hasNightSweats  = recent.some(e => e.symptoms?.night_sweats);
  const hasChills       = recent.some(e => e.symptoms?.cold_flashes);

  if (hasHeavy && hasDizziness) {
    return { escalate: true, reason: "cumulative: heavy_bleeding + dizziness" };
  }
  if (hasLate && hasOnesidedPain) {
    return { escalate: true, reason: "cumulative: late_period + one_sided_pain (ectopic risk)" };
  }
  if (hasPositiveTest && (hasPelvicPain || hasBleeding)) {
    return { escalate: true, reason: "cumulative: positive_test + pain_or_bleeding" };
  }
  if (hasNightSweats && hasChills && hasPelvicPain) {
    return { escalate: true, reason: "cumulative: fever_proxy + pelvic_pain" };
  }

  return { escalate: false, reason: null };
}