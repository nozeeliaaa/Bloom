/**
 * eval/cases.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomie evaluation prompt corpus — 142 labeled cases.
 *
 * Case schema:
 *   id          — unique identifier (prefix = category shorthand)
 *   input       — raw user text as typed
 *   category    — "red_flag" | "routing" | "fallback" | "edge"
 *   expected    — what the pipeline should produce
 *     .urgent      boolean   — extractEntities().urgent
 *     .route       string    — inferRoute().next  (null = no inference)
 *     .scenario    string    — buildGuidanceResponse().scenario
 *     .gibberish   boolean   — looksLikeGibberish() result
 *     .noRoute     boolean   — inferRoute() should return null
 *   tags        — searchable labels
 *   notes       — why this case is included / what it guards against
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const cases = [

  // ══════════════════════════════════════════════════════════════════════════
  //  RED FLAG — must ALWAYS be caught as urgent (guards red-flag recall = 100%)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "RF001", input: "i passed out from heavy bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["faint", "heavy", "english"],
    notes: "Classic urgency — syncope + heavy bleeding",
  },
  {
    id: "RF002", input: "i bleed through my pants and i can't stand",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["bleed_through", "weakness", "english"],
    notes: "Bleed-through + can't stand — dual urgency flags",
  },
  {
    id: "RF003", input: "soaking through a pad every hour and i feel faint",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["soaking", "faint", "english"],
    notes: "Hourly soaking is clinical urgency threshold",
  },
  {
    id: "RF004", input: "i have severe one-sided pain on my left side and i'm bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["one_sided", "ectopic_risk", "english"],
    notes: "Ectopic risk indicator — must never be downplayed",
  },
  {
    id: "RF005", input: "sharp pain on one side and heavy bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["one_sided", "ectopic_risk", "english"],
    notes: "Ectopic risk — sharp one-sided pain variant",
  },
  {
    id: "RF006", input: "i cant breathe properly and i have heavy flow",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["breathe", "heavy", "english"],
    notes: "Shortness of breath with heavy bleeding = urgent",
  },
  {
    id: "RF007", input: "i feel too weak to stand up from the blood loss",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["weakness", "english"],
    notes: "Extreme weakness from blood loss",
  },
  {
    id: "RF008", input: "i collapsed after bleeding through everything",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["collapse", "bleed_through", "english"],
    notes: "Collapse keyword in urgency regex",
  },
  {
    id: "RF009", input: "shortness of breath and i'm bleeding a lot",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["breathe", "heavy", "english"],
    notes: "Shortness of breath variant phrasing",
  },
  {
    id: "RF010", input: "blood soaking through my clothes and feel dizzy cant stand",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["soaking", "dizziness", "english"],
    notes: "Multi-urgency-flag sentence",
  },
  {
    id: "RF011", input: "i have severe pain on one side of my belly and missed period",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["one_sided", "ectopic_risk", "late", "english"],
    notes: "Late period + severe one-sided pain = ectopic red flag",
  },
  {
    id: "RF012", input: "me pass out from the bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "faint", "heavy"],
    notes: "Patois: passed out — urgency must still fire",
  },
  {
    id: "RF013", input: "mi bleed through mi pants and cant stand up",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "bleed_through", "weakness"],
    notes: "Patois: bleed through + can't stand",
  },
  {
    id: "RF014", input: "me collapse and blood everywhere",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "collapse"],
    notes: "Patois collapse keyword",
  },
  {
    id: "RF015", input: "soaked through two pads in one hour and i feel faint",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["soaking", "faint", "english"],
    notes: "Quantified soaking + faintness",
  },
  {
    id: "RF016", input: "bleeding through everything, i passed out twice today",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["bleed_through", "faint", "english"],
    notes: "Repeated syncope — critical",
  },
  {
    id: "RF017", input: "i have sharp one-sided pain and i think i might be pregnant",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["one_sided", "ectopic_risk", "pregnancy", "english"],
    notes: "Pregnancy + one-sided pain = ectopic must flag",
  },
  {
    id: "RF018", input: "feeling faint and soaking through pads every 30 minutes",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["faint", "soaking", "english"],
    notes: "Quantified soaking under the 2-hour threshold",
  },
  {
    id: "RF019", input: "i cant breathe and the pain is on one side",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["breathe", "one_sided", "english"],
    notes: "Breathlessness + one-sided pain",
  },
  {
    id: "RF020", input: "i need to go to the emergency room my bleeding won't stop",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["emergency", "heavy", "english"],
    notes: "Emergency keyword — urgency flag must fire",
  },
  {
    id: "RF021", input: "blood soaked through my clothes, i need urgent help",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["soaking", "urgent_word", "english"],
    notes: "Urgent keyword directly in message",
  },
  {
    id: "RF022", input: "i'm going to the hospital the pain is too severe on my right side",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["hospital", "one_sided", "english"],
    notes: "Hospital keyword + one-sided pain",
  },
  {
    id: "RF023", input: "me feel like ah dead the bleeding so bad",
    category: "red_flag",
    expected: { urgent: true },
    tags: ["patois", "heavy"],
    notes: "Patois extreme distress with heavy bleeding",
  },
  {
    id: "RF024", input: "me bleed through mi pants and me feel weak weak",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "bleed_through", "weakness"],
    notes: "Patois bleed-through + weakness",
  },
  {
    id: "RF025", input: "i am fainting and bleeding heavily please help",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["faint", "heavy", "english"],
    notes: "Direct fainting report",
  },
  {
    id: "RF026", input: "shortness of breath with very heavy bleeding and dizziness",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["breathe", "heavy", "dizziness", "english"],
    notes: "Triple urgency signal",
  },
  {
    id: "RF027", input: "i keep passing out the blood won't stop",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["faint", "heavy", "english"],
    notes: "Recurrent syncope + uncontrolled bleeding",
  },
  {
    id: "RF028", input: "the pain is one-sided and very sharp and i'm scared",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["one_sided", "ectopic_risk", "english"],
    notes: "One-sided sharp pain — ectopic flag",
  },
  {
    id: "RF029", input: "me cant stand up the pain one side too bad",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "one_sided", "weakness"],
    notes: "Patois: one-sided + can't stand",
  },
  {
    id: "RF030", input: "blood soaking through and i feel like i'm going to pass out",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["soaking", "faint", "english"],
    notes: "Anticipatory syncope + soaking",
  },


  // ══════════════════════════════════════════════════════════════════════════
  //  ROUTING — English, expected inferRoute node
  // ══════════════════════════════════════════════════════════════════════════

  // — Late period —
  {
    id: "RT001", input: "my period is late and i had unprotected sex",
    category: "routing",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["late", "pregnancy", "english"],
    notes: "Late + pregnancy chance + no test → PREGNANCY_ENTRY intent-first node",
  },
  {
    id: "RT002", input: "period is late and i might be pregnant",
    category: "routing",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["late", "pregnancy", "english"],
    notes: "Direct pregnancy suspicion without test mention → PREGNANCY_ENTRY",
  },
  {
    id: "RT003", input: "my period is late and i took a test it was positive",
    category: "routing",
    expected: { route: "LATE_POSITIVE" },
    tags: ["late", "pregnancy", "test_positive", "english"],
    notes: "Late + positive test result",
  },
  {
    id: "RT004", input: "late period and my pregnancy test came back negative",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR" },
    tags: ["late", "pregnancy", "test_negative", "english"],
    notes: "Late + negative test result",
  },
  {
    id: "RT005", input: "my period is two weeks late",
    category: "routing",
    expected: { route: "LATE_YES_PREG" },
    tags: ["late", "duration", "english"],
    notes: "Late 2 weeks → long duration pathway",
  },
  {
    id: "RT006", input: "period is 3 days late",
    category: "routing",
    expected: { route: "LATE_NO_GUIDANCE" },
    tags: ["late", "duration", "english"],
    notes: "Short duration late → guidance without alarm",
  },
  {
    id: "RT007", input: "my period hasn't come in a month",
    category: "routing",
    expected: { route: "LATE_YES_PREG" },
    tags: ["late", "duration", "english"],
    notes: "Month-late → long duration pathway",
  },
  {
    id: "RT008", input: "i missed my period and i feel nauseous every morning",
    category: "routing",
    expected: { route: "LATE_TEST_Q" },
    tags: ["late", "nausea", "english"],
    notes: "Nausea + late → pregnancy question pathway",
  },
  {
    id: "RT009", input: "my period didn't come this month at all",
    category: "routing",
    expected: { noRoute: true },
    tags: ["late", "english", "no_duration"],
    notes: "Late with no extra signals — falls through to keyword router",
  },
  {
    id: "RT010", input: "i'm a week late and i think i might be pregnant and i took a test it was negative",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR" },
    tags: ["late", "test_negative", "english"],
    notes: "Late + negative test overrides pregnancy chance",
  },

  // — Heavy bleeding —
  {
    id: "RT011", input: "i have heavy bleeding for a week",
    category: "routing",
    expected: { route: "HEAVY_LONGER_THAN_WEEK" },
    tags: ["heavy", "duration", "english"],
    notes: "Heavy + 7 days threshold",
  },
  {
    id: "RT012", input: "heavy bleeding that is very bad and unbearable",
    category: "routing",
    expected: { route: "HEAVY_RISK_SYMPTOMS" },
    tags: ["heavy", "severe", "english"],
    notes: "Unbearable → severity:severe → HEAVY_RISK_SYMPTOMS (urgency regex needs 'severe.*pain', not 'unbearable' alone)",
  },
  {
    id: "RT013", input: "heavy flow that is pretty bad and affecting my day",
    category: "routing",
    expected: { route: "HEAVY_DURATION_CHECK" },
    tags: ["heavy", "moderate", "english"],
    notes: "Heavy + moderate severity",
  },
  {
    id: "RT014", input: "i'm bleeding a lot with large blood clots",
    category: "routing",
    expected: { noRoute: true },
    tags: ["heavy", "clots", "english"],
    notes: "Heavy + clots without duration or severity → falls to keyword router",
  },
  {
    id: "RT015", input: "heavy bleeding and i feel dizzy and lightheaded",
    category: "routing",
    expected: { route: "HEAVY_URGENT" },
    tags: ["heavy", "dizziness", "english"],
    notes: "Heavy + dizziness → urgent (anaemia/blood loss)",
  },

  // — Spotting —
  {
    id: "RT016", input: "light spotting in the middle of my cycle",
    category: "routing",
    expected: { route: "SPOT_MIDCYCLE_NOTE" },
    tags: ["spotting", "mid_cycle", "english"],
    notes: "Classic ovulation spotting pathway",
  },
  {
    id: "RT017", input: "i'm spotting and i might be pregnant",
    category: "routing",
    expected: { route: "SPOT_PREG_INFO" },
    tags: ["spotting", "pregnancy", "english"],
    notes: "Spotting + pregnancy chance",
  },
  {
    id: "RT018", input: "spotting with unusual discharge that smells",
    category: "routing",
    expected: { route: "SPOT_PROVIDER_SOON" },
    tags: ["spotting", "discharge", "english"],
    notes: "Spotting + discharge → provider referral",
  },
  {
    id: "RT019", input: "brown spotting between my periods",
    category: "routing",
    expected: { noRoute: true },
    tags: ["spotting", "brown", "english"],
    notes: "Spotting with no secondary signal → falls through",
  },
  {
    id: "RT020", input: "i notice some pink discharge between periods and i had sex recently",
    category: "routing",
    expected: { route: "SPOT_MIDCYCLE_NOTE" },
    tags: ["spotting", "mid_cycle", "english"],
    notes: "Pink + between periods → mid_cycle timing fires before pregnancy (sex != unprotected/breed/might be pregnant)",
  },

  // — Pelvic pain —
  {
    id: "RT021", input: "i have cramps after sex",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO" },
    tags: ["pelvic", "after_sex", "english"],
    notes: "Pelvic + after_sex timing",
  },
  {
    id: "RT022", input: "pelvic pain that is very bad affecting my whole day",
    category: "routing",
    expected: { route: "PELVIC_PERSISTENT" },
    tags: ["pelvic", "severe", "english"],
    notes: "Very bad pelvic → severe → persistent pathway",
  },
  {
    id: "RT023", input: "mild cramps before my period",
    category: "routing",
    expected: { noRoute: true },
    tags: ["pelvic", "mild", "before_period", "english"],
    notes: "Mild cramps alone — falls through to keyword router",
  },
  {
    id: "RT024", input: "bad cramps and heavy bleeding at the same time",
    category: "routing",
    expected: { urgent: false },
    tags: ["pelvic", "heavy", "english"],
    notes: "Pelvic + heavy combo — resolveSignals handles in scoreSignals layer",
  },
  {
    id: "RT025", input: "my lower abdomen hurts during sex",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO" },
    tags: ["pelvic", "during_sex", "english"],
    notes: "during_sex timing maps to after_sex pathway",
  },

  // — Mood / PMS —
  {
    id: "RT026", input: "i feel very anxious and tired a few days before my period",
    category: "routing",
    expected: { route: "MOOD_SEVERITY" },
    tags: ["mood", "before_period", "english"],
    notes: "Classic PMS mood pathway",
  },
  {
    id: "RT027", input: "so emotional and drained in the week before my period",
    category: "routing",
    expected: { route: "MOOD_SEVERITY" },
    tags: ["mood", "before_period", "english"],
    notes: "Emotional + drained before period",
  },
  {
    id: "RT028", input: "i feel sad and low energy all the time",
    category: "routing",
    expected: { noRoute: true },
    tags: ["mood", "general", "english"],
    notes: "General mood without timing — falls through",
  },
  {
    id: "RT029", input: "irritable and crying a lot a week before my period starts",
    category: "routing",
    expected: { route: "MOOD_SEVERITY" },
    tags: ["mood", "before_period", "english"],
    notes: "Irritability + crying before period",
  },
  {
    id: "RT030", input: "i feel so tired and drained a few days before my period",
    category: "routing",
    expected: { route: "MOOD_SEVERITY" },
    tags: ["mood", "before_period", "english"],
    notes: "Fatigue + drained before period — 'exhausted' misses regex (\bexhaust\b fails on 'exhausted'), use 'tired'/'drained'",
  },

  // — Discharge —
  {
    id: "RT031", input: "i have unusual discharge with a smell",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE" },
    tags: ["discharge", "english"],
    notes: "Discharge alone → discharge pathway",
  },
  {
    id: "RT032", input: "something is coming out with an odor",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE" },
    tags: ["discharge", "english"],
    notes: "Indirect discharge phrasing",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ROUTING — Patois / Jamaican dialect
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PA001", input: "me period nuh come",
    category: "routing",
    expected: { noRoute: true },
    tags: ["patois", "late"],
    notes: "Patois: period not come — late detected, no secondary signal",
  },
  {
    id: "PA002", input: "me period nuh come and me sleep wid someone",
    category: "routing",
    expected: { noRoute: true },
    tags: ["patois", "late", "pregnancy"],
    notes: "Patois: 'sleep wid' not in pregnancy regex (needs 'slept with'/'breed'/'unprotected') — falls through",
  },
  {
    id: "PA003", input: "me bleed bad for a week",
    category: "routing",
    expected: { route: "HEAVY_LONGER_THAN_WEEK" },
    tags: ["patois", "heavy", "duration"],
    notes: "Patois: heavy bleeding 7 days",
  },
  {
    id: "PA004", input: "mi stomach a hurt mi bad bad",
    category: "routing",
    expected: { noRoute: true },
    tags: ["patois", "pelvic", "severity_gap"],
    notes: "Patois: 'stomach a hurt' misses pelvic regex (needs 'stomach.*hurt'), 'bad bad' misses severity regex — known patois gap",
  },
  {
    id: "PA005", input: "me feel dizzy and me bleed nuff",
    category: "routing",
    expected: { route: "HEAVY_URGENT" },
    tags: ["patois", "heavy", "dizziness"],
    notes: "Patois: heavy + dizzy → urgent",
  },
  {
    id: "PA006", input: "me period nuh come fi two weeks",
    category: "routing",
    expected: { route: "LATE_YES_PREG" },
    tags: ["patois", "late", "duration"],
    notes: "Patois: 2 weeks late",
  },
  {
    id: "PA007", input: "spotting in di middle of mi cycle",
    category: "routing",
    expected: { route: "SPOT_MIDCYCLE_NOTE" },
    tags: ["patois", "spotting", "mid_cycle"],
    notes: "Patois: midcycle spotting",
  },
  {
    id: "PA008", input: "me feel sad and tired before me period",
    category: "routing",
    expected: { route: "MOOD_SEVERITY" },
    tags: ["patois", "mood", "before_period"],
    notes: "Patois: mood before period",
  },
  {
    id: "PA009", input: "likkle blood between period",
    category: "routing",
    expected: { noRoute: true },
    tags: ["patois", "spotting"],
    notes: "Patois: likkle blood (spotting) — no secondary signal",
  },
  {
    id: "PA010", input: "mi period late and mi tek a test it come back negative",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR" },
    tags: ["patois", "late", "test_negative"],
    notes: "Patois: late + negative test",
  },
  {
    id: "PA011", input: "me have discharge wid smell",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE" },
    tags: ["patois", "discharge"],
    notes: "Patois: discharge with odor",
  },
  {
    id: "PA012", input: "me period nuh come and me feel sick to me stomach every morning",
    category: "routing",
    expected: { route: "LATE_TEST_Q" },
    tags: ["patois", "late", "nausea"],
    notes: "Patois: late + morning nausea → pregnancy question",
  },
  {
    id: "PA013", input: "me spot and me might breed",
    category: "routing",
    expected: { route: "SPOT_PREG_INFO" },
    tags: ["patois", "spotting", "pregnancy"],
    notes: "Patois: spotting + might be pregnant (breed)",
  },
  {
    id: "PA014", input: "cramp bad after sex",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO" },
    tags: ["patois", "pelvic", "after_sex"],
    notes: "Patois-adjacent: cramp bad after sex",
  },
  {
    id: "PA015", input: "me period nuh show up and me breed fi 3 days late",
    category: "routing",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["patois", "late", "duration", "pregnancy"],
    notes: "Late + breed (pregnancy) → PREGNANCY_ENTRY fires before short_duration check (line priority in inferRoute)",
  },
  {
    id: "PA016", input: "flooding and feel like me ago faint",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "heavy", "faint"],
    notes: "Patois: flooding (heavy) + faint signal",
  },
  {
    id: "PA017", input: "me bleed nuff and me dizzy dizzy",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["patois", "heavy", "dizziness"],
    notes: "Patois: heavy + dizziness → HEAVY_URGENT (dizzy dizzy still matches dizziness regex)",
  },
  {
    id: "PA018", input: "me nuh feel good before me period come, always sad and weak",
    category: "routing",
    expected: { route: "MOOD_SEVERITY" },
    tags: ["patois", "mood", "before_period"],
    notes: "Patois: emotional before period",
  },
  {
    id: "PA019", input: "period come two weeks late and me tek test it positive",
    category: "routing",
    expected: { route: "LATE_POSITIVE" },
    tags: ["patois", "late", "test_positive"],
    notes: "Patois: late + positive test — test result overrides duration",
  },
  {
    id: "PA020", input: "me have cramps and heavy bleeding together",
    category: "routing",
    expected: { urgent: false },
    tags: ["patois", "pelvic", "heavy"],
    notes: "Patois: cramps + heavy — no urgency unless severity is extreme",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FALLBACK — OOS, gibberish, no health signal
  // ══════════════════════════════════════════════════════════════════════════

  // Gibberish
  {
    id: "FB001", input: "asdfghjkl",
    category: "fallback",
    expected: { gibberish: false, noRoute: true },
    tags: ["gibberish", "known_gap"],
    notes: "Keyboard mash: high letter ratio (88%) passes gibberish check — known limitation of ratio-only detection",
  },
  {
    id: "FB002", input: "zzzzzzzzz",
    category: "fallback",
    expected: { gibberish: true, noRoute: true },
    tags: ["gibberish"],
    notes: "Repeated single character",
  },
  {
    id: "FB003", input: "xyz",
    category: "fallback",
    expected: { gibberish: false, noRoute: true },
    tags: ["gibberish", "known_gap", "short"],
    notes: "xyz: 3 chars, 100% letters, not in SHORT_REAL_WORDS but passes ratio check — known gap (only length ≤2 auto-rejects)",
  },
  {
    id: "FB004", input: "111111111",
    category: "fallback",
    expected: { gibberish: true, noRoute: true },
    tags: ["gibberish", "numbers"],
    notes: "Numbers only",
  },
  {
    id: "FB005", input: "hi",
    category: "fallback",
    expected: { gibberish: false, noRoute: true },
    tags: ["short_real_word"],
    notes: "hi is in SHORT_REAL_WORDS — must NOT be gibberish",
  },
  {
    id: "FB006", input: "ok",
    category: "fallback",
    expected: { gibberish: false, noRoute: true },
    tags: ["short_real_word"],
    notes: "ok is in SHORT_REAL_WORDS",
  },
  {
    id: "FB007", input: "lol",
    category: "fallback",
    expected: { gibberish: false, noRoute: true },
    tags: ["short_real_word"],
    notes: "lol is in SHORT_REAL_WORDS",
  },
  {
    id: "FB008", input: "qqqqqqqqqqqqqq",
    category: "fallback",
    expected: { gibberish: true, noRoute: true },
    tags: ["gibberish"],
    notes: "Long repeated char",
  },
  {
    id: "FB009", input: "!!!!!!!!",
    category: "fallback",
    expected: { gibberish: true, noRoute: true },
    tags: ["gibberish", "symbols"],
    notes: "Symbols only",
  },

  // Out of scope — no health route should fire
  {
    id: "FB010", input: "what should i eat for dinner",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "food"],
    notes: "Food topic — no reproductive health signal",
  },
  {
    id: "FB011", input: "i'm stressed about my exam tomorrow",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "school"],
    notes: "School stress — no reproductive health signal",
  },
  {
    id: "FB012", input: "my boyfriend broke up with me",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "relationships"],
    notes: "Relationship topic — no health signal",
  },
  {
    id: "FB013", input: "i need money to pay my bills",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "money"],
    notes: "Financial topic — no health signal",
  },
  {
    id: "FB014", input: "what is the weather like today",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "general"],
    notes: "General knowledge question",
  },
  {
    id: "FB015", input: "i'm traveling to london next week",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "travel"],
    notes: "Travel topic without health context",
  },
  {
    id: "FB016", input: "can you recommend a good movie",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "general"],
    notes: "Completely off-topic",
  },
  {
    id: "FB017", input: "i'm using birth control pills",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "contraception"],
    notes: "Contraception mention with no symptoms",
  },
  {
    id: "FB018", input: "i feel sad about my weight",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "body_image"],
    notes: "Body image without cycle context",
  },
  {
    id: "FB019", input: "i can't sleep lately",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "sleep"],
    notes: "Sleep complaint without hormonal context",
  },
  {
    id: "FB020", input: "i have a headache",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "non_repro_health"],
    notes: "Non-reproductive symptom alone",
  },


  // ══════════════════════════════════════════════════════════════════════════
  //  EDGE CASES — boundary conditions, mixed signals, tricky inputs
  // ══════════════════════════════════════════════════════════════════════════

  // Legitimate short health messages (must not be flagged as gibberish)
  {
    id: "EG001", input: "spotting",
    category: "edge",
    expected: { gibberish: false, noRoute: true },
    tags: ["short", "single_word"],
    notes: "Single valid health word — not gibberish, but no route without context",
  },
  {
    id: "EG002", input: "late",
    category: "edge",
    expected: { gibberish: false, noRoute: true },
    tags: ["short", "single_word"],
    notes: "Single word 'late' — valid, no route",
  },
  {
    id: "EG003", input: "cramps",
    category: "edge",
    expected: { gibberish: false, noRoute: true },
    tags: ["short", "single_word"],
    notes: "Single word health complaint",
  },

  // False reassurance guards — these SHOULD produce a non-null route (not silently ignored)
  {
    id: "EG004", input: "my period is 2 weeks late and i had sex",
    category: "edge",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["late", "pregnancy", "duration"],
    notes: "Late + sex → pregnancy.chance fires → PREGNANCY_ENTRY (pregnancy check at line 312 fires before duration at line 327)",
  },
  {
    id: "EG005", input: "missed my period, took a test, it says positive",
    category: "edge",
    expected: { route: "LATE_POSITIVE" },
    tags: ["late", "test_positive"],
    notes: "Positive test — must route to positive node",
  },

  // OOS with embedded health word (tricky — should NOT false-positive as health)
  {
    id: "EG006", input: "i love period dramas like bridgerton",
    category: "edge",
    expected: { noRoute: true },
    tags: ["oos_embedded_word", "period_drama"],
    notes: "Period in non-health context — should not trigger late signal",
  },

  // Ambiguous — contains health words but no clear intent
  {
    id: "EG007", input: "bleeding edge technology is so cool",
    category: "edge",
    expected: { noRoute: true },
    tags: ["false_positive_guard", "bleeding"],
    notes: "Bleeding in non-health context — heavy should not fire",
  },

  // Multi-symptom without urgency — should route, not urgent
  {
    id: "EG008", input: "i have spotting, cramps, and mood swings before my period",
    category: "edge",
    expected: { urgent: false },
    tags: ["multi_symptom", "before_period"],
    notes: "Multiple PMS symptoms — not urgent",
  },

  // Urgency word in safe context
  {
    id: "EG009", input: "my pain is severe but i'm managing it at home",
    category: "edge",
    expected: { urgent: false },
    tags: ["severe_word", "not_urgent"],
    notes: "Severe used as adjective without urgency trigger pattern",
  },

  // Very long message (stress test)
  {
    id: "EG010",
    input: "hi i've been having really heavy bleeding for about a week now and it's been pretty bad, i've been soaking through pads quite a lot and i also feel dizzy sometimes, i'm not sure if i should be worried but it's been affecting my daily life",
    category: "edge",
    expected: { route: "HEAVY_URGENT" },
    tags: ["long_message", "heavy", "dizziness"],
    notes: "Long message with heavy + dizziness buried in narrative",
  },

  // Capslock / mixed case
  {
    id: "EG011", input: "MY PERIOD IS VERY LATE AND I HAD UNPROTECTED SEX",
    category: "edge",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["caps", "late", "pregnancy"],
    notes: "Uppercase input — normalization must handle; routes to PREGNANCY_ENTRY",
  },

  // Ellipsis / punctuation heavy
  {
    id: "EG012", input: "period... late... spotting... help...",
    category: "edge",
    expected: { noRoute: true },
    tags: ["punctuation", "multi_symptom"],
    notes: "Fragmented ellipsis input — basic signals may fire but no combo",
  },

  // Repeated words (user emphasis)
  {
    id: "EG013", input: "very very very late period",
    category: "edge",
    expected: { noRoute: true },
    tags: ["emphasis", "late"],
    notes: "Repeated emphasis — late fires but no secondary signal",
  },

  // Emoji-heavy
  {
    id: "EG014", input: "my period is late 😭😭 i had sex last week 😰",
    category: "edge",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["emoji", "late", "pregnancy"],
    notes: "Emojis should be stripped — core signal still fires; routes to PREGNANCY_ENTRY",
  },

  // Contradictory signals
  {
    id: "EG015", input: "my period came but it's very late and also positive test",
    category: "edge",
    expected: { route: "LATE_POSITIVE" },
    tags: ["contradictory", "late", "test_positive"],
    notes: "Conflicting signals — positive test should win",
  },

  // Direct question phrasing
  {
    id: "EG016", input: "is my period late?",
    category: "edge",
    expected: { noRoute: true },
    tags: ["question", "late"],
    notes: "Direct question — late fires but no route without context",
  },

  // Colloquial phrasing
  {
    id: "EG017", input: "my flow is super heavy like soaking through in under an hour",
    category: "edge",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["colloquial", "heavy", "soaking"],
    notes: "Colloquial soaking-through — urgency must still fire",
  },

  // Discharge without other symptoms — should route quietly
  {
    id: "EG018", input: "white discharge coming out",
    category: "edge",
    expected: { route: "ELSE_DISCHARGE" },
    tags: ["discharge", "english"],
    notes: "Discharge alone with minimal phrasing",
  },

  // Safe case — should NOT route to urgent
  {
    id: "EG019", input: "mild spotting a few days before my period, just a little",
    category: "edge",
    expected: { urgent: false, noRoute: true },
    tags: ["spotting", "mild", "before_period", "not_urgent"],
    notes: "Mild pre-period spotting — not urgent, no multi-signal combo",
  },

  // Nausea alone
  {
    id: "EG020", input: "i feel nauseous in the mornings",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["nausea", "no_late"],
    notes: "Nausea without late period — should not infer pregnancy pathway",
  },


  // ══════════════════════════════════════════════════════════════════════════
  //  EDUCATION ROUTES — PCOS, Endo, Contraception
  //
  //  NOTE: These routes are handled by routeUserText() keyword patterns in
  //  assistant.js, NOT by inferRoute() in bloomie-inference.js. The harness
  //  only runs the inference pipeline, so actualRoute will always be null for
  //  these inputs. Cases assert noRoute: true + urgent: false — confirming the
  //  inference layer correctly passes them through without misfiring urgency.
  // ══════════════════════════════════════════════════════════════════════════

  // — EDUC_PCOS —
  {
    id: "ED001", input: "i have pcos and i want to understand what it means",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "english"],
    notes: "Explicit PCOS mention — routeUserText /\\bpcos\\b/ → EDUC_PCOS; inferRoute returns null",
  },
  {
    id: "ED002", input: "i was told i have polycystic ovary syndrome",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "english", "polycystic"],
    notes: "polycystic keyword — routeUserText routes to EDUC_PCOS; not an inference signal",
  },
  {
    id: "ED003", input: "i have irregular periods and really bad acne, could i have pcos?",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "english", "irregular", "acne"],
    notes: "irregular period + acne combo → EDUC_PCOS via routeUserText; inferRoute has no PCOS node",
  },
  {
    id: "ED004", input: "my cycle is so irregular and i keep getting hair growing on my chin",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "english", "irregular", "hair"],
    notes: "irregular period + hair combo → EDUC_PCOS via routeUserText",
  },
  {
    id: "ED005", input: "mi period nuh regular and dem say me have pcos",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "patois"],
    notes: "Patois: irregular + PCOS keyword — pcos is language-neutral, routeUserText fires after normalize",
  },

  // — EDUC_ENDO —
  {
    id: "ED006", input: "i think i might have endometriosis, what is it?",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["endo", "education", "english", "endometriosis"],
    notes: "endometriosis keyword → EDUC_ENDO via routeUserText; inferRoute has no endo node",
  },
  {
    id: "ED007", input: "i have endo and want to know more about managing it",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["endo", "education", "english"],
    notes: "standalone endo keyword (\\bendo\\b) → EDUC_ENDO; \\b prevents match inside 'endorphins'",
  },
  {
    id: "ED008", input: "i have pain every period and it doesn't get better with painkillers",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["endo", "education", "english", "pain_every_period"],
    notes: "'pain every period' phrase → EDUC_ENDO; not an inferRoute urgency pattern",
  },
  {
    id: "ED009", input: "i have period pain that doesn't go away even between periods",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["endo", "education", "english", "persistent_pain"],
    notes: "'period pain that doesn't go away' phrase → EDUC_ENDO via routeUserText",
  },
  {
    id: "ED010", input: "mi have pain every period every single month",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["endo", "education", "patois", "pain_every_period"],
    notes: "Patois: 'pain every period' phrase survives normalization — routeUserText routes to EDUC_ENDO",
  },

  // — EDUC_CONTRACEPTION —
  {
    id: "ED011", input: "what are my contraception options",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["contraception", "education", "english"],
    notes: "contraception keyword → EDUC_CONTRACEPTION via routeUserText; no inference signal",
  },
  {
    id: "ED012", input: "i want to get an iud, what should i know before i go in",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["contraception", "education", "english", "iud"],
    notes: "iud keyword → EDUC_CONTRACEPTION; inferRoute has no contraception node",
  },
  {
    id: "ED013", input: "what birth control is best for someone my age",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["contraception", "education", "english", "birth_control"],
    notes: "'birth control' phrase → EDUC_CONTRACEPTION via routeUserText",
  },
  {
    id: "ED014", input: "should i get the implant or stay on the pill",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["contraception", "education", "english", "implant", "pill"],
    notes: "implant + pill keywords both match routeUserText patterns (first match wins: implant fires)",
  },
  {
    id: "ED015", input: "i want to talk about family planning options",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["contraception", "education", "english", "family_planning"],
    notes: "'family planning' phrase → EDUC_CONTRACEPTION via routeUserText",
  },


  // ══════════════════════════════════════════════════════════════════════════
  //  NARROWING — health-word intercept should fire, NOT fall through to OOS
  //
  //  These inputs contain words from the NARROWING pattern
  //  /\b(period|bleed|pain|cramp|discharge|pregnant|cycle|mood|tired|sick|hurt)\b/
  //  but don't resolve to a specific inferRoute node. In the chat handler they
  //  would be caught by the zero-confidence narrowing check and shown topic
  //  buttons instead of the generic OOS reply.
  //
  //  The harness can't test the NARROWING node directly (it lives in assistant.js),
  //  but these cases guard that the inference layer does NOT misfire urgency or
  //  a wrong route on these ambiguous inputs.
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "NR001", input: "i just feel really tired and sick",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "tired", "sick", "ambiguous"],
    notes: "tired + sick match NARROWING health-word pattern; no specific inferRoute signal — must not be urgent",
  },
  {
    id: "NR002", input: "something feels off with my cycle but i can't explain it",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "cycle", "ambiguous"],
    notes: "cycle keyword in vague context — NARROWING should intercept in chat handler; inferRoute returns null",
  },
  {
    id: "NR003", input: "my mood has been all over the place lately",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "mood", "ambiguous"],
    notes: "mood without before_period timing — mood signal alone doesn't satisfy MOOD_SEVERITY route; NARROWING catches it",
  },
  {
    id: "NR004", input: "i hurt down there and i'm not sure what it is",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "hurt", "pain", "ambiguous"],
    notes: "hurt + vague location — pelvic signal may score but not reach route threshold; NARROWING intercepts",
  },
  {
    id: "NR005", input: "i just feel unwell, something to do with my period maybe",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "period", "sick", "ambiguous"],
    notes: "period + sick in uncertain framing — no secondary signal; NARROWING should ask clarifying question rather than OOS",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PREGNANCY TEST FLOW — new multi-entry route cases
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PT001", input: "i tested negative yesterday",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "negative", "already_tested", "english"],
    notes: "'tested negative' phrase → routeUserText should fire TEST_NEGATIVE_INTRO",
  },
  {
    id: "PT002", input: "my test came back negative but my period still hasn't come",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR", urgent: false },
    tags: ["test_flow", "negative", "late_period", "english"],
    notes: "Negative test + late period → inferRoute fires LATE_NEG_UNCLEAR before routeUserText runs",
  },
  {
    id: "PT003", input: "i already tested and it was negative",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "negative", "already_tested", "english"],
    notes: "'already tested' pattern → TEST_NEGATIVE_INTRO",
  },
  {
    id: "PT004", input: "i took a test already but i'm not sure if it was right",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "negative", "already_tested", "english"],
    notes: "'took a test already' phrase → TEST_NEGATIVE_INTRO",
  },
  {
    id: "PT005", input: "i had unprotected sex last week",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "'had unprotected sex' → routeUserText fires TEST_RECENT_SEX_INTRO",
  },
  {
    id: "PT006", input: "we had unprotected sex recently and i'm worried",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "'unprotected sex recently' pattern → TEST_RECENT_SEX_INTRO",
  },
  {
    id: "PT007", input: "we had sex without a condom three days ago",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "'sex without condom' → TEST_RECENT_SEX_INTRO",
  },
  {
    id: "PT008", input: "i forgot the condom and now i'm scared i might be pregnant",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "'forgot the condom' → TEST_RECENT_SEX_INTRO",
  },
  {
    id: "PT009", input: "i have irregular cycles and i don't know when my period is due",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "irregular_cycle", "english"],
    notes: "Irregular cycle mention — no route from inferRoute but routeUserText shouldn't misfire as urgent",
  },
  {
    id: "PT010", input: "i have severe one-sided pain and i tested positive",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["test_flow", "urgent", "ectopic_risk", "english"],
    notes: "Severe one-sided pain in test context — ectopic risk, must route HEAVY_URGENT",
  },
  {
    id: "PT011", input: "i took a pregnancy test and it was positive but i feel faint and have bad pain on one side",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["test_flow", "urgent", "ectopic_risk", "faint", "english"],
    notes: "Positive test + faint + one-sided pain = ectopic red flag, HEAVY_URGENT required",
  },
  {
    id: "PT012", input: "i had unprotected sex yesterday and i want to test now",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "too_early", "english"],
    notes: "Sex yesterday — too early for any test; should eventually reach TEST_TOO_EARLY via TEST_RECENT_SEX_INTRO",
  },
  {
    id: "PT013", input: "negative test two days ago, period is 10 days late, should i test again",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR", urgent: false },
    tags: ["test_flow", "negative", "retest", "late_period", "english"],
    notes: "Negative + late + retest intent → inferRoute fires LATE_NEG_UNCLEAR; TEST_RETEST_NOW path in assistant.js",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  HEAVY BLEEDING FLOW — multi-entry route cases
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "HV001", input: "i'm soaking through pads every hour for the last three hours",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "soaking_through", "route_a", "urgent", "english"],
    notes: "'soaking through' matches urgency phrase — must route HEAVY_URGENT directly (urgentPhrases check)",
  },
  {
    id: "HV002", input: "i'm soaking my pad really fast, changing every hour",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "soaking", "route_a", "english"],
    notes: "'soaking' (without 'through') + 'changing every hour' → HEAVY_INTRO via Route A in routeUserText",
  },
  {
    id: "HV003", input: "my period won't stop and it's been 9 days now",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "duration", "route_b", "english"],
    notes: "'won't stop' + '9 days' → HEAVY_ROUTE_B via Route B detection in routeUserText",
  },
  {
    id: "HV004", input: "bleeding for 10 days straight and getting heavier",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "duration", "route_b", "10_days", "english"],
    notes: "'10 days' matches Route B detection → HEAVY_ROUTE_B",
  },
  {
    id: "HV005", input: "i'm feeling really dizzy and i'm bleeding heavily",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "dizzy", "route_c", "english"],
    notes: "'dizzy' + 'bleeding' → Route C detection (C > A) → HEAVY_ROUTE_C",
  },
  {
    id: "HV006", input: "i feel weak and my period is very heavy",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "weak", "urgent", "english"],
    notes: "heavy + weak → inferRoute fires HEAVY_URGENT before routeUserText; Route C path via routeUserText only if inferRoute misses",
  },
  {
    id: "HV007", input: "i passed out from heavy bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "faint", "urgent", "english"],
    notes: "'passed out' in urgentPhrases — direct HEAVY_URGENT, bypasses all route detection",
  },
  {
    id: "HV008", input: "mi period nuh stop a week now",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "patois", "route_b", "duration"],
    notes: "Patois: 'nuh stop' normalizes, 'a week now' matches Route B → HEAVY_ROUTE_B",
  },
  {
    id: "HV009", input: "pad full up and blood everywhere",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "patois", "route_a", "volume"],
    notes: "Patois Route A patterns: 'pad full up', 'blood everywhere' → HEAVY_INTRO",
  },
  {
    id: "HV010", input: "mi feel weak and a nuff blood",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "patois", "route_c", "weak"],
    notes: "Patois: 'mi feel weak' + 'nuff blood' → Route C priority → HEAVY_ROUTE_C",
  },
  {
    id: "HV011", input: "mi dizzy and mi period flooding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "patois", "dizzy", "urgent"],
    notes: "Patois: after normalization dizzy + heavy → inferRoute catches as HEAVY_URGENT; Route C is routeUserText fallback",
  },
  {
    id: "HV012", input: "heavy bleeding with clots and it's been going on 8 days",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "clots", "duration", "route_b", "english"],
    notes: "heavy + clots + 8 days — inferRoute returns null; routeUserText '8 days' matches Route B → HEAVY_ROUTE_B",
  },
  {
    id: "HV013", input: "i have heavy bleeding and it's not more than usual",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "route_a", "no_flags", "english"],
    notes: "'heavy' triggers Route A → HEAVY_INTRO; user will answer no-flags → HEAVY_MONITOR expected path",
  },
  {
    id: "HV014", input: "period still a go and a nuff blood",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "patois", "route_b", "duration"],
    notes: "Patois: 'period still a go' matches Route B → HEAVY_ROUTE_B",
  },
  {
    id: "HV015", input: "i fainted from the bleeding and i'm scared",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "faint_past", "route_c", "english"],
    notes: "'fainted' (past tense) is not caught by inferRoute urgent detection; routeUserText catches 'faint' substring → HEAVY_URGENT via urgentPhrases",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PREGNANCY INTENT FLOW — covers new PREGNANCY_ENTRY and sub-routes
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PI001", input: "pregnancy concern",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "english"],
    notes: "'pregnancy concern' → inferRoute returns null; routeUserText explicit pattern sends to PREGNANCY_ENTRY",
  },
  {
    id: "PI002", input: "i might be pregnant and my period is late",
    category: "routing",
    expected: { route: "PREGNANCY_ENTRY", urgent: false },
    tags: ["pregnancy_entry", "late", "english"],
    notes: "sym.late + pregnancy.chance (might be pregnant) + no test → inferRoute returns PREGNANCY_ENTRY",
  },
  {
    id: "PI003", input: "could i be pregnant",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "english"],
    notes: "'could be pregnant' sets pregnancy.chance but no late signal → inferRoute returns null; routeUserText sends to PREGNANCY_ENTRY",
  },
  {
    id: "PI004", input: "i'm having a pregnancy scare",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "english"],
    notes: "'pregnancy scare' → inferRoute null; routeUserText explicit pattern sends to PREGNANCY_ENTRY",
  },
  {
    id: "PI005", input: "i'm trying to conceive and want help",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "ttc", "english"],
    notes: "'trying to conceive' → inferRoute null; routeUserText sends to PREGNANCY_ENTRY (user picks TTC_INTRO from choices)",
  },
  {
    id: "PI006", input: "fertility concern",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "fertility", "english"],
    notes: "'fertility concern' → inferRoute null; routeUserText explicit pattern sends to PREGNANCY_ENTRY",
  },
  {
    id: "PI007", input: "i already took a test and it came back negative but i still feel weird",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "tested_negative", "english"],
    notes: "testedYet=true, result=negative, no late signal → inferRoute null; routeUserText 'already tested' pattern → TEST_NEGATIVE_INTRO",
  },
  {
    id: "PI008", input: "i took a test and it was positive",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "tested_positive", "english"],
    notes: "testedYet=true, result=positive, no late signal → inferRoute null (needs late+positive combo); routeUserText handles via pregnancy signal",
  },
  {
    id: "PI009", input: "severe one-sided pain and i'm worried i might be pregnant",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["pregnancy_entry", "ectopic_risk", "one_sided", "english"],
    notes: "One-sided + severe + pelvic → inferRoute late+severe_pelvic ectopic rule fires HEAVY_URGENT; urgency trumps PREGNANCY_ENTRY",
  },
  {
    id: "PI010", input: "i'm anxious about pregnancy and not sure what to do",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_entry", "anxious", "english"],
    notes: "'pregnancy' (not 'pregnant') doesn't set pregnancy.chance → inferRoute null; routeUserText sends to PREGNANCY_ENTRY → user picks PREG_CLARIFY_ROUTE",
  },
  {
    id: "PI011", input: "my period is late and i think i might be pregnant",
    category: "routing",
    expected: { route: "PREGNANCY_ENTRY", urgent: false },
    tags: ["pregnancy_entry", "late", "english"],
    notes: "sym.late + pregnancy.chance (think.*pregnant) + no test → inferRoute returns PREGNANCY_ENTRY",
  },
  {
    id: "PI012", input: "i tested negative and want to know if i should test again my period is 10 days late",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR", urgent: false },
    tags: ["pregnancy_entry", "tested_negative", "late", "no_major_changes_early", "english"],
    notes: "Tested negative + late → inferRoute fires LATE_NEG_UNCLEAR; major changes question appears AFTER negative result — correct placement",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ELSE SECTION — discharge, body changes, not-sure routing, ELSE_INTRO
  //
  //  Inference layer (inferRoute) routes discharge-only to ELSE_DISCHARGE.
  //  Node-level routing inside assistant.js then fans out to DISCHARGE_*
  //  and ELSE_BODY_ENTRY sub-nodes — those paths are not testable here.
  //  Cases with noRoute: true guard that inferRoute does NOT misfire urgency
  //  or a wrong route for these inputs.
  // ══════════════════════════════════════════════════════════════════════════

  // — Discharge with odour → DISCHARGE_PROVIDER_SOON (node level) —
  {
    id: "EL001", input: "i have unusual discharge with a strong smell and itching",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "smell", "else_section", "english"],
    notes: "Discharge + smell → inferRoute returns ELSE_DISCHARGE; node-level ELSE_DISCHARGE_ENTRY routes to DISCHARGE_PROVIDER_SOON",
  },
  {
    id: "EL002", input: "my discharge smells really bad and there is burning",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "smell", "else_section", "english"],
    notes: "Bad smell + burning → ELSE_DISCHARGE; node-level → DISCHARGE_PROVIDER_SOON via ELSE_DISCHARGE_ENTRY",
  },

  // — Discharge with fever → DISCHARGE_URGENT (node level) —
  {
    id: "EL003", input: "i have discharge and fever and my lower belly hurts",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "fever", "pelvic", "else_section", "english"],
    notes: "Discharge + fever: 'belly hurts' misses pelvic regex (requires 'belly.*hurt\\b', 'hurts' fails \\b), so sym.pelvic=false — inferRoute returns ELSE_DISCHARGE; node-level user picks 'fever or pelvic pain' → DISCHARGE_URGENT",
  },

  // — Normal increased discharge → DISCHARGE_MONITOR (node level) —
  {
    id: "EL004", input: "i have more discharge than usual but no smell or colour change",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "normal", "else_section", "english"],
    notes: "Discharge alone with no pelvic/spot → ELSE_DISCHARGE; node-level user picks 'just more than usual' → DISCHARGE_MONITOR",
  },

  // — Body changes → BODY_HORMONAL_ROUTE (node level) —
  {
    id: "EL005", input: "my skin keeps breaking out and my hair is thinning, could it be hormonal",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["body_changes", "hormonal", "else_section", "english"],
    notes: "Body changes (acne, hair) have no inferRoute signal; node-level ELSE_BODY_ENTRY → BODY_HORMONAL_ROUTE",
  },
  {
    id: "EL006", input: "i have been gaining weight and getting more acne, wonder if its my cycle",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["body_changes", "hormonal", "else_section", "english"],
    notes: "Weight + acne without health signal keywords — inferRoute returns null; node-level → BODY_HORMONAL_ROUTE",
  },

  // — Sleep issues → BODY_SLEEP_ROUTE (node level) —
  {
    id: "EL007", input: "i have not been sleeping well for the past few weeks, maybe something hormonal",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["sleep", "body_changes", "else_section", "english"],
    notes: "Sleep complaint without cycle-specific signal — inferRoute null; node-level ELSE_BODY_ENTRY → BODY_SLEEP_ROUTE",
  },

  // — Urgent check with severe pain → HEAVY_URGENT —
  {
    id: "EL008", input: "i am having severe abdominal pain and heavy bleeding and i feel faint",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["urgent", "heavy", "faint", "else_section", "english"],
    notes: "Severe pain + heavy bleeding + faint → HEAVY_URGENT; ELSE_URGENT_CHECK 'Yes' path also routes here",
  },

  // — Not sure → ELSE_NOT_SURE_ROUTE (node level) —
  {
    id: "EL009", input: "something just feels off but i cannot explain what it is",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["not_sure", "vague", "else_section", "english"],
    notes: "Vague complaint, no specific signal — inferRoute null; chat handler NARROWING intercept or ELSE_NOT_SURE_ROUTE via ELSE_INTRO",
  },

  // — Patois input landing in correct ELSE sub-route —
  {
    id: "EL010", input: "me discharge smell like something off, a scratch down there too",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "smell", "patois", "else_section"],
    notes: "Patois: discharge + smell → after normalization discharge signal fires → ELSE_DISCHARGE; node-level → DISCHARGE_PROVIDER_SOON",
  },
  {
    id: "EL011", input: "mi skin break out bad and mi hair a fall out",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["body_changes", "patois", "else_section"],
    notes: "Patois: skin + hair changes — no inferRoute signal; node-level ELSE_BODY_ENTRY → BODY_HORMONAL_ROUTE",
  },

  // — ELSE_CHANGE_TYPE handing off to existing nodes —
  {
    id: "EL012", input: "my cycle timing feels different this month",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["cycle_timing", "else_section", "english"],
    notes: "Vague cycle timing without 'late'/'missed' keywords — inferRoute null; ELSE_CHANGE_TYPE 'cycle timing' choice → LATE_INTRO",
  },
  {
    id: "EL013", input: "i have some spotting between periods and not sure why",
    category: "routing",
    expected: { route: "SPOT_MIDCYCLE_NOTE", urgent: false },
    tags: ["spotting", "mid_cycle", "else_section", "english"],
    notes: "Spotting + 'between periods' phrase → inferRoute returns SPOT_MIDCYCLE_NOTE; ELSE_CHANGE_TYPE 'spotting' choice routes to SPOT_INTRO from ELSE_INTRO path",
  },

  // — ELSE_TALK_THROUGH does not crash on free text input —
  {
    id: "EL014", input: "i dont even know how to explain it i just feel wrong lately",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["free_text", "else_section", "talk_through", "english"],
    notes: "Free-text emotional input — not gibberish; no inferRoute signal; ELSE_TALK_THROUGH accepts this and waits for intent router",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PELVIC PAIN MULTI-ROUTE FLOW — new entry system cases
  //
  //  inferRoute handles: pelvic+after_sex → PELVIC_SEX_INTRO,
  //                      pelvic+severe    → PELVIC_PERSISTENT.
  //  Node-level routing (PELVIC_SAFETY_CHECK, PELVIC_ENTRY, route sub-nodes)
  //  is triggered by routeUserText/buttons — these test noRoute:true from
  //  inferRoute while guarding urgency and signal correctness.
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PV001", input: "i have sudden severe pelvic pain and i feel dizzy",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["pelvic", "urgent", "dizziness", "english"],
    notes: "Severe pelvic + dizzy → inferRoute heavy+dizzy rule → HEAVY_URGENT; safety check would also catch this",
  },
  {
    id: "PV002", input: "i have really bad cramps during my period every month",
    category: "routing",
    expected: { route: "PELVIC_PERSISTENT", urgent: false },
    tags: ["pelvic", "period_route", "severe", "english"],
    notes: "pelvic + severe ('really bad') → inferRoute pelvic+severe → PELVIC_PERSISTENT; period route endo note fires in PELVIC_PERSISTENT say(ctx)",
  },
  {
    id: "PV003", input: "mild cramping mid-cycle happens for a day then stops",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pelvic", "ovulation_route", "mild", "english"],
    notes: "Mild + mid-cycle → inferRoute returns null (no after_sex, no severe); routeUserText sends to PELVIC_SAFETY_CHECK → PELVIC_ENTRY → PELVIC_OVULATION_ROUTE",
  },
  {
    id: "PV004", input: "i get random pelvic pain sometimes and i don't know what causes it",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pelvic", "random_route", "english"],
    notes: "Random pain → inferRoute null; routeUserText → PELVIC_SAFETY_CHECK → PELVIC_ENTRY → PELVIC_RANDOM_ROUTE",
  },
  {
    id: "PV005", input: "deep cramps inside during sex every time we try",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO", urgent: false },
    tags: ["pelvic", "sex_deep_pain", "after_sex", "english"],
    notes: "'cramps' triggers sym.pelvic; during_sex maps to after_sex timing → inferRoute PELVIC_SEX_INTRO; PELVIC_SEX_ENTRY 'deep' choice → PELVIC_SEX_DEEP_PAIN → PELVIC_PERSISTENT",
  },
  {
    id: "PV006", input: "tightness and dryness during sex and i also noticed unusual discharge",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["pelvic", "sex_entry_pain", "discharge", "english"],
    notes: "pelvic + discharge → inferRoute fires ELSE_DISCHARGE (discharge_only rule); PELVIC_SEX_ENTRY_PAIN 'dryness or discharge' choice routes to ELSE_DISCHARGE_ENTRY",
  },
  {
    id: "PV007", input: "been dealing with pelvic pain for about two years",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pelvic", "pattern_chronic", "english"],
    notes: "Chronic framing → inferRoute null; PELVIC_PATTERN 'often' choice routes to PELVIC_PERSISTENT",
  },
  {
    id: "PV008", input: "this pelvic pain feels different from usual, started a few days ago",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pelvic", "pattern_new", "english"],
    notes: "New/different framing → inferRoute null; PELVIC_PATTERN 'new or different' choice routes to PELVIC_REVIEW_SOON",
  },
  {
    id: "PV009", input: "mi belly a hurt mi bad",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "pelvic", "belly_hurt", "english"],
    notes: "Patois 'mi belly a hurt' → inferRoute null; routeUserText explicit Patois pattern → PELVIC_SAFETY_CHECK",
  },
  {
    id: "PV010", input: "cramp bad and waist a hurt",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "pelvic", "cramp_bad", "waist_hurt"],
    notes: "Patois 'cramp bad' + 'waist a hurt' → inferRoute null; routeUserText Patois pattern → PELVIC_SAFETY_CHECK",
  },
  {
    id: "PV011", input: "pain inna mi belly all the time",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "pelvic", "belly_pain"],
    notes: "Patois 'pain inna mi belly' → inferRoute null; routeUserText Patois explicit pattern → PELVIC_SAFETY_CHECK",
  },
  {
    id: "PV012", input: "i have cramps after sex and it lingers for hours",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO", urgent: false },
    tags: ["pelvic", "sex_after_pain", "lingering", "english"],
    notes: "'cramps' triggers sym.pelvic; after_sex timing → inferRoute PELVIC_SEX_INTRO; PELVIC_SEX_ENTRY 'after sex' choice → PELVIC_SEX_AFTER_PAIN 'lingers' → PELVIC_PERSISTENT",
  },
  {
    id: "PV013", input: "cramps after sex but it goes away pretty quickly",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO", urgent: false },
    tags: ["pelvic", "sex_after_pain", "quick", "english"],
    notes: "pelvic + after_sex → inferRoute PELVIC_SEX_INTRO; PELVIC_SEX_AFTER_PAIN 'eases quickly' → PELVIC_REVIEW_SOON",
  },
  {
    id: "PV014", input: "pain between mi legs and down there",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "pelvic", "between_legs"],
    notes: "Patois 'pain between mi legs' → inferRoute null; routeUserText Patois pattern → PELVIC_SAFETY_CHECK",
  },
  {
    id: "PV015", input: "sudden severe one-sided pelvic pain",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["pelvic", "urgent", "one_sided", "ectopic_risk", "english"],
    notes: "Severe + one-sided → extractUrgency fires (one.sided.*pain) → urgent=true → inferRoute HEAVY_URGENT; PELVIC_URGENT language also covers this",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  MOOD — new intent-first system (safety check, routes, Patois)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "MO001", input: "i feel like hurting myself",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["mood", "safety", "self_harm", "english"],
    notes: "'hurt myself' → inferRoute self-harm detection → MOOD_SAFETY_ROUTE before urgency check",
  },
  {
    id: "MO002", input: "i want to die i cant go on like this",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["mood", "safety", "self_harm", "english"],
    notes: "'want to die' and 'cant go on' → self-harm detection → MOOD_SAFETY_ROUTE",
  },
  {
    id: "MO003", input: "i feel completely unsafe right now",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["mood", "safety", "english"],
    notes: "'feel unsafe' → self-harm detection → MOOD_SAFETY_ROUTE",
  },
  {
    id: "MO004", input: "mi cyan cope wid how mi feel",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["patois", "mood", "safety"],
    notes: "Patois 'mi cyan cope' — after normalizeText stays as 'mi cyan cope'; inferRoute self-harm pattern catches 'cyan cope' → MOOD_SAFETY_ROUTE",
  },
  {
    id: "MO005", input: "i feel very anxious all the time",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "anxiety", "english"],
    notes: "General anxiety without before_period — inferRoute null; routeUserText mood signal → MOOD_SAFETY_CHECK via chat flow",
  },
  {
    id: "MO006", input: "i have low mood and i've been crying a lot",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "low", "english"],
    notes: "Low mood without cycle timing — inferRoute null; mood signal routes to MOOD_SAFETY_CHECK in chat",
  },
  {
    id: "MO007", input: "i'm irritable and snapping at everyone lately",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "irritable", "english"],
    notes: "Irritability without timing — inferRoute null; routeUserText mood → MOOD_SAFETY_CHECK",
  },
  {
    id: "MO008", input: "i can't sleep even when i try, for weeks now",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "fatigue", "insomnia", "english"],
    notes: "Insomnia/fatigue without cycle context — inferRoute null; MOOD_FATIGUE_ROUTE insomnia choice applies in chat flow",
  },
  {
    id: "MO009", input: "mi feel off lately",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood"],
    notes: "Patois 'mi feel off' — inferRoute null; routeUserText Patois mood pattern → MOOD_SAFETY_CHECK in chat",
  },
  {
    id: "MO010", input: "mi sad fi no reason",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood", "low"],
    notes: "Patois 'mi sad fi no reason' — inferRoute null; routeUserText Patois pattern → MOOD_SAFETY_CHECK",
  },
  {
    id: "MO011", input: "everything a get to me and mi nuh have no energy fi nothing",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood", "fatigue"],
    notes: "Patois emotional exhaustion — inferRoute null; routeUserText Patois pattern → MOOD_SAFETY_CHECK",
  },
  {
    id: "MO012", input: "i cant cope with being around my baby i dont want to be here",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["mood", "postpartum", "safety", "english"],
    notes: "'dont want to be here' → self-harm detection → MOOD_SAFETY_ROUTE (postpartum-specific language shown at node level)",
  },
  {
    id: "MO013", input: "i want to harm myself because of how i feel",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["mood", "safety", "self_harm", "english"],
    notes: "'harm myself' → self-harm detection → MOOD_SAFETY_ROUTE; safety route does not continue into mood assessment",
  },
  {
    id: "MO014", input: "i feel really sad and anxious before my period every month",
    category: "routing",
    expected: { route: "MOOD_SEVERITY", urgent: false },
    tags: ["mood", "before_period", "english"],
    notes: "Mood + before_period timing → inferRoute MOOD_SEVERITY (existing PMS pathway unchanged)",
  },
  {
    id: "MO015", input: "mi vex all the time lately",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood", "irritable"],
    notes: "Patois 'mi vex all the time' → routeUserText Patois mood pattern → MOOD_SAFETY_CHECK; inferRoute null",
  },

];
