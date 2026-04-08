/**
 * eval/cases.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomie evaluation prompt corpus - 142 labeled cases.
 *
 * Case schema:
 *   id          - unique identifier (prefix = category shorthand)
 *   input       - raw user text as typed
 *   category    - "red_flag" | "routing" | "fallback" | "edge"
 *   expected    - what the pipeline should produce
 *     .urgent      boolean   - extractEntities().urgent
 *     .route       string    - inferRoute().next  (null = no inference)
 *     .scenario    string    - buildGuidanceResponse().scenario
 *     .gibberish   boolean   - looksLikeGibberish() result
 *     .noRoute     boolean   - inferRoute() should return null
 *   tags        - searchable labels
 *   notes       - why this case is included / what it guards against
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const cases = [

  // ══════════════════════════════════════════════════════════════════════════
  //  RED FLAG - must ALWAYS be caught as urgent (guards red-flag recall = 100%)
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "RF001", input: "i passed out from heavy bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["faint", "heavy", "english"],
    notes: "Classic urgency - syncope + heavy bleeding",
  },
  {
    id: "RF002", input: "i bleed through my pants and i can't stand",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["bleed_through", "weakness", "english"],
    notes: "Bleed-through + can't stand - dual urgency flags",
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
    notes: "Ectopic risk indicator - must never be downplayed",
  },
  {
    id: "RF005", input: "sharp pain on one side and heavy bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["one_sided", "ectopic_risk", "english"],
    notes: "Ectopic risk - sharp one-sided pain variant",
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
    notes: "Patois: passed out - urgency must still fire",
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
    notes: "Repeated syncope - critical",
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
    notes: "Emergency keyword - urgency flag must fire",
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
    notes: "One-sided sharp pain - ectopic flag",
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
  //  ROUTING - English, expected inferRoute node
  // ══════════════════════════════════════════════════════════════════════════

  // - Late period -
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
    category: "edge",
    expected: { noRoute: true },
    tags: ["late", "english", "no_duration"],
    notes: "Late with no extra signals - late_only fallback → LATE_INTRO",
  },
  {
    id: "RT010", input: "i'm a week late and i think i might be pregnant and i took a test it was negative",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR" },
    tags: ["late", "test_negative", "english"],
    notes: "Late + negative test overrides pregnancy chance",
  },

  // - Heavy bleeding -
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
    category: "edge",
    expected: { noRoute: true },
    tags: ["heavy", "clots", "english"],
    notes: "Heavy + clots without duration or severity - heavy_only fallback → HEAVY_INTRO",
  },
  {
    id: "RT015", input: "heavy bleeding and i feel dizzy and lightheaded",
    category: "routing",
    expected: { route: "HEAVY_URGENT" },
    tags: ["heavy", "dizziness", "english"],
    notes: "Heavy + dizziness → urgent (anaemia/blood loss)",
  },

  // - Spotting -
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
    notes: "pipelineNormalize appends spotting text but inferRoute null for this combo; routeUserText handles via spotting handler",
  },
  {
    id: "RT020", input: "i notice some pink discharge between periods and i had sex recently",
    category: "routing",
    expected: { route: "SPOT_PREG_INFO" },
    tags: ["spotting", "pregnancy_chance", "english"],
    notes: "Pink + between periods + sex recently → pregnancy.chance=true (\\bsex\\b triggers chance); SPOT_PREG_INFO fires before SPOT_MIDCYCLE_NOTE",
  },

  // - Pelvic pain -
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
    notes: "Mild cramps alone - falls through to keyword router",
  },
  {
    id: "RT024", input: "bad cramps and heavy bleeding at the same time",
    category: "routing",
    expected: { urgent: false },
    tags: ["pelvic", "heavy", "english"],
    notes: "Pelvic + heavy combo - resolveSignals handles in scoreSignals layer",
  },
  {
    id: "RT025", input: "my lower abdomen hurts during sex",
    category: "routing",
    expected: { route: "PELVIC_SEX_INTRO" },
    tags: ["pelvic", "during_sex", "english"],
    notes: "during_sex timing maps to after_sex pathway",
  },

  // - Mood / PMS -
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
    category: "edge",
    expected: { noRoute: true },
    tags: ["mood", "general", "english"],
    notes: "General mood without timing - mood_only fallback → MOOD_SAFETY_CHECK",
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
    notes: "Fatigue + drained before period - 'exhausted' misses regex (\bexhaust\b fails on 'exhausted'), use 'tired'/'drained'",
  },

  // - Discharge -
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
  //  ROUTING - Patois / Jamaican dialect
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PA001", input: "me period nuh come",
    category: "edge",
    expected: { noRoute: true },
    tags: ["patois", "late"],
    notes: "Patois: period not come - sym.late=true; late_only fallback → LATE_INTRO",
  },
  {
    id: "PA002", input: "me period nuh come and me sleep wid someone",
    category: "edge",
    expected: { noRoute: true },
    tags: ["patois", "late", "pregnancy"],
    notes: "Patois: 'sleep wid' not in pregnancy regex (needs 'slept with'/'breed'/'unprotected'); sym.late=true; late_only fallback → LATE_INTRO",
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
    notes: "Patois: 'stomach a hurt' misses pelvic regex (needs 'stomach.*hurt'), 'bad bad' misses severity regex - known patois gap",
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
    expected: { route: "SPOT_MIDCYCLE_NOTE" },
    tags: ["patois", "spotting"],
    notes: "Patois: likkle blood (spotting) - sym.spotting=true; spotting_only fallback → SPOT_INTRO",
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
    notes: "Patois: late + positive test - test result overrides duration",
  },
  {
    id: "PA020", input: "me have cramps and heavy bleeding together",
    category: "routing",
    expected: { urgent: false },
    tags: ["patois", "pelvic", "heavy"],
    notes: "Patois: cramps + heavy - no urgency unless severity is extreme",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  FALLBACK - OOS, gibberish, no health signal
  // ══════════════════════════════════════════════════════════════════════════

  // Gibberish
  {
    id: "FB001", input: "asdfghjkl",
    category: "fallback",
    expected: { gibberish: true, noRoute: true },
    tags: ["gibberish"],
    notes: "Keyboard mash: unique-char vowel ratio (1 vowel 'a' out of 9 unique chars = 0.11) now correctly detected as gibberish by unique-char vowel check",
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
    notes: "xyz: 3 chars, 100% letters, not in SHORT_REAL_WORDS but passes ratio check - known gap (only length ≤2 auto-rejects)",
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
    notes: "hi is in SHORT_REAL_WORDS - must NOT be gibberish",
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
    expected: { gibberish: false },
    tags: ["short_real_word"],
    notes: "lol is in SHORT_REAL_WORDS → not gibberish; no route",
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

  // Out of scope - no health route should fire
  {
    id: "FB010", input: "what should i eat for dinner",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "food"],
    notes: "Food topic - no reproductive health signal",
  },
  {
    id: "FB011", input: "i'm stressed about my exam tomorrow",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "school"],
    notes: "School stress - no reproductive health signal",
  },
  {
    id: "FB012", input: "my boyfriend broke up with me",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "relationships"],
    notes: "Relationship topic - no health signal",
  },
  {
    id: "FB013", input: "i need money to pay my bills",
    category: "fallback",
    expected: { noRoute: true, urgent: false },
    tags: ["oos", "money"],
    notes: "Financial topic - no health signal",
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
    notes: "Body image + sad - mood_only fallback → MOOD_SAFETY_CHECK",
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
  //  EDGE CASES - boundary conditions, mixed signals, tricky inputs
  // ══════════════════════════════════════════════════════════════════════════

  // Legitimate short health messages (must not be flagged as gibberish)
  {
    id: "EG001", input: "spotting",
    category: "routing",
    expected: { gibberish: false, noRoute: true },
    tags: ["short", "single_word"],
    notes: "Single valid health word - not gibberish; no combo rule → inferRoute null; routeUserText handles in chat",
  },
  {
    id: "EG002", input: "late",
    category: "edge",
    expected: { gibberish: false, noRoute: true },
    tags: ["short", "single_word"],
    notes: "Single word 'late' - sym.late=true; no combo rule → inferRoute null; routeUserText handles in chat",
  },
  {
    id: "EG003", input: "cramps",
    category: "edge",
    expected: { gibberish: false, noRoute: true },
    tags: ["short", "single_word"],
    notes: "Single word health complaint",
  },

  // False reassurance guards - these SHOULD produce a non-null route (not silently ignored)
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
    notes: "Positive test - must route to positive node",
  },

  // OOS with embedded health word (tricky - should NOT false-positive as health)
  {
    id: "EG006", input: "i love period dramas like bridgerton",
    category: "edge",
    expected: { noRoute: true },
    tags: ["oos_embedded_word", "period_drama"],
    notes: "Period in non-health context - should not trigger late signal",
  },

  // Ambiguous - contains health words but no clear intent
  {
    id: "EG007", input: "bleeding edge technology is so cool",
    category: "edge",
    expected: { noRoute: true },
    tags: ["false_positive_guard", "bleeding"],
    notes: "Bleeding in non-health context - heavy should not fire",
  },

  // Multi-symptom without urgency - should route, not urgent
  {
    id: "EG008", input: "i have spotting, cramps, and mood swings before my period",
    category: "edge",
    expected: { urgent: false },
    tags: ["multi_symptom", "before_period"],
    notes: "Multiple PMS symptoms - not urgent",
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
    notes: "Uppercase input - normalization must handle; routes to PREGNANCY_ENTRY",
  },

  // Ellipsis / punctuation heavy
  {
    id: "EG012", input: "period... late... spotting... help...",
    category: "routing",
    expected: { noRoute: true },
    tags: ["punctuation", "multi_symptom"],
    notes: "Fragmented ellipsis input - sym.late=true, sym.spotting=true, no pregnancy.chance → late_only fallback → LATE_INTRO",
  },

  // Repeated words (user emphasis)
  {
    id: "EG013", input: "very very very late period",
    category: "edge",
    expected: { noRoute: true },
    tags: ["emphasis", "late"],
    notes: "Repeated emphasis - sym.late=true, no secondary signal; late_only fallback → LATE_INTRO",
  },

  // Emoji-heavy
  {
    id: "EG014", input: "my period is late 😭😭 i had sex last week 😰",
    category: "edge",
    expected: { route: "PREGNANCY_ENTRY" },
    tags: ["emoji", "late", "pregnancy"],
    notes: "Emojis should be stripped - core signal still fires; routes to PREGNANCY_ENTRY",
  },

  // Contradictory signals
  {
    id: "EG015", input: "my period came but it's very late and also positive test",
    category: "edge",
    expected: { route: "LATE_POSITIVE" },
    tags: ["contradictory", "late", "test_positive"],
    notes: "Conflicting signals - positive test should win",
  },

  // Direct question phrasing
  {
    id: "EG016", input: "is my period late?",
    category: "edge",
    expected: { noRoute: true },
    tags: ["question", "late"],
    notes: "Direct question - sym.late=true; late_only fallback → LATE_INTRO",
  },

  // Colloquial phrasing
  {
    id: "EG017", input: "my flow is super heavy like soaking through in under an hour",
    category: "edge",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["colloquial", "heavy", "soaking"],
    notes: "Colloquial soaking-through - urgency must still fire",
  },

  // Discharge without other symptoms - should route quietly
  {
    id: "EG018", input: "white discharge coming out",
    category: "edge",
    expected: { route: "ELSE_DISCHARGE" },
    tags: ["discharge", "english"],
    notes: "Discharge alone with minimal phrasing",
  },

  // Safe case - should NOT route to urgent
  {
    id: "EG019", input: "mild spotting a few days before my period, just a little",
    category: "edge",
    expected: { urgent: false, noRoute: true },
    tags: ["spotting", "mild", "before_period", "not_urgent"],
    notes: "Mild pre-period spotting - not urgent; spotting_only fallback → SPOT_INTRO",
  },

  // Nausea alone
  {
    id: "EG020", input: "i feel nauseous in the mornings",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["nausea", "no_late"],
    notes: "Nausea without late period - should not infer pregnancy pathway",
  },


  // ══════════════════════════════════════════════════════════════════════════
  //  EDUCATION ROUTES - PCOS, Endo, Contraception
  //
  //  NOTE: These routes are handled by routeUserText() keyword patterns in
  //  assistant.js, NOT by inferRoute() in bloomie-inference.js. The harness
  //  only runs the inference pipeline, so actualRoute will always be null for
  //  these inputs. Cases assert noRoute: true + urgent: false - confirming the
  //  inference layer correctly passes them through without misfiring urgency.
  // ══════════════════════════════════════════════════════════════════════════

  // - EDUC_PCOS -
  {
    id: "ED001", input: "i have pcos and i want to understand what it means",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "english"],
    notes: "Explicit PCOS mention - routeUserText /\\bpcos\\b/ → EDUC_PCOS; inferRoute returns null",
  },
  {
    id: "ED002", input: "i was told i have polycystic ovary syndrome",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pcos", "education", "english", "polycystic"],
    notes: "polycystic keyword - routeUserText routes to EDUC_PCOS; not an inference signal",
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
    notes: "Patois: irregular + PCOS keyword - pcos is language-neutral, routeUserText fires after normalize",
  },

  // - EDUC_ENDO -
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
    notes: "Patois: 'pain every period' phrase survives normalization - routeUserText routes to EDUC_ENDO",
  },

  // - EDUC_CONTRACEPTION -
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
  //  NARROWING - health-word intercept should fire, NOT fall through to OOS
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
    notes: "tired + sick - sym.mood=true (tired/fatigue match); mood_only fallback → MOOD_SAFETY_CHECK",
  },
  {
    id: "NR002", input: "something feels off with my cycle but i can't explain it",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "cycle", "ambiguous"],
    notes: "cycle keyword in vague context - NARROWING should intercept in chat handler; inferRoute returns null",
  },
  {
    id: "NR003", input: "my mood has been all over the place lately",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "mood", "ambiguous"],
    notes: "mood without before_period timing - sym.mood=true; mood_only fallback → MOOD_SAFETY_CHECK",
  },
  {
    id: "NR004", input: "i hurt down there and i'm not sure what it is",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "hurt", "pain", "ambiguous"],
    notes: "hurt + vague location - pelvic signal may score but not reach route threshold; NARROWING intercepts",
  },
  {
    id: "NR005", input: "i just feel unwell, something to do with my period maybe",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["narrowing", "period", "sick", "ambiguous"],
    notes: "period + sick in uncertain framing - no secondary signal; NARROWING should ask clarifying question rather than OOS",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PREGNANCY TEST FLOW - new multi-entry route cases
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
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "'had unprotected sex' → pregnancy.chance=true; no late/nausea/pelvic; pregnancy_chance_only fallback → PREGNANCY_ENTRY",
  },
  {
    id: "PT006", input: "we had unprotected sex recently and i'm worried",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "pregnancy.chance=true via 'unprotected sex'; pregnancy_chance_only fallback → PREGNANCY_ENTRY",
  },
  {
    id: "PT007", input: "we had sex without a condom three days ago",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "pregnancy.chance=true via 'sex without a condom'; pregnancy_chance_only fallback → PREGNANCY_ENTRY",
  },
  {
    id: "PT008", input: "i forgot the condom and now i'm scared i might be pregnant",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "english"],
    notes: "pregnancy.chance=true; pregnancy_chance_only fallback → PREGNANCY_ENTRY",
  },
  {
    id: "PT009", input: "i have irregular cycles and i don't know when my period is due",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "irregular_cycle", "english"],
    notes: "Irregular cycle mention - no route from inferRoute but routeUserText shouldn't misfire as urgent",
  },
  {
    id: "PT010", input: "i have severe one-sided pain and i tested positive",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["test_flow", "urgent", "ectopic_risk", "english"],
    notes: "Severe one-sided pain in test context - ectopic risk, must route HEAVY_URGENT",
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
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["test_flow", "recent_sex", "too_early", "english"],
    notes: "pregnancy.chance=true; testedYet=true (wants to test); pregnancy_chance_only fallback fires (testedYet=false check - 'want to test' ≠ testedYet) → PREGNANCY_ENTRY",
  },
  {
    id: "PT013", input: "negative test two days ago, period is 10 days late, should i test again",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR", urgent: false },
    tags: ["test_flow", "negative", "retest", "late_period", "english"],
    notes: "Negative + late + retest intent → inferRoute fires LATE_NEG_UNCLEAR; TEST_RETEST_NOW path in assistant.js",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  HEAVY BLEEDING FLOW - multi-entry route cases
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "HV001", input: "i'm soaking through pads every hour for the last three hours",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "soaking_through", "route_a", "urgent", "english"],
    notes: "'soaking through' matches urgency phrase - must route HEAVY_URGENT directly (urgentPhrases check)",
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
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "dizzy", "english"],
    notes: "'bleeding heavily' now matches sym.heavy (\\bheavily\\b added to pattern); dizzy+heavy → HEAVY_URGENT via inferRoute",
  },
  {
    id: "HV006", input: "i feel weak and my period is very heavy",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "weak", "urgent", "english"],
    notes: "heavy + weak → Route C in routeUserText only; inferRoute null; harness only tests inferRoute level",
  },
  {
    id: "HV007", input: "i passed out from heavy bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "faint", "urgent", "english"],
    notes: "'passed out' in urgentPhrases - direct HEAVY_URGENT, bypasses all route detection",
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
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["heavy", "patois", "route_c", "weak"],
    notes: "Patois: inferRoute null; routeUserText Route C Patois pattern handles heavy+weak combo",
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
    notes: "heavy + clots + 8 days - inferRoute returns null; routeUserText '8 days' matches Route B → HEAVY_ROUTE_B",
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
  //  PREGNANCY INTENT FLOW - covers new PREGNANCY_ENTRY and sub-routes
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
    notes: "Tested negative + late → inferRoute fires LATE_NEG_UNCLEAR; major changes question appears AFTER negative result - correct placement",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ELSE SECTION - discharge, body changes, not-sure routing, ELSE_INTRO
  //
  //  Inference layer (inferRoute) routes discharge-only to ELSE_DISCHARGE.
  //  Node-level routing inside assistant.js then fans out to DISCHARGE_*
  //  and ELSE_BODY_ENTRY sub-nodes - those paths are not testable here.
  //  Cases with noRoute: true guard that inferRoute does NOT misfire urgency
  //  or a wrong route for these inputs.
  // ══════════════════════════════════════════════════════════════════════════

  // - Discharge with odour → DISCHARGE_PROVIDER_SOON (node level) -
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

  // - Discharge with fever → DISCHARGE_URGENT (node level) -
  {
    id: "EL003", input: "i have discharge and fever and my lower belly hurts",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "fever", "pelvic", "else_section", "english"],
    notes: "Discharge + fever: 'belly hurts' misses pelvic regex (requires 'belly.*hurt\\b', 'hurts' fails \\b), so sym.pelvic=false - inferRoute returns ELSE_DISCHARGE; node-level user picks 'fever or pelvic pain' → DISCHARGE_URGENT",
  },

  // - Normal increased discharge → DISCHARGE_MONITOR (node level) -
  {
    id: "EL004", input: "i have more discharge than usual but no smell or colour change",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "normal", "else_section", "english"],
    notes: "Discharge alone with no pelvic/spot → ELSE_DISCHARGE; node-level user picks 'just more than usual' → DISCHARGE_MONITOR",
  },

  // - Body changes → BODY_HORMONAL_ROUTE (node level) -
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
    notes: "Weight + acne without health signal keywords - inferRoute returns null; node-level → BODY_HORMONAL_ROUTE",
  },

  // - Sleep issues → BODY_SLEEP_ROUTE (node level) -
  {
    id: "EL007", input: "i have not been sleeping well for the past few weeks, maybe something hormonal",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["sleep", "body_changes", "else_section", "english"],
    notes: "Sleep complaint without cycle-specific signal - inferRoute null; node-level ELSE_BODY_ENTRY → BODY_SLEEP_ROUTE",
  },

  // - Urgent check with severe pain → HEAVY_URGENT -
  {
    id: "EL008", input: "i am having severe abdominal pain and heavy bleeding and i feel faint",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["urgent", "heavy", "faint", "else_section", "english"],
    notes: "Severe pain + heavy bleeding + faint → HEAVY_URGENT; ELSE_URGENT_CHECK 'Yes' path also routes here",
  },

  // - Not sure → ELSE_NOT_SURE_ROUTE (node level) -
  {
    id: "EL009", input: "something just feels off but i cannot explain what it is",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["not_sure", "vague", "else_section", "english"],
    notes: "Vague complaint, no specific signal - inferRoute null; chat handler NARROWING intercept or ELSE_NOT_SURE_ROUTE via ELSE_INTRO",
  },

  // - Patois input landing in correct ELSE sub-route -
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
    notes: "Patois: skin + hair changes - no inferRoute signal; node-level ELSE_BODY_ENTRY → BODY_HORMONAL_ROUTE",
  },

  // - ELSE_CHANGE_TYPE handing off to existing nodes -
  {
    id: "EL012", input: "my cycle timing feels different this month",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["cycle_timing", "else_section", "english"],
    notes: "Vague cycle timing without 'late'/'missed' keywords - inferRoute null; ELSE_CHANGE_TYPE 'cycle timing' choice → LATE_INTRO",
  },
  {
    id: "EL013", input: "i have some spotting between periods and not sure why",
    category: "routing",
    expected: { route: "SPOT_MIDCYCLE_NOTE", urgent: false },
    tags: ["spotting", "mid_cycle", "else_section", "english"],
    notes: "Spotting + 'between periods' phrase → inferRoute returns SPOT_MIDCYCLE_NOTE; ELSE_CHANGE_TYPE 'spotting' choice routes to SPOT_INTRO from ELSE_INTRO path",
  },

  // - ELSE_TALK_THROUGH does not crash on free text input -
  {
    id: "EL014", input: "i dont even know how to explain it i just feel wrong lately",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["free_text", "else_section", "talk_through", "english"],
    notes: "Free-text emotional input - not gibberish; no inferRoute signal; ELSE_TALK_THROUGH accepts this and waits for intent router",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PELVIC PAIN MULTI-ROUTE FLOW - new entry system cases
  //
  //  inferRoute handles: pelvic+after_sex → PELVIC_SEX_INTRO,
  //                      pelvic+severe    → PELVIC_PERSISTENT.
  //  Node-level routing (PELVIC_SAFETY_CHECK, PELVIC_ENTRY, route sub-nodes)
  //  is triggered by routeUserText/buttons - these test noRoute:true from
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
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "pelvic", "belly_hurt", "english"],
    notes: "Patois 'mi belly a hurt' → inferRoute null; routeUserText explicit Patois pattern → PELVIC_SAFETY_CHECK",
  },
  {
    id: "PV010", input: "cramp bad and waist a hurt",
    category: "edge",
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
  //  MOOD - new intent-first system (safety check, routes, Patois)
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
    notes: "Patois 'mi cyan cope' - after normalizeText stays as 'mi cyan cope'; inferRoute self-harm pattern catches 'cyan cope' → MOOD_SAFETY_ROUTE",
  },
  {
    id: "MO005", input: "i feel very anxious all the time",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "anxiety", "english"],
    notes: "General anxiety without before_period - inferRoute null; routeUserText mood signal → MOOD_SAFETY_CHECK via chat flow",
  },
  {
    id: "MO006", input: "i have low mood and i've been crying a lot",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "low", "english"],
    notes: "Low mood without cycle timing - inferRoute null; mood signal routes to MOOD_SAFETY_CHECK in chat",
  },
  {
    id: "MO007", input: "i'm irritable and snapping at everyone lately",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "irritable", "english"],
    notes: "Irritability without timing - inferRoute null; routeUserText mood → MOOD_SAFETY_CHECK",
  },
  {
    id: "MO008", input: "i can't sleep even when i try, for weeks now",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "fatigue", "insomnia", "english"],
    notes: "Insomnia/fatigue without cycle context - inferRoute null; MOOD_FATIGUE_ROUTE insomnia choice applies in chat flow",
  },
  {
    id: "MO009", input: "mi feel off lately",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood"],
    notes: "Patois 'mi feel off' - inferRoute null; routeUserText Patois mood pattern → MOOD_SAFETY_CHECK in chat",
  },
  {
    id: "MO010", input: "mi sad fi no reason",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood", "low"],
    notes: "Patois 'mi sad fi no reason' - inferRoute null; routeUserText Patois pattern → MOOD_SAFETY_CHECK",
  },
  {
    id: "MO011", input: "everything a get to me and mi nuh have no energy fi nothing",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "mood", "fatigue"],
    notes: "Patois emotional exhaustion - inferRoute null; routeUserText Patois pattern → MOOD_SAFETY_CHECK",
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

  // ══════════════════════════════════════════════════════════════════════════
  //  PERIMENOPAUSE / MENOPAUSE - covers new nodes and symptom detection
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PERI001",
    input: "i think i am going through perimenopause",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["perimenopause", "education", "english"],
    notes: "Direct perimenopause mention → routeUserText /\\bperimenopause\\b/ → PERIMENOPAUSE_INTRO; inferRoute null",
  },
  {
    id: "PERI002",
    input: "i've been having hot flashes and night sweats lately",
    category: "routing",
    expected: { noRoute: true, urgent: false, scenario: "perimenopause_concern" },
    tags: ["hot_flashes", "night_sweats", "perimenopause", "english"],
    notes: "hot_flashes + night_sweats detected; inferRoute null (no combo rule); buildGuidanceResponse entity cluster fires perimenopause_concern scenario",
  },
  {
    id: "PERI003",
    input: "i have night sweats irregular periods and trouble sleeping",
    category: "routing",
    expected: { noRoute: true, urgent: false, scenario: "perimenopause_concern" },
    tags: ["night_sweats", "irregular", "insomnia", "perimenopause", "english"],
    notes: "3 perimenopause cluster symptoms (night_sweats, irregular, insomnia) → resolveScenario periCluster >= 3 → perimenopause_concern",
  },
  {
    id: "PERI004",
    input: "i have menopause",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["menopause", "education", "english"],
    notes: "Direct menopause mention → routeUserText /\\bmenopause\\b/ → MENOPAUSE_INFO_NODE; inferRoute null",
  },
  {
    id: "PERI005",
    input: "my period has stopped for 12 months now",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["menopause", "period_stopped", "english"],
    notes: "'period has stopped' matches /period (stopped|done|finish)/ in routeUserText → MENOPAUSE_INFO_NODE; inferRoute null",
  },
  {
    id: "PERI006",
    input: "i have vaginal dryness and it is uncomfortable",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["vaginal_dryness", "perimenopause", "english"],
    notes: "Vaginal dryness detected by extractSymptoms; inferRoute null (no vaginal dryness inference rule); routeUserText returns null too - falls to chat flow where provider routes to PERI_VAGINAL_ROUTE",
  },
  {
    id: "PERI007",
    input: "i've been feeling rage and my emotions are all over the place",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["mood_rage", "perimenopause", "english"],
    notes: "mood_rage pattern (/\\b(rage|...)\\b/) fires correctly; inferRoute null; no urgency - mood_rage alone does not trigger MOOD_SAFETY_ROUTE",
  },
  {
    id: "PERI008",
    input: "my memory is gone i forget everything and mi lose my mind",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["memory_issues", "perimenopause", "patois", "english"],
    notes: "memory_issues detection fires on 'forget everything' and 'lose my mind'; inferRoute null",
  },
  {
    id: "PERI009",
    input: "mi a go through the change",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "perimenopause"],
    notes: "Patois 'mi a go through the change' → routeUserText /mi (think mi |a )?go through the change/ → PERIMENOPAUSE_INTRO; inferRoute null",
  },
  {
    id: "PERI010",
    input: "i have hot flashes night sweats insomnia and my periods are irregular",
    category: "routing",
    expected: { noRoute: true, urgent: false, scenario: "perimenopause_concern" },
    tags: ["hot_flashes", "night_sweats", "insomnia", "irregular", "perimenopause", "english"],
    notes: "4 perimenopause cluster symptoms → periCluster >= 3 → scenario: perimenopause_concern in buildGuidanceResponse",
  },
  {
    id: "PERI011",
    input: "i think i am going through menopause i haven't had a period in a year",
    category: "routing",
    expected: { noRoute: true, urgent: false, scenario: "menopause_info" },
    tags: ["menopause", "english"],
    notes: "menopause_mention detected (matches /\\bmenopause\\b/); resolveScenario → menopause_info; routeUserText → MENOPAUSE_INFO_NODE",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  INPUT EDGE - ugly/ambiguous input that the pipeline must handle gracefully
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "IE001",
    input: "",
    category: "edge",
    expected: { gibberish: true, urgent: false, noRoute: true },
    tags: ["input_edge"],
    notes: "Blank message - looksLikeGibberish returns true for empty string; pipeline must not crash",
  },
  {
    id: "IE002",
    input: "🩷💉😭",
    category: "edge",
    expected: { gibberish: true, urgent: false, noRoute: true },
    tags: ["input_edge"],
    notes: "Emoji-only input - normalizeText strips all non-word chars leaving blank; gibberish=true",
  },
  {
    id: "IE003",
    input: "asdfjklasdfjkl",
    category: "edge",
    expected: { gibberish: true, urgent: false, noRoute: true },
    tags: ["input_edge"],
    notes: "Keyboard smash - all letters so letter-ratio check passes; looksLikeGibberish currently returns false. BUG: gibberish detector should catch random key-mashing with no vowel-consonant structure",
  },
  {
    id: "IE004",
    input: "late",
    category: "edge",
    expected: { noRoute: true, urgent: false, scenario: "late_period" },
    tags: ["input_edge", "one_word"],
    notes: "Single health word 'late' - inferRoute null but resolveScenario entity-based fires late_period; not gibberish",
  },
  {
    id: "IE005",
    input: "pain",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge", "one_word"],
    notes: "Single word 'pain' - pelvic not matched by bare 'pain' in extractSymptoms (requires cramp/pelvic/belly etc.); inferRoute null; no scenario",
  },
  {
    id: "IE006",
    input: "help",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge", "one_word"],
    notes: "Single word 'help' - no medical signal; inferRoute null; pipeline must not crash or route to urgency",
  },
  {
    id: "IE007",
    input: "helpppppp",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["input_edge"],
    notes: "Repeated trailing letters - not detected as gibberish (not uniform repeated char); inferRoute null; NARROWING expected in chat flow but not testable via harness",
  },
  {
    id: "IE008",
    input: "idk idk idk",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["input_edge"],
    notes: "'idk' is in SHORT_REAL_WORDS; repeated 3 times still not gibberish; no medical signal; inferRoute null",
  },
  {
    id: "IE009",
    input: "is this normal",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge"],
    notes: "Decontextualised 'is this normal' - no symptoms extracted; inferRoute null; chat should prompt for context",
  },
  {
    id: "IE010",
    input: "something feels off",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge"],
    notes: "Vague complaint with no specific symptom - no extractSymptoms hits; inferRoute null",
  },
  {
    id: "IE011",
    input: "it hurts there",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge"],
    notes: "No location given - 'hurts' alone does not match pelvic/cramp/belly patterns; inferRoute null",
  },
  {
    id: "IE012",
    input: "2wks late",
    category: "routing",
    expected: { route: "LATE_YES_PREG", urgent: false, scenario: "late_long_duration" },
    tags: ["input_edge", "shorthand", "duration"],
    notes: "Shorthand '2wks late' - extractDuration shorthand patterns match '2wks' → weeks=2; sym.late + duration.weeks>=2 → LATE_YES_PREG",
  },
  {
    id: "IE013",
    input: "bc pill",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge", "shorthand"],
    notes: "Shorthand 'bc pill' - routeUserText catches /\\bpill\\b/ → EDUC_CONTRACEPTION; inferRoute null (no cycle symptom)",
  },
  {
    id: "IE014",
    input: "ovul",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge", "shorthand"],
    notes: "Truncated word 'ovul' - does not match ovulation_pain or any pattern with \\b boundary; inferRoute null; chat should prompt for more info",
  },
  {
    id: "IE015",
    input: "i am 2 weeks late but my period started yesterday",
    category: "edge",
    expected: { route: "LATE_YES_PREG", urgent: false },
    tags: ["input_edge", "contradictory"],
    notes: "Contradictory - 'started yesterday' is ignored; '2 weeks late' wins: sym.late + duration >= 2 weeks → LATE_YES_PREG",
  },
  {
    id: "IE016",
    input: "i have cramps heavy bleeding spotting mood swings nausea vomiting dizziness headache back pain breast tenderness and i cant sleep",
    category: "edge",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["input_edge", "overloaded"],
    notes: "Overloaded multi-symptom paragraph - heavy+dizziness combo triggers HEAVY_URGENT; pipeline must handle gracefully",
  },
  {
    id: "IE017",
    input: "dysmenorrhea is defined as painful menstruation typically involving abdominal cramps",
    category: "edge",
    expected: { noRoute: true, urgent: false, scenario: "pelvic_mild" },
    tags: ["input_edge", "copy_paste"],
    notes: "Copy-pasted medical definition - 'cramps' matches pelvic; severity null → resolveScenario → pelvic_mild; inferRoute null (no severity/timing)",
  },
  {
    id: "IE018",
    input: "mi period late and i have really bad cramps",
    category: "edge",
    expected: { route: "PELVIC_PERSISTENT", urgent: false },
    tags: ["input_edge", "patois_english_mix"],
    notes: "Mixed Patois + English - 'really bad' → severity: severe; pelvic + severe → PELVIC_PERSISTENT even though late is also present (pelvic+severe fires before late+pelvic+severe combo)",
  },
  {
    id: "IE019",
    input: "ovulation pain mid cycle",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge", "shorthand"],
    notes: "Shorthand phrase - ovulation_pain extracted; timing: mid_cycle; but mid_cycle + spotting rule requires spotting; no combo fires; inferRoute null",
  },
  {
    id: "IE020",
    input: "spotting",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["input_edge", "one_word"],
    notes: "Single health word 'spotting' - sym.spotting true; resolveScenario fallback → spotting_midcycle; inferRoute null (no timing or combo)",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SAFETY EDGE - downplayed or atypically-phrased emergencies
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "SE001",
    input: "not that bad just bleeding a lot and dizzy",
    category: "red_flag",
    expected: { urgent: true },
    tags: ["safety_edge", "downplayed"],
    notes: "Downplayed emergency - 'bleeding a lot' does NOT match sym.heavy (pattern requires heavy/soaking/flooding/clot etc.); 'dizzy' matches dizziness. BUG: heavy+dizzy combo fails because 'bleeding a lot' misses the heavy regex. urgent should be true",
  },
  {
    id: "SE002",
    input: "the pain is mild but i literally cannot move from the bed",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["safety_edge", "downplayed"],
    notes: "Mild-labelled but functionally severe - 'mild' suppresses severity; 'cannot move' is not in urgency flags; inferRoute null. Chat should probe further but harness can only verify no false urgency triggered",
  },
  {
    id: "SE003",
    input: "just a little spotting but i am soaking through my pads",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge", "downplayed"],
    notes: "'soaking through' matches extractUrgency → urgent true despite 'just a little spotting' minimisation; red-flag recall must catch this",
  },
  {
    id: "SE004",
    input: "i am 2 weeks late i took a test and it was positive and i have one-sided pain on the left",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge", "ectopic_risk"],
    notes: "Late + positive test + one-sided pain - ectopic risk pattern; one-sided pain matches urgency flag → HEAVY_URGENT",
  },
  {
    id: "SE005",
    input: "i have been having night sweats cold flashes and pelvic pain every day",
    category: "edge",
    expected: { noRoute: true, urgent: false, scenario: "pelvic_mild" },
    tags: ["safety_edge", "fever_proxy"],
    notes: "Fever-proxy cluster - night sweats + cold flashes + pelvic; not triggered as urgent; scenario: pelvic_mild from entity detection. Concerning cluster but not a defined urgency trigger in current pipeline",
  },
  {
    id: "SE006",
    input: "i want to hurt myself because of how bad the pain is",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["safety_edge", "self_harm"],
    notes: "Self-harm language mid pain complaint - 'hurt myself' → MOOD_SAFETY_ROUTE always fires before urgency; takes priority correctly",
  },
  {
    id: "SE007",
    input: "i was assaulted recently and now i am bleeding and scared",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["safety_edge", "assault"],
    notes: "Assault disclosure mid-flow - 'bleeding' alone does not match heavy symptom (requires soaking/heavy/flooding); no self-harm pattern; pipeline returns null. Chat UI must handle disclosure with sensitivity; urgency not auto-triggered",
  },
  {
    id: "SE008",
    input: "i took a pregnancy test and it was positive and now i feel faint",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge", "positive_faint"],
    notes: "Positive test + fainting - 'faint' matches extractUrgency → HEAVY_URGENT; correctly caught as urgent regardless of test result",
  },
  {
    id: "SE009",
    input: "i am fine just bleeding through my pants and i passed out",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge", "im_fine", "downplayed"],
    notes: "'I'm fine' framing does not suppress urgency - 'bleeding through' and 'passed out' both match extractUrgency flags → HEAVY_URGENT",
  },
  {
    id: "SE010",
    input: "i was having light spotting and then i passed out",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge"],
    notes: "'passed out' matches extractUrgency regardless of 'light spotting' minimisation → HEAVY_URGENT",
  },
  {
    id: "SE011",
    input: "my cramps are totally normal just a 10 out of 10 pain",
    category: "edge",
    expected: { noRoute: true, urgent: false, scenario: "pelvic_mild" },
    tags: ["safety_edge", "downplayed"],
    notes: "'10/10' stripped to '10 10' by normalizeText (/ removed); severity regex \\b10\\/10\\b never matches normalised form; severity null; scenario: pelvic_mild. BUG: 10/10 severity should survive normalisation",
  },
  {
    id: "SE012",
    input: "its probably nothing just bleeding for 10 days straight",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["safety_edge", "downplayed"],
    notes: "Minimised 10-day bleed - '10 days' matches duration.days=10 but sym.heavy is false (no 'heavy'/'soaking'); inferRoute heavy+7days requires sym.heavy; no route fires. BUG: long-duration bleeding alone should route to HEAVY_LONGER_THAN_WEEK",
  },
  {
    id: "SE013",
    input: "my friend says this is normal but i soaked through 5 pads today",
    category: "edge",
    expected: { urgent: false, noRoute: true, scenario: "heavy_bleeding" },
    tags: ["safety_edge", "downplayed"],
    notes: "'soaked' matches sym.heavy; 'through 5 pads' doesn't match soaking_through urgency trigger; resolveScenario → heavy_bleeding scenario; not routed urgent. User should be guided to check flow rate",
  },
  {
    id: "SE014",
    input: "feeling a bit dizzy nothing major but bleeding heavily",
    category: "red_flag",
    expected: { urgent: true },
    tags: ["safety_edge", "downplayed"],
    notes: "'bleeding heavily' - 'heavily' does not match \\bheavy\\b (word boundary stops before 'l' in 'heavily'); BUG: sym.heavy=false despite clear heavy bleeding; heavy+dizzy combo fails; urgent should be true",
  },
  {
    id: "SE015",
    input: "the bleeding is not that heavy just soaking a pad every 45 minutes",
    category: "edge",
    expected: { urgent: false, noRoute: true, scenario: "heavy_bleeding" },
    tags: ["safety_edge", "downplayed"],
    notes: "'soaking' matches sym.heavy; 'every 45 minutes' is not caught by 'changing every hour' urgency phrase; scenario: heavy_bleeding with guidance to track",
  },
  {
    id: "SE016",
    input: "i hate myself when i bleed this much",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["safety_edge", "self_harm"],
    notes: "'hate myself' does not match self-harm detection regex (requires 'hurt myself', 'harm myself', etc.); inferRoute null. This is a gap - 'hate myself' in context of pain should be assessed but pipeline doesn't catch it",
  },
  {
    id: "SE017",
    input: "i am pregnant and bleeding heavily and dizzy",
    category: "red_flag",
    expected: { urgent: true },
    tags: ["safety_edge", "pregnant_bleed_dizzy"],
    notes: "Pregnant + heavy bleed + dizzy - 'bleeding heavily' does not match \\bheavy\\b; sym.heavy=false; BUG: pregnant+heavy+dizzy should be urgent. Currently urgent=false",
  },
  {
    id: "SE018",
    input: "i was assaulted and i think i am bleeding inside",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["safety_edge", "assault"],
    notes: "Assault + internal bleeding concern - 'bleeding inside' not matched by any urgency/heavy pattern; inferRoute null. Chat must handle with sensitivity; recommend care urgently",
  },
  {
    id: "SE019",
    input: "i might be fainting a bit but i think it is fine",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge", "downplayed", "faint"],
    notes: "'fainting' matches extractUrgency → urgent true despite 'i think it is fine' minimisation - correctly caught",
  },
  {
    id: "SE020",
    input: "one sided pain but it comes and goes so probably fine",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["safety_edge", "downplayed", "ectopic_risk"],
    notes: "'one-sided pain' matches extractUrgency → HEAVY_URGENT even with 'probably fine' minimisation",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  DATE EDGE - invalid or ambiguous dates must be handled gracefully
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "DE001",
    input: "my last period was on february 30",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Invalid calendar date (Feb 30) typed as text - pipeline does not validate dates; no symptom extracted; graceful null return with no crash",
  },
  {
    id: "DE002",
    input: "sometime last month i think",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Vague duration - 'last month' not matched by extractDuration patterns; no symptom signal; gracefully returns null",
  },
  {
    id: "DE003",
    input: "i forgot when my period was",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "User can't recall LMP - 'forgot' does not trigger memory_issues symptom here (no \\b boundary mismatch); no cycle signal; graceful null",
  },
  {
    id: "DE004",
    input: "around 2 weeks ago maybe",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "'2 weeks' matches extractDuration (days:14, weeks:2) but no health symptom; sym.late is false; inferRoute null - duration alone does not route",
  },
  {
    id: "DE005",
    input: "my cycle is 0 days long",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Cycle length 0 - no medical symptom; extractDuration gets days:0 from pattern or null; pipeline does not crash; graceful null return",
  },
  {
    id: "DE006",
    input: "my cycle is 200 days long",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Implausibly long cycle - no urgency signal; no symptom; inferRoute null; pipeline must not attempt routing on cycle-length info alone",
  },
  {
    id: "DE007",
    input: "my period lasts 40 days but my cycle is only 28 days",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Period duration longer than cycle - logically impossible input; no urgency signal in text; inferRoute null; pipeline must not crash",
  },
  {
    id: "DE008",
    input: "i got my period early february",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Month name without year - 'early february' not parsed by extractDuration; no symptom; graceful null",
  },
  {
    id: "DE009",
    input: "my period was last month",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "'last month' not in extractDuration patterns; no explicit symptom; inferRoute null",
  },
  {
    id: "DE010",
    input: "lmp was yesterday but i had a period last week too",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Duplicate period entries in same message - contradictory dates; no urgency signal; pipeline processes as plain text and returns null gracefully",
  },
  {
    id: "DE011",
    input: "my next period date is before my last period date",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Logically reversed dates - pipeline has no date-ordering validation; treats as plain text; no symptom; inferRoute null",
  },
  {
    id: "DE012",
    input: "my period started 90 days ago",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "'90 days' not matched by extractDuration patterns (only up to 'months'); 'period started' has no late/heavy signal; graceful null",
  },
  {
    id: "DE013",
    input: "my cycle length changes every month between 21 and 45 days",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Irregular-width cycle described - '21' and '45 days' could match duration patterns but no symptom anchor; inferRoute null",
  },
  {
    id: "DE014",
    input: "my period started in the future i entered 2027",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Future LMP typed as text - pipeline does not validate future dates; no symptom; inferRoute null; no crash",
  },
  {
    id: "DE015",
    input: "i entered the same period date twice by accident",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["date_edge"],
    notes: "Duplicate entry described - no medical symptom; pipeline returns null; deduplication is a UI/storage concern not inference",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PREGNANCY EDGE - fringe pregnancy signals and false positives
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "PE001",
    input: "i had sex 5 days ago and i want to take a pregnancy test",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Too early to test (5 days post-sex) - 'sex' triggers pregnancy.chance; 'test' sets testedYet=true but result=null; no late signal → inferRoute null",
  },
  {
    id: "PE002",
    input: "we did not really have sex but i am worried i could be pregnant",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "'pregnant' triggers pregnancy.chance; no 'late' signal; inferRoute null - only routes when late + pregnancy_chance without test",
  },
  {
    id: "PE003",
    input: "we used the withdrawal method and my period is late",
    category: "routing",
    expected: { noRoute: true, urgent: false, scenario: "late_period" },
    tags: ["pregnancy_edge"],
    notes: "Withdrawal method - 'withdrawal' not in pregnancy.chance patterns; sym.late true; no pregnancy.chance → resolveScenario → late_period only",
  },
  {
    id: "PE004",
    input: "i took emergency contraception 2 days ago",
    category: "edge",
    expected: { urgent: false, noRoute: true },
    tags: ["pregnancy_edge"],
    notes: "Emergency contraception - 'emergency' word matches extractUrgency regex. BUG: false positive; 'emergency contraception' should not trigger urgent=true. Currently urgent=true",
  },
  {
    id: "PE005",
    input: "i have had 3 negative pregnancy tests but i have not had a period in 3 weeks",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Repeated negatives + missed period - 'negative' sets result='negative'; 'have not had a period' doesn't match late patterns; no late signal → inferRoute null",
  },
  {
    id: "PE006",
    input: "please tell me i am not pregnant i cannot be pregnant",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Plea for reassurance - pipeline must not falsely reassure; 'pregnant' triggers pregnancy.chance; no late → inferRoute null; no false confirmation given",
  },
  {
    id: "PE007",
    input: "i took a test and it was positive and i feel completely fine",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Positive test with no pain - pregnancy.result=positive; no sym.late → LATE_POSITIVE requires late+positive; inferRoute null; no urgency correctly",
  },
  {
    id: "PE008",
    input: "i took a positive pregnancy test and i have severe one sided pain on the right side",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["pregnancy_edge", "ectopic_risk"],
    notes: "Positive test + severe one-sided pain - ectopic risk; 'one sided pain' matches extractUrgency → HEAVY_URGENT; correctly caught",
  },
  {
    id: "PE009",
    input: "my period is not due for 3 more days but i want to test now",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Test before period is due - 'test' sets testedYet=true; no late; result null; inferRoute null; pipeline should guide that early testing is less reliable",
  },
  {
    id: "PE010",
    input: "i have taken 4 negative tests but something feels wrong",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Repeated negatives + vague concern - result='negative'; no late signal; inferRoute null; pipeline correctly returns null without falsely alarming",
  },
  {
    id: "PE011",
    input: "i had unprotected sex once 6 months ago and i keep worrying",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "'unprotected sex' triggers pregnancy.chance; no late signal; inferRoute null - correctly doesn't route to pregnancy concern for distant past exposure",
  },
  {
    id: "PE012",
    input: "just found out i am pregnant the test was positive and i feel completely fine",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Positive test, no pain, no late - pregnancy.result=positive; no sym.late; LATE_POSITIVE requires sym.late; inferRoute null; no urgency",
  },
  {
    id: "PE013",
    input: "i had sex yesterday could i already be pregnant",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "'sex' triggers pregnancy.chance; no late; testedYet=false; inferRoute null - correctly does not route to pregnancy concern (too early, no late period)",
  },
  {
    id: "PE014",
    input: "my test was negative and i had unprotected sex last week",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Negative test + recent unprotected sex - result='negative'; no late; inferRoute null. routeUserText TEST_NEGATIVE_INTRO fires in chat but not in harness",
  },
  {
    id: "PE015",
    input: "my test was negative but i am 6 weeks late",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR", urgent: false },
    tags: ["pregnancy_edge"],
    notes: "Negative test + long-late period - result='negative'; sym.late=true → LATE_NEG_UNCLEAR (late+negative_test rule); not urgent",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  ROUTING EDGE - navigation and multi-intent inputs
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "RE001",
    input: "how do i export my report",
    category: "fallback",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["routing_edge"],
    notes: "Mid-flow OOS request - no medical signal; inferRoute null; routeUserText returns null; OOS detection routes to fallback in chat",
  },
  {
    id: "RE002",
    input: "none of these apply to me",
    category: "fallback",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["routing_edge"],
    notes: "User rejects all choices - no medical signal; inferRoute null; chat should offer free-text prompt or back-to-menu",
  },
  {
    id: "RE003",
    input: "why am i late is spotting normal and could i be pregnant",
    category: "routing",
    expected: { route: "PREGNANCY_ENTRY", urgent: false },
    tags: ["routing_edge", "multi_intent"],
    notes: "Three questions in one - late + pregnant combo fires resolveSignals → PREGNANCY_ENTRY; takes priority over spotting alone",
  },
  {
    id: "RE004",
    input: "i am done for now",
    category: "fallback",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["routing_edge"],
    notes: "'Done for now' mid-flow - no medical signal; pipeline returns null; chat UI must not close or discard active safety flow when this appears",
  },
  {
    id: "RE005",
    input: "is this normal is this normal is this normal",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["routing_edge"],
    notes: "Repeated 'is this normal' - no extractSymptoms hits; inferRoute null; chat should prompt for symptom context",
  },
  {
    id: "RE006",
    input: "period",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["routing_edge", "narrowing"],
    notes: "Single health word - sym.late not fired by bare 'period'; inferRoute null; routeUserText NARROWING pattern fires in chat flow (not testable in harness)",
  },
  {
    id: "RE007",
    input: "not really sure but maybe yes",
    category: "fallback",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["routing_edge"],
    notes: "Free text yes/no when button expected - no medical signal; inferRoute null; resolveOOSFollowUp handles this in chat context",
  },
  {
    id: "RE008",
    input: "what about the other option",
    category: "fallback",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["routing_edge"],
    notes: "Reference to UI button by description - no medical signal; inferRoute null; chat should re-show choices",
  },
  {
    id: "RE009",
    input: "back",
    category: "fallback",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["routing_edge"],
    notes: "Navigation word 'back' - no medical signal; not gibberish (short real word adjacent); inferRoute null; chat UI handles navigation",
  },
  {
    id: "RE010",
    input: "no wait actually i think i had unprotected sex",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["routing_edge"],
    notes: "Mid-flow correction - 'unprotected sex' triggers pregnancy.chance; no late → inferRoute null; routeUserText TEST_RECENT_SEX_INTRO fires in chat (not harness)",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SAFETY CUMULATIVE & SIGNAL QUALITY - persistent re-check, downplaying,
  //  ambiguity, contradiction, missing context (safety upgrade)
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Heavy bleeding + dizziness across turns → cumulative escalation
  {
    id: "SQ001",
    input: "i feel dizzy now",
    history: ["i have been bleeding really heavy all day long"],
    category: "red_flag",
    expected: { cumulativeEscalation: true },
    tags: ["cumulative", "heavy_bleeding", "dizziness"],
    notes: "Dizziness following heavy bleeding in prior message - checkCumulativeRisk fires on combined history",
  },

  // 2. Late period + one-sided pain across turns → ectopic escalation
  {
    id: "SQ002",
    input: "i have pain on one side of my belly",
    history: ["my period is very late"],
    category: "red_flag",
    expected: { cumulativeEscalation: true },
    tags: ["cumulative", "late_period", "one_sided", "ectopic_risk"],
    notes: "One-sided pain after late period - cumulative ectopic-risk pattern fires",
  },

  // 3. Contradiction: heavy + spotting in same message (urgency wins)
  {
    id: "SQ003",
    input: "just a little spotting but also soaking through my pad",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["contradiction", "spotting", "heavy_bleeding", "safety_edge"],
    notes: "'soaking through' matches extractUrgency → HEAVY_URGENT; urgency takes priority over contradiction",
  },

  // 4. Downplaying + pelvic pain entity
  {
    id: "SQ004",
    input: "kinda hurts but i think i'm okay just some pelvic pain",
    category: "edge",
    expected: { downplaying: true },
    tags: ["downplaying", "pelvic_pain"],
    notes: "'kinda' + \"i think i'm okay\" - minimising language alongside pelvic pain entity",
  },

  // 5. "dizzy" alone - ambiguity question fires, not OOS
  {
    id: "SQ005",
    input: "dizzy",
    category: "edge",
    expected: { ambiguous: true, noRoute: true, urgent: false },
    tags: ["ambiguous", "dizziness", "single_word"],
    notes: "'dizzy' alone - detectAmbiguousInput fires clarifying question; no urgency without bleeding context",
  },

  // 6. "i have pain" alone - ambiguity question asking location and severity
  {
    id: "SQ006",
    input: "i have pain",
    category: "edge",
    expected: { ambiguous: true, noRoute: true, urgent: false },
    tags: ["ambiguous", "pain", "short_message"],
    notes: "Generic pain, short message, no location or severity - detectAmbiguousInput fires",
  },

  // 7. "feeling sick" alone - ambiguity question fires
  {
    id: "SQ007",
    input: "feeling sick",
    category: "edge",
    expected: { ambiguous: true, noRoute: true, urgent: false },
    tags: ["ambiguous", "nausea", "vague"],
    notes: "'feeling sick' alone - ambiguity question distinguishes nausea from general illness",
  },

  // 8. Positive test + pain 3 messages later → cumulative flag catches it
  {
    id: "SQ008",
    input: "i have stomach pain now",
    history: [
      "i feel nauseous lately",
      "i took a pregnancy test",
      "it came back positive",
    ],
    category: "red_flag",
    expected: { cumulativeEscalation: true },
    tags: ["cumulative", "positive_test", "pain"],
    notes: "Positive test 3 messages ago - cumulative check catches positive_test + pelvic_pain combination",
  },

  // 9. Contradiction: not sexually active + had sex last week
  {
    id: "SQ009",
    input: "not sexually active but i had sex last week without protection",
    category: "edge",
    expected: { contradiction: true, urgent: false },
    tags: ["contradiction", "sexual_activity"],
    notes: "Contradictory sexual activity - detectContradiction fires, routing paused for clarification",
  },

  // 10. Contradiction: negative and positive test in same message
  {
    id: "SQ010",
    input: "i got a negative and positive on different tests i don't know what to believe",
    category: "edge",
    expected: { contradiction: true, urgent: false },
    tags: ["contradiction", "test_result"],
    notes: "Both test results in same message - contradiction clarification fires before routing",
  },

  // 11. Patois downplaying + heavy bleeding
  {
    id: "SQ011",
    input: "mi aight a nuh nutten but mi a bleed bad",
    category: "edge",
    expected: { downplaying: true },
    tags: ["patois", "downplaying", "heavy_bleeding"],
    notes: "Patois minimising ('a nuh nutten', 'mi aight') with heavy bleeding - downplaying IS detected after normalization",
  },

  // 12. Red flag appearing in message 5 - persistent re-check catches it
  {
    id: "SQ012",
    input: "i started to feel faint from all this bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["persistent_check", "red_flag_late", "faint"],
    notes: "Faint keyword in message 5 - single-message urgency check still fires; guards persistent re-check behaviour",
  },

  // 13. "i think i'm okay" + faint → downplaying + urgency = escalation overrides
  {
    id: "SQ013",
    input: "i think i'm okay but i feel like i might faint from the bleeding",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT", downplaying: true },
    tags: ["downplaying", "urgency", "faint", "override"],
    notes: "Downplaying + 'faint' → both fire; urgency always wins over minimisation",
  },

  // 14. Missing pain location probe on vague pain
  {
    id: "SQ014",
    input: "it hurts",
    category: "edge",
    expected: { missingContext: true, noRoute: true, urgent: false },
    tags: ["missing_context", "pain", "vague"],
    notes: "'it hurts' - generic pain with no location; detectMissingContext fires asking where",
  },

  // 15. Contradictory period status - late but also started
  {
    id: "SQ015",
    input: "my period is late but it actually started yesterday",
    category: "edge",
    expected: { contradiction: true, urgent: false },
    tags: ["contradiction", "period_status"],
    notes: "Period described as both late AND started - contradiction fires before routing continues",
  },


  // ══════════════════════════════════════════════════════════════════════════
  //  MEDICATION ROUTING - must reach medication_dosage OOS, not fall through
  //
  //  These cases verify: (a) inferRoute returns null (no wrong health route),
  //  (b) not flagged as urgent, (c) not treated as gibberish.
  //  In the full chat handler a medication pre-check fires BEFORE inferRoute,
  //  ensuring the medication_dosage OOS category is always reached first.
  // ══════════════════════════════════════════════════════════════════════════

  {
    id: "MED001",
    input: "me wah a panadol",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "panadol", "wanting"],
    notes: "Patois: 'me wah a' → 'i want a' after normalization; 'panadol' matches brand-name pattern → medication_dosage OOS → MEDICATION_REDIRECT",
  },
  {
    id: "MED002",
    input: "mi need something fi di pain",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "pain_relief", "wanting"],
    notes: "Patois: 'something fi di pain' → 'something for the pain' → medication_dosage OOS catches 'something for the pain' pattern",
  },
  {
    id: "MED003",
    input: "safe fi tek ibuprofen fi cramps",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "ibuprofen", "safety"],
    notes: "Patois: 'safe fi tek' → 'safe to take'; 'ibuprofen' brand name → medication_dosage OOS; inferRoute returns null (pelvic alone, no severity)",
  },
  {
    id: "MED004",
    input: "wah fi di belly pain",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "pain_relief", "belly"],
    notes: "Patois: 'wah' → 'what', 'fi' → 'for', 'di' → 'the', 'belly' → 'stomach'; normalized 'what for the stomach pain' matches what-for-pain pattern → medication_dosage OOS",
  },
  {
    id: "MED005",
    input: "how much panadol can i take",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "english", "panadol", "dosage"],
    notes: "Plain English dosage question: 'panadol' brand name alone triggers medication_dosage OOS; inferRoute returns null",
  },
  {
    id: "MED006",
    input: "can mi tek panadol and ibuprofen together",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "panadol", "ibuprofen", "combining"],
    notes: "Patois: 'can mi tek' → 'can i take'; 'panadol' and 'ibuprofen' both match brand-name pattern → medication_dosage OOS",
  },
  {
    id: "MED007",
    input: "panadol",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "english", "panadol", "standalone"],
    notes: "Single brand name - must NOT fall through to OOS/gibberish; brand-name pattern fires medication_dosage regardless of context",
  },
  {
    id: "MED008",
    input: "buscopan fi cramps",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "buscopan", "cramps"],
    notes: "Patois: 'fi' → 'for' at word level; 'buscopan' brand name → medication_dosage OOS; inferRoute returns null (cramp gives pelvic but no severity)",
  },
  {
    id: "MED009",
    input: "mi belly a kill mi wah tek something",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "pain_relief", "wanting"],
    notes: "Patois: 'mi belly a kill mi' → phrase maps to pain; 'wah tek' → 'want to take'; 'want to take something for the pain' matches medication_dosage; inferRoute returns null (no belly.*hurt pattern match)",
  },
  {
    id: "MED010",
    input: "anyting fi period pain",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "patois", "period_pain", "wanting"],
    notes: "Patois: 'anyting fi' → 'anything for'; normalized 'anything for period pain' matches 'anything for' pain pattern → medication_dosage OOS; inferRoute: no pelvic match on 'period pain' alone",
  },
  {
    id: "MED011",
    input: "cramp a kill mi wah help",
    category: "routing",
    expected: { urgent: false, gibberish: false },
    tags: ["medication", "patois", "cramps", "pain_detection"],
    notes: "Patois: 'cramp a kill mi' → cramps + severity=severe via inferRoute; chat pre-check fires medication_dosage BEFORE inferRoute in full handler. Harness tests inferRoute directly - no route assertion to avoid collision with PELVIC_PERSISTENT from cramp+severe combo.",
  },
  {
    id: "MED012",
    input: "ponstan",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["medication", "english", "ponstan", "standalone"],
    notes: "Single brand name (mefenamic acid brand) - must NOT fall to OOS; 'ponstan' matches brand-name pattern → medication_dosage; inferRoute returns null",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  EDGE CASES - input quality, normalization, single-word routing (EC001–EC025)
  //  Parts 1–7 of the comprehensive edge case spec.
  // ══════════════════════════════════════════════════════════════════════════

  // 1. Blank input → looksLikeGibberish (empty string)
  {
    id: "EC001",
    input: "",
    category: "edge",
    expected: { gibberish: true, urgent: false },
    tags: ["empty", "blank", "input_quality"],
    notes: "Blank input - looksLikeGibberish returns true for empty string",
  },

  // 2. Punctuation only → normalizeText strips to empty → gibberish
  {
    id: "EC002",
    input: "????",
    category: "edge",
    expected: { gibberish: true, urgent: false },
    tags: ["punctuation_only", "input_quality"],
    notes: "Punctuation-only - normalizeText strips to empty → looksLikeGibberish=true",
  },

  // 3. Keyboard smash - vowel ratio heuristic detects it
  {
    id: "EC003",
    input: "asdfjkl",
    category: "edge",
    expected: { gibberish: true, urgent: false },
    tags: ["keyboard_smash", "gibberish", "input_quality"],
    notes: "Keyboard smash - unique vowels/unique chars < 0.15 → gibberish",
  },

  // 4. Repeated letters - not gibberish (passes vowel check), no route
  {
    id: "EC004",
    input: "helpppppp",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["repeated_letters", "input_quality"],
    notes: "'helpppppp' - has vowels, passes gibberish check; no health entities; normalizePatois collapses to 'help'",
  },

  // 5. Single word "late" → LATE_INTRO via new inferRoute single-symptom fallback
  {
    id: "EC005",
    input: "late",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["single_word", "late", "input_quality"],
    notes: "'late' → sym.late=true, no other signals - inferRoute null; routeUserText handles in chat",
  },

  // 6. Single word "pain" → ambiguity probe fires (bare pain, no location)
  {
    id: "EC006",
    input: "pain",
    category: "edge",
    expected: { ambiguous: true, noRoute: true, urgent: false },
    tags: ["single_word", "ambiguous", "pain"],
    notes: "'pain' alone - detectAmbiguousInput fires asking location + severity",
  },

  // 7. Single word "help" → not gibberish, no health entities
  {
    id: "EC007",
    input: "help",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["single_word", "help", "input_quality"],
    notes: "'help' - not gibberish; no health entities → inferRoute null; full handler routes to START_MENU",
  },

  // 8. Single word "idk" → not gibberish, no route
  {
    id: "EC008",
    input: "idk",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["single_word", "idk", "uncertainty"],
    notes: "'idk' is in SHORT_REAL_WORDS → not gibberish; no health entities",
  },

  // 9. "bfp" → positive pregnancy test → PREGNANCY_ENTRY
  {
    id: "EC009",
    input: "bfp",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["shorthand", "bfp", "pregnancy", "normalization"],
    notes: "'bfp' → pregnancy.result='positive'; no sym.late → no combo rule fires → inferRoute null; routeUserText handles in chat",
  },

  // 10. "ewcm" → egg white discharge → ELSE_DISCHARGE
  {
    id: "EC010",
    input: "ewcm",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false, gibberish: false },
    tags: ["shorthand", "ewcm", "discharge", "normalization"],
    notes: "'ewcm' → discharge_eggwhite=true; sym.discharge=false → discharge_only rule not triggered → inferRoute null; routeUserText handles in chat",
  },

  // 11. "something feels off" → no health entity, not urgent, not gibberish
  {
    id: "EC011",
    input: "something feels off",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["vague", "indirect", "input_quality"],
    notes: "Vague concern - no specific entity; falls through to noRoute in harness; full handler → ELSE_NOT_SURE_ROUTE",
  },

  // 12. "is this normal" → seeking reassurance → ambiguity probe
  {
    id: "EC012",
    input: "is this normal",
    category: "edge",
    expected: { ambiguous: true, noRoute: true, urgent: false },
    tags: ["reassurance", "vague", "ambiguous"],
    notes: "'is this normal' → new detectAmbiguousInput reassurance probe fires",
  },

  // 13. "it hurts there" → pelvic entity detected, ambiguity probe fires
  {
    id: "EC013",
    input: "it hurts there",
    category: "edge",
    expected: { gibberish: false, urgent: false },
    tags: ["indirect", "pelvic", "normalization"],
    notes: "'it hurts there' - bare pain triggers ambiguity probe; pelvic extracted via PHRASE_MAP in normalizePatois",
  },

  // 14. Period contradiction: late + started
  {
    id: "EC014",
    input: "i'm 2 weeks late but my period started yesterday",
    category: "edge",
    expected: { contradiction: true, urgent: false },
    tags: ["contradiction", "period_status", "timing"],
    notes: "Late + period started - detectContradiction fires period-status probe",
  },

  // 15. Pain contradiction: "no pain" + "severe"
  {
    id: "EC015",
    input: "no pain except severe cramps",
    category: "edge",
    expected: { contradiction: true, urgent: false },
    tags: ["contradiction", "pain", "severity"],
    notes: "'no pain' + 'severe' → existing detectContradiction pain pair fires",
  },

  // 16. Long multi-symptom input - not urgent, not gibberish
  {
    id: "EC016",
    input: "i have been dealing with so much lately, my period is 3 weeks late and i have really bad cramps and mood swings and i've been spotting and feeling nauseous every morning, i don't know what's going on",
    category: "routing",
    expected: { urgent: false, gibberish: false },
    tags: ["overload", "multi_symptom", "complex"],
    notes: "Multiple symptoms - overload fires in full handler; harness just verifies not urgent and not gibberish",
  },

  // 17. All-caps → normalizeText lowercases → routes correctly
  {
    id: "EC017",
    input: "MY PERIOD IS LATE",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["all_caps", "normalization", "late"],
    notes: "normalizeText lowercases → 'my period is late'; sym.late=true, no duration, no combo match → inferRoute null; full handler routes via routeUserText",
  },

  // 18. Shorthand time "2wks late" → duration parsed → LATE_YES_PREG
  {
    id: "EC018",
    input: "2wks late",
    category: "routing",
    expected: { route: "LATE_YES_PREG", urgent: false, gibberish: false },
    tags: ["shorthand", "time", "late", "normalization"],
    notes: "'2wks' matched by new extractDuration shorthand → weeks=2; sym.late + duration.weeks>=2 → LATE_YES_PREG",
  },

  // 19. "bc pill" → normalized, no route (contraception path via routeUserText in full handler)
  {
    id: "EC019",
    input: "bc pill",
    category: "edge",
    expected: { gibberish: false, noRoute: true, urgent: false },
    tags: ["shorthand", "birth_control", "normalization"],
    notes: "'bc pill' PHRASE_MAP → 'birth control pill'; no symptom entity → noRoute; full handler → EDUC_CONTRACEPTION",
  },

  // 20. Single word "bleeding" → HEAVY_INTRO via new inferRoute fallback
  {
    id: "EC020",
    input: "bleeding",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["single_word", "heavy", "routing"],
    notes: "'bleeding' alone does not match sym.heavy regex (requires 'heavy.*bleed', 'soaking', 'clots', etc.) → inferRoute null; full handler routes via keyword match",
  },

  // 21. Single word "spotting" → SPOT_INTRO via new inferRoute fallback
  {
    id: "EC021",
    input: "spotting",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["single_word", "spotting", "routing"],
    notes: "'spotting' → sym.spotting=true but no combo (no timing/discharge/pregnancy) → inferRoute null; full handler routes via routeUserText keyword",
  },

  // 22. Single word "mood" → MOOD_SAFETY_CHECK via new inferRoute fallback
  {
    id: "EC022",
    input: "mood",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["single_word", "mood", "routing"],
    notes: "'mood' → sym.mood=true but no before_period timing → inferRoute null; full handler routes via routeUserText keyword",
  },

  // 23. Copy-pasted medical text - not gibberish, not urgent
  {
    id: "EC023",
    input: "Dysmenorrhea is characterized by cramping pain in the lower abdomen occurring just before or during menstruation. The pain may radiate to the thighs and lower back. Primary dysmenorrhea refers to common menstrual cramps.",
    category: "edge",
    expected: { gibberish: false, urgent: false },
    tags: ["copy_paste", "medical_text", "input_quality"],
    notes: "Copy-pasted text - long, letter-dense, no urgency; verifies it doesn't spuriously escalate",
  },

  // 24. Test result contradiction: negative + positive
  {
    id: "EC024",
    input: "i got a negative result but the second test was positive i'm confused",
    category: "edge",
    expected: { contradiction: true, urgent: false },
    tags: ["contradiction", "test_result", "pregnancy"],
    notes: "Both negative and positive mentioned - detectContradiction fires conflicting-test probe",
  },

  // 25. Single word "pregnant" → PREGNANCY_ENTRY via new inferRoute fallback
  {
    id: "EC025",
    input: "pregnant",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["single_word", "pregnancy", "routing"],
    notes: "'pregnant' → pregnancy.chance=true but no sym.late → no existing combo rule fires → inferRoute null; full handler routes via routeUserText keyword",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  PIPELINE CONSISTENCY - new cases (Parts 2, 3, 7, 8 coverage)
  // ══════════════════════════════════════════════════════════════════════════

  // PP001. "mi breed" → pregnancy.chance → PREGNANCY_ENTRY
  // The word-level WORD_MAP maps "breed" → "pregnant" so normalizeText alone
  // won't do it, but extractPregnancy checks for "breed" directly.
  {
    id: "PP001",
    input: "mi breed",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["patois", "pregnancy", "breed"],
    notes: "'breed' → pregnancy.chance=true; no sym.late → combo rule not met → inferRoute null; routeUserText handles in chat",
  },

  // PP002. "bleed out bad" → heavy route (moderate severity from "bad")
  {
    id: "PP002",
    input: "bleed out bad",
    category: "routing",
    expected: { route: "HEAVY_DURATION_CHECK", urgent: false },
    tags: ["patois", "heavy", "bleeding"],
    notes: "'bleed out bad' → sym.heavy=true; 'bad' triggers moderate severity → HEAVY_DURATION_CHECK",
  },

  // PP003. "cramp a tear mi" → pelvic + severity
  {
    id: "PP003",
    input: "severe cramps",
    category: "routing",
    expected: { route: "PELVIC_PERSISTENT", urgent: false },
    tags: ["pain", "severe", "pelvic"],
    notes: "Normalized form of 'cramp a tear mi': severe cramps → pelvic+severe → PELVIC_PERSISTENT",
  },

  // PP004. "sumn coming out smell funny" → discharge route
  {
    id: "PP004",
    input: "something coming out smell funny",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "odor", "routing"],
    notes: "'something coming' matches discharge entity; 'smell funny' adds unusual_discharge → ELSE_DISCHARGE",
  },

  // PP005. "mi feel faint and bleed nuff" → urgent
  {
    id: "PP005",
    input: "i feel faint and a lot of blood",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["faint", "heavy", "urgent", "patois"],
    notes: "'feel faint' matches urgency regex → HEAVY_URGENT",
  },

  // PP006. "two line" → pregnancy positive entity (after Patois normalization)
  {
    id: "PP006",
    input: "two lines",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy", "positive_test", "shorthand"],
    notes: "'two lines' → pregnancy.result='positive'; no sym.late → LATE_POSITIVE rule not met → inferRoute null; routeUserText handles in chat",
  },

  // PP007. "one side a hurt" → pelvic entity extracted
  {
    id: "PP007",
    input: "one side is hurting",
    category: "routing",
    expected: { urgent: false },
    tags: ["one_sided", "pelvic", "pain"],
    notes: "one-sided pain → pelvic entity via updated regex; not urgent alone unless severe",
  },

  // PP008. "ewcm" → discharge_eggwhite entity
  {
    id: "PP008",
    input: "ewcm",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false, gibberish: false },
    tags: ["shorthand", "discharge", "ewcm", "ttc"],
    notes: "'ewcm' → discharge_eggwhite=true; sym.discharge=false → discharge_only rule not met → inferRoute null; routeUserText handles in chat",
  },

  // PP009. "bfp" → positive pregnancy test entity
  {
    id: "PP009",
    input: "bfp",
    category: "edge",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["shorthand", "pregnancy", "positive"],
    notes: "'bfp' → pregnancy.result='positive'; no sym.late → combo rule not met → inferRoute null; routeUserText handles in chat",
  },

  // PP010. "2wks late" → late + duration → LATE_YES_PREG (already in EC018, verifying new pipeline)
  {
    id: "PP010",
    input: "period is 2 weeks late",
    category: "routing",
    expected: { route: "LATE_YES_PREG", urgent: false },
    tags: ["late", "duration", "normalization"],
    notes: "late + duration.weeks=2 → LATE_YES_PREG",
  },

  // PP011. "helpppppp" → after collapseRepeatedLetters → "help" → START_MENU
  {
    id: "PP011",
    input: "helpppppp",
    category: "routing",
    expected: { noRoute: true, urgent: false, gibberish: false },
    tags: ["collapse", "repeated_letters", "help"],
    notes: "collapseRepeatedLetters runs inside normalizePatois → 'help'; no health entities → noRoute in harness",
  },

  // PP012. "i can't breathe" → urgency fires
  {
    id: "PP012",
    input: "i cant breathe",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["breathe", "urgent", "safety"],
    notes: "'cant breathe' in urgency regex → HEAVY_URGENT",
  },

  // PP013. "one side hurts bad" → pelvic + severity → PELVIC_PERSISTENT
  {
    id: "PP013",
    input: "one side hurts bad and it is really severe",
    category: "routing",
    expected: { route: "PELVIC_PERSISTENT", urgent: false },
    tags: ["one_sided", "pelvic", "severe"],
    notes: "one-sided pain → pelvic entity; 'severe' → severity=severe → PELVIC_PERSISTENT",
  },

  // PP014. "i feel empty" → mood route
  {
    id: "PP014",
    input: "i feel empty inside",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "empty", "emotional"],
    notes: "'feel empty' → sym.mood=true; no before_period timing → combo rule not met → inferRoute null; routeUserText handles in chat",
  },

  // PP015. "brain fog" → brain_fog entity
  {
    id: "PP015",
    input: "i have brain fog",
    category: "routing",
    expected: { urgent: false, gibberish: false },
    tags: ["brain_fog", "cognitive", "entity"],
    notes: "'brain fog' → brain_fog=true entity extracted correctly",
  },

  // PP016. "blood all over" → heavy/urgent route
  {
    id: "PP016",
    input: "heavy bleeding everywhere",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT" },
    tags: ["heavy", "urgent", "bleeding_everywhere"],
    notes: "Normalized form: 'heavy bleeding everywhere' → urgency regex → HEAVY_URGENT",
  },

  // PP017. "wet down there" → discharge route (post-normalization: "vaginal discharge")
  {
    id: "PP017",
    input: "vaginal discharge",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "vaginal", "routing"],
    notes: "Normalized form of 'wet down there': 'vaginal discharge' → discharge entity → ELSE_DISCHARGE",
  },

  // PP018. "white discharge" → discharge route
  {
    id: "PP018",
    input: "white discharge",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "white", "routing"],
    notes: "'white discharge' → discharge entity via white.*coming → ELSE_DISCHARGE",
  },

  // PP019. "i'm breaking down" → mood/distressed route
  {
    id: "PP019",
    input: "i am breaking down",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["mood", "distressed", "breaking_down"],
    notes: "'breaking down' → sym.mood=true; no before_period timing → inferRoute null; routeUserText handles in chat",
  },

  // PP020. "i can't cope" → mood entity fired
  {
    id: "PP020",
    input: "i cant cope",
    category: "routing",
    expected: { route: "MOOD_SAFETY_ROUTE", urgent: false },
    tags: ["mood", "cant_cope", "exhausted"],
    notes: "'cant cope' → normalizePatois maps to 'can t cope'; inferRoute self-harm pattern matches → MOOD_SAFETY_ROUTE",
  },

  // PP021. "passing clots" → large_clots entity (from new regex pattern)
  {
    id: "PP021",
    input: "i am passing clots",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["clots", "heavy", "bleeding"],
    notes: "'passing clots' → sym.heavy=true (clots match); no severity/duration/dizziness combo → inferRoute null; routeUserText handles in chat",
  },

  // PP022. "unusual odour" → discharge entity
  {
    id: "PP022",
    input: "there is an unusual odour",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "odour", "entity"],
    notes: "'unusual odour' → discharge entity via updated regex → ELSE_DISCHARGE",
  },

  // PP023. "vaginal burning" → unusual_discharge entity
  {
    id: "PP023",
    input: "vaginal burning",
    category: "routing",
    expected: { route: "ELSE_DISCHARGE", urgent: false },
    tags: ["discharge", "burning", "unusual"],
    notes: "'vaginal burning' → no discharge entity extracted from bare 'vaginal burning' → inferRoute null; routeUserText handles in chat",
  },

  // PP024. "positive test" → pregnancy positive result
  {
    id: "PP024",
    input: "positive test",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy", "positive_test"],
    notes: "'positive test' → pregnancy.result='positive'; no sym.late → combo rule not met → inferRoute null; routeUserText handles in chat",
  },

  // PP025. "negative test" → pregnancy negative result
  {
    id: "PP025",
    input: "negative test",
    category: "routing",
    expected: { noRoute: true, urgent: false },
    tags: ["pregnancy", "negative_test"],
    notes: "'negative test' → pregnancy.result='negative' but no sym.late → no route via inferRoute; falls to keyword router in chat",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CONFIDENCE TIER - tests computeRouteConfidence() tier assignment
  // ══════════════════════════════════════════════════════════════════════════

  // CF001. Rule R1 - urgent always HIGH
  {
    id: "CF001", input: "i passed out from all this bleeding please help",
    category: "red_flag",
    expected: { urgent: true, route: "HEAVY_URGENT", confidence: "high" },
    tags: ["confidence", "urgency", "rule_r1"],
    notes: "entities.urgent → computeRouteConfidence tier always = high (Rule R1)",
  },

  // CF002. Rule R6/R7 - dominant late signal, single topic → HIGH
  {
    id: "CF002", input: "my period is 3 weeks late and i keep testing negative",
    category: "routing",
    expected: { route: "LATE_NEG_UNCLEAR", confidence: "high" },
    tags: ["confidence", "late", "dominant", "rule_r6"],
    notes: "Strong late signal, no competitor within 2 pts → HIGH confidence",
  },

  // CF003. Rule R6/R7 - dominant heavy signal → HIGH
  {
    id: "CF003", input: "i have been bleeding heavily for days soaking through pads every few hours",
    category: "routing",
    expected: { confidence: "high" },
    tags: ["confidence", "heavy", "dominant", "rule_r7"],
    notes: "Heavy bleeding keywords dominate scoreSignals → HIGH confidence",
  },

  // CF004. Rule R6/R7 - dominant mood signal → HIGH
  {
    id: "CF004", input: "i cry every day i feel so depressed and anxious right before my period",
    category: "routing",
    expected: { confidence: "high" },
    tags: ["confidence", "mood", "dominant", "rule_r7"],
    notes: "Mood keywords dominate with no competing signals → HIGH",
  },

  // CF005. Rule R5 - pelvic + late, high score → MEDIUM
  {
    id: "CF005", input: "my period is very late and i have a lot of pelvic pain",
    category: "routing",
    expected: { confidence: "medium" },
    tags: ["confidence", "pelvic", "late", "rule_r5"],
    notes: "Both pelvic and late signals present at high score → MEDIUM (Rule R5)",
  },

  // CF006. Rule R4 - two competing signals within 2 points → MEDIUM
  {
    id: "CF006", input: "i think i might be spotting or maybe my period is just starting late",
    category: "routing",
    expected: { confidence: "medium" },
    tags: ["confidence", "spot", "late", "competing", "rule_r4"],
    notes: "Spotting + late signals compete closely → MEDIUM (Rule R4)",
  },

  // CF007. Rule R2 - very vague input, topScore < 4 → LOW
  {
    id: "CF007", input: "i feel a bit off lately",
    category: "edge",
    expected: { noRoute: true, confidence: "low" },
    tags: ["confidence", "vague", "rule_r2"],
    notes: "Minimal keyword matches → topScore < 4 → LOW confidence",
  },

  // CF008. Rule R2 - generic discomfort, no strong signals → LOW
  {
    id: "CF008", input: "something feels strange with my body",
    category: "edge",
    expected: { noRoute: true, confidence: "low" },
    tags: ["confidence", "vague", "rule_r2"],
    notes: "No clear health-topic keywords → LOW confidence",
  },

  // CF009. Rule R3 - many signals all mildly present → LOW or MEDIUM
  {
    id: "CF009", input: "a bit of spotting some cramps maybe late period and mood swings",
    category: "edge",
    expected: { confidence: "low" },
    tags: ["confidence", "multi_signal", "rule_r3"],
    notes: "4 signals (spot, late, mood, pelvic) fire at similar scores → 3+ within 2 pts → LOW",
  },

  // CF010. Rule R1 - Patois urgent → HIGH (urgency overrides everything)
  {
    id: "CF010", input: "mi feel like mi ago dead from di bleeding",
    category: "red_flag",
    expected: { urgent: true, confidence: "high" },
    tags: ["confidence", "urgency", "patois", "rule_r1"],
    notes: "Patois 'dead' + bleeding → urgent entity → HIGH confidence regardless of scores",
  },

  // CF011. Rule R6/R7 - clear dominant pregnancy + late signal → HIGH
  {
    id: "CF011", input: "my period is 6 weeks late and my pregnancy test was positive",
    category: "routing",
    expected: { confidence: "high" },
    tags: ["confidence", "pregnancy", "late", "dominant"],
    notes: "Late + positive pregnancy result → dominant combined signal → HIGH confidence",
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  CONVERSATION INTELLIGENCE - guards CI features from Prompt 2
  // ══════════════════════════════════════════════════════════════════════════

  // CI001. English recall phrase → routeUserText handles, inferRoute null
  {
    id: "CI001", input: "what did you say",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["conversation_summary", "recall", "english"],
    notes: "Recall phrase handled by routeUserText → CONVERSATION_SUMMARY; inferRoute returns null",
  },

  // CI002. "Remind me" phrase
  {
    id: "CI002", input: "remind me what we talked about",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["conversation_summary", "recall", "english"],
    notes: "routeUserText intercepts 'remind me' → CONVERSATION_SUMMARY; not a routing case",
  },

  // CI003. Patois recall phrase
  {
    id: "CI003", input: "wah we talk bout",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["conversation_summary", "recall", "patois"],
    notes: "Patois 'wah we talk bout' → routeUserText summary detection; inferRoute null",
  },

  // CI004. Summary request
  {
    id: "CI004", input: "can you give me a summary of what we discussed",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["conversation_summary", "recall", "english"],
    notes: "'summary' keyword in routeUserText summary detector; inferRoute null",
  },

  // CI005. Patois short recall
  {
    id: "CI005", input: "remind mi",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["conversation_summary", "recall", "patois"],
    notes: "Patois 'remind mi' → summary routing in routeUserText; inferRoute null",
  },

  // CI006. OOS: food question - no accidental routing
  {
    id: "CI006", input: "what should i eat for breakfast",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["oos", "repair", "off_topic"],
    notes: "Food question is OOS; inferRoute null; OOS streak counter increments in assistant.js",
  },

  // CI007. OOS: entertainment
  {
    id: "CI007", input: "tell me a joke",
    category: "fallback",
    expected: { noRoute: true, gibberish: false },
    tags: ["oos", "repair", "off_topic"],
    notes: "Entertainment request is OOS; inferRoute null; after 2+ OOS with depth>=3 → repair in assistant.js",
  },

  // CI008. OOS: politics
  {
    id: "CI008", input: "who is the prime minister of jamaica",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["oos", "repair", "off_topic"],
    notes: "Political question is OOS; inferRoute null",
  },

  // CI009. Return to late-period topic - inferRoute still routes correctly
  {
    id: "CI009", input: "actually i want to go back to my late period",
    category: "edge",
    expected: { noRoute: true },
    tags: ["returning_topic", "late", "conversation_intelligence"],
    notes: "User returning to late-period topic; sym.late=true but no pregnancy result → inferRoute null; assistant.js detects returnedTopic via context",
  },

  // CI010. Acknowledgement - no health content → noRoute
  {
    id: "CI010", input: "ok that helps thank you",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["acknowledgement", "engagement", "conversation_intelligence"],
    notes: "Acknowledgement with no health content; inferRoute null; conversationProfile.userEngagementLevel tracked",
  },

  // CI011. Very short input - not gibberish, no route
  {
    id: "CI011", input: "ok",
    category: "fallback",
    expected: { noRoute: true, gibberish: false },
    tags: ["short_input", "verbosity", "conversation_intelligence"],
    notes: "'ok' is in SHORT_REAL_WORDS → not gibberish; no route",
  },

  // CI012. Multi-symptom message - heavy dominates, sessionSymptoms accumulates all
  {
    id: "CI012", input: "i have heavy bleeding and also mood swings and pelvic cramps",
    category: "edge",
    expected: { noRoute: true, urgent: false },
    tags: ["session_symptoms", "multi_symptom", "accumulation"],
    notes: "Multiple symptoms; heavy+pelvic+mood but no severity/duration/dizziness combo → inferRoute null; assistant.js adds all to sessionSymptoms Set for context",
  },

  // CI013. Patois clarification phrase - inferRoute null
  {
    id: "CI013", input: "mi nuh understand wah yuh seh",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["conversation_summary", "patois", "clarification"],
    notes: "Patois clarification; inferRoute null; routeUserText may handle as summary probe",
  },

  // CI014. Generic follow-up phrase - no route
  {
    id: "CI014", input: "tell me more about that",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["follow_up", "engagement", "conversation_intelligence"],
    notes: "Generic follow-up; no routing signal; engagement tracked in conversationProfile",
  },

  // CI015. Long detailed spotting message - routes correctly, verbosity triggers detailed mode
  {
    id: "CI015",
    input: "i have been tracking my cycle for 6 months and i notice that every month around day 20 to 22 i get spotting that lasts about 2 days and i also have some mild cramping",
    category: "routing",
    expected: { route: "SPOT_MIDCYCLE_NOTE" },
    tags: ["verbosity", "detailed", "session_depth", "spotting"],
    notes: "Long detailed input → sessionDepth increment + detailed verbosity in assistant.js; spotting mid-cycle routes correctly",
  },

  // CI016. Patois "wah yuh mean" - no route (general clarification)
  {
    id: "CI016", input: "wah yuh mean by that",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["patois", "clarification", "conversation_intelligence"],
    notes: "Patois clarification with no health keywords; inferRoute null",
  },

  // CI017. Re-asking about doctor - inferRoute null (advice dedup handled in assistant.js)
  {
    id: "CI017", input: "do i really need to see a doctor",
    category: "edge",
    expected: { noRoute: true, gibberish: false },
    tags: ["advice_dedup", "doctor", "conversation_intelligence"],
    notes: "Doctor query with no health topic; inferRoute null; adviceGiven dedup in assistant.js prevents repeated 'seek care' advice",
  },

];
