import { softenEscalationLine } from "./bloomie-response-layers.js";

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
// When they are functions, cycleCtx is passed in - if null/missing the function
// falls back to generic copy internally.
function resolve(template, cx) {
  if (!template) return null;
  return typeof template === "function" ? template(cx) : template;
}

const SITUATION = {
  late_period: (cx) => {
    if (cx?.daysLate > 0) {
      return `Your period is currently **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} late** - your tracked cycle averages **${cx.cycleLength} days** and you're on day **${cx.dayOfCycle}**.`;
    }
    if (cx?.dayOfCycle && cx?.cycleLength && cx.dayOfCycle >= cx.cycleLength - 2) {
      return `You're on day **${cx.dayOfCycle}** of your **${cx.cycleLength}-day cycle** - your period is due now or may be a little late.`;
    }
    return "Your period appears to be late or hasn't arrived yet.";
  },
  late_with_pain:
    "Your period is late and you also mentioned pain or discomfort.",
  late_with_pregnancy_chance: (cx) => {
    if (cx?.daysLate > 0) {
      return `Your period is **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} late** based on your **${cx.cycleLength}-day cycle** - and there may be a chance of pregnancy.`;
    }
    return "Your period is late and there may be a chance of pregnancy.";
  },
  late_long_duration: (cx) => {
    if (cx?.daysLate >= 7) {
      return `Your period is **${cx.daysLate} days late** - significantly past your typical **${cx.cycleLength}-day cycle**.`;
    }
    return "Your period is significantly overdue - more than a week or two.";
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
      return `You're on day **${cx.dayOfCycle}** of a **${cx.cycleLength}-day cycle** - ovulation typically falls around day ${ovDay - 1}–${ovDay + 1}, which lines up with midcycle spotting.`;
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
        return `You're on day **${cx.dayOfCycle}** of your cycle - pelvic pain and cramps in the first few days of a period are very common.`;
      }
      const ovDay = cx.cycleLength ? Math.round(cx.cycleLength / 2) : 14;
      if (Math.abs(cx.dayOfCycle - ovDay) <= 2) {
        return `You're on day **${cx.dayOfCycle}** - close to your typical ovulation window. Some people feel mild cramping during ovulation (mittelschmerz).`;
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
        return `You're on day **${cx.dayOfCycle}** of your **${cx.cycleLength}-day cycle** - about **${daysUntil} day${daysUntil === 1 ? "" : "s"}** before your next expected period. The luteal phase is when PMS symptoms tend to be strongest.`;
      }
    }
    return "You're noticing mood changes, fatigue, or emotional shifts - especially before your period.";
  },
  mood_general:
    "You're experiencing mood changes, low energy, or emotional heaviness.",
  pregnancy_concern:
    "You have a concern related to possible pregnancy.",
  discharge_clear_watery:
    "Okay 🩷 I see what you're describing - that sudden wet or \"gush\" feeling with clear or stringy discharge can definitely catch you off guard.",
  discharge_thick_clumpy:
    "Thick, clumpy discharge can look like small white pieces or feel heavier than your usual discharge.",
  discharge_concern:
    "I hear you 🩷 - discharge with a noticeable yellow, green, or gray color, or a strong smell, can feel worrying.",
  discharge_brown_blood_tinged:
    "Brown or slightly blood-tinged discharge is usually older blood mixing with cervical fluid.",
  blood_colour_bright_red:
    "Bright or fresh red blood usually means the blood is newer and flowing more actively.",
  blood_colour_dark_old:
    "Darker blood - deep red, brown, or almost black - usually means the blood has taken longer to leave the body.",
  blood_colour_pink:
    "Pink blood is usually a lighter mix of blood and cervical fluid.",
  blood_colour_concern:
    "Orange-tinted or gray-looking blood is less common, especially if it appears with unusual discharge, smell, or discomfort.",
  urgent:
    "You've described symptoms that may need prompt medical attention.",
  perimenopause_concern: () => {
    const openers = [
      "It takes courage to name what might be happening 🩷 Perimenopause is a real transition and you deserve real support.",
      "What you're describing can sometimes be part of a hormonal transition - and it's worth taking seriously.",
      "These symptoms are real, and they can be part of a significant hormonal shift many people go through.",
    ];
    return openers[Math.floor(Math.random() * openers.length)];
  },
  menopause_info:
    "Reaching menopause - 12 consecutive months without a period - is a significant transition, not an illness.",
};

