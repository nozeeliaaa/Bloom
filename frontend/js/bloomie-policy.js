/**
 * bloomie-policy.js
 * Centralized policy context + decision helpers for Bloomie.
 * Deterministic only: no generated user-facing prose beyond fixed templates.
 */

const ALLOWED_TOPICS = new Set([
  "period",
  "cycle",
  "pregnancy",
  "sti",
  "contraception",
  "discharge",
  "pelvic_pain",
  "mood",
  "safety",
  "other",
]);

export function deriveAgeGroup({ declaredAge = null, seedAgeGroup = "unknown", seedAge = null, isMinor = false } = {}) {
  if (typeof declaredAge === "number" && Number.isFinite(declaredAge)) {
    return declaredAge <= 17 ? "minor" : "adult";
  }
  if (typeof seedAge === "number" && Number.isFinite(seedAge)) {
    return seedAge <= 17 ? "minor" : "adult";
  }
  if (isMinor) return "minor";
  if (seedAgeGroup === "adult" || seedAgeGroup === "minor") return seedAgeGroup;
  return "unknown";
}

function detectTopic({ text = "", entities = null, tags = [] } = {}) {
  const t = String(text || "").toLowerCase();
  const s = entities?.symptoms || {};
  const tagSet = new Set(tags || []);

  if (s.heavy || s.large_clots || s.pelvic || s.one_sided_pain || s.dizziness || tagSet.has("red_flag")) return "safety";
  if (s.pregnant || s.late || tagSet.has("pregnancy_concern")) return "pregnancy";
  if (s.unusual_discharge || s.discharge || s.odor || tagSet.has("discharge")) return "discharge";
  if (s.pelvic || s.cramps || tagSet.has("cramps") || tagSet.has("pelvic_pain")) return "pelvic_pain";
  if (s.mood || tagSet.has("mood_change")) return "mood";
  if (s.late || s.heavy || s.spotting || t.includes("period") || t.includes("cycle")) return "cycle";
  if (/\b(std|sti|hiv|herpes|gonorrhea|chlamydia|syphilis)\b/.test(t)) return "sti";
  if (/\b(condom|birth control|contraception|plan b|emergency contraception|pill|iud|implant)\b/.test(t)) return "contraception";
  if (/\b(pregnan|test|late period|missed period)\b/.test(t)) return "pregnancy";
  return "other";
}

