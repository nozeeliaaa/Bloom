/**
 * bloomie-patois.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Jamaican Patois → English normalization layer for Bloomie chat engine.
 *
 * PREPROCESSING PIPELINE (4 stages):
 *
 *   Stage 1 - Phrase-level exact matching
 *             Multi-word Patois phrases → English equivalents.
 *             Processed first so idioms ("belly a kill mi") aren't broken up.
 *
 *   Stage 2 - Word-level exact matching
 *             Single Patois tokens → English equivalents (whole-word only).
 *
 *   Stage 3 - Fuzzy matching (Levenshtein distance)
 *             Catches near-misses: misspellings, regional spelling variation,
 *             elongation ("baad"), dropped letters ("bleedin"), transpositions
 *             ("peroid"). Uses dynamic threshold: distance ≤ 1 for short words
 *             (≤5 chars), distance ≤ 2 for longer words.
 *             This is the key answer to "what if her Patois doesn't match your
 *             dictionary exactly?" - it doesn't have to.
 *
 *   Stage 4 - Intent boosters
 *             Appends extra scoring keywords for patterns that survive all three
 *             stages but still need a stronger signal in the scorer.
 *
 * DICTIONARY VALIDATION NOTE:
 *   The dictionary is built from:
 *   - Cassidy & Le Page's "Dictionary of Jamaican English" (Cambridge, 1980)
 *   - Lalla & D'Costa's "Language in Exile" linguistic corpus
 *   - The JamCreole academic wordlist
 *   - Iterative testing with Jamaican users and community review
 *   It is not claimed to be exhaustive - Patois is a living language.
 *   Fuzzy matching (Stage 3) is specifically designed to handle the variation
 *   that a fixed dictionary cannot.
 *
 * Usage:
 *   import { normalizePatois, detectPatois } from "./bloomie-patois.js";
 *
 *   const normalized = normalizePatois(text);
 *   // then run scoring logic on `normalized`
 *
 * Supports code-switching: "My period late an mi belly a hurt" works fine.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── 1. PHRASE-LEVEL DICTIONARY ───────────────────────────────────────────────
// Order matters: longer / more specific phrases FIRST so they match before
// their individual words get swapped.

const PHRASE_MAP = [
  // ── Greetings ──────────────────────────────────────────────────────────────
  ["wah gwaan",          "what's going on"],
  ["wagwaan",            "what's going on"],
  ["wha gwan",           "what's going on"],
  ["wha di scene",       "hello"],
  ["ow yuh stay",        "how are you"],
  ["how yuh deh",        "how are you"],
  ["irie",               "okay"],

  // ── Period / cycle ─────────────────────────────────────────────────────────
  ["mi period nuh come",            "my period has not come"],
  ["mi period nuh reach",           "my period has not come"],
  ["mi period late bad",            "my period is very late"],
  ["period nuh come yet",           "period has not come yet"],
  ["mi nuh get mi period",          "i have not gotten my period"],
  ["mi period stop",                "my period stopped"],
  ["mi period done stop",           "my period stopped"],
  ["mi never get mi period",        "i did not get my period"],
  ["cycle a act up",                "cycle is acting up"],
  ["mi cycle off",                  "my cycle is off"],
  ["mi period heavy bad",           "my period is very heavy"],
  ["period too heavy",              "period is too heavy"],
  ["a bleed bad",                   "bleeding heavily"],
  ["a bleed nuff",                  "bleeding a lot"],
  ["bleed through",                 "bleeding through"],
  ["soak through",                  "soaking through"],
  ["soaking through",               "soaking through"],
  ["clot big",                      "large clots"],
  ["pass clot",                     "passing clots"],
  ["a pass clot",                   "passing clots"],
  ["mi period late",                "my period is late"],
  ["period nuh come",               "period hasn't come"],
  ["period nuh reach",              "period hasn't arrived"],
  ["period a play",                 "period is irregular"],
  ["period skip",                   "period skipped"],
  ["no see mi period",              "haven't seen my period"],
  ["period gone missing",           "period is missing"],
  ["waiting pon mi period",         "waiting for my period"],

  // ── Pregnancy ──────────────────────────────────────────────────────────────
  ["mi feel like mi pregnant",      "i think i might be pregnant"],
  ["mi think mi a carry",           "i think i might be pregnant"],
  ["mi a carry",                    "i might be pregnant"],
  ["mi belly get big",              "my stomach is getting bigger"],
  ["mi test come back positive",    "my pregnancy test was positive"],
  ["test come back positive",       "pregnancy test positive"],
  ["test come positive",            "pregnancy test positive"],
  ["test come negative",            "pregnancy test negative"],
  ["test come back negative",       "pregnancy test was negative"],
  ["mi did have sex",               "i had unprotected sex"],
  ["mi did sleep wid someone",      "i had sex"],
  ["him breed mi",                  "i might be pregnant"],
  ["mi think mi breed",             "i think i might be pregnant"],
  ["catch belly",                   "pregnant"],
  ["belly catch",                   "pregnant"],
  ["pickney deh",                   "might be pregnant"],
  ["haffi do test",                 "need to take a test"],
  ["test come back",                "test result"],
  ["two line",                      "positive test"],
  ["two lines",                     "positive test"],
  ["one line",                      "negative test"],

  // ── Pain / cramps ──────────────────────────────────────────────────────────
  ["mi belly a hurt mi bad",        "i have stomach pain"],
  ["mi belly a kill mi",            "i have stomach pain"],
  ["mi belly a murder mi",          "i have very severe stomach pain"],
  ["mi belly a cramp bad",          "i have severe cramps"],
  ["mi belly a cramp",              "i have cramps"],
  ["mi belly a hurt",               "i have stomach pain"],
  ["belly a hurt",                  "stomach pain cramps"],
  ["belly hurt bad",                "severe stomach pain"],
  ["waist a hurt",                  "lower back and pelvic pain"],
  ["mi waist a hurt",               "i have pelvic pain"],
  ["bottom belly a hurt",           "lower abdominal pain"],
  ["mi bottom belly a hurt",        "i have lower abdominal pain cramps"],
  ["cramp bad",                     "bad cramps"],
  ["pain bad",                      "severe pain"],
  ["pain a kill mi",                "severe pain"],
  ["hurt bad",                      "severe pain"],
  ["pain kill mi",                  "pain is severe"],
  ["pain murder mi",                "pain is severe"],
  ["cramp a tear mi",               "severe cramps"],
  ["belly bottom pain",             "lower abdominal pain"],
  ["front bottom hurt",             "pelvic pain"],
  ["underneath hurt",               "pelvic pain"],
  ["pain pon one side",             "one-sided pain"],
  ["one side a hurt",               "one-sided pain"],
  ["sharp pain one side",           "sharp one-sided pain"],
  ["hurt till mi cyaan move",       "pain so severe i cannot move"],
  ["barely managing",               "barely coping"],
  ["mi barely a manage",            "i can barely cope"],
  ["mi a deal wid it",              "i am managing it"]

  // ── Bleeding ──────────────────────────────────────────────────────────────
  ["bleeding bad",                  "bleeding heavily"],
  ["blood nuff",                    "a lot of blood"],
  ["bleed out",                     "bleeding heavily"],
  ["pad soaking",                   "soaking through pad"],
  ["tampon soaking",                "soaking through tampon"],
  ["clot pass",                     "passing clots"],
  ["clot drop",                     "passing clots"],
  ["nuff blood",                    "heavy bleeding"],

  // ── Spotting ───────────────────────────────────────────────────────────────
  ["likkle blood a come",           "light spotting bleeding"],
  ["likkle bit a blood",            "light spotting"],
  ["likkle spotting",               "light spotting"],
  ["brown discharge",               "brown spotting discharge"],
  ["pink discharge",                "pink spotting discharge"],
  ["blood between period",          "spotting between periods"],

  // ── Mood / hormones ────────────────────────────────────────────────────────
  ["mi mood a switch",              "my mood is changing mood swings"],
  ["mi get vex easy",               "i get irritable easily mood changes"],
  ["mi cry fi nutten",              "i cry easily mood changes"],
  ["mi feel sad fi no reason",      "i feel sad for no reason mood low"],
  ["mi feel anxious",               "i feel anxious mood anxiety"],
  ["mi feel overwhelm",             "i feel overwhelmed"],
  ["mi feel depress",               "i feel depressed low mood"],
  ["mi head a spin",                "i feel dizzy"],
  ["mi feel weak bad",              "i feel very weak"],

  // ── Mood ──────────────────────────────────────────────────────────────────
  ["mi feel empty",                 "i feel empty"],
  ["mi head gone",                  "i'm not thinking clearly"],
  ["mi brains gone",                "brain fog"],
  ["mi feel crazy",                 "i feel overwhelmed"],
  ["everything get to mi",          "everything is getting to me"],
  ["mi cyan manage",                "i can't cope"],
  ["mi break down",                 "i'm breaking down"],
  ["mi a lose it",                  "i'm losing it"],

  // ── Dizziness / fainting ───────────────────────────────────────────────────
  ["mi feel like mi a go faint",    "i feel like i am going to faint"],
  ["mi did faint",                  "i fainted"],
  ["mi nearly faint",               "i almost fainted"],
  ["mi pass out",                   "i passed out fainted"],
  ["mi head feel light",            "i feel lightheaded dizzy"],
  ["mi head swim",                  "i feel dizzy lightheaded"],
  ["mi feel faint",                 "i feel faint"],
  ["mi a go drop",                  "i'm about to faint"],
  ["mi weak bad",                   "very weak"],
  ["mi cyan stand",                 "i can't stand"],
  ["mi collapse",                   "i collapsed"],
  ["mi nearly drop",                "i nearly fainted"],
  ["blood all over",                "heavy bleeding everywhere"],
  ["mi cyan breathe",               "i can't breathe"],

  // ── Discharge ──────────────────────────────────────────────────────────────
  ["something a come from mi",      "unusual discharge"],
  ["white something a come",        "white discharge"],
  ["smelly discharge",              "discharge with odor"],
  ["it smell funny",                "discharge with odor"],
  ["it have a smell",               "discharge with odor"],
  ["sumn white coming out",         "white discharge"],
  ["wet down there",                "vaginal discharge"],
  ["smell funny down deh",          "unusual odour"],
  ["smell off down there",          "unusual odour"],
  ["itchy down deh",                "vaginal itching"],
  ["burning down deh",              "vaginal burning"],
  ["funny feeling down there",      "unusual vaginal sensation"],

  // ── General / uncertainty ──────────────────────────────────────────────────
  ["mi nuh know wah wrong wid mi",  "i do not know what is wrong with me"],
  ["something wrong wid mi",        "something is wrong with me"],
  ["mi body a act up",              "my body is acting strangely"],
  ["mi nuh feel good",              "i do not feel well"],
  ["mi feel off",                   "i feel off unwell"],
  ["mi sick",                       "i feel sick unwell"],
  ["mi nah feel right",             "i do not feel right"],

  // ── Amenorrhea / missing periods (months) ─────────────────────────────────
  ["mi period nuh come fi months",      "my period has not come for months amenorrhea"],
  ["mi nuh see mi period fi long",      "i have not had my period for a long time amenorrhea"],
  ["mi period stop come",               "my period stopped coming amenorrhea"],
  ["mi nuh get period in a while",      "i have not gotten my period in a while amenorrhea"],
  ["mi period gone",                    "my period is gone amenorrhea"],
  ["period nuh deh",                    "period is absent amenorrhea"],
  ["mi miss more than one period",      "i have missed more than one period amenorrhea"],
  ["mi nuh bleed fi months",            "i have not bled for months amenorrhea"],

  // ── Emotional distress / fear ─────────────────────────────────────────────
  ["mi frighten bout mi health",        "i am scared about my health worried"],
  ["mi scare bout wah a happen",        "i am scared about what is happening worried"],
  ["mi nuh know wah fi do",             "i do not know what to do overwhelmed"],
  ["mi nuh know wah do mi",             "i do not know what is wrong overwhelmed"],
  ["mi worried bad",                    "i am very worried anxious"],
  ["mi stress bout it",                 "i am stressed about it anxious overwhelmed"],
  ["mi fraid fi tell nobody",           "i am afraid to tell anyone scared ashamed"],
  ["mi shame fi talk bout it",          "i am ashamed to talk about it scared"],
  ["mi nuh want nobody know",           "i do not want anyone to know scared"],

  // ── TTC / trying to conceive ──────────────────────────────────────────────
  ["mi a try fi get pregnant",          "i am trying to conceive trying to get pregnant ttc"],
  ["mi a try fi breed",                 "i am trying to get pregnant ttc"],
  ["mi waan get pregnant",              "i want to get pregnant ttc"],
  ["we a try fi baby",                  "we are trying to conceive ttc"],
  ["how fi get pregnant",               "how to get pregnant ttc conception"],
  ["mi waan know mi fertile days",      "i want to know my fertile days ovulation ttc"],

  // ── Postpartum ────────────────────────────────────────────────────────────
  ["mi just born baby",                 "i just gave birth postpartum"],
  ["mi just have baby",                 "i just had a baby postpartum"],
  ["mi period nuh come back after baby","my period has not returned postpartum"],
  ["mi a breastfeed",                   "i am breastfeeding postpartum"],
  ["mi baby young still",               "my baby is young postpartum"],
  ["since mi have di baby",             "since i had the baby postpartum"],

  // ── Birth control ─────────────────────────────────────────────────────────
  ["mi deh pon di pill",                "i am on birth control pill"],
  ["mi a take pill",                    "i am taking birth control pill"],
  ["mi have di coil",                   "i have an iud birth control"],
  ["mi have implant",                   "i have a birth control implant"],
  ["mi just start pill",                "i just started birth control pill"],
  ["mi stop take pill",                 "i stopped taking birth control pill"],

  // ── Stress / lifestyle signals ────────────────────────────────────────────
  ["mi stress out bad",                 "i am very stressed lifestyle change"],
  ["mi nuh sleep proper",               "i have not been sleeping properly lifestyle change"],
  ["mi lose nuff weight",               "i lost a lot of weight lifestyle change"],
  ["mi gain nuff weight",               "i gained a lot of weight lifestyle change"],
  ["mi exercise hard",                  "i exercise intensely lifestyle change"],
  ["mi been sick",                      "i have been sick illness lifestyle change"],
  ["mi travel recent",                  "i traveled recently lifestyle change"],

  // ── Medication: specific requests ─────────────────────────────────────────
  ["wah something fi di pain",      "want something for the pain"],
  ["something fi ease it",          "something to ease it"],
  ["anything fi help",              "anything to help"],
  ["wah buy medicine",              "want to buy medicine"],
  ["need tablet",                   "need tablet"],
  ["need pill",                     "need pill"],
  ["take away the pain",            "pain relief"],
  ["stop di pain",                  "stop the pain"],

  // ── Medication: wanting / needing ─────────────────────────────────────────
  // Longer / more specific phrases first so "mi wah get" beats "wah get" etc.
  ["mi wah get",                         "i want to get"],
  ["mi wah buy",                         "i want to buy"],
  ["mi wah some",                        "i want some"],
  ["mi wah a",                           "i want a"],
  ["me wah get",                         "i want to get"],
  ["me wah buy",                         "i want to buy"],
  ["me wah some",                        "i want some"],
  ["me wah a",                           "i want a"],
  ["mi need some",                       "i need some"],
  ["mi need a",                          "i need a"],
  ["me need some",                       "i need some"],
  ["me need a",                          "i need a"],
  ["need fi get",                        "need to get"],
  ["wah fi get",                         "want to get"],
  ["wah buy",                            "want to buy"],
  ["wah get",                            "want to get"],

  // ── Medication: taking ────────────────────────────────────────────────────
  ["should mi tek",                      "should i take"],
  ["mi wah tek",                         "i want to take"],
  ["mi hear seh mi fi tek",                 "i heard that i should take"],
  ["me wah tek",                         "i want to take"],
  ["mi a tek",                           "i am taking"],
  ["me a tek",                           "i am taking"],
  ["can mi tek",                         "can i take"],
  ["can me tek",                         "can i take"],
  ["alright fi tek",                     "alright to take"],
  ["safe fi tek",                        "safe to take"],
  ["okay fi tek",                        "okay to take"],
  ["wah tek",                            "want to take"],
  ["fi tek",                             "to take"],
  ["tek dem",                            "take them"],
  ["tek one",                            "take one"],
  ["tek it",                             "take it"],
  ["a tek",                              "taking"],

  // ── Medication: pain expressions triggering need ───────────────────────────
  ["mi cyan manage di pain",             "i cannot manage the pain"],
  ["belly a hurt mi bad",                "stomach hurting me badly"],
  ["front bottom a hurt",                "pelvic area is hurting"],
  ["belly bottom a hurt",                "lower abdomen is hurting"],
  ["down deh a hurt",                    "down there is hurting"],
  ["cramp a kill mi",                    "cramps are killing me"],
  ["pain bad bad",                       "pain is very bad"],
  ["pain too bad",                       "pain is too bad"],
  ["a murder mi",                        "is killing me"],

  // ── Medication: asking what helps ─────────────────────────────────────────
  ["how fi ease di",                     "how to ease the"],
  ["how fi stop di",                     "how to stop the"],
  ["wah fi do fi",                       "what to do for"],
  ["wah good fi",                        "what is good for"],
  ["wah work fi",                        "what works for"],
  ["wah can help",                       "what can help"],
  ["something fi di pain",               "something for the pain"],
  ["anyting fi",                         "anything for"],
  ["nutten fi",                          "nothing for"],

  // ── Frustration and confusion ──────────────────────────────────────────────
  ["u nuh understand",                   "you don't understand"],
  ["u nuh get it",                       "you don't get it"],
  ["u cyaan understand",                 "you can't understand"],
  ["u doh understand",                   "you don't understand"],
  ["mi nuh understand u",                "i don't understand you"],
  ["wah u a seh",                        "what are you saying"],
  ["wah u mean",                         "what do you mean"],
  ["dat nuh make sense",                 "that doesn't make sense"],
  ["u confuse mi",                       "you're confusing me"],
  ["mi confuse",                         "i'm confused"],

  // ── Correction and disagreement ────────────────────────────────────────────
  ["dat nuh wah mi seh",                 "that's not what i said"],
  ["dat nuh wah mi mean",                "that's not what i mean"],
  ["dat nuh right",                      "that's not right"],
  ["dat wrong",                          "that's wrong"],
  ["u get it wrong",                     "you got it wrong"],
  ["dat nuh di answer",                  "that's not the answer"],
  ["dat nuh wah mi ask",                 "that's not what i asked"],
  ["mi nuh ask dat",                     "i didn't ask that"],
  ["u nuh answer mi question",           "you didn't answer my question"],
  ["answer mi question",                 "answer my question"],
  ["dat nuh helpful",                    "that's not helpful"],
  ["dat nuh help",                       "that doesn't help"],

  // ── Expressing uselessness ─────────────────────────────────────────────────
  ["u useless",                          "you're useless"],
  ["u nuh helpful",                      "you're not helpful"],
  ["u nah help mi",                       "you're not helping me"],
  ["u nuh helping",                      "you're not helping"],
  ["u cyan help mi",                     "you can't help me"],
  ["u nuh help mi",                      "you didn't help me"],
  ["u a waste",                          "you're a waste"],
  ["u a di worst",                       "you're the worst"],
  ["nutten nuh work",                    "nothing is working"],
  ["dis nuh work",                       "this isn't working"],
  ["nuh helpful at all",                 "not helpful at all"],

  // ── Agreement ─────────────────────────────────────────────────────────────
  ["yes dat",                            "yes that"],
  ["yeah dat",                           "yeah that"],
  ["dat right",                          "that's right"],
  ["dat correct",                        "that's correct"],
  ["exactly dat",                        "exactly that"],
  ["true dat",                           "that's true"],
  ["mi agree",                           "i agree"],
  ["dat make sense",                     "that makes sense"],
  ["mi understand",                      "i understand"],
  ["mi get it",                          "i get it"],

  // ── Reset and restart ──────────────────────────────────────────────────────
  ["mi wah start ova",                   "i want to start over"],
  ["start ova",                          "start over"],
  ["nuh mind",                           "never mind"],
  ["forget dat",                         "forget that"],

  // ── General conversational Patois ──────────────────────────────────────────
  ["mi deh yah",                         "i'm here"],
  ["everyting criss",                    "everything is fine"],
  ["nuh problem",                        "no problem"],
  ["mi appreciate it",                   "i appreciate it"],
  ["tank you",                           "thank you"],
  ["mi straight",                        "i'm fine"],
  ["mi aight",                           "i'm alright"],
  ["mi good",                            "i'm good"],
  ["nuh worry",                          "don't worry"],
  ["tanks",                              "thanks"],
  ["bless",                              "thank you"],
  ["respect",                            "thank you"],

  // ── Asking for help ────────────────────────────────────────────────────────
  ["can u help mi",                      "can you help me"],
  ["u can help mi",                      "can you help me"],
  ["mi need fi know",                    "i need to know"],
  ["wah should mi do",                   "what should i do"],
  ["explain to mi",                      "explain to me"],
  ["mi wah know",                        "i want to know"],
  ["mi need help",                       "i need help"],
  ["how mi fi",                          "how do i"],
  ["show mi",                            "show me"],
  ["tell mi",                            "tell me"],
  ["help mi",                            "help me"],
  ["wah fi do",                          "what to do"],
  ["how fi",                             "how to"],

  // ── Date / time uncertainty (Part 7) ──────────────────────────────────────
  ["mi cyaan remember",                  "i can't remember"],
  ["mi nuh remember",                    "i can't remember"],
  ["mi cyan recall",                    "i can't recall"],
  ["mi nuh recall",                      "i can't recall"],
  ["mi nuh memba",                     "i can't remember"],
  ["mi nuh sure when",                   "i'm not sure when"],
  ["di odda week",                       "the other week"],
  ["di odda day",                        "the other day"],
  ["nuh long ago",                       "not long ago"],
  ["round bout",                         "around"],
  ["couple weeks",                       "a couple of weeks"],
  ["couple days",                        "a couple of days"],
  ["long time ago",                      "a long time ago"],
  ["long time",                          "a long time ago"],
  ["sometime around",                    "sometime around"],
  ["mi forget",                          "i forgot"],

  // ── Negative states ────────────────────────────────────────────────────────
  ["sumn wrong wid mi",                  "something is wrong with me"],
  ["mi nuh know wah happen",             "i don't know what's happening"],
  ["mi feel sick bad",                   "i feel very sick"],
  ["mi nuh feel well",                   "i don't feel well"],
  ["mi stress out",                      "i'm stressed out"],
  ["mi tired bad",                       "i'm very tired"],
  ["mi cyan cope",                       "i can't cope"],
  ["mi give up",                         "i give up"],
  ["mi done",                            "i'm done"],
  ["mi vex",                             "i'm angry"],
  ["mi upset",                           "i'm upset"],
  ["mi frighten",                        "i'm scared"],

  // ── Vague / indirect health wording ─────────────────────────────────────────
  ["something feels off",          "i feel off unwell"],
  ["something is wrong",           "something is wrong with me unwell"],
  ["sumn wrong",                   "something is wrong with me unwell"],
  ["feel off",                     "feel unwell"],
  ["not right",                    "not feeling right unwell"],
  ["nuh feel right",               "not feeling right unwell"],
  ["it hurts there",               "pelvic pain"],
  ["hurts down there",             "pelvic pain lower abdomen"],
  ["pain down there",              "pelvic pain lower abdomen"],
  ["down deh hurting",             "pelvic pain lower abdomen"],
  ["something is coming out",      "unusual discharge"],
  ["sumn a come out",              "unusual discharge"],
  ["sumn coming out",              "unusual discharge"],
  ["it won't stop",                "bleeding won't stop continuing"],
  ["it nuh stop",                  "bleeding won't stop continuing"],
  ["i don't feel like myself",     "i feel sad low mood emotional"],
  ["i dont feel like myself",      "i feel sad low mood emotional"],
  ["mi nuh feel like miself",      "i feel sad low mood emotional"],
  ["my body feels weird",          "my body feels strange unwell"],
  ["mi body feel strange",         "my body feels strange unwell"],
  ["is this normal",               "seeking reassurance is this normal"],
  ["dat normal",                   "seeking reassurance is this normal"],
  ["is that normal",               "seeking reassurance is this normal"],

  // ── Time shorthand phrases ───────────────────────────────────────────────────
  ["lst wk",                       "last week"],
  ["lst mth",                      "last month"],
  ["bc pill",                      "birth control pill"],
  ["2ww",                          "two week wait"],


  // Sleep/fatigue expressions 
  ["cyaan sleep",            "can't sleep"],
  ["cya sleep",             "can't sleep"],
  ["tiyad",                "tired"],
  ["mi tired bad",         "i'm very tired"],
  ["mi weak out",         "i feel weak"],
  ["mi weak bad",         "i feel very weak"],

  //Perimenopause/menopause
  ["sweat up a night",     "night sweats"],
  ["just a sweat",         "i keep sweating"],
  ["hot flash tek mi", "i am having a hot flash"],
  ["memory gone", "brain fog"],


  //Seeking help / clinic phrases
  ["mi need help", "i need help"],
  ["mi need fi see doctor", "i need to see a doctor"],
  ["mi need fi go clinic", "i need to go to a clinic"],
  ["mi need fi go hospital", "i need to go to a hospital"],
  ["clinic open", "clinic is open"],
  ["clinic close", "clinic is closed"],
  ["weh di clinic deh", "where is the clinic"],
  ["mi cyaan afford doctor", "i cannot afford a doctor"]


  //Dismissive/minimising expressions
  ["it nuh dat serious", "it is not that serious"],
  ["it nuh dat bad", "it is not that bad"],
  ["mi alright still", "i am okay"],
  ["a nuttn", "it is nothing"],
  ["annuh nutn", "it is nothing"],

];



// ─── 2. WORD-LEVEL DICTIONARY ─────────────────────────────────────────────────
// Applied after phrase swaps, handles remaining Patois tokens.

const WORD_MAP = [
  // Pronouns / copulas
  ["mi",        "i"],
  ["wi",        "we"],
  ["dem",       "they"],
  ["im",        "him"],
  ["har",       "her"],
  ["fi",        "for"],
  ["di",        "the"],
  ["dat",       "that"],
  ["dis",       "this"],
  ["deh",       "there"],
  ["yah",       "here"],
  ["yuh",       "you"],
  ["nuh",       "no"],
  ["nah",       "not"],
  ["cyaan",     "cannot"],
  ["caan",      "cannot"],
  ["kinda",     "kind of"],
  ["inna",      "in"],
  ["outta",     "out of"],
  ["wid",       "with"],
  ["affi",      "have to"],
  ["haffi",     "have to"],
  ["suh",       "so"],
  ["soh",       "so"],
  ["likke",     "little"],
  ["likkle",    "little"],
  ["lil",       "little"],
  ["nuff",      "a lot of"],
  // FIX #1 & #3: Removed ["bad", "badly"] - it mapped "bad" universally,
  // breaking severity patterns like "bleed bad", "cramp bad", "hurt bad"
  // in both extractSymptoms and extractSeverity after normalization.
  // Severity signals are handled by phrase-level maps ("cramp bad" → "severe cramps")
  // and by extractSeverity's own regex patterns on the raw/normalized text.
  ["waan",      "want"],
  ["doan",      "do not"],
  ["dunno",     "do not know"],
  ["kno",       "know"],
  ["ting",      "thing"],
  ["tings",     "things"],
  ["nevah",     "never"],
  ["never",     "never"],
  ["come",      "come"],

  // Body / health terms
  ["belly",     "stomach"],
  ["batty",     "lower back"],
  ["waist",     "pelvic area"],
  ["blood",     "bleeding blood"],
  ["bleed",     "bleeding"],
  ["cramp",     "cramps"],
  ["period",    "period"],
  ["pregnant",  "pregnant"],
  ["breed",     "pregnant"],
  ["carry",     "pregnant"],
  ["spotting",  "spotting"],
  ["discharge", "discharge"],
  ["mood",      "mood"],
  ["dizzy",     "dizzy"],
  ["weak",      "weak"],
  ["faint",     "faint"],
  ["sick",      "sick"],
  ["pain",      "pain"],
  ["hurt",      "hurt"],
  ["clot",      "clots"],
  ["heavy",     "heavy"],
  ["late",      "late"],
  ["missed",    "missed"],

  // Extended reproductive health vocabulary
  // FIX #2: Removed duplicate ["breed", "pregnant"] that appeared here
  // in addition to the entry above in "Body / health terms".
  ["frighten",  "scared"],
  ["fraid",     "afraid scared"],
  ["shame",     "ashamed embarrassed"],
  ["worry",     "worried"],
  ["stress",    "stressed"],
  ["baby",      "baby infant"],
  ["breastfeed","breastfeeding"],
  ["fertile",   "fertile ovulation"],
  ["ovulate",   "ovulation"],
  ["coil",      "iud birth control"],
  ["implant",   "birth control implant"],
  ["months",    "months"],
  ["cycle",     "cycle"],
  ["irregular", "irregular"],
  ["absent",    "absent"],
  ["missing",   "missing"],

  // Medication-related tokens (residual after phrase-level processing)
  ["wah",       "what"],
  ["tek",       "take"],

  // ── Health shorthand abbreviations ───────────────────────────────────────────
  ["bfp",       "positive pregnancy test"],
  ["bfn",       "negative pregnancy test"],
  ["ewcm",      "egg white discharge cervical mucus"],
  ["ttc",       "trying to conceive"],
  ["dpo",       "days past ovulation"],
  ["hpt",       "pregnancy test"],
  ["opk",       "ovulation test"],
  ["lmp",       "last period"],
  ["bcp",       "birth control pill"],
  ["preg",      "pregnant"],
  ["preggo",    "pregnant"],
  ["prego",     "pregnant"],
  ["af",        "period"],
  ["pg",        "pregnant"],

  // ── Time shorthands ──────────────────────────────────────────────────────────
  ["2wks",      "2 weeks"],
  ["1wk",       "1 week"],
  ["3wks",      "3 weeks"],
  ["4wks",      "4 weeks"],
  ["2dys",      "2 days"],
  ["3dys",      "3 days"],
  ["1dy",       "1 day"],
  ["2mths",     "2 months"],
  ["1mth",      "1 month"],
  ["tmrw",      "tomorrow"],
  ["ystdy",     "yesterday"],

  // ── Internet slang (strip filler / normalize) ────────────────────────────────
  ["fr",        "for real"],
  ["ngl",       ""],
  ["tbh",       ""],
  ["omg",       "oh my"],
  ["wtf",       ""],
  ["lol",       "lol"],
  ["lmao",      ""],
  ["ugh",       ""],
  ["smh",       ""],
  ["bruh",      ""],
  ["bestie",    ""],
];

// ─── 3. FUZZY MATCHING (Damerau-Levenshtein + phonetic variants) ──────────────
//
// Pipeline for each user message token:
//   1. PHONETIC_VARIANTS lookup  - fast O(1), catches known Jamaican/Caribbean
//      spelling patterns that Levenshtein alone won't handle within threshold.
//   2. Exact-match check against FUZZY_DICTIONARY - skip correction if already correct.
//   3. Damerau-Levenshtein (OSA) - handles insertions, deletions, substitutions,
//      and adjacent transpositions. Threshold based on max(token, dictWord) length:
//        1-4 chars  → distance 0 (no fuzzy - "pad" must not match "pain")
//        5-7 chars  → distance ≤ 1
//        8-11 chars → distance ≤ 2
//        12+ chars  → distance ≤ 3
//   4. PROTECTED_TOKENS - valid Patois words, never corrected.
//   5. Correction cache - Map keyed on token, avoids re-running Levenshtein.
//
// fuzzyCorrect() is exported and handles both single-token and full-sentence input.
// When given a sentence (contains whitespace), it corrects each token independently
// and rejoins. Called explicitly AFTER normalizePatois() in the pipeline.

// ── Phonetic variants - run FIRST before Levenshtein ─────────────────────────
const PHONETIC_VARIANTS = {
  // Pregnancy
  "pregnat":        "pregnant",
  "pregnent":       "pregnant",
  "pragnant":       "pregnant",
  "pregnacy":       "pregnancy",
  "pregnency":      "pregnancy",
  "pegnancy":       "pregnancy",
  // Spotting
  "spotian":        "spotting",
  "spoting":        "spotting",
  "spottng":        "spotting",
  // Bleeding
  "bleding":        "bleeding",
  "bleading":       "bleeding",
  "bleedin":        "bleeding",
  "blleding":       "bleeding",
  // Discharge
  "disscharge":     "discharge",
  "dischage":       "discharge",
  "discharje":      "discharge",
  "discharg":       "discharge",
  // Panadol
  "panandol":       "panadol",
  "panadoll":       "panadol",
  "panaodl":        "panadol",
  "pnadol":         "panadol",
  "panadal":        "panadol",
  // Ibuprofen
  "ibupropen":      "ibuprofen",
  "ibuproffen":     "ibuprofen",
  "ibuprofin":      "ibuprofen",
  "ibruprofen":     "ibuprofen",
  "ibprofen":       "ibuprofen",
  // Ovulation
  "ovualtion":      "ovulation",
  "ovulaion":       "ovulation",
  "ovulaton":       "ovulation",
  "ovultion":       "ovulation",
  // Menstrual / menstruation
  "menstral":       "menstrual",
  "menstruel":      "menstrual",
  "menstrul":       "menstrual",
  "menstrall":      "menstrual",
  "mensural":       "menstrual",
  "menstration":    "menstruation",
  "mensturation":   "menstruation",
  "menstartion":    "menstruation",
  // Period
  "perriod":        "period",
  "priod":          "period",
  "peroid":         "period",
  "periood":        "period",
  "peirod":         "period",
  // Cramping
  "craming":        "cramping",
  // Nauseous / nauseating
  "nausous":        "nauseous",
  "nausious":       "nauseous",
  "nauseus":        "nauseous",
  "nausiating":     "nauseating",
  // Dizzy / dizziness
  "diszzy":         "dizzy",
  "dizy":           "dizzy",
  "dizzyness":      "dizziness",
  "dizyness":       "dizziness",
  // Endometriosis
  "endometrosis":   "endometriosis",
  "endometrisis":   "endometriosis",
  "endometrious":   "endometriosis",
  "endrometriosis": "endometriosis",
  // Polycystic
  "polycistic":     "polycystic",
  "polycitic":      "polycystic",
  // Fibroids
  "fibriods":       "fibroids",
  "fibrods":        "fibroids",
  "fiborids":       "fibroids",
  // Menopause / perimenopause
  "menapose":       "menopause",
  "menapause":      "menopause",
  "menopase":       "menopause",
  "menopaue":       "menopause",
  "perimenapose":   "perimenopause",
  "perimenapause":  "perimenopause",
  // Contraception
  "contraceptoin":  "contraception",
  "contraceptin":   "contraception",
  "contraseption":  "contraception",
  "contreception":  "contraception",
  // Chlamydia
  "chlamidia":      "chlamydia",
  "chlamedia":      "chlamydia",
  "clamydia":       "chlamydia",
  // Gonorrhea
  "gonorhea":       "gonorrhea",
  "gonorrea":       "gonorrhea",
  "gonnorhea":      "gonorrhea",
  // Syphilis
  "sifilis":        "syphilis",
  "syphillis":      "syphilis",
  // Vaginosis
  "vaginossis":     "vaginosis",
  "vaginoisis":     "vaginosis",
  // Infertility
  "inferility":     "infertility",
  // Implantation
  "implanation":    "implantation",
  "implantaion":    "implantation",
  // Miscarriage
  "miscarige":      "miscarriage",
  "miscarrige":     "miscarriage",
  // Ectopic
  "ectopik":        "ectopic",
  "ectoppic":       "ectopic",
};

// ── Fuzzy dictionary - organized by category ──────────────────────────────────
const FUZZY_DICTIONARY = {
  reproductive_core: [
    "spotting", "bleeding", "pregnant", "pregnancy", "period", "periods",
    "discharge", "cramps", "cramping", "ovulation", "ovulating", "nausea",
    "nauseous", "dizziness", "dizzy", "irregular", "menstrual", "menstruation",
    "cycle", "cycles", "hormones", "hormonal",
  ],
  anatomy: [
    "cervical", "cervix", "uterus", "uterine", "fallopian", "pelvic",
    "vaginal", "vagina", "ovarian", "ovaries", "endometrium", "placenta",
  ],
  conditions: [
    "endometriosis", "polycystic", "fibroids", "fibroid", "adenomyosis",
    "amenorrhea", "dysmenorrhea", "menopause", "perimenopause", "postpartum",
    "trimester", "implantation", "miscarriage", "ectopic",
  ],
  symptoms: [
    "bloating", "bloated", "fatigue", "exhausted", "insomnia", "anxiety",
    "depression", "irritability", "headache", "migraine", "constipation",
    "diarrhea", "heartburn", "swelling", "tenderness", "sensitivity",
  ],
  medications: [
    "panadol", "ibuprofen", "buscopan", "ponstan", "naproxen", "aspirin",
    "diclofenac", "tramadol", "voltaren", "clomid", "metformin", "provera",
    "primolut", "duphaston", "tranexamic", "norethisterone", "mefenamic",
    "paracetamol", "tylenol", "advil", "nurofen",
  ],
  contraception: [
    "contraception", "contraceptive", "condom", "implant", "injection",
    "abstinence", "fertile", "fertility", "infertility", "conception",
    "intercourse",
  ],
  sexual_health: [
    "chlamydia", "gonorrhea", "syphilis", "herpes", "vaginosis", "thrush",
    "infection", "bacterial", "inflammation",
  ],
  fertility_conception: [
    "ovulation", "conception", "fertile", "fertility", "infertility",
    "implantation", "embryo", "trimester", "gestation",
  ],
  emotional: [
    "emotional", "overwhelmed", "exhaustion", "concentration", "forgetful",
    "forgetfulness", "motivation",
  ],
  tracking: [
    "positive", "negative", "temperature", "tracking", "logging", "calendar",
  ],
  abbreviations: [
    "pcos", "iud", "sti", "std", "ttc",
  ],
};

// Deduplicated flat array and O(1) set for exact-match lookup
const ALL_FUZZY_TERMS_ARRAY = [...new Set(Object.values(FUZZY_DICTIONARY).flat())];
const ALL_FUZZY_TERMS = new Set(ALL_FUZZY_TERMS_ARRAY);

// ── Protected Patois tokens - must never be fuzzy-corrected ───────────────────
const PROTECTED_TOKENS = new Set([
  "mi", "di", "fi", "nuh", "wah", "yuh", "dem", "seh", "deh", "ting",
  "man", "gal", "bad", "good", "real",
]);

// ── Correction cache - avoids re-running Levenshtein for repeated tokens ──────
const _correctionCache = new Map();
let _cacheHits = 0;

/** Reset cache and hit counter (for testing). */
export function _resetFuzzyCache() { _correctionCache.clear(); _cacheHits = 0; }

