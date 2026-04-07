import { pick, scoreSignals, resolveSignals, detectOutOfScope } from "./bloomie-routing.js";
import { extractUrgency, SYMPTOM_TO_CATALOG_KEYS, CATALOG_LABELS } from "./bloomie-inference.js";
import { getPhaseInsight, CONCERN_PRIORITY } from "./bloomie-templates.js";

export function createOOS(env) {
  const { ctx, consent, getCurrentPhase, phaseNudge, insightFor, pickPriorityConcern, bloomieMemory } = env;

  const OOS_DEFAULT = [
    () => {
      // Returning users with 5+ prior OOS interactions get a shorter, more
      // direct redirect instead of the full explanatory reply.
      const oosCount = (bloomieMemory?.oosCount ?? 0) + (ctx.oosStreakCount ?? 0);
      if (oosCount >= 5) {
        return pick([
          "I can only help with period and cycle health 🩷 Try: \"late period\", \"spotting\", \"cramps\", or \"mood changes\".",
          "I'm focused on reproductive health — what's going on with your cycle? 🩷",
        ]);
      }
      return pick([
        "I'm not sure I caught that 🩷 I focus on period and cycle concerns — tap a button below or tell me what's going on.",
        "Hmm, I'm not sure how to help with that one 🩷 I'm best with period, cycle, spotting, cramps, or mood changes.",
        "That one's a bit outside my lane 🩷 What's going on with your cycle?",
      ]);
    },
  ];

  // looksLikeGibberish → imported from bloomie-routing.js

  const OOS = [
    // ── About Bloom / Bloomie identity ───────────────────────────────────
    // Catches questions about what the platform is and what the chatbot does.
    // Must sit before app_help so "how do i use this" → ABOUT_BLOOM (identity)
    // rather than APP_HELP (logging tutorial).
    {
      name: "about_bloom",
      patterns: [
        // "what is bloom" / "what is bloomie" / "what's bloomie"
        /\b(what (is|are|'?s) bloom(?:ie)?|what does bloom(?:ie)? (do|mean|help with))\b/,
        // "what can you help with" / "what can you do" / "what do you know about"
        /\b(what can (you|bloomie?) (help (me |with)?|do|tell me|talk about|discuss))\b/,
        /\b(what (are|do) you (good for|help with|know about|cover|handle))\b/,
        // "how do i use this / the chat" (identity questions, not logging how-tos)
        /\b(how (do i|to|can i) use (this|this chat|the chat|this app|bloomie?))\b/,
        /\b(how does (this|this chat|bloomie?|it) work)\b/,
        // "who are you" / "tell me about yourself / bloom / bloomie"
        /\b(who are you|tell me about (yourself|bloomie?|bloom|this chat))\b/,
        // "what is this" / "what am i using" / "who am i talking to"
        /\b(what is this (app|chat|tool|bot|assistant)?|what am i (using|talking to)|who am i talking to)\b/,
      ],
      replies: [],
      forceNext: "ABOUT_BLOOM",
    },

    // ── App help / how to log ─────────────────────────────────────────────
    {
      name: "app_help",
      patterns: [
        /(how do i log|how (to|do i) (add|enter|record|track|update)|where do i (log|add|find|enter)|how does (this|bloom) work)/,
        /(log (my )?period|add (my )?period|track (my )?period|record (my )?period|enter (my )?period)/,
        /(what (is|are) (the )?button|what does.*button do|how (to|do i) use|tutorial|walkthrough|get started|set up)/,
      ],
      replies: [],
      forceNext: "APP_HELP",
    },

    // ── Should I see a doctor? ────────────────────────────────────────────
    {
      name: "see_doctor_q",
      patterns: [
        /(should i (see|go to|visit|call) (a |my )?(doctor|physician|provider|gynecologist|gyno|ob|obgyn|specialist|nurse|clinic))/,
        /(do i need (a |to see )?(doctor|help|care|treatment|specialist))/,
        /(is this serious|is this normal|when (should|do) i (go|seek|get) (help|care|checked|medical))/,
        /(worried about|should i be worried|how bad is this|how serious is)/,
      ],
      replies: [],
      forceNext: "SEE_DOCTOR_GUIDE",
    },

    // ── Educational: what is a period ─────────────────────────────────────
    // Specific before broad — wins over symptom_education for identity questions.
    {
      name: "educ_what_period",
      patterns: [
        /\b(what is (a )?period|what are periods|what is menstruation|what happens during (a )?period)\b/,
        /\b(why do (i|we|people|women|girls) (get|have) (a )?period|why does (a )?period happen|what causes (a )?period)\b/,
        /\b(explain (what |a )?(a )?period|tell me (about |what is )(a )?period)\b/,
      ],
      replies: [],
      forceNext: "EDUC_PERIOD",
    },

    // ── Educational: what is ovulation ────────────────────────────────────
    {
      name: "educ_what_ovulation",
      patterns: [
        /\b(what is ovulation|how does ovulation work|what happens during ovulation)\b/,
        /\b(what is (the )?ovulation (phase|window|period|process))\b/,
        /\b(explain ovulation|tell me about ovulation)\b/,
        /\b(when does (the )?egg (drop|release|get released)|what is (an? )?egg release)\b/,
      ],
      replies: [],
      forceNext: "EDUC_OVULATION",
    },

    // ── Educational: what is the menstrual cycle ──────────────────────────
    {
      name: "educ_what_cycle",
      patterns: [
        /\b(what is (the )?menstrual cycle|how (long|does) (a|the) (menstrual )?cycle (last|work))\b/,
        /\b(explain (the )?menstrual cycle|tell me about (the )?menstrual cycle|how does (a|the) cycle work)\b/,
        /\b(what are (the )?cycle phases|what is (the )?luteal phase|what is (the )?follicular phase|what are (the )?phases of (my |the )?cycle)\b/,
        /\b(what is (a |the )?normal cycle|explain (the )?cycle phases|how does (the )?cycle (go|work|progress))\b/,
      ],
      replies: [],
      forceNext: "EDUC_CYCLE_BASICS",
    },

    // ── Educational: broad / deep-dive requests → summary + learn link ────
    // Catches "tell me everything about", "explain fully", "deep dive" etc.
    // Gives a short summary then directs to pamphlets for depth.
    {
      name: "educ_broad",
      patterns: [
        /\b(tell me everything about|explain (everything about|fully|in detail|in depth|thoroughly)|give me (a )?full (explanation|overview|breakdown) of)\b/,
        /\b(everything (about|on) (hormones?|fertility|reproduction|the (menstrual )?cycle|periods?|ovulation|reproductive health))\b/,
        /\b(deep.?dive (into|on|about)|in.?depth (on|about|into)|comprehensive (guide|overview|explanation) (of|about|on))\b/,
        /\b(all about (hormones?|fertility|periods?|ovulation|the cycle|my cycle|pcos|endometriosis|reproductive health))\b/,
      ],
      replies: [],
      forceNext: "EDUC_BROAD",
    },

    // ── Symptom education ─────────────────────────────────────────────────
    {
      name: "symptom_education",
      patterns: [
        /(what (is|are|does|can cause)|what (does|do).{0,30}mean|tell me about|explain|what causes|why (do|am|does)|what is (pcos|endometriosis|fibroids?|pms|pmdd|ovulation|luteal|follicular))/,
        /(is it normal (to|for)|normal to have|supposed to (feel|have|be)|why (is my|am i)|why does my)/,
      ],
      replies: [],
      forceNext: "SYMPTOM_EDUCATION",
    },

    // ── Mode confirmation phrases ─────────────────────────────────────────
    // User explicitly tells Bloomie their context — highest priority
    {
      name: "mode_confirmation_pregnant",
      patterns: [
        /(i am pregnant|i'm pregnant|just found out i'm pregnant|just found out im pregnant|i got a positive test|positive test result|confirmed pregnant|yes i'm pregnant|yes im pregnant|i tested positive)/,
      ],
      replies: ["Congratulations on your pregnancy 🩷 Let me switch to the right support for you."],
      forceNext: "LATE_POSITIVE",
    },
    {
      name: "mode_confirmation_ttc",
      patterns: [
        /(trying to conceive|trying to get pregnant|ttc|trying for a baby|trying for baby|want to get pregnant|want to be pregnant|we're trying)/,
      ],
      replies: ["Got it — TTC mode 🩷 Let me pull up your ovulation info."],
      forceNext: "TTC_INTRO",
    },
    {
      name: "mode_confirmation_postpartum",
      patterns: [
        /(just had a baby|i had a baby|postpartum|after (?:giving )?birth|gave birth|just gave birth|recently had a baby|recovering from (?:giving )?birth|after delivery)/,
      ],
      replies: ["Thanks for sharing that 🩷 Postpartum bodies are on their own timeline — let me help."],
      forceNext: "POSTPARTUM_INTRO",
    },
    // ── Cycle prediction questions ────────────────────────────────────────
    // These feel OOS but are actually smart handoffs to cycle-aware nodes
    {
      name: "cycle_phase_q",
      patterns: [
        /\b(what phase|which phase|what cycle phase|am i ovulating|am i in luteal|am i in follicular)\b/,
        /\b(where am i in my cycle|what stage am i|what day of my cycle)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_PHASE_ANSWER",
    },
    {
      name: "next_period_q",
      patterns: [
        /\b(when is my (next )?period|when will my period (come|start|be)|when do i get my period)\b/,
        /\b(when should i expect my period|period due|period coming)\b/,
        /\b(how long (until|till) my period|how many days (until|till) my period)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_NEXT_PERIOD",
    },
    {
      name: "last_period_q",
      patterns: [
        /\b(when was my last period|when did my period (start|begin|come)|last period date)\b/,
        /\b(when did i last (have|get) my period|my lmp|last menstrual)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_LMP_ANSWER",
    },
    {
      name: "edd_q",
      patterns: [
        /\b(when is my due date|what is my due date|due date|edd|estimated delivery|when will i give birth|when am i due)\b/,
        /\b(how many weeks (am i|pregnant)|how far along am i|how far along)\b/,
      ],
      replies: [],
      // Route through SESSION_MODE_CONFIRM unless mode is already confirmed
      forceNext: "CYCLE_EDD_GATE",
    },
    {
      name: "test_timing_q",
      patterns: [
        /\b(when (should|can) i (take|do) a (pregnancy )?test|when (should|can) i test)\b/,
        /\b(is it (too early|the right time) to test|best time to test|when to test)\b/,
        /\b(can i test (yet|now)|should i test (yet|now))\b/,
      ],
      replies: [],
      forceNext: "CYCLE_TEST_TIMING",
    },

    // ── Greetings ─────────────────────────────────────────────────────────
    {
      name: "greeting",
      patterns: [
        /^(hi|hello|hey|yo|sup|hiya|morning|afternoon|evening)$/,
        /^\b(hi|hello|hey|yo|sup|hiya)\b\s*$/,
        /\b(wah gwaan|wagwaan|wha gwan|howdy)\b/,
        /^h+i+[!.\s]*$/i,      // hii, hiii, hiiii…
        /^h+e+y+[!.\s]*$/i,    // heyy, heyyy…
        /^h+e+l+o+[!.\s]*$/i,  // helloo, helloooo…
        /^y+o+[!.\s]*$/i,      // yoo, yooo…
      ],
      replies: [
        () => ctx.greeted
          ? pick([
              "Still here 🩷 What's going on?",
              "I'm here — what would you like help with?",
              "Hey again 🩷 Pick something below or just tell me what's up.",
              "Still with you 🩷 What can I do for you?",
              "I didn't go anywhere 😄 What's on your mind?",
              "Always here 🩷 Tap a button or just tell me what you're dealing with.",
            ])
          : pick([
              "Heyy 🩷 What can I help with today? You can tap a button below or just type what's going on.",
              "Hi there 🩷 I'm here for period and cycle concerns — tap an option or just tell me what's up.",
              "Hey! 🩷 What's going on? You can type it out or pick from the options below.",
              "Welcome 🩷 I'm Bloomie — here to help with anything cycle or reproductive health. What's on your mind?",
              "Hey, glad you're here 🩷 Tell me what's going on or pick a topic below and we'll sort it out together.",
              "Wah gwaan 🩷 I'm here for cycle, period, and reproductive health questions — what can I help you with today?",
            ]),
      ],
    },

    // ── Self-harm (always first in priority) ───────────────────────────────
    // ── Emergency / urgent symptoms ───────────────────────────────────────
    // High priority — must catch before other health buckets
    {
      name: "emergency_symptoms",
      patterns: [
        /\b(can't breathe|cant breathe|shortness of breath|chest (pain|tight)|heart racing)\b/,
        /\b(passed out|passing out|fainted|fainting|collapse|collapsing)\b/,
        /\b(soaking (through|thru)|bleeding through|bleed through|soaked (my )?pad|soaked (my )?tampon)\b/,
        /\b(severe.*pain|extreme.*pain|unbearable.*pain|worst pain|pain.*spreading|one.?sided.*pain|sharp.*one side)\b/,
        /\b(blood.*everywhere|so much blood|too much blood|hemorrhag)\b/,
        /\b(call.*ambulance|need.*emergency|going to (hospital|er|emergency)|send.*help)\b/,
      ],
      replies: [
        () => "What you're describing sounds like it could be urgent 🩷 Please don't wait — go to your nearest emergency room or call emergency services (119 in Jamaica) right now.",
        () => "I'm not able to assess emergencies, and I don't want you to delay getting real care.",
      ],
      forceNext: "EMERGENCY_REDIRECT",
    },

    // ── Diagnosis requests ──────────────────────────────────────────────────
    {
      name: "diagnosis_request",
      patterns: [
        // Direct diagnostic questions: "do i have pcos", "could this be endo"
        /\b(do i have|is this|could this be|might i have|am i developing|could i have)\b.{0,35}\b(pcos|endometriosis|fibroids?|adenomyosis|thyroid|anemia|cancer|cyst|ovarian|disorder|syndrome|condition)\b/,
        // "I think I have / I think I might have"
        /\b(i think i (have|might have|could have)|i feel like i (have|might have))\b.{0,40}\b(pcos|endometriosis|fibroids?|adenomyosis|thyroid|cyst|ovarian|disorder|syndrome|condition)\b/,
        // "I'm scared I have / what if I have / do you think I have"
        /\b(i('m| am) scared (i|i might) have|what if i have|do you think i have|you think i have|could i possibly have)\b.{0,40}\b(pcos|endometriosis|fibroids?|adenomyosis|thyroid|cyst|ovarian|disorder|syndrome|condition)\b/,
        // "I heard/read about X and think I have it / relate to it"
        /\b(i (heard|read|learned|saw).{0,40}\b(pcos|endometriosis|fibroids?|adenomyosis|cyst).{0,50}\b(think i have|think i might|relate|sounds like me|could be me|similar|same))\b/,
        // "[condition] sounds like me / sounds like what I have"
        /\b(pcos|endometriosis|fibroids?|adenomyosis|cyst)\b.{0,50}\b(think i have|might have|sounds like me|sounds like (my situation|what i have)|relate to|could be me)\b/,
        // Generic: diagnose me / what's wrong with me
        /\b(diagnose me|what is wrong with me|what condition|tell me what i have|is this normal or serious|what disease)\b/,
        // Condition name + diagnosis-intent word
        /\b(pcos|endometriosis|adenomyosis|fibroids?)\b.{0,30}\b(do i|have i|test for|signs of|symptom)\b/,
      ],
      replies: [
        () => "I completely understand wanting clarity about what's happening in your body 🩷",
        () => "I'm not able to diagnose conditions — that takes a proper clinical exam and tests. But I can help you understand your symptoms and what questions to bring to a provider.",
      ],
      forceNext: "DIAGNOSIS_REDIRECT",
    },

    // ── Medication / dosage questions ───────────────────────────────────────
    {
      name: "medication_dosage",
      patterns: [
        // ── Brand names — Jamaican market + common (standalone is enough) ────
        /\b(panadol|panadeine|ibuprofen|advil|brufen|nurofen|tylenol|buscopan|ponstan|naproxen|aleve|aspirin|disprin|codeine|co-codamol|diclofenac|voltaren|tramadol|tranexamic|norethisterone|provera|metformin|clomid|clomiphene|primolut|duphaston|mefenamic)\b/i,
        // ── Generic pain relief phrases ──────────────────────────────────────
        /\b(pain relief|painkiller|pain killer|pain medication|pain medicine|pain tablet|pain pill|cramp relief|period pain relief|cramp medicine|menstrual relief)\b/i,
        // ── "Something / anything for the pain / cramps" ────────────────────
        /\b(something for (the )?(pain|cramps?|belly|stomach|period)|anything for (the )?(pain|cramps?|period))\b/i,
        /\b(help with (the )?(pain|cramps?)|stop the pain|ease the pain|reduce the pain|manage the pain)\b/i,
        // ── What helps / what to do for pain (post-Patois normalization) ────
        /\b(what (can|is good|works) (for|with) (the )?(pain|cramps?|period)|what to do for (the )?(pain|cramps?))\b/i,
        /\b(how to (stop|ease|manage|reduce) (the )?(pain|cramps?)|what can help)\b/i,
        // ── "Killing me" pain-relief intent ─────────────────────────────────
        /\bkilling me\b.{0,50}\b(help|take|get|something|anything|relief)\b/i,
        /\b(cramps? are killing me|cramps? killing me|stomach is killing me|is killing me)\b/i,
        // ── Dosage / safety questions ────────────────────────────────────────
        /\b(safe to take|okay to take|alright to take|is it safe|can i take|should i take|when to take|take with food|take on empty stomach)\b/i,
        /\b(how (much|many|often) (can i|should i|to)? ?(take|panadol|ibuprofen|aspirin|buscopan|ponstan|naproxen|tablets?|pills?))\b/i,
        /\b(overdose|too many tablets|too many pills|take two|take three|how often|every how long|can i take more)\b/i,
        // ── Existing patterns kept + expanded ────────────────────────────────
        /\b(how much|what dose|dosage|mg|milligram|how many (pills?|tablets?))(.*)(ibuprofen|paracetamol|panadol|naproxen|aspirin|metformin|provera|norethisterone|tranexamic|mefenamic|bc pill|contraceptive pill)\b/i,
        /\b(ibuprofen|paracetamol|panadol|naproxen|tranexamic|mefenamic|norethisterone|progesterone|estrogen|metformin|provera)\b.{0,40}\b(dose|dosage|how much|how many|take|mg|tablet|pill)\b/i,
        /\b(medication|medicine|prescription|prescribed|drug|tablet|capsule|overdose)\b.{0,40}\b(period|cramps?|bleeding|cycle|pain|pms)\b/i,
        // ── Post-normalization Patois patterns ───────────────────────────────
        /\b(i want (a|some|to (take|get|buy))|i need (a|some|to get)|want to (take|get|buy)|need to get|i am taking)\b.{0,40}\b(panadol|ibuprofen|painkiller|pain relief|advil|buscopan|ponstan|aspirin|tramadol|naproxen|voltaren)\b/i,
        /\b(take|taking)\b.{0,25}\b(panadol|ibuprofen|painkiller|advil|buscopan|ponstan|aspirin|tramadol|naproxen|voltaren|norethisterone|provera|metformin|clomid|duphaston)\b/i,
        /\b(want to take|want a|want some|i want|i need)\b.{0,30}\b(panadol|ibuprofen|painkiller|buscopan|ponstan|advil|aspirin|naproxen)\b/i,
        // ── Residual Patois (pre-normalization chat path) ────────────────────
        /\b(tek (panadol|ibuprofen|painkiller|paracetamol|naproxen|buscopan|ponstan|aspirin|tramadol|voltaren)|pain.?killer fi cramps?|wah (me|mi) can tek|can mi tek|safe fi tek|wah tek|mi wah tek|me wah tek)\b/i,
        /\b(wah (a|some) (panadol|ibuprofen|painkiller|buscopan|ponstan)|anyting fi (cramp|pain|period)|something fi di (pain|belly|cramp))\b/i,
      ],
      replies: [
        (t) => {
          // ── Medication-specific warm openers ───────────────────────────────
          if (/panadol/i.test(t)) return pick([
            "Panadol is one of the most common things people reach for for period pain 🩷",
            "A lot of people reach for Panadol when cramps hit — you're not alone in that 🩷",
            "Panadol fi di pain is real and valid — cramps bad enough to need relief deserve to be taken seriously 🩷",
            "Yeah, Panadol is probably the most reached-for thing for period pain in Jamaica 🩷",
          ]);
          if (/ibuprofen/i.test(t)) return pick([
            "Ibuprofen is actually one of the better options for period pain since it targets inflammation too 🩷",
            "Ibuprofen can really help with cramps — it works differently from Panadol and often more effectively 🩷",
            "Cramps bad enough to want ibuprofen are real and valid 🩷",
            "Ibuprofen fi period pain — that's a solid instinct 🩷",
          ]);
          if (/buscopan/i.test(t)) return pick([
            "Buscopan is often used for spasm-type cramps — makes sense that you're asking about it 🩷",
            "Buscopan fi di cramp pain — that's something a lot of people find helpful 🩷",
            "Cramps bad enough to want Buscopan are real and deserve proper care 🩷",
          ]);
          if (/ponstan|mefenamic/i.test(t)) return pick([
            "Ponstan (mefenamic acid) is one of the strongest options for period pain — your instinct is solid 🩷",
            "Mefenamic acid is specifically designed for period pain, so you're on the right track 🩷",
            "Ponstan fi period pain — that's actually one of the more targeted options out there 🩷",
          ]);
          if (/naproxen|aleve/i.test(t)) return pick([
            "Naproxen is one of the options that works well for period pain 🩷",
            "Naproxen / Aleve is a solid choice for cramps — you're thinking about it right 🩷",
          ]);
          if (/aspirin|disprin/i.test(t)) return pick([
            "Aspirin / Disprin is something a lot of people reach for — good that you're thinking about it carefully 🩷",
          ]);
          if (/tramadol|codeine|co-codamol/i.test(t)) return pick([
            "Tramadol and codeine are stronger pain medications that really do need a provider's involvement 🩷",
          ]);
          // ── Pain-focused openers (no specific brand detected) ──────────────
          if (/killing me|kill mi|murder mi|cannot manage|too bad|bad bad/i.test(t)) return pick([
            "Cramps bad enough to feel like they're killing you are real and valid — you deserve actual relief 🩷",
            "Pain that bad shouldn't just be pushed through 🩷",
            "When the pain gets that intense, it absolutely makes sense to want something for it 🩷",
            "Mi know that feeling — when di cramp a kill you, you need real help, not just toughing it out 🩷",
          ]);
          // ── Generic openers ───────────────────────────────────────────────
          return pick([
            "That's a really common thing to wonder about 🩷 Pain relief for period cramps is something a lot of people navigate.",
            "Cramps bad enough to need pain relief are real and valid 🩷",
            "Wanting something for the pain is completely understandable 🩷",
            "Period pain that needs medication is legitimate — you shouldn't have to just push through 🩷",
            "Mi hear you — when di pain bad, you need something fi help 🩷",
          ]);
        },
        () => "I can't tell you how much to take or whether a specific medication is right for your situation — that really needs a pharmacist or provider who knows your full health picture.",
        () => "A pharmacist is actually the fastest option here — you can walk in, describe your symptoms, and they can advise on the spot. No appointment needed.",
      ],
      forceNext: "MEDICATION_REDIRECT",
    },

    // ── Sexual violence / coercion ──────────────────────────────────────────
    {
      name: "sexual_violence",
      patterns: [
        /\b(raped|rape|sexual assault|sexually assaulted|he forced|she forced|they forced|forced me|coerced|non.?consensual|without consent|against my will)\b/,
        /\b(someone (touched|hurt) me|touched without|hurt me and|abuse|abused|sexual abuse|molested|molestation)\b/,
      ],
      replies: [
        () => "I'm so sorry. What you're sharing matters and you deserve care and support 🩷",
        () => "What happened to you is not your fault.",
      ],
      forceNext: "SAFETY_SUPPORT",
    },

    // ── Mental health crisis ──────────────────────────────────────────────
    // Upgraded from the original self_harm — broader and more compassionate
    {
      name: "mental_health_crisis",
      patterns: [
        /\b(suicide|suicidal|kill myself|end my life|want to die|don't want to be here|dont want to be here|rather be dead|no point living|no reason to live)\b/,
        /\b(self.?harm|cutting myself|hurt myself|burning myself|hurting myself)\b/,
        /\b(i can't do this anymore|cant do this anymore|i give up|can't go on|cant go on|everything is too much|i'm done with everything|im done with everything)\b/,
      ],
      replies: [
        () => "I hear you, and what you're feeling right now matters so much 🩷 You deserve real, caring support.",
        () => "Please reach out — in Jamaica, you can call the Crisis Hotline at 888-NEW-LIFE (888-639-5433) or go to your nearest hospital.",
        () => "You don't have to carry this alone.",
      ],
      forceNext: "CRISIS_SUPPORT",
    },

    // ── Legal / privacy concerns ──────────────────────────────────────────
    {
      name: "legal_privacy",
      patterns: [
        /\b(privacy|my data|data stored|data storage|who can see|who sees|delete (my )?(account|data)|data protection|gdpr|information (stored|collected))\b/,
        /\b(is this (confidential|private|secure|safe)|safe to share|legal|lawful|consent|terms of service|terms and conditions)\b/,
        /\b(can (bloom|bloomie|you) see|share (my )?data|sell (my )?data|third party|who has access)\b/,
      ],
      replies: [
        () => "That's a really important question and you deserve a clear answer 🩷",
        () => "Bloom takes your privacy seriously — your health data is yours.",
      ],
      forceNext: "PRIVACY_INFO",
    },

    // ── Self harm (kept for backwards compat, now points to CRISIS_SUPPORT)
    {
      name: "self_harm",
      patterns: [/\b(suicide|kill myself|end my life|self harm|self-harm|cut myself|want to die|don't want to be here)\b/],
      replies: [
        () => "I hear you 🩷 Please reach out for support — in Jamaica call 888-639-5433 or go to your nearest hospital.",
      ],
      forceNext: "CRISIS_SUPPORT",
    },

    // ── Sexual content ─────────────────────────────────────────────────────
    {
      name: "sexual_content",
      patterns: [/\b(nudes|send pic|porn|sex video|send me|show me)\b/],
      replies: [
        () => "That's not something I can help with here. If you have a reproductive health question — periods, cramps, spotting, or cycle concerns — I'm happy to help with those 🩷",
      ],
    },

    // ── Rude/insults ───────────────────────────────────────────────────────
    {
      name: "insults",
      patterns: [/\b(stupid|idiot|dumb|trash|shut up|f\*+k|fuck|bitch|useless|waste)\b/],
      replies: [
        () => pick([
          "I'm here to help, not argue 🩷 Tell me what's going on with your cycle and I'll do my best.",
          "Still here for you 🩷 If something's bothering you health-wise, let me know.",
          "I don't take it personally 🩷 If something's stressing you out — especially anything cycle-related — I'm all ears.",
          "Not gonna argue 😌 but if your body's giving you grief, I can actually help with that.",
          "It's okay — I know this stuff can be frustrating 🩷 What's actually going on?",
          "No hard feelings 🩷 If you want to tell me what's really going on with your health, I'm listening.",
        ]),
      ],
    },

    // ── Abortion ───────────────────────────────────────────────────────────
    {
      name: "abortion",
      patterns: [/\b(abortion|terminate|termination|end the pregnancy|misoprostol|mifepristone|abortion pill)\b/],
      replies: [
        () => "I can't provide instructions for ending a pregnancy, but I can help you understand options, safety warning signs, and where to find confidential support 🩷",
      ],
      forceNext: "ABORTION_OPTIONS",
    },

    // ── Pregnancy questions ────────────────────────────────────────────────
    {
      name: "pregnancy_confusion",
      patterns: [/\b(pregnant|pregnancy|positive test|negative test|missed period and)\b/],
      replies: [
        () => "I can help with pregnancy-related guidance 🩷",
        () => "Tap **Late or missed period** to walk through the steps together.",
      ],
      forceNext: "TEST_INTRO",
    },

    // ── Mental health ──────────────────────────────────────────────────────
    {
      name: "mental_health_general",
      patterns: [/\b(depressed|depression|panic attack|panic|overthinking|stressed out|burnout|burnt out|breaking down|can't cope|cant cope)\b/],
      replies: [
        () => "What you're feeling sounds really heavy 🩷 I'm not a mental health tool, but I don't want to brush you off either.",
        (t) => {
          const base = "If your mood or energy has been off and you think it might be cycle-related, I can help with that. Do the feelings tend to show up around your period?";
          const phaseInfo = getCurrentPhase();
          const insight = insightFor(phaseInfo?.phase, "mood", t);
          if (insight) return `${base} ${insight}`;
          const nudge = phaseNudge();
          return nudge ? `${base} ${nudge}` : base;
        },
      ],
    },

    // ── Relationships ──────────────────────────────────────────────────────
    {
      name: "relationships",
      patterns: [/\b(bf|girlfriend|boyfriend|my man|my girl|cheat|cheating|break up|breakup|situationship|talking stage|he left|she left)\b/],
      replies: [
        () => pick([
          "Relationship stress is real — and honestly it can throw off your whole cycle 🩷 If you've noticed anything shifting (late period, mood changes, spotting), I can help with that.",
          "I'm a cycle assistant, not a relationship coach 😅 but if the stress is messing with your period, tell me what you've noticed and I'll help.",
          "Sounds like a rough time 🩷 I can't weigh in on the relationship drama, but if the stress has your cycle acting up, that's something I can actually help with.",
          "Emotional stress — whether it's a breakup, a situationship, or just life — can genuinely delay or shift your period 🩷 Noticed anything different lately?",
          "Not really a love advice gyal 😄 but cycle disruption from relationship stress is real — if your period's been off, I'm here.",
          "That sounds hard 🩷 If anything's shifted with your cycle since things got stressful, tell me what you've noticed.",
        ]),
      ],
    },

    // ── Money / finances ──────────────────────────────────────────────────
    {
      name: "money",
      patterns: [
        /\b(cash|money|broke|loan|rent|salary|payday|credit|debt|rich|bills)\b/,
        /\b(make money|earn money|get paid|send money|cash app|paypal|venmo)\b/,
      ],
      replies: [
        () => pick([
          "Financial stress is no joke — and it can genuinely affect your cycle 🩷 If you've noticed changes (late period, mood shifts), I can help with those.",
          "I can't help with finances, but if money stress has your body acting up, tell me what you've been noticing.",
          "Money stress is one of those things the body feels for real 🩷 If your cycle has been off lately, that connection is worth looking at.",
          "Can't sort out the bills unfortunately 😅 but financial stress affecting your period or mood is genuinely something I can help with.",
          "Broke season hits different 😩 and your hormones feel it too — if your period's been late or your mood has shifted, tell me what's going on.",
          "I'm no financial advisor 😄 but if stress over money has your cycle acting up, that's exactly what I'm here for.",
        ]),
      ],
    },

    // ── Food / cravings ────────────────────────────────────────────────────
    {
      name: "food",
      patterns: [
        /\b(hungry|food|eat|eating|snack|cook|recipe|dinner|lunch|breakfast|meal)\b/,
        /\b(craving|cravings)\b/,
        /\b(kfc|pizza|burger|patty|taco|fries|ice cream|chocolate)\b/,
      ],
      replies: [
        (t) => {
          // Never attach phase-aware cravings context to an urgent message
          if (extractUrgency(t)) return null;

          const phaseInfo = getCurrentPhase();
          const phase = phaseInfo?.phase;

          if (phase === "luteal") {
            return pick([
              "Those cravings are so real right now 🩷 In the luteal phase your progesterone is higher and your body is actually burning more calories — sweet and salty cravings are your hormones talking, not weakness. Magnesium-rich foods like dark chocolate, nuts, and leafy greens can genuinely help take the edge off.",
              "Luteal phase cravings hit different for a reason 🩷 Your body is working harder (burning more calories!) and progesterone has a sedating, hunger-driving effect. Magnesium from dark chocolate, nuts, and leafy greens can actually take the edge off.",
              "It makes complete sense that you're craving things right now 🩷 In your luteal phase your metabolism is running a little faster and progesterone pushes hunger up — that craving isn't weakness, it's hormones. Reaching for magnesium-rich options like dark chocolate or nuts can genuinely help.",
            ]);
          }
          if (phase === "menstrual") {
            return pick([
              "Your body is working hard right now and iron and energy needs go up during your period — cravings for comfort food make complete sense. Try to get some iron-rich foods in alongside the treats 🩷",
              "During your period your body is losing iron through bleeding and needs more energy to keep going — craving comfort food is your body asking for support. Pair the treats with something iron-rich when you can 🩷",
              "Comfort food cravings during your period are completely real — your body is physically working hard and iron needs go up during bleeding. Don't guilt-trip yourself; just try to sneak in some iron-rich foods too 🩷",
            ]);
          }
          if (phase === "follicular") {
            return pick([
              "Interestingly your appetite is usually lower in the follicular phase — if you're craving more than usual it might be worth noticing whether stress or sleep is playing a role.",
              "In the follicular phase most people's appetite naturally dips as estrogen rises — if strong cravings are showing up, it's worth checking in on your sleep and stress levels, since both can drive hunger.",
              "Your appetite is typically lower during the follicular phase, so strong cravings right now are worth paying attention to — stress, poor sleep, or not eating enough earlier in the day can all be behind it.",
            ]);
          }
          if (phase === "ovulation") {
            return pick([
              "Around ovulation your energy is usually higher and appetite often dips naturally — strong cravings at this point sometimes signal your body needs something specific, like more protein or iron.",
              "Ovulation tends to bring higher energy and a naturally lower appetite for most people — if you're experiencing strong cravings, it might be your body asking for more protein or iron specifically.",
              "Your body is at peak energy around ovulation and hunger often drops — intense cravings at this stage can be a sign your body wants something specific like protein, iron, or complex carbs.",
            ]);
          }

          // Phase unknown — warm deflect + one-time nudge to log period date
          const base = pick([
            "I can't help with food orders 😄 but if you're getting strong cravings before your period, that's actually a hormonal thing I can talk through with you 🩷",
            "Cravings are real — especially the pre-period chocolate ones 🍫 If they're cycle-related, tap **Hormones / mood changes** and let's dig in.",
            "Not a food delivery service unfortunately 😄 but pre-period cravings? That's fully in my lane — hormones are wild.",
          ]);
          if (!ctx.adviceGiven.has("phase_nudge")) {
            ctx.adviceGiven.add("phase_nudge");
            return base + " If you log your period start date in the dashboard, I can actually tell you why your body might be craving what it's craving right now 🩷";
          }
          return base;
        },
      ],
    },

    // ── Weather ────────────────────────────────────────────────────────────
    {
      name: "weather",
      patterns: [/\b(weather|rain|forecast|temperature|hot|cold|storm|hurricane|sunshine)\b/],
      replies: [
        () => pick([
          "I can't check the forecast, but I can help with cycle and health concerns 🩷 What's going on?",
          "Not a weather app unfortunately 😅 but if something health-related is on your mind, I'm here.",
          "Can't predict the rain, but I can help you understand your cycle patterns 😄 What's up?",
          "Jamaica sun or Jamaica rain — either way I can't help with the forecast 😄 But if your health is on your mind, I'm here.",
          "Wish I could tell you, but weather's not my area 🩷 Anything cycle or health related, though — you're in the right place.",
          "Not Accuweather 😄 but cycle and symptom support? That I can do. What's going on?",
        ]),
      ],
    },

    // ── Travel ─────────────────────────────────────────────────────────────
    {
      name: "travel",
      patterns: [/\b(travel|flight|airport|hotel|trip|vacation|visa|overseas|abroad)\b/],
      replies: [
        () => "Travel can actually delay your period — timezone changes and disrupted routines affect hormones more than people realize 🩷",
        () => "If your period has been off since a trip or big change in routine, tap **Late or missed period** and let's look at it.",
      ],
    },

    // ── Sports / entertainment ─────────────────────────────────────────────
    {
      name: "sports",
      patterns: [/\b(score|match|game|league|team|football|soccer|basketball|cricket|volleyball|netball)\b/],
      replies: [
        () => pick([
          "I'm not a sports desk unfortunately 😄 but I'm here for cycle and health concerns. What's going on?",
          "Can't help with scores, but if something's up with your period or symptoms, I've got you 🩷",
        ]),
      ],
    },

    // ── Music / entertainment ──────────────────────────────────────────────
    {
      name: "entertainment",
      patterns: [/\b(song|music|album|artist|playlist|netflix|movie|show|watch|listen|tiktok|instagram|youtube)\b/],
      replies: [
        () => pick([
          "I'm not great at entertainment recs 😄 but I'm good at cycle concerns. What's going on health-wise?",
          "Can't help with that one, but I'm all ears for anything period or cycle related 🩷",
        ]),
      ],
    },

    // ── School / work ──────────────────────────────────────────────────────
    {
      name: "school",
      patterns: [/\b(homework|assignment|exam|class|grades|deadline|study|school|university|college|work|job|boss|office)\b/],
      replies: [
        () => pick([
          "I can't help with school or work stuff, but deadline stress is a known cycle disruptor 🩷 If your period's been off lately, let me know.",
          "Not a study buddy, but stress from school or work can genuinely affect your cycle — if you've noticed changes, I can help.",
          "Exams and assignments aren't quite my area 😄 but study stress affecting your period or mood? That I can talk about.",
          "Can't write the assignment for you 😅 but if the pressure has your cycle going haywire, tell me what you've noticed.",
          "School stress is no joke — and it's one of the most common reasons periods go late or moods go sideways 🩷 Is anything shifting for you?",
          "Not a tutor unfortunately 😄 but chronic stress from work or studies can genuinely disrupt your hormones — if that's happening, let's talk.",
        ]),
      ],
    },

    // ── Tech / app issues ──────────────────────────────────────────────────
    {
      name: "tech_general",
      patterns: [/\b(error|bug|crash|not working|broken|glitch|loading|frozen)\b/, /\b(app|button|page|screen)\b/],
      replies: [
        () => "If something in the Bloom app isn't working, that's worth reporting — you can use the feedback option in the menu 🩷",
        () => "If you were actually trying to ask a health question, just type it out and I'll do my best to help.",
      ],
    },

    // ── General non-repro health ───────────────────────────────────────────
    {
      name: "non_repro_health",
      patterns: [/\b(cough|flu|cold|headache|sore throat|stomach bug|rash|allergy|infection|virus|covid)\b/],
      replies: [
        () => "I focus on reproductive and cycle health, so general illness is a bit outside my lane 🩷",
        () => "That said — if you've been sick and your period changed, I can help connect those dots. What's been going on with your cycle?",
      ],
    },

    // ── Sleep ──────────────────────────────────────────────────────────────
    {
      name: "sleep",
      patterns: [/\b(can't sleep|cant sleep|insomnia|sleep|tired all day|exhausted all day|awake all night)\b/],
      replies: [
        () => "Sleep struggles are real — and they can genuinely affect your hormones and cycle 🩷",
        (t) => {
          const base = "If poor sleep is showing up alongside mood changes or cycle shifts, tap **Hormones / mood changes** and let's look at the full picture.";
          const phaseInfo = getCurrentPhase();
          const insight = insightFor(phaseInfo?.phase, "sleep", t);
          if (insight) return `${base} ${insight}`;
          const nudge = phaseNudge();
          return nudge ? `${base} ${nudge}` : base;
        },
      ],
    },

    // ── Weight / body image ────────────────────────────────────────────────
    {
      name: "body_image",
      patterns: [/\b(weight|fat|skinny|body|diet|calories|lose weight|gain weight|body image|bloated all the time)\b/],
      replies: [
        () => "Body changes can be connected to your cycle more than you'd think 🩷",
        (t) => {
          const base = "If you've noticed weight shifts, bloating, or body changes around your period, tap **Hormones / mood changes** or **Something else** and I'll help.";
          const phaseInfo = getCurrentPhase();
          const phase = phaseInfo?.phase;
          // bloating ranks above skin in CONCERN_PRIORITY — use pickPriorityConcern
          const concern = pickPriorityConcern(phase, ["bloating", "skin"]);
          const insight = concern ? insightFor(phase, concern, t) : null;
          if (insight) return `${base} ${insight}`;
          const nudge = phaseNudge();
          return nudge ? `${base} ${nudge}` : base;
        },
      ],
    },

    // ── Compliments / thanks ───────────────────────────────────────────────
    {
      name: "compliments",
      patterns: [/\b(thank you|thanks|ur so helpful|you're great|good job|well done|love this|love you|appreciate)\b/],
      replies: [
        () => pick([
          "That means a lot 🩷 Is there anything else I can help with today?",
          "So glad I could help 🩷 Anything else on your mind?",
          "You're so welcome 🩷 Take care of yourself!",
          "Aww, that warms my heart 🩷 You deserve good care — anything else I can help with?",
          "Glad I could be helpful today 🩷 Don't hesitate to come back if anything comes up.",
          "That genuinely means a lot 🩷 You're doing great just by paying attention to your body.",
          "Big up to you for looking out for your health 🩷 Come back anytime.",
        ]),
      ],
    },

    // ── Confusion / frustration with Bloomie ──────────────────────────────
    {
      name: "confused_with_bloomie",
      patterns: [/\b(you don't understand|you're not helping|this isn't working|useless bot|not what i asked|wrong answer|bad answer)\b/],
      replies: [
        () => pick([
          "I'm sorry I didn't catch that right 🩷 I'm still learning and I know I have limits — try tapping one of the buttons below.",
          "My bad — I missed what you were getting at 🩷 The buttons below are more reliable than my text understanding right now.",
          "I hear your frustration and I'm sorry 🩷 Try rephrasing what's going on with your body and I'll do my best.",
          "Not always perfect, I know 😕 If you can describe it simply — like 'late period' or 'bad cramps' — I'll follow better.",
          "Sorry I didn't get that right 🩷 Sometimes typing something short like 'my period is late' or 'I have cramps' works better than a longer message.",
          "I'm doing my best but I know I don't always get it right 🩷 Try a button below or rephrase and I'll try again.",
        ]),
      ],
    },

    // ── STIs / sexual health adjacent ─────────────────────────────────────
    {
      name: "sti_questions",
      patterns: [/\b(std|sti|hiv|herpes|chlamydia|gonorrhea|syphilis|infection down there|burning when i pee|discharge that smells)\b/],
      replies: [
        () => "STI symptoms can sometimes overlap with cycle symptoms, so I want to be careful here 🩷",
        () => "I'm not equipped to help with STI diagnosis or treatment — but if you're noticing unusual discharge, pain, or changes, a healthcare provider can check properly.",
        () => "You can use the care map to find a clinic near you.",
      ],
    },

    // ── Contraception questions ────────────────────────────────────────────
    {
      name: "contraception",
      patterns: [/\b(birth control|contraception|pill|depo|iud|implant|condom|plan b|morning after|emergency contraception)\b/],
      replies: [
        () => "Contraception can definitely affect your cycle — especially spotting, period timing, and mood 🩷",
        () => "I can help with the cycle side of things. If your period changed after starting or stopping birth control, tap **Spotting** or **Late or missed period** and let's look at it.",
      ],
    },

    // ── Postpartum questions ──────────────────────────────────────────────
    {
      name: "postpartum_q",
      patterns: [
        /\b(after birth|postpartum|after delivery|after baby|after i gave birth|period after baby|period after birth|breastfeeding.*period|period.*breastfeed)\b/,
        /\b(lochia|bleeding after birth|bleeding after delivery|fourth trimester)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_POSTPARTUM",
    },

    // ── TTC / trying to conceive ───────────────────────────────────────────
    {
      name: "ttc_q",
      patterns: [
        /\b(trying to (conceive|get pregnant)|trying for a baby|ttc|when (can|should) i try|fertile window|best time to conceive|ovulation.*window|when do i ovulate|am i ovulating)\b/,
        /\b(how (long|hard) to get pregnant|chances of (getting |becoming )?pregnant|conceive naturally)\b/,
      ],
      replies: [],
      forceNext: "CYCLE_TTC_INFO",
    },

    // ── Telecom / phone plans ─────────────────────────────────────────────
    {
      name: "telecom",
      patterns: [
        /\b(digicel|flow|airtime|data plan|bundle|sim|top up|top-up)\b/,
        /\b(wifi|internet|signal|network|router|data)\b/,
      ],
      replies: [
        () => "That sounds like a phone or service question — not quite my area 🩷",
        () => "If you were trying to ask a health question, just type it and I'll do my best.",
      ],
    },

    // ── Jokes / banter ─────────────────────────────────────────────────────
    {
      name: "jokes",
      patterns: [/\b(lol|lmao|haha|😂|🤣|joke|funny|make me laugh|bored)\b/],
      replies: [
        () => pick([
          "I'm not the funniest assistant out there 😅 but I'm pretty solid at cycle questions. What's going on?",
          "Ha 😄 Okay okay, I'll stay in my lane. What's going on health-wise?",
          "Comedians out here and I'm just a cycle assistant 😄 What's actually on your mind?",
          "I can't compete with the group chat jokes 😂 but if something health-related is going on, I've got you.",
          "Laughter is good medicine 😄 — but if you've got an actual question about your cycle, I'm here for that too.",
          "The bored season is real 😄 If you want something to actually think about — how's your cycle been lately?",
        ]),
      ],
    },
  ];

  // Health signals that should ALWAYS beat OOS pattern matches.
  // e.g. "me bleed thru me pants lol" has "lol" but the health signal wins.
  //
  // Pattern 1 — explicit clinical / menstrual keywords (original, unchanged).
  // Patterns 2–4 — vague / indirect reproductive-health phrases that should
  //   keep the user in-scope even when no clinical keyword is present.
  //   These match the same phrasing added to HEALTH_GATE in bloomie-intent.js.
  const HEALTH_OVERRIDE_PATTERNS = [
    // Explicit clinical / menstrual keywords
    /\b(bleed|bleeding|blood|period|cramp|pain|spot|spotting|late|missed|discharge|pregnant|pregnancy|nausea|dizzy|faint|heavy|clot|pelvic|mood|tired|fatigue|cycle|ovulat|sad|angry|mad|vex|frustrated|happy|excited|emotional|anxious|energy)\b/,
    // Location anchors implying reproductive concern
    /down there|down below|lady parts?|private parts?|feminine area|mi body/i,
    // Wrongness / off signals that imply a body concern without clinical words
    /something(?:'s)?\s+(?:wrong|off|not right|not normal|strange)|sumn\s+(?:wrong|off)/i,
    /not feel(?:ing)?\s+right|feel(?:ing)?\s+(?:off|weird|strange)|nuh feel right|mi nuh feel|mi feel off/i,
    /off lately|been off|not myself|not like myself|nuh feel like mi/i,
    // Indirect cycle / timing hints
    /hasn.?t come yet|not here yet|still waiting (?:for it|on it)/i,
    /sumn wrong with (?:my|mi)\s+(?:cycle|body|period|flow)/i,
  ];

  // Cycle question patterns — checked FIRST before health override
  // because they contain words like "period" that health override would swallow
  const CYCLE_QUESTION_PATTERNS = [
    /\b(what phase|which phase|am i ovulating|where am i in my cycle|what day of my cycle)\b/,
    /\b(when is my (next )?period|when will my period|when do i get my period|period due|how long (until|till) my period)\b/,
    /\b(when was my last period|when did my period|last period date|my lmp)\b/,
    /\b(when is my due date|what is my due date|due date|edd|estimated delivery|how far along|how many weeks (am i|pregnant))\b/,
    /\b(when (should|can) i (take|do) a (pregnancy )?test|when (should|can) i test|best time to test|when to test|can i test (yet|now))\b/,
  ];

  function routeUserText(t) {
    t = String(t || "").toLowerCase();

    // ── Urgency: always first ──────────────────────────────────────────────
    const urgentPhrases = [
      "faint", "passed out", "cant breathe", "can't breathe",
      "shortness of breath", "soaking through", "bleeding through",
      // Additional red-flag phrases — broad enough to catch variants
      "almost fainted", "nearly fainted", "about to faint", "feel like fainting",
      "feel like i faint", "mi feel like mi a go faint",
      "chest pain", "chest tight", "chest is tight", "chest hurts",
      "trouble breathing", "hard to breathe", "can't get air", "cant get air",
      "difficulty breathing", "breath is short",
    ];
    if (urgentPhrases.some((p) => t.includes(p))) return { next: "EMERGENCY_REDIRECT" };

    // ── Severe pelvic pain — route directly to urgent care ─────────────────
    const severePelvicPhrases = [
      "severe pelvic pain", "unbearable pelvic pain", "extreme pelvic pain",
      "severe cramps", "unbearable cramps", "cramps are unbearable",
      "worst pain ever", "worst pain i ever", "pain is unbearable",
      "pain is so bad i", "pain is too bad", "pain too bad",
      "one-sided pain", "one sided pain", "sharp pain one side",
      "pain one side", "pain spreading", "stabbing pain",
    ];
    if (severePelvicPhrases.some((p) => t.includes(p))) return { next: "PELVIC_URGENT" };

    // ── Positive pregnancy test + pain or bleeding ─────────────────────────
    // Possible ectopic / miscarriage concern — conservative redirect.
    const posTestSignal = /positive test|tested positive|test (is|was|came back) positive|two lines|two line|pregnant and (have|got|feeling)|pregnancy test positive/.test(t);
    const painOrBleedSignal = /\b(pain|cramp|bleed|bleeding|spotting|spot)\b/.test(t);
    if (posTestSignal && painOrBleedSignal) return { next: "PELVIC_URGENT" };

    // ── Heavy bleeding multi-route detection (priority: C > A > B) ────────
    const heavyRouteC = [
      "dizzy", "lightheaded", "feel sick", "can't stand", "cant stand",
      "feel like pass out", "mi feel weak", "mi dizzy", "mi feel faint",
      "mi head spinning", "feel like mi a go drop", "fainting",
    ];
    const heavyRouteA = [
      "soaking", "soaked", "flooding", "bleed through", "bleed nuff",
      "pad full", "tampon full", "changing every hour",
      "bleed out", "bleeding out bad", "pad full up", "tampon full up",
      "blood everywhere", "nuff blood",
    ];
    const heavyRouteB = [
      "won't stop", "wont stop", "not stopping", "still bleeding",
      "bleeding for days", "been bleeding", "period too long",
      "period won't end", "period wont end",
      "7 days", "8 days", "9 days", "10 days", "week of bleeding",
      "nuh stop bleed", "period nuh stop", "period still a go",
      "bleeding too long", "a week now",
    ];
    // Route C also matches standalone "weak" as a whole word
    const isHeavyC = heavyRouteC.some((p) => t.includes(p)) || /\bweak\b/.test(t);
    const isHeavyA = heavyRouteA.some((p) => t.includes(p));
    const isHeavyB = heavyRouteB.some((p) => t.includes(p));
    if (isHeavyC && (isHeavyA || isHeavyB || /\bbleed|\bperiod|\bblood|\bheavy\b/.test(t))) return { next: "HEAVY_ROUTE_C_GATE" };
    if (isHeavyA) return { next: "HEAVY_INTRO" };
    if (isHeavyB) return { next: "HEAVY_ROUTE_B" };

    // ── Pregnancy test: already tested negative ───────────────────────────
    if (
      /tested negative/.test(t) ||
      /negative test/.test(t) ||
      /test came back negative/.test(t) ||
      /took a test already/.test(t) ||
      /already tested/.test(t)
    ) return { next: "TEST_NEGATIVE_INTRO" };

    // ── Pregnancy test: recent unprotected sex ────────────────────────────
    if (
      /had unprotected sex/.test(t) ||
      /unprotected sex recently/.test(t) ||
      /sex without (a )?condom/.test(t) ||
      /forgot (the )?condom/.test(t)
    ) return { next: "TEST_RECENT_SEX_INTRO" };

    // ── Session summary request ───────────────────────────────────────────────
    // Catches "what did you say", "remind me", Patois "wah we talk bout", etc.
    if (
      /\b(what did (you|bloomie) say|remind me|what have we (covered|talked|discussed)|what did we talk|what was that again|give me a summary|what have you told me)\b/i.test(t) ||
      /\b(summary)\b/i.test(t) ||
      /\b(wah we (talk|cover|discuss)|wah yu say|wah you say|wah we talk bout)\b/i.test(t)
    ) return { next: "CONVERSATION_SUMMARY" };

    // ── Single-word / ultra-short routing ─────────────────────────────────────
    // Ensures common single-word inputs route immediately rather than falling to OOS.
    if (/^\s*(idk|i don'?t know|not sure)\s*$/i.test(t))                           return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/^\s*help\s*$/i.test(t))                                                   return { next: "START_MENU" };
    if (/^\s*period\s*$/i.test(t))                                                 return { next: "PERIOD_TRIAGE" };
    if (/^\s*late\s*$/i.test(t))                                                   return { next: "LATE_INTRO" };
    if (/^\s*(pain|ache|aching)\s*$/i.test(t))                                     return { next: "PELVIC_INTRO" };
    if (/^\s*(cramps?|cramping)\s*$/i.test(t))                                     return { next: "PELVIC_INTRO" };
    if (/^\s*(bleeding|blood|bleed)\s*$/i.test(t))                                 return { next: "HEAVY_INTRO" };
    if (/^\s*(spotting|spots?)\s*$/i.test(t))                                      return { next: "SPOT_INTRO" };
    if (/^\s*(pregnant|pregnancy)\s*$/i.test(t))                                   return { next: "PREGNANCY_ENTRY" };
    if (/^\s*(discharge)\s*$/i.test(t))                                            return { next: "ELSE_DISCHARGE_ENTRY" };
    if (/^\s*(mood|moods)\s*$/i.test(t))                                           return { next: "MOOD_SAFETY_CHECK" };
    if (/^\s*(nausea|nauseous|queasy)\s*$/i.test(t))                               return { next: "PREGNANCY_ENTRY" };
    if (/^\s*(dizzy|dizziness)\s*$/i.test(t))                                      return { next: "PELVIC_INTRO" };
    if (/^\s*(tired|fatigue|exhausted)\s*$/i.test(t))                              return { next: "MOOD_SAFETY_CHECK" };
    if (/^\s*(test|testing)\s*$/i.test(t))                                         return { next: "TEST_INTRO" };
    if (/^\s*(endo|endometriosis)\s*$/i.test(t))                                   return { next: "EDUC_ENDO" };
    if (/^\s*pcos\s*$/i.test(t))                                                   return { next: "EDUC_PCOS" };
    if (/^\s*menopause\s*$/i.test(t))                                              return { next: "MENOPAUSE_INFO_NODE" };
    if (/^\s*(panadol|ibuprofen|buscopan|ponstan|naproxen)\s*$/i.test(t))          return { next: "MEDICATION_REDIRECT" };

    // Vague/indirect → not sure route
    if (/\b(something feels off|feel off|not feeling right|sumn wrong|something wrong with me)\b/.test(t)) return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/^is this normal\??\s*$/i.test(t))                                         return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/\b(something is coming out|sumn a come out)\b/.test(t))                   return { next: "ELSE_DISCHARGE_ENTRY" };
    if (/\b(i don.t feel like myself|mi nuh feel like miself)\b/.test(t))          return { next: "MOOD_SAFETY_CHECK" };

    // Additional vague-but-clearly-reproductive-health messages
    if (/\b(my body feels weird|body feels strange|body feels different|feel weird in my body|body acting weird|body acting strange)\b/.test(t)) return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/\b(i don.?t feel normal|i dont feel normal|not feeling normal|don.?t feel right)\b/.test(t))                                           return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/\b(my cycle has changed|cycle is different|my period has changed|period is different now|period been different|period acting different|period acting up|period is acting)\b/.test(t)) return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/\b(something (is )?wrong with my period|something wrong with my cycle|something off with my period|sumn wrong with my period|period nuh normal)\b/.test(t))                        return { next: "ELSE_NOT_SURE_ROUTE" };
    if (/\b(i feel like something is wrong|feel like something wrong|something is off|something off with my body|body off)\b/.test(t))                                                     return { next: "ELSE_NOT_SURE_ROUTE" };

    // ── Condition education: PCOS ─────────────────────────────────────────
    // Explicit name, or "irregular period" paired with acne or hair symptoms.
    if (
      /\bpcos\b/.test(t) ||
      /\bpolycystic\b/.test(t) ||
      (/irregular period/.test(t) && /\bacne\b/.test(t)) ||
      (/irregular period/.test(t) && /\bhair\b/.test(t))
    ) return { next: "EDUC_PCOS" };

    // ── Condition education: Endometriosis ────────────────────────────────
    if (
      /\bendometriosis\b/.test(t) ||
      /\bendo\b/.test(t) ||
      /pain every period/.test(t) ||
      /period pain that doesn.t go away/.test(t)
    ) return { next: "EDUC_ENDO" };

    // ── Condition education: Contraception ────────────────────────────────
    if (
      /\bcontraception\b/.test(t) ||
      /birth control/.test(t) ||
      /\bcondom\b/.test(t) ||
      /\bpill\b/.test(t) ||
      /\biud\b/.test(t) ||
      /\bimplant\b/.test(t) ||
      /family planning/.test(t)
    ) return { next: "EDUC_CONTRACEPTION" };

    // ── Perimenopause ─────────────────────────────────────────────────────
    if (
      /\bperimenopause\b/.test(t) ||
      /peri.?menopause/.test(t) ||
      /going through the change/.test(t) ||
      /change of life/.test(t) ||
      /\bpremenopause\b/.test(t) ||
      /mi (think mi |a )?go through the change/.test(t) ||
      (/irregular period/.test(t) && /hot flash/.test(t)) ||
      /my period is changing/.test(t)
    ) return { next: "PERIMENOPAUSE_INTRO" };

    // ── Menopause ─────────────────────────────────────────────────────────
    if (
      /\bmenopause\b/.test(t) ||
      /\bmenopausal\b/.test(t) ||
      /no period for months/.test(t) ||
      /period (stopped|done|finish)/.test(t) ||
      /mi period stop/.test(t)
    ) return { next: "MENOPAUSE_INFO_NODE" };

    // ── Pregnancy concern: intent-first entry ─────────────────────────────
    if (
      /\bpregnancy concern\b/.test(t) ||
      /\bpregnancy scare\b/.test(t) ||
      /could i be pregnant/.test(t) ||
      /might i be pregnant/.test(t) ||
      /am i pregnant/.test(t) ||
      /\bfertility concern\b/.test(t) ||
      /trying to conceive/.test(t) ||
      /trying to get pregnant/.test(t) ||
      /trying for a baby/.test(t) ||
      (/\bpregnant\b/.test(t) && !/tested (negative|positive)/.test(t) && !/test (came back|was) (negative|positive)/.test(t))
    ) return { next: "PREGNANCY_ENTRY" };

    // ── Mood: Patois explicit patterns ────────────────────────────────────
    if (
      /mi feel off/.test(t) ||
      /mi nuh feel right/.test(t) ||
      /mi sad fi no reason/.test(t) ||
      /mi vex all the time/.test(t) ||
      /mi feel empty/.test(t) ||
      /mi cyan cope/.test(t) ||
      /everything a get to me/.test(t) ||
      /mi nuh have no energy fi nothing/.test(t)
    ) return { next: "MOOD_SAFETY_CHECK" };

    // ── Pelvic pain: Patois explicit patterns ─────────────────────────────
    if (
      /mi belly a hurt/.test(t) ||
      /pain down deh/.test(t) ||
      /cramp bad/.test(t) ||
      /pain inna mi belly/.test(t) ||
      /belly (a )?hurting/.test(t) ||
      /waist a hurt/.test(t) ||
      /pain between mi legs/.test(t)
    ) return { next: "PELVIC_SAFETY_GATE" };

    const { sig, has } = scoreSignals(t);
    const combo = resolveSignals(sig, has);
    if (combo) return combo;

    // ── Single best-signal fallback ───────────────────────────────────────
    // If no combination rule fired, pick the strongest single signal.
    const best = Object.entries(sig).sort((a, b) => b[1] - a[1])[0];
    const [bestIntent, bestScore] = best;

    if (bestScore < 2) {
      // ── "Valid but unclear" reproductive-health fallback ─────────
      // Catches messages that are clearly cycle/body adjacent but score
      // below the single-signal threshold — avoids sending them to the
      // generic OOS reply.
      const VAGUE_REPRO_PATTERNS = [
        /\b(cycle|period|bleeding|ovulat|menstrual|hormones?|discharge|womb|uterus|cervix|vagina|reproductive)\b/,
        /\b(something feels off|feel off|not feeling right|body feels|feel weird|feel strange|feel different)\b/,
        /\b(something (is )?wrong|something off|not normal|not right|has changed|been different|acting up)\b/,
      ];
      if (VAGUE_REPRO_PATTERNS.some((rx) => rx.test(t))) {
        return { next: "ELSE_NOT_SURE_ROUTE", payload: { reason: "vague_repro_health" } };
      }

      // ── Deterministic OOS handling ───────────────────────────────
      const cat = detectOutOfScope(t, OOS, HEALTH_OVERRIDE_PATTERNS);
      if (cat) {
        const lines = (cat.replies || OOS_DEFAULT)
          .map((r) => typeof r === "function" ? r(t) : r)
          .filter(Boolean);
        if (cat.name === "greeting") ctx.greeted = true;
        ctx.lastOOS = cat.name;
        return {
          reply: lines.length ? lines : OOS_DEFAULT.map((r) => (typeof r === "function" ? r(t) : r)),
          next: cat.forceNext || "START_MENU",
          payload: { oos: cat.name },
        };
      }
      return {
        reply: OOS_DEFAULT.map((r) => (typeof r === "function" ? r(t) : r)),
        next: "START_MENU",
        payload: { oos: "default" },
      };
    }

    // Route by best single signal
    if (bestIntent === "heavy")     return { next: "HEAVY_INTRO" };
    if (bestIntent === "late")      return { next: "LATE_INTRO" };
    if (bestIntent === "spot")      return { next: "SPOT_INTRO" };
    if (bestIntent === "mood")      return { next: "MOOD_SAFETY_CHECK" };
    if (bestIntent === "pregnancy") return { next: "PREGNANCY_ENTRY" };
    if (bestIntent === "discharge") return { next: "ELSE_DISCHARGE" };
    if (bestIntent === "pelvic") {
      return { next: "PELVIC_SAFETY_GATE" };
    }

    // Late check with cycle data
    if (has("late_check", 2)) return { next: "LATE_PERIOD_CHECK", payload: { reason: "late_check" } };

    // Red flag / should I see a doctor — needs context from lastIntent
    if (has("red_flag", 2)) return { next: "SEE_DOCTOR_GUIDE", payload: { reason: "see_doctor" } };

    return { next: "START_MENU" };
  }

  return { OOS, OOS_DEFAULT, HEALTH_OVERRIDE_PATTERNS, CYCLE_QUESTION_PATTERNS, routeUserText };
}
