/**
 * bloomie-nodes-general.js
 * "Something else", body changes, discharge, cycle-aware smart nodes,
 * mode-specific entry nodes, and session mode nodes.
 * Covers: ELSE_INTRO, ELSE_PAIN_ENTRY, ELSE_BODY_CHANGES, ELSE_NOT_SURE,
 * ELSE_PAIN_SCALE through ELSE_TRACK_WRAP, ELSE_BODY_ENTRY,
 * BODY_HORMONAL_ROUTE, BODY_SLEEP_ROUTE, ELSE_DISCHARGE_ENTRY,
 * DISCHARGE_PROVIDER_SOON, DISCHARGE_URGENT, DISCHARGE_MONITOR,
 * DISCHARGE_CLARIFY, EDUC_DISCHARGE, ELSE_NOT_SURE_ROUTE,
 * ELSE_URGENT_CHECK, ELSE_URGENT_TRUST, ELSE_CHANGE_TYPE, ELSE_TALK_THROUGH,
 * ELSE_MONITOR_WRAP, ELSE_PROVIDER_WRAP, ELSE_TRACK_WRAP,
 * CYCLE_EDD_GATE, CYCLE_PHASE_ANSWER, CYCLE_NEXT_PERIOD, CYCLE_LMP_ANSWER,
 * CYCLE_TEST_TIMING, EDD_CONFIRM, EDD_EXPLORE, CYCLE_EDD_ANSWER,
 * CYCLE_TTC_INFO, CYCLE_POSTPARTUM,
 * POSTPARTUM_INTRO, TTC_INTRO, MODE_CONFIRM,
 * SESSION_MODE_CONFIRM, SESSION_MODE_SET_PREGNANCY,
 * SESSION_MODE_SET_TTC, SESSION_MODE_SET_BROWSING.
 */
