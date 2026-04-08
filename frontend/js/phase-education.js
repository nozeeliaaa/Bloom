/**
 * phase-education.js
 * Biologically grounded phase education for the Today's Insight card.
 *
 * Each variant: { id, title, body, tags }
 *   title  – short bold label
 *   body   – 1-2 sentence educational fact (UK English, warm tone)
 *   tags   – uppercase symptom codes from SYMPTOM_CATEGORIES
 */

export const PHASE_EDUCATION_MAP = {

  // MENSTRUAL
  menstrual: [
    {
      id: "men_rest",
      title: "Rest is productive right now",
      body: "Oestrogen and progesterone are at their lowest during menstruation, which is why energy and mood dip. Your body is doing real physical work, and rest supports that.",
      tags: ["FATIGUE", "CRAMPS", "PELVIC_PAIN"],
    },
    {
      id: "men_cramps",
      title: "Why cramps happen",
      body: "Your uterus contracts to shed its lining using hormone-like compounds called prostaglandins. Higher prostaglandin levels mean heavier flow and stronger cramps.",
      tags: ["CRAMPS", "PELVIC_PAIN", "JOINT_PAIN"],
    },
    {
      id: "men_iron",
      title: "Replace the iron you lose",
      body: "Menstruation causes iron loss, which affects energy and focus. Iron-rich foods like lentils, spinach, and fortified cereals help; pairing with vitamin C boosts absorption.",
      tags: ["FATIGUE", "HEAVY_FLOW", "LARGE_CLOTS"],
    },
    {
      id: "men_mood",
      title: "Low mood is hormonally real",
      body: "The sharp drop in oestrogen and progesterone at the start of your period affects serotonin. Feeling low, tearful, or irritable right now is physiologically grounded, not a personal failing.",
      tags: ["MOOD_SWINGS", "DEPRESSION", "CRYING_SPELLS", "ANXIETY", "IRRITABILITY"],
    },
    {
      id: "men_sleep",
      title: "Sleep can be harder this week",
      body: "Progesterone, which had a mild sedative effect last phase, has now fallen. Cramp discomfort adds to this, so a heat pad and a cool room can make a real difference.",
      tags: ["INSOMNIA", "FATIGUE"],
    },
    {
      id: "men_tracking",
      title: "Your flow data matters",
      body: "Logging flow intensity each day builds a picture of your pattern over time. Consistently heavy flow or pain that disrupts daily life is worth noting for a healthcare conversation.",
      tags: ["HEAVY_FLOW", "LARGE_CLOTS", "SPOTTING", "VAGINAL_BLEEDING"],
    },
  ],

  // FOLLICULAR
  follicular: [
    {
      id: "fol_oestrogen",
      title: "Oestrogen is rising",
      body: "FSH from your pituitary gland is prompting follicles to develop, which secrete increasing oestrogen. Most people notice improved mood, sharper focus, and more energy in this phase.",
      tags: ["CALM", "APPETITE_DECREASE"],
    },
    {
      id: "fol_skin",
      title: "Your skin may look its best",
      body: "Rising oestrogen supports collagen production and reduces sebum, which often means clearer skin and shinier hair. These changes are a direct hormonal effect.",
      tags: ["ACNE", "DRY_SKIN", "HAIR_THINNING"],
    },
    {
      id: "fol_nutrition",
      title: "Feed your follicles",
      body: "B vitamins, zinc, and omega-3 fatty acids support follicular development this phase. Eggs, seeds, oily fish, and wholegrains are particularly good sources right now.",
      tags: ["NAUSEA", "APPETITE_DECREASE", "APPETITE_INCREASE"],
    },
    {
      id: "fol_fertile_approach",
      title: "Fertile window is approaching",
      body: "As oestrogen rises, cervical mucus shifts from sticky to clearer and more stretchy. This change signals that ovulation is drawing closer.",
      tags: ["DISCHARGE_CREAMY", "DISCHARGE_STICKY", "CERVICAL_MUCUS_CHANGE"],
    },
    {
      id: "fol_motivation",
      title: "A good phase for new starts",
      body: "Oestrogen's rise is linked to increased motivation, sociability, and openness to challenge. If you have been putting something off, this phase often provides a natural boost.",
      tags: ["CALM", "INCREASED_LIBIDO"],
    },
    {
      id: "fol_logging",
      title: "Non-period logs count too",
      body: "Logging symptoms and mood during the follicular phase helps Bloom personalise your predictions over time. Even a single data point per day builds your cycle profile.",
      tags: [],
    },
  ],

  // OVULATORY
  ovulatory: [
    {
      id: "ovu_lh",
      title: "The LH surge triggers ovulation",
      body: "A surge in luteinising hormone (LH) causes the dominant follicle to rupture and release an egg. The egg is viable for around 12 to 24 hours, though sperm can survive up to five days.",
      tags: ["OVULATION_PAIN", "BBT_SHIFT", "DISCHARGE_EGGWHITE"],
    },
    {
      id: "ovu_body_signals",
      title: "Your body sends real signals",
      body: "Clear, stretchy cervical mucus (like egg whites), a mild one-sided pelvic twinge (mittelschmerz), and a slight temperature rise are all genuine physical signs of ovulation.",
      tags: ["DISCHARGE_EGGWHITE", "OVULATION_PAIN", "CERVICAL_MUCUS_CHANGE", "BBT_SHIFT", "SPOTTING"],
    },
    {
      id: "ovu_peak_energy",
      title: "Peak hormones, peak energy",
      body: "Oestrogen is at its highest just before ovulation, and testosterone also rises slightly. Many people feel more confident, sociable, and physically energised around this time.",
      tags: ["CALM", "INCREASED_LIBIDO"],
    },
    {
      id: "ovu_conception_timing",
      title: "The fertile window is now",
      body: "The five days before ovulation plus ovulation day itself are when conception is most likely. Bloom's estimate is based on your logged history and is educational, not a contraceptive method.",
      tags: ["CERVICAL_MUCUS_CHANGE", "INCREASED_LIBIDO"],
    },
    {
      id: "ovu_logging",
      title: "Log what you notice today",
      body: "Ovulation lasts just 24 to 48 hours, making it hard to pinpoint without data. Noting any unusual discharge, twinges, or mood shifts helps refine future predictions.",
      tags: ["DISCHARGE_STICKY", "DISCHARGE_CREAMY", "PELVIC_PAIN"],
    },
    {
      id: "ovu_after",
      title: "After ovulation: corpus luteum forms",
      body: "The ruptured follicle becomes the corpus luteum, which starts producing progesterone. This marks the shift into the luteal phase and lasts around 12 to 14 days.",
      tags: ["BBT_SHIFT", "BLOATING", "CONSTIPATION"],
    },
  ],

  // LUTEAL
  luteal: [
    {
      id: "lut_progesterone",
      title: "Progesterone is in charge",
      body: "The corpus luteum produces progesterone after ovulation, which raises basal body temperature, slows digestion, and prepares the uterine lining. Many physical changes this phase are direct effects of this hormone.",
      tags: ["BLOATING", "FATIGUE", "FLUID_RETENTION", "BBT_SHIFT"],
    },
    {
      id: "lut_fatigue",
      title: "Feeling tired is physiological",
      body: "Progesterone has a mild sedative effect, and maintaining a thickened uterine lining takes extra metabolic energy. Your body is genuinely working harder, so rest is not laziness.",
      tags: ["FATIGUE", "INSOMNIA", "DECREASED_LIBIDO"],
    },
    {
      id: "lut_brain_fog",
      title: "Brain fog is hormonal",
      body: "Falling oestrogen and rising progesterone affect serotonin and dopamine, which influence focus and cognition. Difficulty concentrating this phase is temporary and not a reflection of your capability.",
      tags: ["BRAIN_FOG", "POOR_CONCENTRATION", "FORGETFUL"],
    },
    {
      id: "lut_bloating",
      title: "Why bloating happens now",
      body: "Progesterone slows digestion, which causes bloating and a feeling of fullness. Staying hydrated, limiting salty foods, and eating magnesium-rich foods like nuts and dark greens can help.",
      tags: ["BLOATING", "FLUID_RETENTION", "CONSTIPATION", "GASSY"],
    },
    {
      id: "lut_cravings",
      title: "Cravings are hormonal, not willpower",
      body: "Serotonin dips in the luteal phase drive cravings for carbohydrates and sugar. Regular meals with protein and complex carbs help stabilise blood sugar and reduce craving intensity.",
      tags: ["CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY", "APPETITE_INCREASE"],
    },
    {
      id: "lut_mood",
      title: "Emotional sensitivity has a cause",
      body: "Oestrogen and progesterone shifts affect serotonin and GABA, which regulate mood and calm. Heightened irritability or low mood right now is physiologically explained, not a character flaw.",
      tags: ["MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "CRYING_SPELLS", "DEPRESSION", "STRESSED"],
    },
    {
      id: "lut_sleep",
      title: "Sleep quality often drops here",
      body: "Progesterone can cause initial drowsiness but disrupts REM sleep later in the phase. A consistent bedtime, a cool room, and less caffeine after midday all help.",
      tags: ["INSOMNIA", "FATIGUE", "NIGHT_SWEATS"],
    },
    {
      id: "lut_period_prep",
      title: "Your period is on its way",
      body: "Progesterone will soon decline as the corpus luteum breaks down, signalling the uterus to prepare to shed its lining. Noting your pre-menstrual symptoms builds a useful pattern over cycles.",
      tags: ["CRAMPS", "BREAST_TENDERNESS", "HEADACHE", "ACNE"],
    },
  ],

  // LATE LUTEAL
  late_luteal: [
    {
      id: "llut_progesterone_drop",
      title: "Your hormones are dropping sharply",
      body: "Both progesterone and oestrogen fall as the corpus luteum breaks down. This withdrawal is the direct cause of most pre-menstrual symptoms, not an overreaction.",
      tags: ["MOOD_SWINGS", "IRRITABILITY", "DEPRESSION", "CRYING_SPELLS", "ANXIETY"],
    },
    {
      id: "llut_fatigue_final",
      title: "End-of-cycle fatigue is real",
      body: "Falling progesterone removes its mild sedative support, oestrogen drops, and the body prepares for menstruation. Reducing commitments and going to bed earlier this week is a reasonable, not indulgent, choice.",
      tags: ["FATIGUE", "INSOMNIA", "DECREASED_LIBIDO"],
    },
    {
      id: "llut_bloating_peak",
      title: "Bloating peaks before your period",
      body: "Fluid retention is highest in the final days before menstruation as oestrogen and progesterone fluctuate. This typically resolves within one to two days of bleeding starting.",
      tags: ["BLOATING", "FLUID_RETENTION", "BREAST_TENDERNESS"],
    },
    {
      id: "llut_brain_mood",
      title: "Mood and focus are hardest now",
      body: "Falling oestrogen reduces serotonin production, and the body's inflammatory response ramps up before menstruation. Low mood, irritability, and difficulty concentrating are common and physiologically explained.",
      tags: ["BRAIN_FOG", "POOR_CONCENTRATION", "MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "STRESSED"],
    },
    {
      id: "llut_cravings_final",
      title: "Cravings are strongest this week",
      body: "Serotonin dips are most significant in the late luteal phase, driving cravings for sugar and refined carbs. Magnesium from nuts, dark chocolate, and leafy greens may help reduce the intensity.",
      tags: ["CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY", "APPETITE_INCREASE"],
    },
    {
      id: "llut_almost_there",
      title: "Your period is nearly here",
      body: "Progesterone will fall low enough in the next day or two to trigger menstruation and a new cycle. The discomfort you feel now is tied to a specific, predictable hormonal window.",
      tags: ["CRAMPS", "SPOTTING", "BREAST_TENDERNESS", "HEADACHE"],
    },
  ],

  // UNKNOWN
  unknown: [
    {
      id: "unk_start",
      title: "Calculating your cycle phase",
      body: "Bloom uses your logged period dates to estimate your current phase. Logging flow intensity daily, even briefly, builds your personal cycle profile.",
      tags: [],
    },
    {
      id: "unk_how_it_works",
      title: "How phase estimation works",
      body: "Your cycle is divided into menstrual, follicular, ovulatory, and luteal phases based on your period start dates and average cycle length. Individual variation is normal.",
      tags: [],
    },
    {
      id: "unk_log_tip",
      title: "What to log for best results",
      body: "Flow level, mood, energy, and any physical symptoms are the most useful daily data points. Even one entry per day helps Bloom surface patterns specific to you.",
      tags: [],
    },
  ],
};

// -----------------------------------------------------------------------------
// getTodaysPhaseInsights = returns up to `count` variants, best match first
// -----------------------------------------------------------------------------

export function getTodaysPhaseInsights({ phase = "unknown", loggedSymptoms = [], count = 3 } = {}) {
  const key = PHASE_EDUCATION_MAP[phase] ? phase : "unknown";
  const variants = PHASE_EDUCATION_MAP[key] ?? [];

  if (!variants.length) {
    return [{ title: "Keep logging", body: "Daily logs help Bloom build your personal cycle profile." }];
  }

  const symptomsSet = new Set((loggedSymptoms || []).map(s => String(s).toUpperCase()));

  const scored = variants.map(v => ({
    variant: v,
    score: (v.tags || []).filter(t => symptomsSet.has(t)).length,
  }));
  scored.sort((a, b) => b.score - a.score);

  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );

  const result = [scored[0].variant];
  const rest = scored.slice(1);
  for (let i = 0; i < rest.length && result.length < count; i++) {
    result.push(rest[(dayOfYear + i) % rest.length].variant);
  }
  return result;
}

/** Single-variant convenience wrapper. */
export function getTodaysPhaseInsight({ phase = "unknown", loggedSymptoms = [] } = {}) {
  return getTodaysPhaseInsights({ phase, loggedSymptoms, count: 1 })[0];
}
