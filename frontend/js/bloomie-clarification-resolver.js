import { promptFingerprint } from "./bloomie-clarifier.js";

function toSet(values = []) {
  return values instanceof Set ? values : new Set(values);
}

function normalize(text = "") {
  return String(text || "").toLowerCase().trim();
}

export function createPendingClarification({
  prompt = "",
  kind = "clarifier",
  originalText = "",
  spec = null,
} = {}) {
  const resolvedSpec = spec?.key
    ? {
        key: spec.key,
        expectedDomain: spec.expectedDomain ?? null,
        expectedValues: Array.isArray(spec.expectedValues) ? [...spec.expectedValues] : [],
      }
    : {
        key: `clarifier_${promptFingerprint(prompt) || kind || "generic"}`,
        expectedDomain: null,
        expectedValues: [],
      };

  return {
    key: resolvedSpec.key,
    kind,
    prompt,
    originalText,
    expectedDomain: resolvedSpec.expectedDomain,
    expectedValues: resolvedSpec.expectedValues,
    status: "pending",
  };
}

function resolvePainLocationReply(t) {
  if (/\b(my |the )?back|lower back\b/.test(t)) return { value: "back" };
  if (/\bpelvic|lower pelvic|lower abdomen|lower belly|cramps?\b/.test(t)) return { value: "pelvic" };
  if (/\bstomach\b/.test(t)) return { value: "stomach_general" };
  if (/\bbelly\b/.test(t) || /\bin general\b/.test(t) || /\ball over\b/.test(t)) return { value: "belly_general" };
  if (/\bsomewhere else|elsewhere|different place\b/.test(t)) return { value: "elsewhere" };
  return null;
}

function resolveBleedingAmountReply(t) {
  if (/\bsoaking|flooding|very heavy|heavy\b/.test(t)) return { value: "heavy" };
  if (/\bmanageable|not too bad|heavier than usual\b/.test(t)) return { value: "manageable" };
  if (/\blight spotting|just spotting|spotting\b/.test(t)) return { value: "spotting" };
  if (/\bnormal period|period-like|like my period\b/.test(t)) return { value: "period_like" };
  return null;
}

function resolveDischargeReply(t) {
  if (/\byellow|green|grey|gray|brown|pink|white\b/.test(t)) return { value: "color" };
  if (/\bsmell|odou?r|fishy|foul\b/.test(t)) return { value: "smell" };
  if (/\btexture|thick|clumpy|sticky|creamy\b/.test(t)) return { value: "texture" };
  if (/\bmore than usual|a lot more|more\b/.test(t)) return { value: "amount" };
  if (/\bpain|pelvic\b/.test(t)) return { value: "pain" };
  if (/\bitch|burn|irritat/i.test(t)) return { value: "irritation" };
  return null;
}

function resolveDizzinessReply(t) {
  if (/\bon its own|by itself|just dizzy\b/.test(t)) return { value: "on_its_own" };
  if (/\bbleeding|with blood|with spotting|with my period\b/.test(t)) return { value: "with_bleeding" };
  return null;
}

function resolveGeneralSymptomReply(t) {
  if (/\bnausea|queasy|sick to my stomach\b/.test(t)) return { value: "nausea" };
  if (/\bchills|fever|feverish\b/.test(t)) return { value: "feverish" };
  if (/\bgenerally unwell|unwell|off overall|whole body\b/.test(t)) return { value: "generally_unwell" };
  return null;
}

function isDeclineReply(t) {
  return /\b(nuh bada|nuh bother|forget it|forget that|never mind|nevermind|leave it|no mind|bother that|drop it)\b/.test(t);
}

function isUnclearReply(t) {
  return /^(idk|i don'?t know|i dont know|not sure|unsure|hard to say|can't tell|cant tell)$/.test(t);
}

export function resolveClarificationReply(reply, pendingClarification, context = {}) {
  const pending = pendingClarification || null;
  if (!pending) return null;

  const t = normalize(reply);
  const detectInputDomains = context.detectInputDomains || (() => new Set());
  const explicitDomains = toSet(detectInputDomains(context.entities || {}, { explicitOnly: true }));

  if (explicitDomains.size) {
    if (!pending.expectedDomain || explicitDomains.has(pending.expectedDomain)) {
      // fall through to domain-specific resolution when available
    } else {
      return {
        status: "redirected",
        pendingClarification: { ...pending, status: "redirected" },
        domains: [...explicitDomains],
      };
    }
  }

  if (isDeclineReply(t)) {
    return {
      status: "declined",
      pendingClarification: { ...pending, status: "declined" },
    };
  }

  if (isUnclearReply(t)) {
    return {
      status: "unclear",
      pendingClarification: { ...pending, status: "unclear" },
    };
  }

  if (pending.expectedValues?.includes("random") && /\brandom\b/.test(t)) {
    return {
      status: "resolved",
      value: "random",
      pendingClarification: { ...pending, status: "resolved" },
    };
  }

  const resolvers = {
    pain_location: resolvePainLocationReply,
    bleeding_amount: resolveBleedingAmountReply,
    discharge_descriptor: resolveDischargeReply,
    dizziness_context: resolveDizzinessReply,
    general_symptom_context: resolveGeneralSymptomReply,
  };

  const domainResolution = resolvers[pending.key]?.(t) || null;
  if (domainResolution) {
    return {
      status: "resolved",
      ...domainResolution,
      pendingClarification: { ...pending, status: "resolved" },
    };
  }

  if (explicitDomains.size) {
    return {
      status: "resolved",
      domains: [...explicitDomains],
      pendingClarification: { ...pending, status: "resolved" },
    };
  }

  return {
    status: "unclear",
    pendingClarification: { ...pending, status: "unclear" },
  };
}
