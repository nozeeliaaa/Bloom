/**
 * src/utils/bloomie/routing/matchContentTopic.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Content Routing Engine for Bloomie.
 *
 * matchContentTopic(inputText, shownIds?, declinedIds?) → ContentMatch | null
 *
 * Priority order (per spec):
 *   1. pamphlets
 *   2. faq
 *   3. glossary
 *
 * Rules:
 *  • Deterministic — no randomness except pick() on equal-score ties.
 *  • No external fetches — all content is defined in the catalog below.
 *  • Never repeats a shownId or declinedId passed in from Bloomie memory.
 *  • Alias map normalises synonyms before matching so "period", "menses",
 *    "menstruation", "monthly" all resolve to the same topic token.
 *  • Scoring: keyword hits + tag hits, with pamphlet-type bonus applied
 *    at selection time (not at scoring time) so scores stay comparable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function pick(arr) {
  return arr[0] ?? null;
}

export const ALIAS_MAP = {
  // Period / menstruation
  "period":           "menstruation",
  "periods":          "menstruation",
  "menses":           "menstruation",
  "monthly":          "menstruation",
  "menstruation":     "menstruation",
  "menstrual":        "menstruation",
  "time of month":    "menstruation",
  "on my period":     "menstruation",
  "cycle":            "menstruation",
  "flow":             "menstruation",

  // Late / missed period
  "late period":      "late_period",
  "missed period":    "late_period",
  "period late":      "late_period",
  "period is late":   "late_period",
  "no period":        "late_period",
  "skipped period":   "late_period",

  // Heavy bleeding
  "heavy period":     "heavy_bleeding",
  "heavy bleeding":   "heavy_bleeding",
  "heavy flow":       "heavy_bleeding",
  "flooding":         "heavy_bleeding",
  "soaking":          "heavy_bleeding",
  "clots":            "heavy_bleeding",
  "large clots":      "heavy_bleeding",
  "hemorrhaging":     "heavy_bleeding",

  // Spotting
  "spotting":         "spotting",
  "light bleeding":   "spotting",
  "pink discharge":   "spotting",
  "brown discharge":  "spotting",
  "breakthrough bleeding": "spotting",
  "mid-cycle bleeding": "spotting",

  // Cramps / pelvic pain
  "cramps":           "pelvic_pain",
  "cramping":         "pelvic_pain",
  "pelvic pain":      "pelvic_pain",
  "stomach pain":     "pelvic_pain",
  "belly pain":       "pelvic_pain",
  "period pain":      "pelvic_pain",
  "dysmenorrhea":     "pelvic_pain",
  "endometriosis":    "pelvic_pain",

  // Ovulation
  "ovulation":        "ovulation",
  "ovulating":        "ovulation",
  "ovulation pain":   "ovulation",
  "mittelschmerz":    "ovulation",
  "fertile window":   "ovulation",
  "fertile days":     "ovulation",
  "egg white":        "ovulation",
  "ewcm":             "ovulation",

  // PMS / PMDD
  "pms":              "pms",
  "pmdd":             "pms",
  "premenstrual":     "pms",
  "mood swings":      "pms",
  "irritability":     "pms",
  "mood before period": "pms",

  // Mood / mental health
  "mood":             "mood",
  "anxiety":          "mood",
  "depressed":        "mood",
  "depression":       "mood",
  "crying":           "mood",
  "emotional":        "mood",
  "overwhelmed":      "mood",
  "mental health":    "mood",

  // Pregnancy
  "pregnant":         "pregnancy",
  "pregnancy":        "pregnancy",
  "pregnancy test":   "pregnancy",
  "ttc":              "pregnancy",
  "trying to conceive": "pregnancy",
  "am i pregnant":    "pregnancy",
  "missed period pregnant": "pregnancy",
  "implantation":     "pregnancy",
  "hcg":              "pregnancy",
  "bfp":              "pregnancy",
  "positive test":    "pregnancy",

  // Discharge
  "discharge":        "discharge",
  "vaginal discharge": "discharge",
  "white discharge":  "discharge",
  "creamy discharge": "discharge",
  "sticky discharge": "discharge",
  "unusual discharge": "discharge",
  "infection":        "discharge",

  // Contraception
  "contraception":    "contraception",
  "birth control":    "contraception",
  "pill":             "contraception",
  "the pill":         "contraception",
  "iud":              "contraception",
  "condom":           "contraception",
  "morning after":    "contraception",
  "plan b":           "contraception",
  "emergency contraception": "contraception",

  // PCOS
  "pcos":             "pcos",
  "polycystic":       "pcos",
  "polycystic ovary": "pcos",
  "irregular periods": "pcos",
  "irregular cycle":  "pcos",

  // Hormones
  "hormones":         "hormones",
  "estrogen":         "hormones",
  "oestrogen":        "hormones",
  "progesterone":     "hormones",
  "testosterone":     "hormones",
  "hormone imbalance": "hormones",
  "hormonal":         "hormones",

  // Perimenopause / menopause
  "menopause":        "menopause",
  "perimenopause":    "menopause",
  "hot flashes":      "menopause",
  "hot flushes":      "menopause",
  "night sweats":     "menopause",
  "change of life":   "menopause",
};

export const CONTENT_CATALOG = [
  // ── Pamphlets ───────────────────────────────────────────────────────────────
  {
    id: "pam-menstrual-health", type: "pamphlet",
    title: "Understanding Your Menstrual Cycle",
    shortAnswer: "A guide to the four cycle phases, what's normal, and when to seek care.",
    link: "/resources/pamphlets/menstrual-health",
    topics: ["menstruation", "late_period", "heavy_bleeding", "spotting"],
    keywords: ["phases", "follicular", "luteal", "period tracking", "cycle length"],
  },
  {
    id: "pam-pcos", type: "pamphlet",
    title: "PCOS: What It Is and What You Can Do",
    shortAnswer: "Explains polycystic ovary syndrome, its symptoms, and management options.",
    link: "/resources/pamphlets/pcos",
    topics: ["pcos", "hormones", "menstruation"],
    keywords: ["cysts", "androgen", "ovaries", "insulin", "irregular", "acne", "hair growth"],
  },
  {
    id: "pam-heavy-bleeding", type: "pamphlet",
    title: "Heavy Periods: Causes and When to Get Help",
    shortAnswer: "Covers what counts as heavy bleeding, common causes, and treatment paths.",
    link: "/resources/pamphlets/heavy-periods",
    topics: ["heavy_bleeding"],
    keywords: ["menorrhagia", "anaemia", "iron", "fibroid", "soaking", "flooding", "clots"],
  },
  {
    id: "pam-contraception", type: "pamphlet",
    title: "Contraception Options Explained",
    shortAnswer: "A plain-language overview of contraceptive methods available in Jamaica.",
    link: "/resources/pamphlets/contraception",
    topics: ["contraception"],
    keywords: ["birth control", "depo", "implant", "patch", "ring", "barrier", "family planning"],
  },
  {
    id: "pam-pregnancy-signs", type: "pamphlet",
    title: "Early Pregnancy: Signs and Next Steps",
    shortAnswer: "What early pregnancy symptoms feel like and what to do if you think you might be pregnant.",
    link: "/resources/pamphlets/early-pregnancy",
    topics: ["pregnancy"],
    keywords: ["nausea", "breast tenderness", "fatigue", "test", "antenatal", "prenatal"],
  },
  {
    id: "pam-pelvic-pain", type: "pamphlet",
    title: "Pelvic Pain: Understanding Your Options",
    shortAnswer: "Covers common causes of pelvic pain across the cycle and when to seek urgent care.",
    link: "/resources/pamphlets/pelvic-pain",
    topics: ["pelvic_pain"],
    keywords: ["cramps", "ectopic", "endometriosis", "ovarian cyst", "appendix", "sharp pain"],
  },
  {
    id: "pam-mental-health-cycle", type: "pamphlet",
    title: "Hormones and Mental Health Across Your Cycle",
    shortAnswer: "How cycle phases affect mood, anxiety, and energy — and what actually helps.",
    link: "/resources/pamphlets/mental-health-cycle",
    topics: ["mood", "pms", "hormones"],
    keywords: ["pmdd", "serotonin", "sleep", "fatigue", "energy", "wellbeing"],
  },
  {
    id: "pam-menopause", type: "pamphlet",
    title: "Perimenopause and Menopause: What to Expect",
    shortAnswer: "A guide to the hormonal transition, common symptoms, and support options.",
    link: "/resources/pamphlets/menopause",
    topics: ["menopause"],
    keywords: ["hrt", "hormone replacement", "vaginal dryness", "bone health", "brain fog"],
  },

  // ── FAQ ─────────────────────────────────────────────────────────────────────
  {
    id: "faq-late-period-not-pregnant", type: "faq",
    title: "Why is my period late if I'm not pregnant?",
    shortAnswer: "Stress, weight changes, illness, and hormonal shifts can all delay a period without pregnancy.",
    link: "/resources/faq/late-period-not-pregnant",
    topics: ["late_period", "menstruation"],
    keywords: ["delayed", "stress", "weight", "thyroid", "sick", "late"],
  },
  {
    id: "faq-normal-cycle-length", type: "faq",
    title: "What is a normal cycle length?",
    shortAnswer: "A typical cycle runs 21–35 days; anything in that range is considered normal.",
    link: "/resources/faq/normal-cycle-length",
    topics: ["menstruation"],
    keywords: ["how long", "days", "regular", "length", "normal"],
  },
  {
    id: "faq-ovulation-timing", type: "faq",
    title: "When do I ovulate?",
    shortAnswer: "Ovulation usually happens about 14 days before your next expected period, not necessarily at day 14.",
    link: "/resources/faq/ovulation-timing",
    topics: ["ovulation"],
    keywords: ["when", "fertile", "conception", "timing", "window", "day 14"],
  },
  {
    id: "faq-spotting-between-periods", type: "faq",
    title: "Is spotting between periods normal?",
    shortAnswer: "Occasional light spotting mid-cycle can be normal around ovulation, but persistent or heavy spotting warrants a check-up.",
    link: "/resources/faq/spotting-between-periods",
    topics: ["spotting"],
    keywords: ["between", "mid-cycle", "implantation", "intermenstrual"],
  },
  {
    id: "faq-period-pain-severity", type: "faq",
    title: "How much period pain is normal?",
    shortAnswer: "Mild cramping for 1–2 days is common; pain that disrupts daily life or gets worse over time is worth investigating.",
    link: "/resources/faq/period-pain-severity",
    topics: ["pelvic_pain"],
    keywords: ["pain level", "severe", "normal", "how bad", "debilitating"],
  },
  {
    id: "faq-discharge-normal", type: "faq",
    title: "What does normal vaginal discharge look like?",
    shortAnswer: "Clear to white, stretchy or creamy discharge that changes across your cycle is normal; strong smell or unusual colour is not.",
    link: "/resources/faq/normal-discharge",
    topics: ["discharge"],
    keywords: ["colour", "color", "smell", "odour", "normal", "yeast", "bv"],
  },
  {
    id: "faq-pms-vs-pmdd", type: "faq",
    title: "What's the difference between PMS and PMDD?",
    shortAnswer: "PMS causes mild to moderate mood and physical symptoms; PMDD is more severe and significantly disrupts daily functioning.",
    link: "/resources/faq/pms-vs-pmdd",
    topics: ["pms", "mood"],
    keywords: ["difference", "severe", "diagnosis", "daily life"],
  },
  {
    id: "faq-pregnancy-test-timing", type: "faq",
    title: "When should I take a pregnancy test?",
    shortAnswer: "For the most accurate result, test on the first day of a missed period or at least 14 days after unprotected sex.",
    link: "/resources/faq/pregnancy-test-timing",
    topics: ["pregnancy"],
    keywords: ["when to test", "accuracy", "early", "false negative", "missed"],
  },
  {
    id: "faq-pcos-diagnosis", type: "faq",
    title: "How is PCOS diagnosed?",
    shortAnswer: "PCOS is diagnosed through a combination of symptoms, blood tests, and an ultrasound — no single test confirms it.",
    link: "/resources/faq/pcos-diagnosis",
    topics: ["pcos"],
    keywords: ["diagnosis", "blood test", "ultrasound", "scan", "confirmed"],
  },
  {
    id: "faq-hormones-mood", type: "faq",
    title: "Why do hormones affect my mood?",
    shortAnswer: "Oestrogen and progesterone influence serotonin and GABA, which regulate mood — so hormonal shifts can directly change how you feel.",
    link: "/resources/faq/hormones-mood",
    topics: ["hormones", "mood", "pms"],
    keywords: ["why", "serotonin", "feel", "chemical", "brain"],
  },

  // ── Glossary ─────────────────────────────────────────────────────────────────
  {
    id: "glos-lmp", type: "glossary",
    title: "LMP (Last Menstrual Period)",
    shortAnswer: "The date your most recent period started — used to calculate cycle length and estimated due dates.",
    link: "/resources/glossary/lmp",
    topics: ["menstruation", "late_period"],
    keywords: ["last period", "lmp", "start date"],
  },
  {
    id: "glos-luteal-phase", type: "glossary",
    title: "Luteal Phase",
    shortAnswer: "The second half of your cycle after ovulation, when progesterone rises to prepare the uterus for a possible pregnancy.",
    link: "/resources/glossary/luteal-phase",
    topics: ["menstruation", "pms", "hormones"],
    keywords: ["luteal", "second half", "progesterone", "after ovulation"],
  },
  {
    id: "glos-follicular-phase", type: "glossary",
    title: "Follicular Phase",
    shortAnswer: "The first half of your cycle, from day 1 of your period until ovulation, driven by rising oestrogen.",
    link: "/resources/glossary/follicular-phase",
    topics: ["menstruation", "ovulation", "hormones"],
    keywords: ["follicular", "first half", "oestrogen", "estrogen", "before ovulation"],
  },
  {
    id: "glos-ovulation", type: "glossary",
    title: "Ovulation",
    shortAnswer: "The release of a mature egg from the ovary, which typically happens once per cycle around the midpoint.",
    link: "/resources/glossary/ovulation",
    topics: ["ovulation"],
    keywords: ["egg", "release", "fertile", "lh surge"],
  },
  {
    id: "glos-dysmenorrhea", type: "glossary",
    title: "Dysmenorrhea",
    shortAnswer: "The medical term for painful periods — primary dysmenorrhea is common cramping; secondary is caused by an underlying condition.",
    link: "/resources/glossary/dysmenorrhea",
    topics: ["pelvic_pain"],
    keywords: ["dysmenorrhea", "painful", "prostaglandins"],
  },
  {
    id: "glos-amenorrhea", type: "glossary",
    title: "Amenorrhea",
    shortAnswer: "The absence of a period — primary means it never started; secondary means it stopped after previously being regular.",
    link: "/resources/glossary/amenorrhea",
    topics: ["late_period", "menstruation"],
    keywords: ["amenorrhea", "no period", "absent", "stopped"],
  },
  {
    id: "glos-progesterone", type: "glossary",
    title: "Progesterone",
    shortAnswer: "A hormone produced after ovulation that prepares the uterine lining for implantation and supports early pregnancy.",
    link: "/resources/glossary/progesterone",
    topics: ["hormones", "pregnancy"],
    keywords: ["progesterone", "corpus luteum", "uterine lining"],
  },
  {
    id: "glos-estrogen", type: "glossary",
    title: "Oestrogen (Estrogen)",
    shortAnswer: "The primary female sex hormone that drives the follicular phase, influences mood, bone density, and cardiovascular health.",
    link: "/resources/glossary/estrogen",
    topics: ["hormones", "menopause"],
    keywords: ["estrogen", "oestrogen", "hormone", "female"],
  },
  {
    id: "glos-implantation", type: "glossary",
    title: "Implantation",
    shortAnswer: "When a fertilised egg embeds in the uterine lining, which happens around 6–12 days after ovulation.",
    link: "/resources/glossary/implantation",
    topics: ["pregnancy", "spotting"],
    keywords: ["implantation", "embryo", "embed", "bleed"],
  },
];

const TYPE_PRIORITY = { pamphlet: 0, faq: 1, glossary: 2 };

function normalizeText(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAliases(text) {
  const found = new Set();
  const sortedAliases = Object.keys(ALIAS_MAP).sort((a, b) => b.length - a.length);
  for (const alias of sortedAliases) {
    if (text.includes(alias)) found.add(ALIAS_MAP[alias]);
  }
  return [...found];
}

function scoreEntry(entry, resolvedTopics, normalizedText) {
  let score = 0;
  for (const topic of resolvedTopics) {
    if (entry.topics.includes(topic)) score += 3;
  }
  for (const kw of entry.keywords) {
    if (normalizedText.includes(kw)) score += 1;
  }
  return score;
}

export function matchContentTopic(inputText, shownIds = [], declinedIds = []) {
  const normalized = normalizeText(inputText);
  if (!normalized) return null;

  const resolvedTopics = resolveAliases(normalized);
  if (resolvedTopics.length === 0 && normalized.length < 3) return null;

  const excluded = new Set([
    ...(Array.isArray(shownIds)    ? shownIds    : []),
    ...(Array.isArray(declinedIds) ? declinedIds : []),
  ]);

  const scored = CONTENT_CATALOG
    .filter(e => !excluded.has(e.id))
    .map(e => ({ entry: e, score: scoreEntry(e, resolvedTopics, normalized) }))
    .filter(({ score }) => score > 0);

  if (scored.length === 0) return null;

  scored.sort((a, b) =>
    b.score - a.score ||
    TYPE_PRIORITY[a.entry.type] - TYPE_PRIORITY[b.entry.type]
  );

  for (const typeFilter of ["pamphlet", "faq", "glossary"]) {
    const candidates = scored.filter(({ entry }) => entry.type === typeFilter);
    if (candidates.length === 0) continue;

    const topScore = candidates[0].score;
    const topTier  = candidates.filter(({ score }) => score === topScore);
    const chosen   = pick(topTier);
    if (!chosen) continue;

    const { entry } = chosen;
    const matchedTopic =
      resolvedTopics.find(t => entry.topics.includes(t)) ?? entry.topics[0];

    return {
      type: entry.type, id: entry.id, title: entry.title,
      shortAnswer: entry.shortAnswer, link: entry.link, matchedTopic,
    };
  }

  return null;
}

export function matchAllContentTopics(inputText, shownIds = [], declinedIds = [], limit = 3) {
  const normalized = normalizeText(inputText);
  if (!normalized) return [];

  const resolvedTopics = resolveAliases(normalized);
  if (resolvedTopics.length === 0 && normalized.length < 3) return [];

  const excluded = new Set([
    ...(Array.isArray(shownIds)    ? shownIds    : []),
    ...(Array.isArray(declinedIds) ? declinedIds : []),
  ]);

  const scored = CONTENT_CATALOG
    .filter(e => !excluded.has(e.id))
    .map(e => ({ entry: e, score: scoreEntry(e, resolvedTopics, normalized) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) =>
      TYPE_PRIORITY[a.entry.type] - TYPE_PRIORITY[b.entry.type] ||
      b.score - a.score
    );

  const results = [];
  const usedIds = new Set();

  for (const { entry } of scored) {
    if (usedIds.has(entry.id)) continue;
    usedIds.add(entry.id);

    const matchedTopic =
      resolvedTopics.find(t => entry.topics.includes(t)) ?? entry.topics[0];

    results.push({
      type: entry.type, id: entry.id, title: entry.title,
      shortAnswer: entry.shortAnswer, link: entry.link, matchedTopic,
    });

    if (results.length >= limit) break;
  }

  return results;
}
