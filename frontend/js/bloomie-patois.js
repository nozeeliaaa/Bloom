// ─── 1. PHRASE-LEVEL DICTIONARY ───────────────────────────────────────────────

const PHRASE_MAP = [
  // ── Greetings ──────────────────────────────────────────────────────────────
  ["wah gwan",           "hello"],
  ["wah gwaan",          "hello"],
  ["wagwaan",            "hello"],
  ["wha gwan",           "hello"],
  ["wha di scene",       "hello"],
  ["ow yuh stay",        "how are you"],
  ["how yuh deh",        "how are you"],
  ["irie",               "okay"],
  ["yo",                 "hello"],
  ["wahpm",              "hello"],
  ["good mawnin",        "good morning"],
  ["good evenin",        "good evening"],
  ["good night",         "good night"],
  

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
  ["mi a pass clot",                  "passing clots"],
  ["mi a pass nuff clot",             "passing many clots"],
  ["nuff clot",                    "passing many clots"],
  ["mi period early",                "my period came early"],
  ["period come early",              "period came early"],
  ["mi period come too soon",        "my period came too early"],
  ["cycle change up",                "my cycle changed"],
  ["mi cycle change up",             "my cycle changed"],
  ["mi cycle strange",               "my cycle is unusual"],
  ["mi period delay",                "my period is delayed"],
  ["period delay",                   "period is delayed"],
  ["period skip",                    "missed period"],
  ["mi skip mi period",              "i missed my period"],
  ["mi period missing",              "my period is missing"],

  // ── Pregnancy //
  ["mi feel like mi pregnant",      "i think i might be pregnant"],
  ["mi think mi a carry",           "i think i might be pregnant"],
  ["mi a carry",                    "i might be pregnant"],
  ["mi belly get big",              "my stomach is getting bigger"],
  ["mi belly a get big",            "my stomach is getting bigger"],
  ["mi test come back positive",    "my pregnancy test was positive"],
  ["test come back positive",       "pregnancy test positive"],
  ["test come positive",            "pregnancy test positive"],
  ["test come negative",            "pregnancy test negative"],
  ["test come back negative",       "pregnancy test was negative"],
  ["mi did have sex",               "i had unprotected sex"],
  ["mi did sleep wid someone",      "i had sex"],
  ["him breed mi",                  "i might be pregnant"],
  ["mi think mi breed",             "i think i might be pregnant"],
  ["mi belly feel funny",            "possible pregnancy symptoms"],
  ["mi breast sore bad",             "breast tenderness"],
  ["mi breast hurt",                 "breast tenderness"],
  ["mi tired bad lately",            "fatigue"],
  ["mi feel nauseous",               "nausea"],
  ["mi feel like vomit",             "nausea"],
  ["mi a throw up",                  "vomiting nausea"],
  ["food turn mi stomach",           "nausea"],
  ["mi appetite change",             "appetite changes"],
  ["mi body feel different",         "body feels different possible pregnancy"],
  ["mi just a vomit suh",            "vomiting nausea"],
  ["mi just a throw up suh",           "vomiting nausea"],


  // ── Pain / cramps ──────────────────────────────────────────────────────────
  ["mi belly a hurt mi bad",        "i have severe stomach pain"],
  ["mi belly a kill mi",            "i have severe stomach pain"],
  ["mi belly a murder mi",          "i have very severe stomach pain"],
  ["mi belly a crap mi",            "i have severe cramps"],
  ["mi belly a murda mi",           "i have very severe cramps"],
  ["mi belly a cramp bad",          "i have severe cramps"],
  ["mi belly a cramp",              "i have cramps"],
  ["mi belly a hurt",               "i have stomach pain"],
  ["belly a hurt",                  "stomach pain cramps"],
  ["belly hurt bad",                "severe stomach pain"],
  ["waist a hurt",                  "lower back and pelvic pain"],
  ["mi waist a hurt",               "i have pelvic pain"],
  ["bottom belly a hurt",           "lower abdominal pain"],
  ["mi bottom belly a hurt",        "i have lower abdominal pain cramps"],
  ["cramp bad",                     "severe cramps"],
  ["pain bad",                      "severe pain"],
  ["pain a kill mi",                "severe pain"],
  ["hurt bad",                      "severe pain"],
  ["nuff pain",                     "a lot of pain"],
  ["mi a feel nuff pain",           "i have a lot of pain"],
  ["mi belly twist up",              "severe cramps"],
  ["mi belly tight bad",             "severe cramps"],
  ["mi belly squeeze",               "cramps"],
  ["belly squeeze bad",              "severe cramps"],
  ["mi stomach twist",               "cramps stomach pain"],
  ["mi stomach tight",               "stomach cramps"],
  ["mi stomach a knot up",           "severe stomach cramps"],
  ["mi belly mash up",               "severe stomach pain"],
  ["mi belly a mash up",             "severe stomach pain"],
  ["mi belly a mash mi",             "severe stomach pain"],
  ["mi belly a mash up bad",         "very severe stomach pain"],
  ["mi belly a mash mi bad",         "very severe stomach pain"],
  ["mi belly a burn",                "burning stomach pain"],
  ["mi belly a burn mi",             "burning stomach pain"],
  ["mi back hurt bad",               "severe back pain pelvic pain"],


  // ── Heavy bleeding variations ───────────────────────────────────────────────
  ["blood a run heavy",              "heavy bleeding"],
  ["blood run plenty",               "heavy bleeding"],
  ["mi bleeding plenty",             "heavy bleeding"],
  ["blood a gush",                   "heavy bleeding"],
  ["blood a pour out",               "heavy bleeding"],
  ["mi pad soak quick",              "soaking through pad quickly"],
  ["pad full quick",                 "soaking through pad quickly"],
  ["tampon full quick",              "soaking through tampon quickly"],
  ["bleeding non stop",              "continuous bleeding"],
  ["blood nah stop",                 "continuous bleeding"],
  ["me a bleed nuff",                "bleeding a lot"],
  ["bleed nuff",                    "bleeding a lot"],
  ["blood a run nuff",              "bleeding a lot"],
  ["blood a run heavy",              "heavy bleeding"],
  ["blood run plenty",               "heavy bleeding"],


  // ── Spotting ───────────────────────────────────────────────────────────────
  ["likkle blood a come",           "light spotting bleeding"],
  ["likkle bit a blood",            "light spotting"],
  ["likkle spotting",               "light spotting"],
  ["brown discharge",               "brown spotting discharge"],
  ["pink discharge",                "pink spotting discharge"],
  ["blood between period",          "spotting between periods"],
  ["blood inna the middle a cycle",  "spotting between periods"],
  ["spot middle a cycle",            "spotting between periods"],
  ["blood after period done",        "spotting after period"],
  ["blood before period start",      "spotting before period"],
  ["blood when mi wipe",             "light spotting"],
  ["blood pon tissue",               "light spotting"],
  ["likkle blood pon paper",         "light spotting"],
  ["mi see blood likkle bit",        "light spotting"],
  ["blood just likkle",              "light spotting"],
  ["blood only when wipe",           "light spotting"],


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
  ["mi cya bada",                   "i cannot do it"],
  ["mi a dead",                     "i feel very bad"],
  ["mi a go dead",                  "i feel very bad"],
  ["mi mood funny",                  "mood changes"],
  ["mi mood off",                    "mood changes"],
  ["mi mood up an down",             "mood swings"],
  ["mi mood all over di place",      "mood swings"],
  ["mi temper short",                "irritable mood"],
  ["mi vex quick",                   "irritable mood"],
  ["mi get vex quick",               "irritable mood"],
  ["mi snap easy",                   "irritable mood"],
  ["mi snap pon everybody",          "irritable mood"],
  ["mi angry fi everything",         "irritable mood"],
  ["mi cry easy lately",             "crying easily mood changes"],
  ["mi cry over everything",         "crying easily mood changes"],
  ["mi bawl fi likkle things",       "crying easily mood changes"],
  ["mi emotional bad",               "emotional mood changes"],
  ["mi sensitive bad",               "emotional mood changes"],
  ["mi mind heavy",                  "low mood"],
  ["mi mind dark",                   "low mood"],
  ["mi feel low",                    "low mood"],
  ["mi feel down",                   "low mood"],
  ["mi spirit low",                  "low mood"],
  ["mi head hot",                    "irritable mood"],
  ["mi head hot bad",                "very irritable mood"],
  ["mi head mash up",                "mental stress"],
  ["mi head full",                   "mental stress"],
  ["mi brain tired",                 "mental fatigue"],
  ["mi stress bad",                  "stress anxiety"],
  ["mi stress out",                  "stress anxiety"],
  ["mi worry too much",              "anxiety"],
  ["mi mind nah rest",               "anxiety"],
  ["mi tired bad",                   "fatigue low energy"],
  ["mi pop dung bad",                 "fatigue"],
  ["mi energy low",                 "low energy fatigue"],
  ["mi body feel weak",               "fatigue"],
  ["mi body weak bad",              "severe fatigue"],
  ["mi body pop dung",                 "fatigue"],
  ["mi energy low bad",              "low energy fatigue"],
  ["mi feel drain",                  "fatigue"],
  ["mi feel exhausted",              "fatigue"],
  ["mi just a cry suh",              "crying easily mood changes"],
  ["mi just a bawl suh",              "crying easily mood changes"],
  ["mi just a weep suh",              "crying easily mood changes"],
  ["mi body feel tired",             "fatigue"],
  ["mi body tired bad",              "severe fatigue"],
  ["mi body tired",                  "fatigue"],
  ["mi body weak",                   "fatigue"],
  ["mi cya deal wid people",         "irritable mood"],
  ["mi cya manage today",            "low mood fatigue"],
  ["mi nah inna di mood",            "low mood"],
  ["mi just feel off",               "mood changes"],
  ["mi body feel strange",           "mood changes"],
  ["mi head hot fi real",            "very irritable mood"],
  ["mi cya deal wid nobody",         "irritable mood"],
  ["mi vex fi no reason",            "irritable mood"],
  ["mi cry fi everything lately",    "crying easily mood changes"],
  ["mi feel like mi going crazy",    "severe mood changes"],
  

  // ── Dizziness / fainting ───────────────────────────────────────────────────
  ["mi feel like mi a go faint",    "i feel like i am going to faint"],
  ["mi did faint",                  "i fainted"],
  ["mi nearly faint",               "i almost fainted"],
  ["mi pass out",                   "i passed out fainted"],
  ["mi head feel light",            "i feel lightheaded dizzy"],
  ["mi head swim",                  "i feel dizzy lightheaded"],

  // ── Discharge ──────────────────────────────────────────────────────────────
  ["something a come from mi",      "unusual discharge"],
  ["white something a come",        "white discharge"],
  ["smelly discharge",              "discharge with odor"],
  ["it smell funny",                "discharge with odor"],
  ["it have a smell",               "discharge with odor"],
  ["something wet a come out",        "unusual discharge"],
  ["wetness a come from mi",          "unusual discharge"],
  ["likkle wet stuff a come",         "light discharge"],
  ["white stuff a come out",          "white discharge"],
  ["white something a come from mi",  "white discharge"],
  ["milky stuff a come out",          "milky discharge"],
  ["clear stuff a come out",          "clear discharge"],
  ["clear something a come",          "clear discharge"],
  ["sticky stuff a come",             "sticky discharge"],
  ["thick stuff a come",              "thick discharge"],
  ["stringy stuff a come",            "stringy discharge"],
  ["clumpy stuff a come",             "clumpy discharge"],
  ["curd like stuff",                 "clumpy discharge"],
  ["cheese like stuff",               "clumpy discharge"],
  ["likkle wet pon mi underwear",     "light discharge"],
  ["mi underwear wet",                "discharge"],
  ["mi panty wet",                    "discharge"],
  ["something deh pon mi panty",      "discharge"],
  ["it smell strong",                 "discharge with odor"],
  ["it smell bad",                    "discharge with odor"],
  ["it smell weird",                  "discharge with odor"],
  ["mi smell something strange",      "discharge with odor"],
  ["mi notice a smell",               "discharge with odor"],
  ["yellow stuff a come",             "yellow discharge"],
  ["green stuff a come",              "green discharge"],
  ["grey stuff a come",               "grey discharge"],
  ["brown stuff a come",              "brown discharge"],
  ["discharge thick bad",             "thick discharge"],
  ["discharge heavy",                 "heavy discharge"],
  ["nuff discharge",                  "heavy discharge"],
  ["plenty discharge",                "heavy discharge"],
  ["something a run out",            "unusual discharge"],
  ["something a leak",               "unusual discharge"],
  ["likkle something a run out",       "light discharge"],

  // ── General / uncertainty ──────────────────────────────────────────────────
  ["mi nuh know wah wrong wid mi",  "i do not know what is wrong with me"],
  ["something wrong wid mi",        "something is wrong"],
  ["mi body a act up",              "my body is acting strangely"],
  ["mi nuh feel good",              "i do not feel well"],
  ["mi feel off",                   "i feel off unwell"],
  ["mi sick",                       "i feel sick unwell"],
  ["mi nah feel right",             "i do not feel right"],
  ["sumn nuh feel right",            "something is wrong"],
];