const MEANING = {
  late_period: (cx) => {
    if (cx?.daysLate > 0) {
      return `Based on your tracked cycle of **${cx.cycleLength} days**, you're about **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} past your expected window**. A late period can happen for many reasons - stress, changes in routine, illness, or natural hormonal shifts.`;
    }
    return "A late period can happen for many reasons - stress, changes in routine, illness, travel, or natural hormonal shifts. It doesn't always mean something is wrong.";
  },
  late_with_pain:
    "A late period combined with pelvic pain can sometimes point to hormonal shifts, but in some cases it may need closer attention - especially if the pain is severe or one-sided.",
  late_with_pregnancy_chance: (cx) => {
    if (cx?.daysLate > 0) {
      return `You're **${cx.daysLate} day${cx.daysLate === 1 ? "" : "s"} past** your expected period based on a **${cx.cycleLength}-day cycle**. When a period is late and pregnancy is possible, a test is the clearest first step - tests are most accurate from the day your period was expected.`;
    }
    return "When a period is late and pregnancy is possible, a pregnancy test is the clearest first step. Tests are most accurate from the day your period was expected.";
  },
  late_long_duration: (cx) => {
    if (cx?.daysLate >= 7) {
      return `You're **${cx.daysLate} days past** your expected period window of **${cx.cycleLength} days**. When a period is this late, it's worth exploring the cause - this can include stress, significant weight changes, hormonal imbalance, or possible pregnancy.`;
    }
    return "When a period is more than one to two weeks late, it's worth exploring the cause - this can include stress, significant weight changes, hormonal imbalance, or possible pregnancy.";
  },
  heavy_bleeding:
    "Some people naturally have heavier flow, especially early in a period. However, flow that soaks through products quickly or lasts longer than 7 days can sometimes signal an underlying cause worth checking.",
  heavy_with_dizziness:
    "Heavy bleeding combined with dizziness or weakness can be a sign that your body needs support - this combination can sometimes lead to low iron or other concerns.",
  heavy_long:
    "Bleeding that goes on for more than a week can mean the uterus is having trouble completing the cycle, or that hormones are out of balance.",
  spotting_midcycle: (cx) => {
    if (cx?.dayOfCycle && cx?.cycleLength) {
      const ovDay = Math.round(cx.cycleLength / 2);
      return `Light spotting around day ${ovDay - 1}–${ovDay + 1} of a ${cx.cycleLength}-day cycle is often an ovulation sign - a small hormone dip can cause brief, light bleeding. You're on day **${cx.dayOfCycle}**, so this timing fits.`;
    }
    return "Light spotting in the middle of the cycle is often related to ovulation - a small hormone dip can cause brief, light bleeding. This is common and usually harmless.";
  },
  spotting_with_symptoms:
    "Spotting alongside other symptoms like pain, unusual discharge, or fever can sometimes mean irritation, infection, or a hormonal change worth checking.",
  spotting_pregnancy:
    "Light spotting can sometimes occur in early pregnancy. A test can help clarify what's happening.",
  pelvic_mild: (cx) => {
    if (cx?.dayOfCycle && cx.dayOfCycle <= 5) {
      return `On day **${cx.dayOfCycle}** of your cycle, pelvic pain is most commonly caused by the uterus contracting to shed its lining - this is prostaglandin-driven and very normal. Comfort measures usually help.`;
    }
    return "Mild pelvic pain around your period is very common and often related to the uterus contracting. Comfort measures usually help.";
  },
  pelvic_severe:
    "Persistent or severe pelvic pain that doesn't respond to rest or relief deserves medical attention. This doesn't automatically mean something serious - but pain shouldn't be dismissed.",
  pelvic_sex:
    "Pain during or after sex can be related to muscle tension, dryness, hormonal shifts, or other causes. It's more common than people talk about and is something a healthcare provider can help with.",
  mood_before_period: (cx) => {
    if (cx?.dayOfCycle && cx?.cycleLength) {
      const daysUntil = cx.cycleLength - cx.dayOfCycle;
      if (daysUntil >= 0 && daysUntil <= 10) {
        return `Mood shifts, fatigue, and emotional heaviness in the **${daysUntil > 0 ? `${daysUntil} days` : "final days"}** before a period are real hormonal responses - not a sign of weakness. They're driven by the progesterone drop in the late luteal phase and are often linked to PMS or PMDD.`;
      }
    }
    return "Mood shifts, fatigue, and emotional heaviness before a period are real hormonal responses - not a sign of weakness. They're often linked to PMS or PMDD and can be supported.";
  },
  mood_general:
    "Persistent low energy, mood shifts, or emotional difficulty - even outside of your period - can sometimes be connected to hormonal patterns or other factors worth tracking.",
  perimenopause_concern:
    "Perimenopause is the transition leading up to menopause - your hormones are shifting, and that shift causes real, sometimes confusing symptoms. This can begin in the mid-30s and typically spans several years.",
  menopause_info:
    "The hormonal changes that come with menopause are real - estrogen levels drop, and that affects many systems in the body. Symptoms like hot flashes, sleep disruption, and vaginal changes are well-documented and treatable.",
  pregnancy_concern:
    "Pregnancy concerns are best addressed with clear information and a test when the timing is right.",
  discharge_clear_watery:
    "Clear, stretchy, or very watery discharge is often cervical mucus, and it commonly shows up around ovulation or when estrogen is higher. Sometimes it comes out all at once when you stand or move, which can make it feel like your period suddenly started.",
  discharge_thick_clumpy:
    "This pattern can sometimes be linked to yeast overgrowth, especially when it comes with itching, burning, irritation, or soreness.",
  discharge_concern:
    "Your body is usually pretty consistent with discharge, so color or smell changes like this are worth paying attention to. It does not automatically mean something serious, but it can point to an imbalance or infection that is better checked.",
  discharge_brown_blood_tinged:
    "This can happen before or after a period, or sometimes around ovulation. It is generally common unless it keeps recurring, becomes heavier, or comes with other symptoms.",
  blood_colour_bright_red:
    "This is most common at the start of a period or on heavier flow days, and it can be a normal part of bleeding.",
  blood_colour_dark_old:
    "This is very common toward the end of a period or when flow is slower.",
  blood_colour_pink:
    "It can happen with light spotting, at the start of a period, or sometimes around ovulation.",
  blood_colour_concern:
    "That color can sometimes happen when blood mixes with discharge, but gray or orange changes are worth checking if they are new for you.",
  urgent:
    "Symptoms like heavy bleeding with dizziness, severe one-sided pain, fainting, or fever alongside bleeding can signal that your body needs prompt support.",
};