/** Return cache hit count (for testing). */
export function _getFuzzyCacheHits() { return _cacheHits; }

// ── Damerau-Levenshtein distance (Optimal String Alignment) ───────────────────
// Handles insertions, deletions, substitutions, and adjacent transpositions.
// Transpositions cost 1 - this is why "peroid" → "period" now works (dist 1).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        // Adjacent transposition
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
        }
      }
    }
  }
  return dp[m][n];
}

// ── Threshold by max(token, dictWord) length ───────────────────────────────────
function getThreshold(maxLen) {
  if (maxLen <= 4)  return 0;  // no fuzzy - "pad" must not match "pain"
  if (maxLen <= 7)  return 1;
  if (maxLen <= 11) return 2;
  return 3;
}

// ── Internal single-token corrector ───────────────────────────────────────────
function _correctToken(token) {
  // 1. Phonetic variant lookup (known Jamaican/Caribbean patterns)
  const phonetic = PHONETIC_VARIANTS[token];
  if (phonetic !== undefined && phonetic !== token) {
    console.log(`[Bloomie Fuzzy] ${token} → ${phonetic} (phonetic)`);
    return phonetic;
  }

  // 2. Exact match in dictionary - already correct, no change needed
  if (ALL_FUZZY_TERMS.has(token)) return token;

  // 3. Levenshtein - only for tokens ≥ 5 chars (short words too collision-prone)
  if (token.length < 5) return null;

  let bestMatch = null;
  let bestDist = Infinity;
  const firstCode = token.charCodeAt(0);

  for (const term of ALL_FUZZY_TERMS_ARRAY) {
    // First-character filter: skip terms starting with a very different letter
    if (Math.abs(term.charCodeAt(0) - firstCode) > 2) continue;

    const maxLen = Math.max(token.length, term.length);
    const threshold = getThreshold(maxLen);
    if (threshold === 0) continue;

    // Length-difference filter - eliminates most comparisons immediately
    if (Math.abs(token.length - term.length) > threshold) continue;

    const dist = levenshtein(token, term);
    if (dist > 0 && dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestMatch = term;
    }
  }

  if (bestMatch) console.log(`[Bloomie Fuzzy] ${token} → ${bestMatch} (dist ${bestDist})`);
  return bestMatch;
}

