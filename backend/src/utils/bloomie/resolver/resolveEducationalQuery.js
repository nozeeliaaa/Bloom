/**
 * src/utils/bloomie/resolver/resolveEducationalQuery.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomie Educational Answer Resolver.
 *
 * resolveEducationalQuery(inputText, context?) → EducationalResponse
 *
 * Flow:
 *   1. Normalise input and resolve canonical topic via ALIAS_MAP.
 *   2. Detect question intent (definition / normalcy / cause / timing / general).
 *   3. Look up a pre-written answer template — deterministic, no LLM calls.
 *   4. Attach best content: internal (pamphlet → faq → glossary) first,
 *      then external sources if nothing internal matched.
 *   5. Return { answer, suggestion, followUp }.
 *
 * Rules:
 *  • NO diagnosis.
 *  • NO certainty claims.
 *  • NO medical instructions beyond general advice.
 *  • Supportive tone throughout.
 *  • Nothing written to Bloomie memory.
 *  • Fully deterministic.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ALIAS_MAP, matchContentTopic } from "../routing/matchContentTopic.js";
import { getTrustedSources }            from "../routing/trustedExternalSources.js";
import { buildFutureCapabilityLine, detectFutureCapabilityContext } from "../messaging/buildFutureCapabilityLine.js";

// ─────────────────────────────────────────────────────────────────────────────
// Text helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_PATTERNS = [
  { intent: "definition", pattern: /\b(what is|what are|what's|what exactly|tell me about|explain|describe|define)\b/i },
  { intent: "normalcy",   pattern: /\b(is it normal|am i normal|should i worry|is this okay|is this fine|is this normal|worried about|concern(ed)?)\b/i },
  { intent: "cause",      pattern: /\b(why|what causes|what.s causing|why do i|why am i|what makes|caused by|reason for)\b/i },
  { intent: "timing",     pattern: /\b(when|how long|how many days|how often|what day|at what point|timing|duration)\b/i },
];

function detectIntent(normalizedText) {
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(normalizedText)) return intent;
  }
  return "general";
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer templates — topic → intent → string
// ─────────────────────────────────────────────────────────────────────────────

const ANSWER_TEMPLATES = {
  menstruation: {
    definition: "Menstruation is the monthly shedding of the uterine lining when pregnancy hasn't occurred. The cycle has four phases — menstrual, follicular, ovulation, and luteal — each driven by shifting hormone levels.",
    normalcy:   "A lot of variation in cycle length, flow, and symptoms is completely normal. What matters most is understanding what's typical for your body, so you can notice when something feels different.",
    cause:      "Menstruation is triggered when progesterone levels drop after ovulation, signalling the uterine lining to shed. Factors like stress, diet, weight changes, or illness can influence timing.",
    timing:     "Most periods last between 2 and 7 days, and a typical cycle runs 21–35 days. Your cycle starts on day 1 of your period.",
    general:    "Menstruation is a natural part of the reproductive cycle, and there's a wide range of what's considered normal — in flow, length, and symptoms. Your cycle can shift based on stress, lifestyle, and hormonal changes.",
  },
  late_period: {
    definition: "A late period means your period hasn't arrived by the end of what would normally be your cycle. Many things beyond pregnancy can cause a delay, including stress, illness, weight changes, and hormonal shifts.",
    normalcy:   "An occasional late period is very common and not always a cause for concern. Stress, travel, diet changes, and illness can all temporarily delay your cycle.",
    cause:      "Periods can be late for many reasons — stress, significant weight changes, thyroid fluctuations, or hormonal imbalances are among the most common. Pregnancy is one possibility, but far from the only one.",
    timing:     "If your period is more than a week or two late and pregnancy is a possibility, a test taken on or after a missed period is most accurate. Regularly irregular cycles are worth discussing with a healthcare provider.",
    general:    "A late period is one of the most common concerns people have about their cycle. Many things beyond pregnancy can cause a delay — stress, hormonal shifts, or changes in routine are frequent reasons.",
  },
  heavy_bleeding: {
    definition: "Heavy menstrual bleeding — medically called menorrhagia — is generally defined as soaking through a pad or tampon every hour for several hours in a row. There are many possible causes, from hormonal imbalances to conditions like fibroids.",
    normalcy:   "While some variation in flow is normal, consistently very heavy bleeding can affect iron levels and daily quality of life. It's worth discussing with a healthcare provider if it regularly disrupts your routine.",
    cause:      "Heavy bleeding can result from hormonal imbalances, fibroids, polyps, or conditions like adenomyosis or thyroid issues. It's not always a sign of something serious, but it is worth investigating if it's a regular pattern.",
    timing:     "Soaking through a pad or tampon in under an hour for two or more consecutive hours is generally considered heavy. If this happens most cycles, it's worth bringing up with a healthcare provider.",
    general:    "Heavy menstrual bleeding is a common concern that has many possible causes — hormonal and structural. It's always worth paying attention to, especially if it's affecting your energy or daily life.",
  },
  spotting: {
    definition: "Spotting refers to light bleeding that happens outside of a regular period. It can appear as pink, brown, or light red discharge and has a range of causes across the cycle.",
    normalcy:   "Light spotting mid-cycle is quite common and often harmless — it can be related to ovulation or hormonal fluctuations. Persistent spotting, or spotting after sex or after menopause, is worth checking with a healthcare provider.",
    cause:      "Spotting can be caused by ovulation, hormonal contraception adjusting in your body, implantation, or small hormonal shifts. It can occasionally signal an infection or other condition, especially if it's frequent or comes with other symptoms.",
    timing:     "Spotting around the middle of your cycle often coincides with ovulation. Implantation spotting, if it occurs, usually appears around 6–12 days after ovulation.",
    general:    "Spotting — light bleeding outside of your regular period — can happen at different points in the cycle and usually has a straightforward cause. It's worth noting if it becomes frequent or is accompanied by pain.",
  },
  pelvic_pain: {
    definition: "Pelvic pain is a broad term covering discomfort in the lower abdomen or pelvis. It can include menstrual cramps, ovulation pain, or pain related to an underlying condition.",
    normalcy:   "Some degree of cramping during a period is common — it's caused by the uterus contracting to shed its lining. Pain that disrupts daily activities, requires strong pain relief regularly, or is getting worse over time is worth investigating.",
    cause:      "Period pain is caused by prostaglandins — chemicals that cause the uterus to contract. In some cases, more significant pain is linked to conditions like endometriosis, fibroids, or ovarian cysts.",
    timing:     "Menstrual cramps typically start just before or on the first day of a period and ease within 1–3 days. Pain that begins mid-cycle or persists throughout the month may have a different cause and is worth exploring.",
    general:    "Pelvic pain can range from mild cramping to more significant discomfort depending on what's behind it. Mild pain that follows your cycle is common, but persistent or escalating pain is worth discussing with a healthcare provider.",
  },
  ovulation: {
    definition: "Ovulation is the release of a mature egg from the ovary, usually once per cycle. It typically happens about 12–16 days before the next expected period.",
    normalcy:   "Some light one-sided pain during ovulation — known as mittelschmerz — is completely normal. Most people also notice a change in discharge around this time, becoming clearer and more stretchy.",
    cause:      "Ovulation is triggered by a surge in luteinising hormone (LH), which signals the ovary to release an egg. The timing is influenced by cycle length, so it doesn't always fall on day 14.",
    timing:     "Ovulation doesn't always happen on day 14 — that only applies to a 28-day cycle. It typically occurs about 14 days before your next period, so it shifts based on your cycle length.",
    general:    "Ovulation is when one of your ovaries releases a mature egg — it marks the beginning of your fertile window. It's often accompanied by subtle changes in discharge, body temperature, and sometimes mild cramping.",
  },
  pms: {
    definition: "Premenstrual syndrome (PMS) refers to a group of physical and emotional symptoms that appear in the days before a period. They're related to hormonal shifts in the second half of the cycle and typically ease once a period starts.",
    normalcy:   "PMS is very common — many people experience some degree of mood changes, bloating, or breast tenderness before their period. When symptoms are severe enough to significantly affect daily life, that's closer to PMDD, which is worth discussing with a provider.",
    cause:      "PMS is thought to be triggered by the drop in oestrogen and progesterone that happens in the luteal phase. These hormones interact with serotonin and other mood-regulating chemicals in the brain.",
    timing:     "PMS symptoms typically appear 1–2 weeks before a period and ease within a day or two of it starting. Keeping track of when symptoms appear each cycle can help identify patterns.",
    general:    "PMS involves physical and emotional symptoms tied to the hormonal changes of the second half of the cycle. The range of what people experience varies widely — from mild to quite disruptive.",
  },
  mood: {
    definition: "Mood changes across the menstrual cycle are rooted in the way hormones — particularly oestrogen and progesterone — influence serotonin and GABA, the brain chemicals that regulate how we feel.",
    normalcy:   "Feeling more emotional, anxious, or low at certain points in the cycle is common and has a real physiological basis. When mood changes are significantly affecting relationships or daily functioning, it's worth talking to a healthcare provider.",
    cause:      "Hormonal shifts — particularly the drop in oestrogen before a period — can lower serotonin levels, contributing to low mood, irritability, or anxiety. This is a physiological response, not a personal shortcoming.",
    timing:     "Many people notice mood is more stable in the first half of the cycle (follicular phase) and more variable in the second half (luteal phase), particularly in the week before a period.",
    general:    "Mood changes across the cycle are real and rooted in biology — oestrogen and progesterone directly affect serotonin. Many people notice they feel noticeably different in the first and second halves of their cycle.",
  },
  pregnancy: {
    definition: "Early pregnancy can cause a range of symptoms — a missed period, breast tenderness, nausea, and fatigue are among the most common. The most reliable way to confirm pregnancy is with a test taken on or after a missed period.",
    normalcy:   "Many people experience no symptoms in very early pregnancy, while others have strong symptoms from the start — both are common. A home pregnancy test taken after a missed period is usually accurate.",
    cause:      "A pregnancy test detects hCG, a hormone produced after a fertilised egg implants in the uterine lining. Levels rise quickly in early pregnancy, which is why testing too early can give a false negative.",
    timing:     "For the most accurate result, take a pregnancy test on the first day of a missed period or at least 14 days after unprotected sex. Testing earlier than this increases the chance of a false negative.",
    general:    "A missed period is often the first sign of pregnancy, but early symptoms vary widely. The most reliable confirmation is a home test taken on or after the day a period was expected.",
  },
  discharge: {
    definition: "Vaginal discharge is fluid produced by glands in the cervix and vagina. It changes in consistency and volume across the cycle — from thicker and creamy to clear and stretchy around ovulation.",
    normalcy:   "Discharge that's clear to white, odourless or mildly scented, and changes in texture across the month is normal. Discharge with a strong smell, unusual colour (green, grey), or that causes itching may indicate an infection worth checking.",
    cause:      "Discharge changes are driven by hormonal shifts across the cycle. Around ovulation, rising oestrogen produces clear, stretchy discharge; after ovulation, it typically becomes thicker and less noticeable.",
    timing:     "Discharge is usually most noticeable around ovulation, when it becomes clear and stretchy. In the days before a period and right after, many people notice little to no discharge.",
    general:    "Vaginal discharge is a natural and healthy part of the reproductive cycle. It changes across the month, and learning what's normal for your body is one of the most useful things you can track.",
  },
  contraception: {
    definition: "Contraception refers to methods used to prevent pregnancy. Options include hormonal methods (pill, patch, injection, implant, hormonal IUD), barrier methods (condoms), and long-acting reversible contraceptives (LARCs) like copper IUDs.",
    normalcy:   "It's common for it to take some time to find a contraceptive method that suits your body and lifestyle. Hormonal methods can affect cycle patterns, mood, and skin differently in different people.",
    cause:      "Different contraceptive methods work in different ways — some prevent ovulation, some affect the cervical mucus, and some prevent implantation. Effectiveness depends on the method and how consistently it's used.",
    timing:     "How quickly contraception takes effect depends on the method and when in the cycle it's started. A healthcare provider can advise on the safest approach for the method you're considering.",
    general:    "There are many contraceptive options available, each with different methods, effectiveness rates, and effects on the body. Finding the right fit often involves considering personal health, lifestyle, and what matters most to you.",
  },
  pcos: {
    definition: "Polycystic ovary syndrome (PCOS) is a hormonal condition that can affect the ovaries and cause irregular periods, higher androgen levels, and sometimes small follicles visible on an ultrasound. It's one of the most common hormonal conditions in people with ovaries.",
    normalcy:   "PCOS looks different in every person — not everyone with PCOS has cysts, irregular periods, or all the classic symptoms. A diagnosis is made through a combination of symptoms, blood tests, and sometimes an ultrasound — no single test confirms it alone.",
    cause:      "The exact cause of PCOS isn't fully understood, but insulin resistance and elevated androgen levels are thought to play a central role. There's also a genetic component — it tends to run in families.",
    timing:     "PCOS symptoms often become noticeable in the teens and early twenties, though it's commonly diagnosed later. Irregular periods — fewer than eight per year or cycles longer than 35 days — are often the first sign.",
    general:    "PCOS is a hormonal condition that can affect cycle regularity, fertility, skin, and mood. It presents differently in different people and is manageable with the right support and information.",
  },
  hormones: {
    definition: "Reproductive hormones — primarily oestrogen, progesterone, LH, and FSH — work together to regulate the menstrual cycle and ovulation. They fluctuate in predictable patterns across the cycle and influence mood, energy, and physical symptoms.",
    normalcy:   "Hormonal fluctuations across the cycle are normal and are what drive many of the changes people notice in energy, mood, and physical symptoms at different points in the month.",
    cause:      "Hormonal imbalances can result from stress, weight changes, thyroid issues, PCOS, or other conditions. Blood tests are usually the first step in exploring whether hormone levels are within a healthy range.",
    timing:     "Hormone levels shift continuously across the cycle. Oestrogen rises in the first half, peaks at ovulation, then falls; progesterone rises after ovulation and drops before the period starts.",
    general:    "Reproductive hormones regulate far more than just the menstrual cycle — they influence mood, energy, skin, and how the body feels day to day. Understanding when they shift can make a lot of cycle experiences feel more predictable.",
  },
  menopause: {
    definition: "Menopause is defined as 12 consecutive months without a period, usually occurring in the late 40s to early 50s. The transition — perimenopause — can begin years earlier and involves gradually shifting hormone levels.",
    normalcy:   "Symptoms vary widely — some people experience very few changes while others find the transition significantly affects their quality of life. Both experiences are valid, and effective support is available for managing symptoms.",
    cause:      "Menopause occurs when the ovaries gradually stop producing oestrogen and progesterone. This hormonal shift is what drives the range of symptoms — hot flushes, sleep changes, mood shifts — often associated with this stage of life.",
    timing:     "Perimenopause can start anywhere from 2 to 10 years before the final period. Average age of menopause is 51, though anything between 45 and 55 is within the typical range.",
    general:    "Menopause is a natural life stage that involves significant hormonal changes over a period of years. The experience varies widely, and understanding what's happening in the body can make the transition feel more navigable.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Follow-up prompts
// ─────────────────────────────────────────────────────────────────────────────

const FOLLOW_UPS = {
  menstruation:   "Is there a specific part of your cycle you'd like to understand better?",
  late_period:    "Would it help to look at what else might be affecting your cycle timing?",
  heavy_bleeding: "Would you like to see information on what support is available for heavy bleeding?",
  spotting:       "Is the spotting happening at a particular point in your cycle?",
  pelvic_pain:    "Would you like to learn more about the different types of pelvic pain?",
  ovulation:      "Are you trying to understand your fertile window, or just tracking how you feel?",
  pms:            "Would it help to know more about ways to manage PMS symptoms?",
  mood:           "Is there a particular point in your cycle when you notice mood changes most?",
  pregnancy:      "Would you like to know more about early pregnancy signs or when to take a test?",
  discharge:      "Has there been a change in your discharge recently that you wanted to understand?",
  contraception:  "Is there a particular method you'd like to know more about?",
  pcos:           "Would it help to see information on how PCOS is diagnosed and managed?",
  hormones:       "Is there a specific hormone or symptom you'd like to understand better?",
  menopause:      "Would you like to know more about what to expect during perimenopause or menopause?",
};

// ─────────────────────────────────────────────────────────────────────────────
// Unsupported response
// ─────────────────────────────────────────────────────────────────────────────

const UNSUPPORTED_RESPONSE = Object.freeze({
  answer:     "I'm sorry 🩷 I'm not able to answer that, but I can help with your cycle, symptoms, or reproductive health questions.",
  suggestion: null,
  followUp:   null,
});

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function buildAnswer(topic, intent, context) {
  const topicTemplates = ANSWER_TEMPLATES[topic];
  if (!topicTemplates) return UNSUPPORTED_RESPONSE.answer;

  const template = topicTemplates[intent] ?? topicTemplates.general;

  const nickname = typeof context?.nickname === "string" && context.nickname.trim()
    ? context.nickname.trim()
    : null;

  return nickname
    ? `${nickname}, ${template.charAt(0).toLowerCase()}${template.slice(1)}`
    : template;
}

function buildSuggestion(inputText, primaryTopic) {
  const internal = matchContentTopic(inputText, [], []);
  if (internal) return { kind: "internal", ...internal };

  const external = getTrustedSources(primaryTopic);
  if (external) return { kind: "external", ...external };

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * resolveEducationalQuery(inputText, context?) → EducationalResponse
 *
 * Response shape:
 *   { answer, suggestion, followUp, futureCapabilityLine }
 *
 * futureCapabilityLine — one safe, future-framed line that may be appended
 * to the response when the user's query touches on personalisation, Bloom's
 * improvement, or future product capabilities. Always null during urgent flows.
 * Callers may display it as an optional trailing sentence or omit it entirely.
 */