// ─── 2. WORD-LEVEL DICTIONARY ─────────────────────────────────────────────────

const WORD_MAP = [
  // Pronouns 
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
  ["bad",       "badly"],       
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
];

// ── Conversational / slang markers (non-medical) ───────────────────────────

const CONVERSATION_MARKERS = [

  // emphasis / tone
  ["kmt", ""],
  ["kmt.", ""],
  ["lawd", "oh my"],
  ["lawd jesus", "oh my"],
  ["jah jah", "oh my"],
  ["no sah", "no"],
  ["ee", "yes"],

  // conversational reactions
  ["mi dear", "oh wow"],
  ["me dear", "oh wow"],
  ["mi love", "friend"],
  ["enu", "you all"],
  ["pon", "on"],
  ["link", "talk"],
  ["pree", "look"],
  ["ypree", "look"],

  // expressions
  ["deggeh deggeh", "messy situation"],
  ["fass", "nosy"],
  ["a wah", "what is this"],
  ["ukku", "very"],
  
  // uncertainty
  ["mi nuh knw", "i do not know"],
  ["mi nuh know", "i do not know"],
];
// ─── 3. INTENT BOOSTERS ───────────────────────────────────────────────────────

const INTENT_BOOSTERS = [
  {
    patterns: [/period.*not.*come|period.*late|missed.*period|no.*period/i],
    boost: " late missed period",
  },
  {
    patterns: [/cramp|pelvic pain|stomach pain|belly pain|lower abdom/i],
    boost: " cramp pelvic pain",
  },
  {
    patterns: [/spotting|light bleed|brown discharge|pink discharge/i],
    boost: " spotting between periods",
  },
  {
    patterns: [/pregnant|pregnancy|positive test|might be pregnant/i],
    boost: " pregnant missed period",
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
    patterns: [/faint|dizzy|lightheaded|weak|pass out/i],
    boost: " faint dizzy weak",
  },
];

