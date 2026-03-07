
// ─── TEMPLATE PARTS ──────────────────────────────────────────────────────────

const SITUATION = {
  late_period:
    "Your period appears to be late or hasn't arrived yet.",
  late_with_pain:
    "Your period is late and you also mentioned pain or discomfort.",
  late_with_pregnancy_chance:
    "Your period is late and there may be a chance of pregnancy.",
  late_long_duration:
    "Your period is significantly overdue — more than a week or two.",
  heavy_bleeding:
    "You're experiencing heavier bleeding than usual.",
  heavy_with_dizziness:
    "You're experiencing heavy bleeding along with dizziness or weakness.",
  heavy_long:
    "Your heavy bleeding has been going on for more than 7 days.",
  spotting_midcycle:
    "You're noticing light spotting around the middle of your cycle.",
  spotting_with_symptoms:
    "You're spotting and also experiencing other symptoms.",
  spotting_pregnancy:
    "You're spotting and there's a possibility of pregnancy.",
  pelvic_mild:
    "You're experiencing pelvic pain or cramps that feel manageable.",
  pelvic_severe:
    "You're experiencing severe or persistent pelvic pain.",
  pelvic_sex:
    "You're experiencing pain during or after sex.",
  mood_before_period:
    "You're noticing mood changes, fatigue, or emotional shifts — especially before your period.",
  mood_general:
    "You're experiencing mood changes, low energy, or emotional heaviness.",
  pregnancy_concern:
    "You have a concern related to possible pregnancy.",
  urgent:
    "You've described symptoms that may need prompt medical attention.",
};

const MEANING = {
  late_period:
    "A late period can happen for many reasons — stress, changes in routine, illness, travel, or natural hormonal shifts. It doesn't always mean something is wrong.",
  late_with_pain:
    "A late period combined with pelvic pain can sometimes point to hormonal shifts, but in some cases it may need closer attention — especially if the pain is severe or one-sided.",
  late_with_pregnancy_chance:
    "When a period is late and pregnancy is possible, a pregnancy test is the clearest first step. Tests are most accurate from the day your period was expected.",
  late_long_duration:
    "When a period is more than one to two weeks late, it's worth exploring the cause — this can include stress, significant weight changes, hormonal imbalance, or possible pregnancy.",
  heavy_bleeding:
    "Some people naturally have heavier flow, especially early in a period. However, flow that soaks through products quickly or lasts longer than 7 days can sometimes signal an underlying cause worth checking.",
  heavy_with_dizziness:
    "Heavy bleeding combined with dizziness or weakness can be a sign that your body needs support — this combination can sometimes lead to low iron or other concerns.",
  heavy_long:
    "Bleeding that goes on for more than a week can mean the uterus is having trouble completing the cycle, or that hormones are out of balance.",
  spotting_midcycle:
    "Light spotting in the middle of the cycle is often related to ovulation — a small hormone dip can cause brief, light bleeding. This is common and usually harmless.",
  spotting_with_symptoms:
    "Spotting alongside other symptoms like pain, unusual discharge, or fever can sometimes mean irritation, infection, or a hormonal change worth checking.",
  spotting_pregnancy:
    "Light spotting can sometimes occur in early pregnancy. A test can help clarify what's happening.",
  pelvic_mild:
    "Mild pelvic pain around your period is very common and often related to the uterus contracting. Comfort measures usually help.",
  pelvic_severe:
    "Persistent or severe pelvic pain that doesn't respond to rest or relief deserves medical attention. This doesn't automatically mean something serious — but pain shouldn't be dismissed.",
  pelvic_sex:
    "Pain during or after sex can be related to muscle tension, dryness, hormonal shifts, or other causes. It's more common than people talk about and is something a healthcare provider can help with.",
  mood_before_period:
    "Mood shifts, fatigue, and emotional heaviness before a period are real hormonal responses — not a sign of weakness. They're often linked to PMS or PMDD and can be supported.",
  mood_general:
    "Persistent low energy, mood shifts, or emotional difficulty — even outside of your period — can sometimes be connected to hormonal patterns or other factors worth tracking.",
  pregnancy_concern:
    "Pregnancy concerns are best addressed with clear information and a test when the timing is right.",
  urgent:
    "Symptoms like heavy bleeding with dizziness, severe one-sided pain, fainting, or fever alongside bleeding can signal that your body needs prompt support.",
};