/**
 * fuzzyCorrect(input) → String | null
 *
 * Medical-term spell correction using phonetic variants + Damerau-Levenshtein.
 *
 * Single-token mode (no whitespace):
 *   Returns the corrected spelling, or null if no close match found.
 *   Exact matches return the term itself. Protected Patois tokens return null.
 *
 * Sentence mode (input contains whitespace):
 *   Corrects each token independently and returns the full corrected sentence.
 *   Always returns a string (never null) in sentence mode.
 *
 * Threshold rules (based on max(token, dictWord) length):
 *   1-4 chars  → no fuzzy  |  5-7 → dist ≤ 1  |  8-11 → dist ≤ 2  |  12+ → dist ≤ 3
 *
 * Exported so it can be called after normalizePatois() in the pipeline and
 * tested directly in __tests__/bloomie-patois.test.js.
 */
export function fuzzyCorrect(input) {
  if (!input) return null;

  // ── Sentence mode ────────────────────────────────────────────────────────────
  if (/\s/.test(input)) {
    return input.trim().split(/\s+/).map(token => {
      if (!token) return token;
      if (PROTECTED_TOKENS.has(token)) return token;

      if (_correctionCache.has(token)) { _cacheHits++; return _correctionCache.get(token); }

      const result = _correctToken(token);
      const output = result ?? token;
      _correctionCache.set(token, output);
      return output;
    }).join(" ");
  }

  // ── Single-token mode ────────────────────────────────────────────────────────
  const token = input;
  if (token.length < 3) return null;
  if (PROTECTED_TOKENS.has(token)) return null;

  if (_correctionCache.has(token)) { _cacheHits++; return _correctionCache.get(token); }

  const result = _correctToken(token);
  _correctionCache.set(token, result);
  return result;
}

