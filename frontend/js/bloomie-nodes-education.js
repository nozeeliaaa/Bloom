/**
 * bloomie-nodes-education.js
 * General symptom education nodes — lazy-loaded chunk.
 * Covers: SYMPTOM_EDUCATION, EDUC_PERIOD, EDUC_OVULATION, EDUC_CYCLE_BASICS,
 * EDUC_BROAD, EDUC_HEAVY, EDUC_CRAMPS, EDUC_SPOTTING, EDUC_MOOD, EDUC_LATE.
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
        { id: "heavy",  label: "Heavy bleeding",          next: "EDUC_HEAVY",  primary: true },
        { id: "cramps", label: "Cramps and pelvic pain",  next: "EDUC_CRAMPS" },
        { id: "spot",   label: "Spotting between periods",next: "EDUC_SPOTTING" },
        { id: "mood",   label: "Mood and energy changes", next: "EDUC_MOOD" },
        { id: "late",   label: "Late or irregular periods",next: "EDUC_LATE" },
        { id: "menu",   label: "Something else",           next: "START_MENU" },
      ],
    },

    /* ── TYPE 1: SUPPORTED EDUCATIONAL — specific factual questions ───────── */

    // "what is a period" / "why do periods happen"
    EDUC_PERIOD: {
      say: [
        "A period (menstruation) is the monthly shedding of the uterine lining — the tissue your body built up in case of pregnancy 🩷",
        "Each cycle, rising oestrogen thickens the lining. When pregnancy doesn't occur, oestrogen and progesterone levels drop, signalling the body to shed that lining as blood and tissue through the vagina.",
        "A typical period lasts 3–7 days and occurs on a cycle of 21–35 days. Flow can range from light to heavy — what's normal varies widely from person to person.",
        "Mild cramping in the first 1–2 days is common. It's caused by prostaglandins — hormone-like compounds that trigger uterine contractions to help expel the lining.",
        ...safeFooter(),
      ],
      choices: [
        { id: "cycle",  label: "What is the menstrual cycle?",  next: "EDUC_CYCLE_BASICS", primary: true },
        { id: "cramps", label: "Why do cramps happen?",          next: "EDUC_CRAMPS" },
        { id: "heavy",  label: "What counts as heavy bleeding?", next: "EDUC_HEAVY" },
        { id: "mine",   label: "My period is a concern",         next: "PERIOD_TRIAGE" },
        { id: "menu",   label: pickMainLabel(),                  next: "START_MENU" },
      ],
    },

    // "what is ovulation" / "how does ovulation work"
    EDUC_OVULATION: {
      say: [
        "Ovulation is when one of your ovaries releases a mature egg, ready to potentially be fertilised 🩷",
        "It typically happens around 12–14 days before your next expected period — not necessarily on day 14, which is only accurate for a perfect 28-day cycle.",
        "The process is triggered by a surge in luteinising hormone (LH). The released egg travels down the fallopian tube toward the uterus. It can only be fertilised for 12–24 hours after release.",
        "Because sperm can survive 3–5 days in the body, the fertile window actually spans about 5–6 days — the 4–5 days before ovulation and the day itself.",
        "Signs you may be ovulating: cervical mucus becomes clear and stretchy (like egg whites), a slight rise in basal body temperature, and sometimes a mild one-sided pelvic ache called mittelschmerz.",
        ...safeFooter(),
      ],
      choices: [
        { id: "cycle",  label: "Tell me about the full cycle",  next: "EDUC_CYCLE_BASICS", primary: true },
        { id: "ttc",    label: "I'm trying to conceive",        next: "TTC_INTRO" },
        { id: "window", label: "When is my fertile window?",    next: "CYCLE_NEXT_PERIOD" },
        { id: "menu",   label: pickMainLabel(),                 next: "START_MENU" },
      ],
    },

    // "what is the menstrual cycle" / "what are the cycle phases"
    EDUC_CYCLE_BASICS: {
      say: [
        "The menstrual cycle is a monthly hormonal process that prepares the body for possible pregnancy 🩷 It runs from the first day of one period to the first day of the next.",
        "A typical cycle is 21–35 days long. 28 days is the average, but anything in that range is normal — and cycle length can vary month to month even in the same person.",
        pick([
          "There are four phases:\n\n• **Menstrual (days 1–5):** The uterine lining sheds — this is your period.\n• **Follicular (days 1–13):** Oestrogen rises, stimulating follicle growth and thickening the lining.\n• **Ovulation (~day 14):** A surge in LH triggers egg release.\n• **Luteal (days 15–28):** Progesterone rises to prepare for implantation. If no pregnancy occurs, levels drop and the cycle resets.",
          "The four phases are:\n\n• **Menstrual** — lining sheds (your period)\n• **Follicular** — oestrogen rises, egg follicles develop\n• **Ovulation** — egg releases (~14 days before next period)\n• **Luteal** — progesterone rises; body prepares for pregnancy. When it doesn't happen, levels fall and a new cycle starts.",
        ]),
        "Oestrogen drives the first half — energy, mood lift, clear skin. Progesterone takes over after ovulation and can cause PMS symptoms when it drops sharply before your period.",
        ...safeFooter(),
      ],
      choices: [
        { id: "period",    label: "More about periods",          next: "EDUC_PERIOD",        primary: true },
        { id: "ovulation", label: "More about ovulation",        next: "EDUC_OVULATION" },
        { id: "mood",      label: "Why does my mood shift?",      next: "EDUC_MOOD" },
        { id: "phase",     label: "What phase am I in now?",      next: "CYCLE_PHASE_ANSWER" },
        { id: "menu",      label: pickMainLabel(),                next: "START_MENU" },
      ],
    },

    /* ── TYPE 2: PARTIALLY SUPPORTED — broad topics → summary + learn ────── */

    // "tell me everything about hormones" / "explain fertility fully"
    EDUC_BROAD: {
      say: [
        pick([
          "That's a big topic — here's a solid overview, and I'll point you to where you can go deeper 🩷",
          "There's a lot to cover there 🩷 Let me give you the key points, then show you where to read more.",
          "Great question — here's the short version 🩷",
        ]),
        "At the heart of reproductive health are four hormones: oestrogen, progesterone, FSH (follicle-stimulating hormone), and LH (luteinising hormone). They drive every phase of the 21–35 day menstrual cycle — regulating ovulation, period timing, mood, energy, skin, and fertility.",
        "Fertility depends on the interplay between these hormones, ovulation timing, and the uterine environment. Factors like stress, body weight, thyroid health, and conditions like PCOS or endometriosis can all shift the balance.",
        "For a deeper read, Bloom's **Learn** section has pamphlets written specifically for this — covering cycle tracking, hormonal conditions, fertility, and what healthy cycles look like. You'll find them in the **Learn** tab in the main navigation 🩷",
        ...safeFooter(),
      ],
      choices: [
        { id: "cycle",    label: "What is the menstrual cycle?", next: "EDUC_CYCLE_BASICS", primary: true },
        { id: "ovulation",label: "What is ovulation?",           next: "EDUC_OVULATION" },
        { id: "ttc",      label: "Fertility and TTC",            next: "TTC_INTRO" },
        { id: "pcos",     label: "What is PCOS?",                next: "EDUC_PCOS" },
        { id: "menu",     label: pickMainLabel(),                next: "START_MENU" },
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
        { id: "mine",  label: "This is happening to me", next: "HEAVY_INTRO", primary: true },
        { id: "doc",   label: "Should I see a doctor?",  next: "SEE_DOCTOR_GUIDE" },
        { id: "more",  label: "Learn about another symptom", next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(), next: "START_MENU" },
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
        { id: "mild",    label: "Manageable but annoying",  next: "MOOD_GUIDE", primary: true },
        { id: "severe",  label: "Stops my daily life",      next: "PELVIC_INTRO" },
        { id: "outside", label: "Happens outside my period",next: "PELVIC_SEX_INTRO" },
        { id: "menu",    label: pickMainLabel(),              next: "START_MENU" },
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
        { id: "mine",  label: "This is happening to me",    next: "SPOT_INTRO",  primary: true },
        { id: "more",  label: "Learn about another symptom",next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),               next: "START_MENU" },
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
        { id: "mine",  label: "This is affecting me",       next: "MOOD_INTRO",  primary: true },
        { id: "more",  label: "Learn about another symptom",next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),               next: "START_MENU" },
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
        { id: "more",  label: "Learn about another symptom", next: "SYMPTOM_EDUCATION" },
        { id: "menu",  label: pickMainLabel(),                next: "START_MENU" },
      ],
    },
  };
}
