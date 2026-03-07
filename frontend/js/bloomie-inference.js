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
function extractSymptoms(t) {
  return {
    late:       /\b(late|missed|no period|period.*not come|period.*nuh come|period.*hasn't|period.*didn't)\b/.test(t),
    heavy:      /\b(heavy|soaking|soaked|bleed.*bad|bleed.*nuff|flooding|clot|clots|bleed through)\b/.test(t),
    spotting:   /\b(spot|spotting|pink|brown.*discharge|blood.*between|between.*period)\b/.test(t),
    pelvic:     /\b(cramp|cramps|pelvic|lower.*abdomen|stomach.*pain|stomach.*hurt|belly.*hurt|belly.*pain|waist.*hurt|bottom.*belly)\b/.test(t),
    mood:       /\b(mood|sad|anxious|irritable|tired|fatigue|drained|weak|overwhelm|exhaust|low energy|emotional|cry|tearful)\b/.test(t),
    discharge:  /\b(discharge|smell|odor|white.*coming|something.*coming)\b/.test(t),
    nausea:     /\b(nausea|nauseous|vomit|sick to.*stomach|throw up|queasy)\b/.test(t),
    dizziness:  /\b(dizzy|dizziness|lightheaded|faint|head.*spin|head.*swim|feel.*weak)\b/.test(t),
  };
}

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
  return /\b(faint|fainting|passed out|can't breathe|cant breathe|shortness of breath|soaking through|bleeding through|bleed through|bleed.*pants|soaked.*pants|blood.*pants|severe.*pain|one.sided.*pain|sharp.*pain.*one side|emergency|hospital|urgent|collaps|can't stand|cant stand|too weak)\b/.test(t);
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

  const activeSymptoms = Object.entries(symptoms)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (activeSymptoms.length) lines.push(`Symptoms detected: ${activeSymptoms.join(", ")}`);
  if (duration)   lines.push(`Duration: ${duration.value ? `${duration.value} ${duration.unit}` : duration.unit}`);
  if (severity)   lines.push(`Severity: ${severity}`);
  if (timing)     lines.push(`Timing: ${timing.replace(/_/g, " ")}`);
  if (pregnancy.chance)    lines.push("Pregnancy chance: yes");
  if (pregnancy.testedYet) lines.push(`Pregnancy test taken: yes${pregnancy.result ? ` (${pregnancy.result})` : ""}`);
  if (urgent)     lines.push("⚠️ Urgency flags detected");

  return lines.length ? lines.join(" | ") : "No structured entities extracted";
}