function detectUnsafeTopic(text = "") {
  const t = String(text || "").toLowerCase();
  const sexualRoleplay = /\b(role ?play|sext|sex chat|dirty talk|nudes?|send (me )?(pics?|photo)|show (me )?(your )?(body|breasts?|boobs?|nude)|horny|turn me on|let'?s have sex|moan)\b/;
  return sexualRoleplay.test(t);
}

function classifyRiskLevel({ text = "", entities = null, tags = [] } = {}) {
  const t = String(text || "").toLowerCase();
  const s = entities?.symptoms || {};
  const tagSet = new Set(tags || []);

  const high = (
    entities?.urgent ||
    s.heavy ||
    s.large_clots ||
    s.dizziness ||
    s.one_sided_pain ||
    /\b(faint|fainting|passed out|can't breathe|cant breathe|shortness of breath|severe pain|unbearable pain|very heavy bleeding|soaking through)\b/.test(t) ||
    /\b(rape|raped|sexual assault|forced me|against my will|abuse|abused|molest)\b/.test(t) ||
    /\b(suicide|kill myself|end my life|self harm|self-harm)\b/.test(t) ||
    tagSet.has("red_flag")
  );
  if (high) return "high";

  const medium = (
    s.late ||
    s.spotting ||
    s.pelvic ||
    s.discharge ||
    s.nausea ||
    s.fatigue ||
    /\b(condom broke|condom bruk|pregnan|sti|burning when i pee|itching|discharge|late period|missed period|scared|anxious)\b/.test(t)
  );
  if (medium) return "medium";

  return "low";
}

function computeConfidence({ tags = [], entities = null } = {}) {
  const symptomCount = Object.values(entities?.symptoms || {}).filter(Boolean).length;
  if ((tags || []).length >= 2 || symptomCount >= 2) return "high";
  if ((tags || []).length === 1 || symptomCount === 1) return "medium";
  return "low";
}

export function buildPolicyContext({
  ctx,
  normalizedText,
  entities,
  tags,
  repair,
  policySeed = null,
}) {
  const seed = policySeed || {};
  const ageGroup = deriveAgeGroup({
    declaredAge: ctx?.declaredAge ?? null,
    seedAgeGroup: seed.ageGroup || "unknown",
    seedAge: seed.age ?? null,
    isMinor: !!ctx?.isMinor,
  });

  const mode = ctx?.isAnon ? "anonymous" : "registered";
  const hasGuardianConsent = Boolean(seed.hasGuardianConsent);
  const topic = detectTopic({ text: normalizedText, entities, tags });
  const riskLevel = classifyRiskLevel({ text: normalizedText, entities, tags });
  const confidence = computeConfidence({ tags, entities });
  const isUnsafeTopic = detectUnsafeTopic(normalizedText);
  const isSensitiveTopic = ["pregnancy", "sti", "contraception", "safety", "discharge"].includes(topic);

  return {
    ageGroup,
    hasGuardianConsent,
    mode,
    topic: ALLOWED_TOPICS.has(topic) ? topic : "other",
    riskLevel,
    confidence,
    isSensitiveTopic,
    isUnsafeTopic,
    repairLabel: repair?.label || null,
  };
}

export function evaluatePolicyDecision(policyCtx) {
  if (!policyCtx) return { action: "allow" };

  if (policyCtx.isUnsafeTopic) {
    return {
      action: "hard_block_unsafe_topic",
      reply: [
        "I can't help with sexual roleplay or explicit sexual chat.",
        "If you have a reproductive health question, I can help with that safely 🩷",
      ],
      next: "START_MENU",
    };
  }

  if (policyCtx.ageGroup === "minor" && !policyCtx.hasGuardianConsent) {
    return {
      action: "block_minor_no_consent",
      reply: [
        "I want to support you safely 🩷",
        "For medical/reproductive questions, a parent or guardian needs to complete consent first.",
        "Please ask a parent/guardian to help with consent, or reach out to a school nurse or another trusted adult.",
      ],
      next: "POLICY_MINOR_CONSENT_REQUIRED",
    };
  }

  // High-risk content still stays in normal safety pipeline;
  // this flag helps style/escalation behavior downstream.
  if (policyCtx.riskLevel === "high") {
    return { action: "elevate", trustedAdultNudge: policyCtx.ageGroup === "minor" };
  }

  return { action: "allow", trustedAdultNudge: policyCtx.ageGroup === "minor" && policyCtx.riskLevel !== "low" };
}

export function getAnonymousDisclosure(ctx) {
  if (!ctx?.isAnon) return null;
  if (ctx.policyAnonDisclosureShown) return null;
  ctx.policyAnonDisclosureShown = true;
  return "Quick note: you're in anonymous mode, so this chat isn't saved to your account and PDF export isn't available in this mode 🩷";
}

export function sanitizeMinorEnglishLine(line) {
  let text = String(line || "");
  if (!text.trim()) return text;

  const replacements = [
    [/\bmi\b/gi, "I"],
    [/\bnuh\b/gi, "not"],
    [/\bwah\b/gi, "what"],
    [/\byuh\b/gi, "you"],
    [/\bfi\b/gi, "for"],
    [/\bgyal\b/gi, "friend"],
    [/\bdi\b/gi, "the"],
    [/\btek\b/gi, "take"],
    [/\bcyan\b/gi, "cannot"],
    [/\bkmt\b/gi, ""],
    [/\bwah gwaan\b/gi, "hi"],
    [/\bbig up\b/gi, "thank you"],
  ];

  for (const [rx, value] of replacements) {
    text = text.replace(rx, value);
  }

  return text.replace(/\s{2,}/g, " ").trim();
}
