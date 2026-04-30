import symptomCatalog from "../../backend/data/symptoms.json";

// Bloomie symptom catalog helper.
// Single source of truth: backend/data/symptoms.json
//
// Temporary aliases below exist only to bridge natural user phrasing that the
// catalog labels/descriptions do not capture directly yet. Future work can move
// these to a dedicated alias/Patois layer instead of expanding this object.
const TEMPORARY_MATCH_ALIASES = {
  VAGINAL_BLEEDING: ["bleeding", "i'm bleeding", "im bleeding", "bleeding today", "period flow", "flow is here"],
  SPOTTING: ["spotting", "spotting a little", "light spotting", "random spotting", "just spotting"],
  HEAVY_FLOW: ["heavy bleeding", "heavy period", "heavy flow", "bleeding a lot", "flow is heavy", "soaking through"],
  LARGE_CLOTS: ["passing clots", "big clots", "large blood clots", "blood clots", "huge clots", "clots in my period"],
  BRIGHT_RED: ["fresh red blood", "bright red period blood", "really red blood", "vivid red blood"],
  DARK_RED: ["wine color", "wine colour", "deep red blood", "dark period blood", "maroon blood", "burgundy blood"],
  LIGHT_RED: ["light red blood", "pale red blood", "lighter red blood", "period is light red"],
  PINK_BLOOD: ["pink blood", "pink spotting", "pinkish blood", "light pink blood"],
  BROWN_BLOOD: ["brown blood", "old blood", "rust colored blood", "rust-coloured blood", "brown spotting", "period blood is brown"],
  BLACK_BLOOD: ["period black", "black period", "period always black", "black blood", "very dark blood", "almost black blood"],
  ORANGE_TINGE: ["orange blood", "orange tinted blood", "orange-tinged blood", "orangey blood"],
  GRAY_BLOOD: ["gray blood", "grey blood", "greyish blood", "grayish blood", "ash colored blood"],
  CRAMPS: ["period cramps", "bad cramps", "cramping", "crampy", "my cramps hurt"],
  PELVIC_PAIN: ["pelvic hurts", "pelvic pain", "pain in my pelvis", "pressure in my pelvis", "pelvis hurting"],
  LOWER_ABDOMINAL_CRAMPS: ["lower belly cramps", "lower stomach cramps", "cramps in my lower belly", "lower abdomen cramps", "low belly cramps"],
  SHARP_PELVIC_PAIN: ["sharp pelvic pain", "stabbing pelvic pain", "sharp pain in my pelvis", "knife like pelvic pain", "sudden sharp pelvic pain"],
  DULL_PELVIC_ACHE: ["dull pelvic ache", "aching in my pelvis", "constant pelvic ache", "pelvis feels achy", "dull ache in my lower belly"],
  LOWER_BACK_PAIN: ["lower back hurts", "lower back pain", "back hurting low", "my lower back is hurting", "back ache low down"],
  LEG_PAIN: ["legs aching", "leg pain", "my legs hurt", "aching legs", "sore legs"],
  BREAST_PAIN: ["breast pain", "boob pain", "my boobs hurt", "my breasts hurt", "pain in my boobs"],
  NIPPLE_SENSITIVITY: ["nipples sore", "nipples sensitive", "nipple pain", "my nipples hurt", "tender nipples"],
  OVULATION_PAIN: ["ovulation pain", "mittelschmerz", "pain around ovulation", "mid cycle pain", "one sided ovulation pain"],
  HEADACHE: ["head hurts", "headache", "my head is hurting", "pressure in my head", "bad headache"],
  MIGRAINE: ["migraine", "bad migraine", "splitting headache", "pounding migraine", "headache with light sensitivity"],
  JOINT_PAIN: ["body aches", "joint pain", "muscle aches", "my joints hurt", "aches all over"],
  STABBING_PAIN: ["stabbing pain", "sharp stabbing pain", "feels like stabbing", "stabs of pain", "stabbing cramps"],
  THROBBING_PAIN: ["throbbing pain", "pain is throbbing", "pulsing pain", "throbbing cramps", "pounding pain"],
  RADIATING_PAIN: ["radiating pain", "pain spreads", "pain going down", "pain shooting outward", "pain moving from one spot"],
  PAIN_ONE_SIDE: ["one sided pain", "pain on one side", "hurts on one side", "left side pain", "right side pain"],
  PAIN_WITH_MOVEMENT: ["hurts when i move", "pain when moving", "movement makes it worse", "worse when i walk", "hurts more when i move"],
  PAIN_DURING_BOWEL: ["pain when i poop", "hurts when i poop", "pain during bowel movement", "pooping hurts", "pain while passing stool"],
  PAIN_DURING_URINATION: ["pain when i pee", "hurts when i pee", "pain during urination", "peeing hurts", "pain while peeing"],
  BREAST_TENDERNESS: ["breasts sore", "breast sore", "boobs sore", "boob sore", "boobs hurting", "tender breasts", "breasts tender"],
  BLOATING: ["bloated", "feel bloated", "puffy belly", "my belly feels bloated", "stomach feels bloated", "i'm so bloated", "im so bloated"],
  GASSY: ["gassy", "full of gas", "gas pains", "passing gas a lot", "so much gas"],
  HEARTBURN: ["heartburn", "acid in my chest", "burning in my chest after eating", "food coming back up", "fire in my chest"],
  NAUSEA: ["nausea", "nauseous", "queasy", "feel sick to my stomach", "feel like throwing up", "want to throw up", "wanna throw up"],
  VOMITING: ["throwing up", "vomiting", "threw up", "keep vomiting", "being sick to my stomach"],
  LOSS_OF_APPETITE: ["no appetite", "don't want to eat", "dont want to eat", "not hungry at all", "lost my appetite"],
  INCREASED_APPETITE: ["so hungry", "extra hungry", "always hungry", "hungry all the time", "eating more than usual"],
  STOMACH_CRAMPS: ["stomach cramps", "my stomach is cramping", "belly cramps", "cramps in my stomach", "tummy cramps"],
  INDIGESTION: ["indigestion", "upset stomach after eating", "food not sitting right", "stomach feels unsettled", "food just sits there"],
  ACID_REFLUX: ["acid reflux", "reflux", "acid coming up", "burning throat after eating", "sour stuff coming up"],
  BURPING: ["burping a lot", "keep burping", "burp a lot", "constant burping", "excessive burping"],
  ABDOMINAL_PRESSURE: ["pressure in my stomach", "pressure in my abdomen", "my belly feels tight", "abdominal pressure", "stomach feels pressurized"],
  EARLY_FULLNESS: ["get full fast", "full after a few bites", "fill up quickly", "can't eat much before i'm full", "im full quickly"],
  CONSTIPATION: ["constipated", "can't poop", "cant poop", "hard to poop", "backed up"],
  DIARRHEA: ["diarrhea", "runny stool", "watery poop", "loose bowels", "the runs"],
  HARD_STOOL: ["hard stool", "hard poop", "stool is hard", "poop is hard", "pebble poop"],
  LOOSE_STOOL: ["loose stool", "loose poop", "soft stool", "poop is loose", "mushy stool"],
  FREQUENT_BOWEL: ["pooping a lot", "going poop a lot", "having bowel movements a lot", "keep needing to poop", "using the bathroom a lot for poop"],
  INCOMPLETE_EVACUATION: ["feel like i'm not done pooping", "still feel full after pooping", "can't empty my bowels", "feel like more is left", "unfinished after i poop"],
  PAINFUL_BOWEL: ["painful bowel movement", "pooping hurts", "pain when i poop", "it hurts to poop", "bowel movements hurt"],
  MUCUS_IN_STOOL: ["mucus in stool", "mucus in my poop", "slime in stool", "slimy poop", "jelly in my poop"],
  URGENCY_TO_GO: ["need to poop right now", "urgent need to poop", "can't hold my poop", "have to run to the bathroom", "sudden urge to poop"],
  DARK_STOOL: ["dark stool", "black stool", "very dark poop", "poop is dark", "almost black poop"],
  LIGHT_STOOL: ["light stool", "pale stool", "clay colored stool", "poop is pale", "very light poop"],
  DISCHARGE_NONE: ["no discharge", "dry discharge wise", "nothing coming out", "not getting discharge", "completely dry down there"],
  DISCHARGE_STICKY: ["sticky discharge", "tacky discharge", "gluey discharge", "sticky stuff", "discharge feels sticky"],
  DISCHARGE_CREAMY: ["creamy discharge", "milky discharge", "lotion like discharge", "white creamy discharge", "cream colored discharge"],
  DISCHARGE_EGGWHITE: ["egg white discharge", "eggwhite discharge", "clear stretchy discharge", "stretchy clear discharge", "slippery stretchy discharge"],
  UNUSUAL_DISCHARGE: ["discharge seems off", "weird discharge", "abnormal discharge", "discharge not normal", "something off with my discharge"],
  DISCHARGE_WATERY: ["watery discharge", "thin watery discharge", "really watery discharge", "discharge is watery", "watery wetness"],
  DISCHARGE_THICK_CLUMPY: ["thick discharge", "clumpy discharge", "chunky discharge", "cottage cheese discharge", "thick white clumps"],
  DISCHARGE_YELLOW: ["yellowish discharge", "yellow discharge", "yellow stuff coming out", "mustard colored discharge", "pale yellow discharge"],
  DISCHARGE_GREEN: ["greenish discharge", "green discharge", "green stuff coming out", "yellow green discharge", "green mucus discharge"],
  DISCHARGE_GRAY: ["grey discharge", "gray discharge", "grayish discharge", "greyish discharge", "grey colored discharge", "gray colored discharge"],
  DISCHARGE_BROWN: ["brown discharge", "brown spotting discharge", "rusty discharge", "brown stuff coming out", "old blood discharge"],
  DISCHARGE_BLOOD_TINGED: ["blood tinged discharge", "blood in my discharge", "pink discharge with blood", "bloody discharge", "streaks of blood in discharge"],
  DISCHARGE_FOUL_SMELL: ["fishy discharge", "bad smelling discharge", "foul smelling discharge", "discharge smells bad", "strong smelling discharge"],
  DISCHARGE_INCREASED: ["a lot of discharge", "more discharge than usual", "discharge increased", "so much discharge", "extra discharge"],
  DISCHARGE_DECREASED: ["less discharge than usual", "hardly any discharge", "reduced discharge", "barely any discharge", "discharge decreased"],
  FATIGUE: ["fatigue", "so tired", "wiped out", "drained", "exhausted"],
  VERY_LOW_ENERGY: ["zero energy", "completely drained", "can't get out of bed", "dead tired", "absolutely no energy"],
  LOW_ENERGY: ["no energy", "very low energy", "low energy", "energy is low", "running on empty"],
  NORMAL_ENERGY: ["energy feels normal", "normal energy", "back to normal energy", "energy is okay", "my energy feels usual"],
  HIGH_ENERGY: ["high energy", "tons of energy", "so much energy", "wired with energy", "super energetic"],
  BURST_OF_ENERGY: ["burst of energy", "sudden energy", "energy spike", "random energy rush", "quick burst of energy"],
  ENERGY_CRASH: ["energy crash", "crashed after feeling okay", "sudden crash in energy", "my energy tanked", "hit a wall"],
  FATIGUE_AFTER_MEALS: ["tired after eating", "sleepy after meals", "food makes me tired", "i crash after i eat", "exhausted after meals"],
  FLUID_RETENTION: ["fluid retention", "holding water", "retaining fluid", "feel swollen with fluid", "water retention"],
  FREQUENT_URINATION: ["keep peeing", "peeing a lot", "bathroom a lot", "need to pee all the time", "running to pee a lot"],
  URINARY_URGENCY: ["need to pee right away", "have to pee urgently", "can't hold my pee", "sudden urge to pee", "need the bathroom now"],
  BURNING_URINATION: ["burning when i pee", "pee burns", "it burns to pee", "stinging when i pee", "urine burns"],
  URINARY_LEAKAGE: ["peeing a little when i sneeze", "leaking pee", "urine leakage", "i keep leaking pee", "pee leaks out"],
  ACNE: ["breaking out", "acne breakout", "pimples", "face breaking out", "skin breaking out", "i get bumps", "my face has bumps", "i get acne around my period"],
  DRY_SKIN: ["dry skin", "skin feels dry", "flaky skin", "ashy skin", "my skin is so dry", "my skin is dry"],
  OILY_SKIN: ["oily skin", "greasy skin", "skin gets oily", "my face is oily", "extra oily skin"],
  GLOWING_SKIN: ["skin is glowing", "glowy skin", "my skin looks really good", "face is glowing", "clear glowing skin"],
  SKIN_SENSITIVITY: ["skin feels sensitive", "sensitive skin", "my skin gets irritated easily", "skin is tender", "skin feels reactive", "itchy skin", "my skin is itchy", "skin feels itchy"],
  SKIN_RASH: ["skin rash", "rash on my skin", "i broke out in a rash", "itchy rash", "red rash", "my skin has a rash", "i have a rash"],
  CYSTIC_ACNE: ["cystic acne", "deep painful pimples", "under the skin pimples", "big painful acne", "hormonal cystic acne", "painful bumps under my skin", "deep sore bumps"],
  HORMONAL_BREAKOUTS: ["hormonal breakouts", "break out around my period", "period acne", "cycle breakouts", "acne before my period", "around my period i get bumps", "around my period i get acne", "period makes me break out"],
  SKIN_DULLNESS: ["skin looks dull", "dull skin", "my skin looks tired", "face looks flat", "skin has no glow"],
  HAIR_THINNING: ["hair thinning", "hair getting thin", "my hair feels thinner", "thinning hair", "less hair than usual"],
  HAIR_SHEDDING: ["hair shedding", "hair falling out", "losing hair", "more hair in the shower", "hair coming out a lot"],
  OILY_HAIR: ["oily hair", "greasy hair", "hair gets oily fast", "my scalp is oily", "hair feels greasy"],
  DRY_HAIR: ["dry hair", "hair feels dry", "brittle hair", "hair is straw like", "my hair feels rough and dry", "my hair is dry"],
  HOT_FLASHES: ["hot flashes", "sudden hot flush", "wave of heat", "random hot flash", "getting hot all of a sudden", "i'm always feeling hot", "im always feeling hot"],
  NIGHT_SWEATS: ["night sweats", "waking up sweaty", "sweating in my sleep", "wake up drenched", "sweaty at night", "every morning i wake up sweating", "i wake up sweating every morning"],
  COLD_FLASHES: ["cold flashes", "sudden cold feeling", "random chills", "feel cold all of a sudden", "wave of cold"],
  BBT_SHIFT: ["bbt shift", "basal temp shift", "temperature shift", "bbt changed", "my basal temperature shifted"],
  ELEVATED_BBT: ["elevated bbt", "high bbt", "basal temp is up", "bbt is higher", "temperature rose"],
  LOWER_BBT: ["low bbt", "lower bbt", "basal temp dropped", "bbt is lower", "temperature is down"],
  FEELING_HOT: ["feeling hot", "running hot", "too hot", "body feels hot", "i feel overheated"],
  FEELING_COLD: ["feeling cold", "always cold", "too cold", "body feels cold", "i feel chilled"],
  CHILLS: ["chills", "shivering", "got the chills", "cold shakes", "shaking from cold"],
  MOOD_SWINGS: ["mood swings", "mood all over the place", "my mood is all over the place", "emotions all over", "up and down emotionally", "my mood keeps changing"],
  IRRITABILITY: ["irritable", "so irritable", "snappy", "easily annoyed", "everything annoys me"],
  ANXIETY: ["anxiety", "anxious", "feeling anxious", "panicy", "on edge"],
  DEPRESSION: ["low mood", "feeling low", "depressed", "really down", "sad for no reason"],
  CRYING_SPELLS: ["crying spells", "keep crying", "cry for no reason", "burst into tears", "random crying"],
  CALM: ["feeling calm", "calmer than usual", "surprisingly calm", "very calm", "steady mood", "happy mood", "in such a happy mood", "i'm in such a happy mood", "im in such a happy mood"],
  STRESSED: ["stressed", "so stressed", "stress levels high", "feeling tense", "under a lot of stress"],
  BRAIN_FOG: ["brain fog", "foggy", "can't think straight", "cant think straight", "my brain feels foggy"],
  FORGETFUL: ["forgetful", "keep forgetting things", "forgetting stuff", "my memory is off", "so forgetful lately"],
  POOR_CONCENTRATION: ["can't focus", "cant focus", "can't concentrate", "cant concentrate", "having trouble focusing"],
  ANXIOUS_MIND: ["anxious thoughts", "mind won't stop racing", "racing thoughts", "my brain won't relax", "overthinking everything"],
  OVERWHELMED: ["overwhelmed", "everything feels like too much", "mentally overloaded", "too much on my mind", "swamped mentally"],
  IRRITABLE_MIND: ["mentally irritable", "my mind feels snappy", "everything is getting on my nerves", "can't deal with people", "short tempered mentally"],
  LOW_MOOD: ["my mood feels low", "mentally low", "feeling emotionally low", "down mentally", "my mind feels heavy"],
  EMOTIONAL_SENSITIVE: ["emotionally sensitive", "more emotional than usual", "sensitive about everything", "take everything personally", "easily emotional"],
  UNMOTIVATED: ["unmotivated", "can't get myself to do anything", "no motivation", "don't feel like doing anything", "dont feel like doing anything"],
  RESTLESS: ["restless", "can't sit still", "cant sit still", "fidgety", "feel unsettled"],
  MENTALLY_FOCUSED: ["mentally focused", "mind feels sharp", "thinking clearly", "locked in mentally", "super focused"],
  DISTRACTED: ["distracted", "keep getting distracted", "mind all over the place", "can't stay on task", "cant stay on task"],
  INTRUSIVE_THOUGHTS: ["intrusive thoughts", "unwanted thoughts", "disturbing thoughts keep coming", "can't stop unwanted thoughts", "cant stop unwanted thoughts"],
  PANIC_FEELINGS: ["panic feelings", "feel panicky", "panic attack feeling", "feel like i'm panicking", "im panicking"],
  EMOTIONAL_NUMBNESS: ["emotionally numb", "feel numb", "can't feel anything emotionally", "cant feel anything emotionally", "shut down emotionally"],
  HYPERSENSITIVITY: ["extra sensitive to everything", "hypersensitive", "everything feels too intense", "too sensitive", "overly sensitive"],
  SELF_CRITICAL: ["being hard on myself", "self critical", "keep judging myself", "beating myself up", "so critical of myself"],
  INSOMNIA: ["insomnia", "can't sleep", "cant sleep", "not sleeping", "i barely sleep", "i can't sleep at night", "i cant sleep at night"],
  DIFFICULTY_FALLING_ASLEEP: ["can't fall asleep", "cant fall asleep", "takes forever to fall asleep", "struggle to fall asleep", "hard to drift off", "takes me forever to sleep", "hard to fall asleep at night"],
  FREQUENT_WAKING: ["keep waking up", "waking up a lot", "wake up through the night", "i keep waking in my sleep", "sleep keeps breaking"],
  OVERSLEEPING: ["oversleeping", "sleeping too much", "can't stop sleeping", "cant stop sleeping", "sleep way too long"],
  RESTLESS_SLEEP: ["restless sleep", "sleep feels restless", "tossing and turning", "sleeping lightly", "never settle into sleep"],
  VIVID_DREAMS: ["vivid dreams", "crazy dreams", "super vivid dreams", "intense dreams", "really detailed dreams"],
  WAKING_SAME_TIME: ["keep waking at the same time", "wake up same time every night", "same time wake ups", "always up at the same hour", "waking same time nightly"],
  DIFFICULTY_STAYING_ASLEEP: ["can't stay asleep", "cant stay asleep", "fall asleep then wake up", "sleep won't stay", "i wake up and can't go back"],
  NIGHTMARES: ["nightmares", "bad dreams", "scary dreams", "night terrors", "keep having nightmares"],
  HORMONAL_INSOMNIA: ["period insomnia", "hormonal insomnia", "can't sleep around my period", "cant sleep around my period", "cycle insomnia"],
  SOCIABLE: ["feeling social", "more sociable", "want to be around people", "chatty", "in a social mood"],
  WITHDRAWN: ["withdrawn", "don't want to be around people", "dont want to be around people", "keeping to myself", "pulling away from people"],
  CLINGY: ["clingy", "need extra closeness", "want to be attached to someone", "extra clingy", "don't want people far from me"],
  SEEKING_REASSURANCE: ["need reassurance", "keep asking if things are okay", "want constant reassurance", "need validation", "please reassure me"],
  EASILY_ANNOYED: ["easily annoyed", "annoyed by everyone", "everything is irritating me", "irritated by little things", "little things are annoying me"],
  CONFLICT_AVOIDANT: ["avoiding conflict", "don't want confrontation", "dont want confrontation", "avoiding arguments", "keeping the peace no matter what"],
  LOW_SOCIAL_ENERGY: ["social battery is low", "no energy for people", "don't want to socialize", "dont want to socialize", "too drained to talk", "i have no social energy"],
  HIGH_SOCIAL_ENERGY: ["social battery is high", "want to socialize", "full of social energy", "feel like being around people", "extra talkative", "i have a lot of social energy"],
  FEELING_ISOLATED: ["feeling isolated", "feel alone", "feel cut off from everyone", "feel lonely", "isolated from people", "i feel isolated"],
  AFFECTIONATE: ["more affectionate", "want cuddles", "feeling extra loving", "more touchy feely", "want more affection"],
  DISTANT: ["feeling distant", "emotionally distant", "pulling away", "don't want closeness", "dont want closeness"],
  CRAVING_SWEET: ["craving sweets", "want sugar", "need something sweet", "sweet tooth is bad", "want dessert"],
  CRAVING_SALTY: ["craving salty food", "want salty snacks", "need salt", "salty cravings", "want chips badly"],
  CRAVING_GREASY: ["craving greasy food", "want greasy food", "need fried food", "greasy cravings", "want something oily and salty"],
  CRAVING_SPICY: ["craving spicy food", "want spicy food", "need something spicy", "spicy cravings", "want hot pepper food"],
  APPETITE_INCREASE: ["appetite is up", "eating more", "more hungry than usual", "can't stop eating", "cant stop eating"],
  APPETITE_DECREASE: ["appetite is down", "eating less", "not eating much", "food doesn't interest me", "food doesnt interest me"],
  CRAVING_CHOCOLATE: ["craving chocolate", "need chocolate", "want chocolate so bad", "chocolate cravings", "all i want is chocolate", "really want some chocolate", "want chocolate rn"],
  CRAVING_CARBS: ["craving carbs", "want bread and pasta", "need carbs", "want bread badly", "carb cravings"],
  CRAVING_DAIRY: ["craving dairy", "want cheese", "need ice cream", "milk cravings", "cheese cravings", "really want some milk", "want milk rn", "want some milk", "need some milk", "milk rn"],
  CRAVING_COLD: ["craving cold food", "want cold food", "need something cold", "cold food cravings", "want ice cold drinks"],
  CRAVING_WARM: ["craving warm food", "want hot food", "need something warm", "warm food cravings", "want soup or tea"],
  CRAVING_CAFFEINE: ["craving caffeine", "need coffee", "want coffee badly", "need an energy drink", "caffeine craving"],
  NO_CRAVINGS: ["no cravings", "not craving anything", "nothing sounds good", "don't really want anything", "dont really want anything"],
  RANDOM_CRAVINGS: ["random cravings", "craving weird things", "different cravings every day", "all kinds of cravings", "craving random foods"],
  INCREASED_LIBIDO: ["higher sex drive", "more horny", "want sex more", "libido is up", "feeling turned on more", "my sex drive is high"],
  DECREASED_LIBIDO: ["lower sex drive", "not in the mood for sex", "libido is down", "don't want sex", "dont want sex", "my sex drive is low", "not interested in sex", "i'm not interested in sex", "im not interested in sex", "never been interested in sex"],
  CERVICAL_MUCUS_CHANGE: ["cervical mucus changed", "cervical mucus is different", "mucus changed", "fertile mucus changed", "different cervical fluid", "my cervical mucus changed"],
  VAGINAL_DRYNESS: ["dry down there", "vaginal dryness", "feeling dry down there", "not enough lubrication", "very dry vaginally", "i feel dry down there"],
  PAIN_DURING_SEX: ["pain during sex", "sex hurts", "hurts during sex", "pain with intercourse", "sex is painful"],
  MISSED_PERIOD: ["missed period", "period didn't come", "period didnt come", "my period is late", "haven't gotten my period", "havent gotten my period"],
  IRREGULAR_PERIOD: ["irregular period", "cycle is all over the place", "period timing is random", "unpredictable period", "my cycle is irregular"],
  WEIGHT_CHANGE: ["weight changed", "my weight is different", "weight fluctuation", "weight shifted", "weight has changed", "my weight changed"],
  WEIGHT_GAIN: ["weight gain", "gaining weight", "put on weight", "i've gained weight", "ive gained weight", "my weight is going up"],
  WEIGHT_LOSS: ["weight loss", "losing weight", "dropped weight", "i've lost weight", "ive lost weight", "my weight is dropping", "i lost a bunch of weight", "lost a lot of weight"],
  WATER_RETENTION: ["retaining water", "water weight", "holding water weight", "water retention", "feel like i'm holding water", "i'm retaining water", "im retaining water"],
  FEELING_PUFFY: ["feeling puffy", "look puffy", "face feels puffy", "body feels puffy", "swollen and puffy", "i feel puffy", "i look fat", "i feel fat"],
  SMELL_SENSITIVITY: ["sensitive to smells", "smells are too strong", "smell sensitivity", "every smell bothers me", "nose is extra sensitive", "i can smell everything", "it's like i can smell everything", "its like i can smell everything"],
  NASAL_CONGESTION: ["stuffy nose", "nose blocked", "nasal congestion", "can't breathe through my nose", "cant breathe through my nose"],
  HEART_RACING: ["heart racing", "heart is racing", "my heart is going fast", "rapid heartbeat", "heart beating too fast", "my heart is racing"],
  PALPITATIONS: ["palpitations", "skipped heartbeat", "fluttering in my chest", "heart flutters", "weird heartbeat feelings", "my heart is fluttering"],
  CHEST_TIGHTNESS: ["chest tightness", "tight chest", "chest feels tight", "pressure in my chest", "my chest is tight", "my chest feels tight"],
  SHORTNESS_OF_BREATH: ["short of breath", "can't catch my breath", "cant catch my breath", "breathing feels hard", "out of breath", "i'm short of breath", "im short of breath"],
  DIZZINESS: ["dizzy", "feeling dizzy", "room is spinning", "head spinning", "really dizzy"],
  LIGHTHEADED: ["lightheaded", "feeling light headed", "feel floaty", "headed feels light", "feel like i might tip over", "my head feels light"],
  FAINT_FEELING: ["feel faint", "feel like passing out", "might faint", "about to pass out", "faint feeling", "i feel like i might faint"],
  BREAST_SWELLING: ["breasts feel swollen", "boobs feel swollen", "breast swelling", "swollen boobs", "my breasts are swollen", "my boobs are swollen"],
  BREAST_FULLNESS: ["breasts feel full", "boobs feel full", "breast fullness", "heavy full breasts", "my breasts feel heavy", "my boobs feel heavy"],
  NIPPLE_DISCHARGE: ["nipple discharge", "stuff coming from my nipple", "fluid from my nipple", "nipples leaking", "discharge from my nipples", "my nipples are leaking"],
  INCREASED_SWEATING: ["sweating more", "extra sweaty", "sweating a lot", "more sweat than usual", "keep sweating", "constantly sweating", "i'm constantly sweating", "im constantly sweating"],
  BODY_TEMP_CHANGE: ["body temperature change", "my temperature feels different", "temp feels off", "body temp is changing", "running hotter or colder", "my body temperature feels off"],
  FACIAL_PUFFINESS: ["puffy face", "face is swollen", "facial puffiness", "my face looks puffy", "swollen face", "my face is puffy"],
  HIGHLY_PRODUCTIVE: ["super productive", "highly productive", "getting so much done", "locked in and productive", "very productive", "i'm getting a lot done", "im getting a lot done"],
  LOW_PRODUCTIVITY: ["low productivity", "can't get anything done", "cant get anything done", "not productive", "getting nothing done", "i'm not getting much done", "im not getting much done"],
  PROCRASTINATING: ["procrastinating", "putting everything off", "can't start tasks", "cant start tasks", "avoiding my work", "i keep putting things off"],
  MENTALLY_CLEAR: ["mentally clear", "mind feels clear", "clear headed", "thinking clearly", "my head feels clear", "my mind feels clear"],
  OVERWHELMED_TASKS: ["overwhelmed with tasks", "too many tasks", "my to do list is too much", "drowning in tasks", "everything to do feels too much", "i'm overwhelmed by my tasks", "im overwhelmed by my tasks"],
  DECISION_FATIGUE: ["decision fatigue", "too tired to make choices", "can't make decisions", "cant make decisions", "every choice feels exhausting", "making decisions feels exhausting"],
  SORE_THROAT: ["sore throat", "throat hurts", "my throat is sore", "scratchy throat", "painful throat"],
  FEVER: ["fever", "feverish", "temperature is up", "burning up with fever", "running a fever", "running a temperature", "i have a fever", "i got a temperature", "feel hot and sick"],
  ILLNESS_CHILLS: ["sick chills", "chills with fever", "illness chills", "shivery because i'm sick", "im sick with chills"],
  RUNNY_NOSE: ["runny nose", "nose keeps running", "sniffly", "my nose won't stop running", "my nose wont stop running"],
  COUGH: ["cough", "coughing", "keep coughing", "dry cough", "chesty cough"],
  FEELING_SICK: ["feeling sick", "i feel sick", "under the weather", "coming down with something", "feel ill"],
  RECOVERING: ["recovering from being sick", "getting over an illness", "on the mend", "still recovering", "coming out of being sick", "starting to feel better", "just started feeling better", "i just started feeling better"],
};