const NEXT_STEPS = {
  late_period:
    "Continue tracking your cycle. If your period doesn't arrive in the next few days, consider checking for pregnancy if relevant, or reflect on recent changes like stress or illness.",
  late_with_pain:
    "Note whether the pain is one-sided or worsening. If pregnancy is possible, a test is recommended. If pain becomes severe, seek care sooner.",
  late_with_pregnancy_chance:
    "Take a pregnancy test - ideally the day after your expected period or later for best accuracy. If the result is negative but your period still doesn't come, retest in 48–72 hours.",
  late_long_duration:
    "Consider speaking with a healthcare provider if your period is more than two weeks late and pregnancy has been ruled out. Tracking symptoms helps explain the situation clearly.",
  heavy_bleeding:
    "Track how often you're changing products and whether you're passing clots. If flow soaks through products in under 2 hours or lasts more than 7 days, it's worth getting checked.",
  heavy_with_dizziness:
    "Rest, hydrate, and avoid overexertion. If you feel faint, have shortness of breath, or bleeding is not slowing, seek medical care as soon as possible.",
  heavy_long:
    "Speak with a healthcare provider. They can check for hormonal imbalances, uterine causes, or low iron. Tracking the number of days and product usage helps at a visit.",
  spotting_midcycle:
    "Track the spotting - color, amount, and how many days it lasts. Midcycle spotting that's brief and light usually resolves on its own.",
  spotting_with_symptoms:
    "If symptoms persist or worsen - especially discharge with odor, fever, or worsening pain - speak with a healthcare provider soon.",
  spotting_pregnancy:
    "A pregnancy test can help clarify what's happening. If you have severe pain, heavy bleeding, or dizziness alongside the spotting, seek care urgently.",
  pelvic_mild:
    "Use heat, rest, and over-the-counter relief if needed. Track when pain occurs in your cycle. If it's getting worse across cycles, mention it to a provider.",
  pelvic_severe:
    "Speak with a healthcare provider, especially if the pain is worsening, not responding to relief, or interfering with daily life. Conditions like endometriosis are only diagnosable with medical evaluation.",
  pelvic_sex:
    "You don't have to push through pain during sex. A healthcare provider or pelvic floor specialist can help identify the cause and offer support.",
  mood_before_period:
    "Track your mood alongside your cycle days to confirm the pattern. Small lifestyle supports - sleep, hydration, light movement - can help. If it's severe or interfering with daily life, speak with a provider.",
  mood_general:
    "Track your mood and energy patterns over a few weeks. If low mood or exhaustion is persistent, it may be worth talking to a healthcare provider or counselor.",
  perimenopause_concern:
    "Track your symptoms - cycle dates, symptom types, intensity, and timing. This pattern data is invaluable when talking to a provider. If symptoms are affecting your daily life significantly, that's the signal to seek support.",
  menopause_info:
    "Discuss bone health, cardiovascular changes, and ongoing symptoms with a provider. Lifestyle support (movement, sleep, nutrition) and medical options are both worth exploring - there are real options, not just 'pushing through it'.",
  pregnancy_concern:
    "A pregnancy test is the clearest first step. Test timing matters - the day after a missed period or later gives the most accurate result.",
  discharge_clear_watery:
    "If there is no strong smell, itching, pain, or unusual color, this is usually just your body doing its thing. If any of those show up later, it would be worth checking.",
  discharge_thick_clumpy:
    "If you are not feeling discomfort, you can keep an eye on it. If itching, burning, soreness, or irritation is present, it would be a good idea to get checked.",
  discharge_concern:
    "A provider can help confirm whether it is an infection or imbalance and guide treatment if needed. If itching, irritation, pelvic pain, or discomfort is also present, that makes it more important to check in.",
  discharge_brown_blood_tinged:
    "Track when it happens, the color, and whether it lines up with your period or ovulation timing. If it keeps happening outside your usual pattern, mention it to a provider.",
  blood_colour_bright_red:
    "Track the amount and how quickly you are changing products. If the flow is very heavy or comes with dizziness, that needs more support.",
  blood_colour_dark_old:
    "Keep tracking the color and flow. If dark bleeding has a strong smell, severe pain, or happens unexpectedly outside your usual pattern, it is worth checking.",
  blood_colour_pink:
    "Track whether it stays light, how long it lasts, and where you are in your cycle. If it becomes heavy or comes with pain, dizziness, or a strong smell, get support.",
  blood_colour_concern:
    "It would be a good idea to get this checked, especially if there is a strong smell, itching, pelvic pain, fever, or the color keeps showing up.",
  urgent:
    "Please seek medical care as soon as possible - a clinic, urgent care, or emergency service. You can use the care map to find nearby options.",
};

// FIX #10: Standardized URGENT_SIGNS so ALL entries are plain descriptive
// text - no "Seek urgent help if:" prefix embedded inside the strings.
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
    "you develop severe one-sided pain, heavy bleeding, or feel faint - these can be signs of an ectopic pregnancy.",
  heavy_bleeding:
    "you're soaking through a pad or tampon in under 2 hours for 2+ hours in a row, or you feel faint, dizzy, or short of breath.",
  heavy_with_dizziness:
    "symptoms are not improving - this combination warrants urgent care. Go to a clinic or emergency service.",
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
    "pain is sudden and severe, especially one-sided - this can sometimes signal an ectopic pregnancy or other urgent condition.",
  pelvic_sex:
    "pain is severe, worsening, or accompanied by bleeding, fever, or dizziness.",
  mood_before_period:
    "you are feeling unsafe or having thoughts of harming yourself - please reach out to emergency services (119 in Jamaica) or a trusted person.",
  mood_general:
    "you're feeling unsafe or having thoughts of harming yourself. Please reach out to emergency services (119 in Jamaica) or a trusted person right away.",
  perimenopause_concern:
    "bleeding becomes very heavy, you develop severe pelvic pain, or symptoms suddenly worsen - seek care promptly. Also see a provider if periods have been absent for 12 months (menopause marker) or if you are under 40 and experiencing these changes (early menopause should be evaluated).",
  menopause_info:
    "you develop heavy or irregular bleeding after periods have stopped, or have bone pain, chest pain, or severe mood changes - these warrant prompt medical evaluation.",
  pregnancy_concern:
    "you develop severe one-sided pain, heavy bleeding, or feel faint - seek emergency care immediately.",
  discharge_clear_watery:
    "you notice a strong smell, itching, pelvic pain, green or gray color, or the discharge feels very different from your usual pattern.",
  discharge_thick_clumpy:
    "itching, burning, soreness, pelvic pain, fever, or a strong smell is present.",
  discharge_concern:
    "you have pelvic pain, fever, worsening irritation, or the discharge is green or gray with a strong smell.",
  discharge_brown_blood_tinged:
    "bleeding becomes heavy, pain is severe, you feel faint, or the spotting keeps happening outside your usual pattern.",
  blood_colour_bright_red:
    "you are soaking through protection quickly, passing large clots, feeling dizzy, or bleeding is not slowing.",
  blood_colour_dark_old:
    "dark bleeding comes with a strong smell, severe pain, dizziness, or heavy flow.",
  blood_colour_pink:
    "spotting becomes heavy bleeding, lasts more than a few days, or comes with pain, fever, or unusual discharge.",
  blood_colour_concern:
    "gray blood, strong smell, pelvic pain, fever, or worsening discomfort is present.",
  urgent:
    "symptoms are present - please seek care now. Go to the nearest emergency department or call emergency services (119 in Jamaica).",
  default:
    "symptoms worsen, you feel faint, develop fever, or have severe pain - please seek medical care promptly.",
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
  "DISCHARGE_CONCERN":             "discharge_concern",
  "URGENT_SYMPTOM_CHECK":          "urgent",
  "discharge_concern":             "discharge_concern",
  "urgent_symptom_check":          "urgent",
  "nausea+late":                   "late_with_pregnancy_chance",
  "mood+before_period":            "mood_before_period",
  "late+pregnancy_chance":         "late_with_pregnancy_chance",
  "peri_mention":                  "perimenopause_concern",
  "menopause_mention":             "menopause_info",
  "peri_symptom_cluster":          "perimenopause_concern",
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
// Scenarios where tone-wording adjustments must NEVER be applied (emergency/safety).
const SAFETY_SCENARIOS = new Set(["urgent", "heavy_with_dizziness", "heavy_long"]);

