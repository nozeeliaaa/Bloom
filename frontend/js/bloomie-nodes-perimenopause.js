/**
 * bloomie-nodes-perimenopause.js
 * Perimenopause pathway and related education nodes - lazy-loaded chunk.
 * Covers: PERIMENOPAUSE_INTRO, PERI_VASOMOTOR_ROUTE, PERI_CYCLE_ROUTE,
 * PERI_ABSENCE_CHECK, PERI_MOOD_ROUTE, PERI_COGNITIVE_NOTE, PERI_SLEEP_ROUTE,
 * PERI_VAGINAL_ROUTE, PERI_MIXED_ROUTE, PERI_UNSURE_ROUTE, PERI_MONITOR_WRAP,
 * PERI_PROVIDER_SOON, MENOPAUSE_INFO_NODE, EDUC_MENOPAUSE, EDUC_CONTRACEPTION,
 * EDUC_PCOS, EDUC_ENDO.
 *
 * IMPORTANT: This module is intentionally kept separate so Vite can split it
 * into its own async chunk. Do NOT import safety-critical nodes here.
 */
export function createPerimenopauseNodes(env, helpers) {
  const {
    ctx, pick,
  } = env;
  const { pickMainLabel } = helpers;

  function recentPeriSignals() {
    const recent = Array.isArray(ctx.entityHistory) ? ctx.entityHistory.slice(-4) : [];
    const hasHeavy = recent.some(e => e?.symptoms?.heavy || e?.symptoms?.large_clots);
    const hasPelvic = recent.some(e => e?.symptoms?.pelvic || e?.symptoms?.ovulation_pain);
    const hasLate = recent.some(e => e?.symptoms?.late || e?.symptoms?.implicit_late);
    const hasSpotting = recent.some(e => e?.symptoms?.spotting);
    const hasMood = recent.some(e =>
      e?.symptoms?.mood || e?.symptoms?.anxiety || e?.symptoms?.depression || e?.symptoms?.irritability
    );
    const hasSleep = recent.some(e => e?.symptoms?.sleep || e?.symptoms?.insomnia || e?.symptoms?.fatigue);
    return { hasHeavy, hasPelvic, hasLate, hasSpotting, hasMood, hasSleep };
  }

  function periContextLineFor(entry) {
    const sig = recentPeriSignals();
    if (entry === "cycle") {
      if (sig.hasHeavy && sig.hasPelvic) {
        return "That helps narrow things down - when cycle changes come with heavy flow and pelvic pain together, the pattern is more meaningful than any one symptom alone 🩷";
      }
      if (sig.hasHeavy) {
        return "That gives me more context - you've also mentioned heavier bleeding, which can be useful when cycle changes are part of the picture 🩷";
      }
      if (sig.hasLate || sig.hasSpotting) {
        return "That gives me more context - timing shifts plus late/spotting patterns often tell a clearer story over time 🩷";
      }
      return null;
    }
    if (entry === "mood") {
      if (sig.hasSleep && sig.hasMood) {
        return "That helps narrow things down - mood and sleep changes clustering together is common in hormone transitions 🩷";
      }
      if (sig.hasHeavy || sig.hasLate) {
        return "That gives me more context - mood changes alongside cycle shifts can happen when hormones are fluctuating 🩷";
      }
      return null;
    }
    if (entry === "vaso") {
      if (sig.hasSleep) {
        return "That gives me more context - hot flashes/night sweats plus sleep disruption often reinforce each other 🩷";
      }
      if (sig.hasLate || sig.hasHeavy) {
        return "That helps narrow things down - vasomotor symptoms alongside cycle changes can point toward a broader hormonal transition pattern 🩷";
      }
      return null;
    }
    return null;
  }

  return {
    /* ---------------- PERIMENOPAUSE PATHWAY ---------------- */
    PERIMENOPAUSE_INTRO: {
      say: [
        pick([
          "Perimenopause is one of the most under-discussed transitions in women's health and you're right to want to understand it 🩷",
          "The fact that you're paying attention to these changes already puts you ahead 🩷",
          "Perimenopause can start earlier than most people expect, sometimes in the mid-30s and it deserves real conversation 🩷",
        ]),
        "It's the transition period leading up to menopause, your hormones are shifting, and that shift can cause real, sometimes confusing symptoms.",
        "What's been going on for you?",
      ],
      choices: [
        { id: "vaso",    label: "Hot flashes or night sweats",          next: "PERI_VASOMOTOR_ROUTE" },
        { id: "cycle",   label: "Irregular or changing periods",         next: "PERI_CYCLE_ROUTE" },
        { id: "mood",    label: "Mood changes or brain fog",             next: "PERI_MOOD_ROUTE" },
        { id: "sleep",   label: "Sleep problems",                        next: "PERI_SLEEP_ROUTE" },
        { id: "vaginal", label: "Vaginal dryness or pain during sex",    next: "PERI_VAGINAL_ROUTE" },
        { id: "mixed",   label: "A mix of several things",               next: "PERI_MIXED_ROUTE" },
        { id: "unsure",  label: "I'm not sure if this is perimenopause", next: "PERI_UNSURE_ROUTE" },
      ],
    },

    PERI_VASOMOTOR_ROUTE: {
      say() {
        const contextLine = periContextLineFor("vaso");
        return [
          "Hot flashes and night sweats are some of the most well-known perimenopause symptoms 🩷",
          ...(contextLine ? [contextLine] : []),
          "They happen because estrogen fluctuations affect your body's temperature regulation, your brain gets a false signal that you're overheating.",
          "Quick check before we route this: are these episodes also disrupting your sleep most nights?",
          "How often are they happening, and are they affecting your sleep or daily life?",
        ];
      },
      choices: [
        { id: "manage",  label: "A few times a week, manageable",      next: "PERI_MONITOR_WRAP" },
        { id: "daily",   label: "Daily or disrupting sleep",            next: "PERI_PROVIDER_SOON", primary: true },
        { id: "sweat",   label: "Happening with heavy sweating at night", next: "PERI_PROVIDER_SOON" },
        { id: "unsure",  label: "Not sure yet",                        next: "PERI_MONITOR_WRAP" },
      ],
    },

    PERI_CYCLE_ROUTE: {
      say() {
        const contextLine = periContextLineFor("cycle");
        return [
          "Irregular periods are often one of the first signs of perimenopause 🩷",
          ...(contextLine ? [contextLine] : []),
          "Cycles can get shorter, longer, heavier, lighter, or just unpredictable, because estrogen and progesterone are no longer following their usual rhythm.",
          "One quick clarifier: is this mostly a timing shift, or timing plus other symptoms like heavier flow or pelvic pain?",
          "Has the change been gradual, or did it seem to shift suddenly?",
        ];
      },
      choices: [
        { id: "gradual",  label: "Gradual change over time",        next: "PERI_MONITOR_WRAP" },
        { id: "sudden",   label: "Sudden change",                   next: "PERI_PROVIDER_SOON" },
        { id: "heavy",    label: "Periods getting very heavy",      next: "HEAVY_INTRO" },
        { id: "stopped",  label: "Periods stopping for months",     next: "PERI_ABSENCE_CHECK" },
      ],
    },

    PERI_ABSENCE_CHECK: {
      say: [
        "If your periods have stopped for 12 months in a row, that's the clinical definition of menopause 🩷",
        "Before that point, pregnancy is still possible, so if there's any chance of pregnancy, a test would help clarify things.",
        "Has it been less than 12 months, or more?",
      ],
      choices: [
        { id: "less",   label: "Less than 12 months",  next: "PERI_MONITOR_WRAP" },
        { id: "more",   label: "12 months or more",    next: "MENOPAUSE_INFO_NODE", primary: true },
        { id: "unsure", label: "Not sure",              next: "PERI_MONITOR_WRAP" },
      ],
    },

    PERI_MOOD_ROUTE: {
      say() {
        const contextLine = periContextLineFor("mood");
        return [
          "Mood changes, brain fog, and emotional intensity during perimenopause are real, not imagined, not dramatic 🩷",
          ...(contextLine ? [contextLine] : []),
          "Estrogen affects serotonin and other brain chemicals, so as levels fluctuate, mood stability can too.",
          "That gives me more context - when symptoms cluster over time (for example mood + sleep + cycle shifts), the pattern is often more informative than one symptom on its own.",
          "Is it more like anxiety and irritability, or more like low mood and exhaustion?",
        ];
      },
      choices: [
        { id: "anxiety", label: "Anxiety or irritability",    next: "MOOD_ANXIETY_ROUTE" },
        { id: "low",     label: "Low mood or exhaustion",     next: "MOOD_LOW_ROUTE" },
        { id: "fog",     label: "Brain fog and memory",       next: "PERI_COGNITIVE_NOTE", primary: true },
        { id: "mix",     label: "A mix",                      next: "MOOD_MIXED_ROUTE" },
      ],
    },

    PERI_COGNITIVE_NOTE: {
      say: [
        "Brain fog and memory changes during perimenopause are incredibly common and incredibly frustrating 🩷",
        "Estrogen plays a role in cognitive function, so when it fluctuates, concentration and recall can be affected.",
        "This usually improves as hormones stabilise, but if it's significantly affecting your daily life, it's worth mentioning to a provider.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },

    PERI_SLEEP_ROUTE: {
      say: [
        "Sleep disruption is one of the most exhausting parts of perimenopause 🩷",
        "It can come from night sweats waking you up, or from progesterone changes that affect sleep quality directly, sometimes both.",
        "Are you waking up from heat and sweating, or is it more that you just can't stay asleep?",
      ],
      choices: [
        { id: "heat",    label: "Waking from heat or sweating", next: "PERI_VASOMOTOR_ROUTE" },
        { id: "sleep",   label: "Can't stay asleep generally",  next: "BODY_SLEEP_ROUTE" },
        { id: "both",    label: "Both",                         next: "PERI_PROVIDER_SOON", primary: true },
      ],
    },

    PERI_VAGINAL_ROUTE: {
      say: [
        "Vaginal dryness and discomfort during sex are common in perimenopause and menopause, and they're very treatable 🩷",
        "As estrogen drops, vaginal tissue can become thinner and less lubricated. This is called genitourinary syndrome of menopause and it does not have to be something you just live with.",
        "There are options, from over-the-counter lubricants and moisturisers to treatments a provider can discuss with you.",
      ],
      choices: [
        { id: "map",    label: "Find care near me",              next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "contra", label: "Learn about contraception options", next: "EDUC_CONTRACEPTION" },
        { id: "menu",   label: "Back to main menu",              next: "START_MENU" },
      ],
    },

    PERI_MIXED_ROUTE: {
      say: [
        "A mix of symptoms is actually very typical for perimenopause, it's rarely just one thing 🩷",
        "The most helpful thing you can do right now is track what you're experiencing, when symptoms happen, how intense they are, and whether they're getting worse.",
        "That information is gold when you talk to a provider.",
      ],
      choices: [
        { id: "cont", label: "What should I do next?", next: "PERI_PROVIDER_SOON", primary: true },
      ],
    },

    PERI_UNSURE_ROUTE: {
      say: [
        "That uncertainty is really common, perimenopause can start earlier than most people expect and the symptoms overlap with a lot of other things 🩷",
        "Some things that can help you figure it out: tracking your cycle changes, noting which symptoms cluster together, and thinking about your age and family history.",
        "You don't need a definitive answer to start paying attention.",
      ],
      choices: [
        { id: "more",  label: "Tell me more about the symptoms",  next: "PERIMENOPAUSE_INTRO" },
        { id: "cycle", label: "I think my periods are changing",  next: "PERI_CYCLE_ROUTE" },
        { id: "care",  label: "I want to talk to a provider",     next: "PERI_PROVIDER_SOON", primary: true },
        { id: "menu",  label: "Back to main menu",                next: "START_MENU" },
      ],
    },

    PERI_MONITOR_WRAP: {
      say: [
        "Based on what you've shared, this sounds like it may be part of the perimenopause transition 🩷",
        "The most useful thing right now is consistent tracking, cycle dates, symptom types, intensity, and duration. Patterns over time tell a much clearer story than any single day.",
        "If symptoms become more intense, start affecting your daily life significantly, or you have very heavy bleeding, that's when to move from tracking to seeking care.",
      ],
      choices: [
        { id: "log",  label: "Log a symptom",     next: "START_MENU", action: "LOG_SYMPTOM" },
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP" },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    PERI_PROVIDER_SOON: {
      say: [
        "What you're describing is worth discussing with a healthcare provider, not because it's an emergency, but because you deserve proper support for this transition 🩷",
        "A provider can confirm whether this is perimenopause, rule out other causes, and talk through options that might help.",
        "In Jamaica, a gynaecologist or your GP is a good starting point. The care map can help you find someone nearby.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    MENOPAUSE_INFO_NODE: {
      say: [
        "Twelve months without a period is the clinical marker for menopause, your body has completed that transition 🩷",
        "What comes after is called postmenopause. Some symptoms like hot flashes and sleep disruption may continue for a while, but for many people they ease over time.",
        "Vaginal dryness, bone health, and cardiovascular changes are things worth discussing with a provider now that you're postmenopausal, not to alarm you, but because this is a new chapter your body deserves support for.",
      ],
      choices: [
        { id: "vaginal", label: "Vaginal dryness or discomfort", next: "PERI_VAGINAL_ROUTE" },
        { id: "mood",    label: "Mood or sleep changes",         next: "PERI_MOOD_ROUTE" },
        { id: "map",     label: "Find care near me",             next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu",    label: "Back to main menu",             next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: MENOPAUSE ---------------- */
    EDUC_MENOPAUSE: {
      say: [
        "Menopause is defined as 12 consecutive months without a period, that 12-month mark is the official transition point 🩷 The average age is around 51, but it's completely normal to reach it earlier or later.",
        "It's important to name this clearly: menopause is a natural life transition, not an illness. That said, the hormonal shifts involved are real, and so are the symptoms, you don't have to just push through them.",
        "After menopause, some symptoms from the perimenopause years continue: hot flashes, sleep disruption, mood changes, vaginal dryness, joint discomfort, and changes in bone density are all things providers take seriously and can help with.",
        "Support options range from lifestyle approaches (movement, sleep hygiene, nutrition) to menopausal hormone therapy (MHT/HRT), non-hormonal medications, and talking therapies, the right fit depends on your health history and your preferences. A provider or menopause specialist can walk you through what's available 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: CONTRACEPTION ---------------- */
    EDUC_CONTRACEPTION: {
      say(ctx) {
        const lines = [
          "Contraception is something Bloomie can give you a general overview of, but I want to be upfront: I can't recommend a specific method for you, because what works best really depends on your health history, your cycle, and your own goals 🩷",
          "That said, here's a quick lay of the land: barrier methods (like condoms or diaphragms) work in the moment and don't affect your hormones. Hormonal methods (the pill, patch, ring, shot) use synthetic hormones to prevent pregnancy and can also help with cycle symptoms. Long-acting options (IUDs, hormonal or copper, and implants) are set-and-forget for years at a time.",
          "Each category has real trade-offs, side effects, how easy they are to use, how quickly fertility returns and a provider or pharmacist can walk you through what fits your situation, your body, and your life.",
          "If you don't have a regular provider, a sexual health clinic or a pharmacist are both great first steps 🩷",
        ];
        if (ctx.isMinor) lines.unshift("Asking about this is a smart, healthy thing to do - you should feel good about looking into it 🩷");
        return lines;
      },
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: PCOS ---------------- */
    EDUC_PCOS: {
      say: [
        "PCOS- polycystic ovary syndrome, is one of the most common hormonal conditions people with periods deal with, and it's way more manageable than it sounds 🩷",
        "It basically means your hormones are running a little out of balance, which can cause things like irregular or skipped periods, acne that flares around your cycle, extra hair growth (chin, chest, belly), weight changes, or difficulty conceiving.",
        "The frustrating part is that PCOS looks different for everyone, some people have most of those symptoms, some have just one or two. That's why getting an actual diagnosis (usually an ultrasound plus a blood panel) matters so much.",
        "If your periods are consistently irregular, or you've been noticing acne or hair changes alongside cycle issues, it's worth bringing up with a provider, not because it's an emergency, but because the right support makes a real difference 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },

    /* ---------------- EDUCATION: ENDOMETRIOSIS ---------------- */
    EDUC_ENDO: {
      say: [
        "Endometriosis (often called endo) is a condition where tissue similar to your uterine lining grows in places it shouldn't, like on your ovaries or fallopian tubes, and that tissue still responds to your hormones each cycle 🩷",
        "That's why endo pain tends to show up around your period and can be really intense, cramping that doesn't respond well to regular pain relief, pain during sex, heavy bleeding, or a deep aching in your pelvis or lower back.",
        "One thing worth knowing: endo symptoms are often dismissed or written off as bad periods for years. If your period pain is significantly affecting your day-to-day life, if you're missing work, school, or things you love, that's not something you should have to just push through.",
        "Endo is diagnosed through a procedure called a laparoscopy, but a provider can also start with an ultrasound and a thorough conversation about your symptoms. You deserve to be taken seriously 🩷",
      ],
      choices: [
        { id: "map",  label: "Find care near me",   next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",   next: "START_MENU" },
      ],
    },
  };
}