const STOP_WORDS = new Set([
  "a", "an", "and", "the", "of", "or", "to", "than", "your", "you", "my",
  "in", "on", "with", "for", "from", "that", "this", "today", "usual",
  "often", "more", "less", "very", "feeling", "feel", "having", "have",
  "colored", "colour", "colored", "consider", "speaking", "provider",
]);

function normalizeWhitespace(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
}

function stemToken(token) {
  let out = String(token || "");
  if (out.length > 5 && out.endsWith("ing")) out = out.slice(0, -3);
  else if (out.length > 4 && out.endsWith("ies")) out = `${out.slice(0, -3)}y`;
  else if (out.length > 4 && out.endsWith("ed")) out = out.slice(0, -2);
  else if (out.length > 4 && out.endsWith("es")) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith("s")) out = out.slice(0, -1);
  return out;
}

function tokenize(text) {
  return normalizeWhitespace(text)
    .split(" ")
    .filter(Boolean)
    .map(stemToken);
}

function phraseToTokens(text) {
  return tokenize(text).filter((token) => !STOP_WORDS.has(token));
}

export function normalizeCategory(category) {
  return normalizeWhitespace(category).replace(/\s+/g, "_");
}

function buildSearchIndex(entry) {
  const keyPhrase = normalizeWhitespace(entry.key);
  const labelPhrase = normalizeWhitespace(entry.label);
  const descriptionPhrase = normalizeWhitespace(entry.description);
  const aliases = (TEMPORARY_MATCH_ALIASES[entry.key] || []).map(normalizeWhitespace);

  return {
    ...entry,
    normalizedCategory: normalizeCategory(entry.category),
    keyPhrase,
    labelPhrase,
    descriptionPhrase,
    searchablePhrases: [
      { source: "key", value: keyPhrase },
      { source: "label", value: labelPhrase },
      ...aliases.map((value) => ({ source: "alias", value })),
    ],
    labelTokens: phraseToTokens(entry.label),
    keyTokens: phraseToTokens(entry.key),
    descriptionTokens: phraseToTokens(entry.description),
  };
}

