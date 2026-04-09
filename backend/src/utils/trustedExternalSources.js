/**
 * src/utils/trustedExternalSources.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Trusted External Source Registry for Bloomie.
 *
 * getTrustedSources(topic) → { intro: string, sources: ExternalSource[] } | null
 *
 * Rules:
 *  • Whitelist only — no dynamic API calls, no runtime fetches.
 *  • Max 2 sources returned per topic.
 *  • Returns null when the topic is unrecognised.
 *  • Nothing is written to Bloomie memory.
 *  • Used as a last resort when no internal content (pamphlet / faq / glossary)
 *    matches the user's question.
 *
 * Each ExternalSource:
 *   title       — display name of the resource
 *   url         — canonical, stable URL (whitelisted)
 *   sourceName  — name of the organisation/publisher
 *   description — one-sentence description of what the page covers
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// Keys are canonical topic tokens (matching ALIAS_MAP in matchContentTopic.js).
// Each entry has an `intro` string and a `sources` array (order = preference).
// getTrustedSources() always slices to MAX_SOURCES before returning.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_SOURCES = 2;

export const TRUSTED_SOURCE_REGISTRY = {
  menstruation: {
    intro: "Here are a couple of reliable resources that go into more depth on menstrual health.",
    sources: [
      {
        title:       "Menstrual Cycle Overview",
        url:         "https://www.nhs.uk/conditions/periods/",
        sourceName:  "NHS (UK National Health Service)",
        description: "A clear, plain-language guide to the menstrual cycle, what is normal, and when to see a doctor.",
      },
      {
        title:       "Understanding Your Menstrual Cycle",
        url:         "https://www.plannedparenthood.org/learn/health-and-wellness/menstruation",
        sourceName:  "Planned Parenthood",
        description: "Covers cycle phases, common variations, and what different symptoms may mean.",
      },
    ],
  },

  late_period: {
    intro: "These resources explain the many reasons a period can be late beyond pregnancy.",
    sources: [
      {
        title:       "Missed or Late Periods",
        url:         "https://www.nhs.uk/conditions/stopped-or-missed-periods/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Lists common medical and lifestyle causes of a delayed or absent period.",
      },
      {
        title:       "Why Is My Period Late?",
        url:         "https://www.mayoclinic.org/healthy-lifestyle/womens-health/expert-answers/missed-period/faq-20058505",
        sourceName:  "Mayo Clinic",
        description: "Expert-reviewed explanation of factors that can delay menstruation.",
      },
    ],
  },

  heavy_bleeding: {
    intro: "These pages cover what counts as heavy bleeding and the options available.",
    sources: [
      {
        title:       "Heavy Periods (Menorrhagia)",
        url:         "https://www.nhs.uk/conditions/heavy-periods/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Explains causes, diagnosis, and treatment options for heavy menstrual bleeding.",
      },
      {
        title:       "Heavy Menstrual Bleeding",
        url:         "https://www.acog.org/womens-health/faqs/heavy-menstrual-bleeding",
        sourceName:  "American College of Obstetricians and Gynecologists (ACOG)",
        description: "Clinical overview of heavy periods from the leading OB-GYN professional body.",
      },
    ],
  },

  spotting: {
    intro: "These resources explain the common causes of spotting and when it needs attention.",
    sources: [
      {
        title:       "Bleeding Between Periods",
        url:         "https://www.nhs.uk/conditions/vaginal-bleeding-between-periods/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Covers intermenstrual bleeding causes, from ovulation spotting to underlying conditions.",
      },
      {
        title:       "Spotting Between Periods",
        url:         "https://www.plannedparenthood.org/learn/health-and-wellness/menstruation/what-causes-spotting-between-periods",
        sourceName:  "Planned Parenthood",
        description: "Plain-language breakdown of why spotting happens and what warrants a check-up.",
      },
    ],
  },

  pelvic_pain: {
    intro: "These pages cover the range of causes behind pelvic and period pain.",
    sources: [
      {
        title:       "Pelvic Pain",
        url:         "https://www.nhs.uk/conditions/pelvic-pain/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Overview of pelvic pain causes, from menstrual cramps to conditions needing investigation.",
      },
      {
        title:       "Dysmenorrhea: Painful Periods",
        url:         "https://www.acog.org/womens-health/faqs/dysmenorrhea-painful-periods",
        sourceName:  "American College of Obstetricians and Gynecologists (ACOG)",
        description: "Explains primary and secondary dysmenorrhea, causes, and management options.",
      },
    ],
  },

  ovulation: {
    intro: "These resources explain how ovulation works and how to identify your fertile window.",
    sources: [
      {
        title:       "How Can I Tell When I'm Ovulating?",
        url:         "https://www.nhs.uk/pregnancy/trying-for-a-baby/how-can-i-tell-when-i-am-ovulating/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Signs of ovulation, how to track your cycle, and what affects timing.",
      },
      {
        title:       "Ovulation",
        url:         "https://www.plannedparenthood.org/learn/pregnancy/ovulation",
        sourceName:  "Planned Parenthood",
        description: "Covers the ovulation process, fertile days, and how cycle length affects timing.",
      },
    ],
  },

  pms: {
    intro: "These pages explain PMS and PMDD — what causes them and what can help.",
    sources: [
      {
        title:       "Premenstrual Syndrome (PMS)",
        url:         "https://www.nhs.uk/conditions/premenstrual-syndrome/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Symptoms, causes, and self-care strategies for PMS and PMDD.",
      },
      {
        title:       "Premenstrual Dysphoric Disorder (PMDD)",
        url:         "https://www.acog.org/womens-health/faqs/premenstrual-syndrome",
        sourceName:  "American College of Obstetricians and Gynecologists (ACOG)",
        description: "Clinical overview of PMS and PMDD, including diagnostic criteria and treatment.",
      },
    ],
  },

  mood: {
    intro: "These resources look at how hormones and the menstrual cycle affect mood and mental health.",
    sources: [
      {
        title:       "Hormones and Mental Health",
        url:         "https://www.mind.org.uk/information-support/types-of-mental-health-problems/premenstrual-dysphoric-disorder-pmdd/",
        sourceName:  "Mind (UK Mental Health Charity)",
        description: "Explains how hormonal changes across the cycle can affect mental wellbeing.",
      },
      {
        title:       "Mood and the Menstrual Cycle",
        url:         "https://www.womenshealth.gov/mental-health/mental-health-conditions/premenstrual-syndrome",
        sourceName:  "Office on Women's Health (U.S. Department of Health)",
        description: "Overview of mood-related premenstrual symptoms and evidence-based coping strategies.",
      },
    ],
  },

  pregnancy: {
    intro: "These are reliable starting points if you think you may be pregnant or are planning a pregnancy.",
    sources: [
      {
        title:       "Am I Pregnant? Signs and Symptoms",
        url:         "https://www.nhs.uk/pregnancy/trying-for-a-baby/signs-and-symptoms-of-pregnancy/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Early pregnancy signs, when to test, and first steps after a positive result.",
      },
      {
        title:       "Pregnancy Tests",
        url:         "https://www.plannedparenthood.org/learn/pregnancy/pregnancy-tests",
        sourceName:  "Planned Parenthood",
        description: "How pregnancy tests work, when to take one, and what the results mean.",
      },
    ],
  },

  discharge: {
    intro: "These pages explain what normal discharge looks like and when changes need attention.",
    sources: [
      {
        title:       "Vaginal Discharge",
        url:         "https://www.nhs.uk/conditions/vaginal-discharge/",
        sourceName:  "NHS (UK National Health Service)",
        description: "What normal discharge looks like at different cycle stages and warning signs to watch for.",
      },
      {
        title:       "Vaginal Discharge: What's Normal?",
        url:         "https://www.plannedparenthood.org/learn/health-and-wellness/vaginal-discharge",
        sourceName:  "Planned Parenthood",
        description: "Plain-language guide to normal vs. abnormal discharge, including infection signs.",
      },
    ],
  },

  contraception: {
    intro: "These resources give a thorough overview of contraceptive options and how they work.",
    sources: [
      {
        title:       "Contraception Guide",
        url:         "https://www.nhs.uk/contraception/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Comprehensive, evidence-based guide to every contraceptive method including effectiveness rates.",
      },
      {
        title:       "Birth Control",
        url:         "https://www.plannedparenthood.org/learn/birth-control",
        sourceName:  "Planned Parenthood",
        description: "Detailed comparisons of contraceptive methods, including how to use them correctly.",
      },
    ],
  },

  pcos: {
    intro: "These resources provide reliable information about PCOS, its symptoms, and management.",
    sources: [
      {
        title:       "Polycystic Ovary Syndrome (PCOS)",
        url:         "https://www.nhs.uk/conditions/polycystic-ovary-syndrome-pcos/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Symptoms, diagnosis, and treatment options for PCOS from an evidence-based source.",
      },
      {
        title:       "What Is PCOS?",
        url:         "https://www.acog.org/womens-health/faqs/polycystic-ovary-syndrome-pcos",
        sourceName:  "American College of Obstetricians and Gynecologists (ACOG)",
        description: "Clinical explanation of PCOS covering hormonal causes, fertility effects, and management.",
      },
    ],
  },

  hormones: {
    intro: "These pages explain how key reproductive hormones work and how they affect the body.",
    sources: [
      {
        title:       "Female Hormones",
        url:         "https://www.womenshealth.gov/menstrual-cycle/your-menstrual-cycle",
        sourceName:  "Office on Women's Health (U.S. Department of Health)",
        description: "How oestrogen, progesterone, and other hormones drive the menstrual cycle.",
      },
      {
        title:       "Hormonal Imbalance",
        url:         "https://my.clevelandclinic.org/health/diseases/22673-hormonal-imbalance",
        sourceName:  "Cleveland Clinic",
        description: "Signs of hormonal imbalance, common causes, and when to seek medical advice.",
      },
    ],
  },

  menopause: {
    intro: "These resources cover perimenopause, menopause, and the support available.",
    sources: [
      {
        title:       "Menopause",
        url:         "https://www.nhs.uk/conditions/menopause/",
        sourceName:  "NHS (UK National Health Service)",
        description: "Symptoms, stages, and treatment options including HRT, written in plain language.",
      },
      {
        title:       "Menopause",
        url:         "https://www.acog.org/womens-health/faqs/menopause",
        sourceName:  "American College of Obstetricians and Gynecologists (ACOG)",
        description: "Clinical overview of menopause, perimenopause, and available therapies.",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getTrustedSources(topic) → { intro: string, sources: ExternalSource[] } | null
 *
 * @param {string} topic — canonical topic token (e.g. "pcos", "menstruation")
 *
 * @returns {{
 *   intro:   string,
 *   sources: Array<{
 *     title:       string,
 *     url:         string,
 *     sourceName:  string,
 *     description: string,
 *   }>
 * } | null}
 *
 * Returns null when the topic has no registered sources.
 * Always returns at most MAX_SOURCES (2) entries.
 * Never writes to Bloomie memory. Never calls external APIs.
 */
export function getTrustedSources(topic) {
  if (typeof topic !== "string" || !topic.trim()) return null;

  const entry = TRUSTED_SOURCE_REGISTRY[topic.trim().toLowerCase()];
  if (!entry) return null;

  return {
    intro:   entry.intro,
    sources: entry.sources.slice(0, MAX_SOURCES),
  };
}