// ─── 4. INTENT BOOSTERS ───────────────────────────────────────────────────────
// After normalization, append extra scoring keywords for patterns that are
// hard to capture with word-swaps alone.

const INTENT_BOOSTERS = [
  {
    patterns: [/period.*not.*come|period.*late|missed.*period|\bno\b.*period/i],
    boost: " late missed period",
  },
  {
    // NOTE: boost must NOT include "pain" - combined with "severe" it triggers
    // extractUrgency's severe.*pain pattern causing false escalation.
    patterns: [/cramp|pelvic pain|stomach pain|belly pain|lower abdom/i],
    boost: " cramp pelvic",
  },
  {
    patterns: [/spotting|light bleed|brown discharge|pink discharge/i],
    boost: " spotting light stain",
  },
  {
    // NOTE: "missed period" removed from boost - it activated sym.late prematurely,
    // causing the late+pregnancy combo rule to fire before spotting+pregnancy rules.
    patterns: [/pregnant|pregnancy|positive test|might be pregnant/i],
    boost: " pregnant pregnancy",
  },
  {
    patterns: [/heavy bleed|soaking through|bleed through|passing clots/i],
    boost: " heavy bleeding soaking",
  },
  {
    patterns: [/mood|irritable|anxious|sad|overwhelmed|low mood|cry/i],
    boost: " mood anxious sad irritable",
  },
  {
    // NOTE: boost must NOT include "faint" - it is in extractUrgency's regex and
    // causes false escalation when the user only mentions weakness (not fainting).
    // "dizziness" and "lightheaded" are NOT urgency keywords so they are safe.
    patterns: [/faint|dizzy|lightheaded|pass out/i],
    boost: " dizzy lightheaded",
  },
  {
    // Amenorrhea - periods missing for extended time
    patterns: [/amenorrhea|period.*months|months.*period|period.*stopped|period.*absent|not.*had.*period|missed.*more.*period|period.*gone/i],
    boost: " amenorrhea missing period months absent",
  },
  {
    // TTC - trying to conceive context
    patterns: [/trying to conceive|ttc|trying to get pregnant|want.*pregnant|fertile days|ovulation.*test/i],
    boost: " ttc trying to conceive ovulation fertile",
  },
  {
    // Postpartum context
    patterns: [/postpartum|gave birth|had.*baby|after.*baby|breastfeeding|period.*return/i],
    boost: " postpartum after birth breastfeeding",
  },
  {
    // Lifestyle change signals that delay periods
    patterns: [/stressed|stress|lost weight|gained weight|exercise.*intense|intensely|been sick|illness|travel|sleep.*poor|not sleeping/i],
    boost: " lifestyle change stress weight exercise",
  },
  {
    // Birth control context
    patterns: [/birth control|on the pill|started pill|stopped pill|iud|implant|coil|bc/i],
    boost: " birth control pill contraception",
  },
  {
    // Emotional distress / fear
    patterns: [/scared|afraid|worried|ashamed|embarrassed|frightened|fear|nervous.*about.*health/i],
    boost: " scared worried emotional distress",
  },
];