const DISCHARGE_COLOR_FLAGS = new Set(["yellow", "green", "gray"]);
const BLOOD_COLOUR_CONCERN_FLAGS = new Set(["orange_tinge", "gray"]);

function resolveDischargeScenario(entities) {
  const selections = entities?.domainSelections?.discharge || [];
  const has = (code) => selections.includes(code);
  const hasColorFlag = selections.some((code) => DISCHARGE_COLOR_FLAGS.has(code));

  if (has("green") || has("gray") || (has("foul_smell") && hasColorFlag)) return "discharge_concern";
  if (has("yellow") || has("foul_smell")) return "discharge_concern";
  if (has("thick_clumpy")) return "discharge_thick_clumpy";
  if (has("brown") || has("blood_tinged")) return "discharge_brown_blood_tinged";
  if (has("watery") || has("eggwhite") || has("increased_volume") || has("creamy")) return "discharge_clear_watery";
  return "discharge_clear_watery";
}

function resolveBloodColourScenario(entities) {
  const selections = entities?.domainSelections?.blood_colour || [];
  const symptoms = entities?.symptoms || {};
  const raw = String(entities?.raw || "").toLowerCase();
  const has = (code) => selections.includes(code);

  if (/\b(gray|grey|orange)\b/.test(raw)) {
    return "blood_colour_concern";
  }
  if (has("bright_red") || has("light_red") || symptoms.blood_colour_bright) {
    return "blood_colour_bright_red";
  }
  if (has("pink") || symptoms.blood_colour_pink) {
    return "blood_colour_pink";
  }
  if (/\b(black|brown|dark red|deep red|wine color|wine colour|wine red)\b/.test(raw)) {
    return "blood_colour_dark_old";
  }
  if (has("dark_red") || has("brown") || has("black") || symptoms.blood_colour_dark) {
    return "blood_colour_dark_old";
  }
  if (selections.some((code) => BLOOD_COLOUR_CONCERN_FLAGS.has(code)) || symptoms.blood_colour_concern) {
    return "blood_colour_concern";
  }
  return "blood_colour_dark_old";
}

function hasDischargeContext(entities) {
  const s = entities?.symptoms || {};
  return Boolean(
    entities?.domainSelections?.discharge?.length ||
    s.discharge || s.unusual_discharge || s.discharge_eggwhite ||
    s.discharge_creamy || s.discharge_sticky
  );
}

const CATALOG_CATEGORY_GUIDANCE = {
  bleeding: "Bleeding changes are worth tracking closely, especially if the amount, timing, or color is shifting from your usual pattern.",
  blood_colour: "Blood color can change across a cycle, and it often makes more sense when you look at timing, flow, and any other symptoms alongside it.",
  pain: "Pain symptoms deserve to be taken seriously, especially if they keep returning, feel stronger than usual, or start interfering with your day.",
  digestion: "Digestive symptoms can sometimes cluster around cycle shifts, stress, sleep changes, or other body changes, so they are useful to track together.",
  stool: "Bowel changes can show up alongside other cycle-related symptoms, so timing and recurrence matter.",
  discharge: "Discharge changes are often easiest to understand when you track color, texture, smell, and where they show up in your cycle.",
  energy: "Energy shifts are real body signals, and they are often more useful when tracked as a pattern instead of a one-off day.",
  physical: "Body changes like this can be worth tracking over time, especially if they keep showing up around the same part of your cycle.",
  urinary: "Urinary symptoms are worth paying attention to, especially if they cluster with pain, nausea, or discharge changes.",
  skin: "Skin changes can absolutely shift with hormones, stress, and cycle timing, so patterns matter more than any one day.",
  hair: "Hair changes usually make the most sense when tracked over time rather than judged from one moment alone.",
  temperature: "Temperature-related changes can be meaningful when they cluster with cycle timing, sleep shifts, or other symptoms.",
  mood: "Mood shifts are real body experiences, not overreactions, and they can be worth tracking alongside your cycle and energy.",
  mind: "Mind and focus changes are real too, and they often make more sense when you look at energy, sleep, and cycle timing together.",
  sleep: "Sleep changes can affect everything else, so it helps to notice whether they are showing up on their own or alongside mood, pain, or energy changes.",
  social: "Social energy can shift with hormones, stress, and how your body is feeling overall, so it counts as a real symptom worth noticing.",
  cravings: "Cravings can be part of broader body shifts, and they often make more sense when logged with mood, energy, or timing.",
  fertility: "Fertility-related body signs are often most useful when tracked as a repeating pattern across a few cycles.",
  cycle: "Cycle-related symptoms are usually easiest to understand when you track timing, flow, and what else was happening in your body.",
  weight: "Weight and body-composition shifts usually make more sense as patterns over time than as a one-day signal.",
};