export function createGeneralNodes(env, helpers) {
  const {
    ctx, cd, userMode, say, transition, pick, ack, qualifier, consent,
    quickSummary, safeFooter, effectiveLmp, effectiveCycleLength,
    effectiveMode, hasLmpData, getCurrentPhase, addDays, fmtDate,
    applySessionMode, daysBetween, daysUntilNextPeriod,
    buildSymptomInsightLine,
    smartTestTiming,
  } = env;
  const { pickCloseLabel, pickMainLabel } = helpers;

  return {
    /* ---------------- SOMETHING ELSE ---------------- */
    ELSE_INTRO: {
      say: [
        "That's okay 🩷 Not every concern fits neatly into one label.",
        "Pick the option that feels closest and we'll go from there.",
      ],
      choices: [
        { id: "pain",  label: "Pain or cramps",                        next: "ELSE_PAIN_ENTRY",    primary: true },
        { id: "dis",   label: "Unusual discharge or odour",             next: "ELSE_DISCHARGE_ENTRY" },
        { id: "cycle", label: "Cycle timing feels off",                 next: "LATE_INTRO" },
        { id: "preg",  label: "Pregnancy or fertility concern",         next: "PREGNANCY_ENTRY" },
        { id: "mood",  label: "Mood, anxiety, or low energy",           next: "MOOD_INTRO" },
        { id: "body",  label: "Skin, hair, weight, or sleep changes",   next: "ELSE_BODY_ENTRY" },
        { id: "ns",    label: "I'm not sure",                           next: "ELSE_NOT_SURE_ROUTE" },
      ],
    },

    ELSE_PAIN_ENTRY: {
      say: [
        "Got you 🩷",
        "Is this mostly pelvic or cramp-like pain connected to your cycle, or something more general or hard to place?",
      ],
      choices: [
        { id: "pelvic",   label: "Pelvic / cramps / feels cycle-related", next: "PELVIC_INTRO",     primary: true },
        { id: "sex",      label: "Pain during sex",                        next: "PELVIC_SEX_INTRO" },
        { id: "general",  label: "General or hard to place",               next: "ELSE_PAIN_SCALE" },
        { id: "ns",       label: "Not sure",                               next: "ELSE_PAIN_SCALE" },
      ],
    },

    ELSE_BODY_CHANGES: {
      say: [
        "Thanks for sharing that 🩷 A lot of people notice body changes, like skin, hair, weight, or sleep, that feel connected to their cycle but aren't sure if they are.",
        "Which feels most relevant right now?",
      ],
      choices: [
        { id: "skin",  label: "Acne or skin changes",             next: "ELSE_NOT_SURE", primary: true },
        { id: "hair",  label: "Hair thinning or shedding",        next: "ELSE_NOT_SURE" },
        { id: "sleep", label: "Sleep problems",                   next: "MOOD_INTRO" },
        { id: "hfsh",  label: "Hot flashes or night sweats",      next: "PERIMENOPAUSE_INTRO" },
        { id: "back",  label: "Back to main options",             next: "ELSE_INTRO" },
      ],
    },
    ELSE_NOT_SURE: {
      say: [
        "That's completely okay, sometimes it's hard to name it 🩷",
        "Let me ask a couple of quick things.",
        "Is there anything that feels different from your normal cycle? For example: your timing, your flow, your pain level, or your mood?",
      ],
      choices: [
        { id: "timing", label: "Timing feels off", next: "LATE_INTRO", primary: true },
        { id: "flow",   label: "Flow feels different", next: "HEAVY_INTRO" },
        { id: "pain",   label: "More pain than usual", next: "PELVIC_INTRO" },
        { id: "mood",   label: "Mood or energy changes", next: "MOOD_INTRO" },
        { id: "spot",   label: "Spotting or unusual bleeding", next: "SPOT_INTRO" },
        { id: "menu",   label: "Back to main options", next: "START_MENU" },
      ],
    },
    ELSE_PAIN_SCALE: {
      say: ["On a scale from 0–10, how strong is the pain?"],
      question: "Pain level (0–10 group)",
      choices: [
        { id: "m1", label: "0–3 (mild)", next: "ELSE_PAIN_MILD", primary: true },
        { id: "m2", label: "4–6 (moderate)", next: "ELSE_PAIN_MILD" },
        { id: "m3", label: "7–10 (severe)", next: "ELSE_PAIN_SEVERE" },
      ],
    },
    ELSE_PAIN_MILD: {
      say: [
        "Okay, thanks for telling me 🩷",
        "Mild to moderate cramps can happen around your period (and even around ovulation) but you still deserve support, not just a shrug.",
        "Quick check: is the pain improving with rest, heat (warm bottle/shower), or pain relief?",
      ],
      question: "Pain improving with rest/heat/relief?",
      choices: [
        { id: "yes", label: "Yes", next: "ELSE_PAIN_IMPROVING_YES", primary: true },
        { id: "no", label: "No", next: "ELSE_PAIN_IMPROVING_NO" },
        { id: "sometimes", label: "A little / sometimes", next: "ELSE_PAIN_IMPROVING_SOMETIMES" },
      ],
    },
    ELSE_PAIN_IMPROVING_YES: {
      say: [
        "That's a good sign 🩷",
        "When cramps respond to heat/rest/relief, it often matches the more 'typical' kind of period pain.",
        "If you want a few gentle supports for today:",
        "• Heat pad / warm shower\n• Sip water (or ginger tea)\n• Light movement if it feels okay\n• Track what day it happens + how strong it is",
        "One more question: does this kind of cramping feel pretty normal for you, or is it new/different?",
      ],
      question: "Cramps normal for you or new?",
      choices: [
        { id: "normal", label: "It's normal for me", next: "ELSE_PAIN_NORMAL_WRAP", primary: true },
        { id: "new", label: "It feels new/different", next: "ELSE_PAIN_NEW_WRAP" },
        { id: "ns", label: "Not sure", next: "ELSE_PAIN_NEW_WRAP" },
      ],
    },
    ELSE_PAIN_IMPROVING_SOMETIMES: {
      say: [
        "Got you 🩷",
        "If it only improves sometimes, it can help to notice what makes it worse or better.",
        "A few quick pattern checks:",
        "• Is it worst on day 1–2?\n• Does it spike with stress or poor sleep?\n• Is it sharper on one side?",
        "Would you say the pain is getting worse compared to your last few cycles?",
      ],
      question: "Pain getting worse over time?",
      choices: [
        { id: "yes", label: "Yes, it's getting worse", next: "ELSE_PAIN_WORSENING", primary: true },
        { id: "no", label: "No, it's about the same", next: "ELSE_PAIN_SAME_WRAP" },
        { id: "ns", label: "Not sure", next: "ELSE_PAIN_SAME_WRAP" },
      ],
    },
    ELSE_PAIN_IMPROVING_NO: {
      say() {
        const nauseaKnown = ctx.entityHistory?.some(e => e.symptoms?.nausea);
        const heavyKnown  = ctx.entityHistory?.some(e => e.symptoms?.heavy);
        const acks = [
          ...(nauseaKnown ? [pick(["I've noted you mentioned nausea 🩷", "Got that you've had nausea - keeping that in mind 🩷"])] : []),
          ...(heavyKnown  ? [pick(["I've noted you mentioned heavy bleeding 🩷", "I remember you mentioned heavy bleeding, I've got that noted 🩷"])] : []),
        ];
        const prompt = (nauseaKnown || heavyKnown)
          ? pick(["Are you also having any of these?", "Are any of these also happening?"])
          : "Are you also having any of these right now?";
        return [
          "Thanks for being honest 🩷",
          "If cramps aren't improving with rest/heat/relief or they're stopping you from doing normal things that's worth paying attention to.",
          "I can't diagnose, but I can help you sort what's 'monitor' vs 'get checked'.",
          ...acks,
          prompt,
        ];
      },
      multi: {
        question: "Select anything that applies:",
        options: ["Pain is getting worse fast", "One-sided sharp pain", "Fever or chills", "Nausea/vomiting", "Very heavy bleeding", "Pain during sex", "None of these"],
        nextOnSubmit: "ELSE_PAIN_RED_FLAGS_GUIDE",
        allowNone: false,
      },
    },
    ELSE_PAIN_RED_FLAGS_GUIDE: {
      autoNext(_ctx, payload) {
        const sel = payload.multi || [];
        return sel.length && !sel.includes("None of these") ? "ELSE_PAIN_PROVIDER_SOON" : "ELSE_PAIN_MONITOR_WRAP";
      },
    },
    ELSE_PAIN_NORMAL_WRAP: {
      say: [
        "Okay 🩷 If it's normal for you and it responds to comfort measures, that usually points to 'manage + track'.",
        "Still, if it suddenly becomes much worse, lasts longer than usual, or comes with heavy bleeding or dizziness, that's a sign to get checked.",
        "Do you want to go back to the main options, or talk through something else you noticed?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    ELSE_PAIN_NEW_WRAP: {
      say: [
        "Thanks! 'new or different' is an important detail 🩷",
        "Sometimes cramps shift with stress, sleep, diet changes, a delayed cycle, or hormonal changes.",
        "But if this repeats or keeps escalating, it's worth mentioning to a healthcare provider.",
        "If you want, I can help you summarize what changed so it's easy to explain.",
      ],
      choices: [
        { id: "sum", label: "Help me summarize", next: "ELSE_SUMMARY_DONE", action: "REQUEST_PDF", primary: true },
        { id: "map", label: "Find care near me", next: "START_MENU", action: "OPEN_MAP" },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
      ],
    },
    ELSE_PAIN_WORSENING: {
      say: [
        "Mm. If it's getting worse over multiple cycles, that's a good reason to take it seriously 🩷",
        "Not because it automatically means something scary but because you deserve support and answers.",
        "If you can, consider talking with a healthcare provider, especially if it affects school/work/sleep.",
        "Want to use the care map, or go back to the main menu?",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    ELSE_PAIN_SAME_WRAP: {
      say: [
        "Got you 🩷",
        "If it's stable and not escalating, tracking + comfort strategies can be enough for many people.",
        "If you'd like, I can help you track: day of cycle, intensity, and what improves it that pattern can be really useful later.",
        "Want to go back to the main options?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    ELSE_PAIN_PROVIDER_SOON: {
      say: [
        "Thanks for sharing that 🩷",
        "Because you selected symptoms that can sometimes signal something more than routine cramps, it would be a good idea to get medical advice soon especially if symptoms worsen.",
        "If you feel faint, have severe one-sided pain, or very heavy bleeding, please treat it as urgent.",
        "Want to use the care map?",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "sum", label: "Help me summarize", next: "ELSE_SUMMARY_DONE", action: "REQUEST_PDF" },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
      ],
    },
    ELSE_PAIN_MONITOR_WRAP: {
      say: [
        "Okay 🩷 Since you didn't select any major red flags, this sounds more like a 'monitor + support' situation for now.",
        "Try comfort care and keep an eye on patterns.",
        "If it becomes severe, sudden, one-sided, or starts coming with heavy bleeding/dizziness, that's a reason to get checked.",
        "Do you want to go back to the main menu or talk through another symptom?",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Something else", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    ELSE_PAIN_SEVERE: {
      say: [
        "Thanks for letting me know 🩷",
        "Severe or worsening pain isn't something you should ignore.",
        "If the pain is sudden, intense, or interfering with daily activities, it would be a good idea to seek medical care.",
      ],
      choices: [
        { id: "map", label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    ELSE_DISCHARGE: {
      say: ["Thanks for sharing 🩷", "Is the discharge unusual in color, smell, or amount compared to what's normal for you?"],
      question: "Discharge unusual vs normal?",
      choices: [
        { id: "yes", label: "Yes, something feels off",        next: "ELSE_DISCHARGE_ENTRY", primary: true },
        { id: "no",  label: "No, it seems normal but more",    next: "DISCHARGE_MONITOR" },
        { id: "ns",  label: "Not sure / hard to tell",         next: "DISCHARGE_CLARIFY" },
      ],
    },
    ELSE_OFF: {
      say: ["Thanks for explaining 🩷", "Have you noticed more than one change this cycle? (for example: timing + pain, or flow + mood)"],
      question: "More than one change this cycle?",
      choices: [
        { id: "yes", label: "Yes", next: "ELSE_WRAP", primary: true },
        { id: "no", label: "No", next: "ELSE_WRAP" },
      ],
    },
    ELSE_PROVIDER: {
      say: [
        "Thanks for sharing that 🩷",
        "When discharge changes in smell, colour, or texture, it's worth getting checked — not because it's definitely something serious, but because some infections are very easy to treat when caught early.",
        "Signs that mean get checked soon: strong or fishy smell, yellow or green colour, cottage-cheese texture, or discharge with itching, burning, or pelvic pain.",
        "A pharmacist or clinic visit is a quick, no-judgment way to rule things out.",
      ],
      choices: [
        { id: "what",  label: "What could cause this?",  next: "EDUC_DISCHARGE", primary: true },
        { id: "map",   label: "Find care near me",        next: "START_MENU", action: "OPEN_MAP" },
        { id: "menu",  label: pickMainLabel(),             next: "START_MENU" },
      ],
    },
    ELSE_SUMMARY_DONE: {
      say: ["Done 🩷 If PDF export is enabled, you can download your summary now.", "Want to check anything else while you're here?"],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },
    ELSE_WRAP: {
      say: [
        "Thanks for sharing that with me 🩷",
        "I can't diagnose, but the way you're noticing patterns and asking questions is exactly how you advocate for your health.",
        "If you want, we can go back to the main options or talk through one more detail (timing, triggers, what makes it better/worse).",
      ],
      choices: [
        { id: "menu", label: pickMainLabel(), next: "START_MENU", primary: true },
        { id: "else", label: "Keep talking (something else)", next: "ELSE_INTRO" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },

    /* ---- ELSE: body change nodes ---- */

    ELSE_BODY_ENTRY: {
      say: [
        "Body changes can be connected to your cycle more than people expect 🩷",
        "Which feels most like what you're noticing?",
      ],
      choices: [
        { id: "acne",  label: "Acne or oily skin",                   next: "BODY_HORMONAL_ROUTE", primary: true },
        { id: "hair",  label: "Hair thinning or increased facial hair", next: "BODY_HORMONAL_ROUTE" },
        { id: "sleep", label: "Sleep issues or insomnia",             next: "BODY_SLEEP_ROUTE" },
        { id: "hfsh",  label: "Hot flashes or night sweats",          next: "PERIMENOPAUSE_INTRO" },
        { id: "mix",   label: "Not sure or a mix of these",           next: "BODY_HORMONAL_ROUTE" },
      ],
    },

    BODY_HORMONAL_ROUTE: {
      say: [
        "Skin, hair, and weight changes can all be connected to hormonal shifts, especially if they're showing up alongside cycle changes 🩷",
        "The most common hormonal causes include PCOS, thyroid changes, and natural fluctuations in estrogen and progesterone.",
        "A few things to notice: are these changes happening around specific points in your cycle, or all the time? Have your periods changed alongside these symptoms?",
        "If multiple of these things are happening together, irregular periods, acne, hair changes, weight shifts, it's worth bringing to a provider. Not because something is definitely wrong, but because those patterns together tell a clearer story.",
      ],
      choices: [
        { id: "pcos",  label: "Learn about PCOS",     next: "EDUC_PCOS",    primary: true },
        { id: "log",   label: "Track this concern",   next: "START_MENU",   action: "LOG_SYMPTOM", logData: { type: "body_hormonal", note: "Body change concern logged from Bloomie chat" } },
        { id: "map",   label: "Find care near me",    next: "START_MENU",        action: "OPEN_MAP" },
        { id: "menu",  label: "Back to main menu",    next: "START_MENU" },
      ],
    },

    BODY_SLEEP_ROUTE: {
      say: [
        "Sleep issues are more connected to your cycle than most people realise 🩷",
        "In the luteal phase, progesterone can make you feel sleepy but actually disrupts deep sleep quality, which is why some people feel exhausted even after a full night.",
        "Poor sleep can also amplify mood changes, cravings, and pain sensitivity, so it's worth tracking whether it clusters around certain cycle days.",
        "If sleep issues are happening all cycle long or getting worse, it may be worth mentioning to a provider. Thyroid changes and perimenopause can also affect sleep.",
      ],
      choices: [
        { id: "mood",  label: "My mood is also affected",     next: "MOOD_INTRO",           primary: true },
        { id: "peri",  label: "Learn about perimenopause",    next: "PERIMENOPAUSE_INTRO" },
        { id: "menu",  label: "Back to main menu",            next: "START_MENU" },
      ],
    },

    /* ---- ELSE: discharge nodes ---- */

    ELSE_DISCHARGE_ENTRY: {
      say: [
        "Discharge changes can mean a lot of different things 🩷",
        "What feels most like what you're noticing?",
      ],
      choices: [
        { id: "smell",  label: "Strong smell, itching, or burning",      next: "DISCHARGE_PROVIDER_SOON", primary: true },
        { id: "colour", label: "Unusual colour (yellow, green, grey)",   next: "DISCHARGE_PROVIDER_SOON" },
        { id: "fever",  label: "Fever or pelvic pain alongside it",      next: "DISCHARGE_URGENT" },
        { id: "more",   label: "Just more than usual, otherwise normal", next: "DISCHARGE_MONITOR" },
        { id: "diff",   label: "Not sure / just feels different",        next: "DISCHARGE_CLARIFY" },
      ],
    },

    DISCHARGE_PROVIDER_SOON: {
      say: [
        "What you're describing, especially the smell, colour, or irritation, is worth getting checked 🩷",
        "Unusual discharge with those qualities can sometimes signal a bacterial or yeast infection, or occasionally an STI, and those are all treatable.",
        "A healthcare provider or pharmacist can do a proper check. It's a quick visit and you deserve to know what's going on.",
        "In the meantime, avoid scented products or harsh home remedies down there, and wear breathable cotton underwear if you can.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",  next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",  next: "START_MENU" },
      ],
    },

    DISCHARGE_URGENT: {
      say: [
        "Discharge combined with fever or pelvic pain needs proper attention today 🩷",
        "That combination can sometimes point to an infection that needs treatment sooner rather than later, like pelvic inflammatory disease (PID), which is very treatable when caught early.",
        "Please don't wait on this one. Try to see a provider today or go to urgent care.",
      ],
      choices: [
        { id: "map",  label: "Find care near me",  next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu",  next: "START_MENU" },
      ],
    },

    DISCHARGE_MONITOR: {
      say() {
        const insightLine = buildSymptomInsightLine();
        return [
          "Discharge that's increased but otherwise looks and smells normal is usually not a concern on its own 🩷",
          "Discharge naturally changes throughout your cycle. It tends to be more watery or egg-white-like around ovulation and thicker or creamier in the luteal phase.",
          ...(insightLine ? [insightLine] : []),
          "Keep an eye on it. If the smell, colour, or texture changes, or if you notice itching or burning, come back and let's look at it again.",
        ];
      },
      choices: [
        { id: "educ", label: "Learn more about discharge changes", next: "EDUC_DISCHARGE", primary: true },
        { id: "menu", label: "Back to main menu",                  next: "START_MENU" },
      ],
    },

    DISCHARGE_CLARIFY: {
      say: [
        "That's okay 🩷 Sometimes it's hard to describe.",
        "Has anything else changed alongside it, any smell, colour change, itching, pain, or fever?",
      ],
      choices: [
        { id: "yes",   label: "Yes, some of those",             next: "DISCHARGE_PROVIDER_SOON", primary: true },
        { id: "no",    label: "No, it just seems different",    next: "DISCHARGE_MONITOR" },
        { id: "infec", label: "I think I might have an infection", next: "DISCHARGE_PROVIDER_SOON" },
      ],
    },

    EDUC_DISCHARGE: {
      say: [
        "Discharge is actually a healthy part of how the vagina cleans itself 🩷",
        "What's 'normal' varies a lot between people, but generally: clear to white, mild or no smell, and texture that changes through the cycle is all typical.",
        "What's worth checking: strong or fishy smell, yellow or green colour, cottage cheese texture, or discharge that comes with itching, burning, or pain.",
      ],
      choices: [
        { id: "menu", label: "Back to main menu", next: "START_MENU", primary: true },
      ],
    },

    /* ---- ELSE: not-sure route nodes ---- */

    ELSE_NOT_SURE_ROUTE: {
      say: [
        "That's completely okay 🩷",
        "What would help most right now?",
      ],
      choices: [
        { id: "urgent", label: "I want to know if it's urgent",                next: "ELSE_URGENT_CHECK",   primary: true },
        { id: "normal", label: "I want to know if what I'm feeling is normal", next: "ELSE_CHANGE_TYPE" },
        { id: "figure", label: "I want help figuring out what changed",        next: "ELSE_CHANGE_TYPE" },
        { id: "talk",   label: "I just need to talk it through",               next: "ELSE_TALK_THROUGH" },
      ],
    },

    ELSE_URGENT_CHECK: {
      say: [
        "Before we sort the details, let me check for anything urgent 🩷",
        "Are you having severe pain, very heavy bleeding, fever, fainting, or a strong feeling that something is seriously wrong?",
      ],
      choices: [
        { id: "yes", label: "Yes",      next: "HEAVY_URGENT",     primary: true },
        { id: "no",  label: "No",       next: "ELSE_CHANGE_TYPE" },
        { id: "ns",  label: "Not sure", next: "ELSE_URGENT_TRUST" },
      ],
    },

    ELSE_URGENT_TRUST: {
      say: [
        "Trust that instinct 🩷 If something feels seriously wrong, it's always okay to seek care.",
        "Find a provider near you or go to urgent care.",
      ],
      choices: [
        { id: "map",    label: "Find care near me",       next: "START_MENU",            action: "OPEN_MAP", primary: true },
        { id: "change", label: "Help me figure out more", next: "ELSE_CHANGE_TYPE" },
      ],
    },

    ELSE_CHANGE_TYPE: {
      say: [
        "What feels most like what's changed? 🩷",
      ],
      choices: [
        { id: "cycle",  label: "Cycle timing or missed period", next: "LATE_INTRO",            primary: true },
        { id: "flow",   label: "Flow or bleeding",              next: "HEAVY_INTRO" },
        { id: "pain",   label: "Pelvic pain or cramps",         next: "PELVIC_INTRO" },
        { id: "mood",   label: "Mood or energy",                next: "MOOD_INTRO" },
        { id: "spot",   label: "Spotting",                      next: "SPOT_INTRO" },
        { id: "dis",    label: "Discharge or body changes",     next: "ELSE_DISCHARGE_ENTRY" },
      ],
    },

    ELSE_TALK_THROUGH: {
      say: [
        "Of course 🩷 Sometimes you just need to get it out before figuring out what it is.",
        "Tell me what's been going on in your own words — no right or wrong way to say it.",
      ],
      choices: [
        { id: "cycle",   label: "It's about my cycle or period",   next: "PERIOD_TRIAGE",       primary: true },
        { id: "pain",    label: "Pain or discomfort",              next: "PELVIC_INTRO" },
        { id: "mood",    label: "Mood or emotional changes",       next: "MOOD_SAFETY_CHECK" },
        { id: "dis",     label: "Discharge or odour",              next: "ELSE_DISCHARGE_ENTRY" },
        { id: "ns",      label: "Not sure yet",                    next: "ELSE_CHANGE_TYPE" },
      ],
    },

    /* ---- ELSE: wrap nodes ---- */

    ELSE_MONITOR_WRAP: {
      say: [
        "Based on what you shared, this sounds like something worth keeping an eye on rather than something urgent right now 🩷",
        "Track it for a cycle or two. Note when it happens, how long it lasts, and whether it changes. That kind of pattern is really useful if you ever talk to a provider.",
      ],
      choices: [
        { id: "log",  label: "Log this",         next: "START_MENU", action: "LOG_SYMPTOM", logData: { type: "general", note: "Concern logged from Bloomie chat" }, primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    ELSE_PROVIDER_WRAP: {
      say: [
        "What you're describing is worth a proper check 🩷 Not because it's definitely something serious, but because you deserve a real answer, not just reassurance.",
        "A healthcare provider can do the kind of assessment that actually rules things in or out.",
      ],
      choices: [
        { id: "map",  label: "Find care near me", next: "START_MENU", action: "OPEN_MAP", primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    ELSE_TRACK_WRAP: {
      say: [
        "This is the kind of thing that becomes clearer with a bit more data 🩷",
        "If you log your symptoms over the next cycle, patterns start to emerge, and that information is genuinely useful whether you keep it for yourself or share it with a provider.",
      ],
      choices: [
        { id: "log",  label: "Log this",         next: "START_MENU", action: "LOG_SYMPTOM", logData: { type: "general", note: "Concern logged from Bloomie chat" }, primary: true },
        { id: "menu", label: "Back to main menu", next: "START_MENU" },
      ],
    },

    /* ---------------- CYCLE-AWARE SMART NODES ---------------- */

    // Gate node: silently redirect to SESSION_MODE_CONFIRM if mode is unknown/browsing,
    // or go straight to CYCLE_EDD_ANSWER if already confirmed.
    CYCLE_EDD_GATE: {
      say: [],
      onEnter() {
        const mode = effectiveMode();
        if (mode === "pregnancy_tracking" || cd.pregnancyConfirmed) {
          transition("CYCLE_EDD_ANSWER");
        } else {
          transition("SESSION_MODE_CONFIRM");
        }
      },
      choices: [],
    },

    CYCLE_PHASE_ANSWER: {
      say() {
        if (userMode.isPostpartum) {
          return [
            "Since you're in postpartum mode, your cycle may still be returning 🩷",
            "It can take several weeks to months for periods to resume, especially if breastfeeding.",
            "If you've had your first postpartum period and want to start tracking again, log it on the dashboard.",
          ];
        }
        if (userMode.isPregnancy) {
          return [
            "You're currently in pregnancy tracking mode, so cycle phases don't apply right now 🩷",
            "Would you like to know how far along you are instead?",
          ];
        }
        if (!hasLmpData()) {
          ctx.captureReturnTo = "CYCLE_PHASE_ANSWER";
          return [
            "I'd love to tell you what phase you're in 🩷",
            "I need the date your last period started, you can enter it here or log it on your dashboard.",
          ];
        }
        const p = getCurrentPhase();
        if (!p) return ["Couldn't work that out right now 🩷 Check that your last period date is up to date on the dashboard."];
        const lmp = effectiveLmp();
        const next = cd.nextPeriodDate || addDays(lmp, effectiveCycleLength());
        const daysLeft = daysUntilNextPeriod();
        const periodNote = daysLeft > 0
          ? `Your next period is expected in about ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`
          : "Your period may be due around now if it hasn't come, keep an eye on it.";
        const ttcNote = userMode.isTTC && p.phase === "ovulation"
          ? "You're in your fertile window right now best time if you're trying to conceive 🌟"
          : userMode.isTTC && p.phase === "follicular"
          ? "Ovulation is coming up soon good time to prepare if you're TTC."
          : null;
        return [
          ...quickSummary(
            `You're in ${p.label} day ${p.days + 1} of your cycle.`,
            `${qualifier()}: last period ${fmtDate(lmp)}, ${effectiveCycleLength()}-day cycle.`,
            periodNote
          ),
          ttcNote,
        ].filter(Boolean);
      },
      choices() {
        const base = [
          { id: "late", label: "My period is late", next: "LATE_INTRO", primary: true },
          { id: "mood", label: "I'm getting PMS symptoms", next: "MOOD_INTRO" },
          { id: "ttc",  label: "I'm trying to conceive", next: "CYCLE_TTC_INFO" },
          { id: "menu", label: pickMainLabel(), next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          base.unshift({ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true });
        }
        return base;
      },
    },

    CYCLE_NEXT_PERIOD: {
      say() {
        if (userMode.isPregnancy) {
          return [
            "You're in pregnancy tracking mode, so your period isn't expected right now 🩷",
            "Would you like to know your due date or how far along you are?",
          ];
        }
        if (userMode.isPostpartum) {
          return [
            "In postpartum mode, predicting your next period depends on whether your cycle has returned 🩷",
            "If you've had your first postpartum period, log it on the dashboard so I can start tracking again.",
          ];
        }
        if (!hasLmpData()) {
          ctx.captureReturnTo = "CYCLE_NEXT_PERIOD";
          return [
            "To tell you when your next period is expected, I need your last period start date 🩷",
            "You can type it here and I'll estimate right now or you canlog it on the dashboard.",
          ];
        }
        const next = cd.nextPeriodDate || addDays(cd.lmp, cd.cycleLength);
        const daysLeft = daysUntilNextPeriod();
        if (typeof daysLeft !== "number") {
          return ["I couldn't line up your next expected period right now 🩷 Check that your logged dates are up to date and try again."];
        }
        const nextStr = fmtDate(next);
        const ttcNote = userMode.isTTC
          ? `In TTC mode, ovulation likely falls around ${fmtDate(addDays(cd.lmp, Math.round(cd.cycleLength / 2)))} about ${Math.round(cd.cycleLength / 2)} days into your cycle.`
          : null;
        if (daysLeft < 0) {
          const daysOver = Math.abs(daysLeft);
          return [
            `Based on your last period and your average ${cd.cycleLength}-day cycle, your period was expected around ${nextStr} 🩷`,
            `That's ${daysOver} day${daysOver === 1 ? "" : "s"} ago if it hasn't come yet, it may be worth checking in.`,
            "Is there any chance of pregnancy this cycle?",
          ].filter(Boolean);
        }
        if (daysLeft === 0) return [`Your period is expected today based on your logged cycle 🩷`, "If you're getting cramps or spotting, that's likely your body gearing up."];
        if (daysLeft <= 3) return [`Your period is expected very soon around ${nextStr}, in about ${daysLeft} day${daysLeft === 1 ? "" : "s"} 🩷`, "If you're already feeling crampy or moody, that's normal this close.", ttcNote].filter(Boolean);
        if (daysLeft <= 7) return [`Your next period is expected around ${nextStr}, about ${daysLeft} days from now 🩷`, "You're in the late luteal phase, which is when PMS symptoms tend to show up.", ttcNote].filter(Boolean);
        return [`Your next period is expected around ${nextStr}, about ${daysLeft} days away 🩷`, `Based on your last period date and your average ${cd.cycleLength}-day cycle.`, ttcNote].filter(Boolean);
      },
      choices() {
        const base = [
          { id: "late", label: "It's already late", next: "LATE_INTRO", primary: true },
          { id: "mood", label: "I'm getting PMS already", next: "MOOD_INTRO" },
          { id: "edd",  label: "What's my due date?", next: "CYCLE_EDD_ANSWER" },
          { id: "menu", label: pickMainLabel(), next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          base.unshift({ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true });
        }
        return base;
      },
    },

    CYCLE_LMP_ANSWER: {
      say() {
        if (userMode.isPregnancy && cd.lmp) {
          const weeksAlong = Math.floor(daysBetween(cd.lmp, new Date()) / 7);
          return [
            `Your last menstrual period was ${fmtDate(cd.lmp)} that's how your pregnancy dates are calculated 🩷`,
            `You're approximately ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along based on that date.`,
          ];
        }
        if (!hasLmpData()) {
          ctx.captureReturnTo = "CYCLE_LMP_ANSWER";
          return [
            "I don't have your last period date yet 🩷",
            "You can type it here (e.g. Feb 8 or 2026-02-08) and I'll work with it right now.",
          ];
        }
        const lmp = effectiveLmp();
        const daysAgo = daysBetween(lmp, new Date());
        const nextNote = daysAgo > effectiveCycleLength()
          ? `Your next period may already be due, if it hasn't come, tap below.`
          : `You're on day ${daysAgo + 1} of your current cycle.`;
        return quickSummary(
          `Your last period started ${fmtDate(lmp)} ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago.`,
          `${qualifier()}, ${effectiveCycleLength()}-day average cycle.`,
          nextNote
        );
      },
      choices() {
        const base = [
          { id: "late",  label: "My period is late", next: "LATE_INTRO", primary: true },
          { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER" },
          { id: "menu",  label: pickMainLabel(), next: "START_MENU" },
        ];
        if (!hasLmpData()) {
          base.unshift({ id: "enter", label: "Enter my last period date", next: "CAPTURE_LMP", primary: true });
        }
        return base;
      },
    },

    CYCLE_TEST_TIMING: {
      say() {
        if (userMode.isPregnancy) {
          return [
            "It looks like you've already confirmed your pregnancy on the dashboard 🩷",
            "No need to test again, you're in pregnancy tracking mode.",
            "Would you like to know your due date or how far along you are?",
          ];
        }
        const timing = hasLmpData() ? smartTestTiming() : null;
        if (!timing) {
          ctx.captureReturnTo = "CYCLE_TEST_TIMING";
          return [
            "To give you a specific test date, I need your last period start date 🩷",
            "Log it on the dashboard and I can tell you exactly when to test.",
            "General rule: test the day after your expected period, or 21 days after unprotected sex.",
          ];
        }
        if (timing.canTestNow) {
          return quickSummary(
            `Your period was expected around ${fmtDate(timing.expectedPeriod)} you can take a test now 🩷`,
            `${qualifier()}, ${effectiveCycleLength()}-day cycle.`,
            "Use first morning urine for the clearest result. Negative but period still missing? Retest in 48–72 hours."
          );
        }
        return quickSummary(
          `Best time to test is from ${fmtDate(timing.testDate)}, about ${timing.daysToTest} day${timing.daysToTest === 1 ? "" : "s"} away.`,
          `${qualifier()}: next period expected ${fmtDate(timing.expectedPeriod)}.`,
          "Testing too early can give a false negative, hormone levels need time to build up."
        );
      },
      choices: [
        { id: "late", label: "My period is late", next: "LATE_INTRO", primary: true },
        { id: "test", label: "Walk me through testing", next: "TEST_INTRO" },
        { id: "edd", label: "What's my due date?", next: "CYCLE_EDD_ANSWER" },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    // Quick 2-option confirm so we never give due-date math to someone
    // who was just curious - shown once per session.
    EDD_CONFIRM: {
      onEnter() {
        if (userMode.isPregnancy) transition("CYCLE_EDD_ANSWER");
      },
      say: [
        "Just a quick check before I calculate 🩷",
        "Do you want your estimated due date because you're pregnant, or are you just exploring how it works?",
      ],
      choices: [
        { id: "yes",     label: "I'm pregnant / positive test",   next: "CYCLE_EDD_ANSWER",
          onSelect() { applySessionMode("pregnancy_tracking"); } },
        { id: "explore", label: "Just curious / planning ahead",  next: "EDD_EXPLORE"   },
        { id: "unsure",  label: "I'm not sure yet",               next: "CYCLE_TEST_TIMING" },
      ],
    },

    // EDD in explore / planning mode - helpful, no false confirmation
    EDD_EXPLORE: {
      say() {
        const lmp = effectiveLmp();
        if (!lmp) {
          ctx.captureReturnTo = "EDD_EXPLORE";
          return [
            "No problem! To estimate a hypothetical due date I just need a period start date to work from 🩷",
            "Enter it below and I'll show you how the calculation works.",
          ];
        }
        const provisional = addDays(lmp, 280);
        return quickSummary(
          `${qualifier()}, if a pregnancy started this cycle your estimated due date would be around ${fmtDate(provisional)}.`,
          `Naegele's rule: last period date + 280 days (40 weeks).`,
          `If you've actually confirmed a pregnancy, switch to pregnancy tracking mode on your dashboard for a locked-in EDD.`
        );
      },
      choices: [
        { id: "confirm", label: "I actually do have a positive test", next: "CYCLE_EDD_ANSWER",
          onSelect() { applySessionMode("pregnancy_tracking"); } },
        { id: "test",    label: "When should I take a test?",         next: "CYCLE_TEST_TIMING" },
        { id: "menu",    label: pickMainLabel(),                        next: "START_MENU" },
      ],
    },

    CYCLE_EDD_ANSWER: {
      say() {
        // ── Confirmed pregnancy with EDD logged ───────────────────────────
        if (userMode.isPregnancy && cd.edd) {
          const daysToEdd = daysBetween(new Date(), cd.edd);
          const weeksAlong = cd.lmp ? Math.floor(daysBetween(cd.lmp, new Date()) / 7) : null;
          const weeksLeft  = Math.round(daysToEdd / 7);
          const timeNote   = daysToEdd > 0
            ? `About ${weeksLeft} week${weeksLeft === 1 ? "" : "s"} to go.`
            : "Your due date has passed, make sure your healthcare provider has current information.";
          return quickSummary(
            `Your estimated due date is ${fmtDate(cd.edd)}${weeksAlong !== null ? ` you're around ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along` : ""} 🩷`,
            `${qualifier()}, confirmed EDD from your dashboard.`,
            timeNote
          );
        }

        // ── Confirmed pregnancy but no EDD yet ────────────────────────────
        if (userMode.isPregnancy && !cd.edd) {
          const weeksAlong = cd.lmp ? Math.floor(daysBetween(cd.lmp, new Date()) / 7) : null;
          const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
          return [
            "You're in pregnancy tracking mode but a confirmed due date hasn't been logged yet 🩷",
            provisionalEdd ? `Based on your last period date, a rough estimate puts your due date around ${fmtDate(provisionalEdd)}.` : null,
            weeksAlong !== null ? `That would put you at approximately ${weeksAlong} weeks along.` : null,
            "Once your provider confirms your dates, update the dashboard for a locked-in EDD.",
          ].filter(Boolean);
        }

        // ── NOT in pregnancy mode - never assume pregnancy ─────────────────
        if (!userMode.isPregnancy) {
          const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
          if (!hasLmpData()) {
            ctx.captureReturnTo = "CYCLE_EDD_ANSWER";
            return [
              "Just checking! are you currently tracking a pregnancy, or just exploring due date info? 🩷",
              "Either way, I need your last period start date to estimate. You can type it here.",
            ];
          }
          return [
            "Just checking! are you currently tracking a pregnancy, or exploring due date info? 🩷",
            `I can see your last period was ${fmtDate(cd.lmp)}.`,
            provisionalEdd
              ? `If a pregnancy started this cycle, a rough due date estimate would be around ${fmtDate(provisionalEdd)} but this is not confirmed.`
              : null,
            "If you've had a positive test, switching to pregnancy tracking mode on the dashboard unlocks your full confirmed timeline.",
          ].filter(Boolean);
        }

        return ["I wasn't able to calculate a due date right now 🩷 Make sure your last period date is logged on the dashboard."];
      },
      choices: [
        { id: "test", label: "Help me figure out test timing", next: "CYCLE_TEST_TIMING", primary: true },
        { id: "switch", label: "Yes, I have a positive test", next: "LATE_POSITIVE" },
        { id: "explore", label: "Just exploring / planning ahead", next: "TEST_INTRO" },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    // ── TTC info node ─────────────────────────────────────────────────────
    CYCLE_TTC_INFO: {
      say() {
        if (!hasLmpData()) {
          return [
            "That's exciting 🩷 To give you useful TTC info, I need your cycle data.",
            "Log your last period on the dashboard so I can tell you your ovulation window.",
          ];
        }
        const ovulationDay = addDays(cd.lmp, Math.round(cd.cycleLength / 2) - 1);
        const fertileStart = addDays(ovulationDay, -2);
        const fertileEnd   = addDays(ovulationDay, 1);
        const daysToOvulation = daysBetween(new Date(), ovulationDay);
        return [
          `Based on your ${cd.cycleLength}-day cycle and last period of ${fmtDate(cd.lmp)}, your estimated ovulation window is ${fmtDate(fertileStart)} – ${fmtDate(fertileEnd)} 🩷`,
          daysToOvulation > 0
            ? `That's about ${daysToOvulation} day${daysToOvulation === 1 ? "" : "s"} from now.`
            : daysToOvulation === 0
            ? "Today falls within your estimated fertile window."
            : "Your estimated fertile window has passed for this cycle.",
          "The days just before and during ovulation are the most fertile.",
          "Tracking basal body temperature or ovulation strips can give you an even more precise window.",
        ];
      },
      choices: [
        { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER", primary: true },
        { id: "test", label: "When should I test?", next: "CYCLE_TEST_TIMING" },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    // ── Postpartum info node ──────────────────────────────────────────────
    CYCLE_POSTPARTUM: {
      say() {
        return [
          "The postpartum period is different for everyone 🩷",
          "If you're breastfeeding, your period may be delayed, sometimes for months.",
          "Your first postpartum period may be heavier, more painful, or irregular compared to before.",
          "Once you have your first period, log it on the dashboard so we can start tracking your cycle again.",
          "If you're having heavy bleeding, severe pain, fever, or unusual discharge in the early postpartum weeks that's worth checking with a provider urgently.",
        ];
      },
      choices: [
        { id: "heavy", label: "I'm having heavy bleeding", next: "HEAVY_INTRO", primary: true },
        { id: "menu", label: pickMainLabel(), next: "START_MENU" },
        { id: "done", label: pickCloseLabel(), next: "CLOSE" },
      ],
    },

    /* ---------------- MODE-SPECIFIC ENTRY NODES ---------------- */

    POSTPARTUM_INTRO: {
      onEnter() { applySessionMode("postpartum"); },
      say() {
        return [
          "Postpartum bodies are on their own timeline 🩷",
          "Your cycle may take weeks or even months to return, especially if you're breastfeeding.",
          hasLmpData() && cd.lmp
            ? `Your last logged period was ${fmtDate(cd.lmp)}.`
            : "It looks like you haven't logged a period yet, that's okay, it may not have returned.",
          "What's on your mind today?",
        ].filter(Boolean);
      },
      choices: [
        { id: "period", label: "My period returned and something feels off", next: "HEAVY_INTRO", primary: true },
        { id: "mood",   label: "Mood or energy changes", next: "MOOD_INTRO" },
        { id: "bleed",  label: "Postpartum bleeding concerns", next: "HEAVY_INTRO" },
        { id: "menu",   label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    TTC_INTRO: {
      onEnter() { applySessionMode("trying_to_conceive"); },
      say() {
        if (!hasLmpData()) {
          return [
            "Thanks for sharing that 🩷",
            "To give you useful TTC guidance, I need your cycle data, log your last period on the dashboard and I can tell you your ovulation window.",
            "What else can I help with?",
          ];
        }
        const ovDay = addDays(cd.lmp, Math.round(cd.cycleLength / 2) - 1);
        const fertileStart = addDays(ovDay, -2);
        const fertileEnd   = addDays(ovDay,  1);
        const daysTo = daysBetween(new Date(), ovDay);
        return [
          `Based on your ${cd.cycleLength}-day cycle, your estimated fertile window is ${fmtDate(fertileStart)} – ${fmtDate(fertileEnd)} 🩷`,
          daysTo > 0  ? `That's about ${daysTo} day${daysTo === 1 ? "" : "s"} away.`
          : daysTo === 0 ? "You're currently in your fertile window."
          : "Your fertile window has passed for this cycle.",
          "The days just before and during ovulation tend to be most fertile.",
          "What else would you like help with?",
        ];
      },
      choices: [
        { id: "test",  label: "When should I test?", next: "CYCLE_TEST_TIMING", primary: true },
        { id: "phase", label: "What phase am I in?", next: "CYCLE_PHASE_ANSWER" },
        { id: "late",  label: "My period is late", next: "LATE_INTRO" },
        { id: "menu",  label: pickMainLabel(), next: "START_MENU" },
      ],
    },

    // Session mode confirmation fires when user action conflicts with logged mode
    MODE_CONFIRM: {
      onEnter() { /* no-op; mode applied when user picks a choice */ },
      say: [
        "Just checking, I want to make sure I give you the right info 🩷",
        "Which best describes where you are right now?",
      ],
      choices: [
        { id: "cycle",     label: "Tracking my cycle", next: "START_MENU", primary: true,
          onSelect() { applySessionMode("cycle_tracking"); } },
        { id: "ttc",       label: "Trying to conceive", next: "TTC_INTRO",
          onSelect() { applySessionMode("trying_to_conceive"); } },
        { id: "pregnant",  label: "I have a confirmed pregnancy", next: "LATE_POSITIVE",
          onSelect() { applySessionMode("pregnancy_tracking"); } },
        { id: "postpartum",label: "Postpartum / after birth", next: "POSTPARTUM_INTRO",
          onSelect() { applySessionMode("postpartum"); } },
        { id: "browsing",  label: "Just exploring", next: "START_MENU",
          onSelect() { applySessionMode("just_browsing"); } },
      ],
    },

    // Triggered when user asks about EDD/pregnancy-specific things but
    // their mode isn't confirmed as pregnancy_tracking.
    SESSION_MODE_CONFIRM: {
      say() {
        if (hasLmpData()) {
          return [
            `Just checking, are you currently tracking a pregnancy, or exploring due date info? 🩷`,
            `I can see your last period was ${fmtDate(cd.lmp)}, so I want to make sure I give you the right guidance.`,
          ];
        }
        return [
          "Just checking, are you currently tracking a pregnancy, or just exploring due date info? 🩷",
          "I want to make sure I give you the right guidance.",
        ];
      },
      choices: [
        { id: "yes_preg",  label: "Yes, I'm pregnant",           next: "SESSION_MODE_SET_PREGNANCY",  primary: true },
        { id: "not_yet",   label: "Not confirmed yet / testing",  next: "CYCLE_TEST_TIMING" },
        { id: "exploring", label: "Just exploring / planning",    next: "SESSION_MODE_SET_BROWSING" },
        { id: "ttc",       label: "Trying to conceive",           next: "SESSION_MODE_SET_TTC" },
      ],
    },

    SESSION_MODE_SET_PREGNANCY: {
      onEnter() { ctx.sessionMode = "pregnancy_tracking"; },
      say() {
        const provisionalEdd = cd.lmp ? addDays(cd.lmp, 280) : null;
        const weeksAlong     = cd.lmp ? Math.floor(daysBetween(cd.lmp, new Date()) / 7) : null;
        return [
          "Got it! I'll treat this conversation as pregnancy tracking mode 🩷",
          provisionalEdd && weeksAlong !== null
            ? `Based on your last period of ${fmtDate(cd.lmp)}, you're approximately ${weeksAlong} week${weeksAlong === 1 ? "" : "s"} along and your estimated due date is around ${fmtDate(provisionalEdd)}.`
            : "Once your last period date is logged on the dashboard I can calculate your due date and weeks along.",
          "Make sure you switch to pregnancy tracking mode on the dashboard too, so your full timeline unlocks.",
        ].filter(Boolean);
      },
      choices: [
        { id: "edd",   label: "Tell me my due date",        next: "CYCLE_EDD_ANSWER",    primary: true },
        { id: "weeks", label: "How far along am I?",        next: "CYCLE_LMP_ANSWER" },
        { id: "menu",  label: pickMainLabel(),               next: "START_MENU" },
      ],
    },

    SESSION_MODE_SET_TTC: {
      onEnter() { ctx.sessionMode = "trying_to_conceive"; },
      say() {
        return [
          "Noted! I'll keep TTC context in mind for this conversation 🩷",
          "I'll highlight your fertile window and ovulation timing when relevant.",
        ];
      },
      choices: [
        { id: "ttc",   label: "When is my ovulation window?",  next: "CYCLE_TTC_INFO",    primary: true },
        { id: "phase", label: "What phase am I in?",           next: "CYCLE_PHASE_ANSWER" },
        { id: "menu",  label: pickMainLabel(),                  next: "START_MENU" },
      ],
    },

    SESSION_MODE_SET_BROWSING: {
      onEnter() { ctx.sessionMode = "just_browsing"; },
      say() {
        return [
          "No problem! Just exploring is totally valid 🩷",
          "I can walk you through how due dates are calculated or what cycle tracking looks like.",
        ];
      },
      choices: [
        { id: "edd",   label: "How is a due date calculated?",  next: "CYCLE_EDD_ANSWER",   primary: true },
        { id: "test",  label: "When would I test?",             next: "CYCLE_TEST_TIMING" },
        { id: "menu",  label: pickMainLabel(),                   next: "START_MENU" },
      ],
    },
  };
}