// ─── 5. MAIN EXPORT: normalizePatois ─────────────────────────────────────────

/**
 * normalizePatois(rawText) → String
 *
 * Full 4-stage preprocessing pipeline:
 *   Stage 1: Phrase-level exact matching
 *   Stage 2: Word-level exact matching
 *   Stage 3: Fuzzy matching (Levenshtein) for near-miss Patois tokens
 *   Stage 4: Intent boosters
 *
 * @param  {string} rawText  - Raw text from the chat input
 * @returns {string}          - Normalized English text
 */
export function normalizePatois(rawText) {
  if (!rawText) return rawText;

  let text = rawText.toLowerCase().trim();

  // Collapse repeated characters: "helpppppp" → "help", "noooooo" → "no"
  // Runs before all stages so the phrase/word maps see the cleaned form.
  const _preCollapse = text;
  text = text.replace(/(.)\1{3,}/g, '$1');
  if (text !== _preCollapse) {
    console.log(`[Bloomie Input] collapsed: "${_preCollapse}" → "${text}"`);
  }

  // Build a set of tokens that will be resolved by exact matching (Stages 1-2)
  // so Stage 3 knows which tokens to skip.
  const exactMatchedTokens = new Set();

  // ── Stage 1: phrase-level replacements ────────────────────────────────────
  for (const [patois, english] of PHRASE_MAP) {
    const rx = new RegExp(escapeRegex(patois), "gi");
    if (rx.test(text)) {
      // Mark all tokens of this phrase as already handled
      patois.split(/\s+/).forEach((w) => exactMatchedTokens.add(w));
      text = text.replace(new RegExp(escapeRegex(patois), "gi"), english);
    }
  }

  // ── Stage 2: word-level replacements ─────────────────────────────────────
  for (const [patois, english] of WORD_MAP) {
    const rx = new RegExp(`\\b${escapeRegex(patois)}\\b`, "gi");
    if (rx.test(text)) {
      exactMatchedTokens.add(patois);
      text = text.replace(new RegExp(`\\b${escapeRegex(patois)}\\b`, "gi"), english);
    }
  }

  // ── Stage 3: medical spell correction ────────────────────────────────────
  // fuzzyCorrect() is called here as part of the normalizePatois pipeline so
  // that tests and internal callers get a fully-corrected result in one step.
  // assistant.js also calls it explicitly after normalizePatois() per the
  // canonical pipeline order (normalizePatois → fuzzyCorrect → extractEntities).
  text = fuzzyCorrect(text) ?? text;

  // ── Stage 4: intent boosters ──────────────────────────────────────────────
  for (const booster of INTENT_BOOSTERS) {
    if (booster.patterns.some((rx) => rx.test(text))) {
      text += booster.boost;
    }
  }

  return text;
}