// ─── 4. MAIN EXPORT: normalizePatois ─────────────────────────────────────────

/**
 * normalizePatois(rawText) → String
 *
 * Takes raw user input (Patois, English, or code-switched) and returns a
 * normalized English string suitable for Bloomie's existing scoring engine.
 *
 * @param  {string} rawText  - Raw text from the chat input
 * @returns {string}          - Normalized English text (preserves original words
 *                              not in dictionary, so code-switching works fine)
 */
export function normalizePatois(rawText) {
  if (!rawText) return rawText;

  let text = rawText.toLowerCase().trim();

  // Step 1: phrase-level replacements (longest-match first via order in array)
  for (const [patois, english] of PHRASE_MAP) {
    text = text.replace(new RegExp(escapeRegex(patois), "gi"), english);
  }

  // Step 2: word-level replacements (whole-word only)
  for (const [patois, english] of WORD_MAP) {
    text = text.replace(new RegExp(`\\b${escapeRegex(patois)}\\b`, "gi"), english);
  }

  // Step 3: intent boosters — append extra scoring keywords
  for (const booster of INTENT_BOOSTERS) {
    if (booster.patterns.some((rx) => rx.test(text))) {
      text += booster.boost;
    }
  }

  return text;
}

/**
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

// ─── INTERNAL HELPER ─────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}