export function resolveEducationalQuery(inputText, context = null) {
  if (typeof inputText !== "string" || !inputText.trim()) {
    return { ...UNSUPPORTED_RESPONSE, futureCapabilityLine: null };
  }

  const raw        = inputText.trim().slice(0, 500);
  const normalized = normalizeText(raw);
  if (normalized.length < 2) return { ...UNSUPPORTED_RESPONSE, futureCapabilityLine: null };

  const resolvedTopics = resolveAliases(normalized);
  if (resolvedTopics.length === 0) return { ...UNSUPPORTED_RESPONSE, futureCapabilityLine: null };

  const primaryTopic = resolvedTopics[0];
  if (!ANSWER_TEMPLATES[primaryTopic]) return { ...UNSUPPORTED_RESPONSE, futureCapabilityLine: null };

  const intent     = detectIntent(normalized);
  const answer     = buildAnswer(primaryTopic, intent, context);
  const suggestion = buildSuggestion(raw, primaryTopic);
  const followUp   = FOLLOW_UPS[primaryTopic] ?? null;

  // Attach a future-capability line when the query touches on personalisation
  // or Bloom's improvement — never during urgent flows.
  const urgentFlag          = context?.urgentFlag === true;
  const futureCtx           = detectFutureCapabilityContext(raw);
  const futureCapabilityLine = buildFutureCapabilityLine(futureCtx ?? "general", { urgentFlag });

  // Only surface the line for relevant queries (personalisation/improvement/
  // future products), not for every health topic response.
  const attachLine = futureCtx !== null && !urgentFlag;

  return { answer, suggestion, followUp, futureCapabilityLine: attachLine ? futureCapabilityLine : null };
}

export {
  detectIntent, resolveAliases, normalizeText,
  ANSWER_TEMPLATES, FOLLOW_UPS, UNSUPPORTED_RESPONSE,
};

export { buildFutureCapabilityLine, detectFutureCapabilityContext } from "../messaging/buildFutureCapabilityLine.js";