const NEXT_STEPS = {
  late_period:
    "Continue tracking your cycle. If your period doesn't arrive in the next few days, consider checking for pregnancy if relevant, or reflect on recent changes like stress or illness.",
  late_with_pain:
    "Note whether the pain is one-sided or worsening. If pregnancy is possible, a test is recommended. If pain becomes severe, seek care sooner.",
  late_with_pregnancy_chance:
    "Take a pregnancy test — ideally the day after your expected period or later for best accuracy. If the result is negative but your period still doesn't come, retest in 48–72 hours.",
  late_long_duration:
    "Consider speaking with a healthcare provider if your period is more than two weeks late and pregnancy has been ruled out. Tracking symptoms helps explain the situation clearly.",
  heavy_bleeding:
    "Track how often you're changing products and whether you're passing clots. If flow soaks through products in under 2 hours or lasts more than 7 days, it's worth getting checked.",
  heavy_with_dizziness:
    "Rest, hydrate, and avoid overexertion. If you feel faint, have shortness of breath, or bleeding is not slowing, seek medical care as soon as possible.",
  heavy_long:
    "Speak with a healthcare provider. They can check for hormonal imbalances, uterine causes, or low iron. Tracking the number of days and product usage helps at a visit.",
  spotting_midcycle:
    "Track the spotting — color, amount, and how many days it lasts. Midcycle spotting that's brief and light usually resolves on its own.",
  spotting_with_symptoms:
    "If symptoms persist or worsen — especially discharge with odor, fever, or worsening pain — speak with a healthcare provider soon.",
  spotting_pregnancy:
    "A pregnancy test can help clarify what's happening. If you have severe pain, heavy bleeding, or dizziness alongside the spotting, seek care urgently.",
  pelvic_mild:
    "Use heat, rest, and over-the-counter relief if needed. Track when pain occurs in your cycle. If it's getting worse across cycles, mention it to a provider.",
  pelvic_severe:
    "Speak with a healthcare provider, especially if the pain is worsening, not responding to relief, or interfering with daily life. Conditions like endometriosis are only diagnosable with medical evaluation.",
  pelvic_sex:
    "You don't have to push through pain during sex. A healthcare provider or pelvic floor specialist can help identify the cause and offer support.",
  mood_before_period:
    "Track your mood alongside your cycle days to confirm the pattern. Small lifestyle supports — sleep, hydration, light movement — can help. If it's severe or interfering with daily life, speak with a provider.",
  mood_general:
    "Track your mood and energy patterns over a few weeks. If low mood or exhaustion is persistent, it may be worth talking to a healthcare provider or counselor.",
  pregnancy_concern:
    "A pregnancy test is the clearest first step. Test timing matters — the day after a missed period or later gives the most accurate result.",
  urgent:
    "Please seek medical care as soon as possible — a clinic, urgent care, or emergency service. You can use the care map to find nearby options.",
};

const URGENT_SIGNS = {
  late_period:
    "Seek urgent help if: the pain becomes severe, you feel faint, you have heavy bleeding, or you have severe one-sided pelvic pain.",
  late_with_pain:
    "Seek urgent help if: the pain becomes severe or one-sided, you feel faint or dizzy, or bleeding starts and is heavy.",
  late_with_pregnancy_chance:
    "Seek urgent help if: you develop severe one-sided pain, heavy bleeding, or feel faint — these can be signs of an ectopic pregnancy.",
  heavy_bleeding:
    "Seek urgent help if: you're soaking through a pad or tampon in under 2 hours for 2+ hours in a row, you feel faint, dizzy, or short of breath.",
  heavy_with_dizziness:
    "This combination warrants urgent care. Please go to a clinic or emergency service if symptoms are not improving.",
  spotting_with_symptoms:
    "Seek urgent help if: spotting becomes heavy bleeding, you develop fever, severe pain, or foul-smelling discharge.",
  pelvic_severe:
    "Seek urgent help if: pain is sudden and severe, especially one-sided — this can sometimes signal an ectopic pregnancy or other urgent condition.",
  mood_general:
    "If you're feeling unsafe or having thoughts of harming yourself, please reach out to emergency services (119 in Jamaica) or a trusted person right away.",
  urgent:
    "Please seek care now. Go to the nearest emergency department or call emergency services (119 in Jamaica).",
  default:
    "If symptoms worsen, you feel faint, develop fever, or have severe pain — please seek medical care promptly.",
};


// ─── SCENARIO MAP ─────────────────────────────────────────────────────────────

