/**
 * bloomie-nodes-education.js
 * General symptom education nodes - lazy-loaded chunk.
 * Covers educational explainers for cycle basics, common symptoms,
 * and condition overviews (non-diagnostic).
 *
 * IMPORTANT: This module is intentionally kept separate so Vite can split it
 * into its own async chunk. Do NOT import safety-critical nodes here.
 */
export function createEducationNodes(env, helpers) {
  const {
    pick, consent, safeFooter,
  } = env;
  const { pickCloseLabel, pickMainLabel } = helpers;

  return {
    // "What does this symptom mean?" education without diagnosis
    SYMPTOM_EDUCATION: {
      say: [
        "I can give you general education on period and cycle symptoms 🩷",
        "Keep in mind, understanding what's common is different from diagnosing what's happening to you specifically.",
        "What do you want to understand better?",
      ],
      choices: [
        { id: "heavy",      label: "Heavy bleeding",                 next: "EDUC_HEAVY", primary: true },
        { id: "cramps",     label: "Cramps and pelvic pain",         next: "EDUC_CRAMPS" },
        { id: "spot",       label: "Spotting between periods",       next: "EDUC_SPOTTING" },
        { id: "mood",       label: "Mood and energy changes",        next: "EDUC_MOOD" },
        { id: "late",       label: "Late or irregular periods",      next: "EDUC_LATE" },
        { id: "cervical",   label: "Discharge and cervical mucus",   next: "EDUC_CERVICAL_MUCUS" },
        { id: "more",       label: "More symptom topics",            next: "EDUC_MORE_SYMPTOMS" },
        { id: "conditions", label: "Hormonal conditions",            next: "EDUC_CONDITIONS" },
        { id: "menu",       label: pickMainLabel(),                    next: "START_MENU" },
      ],
    },

    EDUC_MORE_SYMPTOMS: {
      say: [
        "Totally fair - there are a lot of symptom questions beyond the basics 🩷",
        "Pick whichever one fits what you're curious about right now.",
      ],
      choices: [
        { id: "color",   label: "Period blood colour",           next: "EDUC_BLOOD_COLOUR", primary: true },
        { id: "clots",   label: "Blood clots in periods",        next: "EDUC_CLOTS" },
        { id: "bloat",   label: "Bloating",                      next: "EDUC_BLOATING" },
        { id: "fatigue", label: "Fatigue and low energy",        next: "EDUC_FATIGUE" },
        { id: "breast",  label: "Breast tenderness",             next: "EDUC_BREAST_TENDERNESS" },
        { id: "head",    label: "Headaches or menstrual migraine", next: "EDUC_HEADACHES" },
        { id: "acne",    label: "Acne and skin changes",         next: "EDUC_ACNE" },
        { id: "nausea",  label: "Nausea around periods",         next: "EDUC_NAUSEA" },
        { id: "sex",     label: "Pain during sex",               next: "EDUC_PAIN_DURING_SEX" },
        { id: "bc",      label: "Birth control and cycle changes", next: "EDUC_BIRTH_CONTROL_CYCLE" },
        { id: "back",    label: "Back to symptom education",     next: "SYMPTOM_EDUCATION" },
      ],
    },

    EDUC_CONDITIONS: {
      say: [
        "I can walk you through condition overviews in plain language 🩷",
        "I won't diagnose, but I can explain common patterns and what is usually worth checking.",
      ],
      choices: [
        { id: "pcos",     label: "PCOS",                         next: "EDUC_PCOS", primary: true },
        { id: "endo",     label: "Endometriosis",                next: "EDUC_ENDO" },
        { id: "fibroids", label: "Fibroids",                     next: "EDUC_FIBROIDS" },
        { id: "pmdd",     label: "PMDD",                         next: "EDUC_PMDD" },
        { id: "anemia",   label: "Anaemia and heavy periods",    next: "EDUC_ANEMIA_HEAVY" },
        { id: "back",     label: "Back to symptom education",    next: "SYMPTOM_EDUCATION" },
        { id: "menu",     label: pickMainLabel(),                 next: "START_MENU" },
      ],
    },

    /* ── TYPE 1: SUPPORTED EDUCATIONAL - specific factual questions ───────── */

    // "what is a period" / "why do periods happen"
    EDUC_PERIOD: {
      say: [
        "A period (menstruation) is the monthly shedding of the uterine lining - the tissue your body built up in case of pregnancy 🩷",
        "Each cycle, rising oestrogen thickens the lining. When pregnancy doesn't occur, oestrogen and progesterone levels drop, signalling the body to shed that lining as blood and tissue through the vagina.",
        "A typical period lasts 3–7 days and occurs on a cycle of 21–35 days. Flow can range from light to heavy - what's normal varies widely from person to person.",
        "Mild cramping in the first 1–2 days is common. It's caused by prostaglandins - hormone-like compounds that trigger uterine contractions to help expel the lining.",
        ...safeFooter(),
      ],
      choices: [
        { id: "cycle",  label: "What is the menstrual cycle?",  next: "EDUC_CYCLE_BASICS", primary: true },
        { id: "cramps", label: "Why do cramps happen?",          next: "EDUC_CRAMPS" },
        { id: "heavy",  label: "What counts as heavy bleeding?", next: "EDUC_HEAVY" },
        { id: "color",  label: "What blood colour can mean",     next: "EDUC_BLOOD_COLOUR" },
        { id: "mine",   label: "My period is a concern",         next: "PERIOD_TRIAGE" },
        { id: "menu",   label: pickMainLabel(),                    next: "START_MENU" },
      ],
    },

    // "what is ovulation" / "how does ovulation work"
    EDUC_OVULATION: {
      say: [
        "Ovulation is when one of your ovaries releases a mature egg, ready to potentially be fertilised 🩷",
        "It typically happens around 12–14 days before your next expected period - not necessarily on day 14, which is only accurate for a perfect 28-day cycle.",
        "The process is triggered by a surge in luteinising hormone (LH). The released egg travels down the fallopian tube toward the uterus. It can only be fertilised for 12–24 hours after release.",
        "Because sperm can survive 3–5 days in the body, the fertile window actually spans about 5–6 days - the 4–5 days before ovulation and the day itself.",
        "Signs you may be ovulating: cervical mucus becomes clear and stretchy (like egg whites), a slight rise in basal body temperature, and sometimes a mild one-sided pelvic ache called mittelschmerz.",
        ...safeFooter(),
      ],
      choices: [
        { id: "cycle",   label: "Tell me about the full cycle",  next: "EDUC_CYCLE_BASICS", primary: true },
        { id: "cm",      label: "More about cervical mucus",     next: "EDUC_CERVICAL_MUCUS" },
        { id: "ttc",     label: "I'm trying to conceive",        next: "TTC_INTRO" },
        { id: "window",  label: "When is my fertile window?",    next: "CYCLE_NEXT_PERIOD" },
        { id: "menu",    label: pickMainLabel(),                   next: "START_MENU" },
      ],
    },

    // "what is the menstrual cycle" / "what are the cycle phases"
    EDUC_CYCLE_BASICS: {
      say: [
        "The menstrual cycle is a monthly hormonal process that prepares the body for possible pregnancy 🩷 It runs from the first day of one period to the first day of the next.",
        "A typical cycle is 21–35 days long. 28 days is the average, but anything in that range is normal - and cycle length can vary month to month even in the same person.",
        pick([
          "There are four phases:\n\n• **Menstrual (days 1–5):** The uterine lining sheds - this is your period.\n• **Follicular (days 1–13):** Oestrogen rises, stimulating follicle growth and thickening the lining.\n• **Ovulation (~day 14):** A surge in LH triggers egg release.\n• **Luteal (days 15–28):** Progesterone rises to prepare for implantation. If no pregnancy occurs, levels drop and the cycle resets.",
          "The four phases are:\n\n• **Menstrual** - lining sheds (your period)\n• **Follicular** - oestrogen rises, egg follicles develop\n• **Ovulation** - egg releases (~14 days before next period)\n• **Luteal** - progesterone rises; body prepares for pregnancy. When it doesn't happen, levels fall and a new cycle starts.",
        ]),
        "Oestrogen drives the first half - energy, mood lift, clear skin. Progesterone takes over after ovulation and can cause PMS symptoms when it drops sharply before your period.",
        ...safeFooter(),
      ],
      choices: [
        { id: "period",    label: "More about periods",            next: "EDUC_PERIOD",        primary: true },
        { id: "ovulation", label: "More about ovulation",          next: "EDUC_OVULATION" },
        { id: "mood",      label: "Why does my mood shift?",       next: "EDUC_MOOD" },
        { id: "phase",     label: "What phase am I in now?",       next: "CYCLE_PHASE_ANSWER" },
        { id: "late",      label: "Why periods can be late",        next: "EDUC_LATE" },
        { id: "menu",      label: pickMainLabel(),                   next: "START_MENU" },
      ],
    },

    /* ── TYPE 2: PARTIALLY SUPPORTED - broad topics → summary + learn ────── */

    // "tell me everything about hormones" / "explain fertility fully"
    EDUC_BROAD: {
      say: [
        pick([
          "That's a big topic - here's a solid overview, and I'll point you to where you can go deeper 🩷",
          "There's a lot to cover there 🩷 Let me give you the key points, then show you where to read more.",
          "Great question - here's the short version 🩷",
        ]),
        "At the heart of reproductive health are four hormones: oestrogen, progesterone, FSH (follicle-stimulating hormone), and LH (luteinising hormone). They drive every phase of the 21–35 day menstrual cycle - regulating ovulation, period timing, mood, energy, skin, and fertility.",
        "Fertility depends on the interplay between these hormones, ovulation timing, and the uterine environment. Factors like stress, body weight, thyroid health, and conditions like PCOS or endometriosis can all shift the balance.",
        "For a deeper read, Bloom's **Learn** section has pamphlets written specifically for this - covering cycle tracking, hormonal conditions, fertility, and what healthy cycles look like. You'll find them in the **Learn** tab in the main navigation 🩷",
        ...safeFooter(),
      ],
      choices: [
        { id: "cycle",      label: "What is the menstrual cycle?", next: "EDUC_CYCLE_BASICS", primary: true },
        { id: "ovulation",  label: "What is ovulation?",           next: "EDUC_OVULATION" },
        { id: "ttc",        label: "Fertility and TTC",            next: "TTC_INTRO" },
        { id: "pcos",       label: "What is PCOS?",                next: "EDUC_PCOS" },
        { id: "conditions", label: "Condition overviews",          next: "EDUC_CONDITIONS" },
        { id: "menu",       label: pickMainLabel(),                  next: "START_MENU" },
      ],
    },

    EDUC_HEAVY: {
      say: [
        "Heavy bleeding (called menorrhagia) means soaking through a pad or tampon in 2 hours or less, or passing large clots 🩷",
        "Common causes include fibroids, polyps, endometriosis, hormonal imbalances, or thyroid issues.",
        "It can also be a sign of low iron (anaemia), especially if you feel dizzy, weak, or short of breath during your period.",
        "If it's happening every cycle, it's worth bringing up with a provider, not because it's always serious, but because it's treatable.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",              next: "HEAVY_INTRO", primary: true },
        { id: "clots", label: "What about clots?",                    next: "EDUC_CLOTS" },
        { id: "iron",  label: "How heavy bleeding affects iron",       next: "EDUC_ANEMIA_HEAVY" },
        { id: "doc",   label: "Should I see a doctor?",               next: "SEE_DOCTOR_GUIDE" },
        { id: "more",  label: "Learn about another symptom",           next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                          next: "START_MENU" },
      ],
    },

    EDUC_CRAMPS: {
      say: [
        "Period cramps (dysmenorrhoea) happen because your uterus contracts to shed its lining 🩷",
        "Mild cramps are common and normal for the first 1–2 days. But cramps that stop you from daily life, don't respond to pain relief, or happen outside your period, that's a different story.",
        "Conditions like endometriosis and adenomyosis can cause severe cramping and are often under-diagnosed.",
        `${consent()} how bad does it get for you?`,
      ],
      choices: [
        { id: "mild",    label: "Manageable but annoying",     next: "MOOD_GUIDE", primary: true },
        { id: "severe",  label: "Stops my daily life",         next: "PELVIC_INTRO" },
        { id: "outside", label: "Happens outside my period",   next: "PELVIC_SEX_INTRO" },
        { id: "endo",    label: "Could this be endometriosis?",next: "EDUC_ENDO" },
        { id: "menu",    label: pickMainLabel(),                 next: "START_MENU" },
      ],
    },

    EDUC_SPOTTING: {
      say: [
        "Spotting between periods means light bleeding outside your expected period days 🩷",
        "It can be totally normal, ovulation spotting, implantation bleeding, or just hormonal fluctuation.",
        "It can also sometimes indicate a cervical issue, an infection, or a reaction to contraception.",
        "The key questions are: how often does it happen, does it come with pain or discharge, and is it new behaviour for your body?",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",          next: "SPOT_INTRO",  primary: true },
        { id: "cm",    label: "How is this different from discharge?", next: "EDUC_CERVICAL_MUCUS" },
        { id: "more",  label: "Learn about another symptom",      next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                     next: "START_MENU" },
      ],
    },

    EDUC_MOOD: {
      say: [
        "Mood changes tied to your cycle are driven by shifting hormone levels, mainly oestrogen and progesterone 🩷",
        "In the luteal phase (roughly days 15–28), progesterone rises then drops sharply, which can cause irritability, sadness, anxiety, or brain fog.",
        "When it's mild, that's PMS. When it's significantly affecting your daily life, it might be PMDD, which is real and treatable.",
        "Things like poor sleep, high stress, and low iron can also make cycle-related mood shifts worse.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",   label: "This is affecting me",          next: "MOOD_INTRO",  primary: true },
        { id: "pmdd",   label: "Tell me more about PMDD",       next: "EDUC_PMDD" },
        { id: "fatigue",label: "What about fatigue and brain fog?", next: "EDUC_FATIGUE" },
        { id: "more",   label: "Learn about another symptom",   next: "SYMPTOM_EDUCATION" },
        { id: "menu",   label: pickMainLabel(),                  next: "START_MENU" },
      ],
    },

    EDUC_LATE: {
      say: [
        "A period is generally considered late after 5+ days past your expected date 🩷",
        "Common reasons: pregnancy, stress (even positive stress), illness, big changes in weight or exercise, travel and timezone shifts, or thyroid issues.",
        "One late period in isolation often doesn't mean something is wrong. A pattern of irregular periods is worth looking into.",
        "Conditions like PCOS can cause consistently irregular cycles, that's one of its most common signs.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "My period is late right now", next: "LATE_PERIOD_CHECK", primary: true },
        { id: "preg",  label: "Could I be pregnant?",        next: "LATE_TEST_Q" },
        { id: "pcos",  label: "Could irregular cycles be PCOS?", next: "EDUC_PCOS" },
        { id: "more",  label: "Learn about another symptom", next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                next: "START_MENU" },
      ],
    },

    EDUC_CERVICAL_MUCUS: {
      say: [
        "Cervical mucus naturally changes across the cycle, so different textures can be completely normal 🩷",
        "Around ovulation, mucus is usually clear, stretchy, and slippery (often described as egg-white). After ovulation, it often becomes thicker, creamier, or drier.",
        "Discharge can be worth checking when there's a strong odour, itching, burning, pain, or a big change from your usual pattern.",
        "Tracking colour, texture, smell, and timing in your cycle can make patterns much clearer.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",   label: "I'm noticing this now",              next: "ELSE_DISCHARGE_ENTRY", primary: true },
        { id: "ovul",   label: "How this relates to ovulation",      next: "EDUC_OVULATION" },
        { id: "spot",   label: "Difference from spotting",           next: "EDUC_SPOTTING" },
        { id: "more",   label: "Learn another symptom",              next: "SYMPTOM_EDUCATION" },
        { id: "menu",   label: pickMainLabel(),                        next: "START_MENU" },
      ],
    },

    EDUC_BLOOD_COLOUR: {
      say: [
        "Period blood can vary in colour through a cycle and still be normal 🩷",
        "Bright red often means fresher flow. Dark red or brown usually means older blood leaving more slowly, especially at the start or end of a period.",
        "Pink flow can happen with lighter bleeding or spotting. Orange/grey, especially with odour or irritation, is worth checking with a provider.",
        "Colour alone rarely gives a diagnosis. The bigger clues are pain, amount of bleeding, smell, and whether the pattern is new for you.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "My bleeding feels different",  next: "HEAVY_INTRO", primary: true },
        { id: "clots", label: "What about clots?",            next: "EDUC_CLOTS" },
        { id: "spot",  label: "Is this spotting?",            next: "EDUC_SPOTTING" },
        { id: "more",  label: "Learn another symptom",        next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                  next: "START_MENU" },
      ],
    },

    EDUC_CLOTS: {
      say: [
        "Small clots during heavier period days can happen and are often just pooled blood leaving the uterus 🩷",
        "Clots become more concerning when they're frequent, large (about grape-size or larger), or paired with very heavy flow and fatigue/dizziness.",
        "Heavy clotting can be linked to conditions like fibroids, adenomyosis, or hormone imbalance, and it's worth a proper check if persistent.",
        "Tracking clot size, frequency, and how often you change pads/tampons helps providers assess things faster.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",    label: "I'm having this now",           next: "HEAVY_INTRO", primary: true },
        { id: "fibroid", label: "Could this be fibroids?",      next: "EDUC_FIBROIDS" },
        { id: "iron",    label: "Could this affect iron levels?", next: "EDUC_ANEMIA_HEAVY" },
        { id: "more",    label: "Learn another symptom",         next: "SYMPTOM_EDUCATION" },
        { id: "menu",    label: pickMainLabel(),                   next: "START_MENU" },
      ],
    },

    EDUC_BLOATING: {
      say: [
        "Cycle-related bloating is very common, especially in the luteal phase before your period 🩷",
        "Hormonal shifts can cause fluid retention and slower digestion, which can make your lower belly feel fuller or tighter.",
        "It is worth checking if bloating is severe, persistent through most of the month, or comes with significant pain, bowel changes, or unintentional weight change.",
        "Noting when bloating appears in your cycle helps separate hormonal patterns from non-cycle digestive patterns.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",           next: "PERIOD_TRIAGE", primary: true },
        { id: "late",  label: "Could this be related to a late period?", next: "EDUC_LATE" },
        { id: "pain",  label: "I also have pain",                  next: "PELVIC_INTRO" },
        { id: "more",  label: "Learn another symptom",             next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                       next: "START_MENU" },
      ],
    },

    EDUC_FATIGUE: {
      say: [
        "Low energy around your cycle can be very real and is often linked to hormone shifts, sleep quality, stress load, and iron levels 🩷",
        "Many people feel a dip before or during their period, especially if bleeding is heavy.",
        "Fatigue is more worth checking when it is persistent, worsening, or affecting daily function, particularly with heavy flow, shortness of breath, dizziness, or palpitations.",
        "A cycle + symptom + energy log can help you and your provider spot whether this is mainly hormonal, sleep-related, or possibly iron-related.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is affecting me",            next: "MOOD_INTRO", primary: true },
        { id: "iron",  label: "Could this be low iron?",         next: "EDUC_ANEMIA_HEAVY" },
        { id: "mood",  label: "What about mood and brain fog?",  next: "EDUC_MOOD" },
        { id: "more",  label: "Learn another symptom",           next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                     next: "START_MENU" },
      ],
    },

    EDUC_BREAST_TENDERNESS: {
      say: [
        "Breast tenderness is a common hormonal symptom, especially in the second half of the cycle before a period 🩷",
        "Progesterone and fluid shifts can make breast tissue feel sore, heavy, or more sensitive to touch.",
        "It's worth checking if pain is one-sided and persistent, clearly worsening, or associated with a new lump, skin change, or nipple discharge.",
        "Tracking when tenderness starts and stops across your cycle can show whether it follows a predictable hormonal pattern.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",         next: "PERIOD_TRIAGE", primary: true },
        { id: "late",  label: "Could this happen with late periods?", next: "EDUC_LATE" },
        { id: "preg",  label: "Could this be pregnancy-related?", next: "PREGNANCY_ENTRY" },
        { id: "more",  label: "Learn another symptom",          next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                    next: "START_MENU" },
      ],
    },

    EDUC_HEADACHES: {
      say: [
        "Cycle-related headaches can happen when oestrogen levels shift, especially just before or during a period 🩷",
        "For some people this is mild; for others it can feel like menstrual migraine with light/sound sensitivity and nausea.",
        "A pattern that appears around the same cycle days each month is often hormonally linked, while random severe headaches may need broader assessment.",
        "Keeping a headache diary with cycle timing, severity, and triggers can make treatment discussions much easier.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",   label: "This is happening to me",          next: "PERIOD_TRIAGE", primary: true },
        { id: "mood",   label: "I also feel mood changes",         next: "MOOD_INTRO" },
        { id: "nausea", label: "I also feel nauseous",             next: "EDUC_NAUSEA" },
        { id: "more",   label: "Learn another symptom",            next: "SYMPTOM_EDUCATION" },
        { id: "menu",   label: pickMainLabel(),                      next: "START_MENU" },
      ],
    },

    EDUC_ACNE: {
      say: [
        "Cycle-related acne is common and often flares in the luteal phase before a period 🩷",
        "Hormone shifts, especially androgens and progesterone changes, can increase oil production and clogged pores.",
        "Acne with irregular periods, extra facial/body hair, or persistent breakouts can be worth discussing as part of a broader hormone assessment.",
        "Tracking acne timing alongside your cycle helps distinguish hormonal flares from skin-product or stress triggers.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is affecting me",               next: "PERIOD_TRIAGE", primary: true },
        { id: "pcos",  label: "Could this be linked to PCOS?",      next: "EDUC_PCOS" },
        { id: "late",  label: "My cycle is also irregular",         next: "EDUC_LATE" },
        { id: "more",  label: "Learn another symptom",              next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                        next: "START_MENU" },
      ],
    },

    EDUC_NAUSEA: {
      say: [
        "Nausea can happen around periods for some people, especially with strong cramps, hormonal shifts, migraines, or stress responses 🩷",
        "It can also show up in early pregnancy, digestive illness, or non-cycle causes, so context and timing really matter.",
        "When nausea appears with severe pain, heavy bleeding, fever, or persistent vomiting, that's more worth direct medical review.",
        "Tracking whether nausea clusters with period days, headaches, or stress can help narrow what pattern you're dealing with.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",   label: "This is happening now",             next: "PERIOD_TRIAGE", primary: true },
        { id: "preg",   label: "Could this be pregnancy-related?",  next: "PREGNANCY_ENTRY" },
        { id: "head",   label: "I also get headaches",              next: "EDUC_HEADACHES" },
        { id: "more",   label: "Learn another symptom",             next: "SYMPTOM_EDUCATION" },
        { id: "menu",   label: pickMainLabel(),                       next: "START_MENU" },
      ],
    },

    EDUC_PAIN_DURING_SEX: {
      say: [
        "Pain during sex is common enough to be discussed, but not something you should have to ignore 🩷",
        "Possible contributors include pelvic floor tension, dryness, irritation/infection, endometriosis, or other pelvic conditions.",
        "Pain location and timing matter: entry pain, deep pain, and post-sex cramping can point to different patterns.",
        "Tracking when it happens, where it hurts, and any related bleeding/discharge helps guide a better conversation with a provider.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",      next: "PELVIC_SEX_INTRO", primary: true },
        { id: "endo",  label: "Could this be endometriosis?", next: "EDUC_ENDO" },
        { id: "dis",   label: "I also notice discharge/irritation", next: "ELSE_DISCHARGE_ENTRY" },
        { id: "more",  label: "Learn another symptom",        next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                  next: "START_MENU" },
      ],
    },

    EDUC_BIRTH_CONTROL_CYCLE: {
      say: [
        "Birth control can change cycle patterns, and the exact effect depends on the method 🩷",
        "Hormonal methods may make periods lighter, more regular, or sometimes cause breakthrough spotting, especially in the first few months.",
        "Copper IUDs can make flow and cramps heavier for some people, especially early on. Hormonal IUDs can do the opposite and sometimes reduce bleeding a lot.",
        "Persistent heavy bleeding, severe pain, or symptoms that feel clearly worse over time are worth discussing with a provider to adjust the method if needed.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This is happening to me",            next: "PERIOD_TRIAGE", primary: true },
        { id: "contra",label: "General contraception overview",     next: "EDUC_CONTRACEPTION" },
        { id: "spot",  label: "Is this spotting normal?",           next: "EDUC_SPOTTING" },
        { id: "more",  label: "Learn another symptom",              next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                        next: "START_MENU" },
      ],
    },

    EDUC_FIBROIDS: {
      say: [
        "Fibroids are non-cancerous growths in or around the uterus, and they're very common 🩷",
        "Some people have no symptoms, while others get heavy bleeding, clots, pelvic pressure, frequent urination, or longer periods.",
        "Fibroids can overlap with other causes of heavy bleeding, so imaging (usually ultrasound) helps clarify what is going on.",
        "If bleeding is frequent or disruptive, it's reasonable to discuss options early - treatment ranges from monitoring to medication or procedures.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",  label: "This sounds like me",                next: "HEAVY_INTRO", primary: true },
        { id: "clots", label: "I notice clots too",                 next: "EDUC_CLOTS" },
        { id: "iron",  label: "Can this cause anaemia?",            next: "EDUC_ANEMIA_HEAVY" },
        { id: "more",  label: "Learn another condition",            next: "EDUC_CONDITIONS" },
        { id: "menu",  label: pickMainLabel(),                        next: "START_MENU" },
      ],
    },

    EDUC_PMDD: {
      say: [
        "PMDD (premenstrual dysphoric disorder) is a severe form of premenstrual mood symptoms, and it's real 🩷",
        "Unlike typical PMS, PMDD symptoms can significantly affect work, school, relationships, or daily functioning.",
        "A key clue is timing: symptoms usually appear in the luteal phase before a period and improve after bleeding starts.",
        "Diagnosis is based on pattern tracking over cycles, not one bad day, so a symptom diary can be very useful.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",   label: "This feels like me",                next: "MOOD_INTRO", primary: true },
        { id: "track",  label: "What should I track?",              next: "EDUC_CYCLE_BASICS" },
        { id: "mood",   label: "Back to mood education",            next: "EDUC_MOOD" },
        { id: "more",   label: "Learn another condition",           next: "EDUC_CONDITIONS" },
        { id: "menu",   label: pickMainLabel(),                       next: "START_MENU" },
      ],
    },

    EDUC_ANEMIA_HEAVY: {
      say: [
        "Heavy periods can lead to iron deficiency and sometimes anaemia over time 🩷",
        "Common signs include fatigue, weakness, dizziness, headaches, shortness of breath on exertion, or looking paler than usual.",
        "A blood test can confirm this. If iron is low, treating both the iron level and the heavy bleeding source usually works best.",
        "If heavy bleeding keeps recurring, it's worth checking in rather than waiting it out cycle after cycle.",
        ...safeFooter(),
      ],
      choices: [
        { id: "mine",   label: "This might be happening to me",    next: "HEAVY_INTRO", primary: true },
        { id: "heavy",  label: "Back to heavy bleeding",           next: "EDUC_HEAVY" },
        { id: "doc",    label: "How to discuss this with a provider", next: "SEE_DOCTOR_GUIDE" },
        { id: "more",   label: "Learn another condition",          next: "EDUC_CONDITIONS" },
        { id: "close",  label: pickCloseLabel(),                     next: "CLOSE" },
      ],
    },
  };
}
