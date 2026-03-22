/**
 * bloomie-templates.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Guidance Response Layer for Bloomie.
 *
 * Instead of freeform text, every guidance response is assembled from
 * structured templates based on the inferred scenario. This makes responses:
 *   - consistent across sessions
 *   - safe (no hallucinated advice)
 *   - easy to review and audit
 *   - academically defensible
 *
 * Pipeline position:
 *   extractEntities()  →  inferRoute()  →  buildGuidanceResponse()  →  say()
 *
 * Usage in chat.js:
 *   import { buildGuidanceResponse } from "./bloomie-templates.js";
 *
 *   const entities  = extractEntities(normalizedText);
 *   const inferred  = inferRoute(entities);
 *   const guidance  = buildGuidanceResponse(entities, inferred?.payload?.reason);
 *
 *   if (guidance) {
 *     say(guidance.lines);
 *     // then transition as normal
 *   }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */


// ─── TEMPLATE PARTS ──────────────────────────────────────────────────────────
// Each section is a separate string so they can be mixed and matched.
// Keys map to scenario identifiers returned by inferRoute().

// ── Template resolution helper ────────────────────────────────────────────────
// Entries can be plain strings OR (cycleCtx) => string functions.
// When they are functions, cycleCtx is passed in — if null/missing the function
// falls back to generic copy internally.
function resolve(template, cx) {
  if (!template) return null;
  return typeof template === "function" ? template(cx) : template;
}

const SITUATION = {
  late_period: (cx) => {
    if (cx?.daysLate > 0) {
      return `Your period is currently **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} late** — your tracked cycle averages **${cx.cycleLength} days** and you're on day **${cx.dayOfCycle}**.`;
    }
    if (cx?.dayOfCycle && cx?.cycleLength && cx.dayOfCycle >= cx.cycleLength - 2) {
      return `You're on day **${cx.dayOfCycle}** of your **${cx.cycleLength}-day cycle** — your period is due now or may be a little late.`;
    }
    return "Your period appears to be late or hasn't arrived yet.";
  },
  late_with_pain:
    "Your period is late and you also mentioned pain or discomfort.",
  late_with_pregnancy_chance: (cx) => {
    if (cx?.daysLate > 0) {
      return `Your period is **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} late** based on your **${cx.cycleLength}-day cycle** — and there may be a chance of pregnancy.`;
    }
    return "Your period is late and there may be a chance of pregnancy.";
  },
  late_long_duration: (cx) => {
    if (cx?.daysLate >= 7) {
      return `Your period is **${cx.daysLate} days late** — significantly past your typical **${cx.cycleLength}-day cycle**.`;
    }
    return "Your period is significantly overdue — more than a week or two.";
  },
  heavy_bleeding:
    "You're experiencing heavier bleeding than usual.",
  heavy_with_dizziness:
    "You're experiencing heavy bleeding along with dizziness or weakness.",
  heavy_long:
    "Your heavy bleeding has been going on for more than 7 days.",
  spotting_midcycle: (cx) => {
    if (cx?.dayOfCycle && cx?.cycleLength) {
      const ovDay = Math.round(cx.cycleLength / 2);
      return `You're on day **${cx.dayOfCycle}** of a **${cx.cycleLength}-day cycle** — ovulation typically falls around day ${ovDay - 1}–${ovDay + 1}, which lines up with midcycle spotting.`;
    }
    return "You're noticing light spotting around the middle of your cycle.";
  },
  spotting_with_symptoms:
    "You're spotting and also experiencing other symptoms.",
  spotting_pregnancy:
    "You're spotting and there's a possibility of pregnancy.",
  pelvic_mild: (cx) => {
    if (cx?.dayOfCycle) {
      if (cx.dayOfCycle <= 5) {
        return `You're on day **${cx.dayOfCycle}** of your cycle — pelvic pain and cramps in the first few days of a period are very common.`;
      }
      const ovDay = cx.cycleLength ? Math.round(cx.cycleLength / 2) : 14;
      if (Math.abs(cx.dayOfCycle - ovDay) <= 2) {
        return `You're on day **${cx.dayOfCycle}** — close to your typical ovulation window. Some people feel mild cramping during ovulation (mittelschmerz).`;
      }
    }
    return "You're experiencing pelvic pain or cramps that feel manageable.";
  },
  pelvic_severe:
    "You're experiencing severe or persistent pelvic pain.",
  pelvic_sex:
    "You're experiencing pain during or after sex.",
  mood_before_period: (cx) => {
    if (cx?.dayOfCycle && cx?.cycleLength) {
      const daysUntil = cx.cycleLength - cx.dayOfCycle;
      if (daysUntil >= 0 && daysUntil <= 10) {
        return `You're on day **${cx.dayOfCycle}** of your **${cx.cycleLength}-day cycle** — about **${daysUntil} day${daysUntil === 1 ? "" : "s"}** before your next expected period. The luteal phase is when PMS symptoms tend to be strongest.`;
      }
    }
    return "You're noticing mood changes, fatigue, or emotional shifts — especially before your period.";
  },
  mood_general:
    "You're experiencing mood changes, low energy, or emotional heaviness.",
  pregnancy_concern:
    "You have a concern related to possible pregnancy.",
  urgent:
    "You've described symptoms that may need prompt medical attention.",
};