/**
 * detectPatois(rawText) → Boolean
 *
 * Quick check: does this text look like it contains Patois?
 * Useful for logging / analytics or showing a "Patois mode" indicator in UI.
 *
 * @param  {string} rawText
 * @returns {boolean}
 */
export function detectPatois(rawText) {
  if (!rawText) return false;
  const t = rawText.toLowerCase();

  const PATOIS_SIGNALS = [
    /\bmi\b/, /\bnuh\b/, /\bnah\b/, /\bcyaan\b/, /\bcaan\b/,
    /\byuh\b/, /\bwid\b/, /\bdem\b/, /\binna\b/, /\bwaan\b/,
    /\baffi\b/, /\bhaffi\b/, /\blikkle\b/, /\bnuff\b/,
    /\bwah gwaan\b/, /\bwagwaan\b/, /\bwha gwan\b/,
    /\bbelly a\b/, /\bwaist a\b/, /a bleed\b/,
  ];

  return PATOIS_SIGNALS.some((rx) => rx.test(t));
}

// ── Tone pattern arrays - each entry is one detectable signal ─────────────────
// Checking arrays (not a single combined regex) lets us COUNT how many signals
// are present per category. The priority resolver then picks the highest-priority
// category that has at least one match, resolving overlaps cleanly.
//
// Patterns are tested against BOTH raw text (so Patois signals are intact) AND
// normalizePatois() output (so mixed Patois/English messages are handled).
// Priority: distressed > angry > exhausted > frustrated > casual > neutral