function formatCatalogLabelList(labels = []) {
  if (!labels.length) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function buildCatalogSymptomGuidance(entities, cycleCtx = null) {
  const matches = Array.isArray(entities?.catalogMatches) ? entities.catalogMatches : [];
  if (!matches.length) return null;

  const topMatches = matches.slice(0, 3);
  const labels = topMatches.map((match) => String(match.label || "").toLowerCase());
  const categories = [...new Set(topMatches.map((match) => String(match.category || "")))];
  const normalizedCategories = categories.map((category) =>
    String(category || "").trim().toLowerCase().replace(/\s+/g, "_")
  );

  const primaryCategory = normalizedCategories[0] || "symptoms";
  const categoryLine = CATALOG_CATEGORY_GUIDANCE[primaryCategory]
    || "That kind of symptom is worth paying attention to, especially if it keeps showing up or starts clustering with other changes.";

  const categoryPhrase = categories.length === 1
    ? `${categories[0].toLowerCase()} changes`
    : `${categories.slice(0, 2).map((category) => category.toLowerCase()).join(" and ")} changes`;

  const situation = labels.length === 1
    ? `I hear you 🩷 You mentioned ${labels[0]}.`
    : `I hear you 🩷 You mentioned ${formatCatalogLabelList(labels)}.`;

  const meaning = labels.length === 1
    ? `That fits under ${categoryPhrase}, and it is a real symptom worth noticing. ${categoryLine}`
    : `That sounds like a mix of ${categoryPhrase}, and those symptoms often make more sense together than in isolation. ${categoryLine}`;

  const nextSteps = cycleCtx?.dayOfCycle
    ? `Try to note when this is showing up, how strong it feels, and what else is happening in your cycle around day ${cycleCtx.dayOfCycle}. If it keeps repeating, that pattern becomes much more useful.`
    : "Try to note when this is showing up, how strong it feels, and what else is happening alongside it. If it keeps repeating, that pattern becomes much more useful.";

  const urgentSigns = primaryCategory === "pain"
    ? "the symptom becomes severe, sudden, one-sided, or starts interfering with normal activity."
    : primaryCategory === "bleeding" || primaryCategory === "blood_colour" || primaryCategory === "discharge"
    ? "you develop heavy bleeding, severe pain, dizziness, a strong smell, or the pattern suddenly feels much more intense than usual."
    : "the symptom becomes severe, sudden, or is showing up with other concerning changes like pain, dizziness, fainting, or fever.";

  return {
    scenario: "catalog_symptom_support",
    lines: [
      `${situation} ${meaning}`,
      `What might help: ${nextSteps}`,
      `One thing to watch for: if ${urgentSigns}`,
      "This is educational info, not a diagnosis - you know your body best 🩷",
    ],
    structured: { situation, meaning, nextSteps, urgentSigns },
  };
}

export function buildGuidanceResponse(entities, inferredReason = null, cycleCtx = null, tone = null, extraFooter = []) {
  const scenario = resolveScenario(entities, inferredReason);
  if (!scenario) {
    const catalogFallback = buildCatalogSymptomGuidance(entities, cycleCtx);
    if (!catalogFallback) return null;
    if (extraFooter.length) catalogFallback.lines.push(...extraFooter);
    return catalogFallback;
  }

  const situation   = resolve(SITUATION[scenario], cycleCtx)  || null;
  const meaning     = resolve(MEANING[scenario],   cycleCtx)  || null;
  let   nextSteps   = NEXT_STEPS[scenario]                    || null;
  const urgentSigns = URGENT_SIGNS[scenario] || URGENT_SIGNS.default;

  if (!situation && !meaning) return null;

  const isSafetyNode = SAFETY_SCENARIOS.has(scenario);

  // ── Assemble conversational lines for say() ───────────────────────────────
  // Internal reasoning stays internal. What the user sees should feel warm,
  // natural, and supportive - no clinical section headers.
  const lines = [];

  // ── Normalise tone aliases so callers can pass detectUserTone() values directly
  // irritable → angry (same calming, non-judgmental framing)
  // anxious   → exhausted (grounding + trimmed, don't overwhelm)
  const effectiveTone = tone === "irritable" ? "angry"
    : tone === "anxious"   ? "exhausted"
    : tone;

  // ── Tone: distressed - grounding reassurance before guidance ─────────────
  // Added before the situation line so the user feels held before receiving info.
  // Never applied to emergency/safety nodes.
  if (effectiveTone === "distressed" && !isSafetyNode) {
    lines.push("I'm really glad you told me 🩷 We can take this one step at a time together.");
  }

  // ── Tone: exhausted/anxious - brief orienting frame before content ────────
  if (effectiveTone === "exhausted" && !isSafetyNode) {
    lines.push("I'll keep this simple - just focus on what matters most right now.");
  }

  // Line 1: Situation + meaning merged into one fluid opener.
  // If both exist, join them with a space (they're complementary sentences).
  // Tone: frustrated/angry/irritable - prefix with direct validating acknowledgement.
  let combinedLine = "";
  if (situation && meaning) {
    combinedLine = `${situation} ${meaning}`;
  } else if (situation) {
    combinedLine = situation;
  } else if (meaning) {
    combinedLine = meaning;
  }

  if (combinedLine) {
    if ((effectiveTone === "frustrated" || effectiveTone === "angry") && !isSafetyNode) {
      lines.push(`You deserve clear answers. ${combinedLine}`);
    } else {
      lines.push(combinedLine);
    }
  }

  // Line 2: Practical next step - phrased as a natural suggestion, not a header.
  // Tone: exhausted/anxious - trim to max 2 sentences and soften the lead-in.
  if (nextSteps) {
    let stepsText = nextSteps;

    if (effectiveTone === "exhausted" && !isSafetyNode) {
      // Reduce to first 2 action sentences - don't overwhelm someone who's drained/anxious
      const sentences = stepsText.split(/\.\s+/).filter(Boolean);
      stepsText = sentences.slice(0, 2).join(". ").trim();
      if (!stepsText.endsWith(".")) stepsText += ".";
      lines.push(`When you have the energy - ${stepsText}`);
    } else {
      const starters = [
        "Going forward -",
        "A helpful next step:",
        "What might help:",
        "Here's what to consider:",
      ];
      const starter = starters[Math.floor(Math.random() * starters.length)];
      lines.push(`${starter} ${stepsText}`);
    }
  }

  // Line 3: Safety note - phrased as a gentle heads-up, not a clinical list item.
  // Only adds "if" if the urgentSigns text doesn't already start with one.
  if (urgentSigns) {
    const lower = urgentSigns.trim().toLowerCase();
    const alreadyStartsWithIf = lower.startsWith("if ") || lower.startsWith("this combination");
    if (alreadyStartsWithIf) {
      lines.push(`One thing to watch for: ${urgentSigns}`);
    } else {
      lines.push(`One thing to watch for: if ${urgentSigns}`);
    }
  }

  // Lines 4–5: Optional cycle personalisation - appended after main content,
  // before the disclaimer, only when callers supply them via cycleCtx.
  const cycleLine   = cycleCtx?.cycleLine   || null;
  const patternLine = cycleCtx?.patternLine || null;
  if (cycleLine)   lines.push(cycleLine);
  if (patternLine) lines.push(patternLine);

  // Line (last): Short, friendly disclaimer - no "Remember:" prefix.
  // Tone: angry/irritable - strip any exclamation marks from all lines (calm, steady).
  lines.push("This is educational info, not a diagnosis - you know your body best 🩷");

  if (effectiveTone === "angry" && !isSafetyNode) {
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i].replace(/!/g, ".");
    }
  }

  for (let i = 0; i < lines.length; i++) {
    lines[i] = softenEscalationLine(lines[i]);
  }

  if (extraFooter.length) lines.push(...extraFooter);

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
  const reason = inferredReason || "";

  if (reason === "DISCHARGE_EXPLANATION" || reason === "discharge_explanation" || reason === "discharge_only") {
    return resolveDischargeScenario(entities || {});
  }
  if (reason === "BLOOD_COLOUR_EXPLANATION" || reason === "blood_colour_explanation") {
    return resolveBloodColourScenario(entities || {});
  }

  // Priority 1: use the reason string from inferRoute
  if (reason && REASON_TO_SCENARIO[reason]) {
    return REASON_TO_SCENARIO[reason];
  }

  // Priority 2: derive from entities directly
  if (!entities) return null;
  const { symptoms, severity, timing, pregnancy, urgent } = entities;
  const s = symptoms || {};

  if (urgent)                                           return "urgent";
  if (entities?.domainSelections?.blood_colour?.length || s.blood_colour_any) return resolveBloodColourScenario(entities);
  if (hasDischargeContext(entities))                    return resolveDischargeScenario(entities);
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

  // Menopause / perimenopause detection
  if (s.menopause_mention)                             return "menopause_info";
  if (s.peri_mention)                                  return "perimenopause_concern";
  if (s.hot_flashes && s.night_sweats)                 return "perimenopause_concern";
  const periCluster = [s.hot_flashes, s.night_sweats, s.insomnia, s.vaginal_dryness, s.mood_rage, s.memory_issues, s.irregular].filter(Boolean).length;
  if (periCluster >= 3)                                return "perimenopause_concern";

  if (s.late)                                          return "late_period";
  if (s.heavy)                                         return "heavy_bleeding";
  if (s.spotting)                                      return "spotting_midcycle";

  return null;
}