const MEANING = {
  late_period: (cx) => {
    if (cx?.daysLate > 0) {
      return `Based on your tracked cycle of **${cx.cycleLength} days**, you're about **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} past your expected window**. A late period can happen for many reasons — stress, changes in routine, illness, or natural hormonal shifts.`;
    }
    return "A late period can happen for many reasons — stress, changes in routine, illness, travel, or natural hormonal shifts. It doesn't always mean something is wrong.";
  },
  late_with_pain:
    "A late period combined with pelvic pain can sometimes point to hormonal shifts, but in some cases it may need closer attention — especially if the pain is severe or one-sided.",
  late_with_pregnancy_chance: (cx) => {
    if (cx?.daysLate > 0) {
      return `You're **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} past** your expected period based on a **${cx.cycleLength}-day cycle**. When a period is late and pregnancy is possible, a test is the clearest first step — tests are most accurate from the day your period was expected.`;
    }
    return "When a period is late and pregnancy is possible, a pregnancy test is the clearest first step. Tests are most accurate from the day your period was expected.";
  },
  late_long_duration: (cx) => {
    if (cx?.daysLate >= 7) {
      return `You're **${cx.daysLate} days past** your expected period window of **${cx.cycleLength} days**. When a period is this late, it's worth exploring the cause — this can include stress, significant weight changes, hormonal imbalance, or possible pregnancy.`;
    }
    return "When a period is more than one to two weeks late, it's worth exploring the cause — this can include stress, significant weight changes, hormonal imbalance, or possible pregnancy.";
  },
  heavy_bleeding:
    "Some people naturally have heavier flow, especially early in a period. However, flow that soaks through products quickly or lasts longer than 7 days can sometimes signal an underlying cause worth checking.",
  heavy_with_dizziness:
    "Heavy bleeding combined with dizziness or weakness can be a sign that your body needs support — this combination can sometimes lead to low iron or other concerns.",
  heavy_long:
    "Bleeding that goes on for more than a week can mean the uterus is having trouble completing the cycle, or that hormones are out of balance.",
  spotting_midcycle: (cx) => {
    if (cx?.dayOfCycle && cx?.cycleLength) {
      const ovDay = Math.round(cx.cycleLength / 2);
      return `Light spotting around day ${ovDay - 1}–${ovDay + 1} of a ${cx.cycleLength}-day cycle is often an ovulation sign — a small hormone dip can cause brief, light bleeding. You're on day **${cx.dayOfCycle}**, so this timing fits.`;
    }
    return "Light spotting in the middle of the cycle is often related to ovulation — a small hormone dip can cause brief, light bleeding. This is common and usually harmless.";
  },
  spotting_with_symptoms:
    "Spotting alongside other symptoms like pain, unusual discharge, or fever can sometimes mean irritation, infection, or a hormonal change worth checking.",
  spotting_pregnancy:
    "Light spotting can sometimes occur in early pregnancy. A test can help clarify what's happening.",
  pelvic_mild: (cx) => {
    if (cx?.dayOfCycle && cx.dayOfCycle <= 5) {
      return `On day **${cx.dayOfCycle}** of your cycle, pelvic pain is most commonly caused by the uterus contracting to shed its lining — this is prostaglandin-driven and very normal. Comfort measures usually help.`;
    }
    return "Mild pelvic pain around your period is very common and often related to the uterus contracting. Comfort measures usually help.";
  },
  pelvic_severe:
    "Persistent or severe pelvic pain that doesn't respond to rest or relief deserves medical attention. This doesn't automatically mean something serious — but pain shouldn't be dismissed.",
  pelvic_sex:
    "Pain during or after sex can be related to muscle tension, dryness, hormonal shifts, or other causes. It's more common than people talk about and is something a healthcare provider can help with.",
  mood_before_period: (cx) => {
    if (cx?.dayOfCycle && cx?.cycleLength) {
      const daysUntil = cx.cycleLength - cx.dayOfCycle;
      if (daysUntil >= 0 && daysUntil <= 10) {
        return `Mood shifts, fatigue, and emotional heaviness in the **${daysUntil > 0 ? `${daysUntil} days` : "final days"}** before a period are real hormonal responses — not a sign of weakness. They're driven by the progesterone drop in the late luteal phase and are often linked to PMS or PMDD.`;
      }
    }
    return "Mood shifts, fatigue, and emotional heaviness before a period are real hormonal responses — not a sign of weakness. They're often linked to PMS or PMDD and can be supported.";
  },
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

// FIX #10: Standardized URGENT_SIGNS so ALL entries are plain descriptive
// text — no "Seek urgent help if:" prefix embedded inside the strings.
// The prefix is now added once in buildGuidanceResponse, making the output
// consistent for every scenario. Previously "heavy_with_dizziness" started
// with "This combination warrants..." causing the assembled line to read
// "Seek urgent help if: This combination warrants urgent care..." which was
// grammatically broken.
const URGENT_SIGNS = {
  late_period:
    "pain becomes severe, you feel faint, you have heavy bleeding, or you develop severe one-sided pelvic pain.",
  late_with_pain:
    "the pain becomes severe or one-sided, you feel faint or dizzy, or bleeding starts and is heavy.",
  late_with_pregnancy_chance:
    "you develop severe one-sided pain, heavy bleeding, or feel faint — these can be signs of an ectopic pregnancy.",
  heavy_bleeding:
    "you're soaking through a pad or tampon in under 2 hours for 2+ hours in a row, or you feel faint, dizzy, or short of breath.",
  heavy_with_dizziness:
    "symptoms are not improving — this combination warrants urgent care. Go to a clinic or emergency service.",
  heavy_long:
    "you develop dizziness, weakness, or shortness of breath alongside the prolonged bleeding.",
  spotting_midcycle:
    "the spotting becomes heavier, lasts more than a few days, or comes with pain, fever, or unusual discharge.",
  spotting_with_symptoms:
    "spotting becomes heavy bleeding, you develop fever, severe pain, or foul-smelling discharge.",
  spotting_pregnancy:
    "you have severe pain, heavy bleeding, or dizziness alongside the spotting.",
  pelvic_mild:
    "pain suddenly worsens, becomes one-sided, or comes with fever, heavy bleeding, or faintness.",
  pelvic_severe:
    "pain is sudden and severe, especially one-sided — this can sometimes signal an ectopic pregnancy or other urgent condition.",
  pelvic_sex:
    "pain is severe, worsening, or accompanied by bleeding, fever, or dizziness.",
  mood_before_period:
    "you are feeling unsafe or having thoughts of harming yourself — please reach out to emergency services (119 in Jamaica) or a trusted person.",
  mood_general:
    "you're feeling unsafe or having thoughts of harming yourself. Please reach out to emergency services (119 in Jamaica) or a trusted person right away.",
  pregnancy_concern:
    "you develop severe one-sided pain, heavy bleeding, or feel faint — seek emergency care immediately.",
  urgent:
    "symptoms are present — please seek care now. Go to the nearest emergency department or call emergency services (119 in Jamaica).",
  default:
    "symptoms worsen, you feel faint, develop fever, or have severe pain — please seek medical care promptly.",
};


// ─── SCENARIO MAP ─────────────────────────────────────────────────────────────
// Maps inference reasons (from inferRoute payload) to template keys.
// Falls back to entity-based scenario detection if no reason is provided.

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

/**
 * buildGuidanceResponse(entities, inferredReason) → GuidanceResponse | null
 *
 * Assembles a structured guidance response from templates based on
 * the inferred scenario.
 *
 * Returns:
 * {
 *   scenario:  string,          // which scenario was matched
 *   lines:     string[],        // array ready to pass straight into say()
 *   structured: {               // full structured object (for PDF / logging)
 *     situation, meaning, nextSteps, urgentSigns
 *   }
 * }
 *
 * Returns null if no scenario could be determined (fall through to decision tree).
 */
export function buildGuidanceResponse(entities, inferredReason = null, cycleCtx = null) {
  const scenario = resolveScenario(entities, inferredReason);
  if (!scenario) return null;

  const situation   = resolve(SITUATION[scenario], cycleCtx)  || null;
  const meaning     = resolve(MEANING[scenario],   cycleCtx)  || null;
  const nextSteps   = NEXT_STEPS[scenario]                    || null;
  // urgentSigns entries no longer embed the "Seek urgent help if:" prefix —
  // it is added here once, consistently, for every scenario.
  const urgentSigns = URGENT_SIGNS[scenario] || URGENT_SIGNS.default;

  if (!situation && !meaning) return null;

  // ── Assemble lines array for say() ───────────────────────────────────────
  const lines = [];

  if (situation)   lines.push(` Possible situation: ${situation}`);
  if (meaning)     lines.push(` What this may mean: ${meaning}`);
  if (nextSteps)   lines.push(` What to do next: ${nextSteps}`);
  if (urgentSigns) lines.push(` Seek urgent help if: ${urgentSigns}`);

  lines.push("Remember: Bloomie provides educational information only — not a diagnosis. You know your body best 🩷");

  return {
    scenario,
    lines,
    structured: { situation, meaning, nextSteps, urgentSigns },
  };
}

/**
 * resolveScenario(entities, inferredReason) → string | null
 *
 * Determines which scenario key to use, in priority order:
 * 1. Explicit reason from inferRoute() payload
 * 2. Entity-based scenario detection (fallback)
 */
function resolveScenario(entities, inferredReason) {
  // Priority 1: use the reason string from inferRoute
  if (inferredReason && REASON_TO_SCENARIO[inferredReason]) {
    return REASON_TO_SCENARIO[inferredReason];
  }

  // Priority 2: derive from entities directly
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


// ─── UTILITY: get just the structured object for PDF export ──────────────────

/**
 * getStructuredSummary(entities, inferredReason) → object | null
 * Useful for building the PDF export / provider summary.
 */
export function getStructuredSummary(entities, inferredReason, cycleCtx = null) {
  const response = buildGuidanceResponse(entities, inferredReason, cycleCtx);
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