const CATALOG = (Array.isArray(symptomCatalog) ? symptomCatalog : []).map(buildSearchIndex);
const BY_KEY = new Map(CATALOG.map((entry) => [entry.key, entry]));
const BY_CATEGORY = new Map();

for (const entry of CATALOG) {
  const cat = entry.normalizedCategory;
  if (!BY_CATEGORY.has(cat)) BY_CATEGORY.set(cat, []);
  BY_CATEGORY.get(cat).push(entry);
}

export function getAllSymptoms() {
  return CATALOG.map(({ normalizedCategory, keyPhrase, labelPhrase, descriptionPhrase, searchablePhrases, labelTokens, keyTokens, descriptionTokens, ...rest }) => ({ ...rest }));
}

export function getSymptomByKey(key) {
  return BY_KEY.get(String(key || "").trim().toUpperCase()) || null;
}

export function getSymptomsByCategory(category) {
  return (BY_CATEGORY.get(normalizeCategory(category)) || []).map(({ normalizedCategory, keyPhrase, labelPhrase, descriptionPhrase, searchablePhrases, labelTokens, keyTokens, descriptionTokens, ...rest }) => ({ ...rest }));
}

export function getTeenSafeSymptoms() {
  return getAllSymptoms().filter((entry) => entry.teenSafe === true);
}