const REASON_TO_SCENARIO = {
  "urgency_flag":                  "urgent",
  "heavy+dizzy":                   "heavy_with_dizziness",
  "late+pregnancy_chance+no_test": "late_with_pregnancy_chance",
  "late+positive_test":            "late_with_pregnancy_chance",
  "late+negative_test":            "late_period",
  "late+2weeks":                   "late_long_duration",
  "late+duration_known":           "late_long_duration",
  "late+short_duration":           "late_period",
  "late+pelvic":                   "late_with_pain",
  "late+severe_pelvic (ectopic risk)": "urgent",
  "late+pregnancy_signal":         "late_with_pregnancy_chance",
  "heavy+7days":                   "heavy_long",
  "heavy+severe":                  "heavy_bleeding",
  "heavy+moderate":                "heavy_bleeding",
  "heavy+mood":                    "heavy_bleeding",
  "pelvic+heavy":                  "heavy_with_dizziness",
  "pelvic+after_sex":              "pelvic_sex",
  "pelvic+severe":                 "pelvic_severe",
  "spotting+mid_cycle":            "spotting_midcycle",
  "spotting+pregnancy_chance":     "spotting_pregnancy",
  "spotting+discharge":            "spotting_with_symptoms",
  "spot+discharge":                "spotting_with_symptoms",
  "spot+pregnancy":                "spotting_pregnancy",
  "discharge_only":                "spotting_with_symptoms",
  "nausea+late":                   "late_with_pregnancy_chance",
  "mood+before_period":            "mood_before_period",
  "late+pregnancy_chance":         "late_with_pregnancy_chance",
};


// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function buildGuidanceResponse(entities, inferredReason = null) {
  const scenario = resolveScenario(entities, inferredReason);
  if (!scenario) return null;

  const situation   = SITUATION[scenario]   || null;
  const meaning     = MEANING[scenario]     || null;
  const nextSteps   = NEXT_STEPS[scenario]  || null;
  const urgentSigns = URGENT_SIGNS[scenario] || URGENT_SIGNS.default;

  if (!situation && !meaning) return null;

  // ── Assemble lines array for say() ───────────────────────────────────────
  const lines = [];

  if (situation)  lines.push(`📋 Possible situation: ${situation}`);
  if (meaning)    lines.push(`💡 What this may mean: ${meaning}`);
  if (nextSteps)  lines.push(`✅ What to do next: ${nextSteps}`);
  if (urgentSigns) lines.push(`⚠️ Seek urgent help if: ${urgentSigns.replace("Seek urgent help if: ", "")}`);

  lines.push("Remember: Bloomie provides educational information only — not a diagnosis. You know your body best 🩷");

  return {
    scenario,
    lines,
    structured: { situation, meaning, nextSteps, urgentSigns },
  };
}

function resolveScenario(entities, inferredReason) {
  if (inferredReason && REASON_TO_SCENARIO[inferredReason]) {
    return REASON_TO_SCENARIO[inferredReason];
  }

  if (!entities) return null;
  const { symptoms, severity, timing, pregnancy, urgent } = entities;
  const s = symptoms || {};

  if (urgent)                                           return "urgent";
  if (s.heavy && s.dizziness)                          return "heavy_with_dizziness";
  if (s.late && pregnancy?.chance && !pregnancy.testedYet) return "late_with_pregnancy_chance";
  if (s.late && severity === "severe" && s.pelvic)     return "late_with_pain";
  if (s.heavy && severity === "severe")                return "heavy_bleeding";
  if (s.spotting && s.discharge)                       return "spotting_with_symptoms";
  if (s.spotting && pregnancy?.chance)                 return "spotting_pregnancy";
  if (s.spotting && timing === "mid_cycle")            return "spotting_midcycle";
  if (s.pelvic && timing === "after_sex")              return "pelvic_sex";
  if (s.pelvic && severity === "severe")               return "pelvic_severe";
  if (s.pelvic && (severity === "mild" || !severity))  return "pelvic_mild";
  if (s.mood && timing === "before_period")            return "mood_before_period";
  if (s.mood)                                          return "mood_general";
  if (s.late)                                          return "late_period";
  if (s.heavy)                                         return "heavy_bleeding";
  if (s.spotting)                                      return "spotting_midcycle";

  return null;
}

export function getStructuredSummary(entities, inferredReason) {
  const response = buildGuidanceResponse(entities, inferredReason);
  if (!response) return null;
  return {
    scenario:   response.scenario,
    ...response.structured,
    extractedEntities: {
      symptoms:  Object.entries(entities.symptoms || {}).filter(([,v]) => v).map(([k]) => k),
      duration:  entities.duration ? `${entities.duration.value} ${entities.duration.unit}` : null,
      severity:  entities.severity,
      timing:    entities.timing,
      pregnancy: entities.pregnancy,
      urgent:    entities.urgent,
    },
  };
}