// ─── MEDICAL SERIOUSNESS GUARD ───────────────────────────────────────────────
//
// Even after tone detection, messages containing heavy medical urgency signals
// must never receive a playful casual opener. hasMedicalSeriousness() checks
// both Patois and English forms so the guard works on mixed-language messages.

/**
 * hasMedicalSeriousness(text) → boolean
 *
 * Returns true if the message contains heavy bleeding, severe pain, fainting,
 * pregnancy concern, or other urgency signals that warrant a calm opener
 * regardless of detected tone.
 *
 * @param  {string} text - Raw or normalized user input
 * @returns {boolean}
 */
export function hasMedicalSeriousness(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    /\b(heavy bleed|bleeding heavy|soaking through|soaked through|bleeding through|bleed through)\b/.test(t) ||
    /\b(severe pain|pain.*severe|pain a kill|pain bad|hurt bad|belly a murder)\b/.test(t) ||
    /\b(faint\w*|passed out|pass out|passing out|nearly faint|mi faint|mi pass out)\b/.test(t) ||
    /\b(pregnant|pregnancy|might be pregnant|think.*pregnant|breed)\b/.test(t) ||
    /\b(can'?t breathe|cant breathe|shortness of breath|cant stand|can'?t stand)\b/.test(t) ||
    /\b(emergency|hospital|urgent care|bleed.*bad|a bleed bad|bleed nuff)\b/.test(t) ||
    /\b(collaps\w*|too weak to|ectopic|miscarr)\b/.test(t)
  );
}

// ─── TONE OPENERS ─────────────────────────────────────────────────────────────