export function getSensitiveSymptoms() {
  return getAllSymptoms().filter((entry) => entry.sensitive === true);
}

function hasTokenWindow(textTokens, phraseTokens) {
  if (!phraseTokens.length || !textTokens.length || phraseTokens.length > textTokens.length) return false;
  for (let i = 0; i <= textTokens.length - phraseTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (textTokens[i + j] !== phraseTokens[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function scoreMatch(entry, normalizedText, textTokens) {
  for (const phrase of entry.searchablePhrases) {
    const phraseTokens = phraseToTokens(phrase.value);
    if (!phraseTokens.length) continue;
    if (normalizedText.includes(phrase.value) || hasTokenWindow(textTokens, phraseTokens)) {
      const confidence = phrase.source === "label" ? 0.98 : phrase.source === "alias" ? 0.94 : 0.9;
      return { confidence, matchedFrom: phrase.source };
    }
  }

  if (entry.labelTokens.length >= 2 && entry.labelTokens.every((token) => textTokens.includes(token))) {
    return { confidence: 0.84, matchedFrom: "label_tokens" };
  }

  if (entry.keyTokens.length >= 2 && entry.keyTokens.every((token) => textTokens.includes(token))) {
    return { confidence: 0.8, matchedFrom: "key_tokens" };
  }

  const descHits = entry.descriptionTokens.filter((token) => textTokens.includes(token));
  if (descHits.length >= 2) {
    return { confidence: 0.68, matchedFrom: "description_keywords" };
  }

  return null;
}

export function findSymptomMatchesFromText(
  text,
  { teenSafeOnly = false, excludeSensitive = false } = {}
) {
  const normalizedText = normalizeWhitespace(text);
  const textTokens = tokenize(normalizedText);
  if (!normalizedText) return [];

  const matches = [];
  for (const entry of CATALOG) {
    if (teenSafeOnly && entry.teenSafe !== true) continue;
    if (excludeSensitive && entry.sensitive === true) continue;

    const scored = scoreMatch(entry, normalizedText, textTokens);
    if (!scored) continue;

    matches.push({
      key: entry.key,
      label: entry.label,
      category: entry.category,
      teenSafe: entry.teenSafe,
      sensitive: entry.sensitive,
      confidence: scored.confidence,
      matchedFrom: scored.matchedFrom,
    });
  }

  const deduped = new Map();
  for (const match of matches) {
    const prev = deduped.get(match.key);
    if (!prev || match.confidence > prev.confidence) deduped.set(match.key, match);
  }

  return [...deduped.values()].sort((a, b) => b.confidence - a.confidence || a.key.localeCompare(b.key));
}

export function groupSymptomMatchesByCategory(matches = []) {
  const grouped = {};
  for (const match of matches) {
    const category = normalizeCategory(match.category);
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(match);
  }
  return grouped;
}

export function catalogKeyToSelectionCode(key, category) {
  const rawKey = String(key || "").trim().toUpperCase();
  const cat = normalizeCategory(category);

  if (cat === "discharge") return rawKey.replace(/^DISCHARGE_/, "").toLowerCase();
  if (cat === "blood_colour") {
    return rawKey
      .replace(/_BLOOD$/, "")
      .toLowerCase();
  }

  return rawKey.toLowerCase();
}