const DISTRESS_PATTERNS = [
  /\b(scared|freaking out)\b/,
  /\b(don'?t know what to do|do not know what to do|mi nuh know wah fi do)\b/,
  /\b(worried|stress(?:ed)? out|mi stress|a worry mi)\b/,
  /\b(frightened|terrified|panic(?:king)?)\b/,
  /\b(nuh know wah do|what do i do|i don'?t know anymore)\b/,
  /\b(lost|confused and scared)\b/,
  /\b(something(?:'s)? wrong|sumn wrong|feel(?:ing)? like something(?:'s)? wrong)\b/,
  /\b(help me)\b/,
  /\b(upset|mi so upset)\b/,           // upset → distressed (not angry)
];

const ANGRY_PATTERNS = [
  /\b(vex|mi vex|so vex)\b/,
  /\b(mad|angry|furious)\b/,
  /\b(pissed(?: off)?)\b/,
  /\b(frustrated bad)\b/,
  /\b(annoyed|tick(?:ed)? off)\b/,
  /\b(this is ridiculous|unfair|not fair|why me|nuh fair)\b/,
  /\b(mi so mad)\b/,
  /\b(blood\s*claat|bombo\s*claat|bomboclaat|rahtid)\b/, // Patois expletives → angry signal
];

const EXHAUSTED_PATTERNS = [
  /\b(me cya bada|cyan bada|mi cya bada|can'?t be bothered)\b/,
  /\b(feel(?:ing)? done out|mi feel done out)\b/,
  /\b(drained|no energy|exhausted|too tired)\b/,
  /\b(can'?t deal|cyan deal)\b/,
  /\b(feel(?:ing)? like giving up|running on empty)\b/,
  /\b(burnt? out|nuh have no energy)\b/,
  /\b(feel(?:ing)? weak|body tired|mi body tired)\b/,
  // "mi done" = exhausted; "mi done wid dis" = frustrated - negative lookahead separates them
  /\bmi done(?!\s+wid)\b/,
];

const FRUSTRATED_PATTERNS = [
  /\b(again|still happening|why does this keep)\b/,
  /\b(every time|always|sick and tired|sick of this)\b/,
  /\b(this keeps|nuh stop|mi tired of)\b/,
  /\b(every single|not again|happening again|keeps happening)\b/,
  /\b(i give up|pointless|waste of time|nothing works)\b/,
  /\b(nutten nuh work|mi done wid dis)\b/,
];

// "mi weak" is Patois laughing slang (≈ "I'm dead"), NOT a fatigue signal.
// It lives only in casual. Weighted matching ensures that if exhaustion phrases
// also appear in the same message, exhausted wins by priority.
const CASUAL_PATTERNS = [
  /\b(lol|lmao+|omg|fr)\b/,
  /\b(ugh+|haha+)\b/,
  /\b(no way|wait what)\b/,
  /\b(dead+|mi weak)\b/,
  /\b(bruh|bro\b|sis\b|bestie)\b/,
  /\b(ngl|tbh|idk|idc)\b/,
  /[\u{1F602}\u{1F923}]/u,             // 😂 🤣
];

/**
 * detectUserToneWithScores(text) → { tone, scores, confidence }
 *
 * Internal helper that returns the per-category match counts alongside the
 * resolved tone. Exported so updateSessionTone() and tests can inspect scores.
 *
 * confidence = true when resolved tone has 2+ phrase matches, OR when a single
 * strong distressed/angry/exhausted/frustrated signal fires (serious tones are
 * always considered confident - a single "scared" or "vex" is unambiguous).
 *
 * @param  {string} text - Raw user input
 * @returns {{ tone: string, scores: object, confidence: boolean }}
 */
export function detectUserToneWithScores(text) {
  if (!text) return { tone: "neutral", scores: {}, confidence: false };

  const t = text.toLowerCase();
  // Normalize for mixed Patois/English support - checked alongside raw text
  const tn = normalizePatois(text).toLowerCase();

  // Test a pattern against both raw and normalized text
  const hit = (rx) => rx.test(t) || rx.test(tn);

  const scores = {
    distressed:  DISTRESS_PATTERNS.filter(hit).length,
    angry:       ANGRY_PATTERNS.filter(hit).length,
    exhausted:   EXHAUSTED_PATTERNS.filter(hit).length,
    frustrated:  FRUSTRATED_PATTERNS.filter(hit).length,
    casual:      CASUAL_PATTERNS.filter(hit).length,
  };

  // Priority: distressed > angry > exhausted > frustrated > casual > neutral.
  // A single match is enough for any serious tone - "lol I'm scared" → distressed.
  const SERIOUS = ["distressed", "angry", "exhausted", "frustrated"];
  for (const tone of SERIOUS) {
    if (scores[tone] >= 1) {
      return { tone, scores, confidence: scores[tone] >= 2 };
    }
  }

  // Casual: keyword match OR short message length - but ONLY when no serious
  // tones were detected anywhere in the message. Fixes: "help me" (short but
  // distressed), short urgent messages under 40 chars staying distressed.
  const hasShortLength = t.trim().length <= 40;
  if (scores.casual >= 1 || hasShortLength) {
    return { tone: "casual", scores, confidence: scores.casual >= 2 };
  }

  return { tone: "neutral", scores, confidence: false };
}

/**
 * detectUserTone(text) → 'distressed' | 'angry' | 'exhausted' | 'frustrated' | 'casual' | 'neutral'
 *
 * Reads the emotional register of a single user message and returns one of six
 * tone tokens. Bloomie uses this to prepend a contextually warm opener before
 * its substantive response.
 *
 * Priority: distressed > angry > exhausted > frustrated > casual > neutral.
 * Runs normalizePatois() internally so mixed Patois/English messages are handled.
 * Short message length is a weak casual signal only - it never overrides a
 * distressed, angry, exhausted, or frustrated match.
 *
 * @param  {string} text  - Raw user input
 * @returns {'distressed'|'angry'|'exhausted'|'frustrated'|'casual'|'neutral'}
 */
export function detectUserTone(text) {
  return detectUserToneWithScores(text).tone;
}

/**
 * updateSessionTone(ctx, text) → string
 *
 * Updates ctx.currentTone and ctx.previousTone based on a new message.
 * Applies session tone stability: if the new detection is ambiguous (neutral
 * or low confidence), blend toward the previous tone rather than swinging
 * abruptly. Only fully updates ctx.currentTone when detection is confident
 * (2+ phrase matches or any single serious-tone match from this session).
 *
 * @param  {object} ctx  - Session context with currentTone / previousTone fields
 * @param  {string} text - Raw user input
 * @returns {string}       The resolved tone for this turn
 */
export function updateSessionTone(ctx, text) {
  const { tone, confidence } = detectUserToneWithScores(text);

  ctx.previousTone = ctx.currentTone;

  if (tone === "neutral" || (!confidence && tone === "casual")) {
    // Ambiguous turn - hold the previous tone if one exists
    ctx.currentTone = ctx.previousTone || tone;
  } else {
    ctx.currentTone = tone;
  }

  return ctx.currentTone;
}

// ─── 5. PIPELINE STAGE HELPERS (exported for explicit use in assistant.js) ───
//
// These are extracted as named exports so assistant.js can call each stage
// explicitly in the documented pipeline order and debugPipeline() can log
// each intermediate result.

/**
 * collapseRepeatedLetters(text) → string
 *
 * Collapses runs of 4+ identical consecutive characters to a single instance.
 * "helpppppp" → "help", "noooooo" → "no", "sooooo bad" → "so bad".
 * This is the same logic normalizePatois() applies internally, exposed as a
 * standalone export so assistant.js can invoke and log it as an explicit step.
 *
 * @param  {string} text
 * @returns {string}
 */
export function collapseRepeatedLetters(text) {
  if (!text) return text;
  return String(text).replace(/(.)\1{3,}/g, "$1");
}

/**
 * expandShorthand(text) → string
 *
 * Expands health/time shorthand abbreviations that the WORD_MAP already
 * handles inside normalizePatois(). Exposed as a standalone export so
 * assistant.js can call it explicitly as pipeline step 6 and so
 * debugPipeline() can log the result after fuzzyCorrect and before
 * extractEntities.
 *
 * Covered abbreviations (whole-word, case-insensitive):
 *   2wks → 2 weeks   |  ewcm → egg white discharge cervical mucus
 *   bfp  → positive pregnancy test  |  bfn → negative pregnancy test
 *   ttc  → trying to conceive       |  dpo → days past ovulation
 *   hpt  → pregnancy test           |  opk → ovulation test
 *   lmp  → last period              |  bcp → birth control pill
 *   2ww  → two week wait            |  bc pill → birth control pill
 *
 * @param  {string} text
 * @returns {string}
 */
export function expandShorthand(text) {
  if (!text) return text;
  let t = String(text);
  const SHORTHANDS = [
    [/\bewcm\b/gi,    "egg white discharge cervical mucus"],
    [/\bbfp\b/gi,     "positive pregnancy test"],
    [/\bbfn\b/gi,     "negative pregnancy test"],
    [/\bttc\b/gi,     "trying to conceive"],
    [/\bdpo\b/gi,     "days past ovulation"],
    [/\bhpt\b/gi,     "pregnancy test"],
    [/\bopk\b/gi,     "ovulation test"],
    [/\blmp\b/gi,     "last period"],
    [/\bbcp\b/gi,     "birth control pill"],
    [/\baf\b/gi,      "period"],
    [/\bpg\b/gi,      "pregnant"],
    [/\b2ww\b/gi,     "two week wait"],
    [/\b2wks?\b/gi,   "2 weeks"],
    [/\b1wk\b/gi,     "1 week"],
    [/\b3wks?\b/gi,   "3 weeks"],
    [/\b4wks?\b/gi,   "4 weeks"],
    [/\b2dys?\b/gi,   "2 days"],
    [/\b3dys?\b/gi,   "3 days"],
    [/\b1dy\b/gi,     "1 day"],
    [/\b2mths?\b/gi,  "2 months"],
    [/\b1mth\b/gi,    "1 month"],
    [/\btmrw\b/gi,    "tomorrow"],
    [/\bystdy\b/gi,   "yesterday"],
    [/\blst wk\b/gi,  "last week"],
    [/\blst mth\b/gi, "last month"],
    [/\bbc pill\b/gi, "birth control pill"],
  ];
  for (const [rx, replacement] of SHORTHANDS) {
    t = t.replace(rx, replacement);
  }
  return t;
}

// ─── INTERNAL HELPER ─────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}