const TONE_OPENER_POOLS = {
  distressed: [
    "Hey, take a breath with me for a second 🩷",
    "I hear you - and I want you to know you're not alone in this 🩷",
    "It's okay to feel overwhelmed. Let's figure this out together 🩷",
    "You came to the right place. Let's go through this step by step 🩷",
    "Whatever's going on, you don't have to figure it out alone 🩷",
    "I've got you. Let's take this one thing at a time 🩷",
  ],
  frustrated: [
    "I hear you - dealing with this repeatedly is exhausting 🩷",
    "That frustration makes complete sense. Let's see what's actually going on 🩷",
    "You shouldn't have to keep going through this. Let's look at it properly 🩷",
    "Okay, let's actually get to the bottom of this 🩷",
    "Your frustration is valid - you deserve real answers, not more runaround 🩷",
    "I get it. Let's stop going in circles and actually look at what's happening 🩷",
  ],
  exhausted: [
    "I can tell you're running low right now - I'll keep this gentle 🩷",
    "You don't have to have it together to talk to me 🩷",
    "Even when everything feels like too much, your health still matters 🩷",
    "Let's make this as easy as possible - I'll do the heavy lifting 🩷",
    "You're here and that takes something, even when you're drained 🩷",
    "Rest when you can. But let's sort this out first 🩷",
  ],
  angry: [
    "Whatever's got you upset - I'm not here to make it worse 🩷",
    "That anger is telling you something. Let's figure out what's actually going on 🩷",
    "You don't have to be calm to talk to me. Let's just look at what's happening 🩷",
    "I hear the frustration. Let's see if I can actually help 🩷",
    "Valid. Let's focus on what's going on with your body right now 🩷",
    "I'm not going anywhere. Tell me what's going on 🩷",
  ],
  casual: [
    "Hey! 🩷 Let's look at this -",
    "Okay okay, let's get into it 🩷",
    "You came to the right place 😄 Let's see what's going on -",
    "On it 🩷",
    "Let's figure this out together -",
    "Say less, I got you 🩷",
  ],
  // ── Tone aliases - separate pools so callers can pass these directly ─────
  // anxious: grounding and structured; keep sentences short and concrete.
  anxious: [
    "Take a breath - I'm here and we'll work through this together 🩷",
    "You're in the right place. Let's take this one small step at a time 🩷",
    "I've got you. Let's just focus on one thing at a time 🩷",
    "It's okay to feel uncertain right now. Let me help you think through this 🩷",
    "You don't have to figure this all out at once - let's start with what feels most pressing 🩷",
    "Let's slow this down and go through it together 🩷",
  ],
  // irritable: calming and non-judgmental; validate without matching the energy.
  irritable: [
    "That edge you're feeling is real - I'm not here to make it worse 🩷",
    "I hear you. Let's focus on what's actually going on with your body right now 🩷",
    "You don't have to have it together to talk to me - let's just look at what's happening 🩷",
    "Whatever's fueling that feeling, you came to the right place 🩷",
    "I'm not going to push back - let's just work through this 🩷",
    "That frustration is telling you something. Let's figure out what 🩷",
  ],
};

/**
 * getToneOpener(tone, ctx, text) → string
 *
 * Returns a contextually appropriate warm opening line for the given tone.
 * Returns an empty string for 'neutral' so callers can safely prepend without
 * checking - an empty string filtered by say() produces no extra bubble.
 *
 * Medical seriousness override: if the message contains heavy bleeding, severe
 * pain, fainting, pregnancy concern, or urgency signals, casual openers are
 * suppressed entirely (returns ""). Other tones use their calmest available
 * opener - playful phrasing would feel dismissive on medically serious content.
 *
 * Repetition control: when ctx is provided, already-used opener strings are
 * tracked in ctx.usedOpeners (a Set). Each call picks from unused options first.
 * When all options in the pool have been used, the Set resets so the cycle
 * can begin again.
 *
 * @param  {'distressed'|'frustrated'|'exhausted'|'angry'|'anxious'|'irritable'|'casual'|'neutral'} tone
 * @param  {object|null} ctx  - Session context (needs ctx.usedOpeners Set), or null
 * @param  {string|null} text - Raw user message for medical seriousness check, or null
 * @returns {string}
 */
export function getToneOpener(tone, ctx = null, text = null) {
  // Medical seriousness override - block casual opener on urgent/serious content
  const medicallySerious = text ? hasMedicalSeriousness(text) : false;
  if (medicallySerious && tone === "casual") return "";

  const pool = TONE_OPENER_POOLS[tone];
  if (!pool) return "";

  // No context - plain random pick (backward-compatible path)
  if (!ctx) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Ensure usedOpeners exists on ctx (defensive - should be set by createCtx)
  if (!ctx.usedOpeners) ctx.usedOpeners = new Set();

  // When medically serious, prefer the calmest opener for non-casual tones:
  // that's the first entry in each pool (intentionally the most grounded one).
  if (medicallySerious) {
    const calmest = pool.find(o => !ctx.usedOpeners.has(o)) ?? pool[0];
    ctx.usedOpeners.add(calmest);
    return calmest;
  }

  // Repetition control - pick from unused openers; reset when pool is exhausted
  const unused = pool.filter(o => !ctx.usedOpeners.has(o));
  if (unused.length === 0) ctx.usedOpeners.clear();

  const candidates = ctx.usedOpeners.size === 0 ? pool : pool.filter(o => !ctx.usedOpeners.has(o));
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  ctx.usedOpeners.add(selected);
  return selected;
}

// ─── PHASE INSIGHTS ──────────────────────────────────────────────────────────

/**
 * Concern priority order - used by callers when multiple concerns are detected
 * in a single message so only the highest-priority insight is shown.
 * Exported so callers and tests can reference the same list.
 */
export const CONCERN_PRIORITY = ["pain", "mood", "fatigue", "bloating", "sleep", "skin", "libido"];

/**
 * softenInsight(text, phase) → string
 *
 * Replaces hard phase-naming openers (e.g. "In the luteal phase…") with
 * hedged phrasing suitable for low-confidence cycle data. Returns the
 * original string unchanged when no hard opener is detected (e.g. strings
 * that already say "some people" or "usually").
 *
 * Internal - not exported.
 */
function softenInsight(text, phase) {
  const SOFTENERS = {
    luteal: [
      [/^In the luteal phase,?\s*/i,         "If you're in your luteal phase, "],
      [/^Fatigue in the luteal phase/i,       "If you're in your luteal phase, fatigue"],
      [/^Luteal phase bloating/i,             "If you're in your luteal phase, bloating"],
      [/^Cramping that starts in the late luteal phase/i, "Around the later part of the cycle, cramping"],
      [/^Libido can dip in the luteal phase/i,"If you're in your luteal phase, libido can dip"],
      [/^Progesterone can make/i,             "If you're in your luteal phase, progesterone can make"],
    ],
    menstrual: [
      [/^During your period,?\s*/i,            "Around your period, "],
      [/^Period cramps can happen when/i,      "Period cramps can happen when"],  // already soft
      [/^Bloating around the start of your period/i, "Around the start of your period, bloating"],
      [/^Around your period,\s*/i,             "Around your period, "],           // already soft
      [/^Libido is often lower during your period/i, "Around your period phase, libido can be lower"],
    ],
    follicular: [
      [/^Estrogen rises steadily through the follicular phase/i,   "If you're in your follicular phase, estrogen tends to rise"],
      [/^Rising estrogen in the follicular phase/i,                "If you're in your follicular phase, rising estrogen"],
      [/^Bloating is usually lower in the follicular phase/i,      "If you're in a follicular phase, bloating is often lower"],
      [/^Sleep quality often improves in the follicular phase/i,   "If you're in your follicular phase, sleep quality can improve"],
      [/^Pelvic discomfort in the follicular phase/i,              "Around the follicular phase, pelvic discomfort"],
      [/^Estrogen can support skin/i,                              "Estrogen can support skin"],  // already soft
    ],
    ovulation: [
      [/^Estrogen peaks at ovulation/i,     "If you're around ovulation, estrogen can peak"],
      [/^Libido often peaks at ovulation/i, "Around ovulation, libido can peak"],
    ],
  };

  for (const [pattern, replacement] of (SOFTENERS[phase] || [])) {
    if (pattern.test(text)) {
      return text.replace(pattern, replacement);
    }
  }
  // String is already hedged ("some people…", "usually…", etc.) - return as-is
  return text;
}

/**
 * getPhaseInsight(phase, concern, lowConfidence) → string | null
 *
 * Returns a warm 1–2 sentence phase explanation for a given cycle phase and
 * concern category. Returns null if no insight exists for the combination so
 * callers can safely skip rendering without checking first.
 *
 * Language uses "can contribute to" framing rather than presenting hormones
 * as the sole cause of any experience.
 *
 * @param {'luteal'|'menstrual'|'follicular'|'ovulation'|null} phase
 * @param {'mood'|'fatigue'|'pain'|'bloating'|'sleep'|'libido'|'skin'} concern
 * @param {boolean} [lowConfidence=false] - true when cycle data is sparse or >45 days old
 * @returns {string|null}
 */
export function getPhaseInsight(phase, concern, lowConfidence = false) {
  if (!phase || !concern) return null;

  const insights = {
    luteal: {
      mood:    "In the luteal phase progesterone rises and then drops sharply - that emotional dip is one of the most common experiences in this phase and it's completely real.",
      fatigue: "Fatigue in the luteal phase is very common - your body temperature is slightly higher, your metabolism speeds up, and progesterone can have a sedating effect. You're not being lazy.",
      bloating:"Luteal phase bloating can happen as progesterone tends to slow digestion slightly - it usually peaks a day or two before your period and then eases once bleeding starts.",
      sleep:   "Progesterone can make you feel sleepy but may also disrupt deep sleep quality - feeling tired even after sleeping is a common luteal phase pattern.",
      skin:    "Progesterone in the luteal phase can increase oil production - breakouts in the week before your period can be linked to these hormonal changes, not random bad luck.",
      pain:    "Cramping that starts in the late luteal phase can be prostaglandin-related - the same compounds that contribute to period cramps begin building before bleeding actually starts.",
      libido:  "Libido can dip in the luteal phase as progesterone rises and energy drops - this is a common experience in this phase and not a reflection of how you feel about your relationship.",
    },
    menstrual: {
      fatigue: "During your period your body is losing iron through bleeding - fatigue during this time can have a physical component. Iron-rich foods and rest genuinely help.",
      mood:    "The drop in estrogen and progesterone at the start of your period can contribute to a low or flat mood in the first couple of days - it usually lifts as estrogen starts rising again around day 3–4.",
      pain:    "Period cramps can happen when the uterus contracts to shed its lining - prostaglandins are the hormone-like compounds that contribute to that. Higher prostaglandin levels tend to mean more intense cramps.",
      bloating:"Bloating around the start of your period is very common - prostaglandins that contribute to cramps can also affect your digestive system. It usually eases within a day or two.",
      sleep:   "Sleep can be harder during your period - cramps, discomfort, and night sweats from hormonal shifts can all play a role. Rest as much as you can.",
      libido:  "Libido is often lower during your period due to discomfort and fatigue - this is completely normal and tends to rise again in the follicular phase.",
      skin:    "Some people notice fewer breakouts once their period starts as progesterone drops - others see continued breakouts from inflammation during menstruation.",
    },
    follicular: {
      mood:    "Estrogen rises steadily through the follicular phase - most people notice their mood, energy, and motivation are better in this part of their cycle.",
      fatigue: "The follicular phase is usually when energy levels are at their best as estrogen rises - persistent fatigue in this phase is worth paying attention to, since stress or sleep could be a factor.",
      libido:  "Rising estrogen in the follicular phase often brings higher energy and libido - this is one of the times in the cycle when many people feel most like themselves.",
      bloating:"Bloating is usually lower in the follicular phase as progesterone (which can slow digestion) is at its minimum - if you're bloating here, diet or stress may be playing a role.",
      sleep:   "Sleep quality often improves in the follicular phase as estrogen rises - if sleep is still disrupted, it's worth looking at other factors like screen time or stress.",
      pain:    "Pelvic discomfort in the follicular phase can sometimes reflect ovarian activity as follicles develop - mild, brief twinges are usually normal.",
      skin:    "Estrogen can support skin collagen and oil balance - many people notice their skin looks clearest in the follicular phase.",
    },
    ovulation: {
      mood:    "Estrogen peaks at ovulation and so does a lot of people's confidence, social energy, and general mood - if you feel good right now, that's a common experience at this point in the cycle.",
      pain:    "Some people feel a sharp or dull one-sided pain at ovulation called mittelschmerz - it can be caused by the follicle releasing the egg and usually lasts a few hours to a day.",
      libido:  "Libido often peaks at ovulation - estrogen and LH are both high, and this is the body's natural fertility window.",
      fatigue: "Energy is usually at its highest around ovulation - if you're tired right now, it may be worth checking in on sleep quality or stress levels.",
      bloating:"Some mild bloating around ovulation is common - the follicle rupture and fluid release can contribute to brief, minor distension.",
      sleep:   "Sleep is usually stable around ovulation - if you're having trouble at this point, stress or anxiety may be the more likely driver.",
      skin:    "Skin often looks its best around ovulation when estrogen is at its peak - a slight rise in testosterone can occasionally contribute to a pre-ovulation breakout for some people.",
    },
  };

  const raw = insights[phase]?.[concern] ?? null;
  if (!raw) return null;
  return lowConfidence ? softenInsight(raw, phase) : raw;
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
