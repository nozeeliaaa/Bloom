function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

const DOMAIN_SYMPTOM_KEYS = {
  bleeding: ["heavy", "large_clots", "spotting", "bleeding_through", "flow_change", "light"],
  discharge: ["discharge", "unusual_discharge", "discharge_eggwhite", "discharge_creamy", "discharge_sticky", "odor"],
  pain: ["pelvic", "ovulation_pain", "pain_during_sex", "one_sided_pain", "cramps", "headache", "joint_pain", "breast_tender"],
  late: ["late", "implicit_late", "irregular"],
  mood: ["mood", "anxiety", "depression", "irritability", "fatigue", "night_sweats", "cold_flashes", "brain_fog", "poor_concentration"],
  digestive: ["nausea", "bloating", "gassy", "heartburn", "constipation", "diarrhea"],
};

const DOMAIN_BASE_SCORES = {
  bleeding: 60,
  discharge: 46,
  pain: 38,
  late: 40,
  mood: 26,
  digestive: 24,
  pregnancy: 42,
};

const SYMPTOM_META = {
  large_clots: { domain: "bleeding", weight: 26, label: "the clots", patterns: [/\bclots?\b/] },
  heavy: { domain: "bleeding", weight: 22, label: "the bleeding", patterns: [/\bheavy\b/, /\bbleeding\b/] },
  spotting: { domain: "bleeding", weight: 16, label: "the spotting", patterns: [/\bspotting\b/, /\bspot\b/] },
  discharge: { domain: "discharge", weight: 14, label: "the discharge change", patterns: [/\bdischarge\b/] },
  unusual_discharge: { domain: "discharge", weight: 24, label: "the yellow discharge", patterns: [/\byellow discharge\b/, /\bgreen discharge\b/, /\bgray discharge\b/, /\bgrey discharge\b/, /\bfishy\b/, /\bsmell\b/] },
  pelvic: { domain: "pain", weight: 16, label: "the cramps", patterns: [/\bcramps?\b/, /\bpelvic\b/, /\blower abdomen\b/, /\blower belly\b/] },
  ovulation_pain: { domain: "pain", weight: 15, label: "the pelvic pain", patterns: [/\bovulation pain\b/] },
  late: { domain: "late", weight: 18, label: "that your period seems late", patterns: [/\blate\b/, /\bmissed period\b/, /\bperiod\b.*\blate\b/] },
  nausea: { domain: "digestive", weight: 18, label: "the nausea", patterns: [/\bnausea\b/, /\bnauseous\b/, /\bqueasy\b/, /\bfeel sick\b/] },
  bloating: { domain: "digestive", weight: 9, label: "the bloating", patterns: [/\bbloat/i, /\bbloating\b/] },
  mood: { domain: "mood", weight: 11, label: "the mood shift", patterns: [/\bmood\b/, /\banxious\b/, /\bsad\b/] },
  fatigue: { domain: "mood", weight: 11, label: "the low energy", patterns: [/\btired\b/, /\bfatigue\b/, /\bdrained\b/, /\blow energy\b/] },
  brain_fog: { domain: "mood", weight: 15, label: "the brain fog", patterns: [/\bbrain fog\b/, /\bfoggy\b/, /\bcan'?t think\b/] },
};

function getActiveSymptomKeys(entities = {}) {
  return Object.entries(entities?.symptoms || {})
    .filter(([, value]) => value)
    .map(([key]) => key);
}

function findEarliestIndex(text, patterns = []) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  let best = Number.POSITIVE_INFINITY;
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match || typeof match.index !== "number") continue;
    best = Math.min(best, match.index);
  }
  return Number.isFinite(best) ? best : null;
}

function humanizeSymptomKey(key) {
  return key.replace(/_/g, " ");
}

function getSymptomDescriptor(key, text) {
  const meta = SYMPTOM_META[key];
  if (!meta) {
    return {
      key,
      domain: null,
      weight: 6,
      label: humanizeSymptomKey(key),
      textIndex: null,
    };
  }
  let label = meta.label;
  if (key === "mood") {
    const normalized = normalizeWhitespace(text).toLowerCase();
    if (/\blow energy|no energy|tired|fatigue|drained|exhaust/.test(normalized)) {
      label = "the low energy";
    } else if (/\bbrain fog|foggy|can'?t think/.test(normalized)) {
      label = "the brain fog";
    }
  }
  return {
    key,
    domain: meta.domain,
    weight: meta.weight,
    label,
    textIndex: findEarliestIndex(text, meta.patterns),
  };
}

function scoreDomain(domain, descriptors = [], entities = {}) {
  const symptoms = entities?.symptoms || {};
  let score = DOMAIN_BASE_SCORES[domain] || 0;
  let firstMention = Number.POSITIVE_INFINITY;

  for (const descriptor of descriptors) {
    score += descriptor.weight;
    if (typeof descriptor.textIndex === "number") {
      firstMention = Math.min(firstMention, descriptor.textIndex);
    }
  }

  if (domain === "bleeding" && (symptoms.heavy || symptoms.large_clots)) score += 12;
  if (domain === "discharge" && symptoms.unusual_discharge) score += 12;
  if (domain === "late" && entities?.pregnancy?.chance) score += 10;
  if (domain === "digestive" && symptoms.nausea) score += 8;
  if (domain === "mood" && symptoms.brain_fog) score += 5;

  if (Number.isFinite(firstMention)) {
    score += Math.max(0, 8 - Math.floor(firstMention / 12));
  }

  return { score, firstMention: Number.isFinite(firstMention) ? firstMention : null };
}

function buildPrimaryEntities(entities = {}, leadDomain = null) {
  if (!leadDomain) return entities;

  const nextSymptoms = Object.fromEntries(
    Object.keys(entities?.symptoms || {}).map((key) => [key, false])
  );

  for (const key of DOMAIN_SYMPTOM_KEYS[leadDomain] || []) {
    if (entities?.symptoms?.[key]) nextSymptoms[key] = true;
  }

  return {
    ...entities,
    symptoms: nextSymptoms,
  };
}

export function summarizeFocusLabels(labels = [], { includeLead = true, leadLabel = null } = {}) {
  const parts = [];
  if (includeLead && leadLabel) parts.push(leadLabel);
  parts.push(...labels.filter(Boolean));
  const unique = [...new Set(parts)].slice(0, 3);
  if (!unique.length) return null;
  if (unique.length === 1) return `I'm hearing ${unique[0]} 🩷`;
  if (unique.length === 2) return `I'm hearing ${unique[0]} along with ${unique[1]} 🩷`;
  return `I'm hearing ${unique[0]}, ${unique[1]}, and ${unique[2]} 🩷`;
}

export function rankTurnFocus(entities = {}, text = "") {
  const activeSymptoms = getActiveSymptomKeys(entities);
  const descriptors = activeSymptoms.map((key) => getSymptomDescriptor(key, text));
  const byDomain = new Map();

  for (const descriptor of descriptors) {
    const domain = descriptor.domain;
    if (!domain) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(descriptor);
  }

  if (entities?.pregnancy?.chance || entities?.pregnancy?.result || entities?.pregnancy?.testedYet) {
    if (!byDomain.has("pregnancy")) byDomain.set("pregnancy", []);
  }

  const rankedDomains = [...byDomain.entries()]
    .map(([domain, domainDescriptors]) => ({
      domain,
      descriptors: domainDescriptors,
      ...scoreDomain(domain, domainDescriptors, entities),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (typeof a.firstMention === "number" && typeof b.firstMention === "number") {
        return a.firstMention - b.firstMention;
      }
      if (typeof a.firstMention === "number") return -1;
      if (typeof b.firstMention === "number") return 1;
      return a.domain.localeCompare(b.domain);
    });

  const leadDomain = rankedDomains[0]?.domain || null;
  const leadDescriptors = leadDomain
    ? [...(byDomain.get(leadDomain) || [])].sort((a, b) => {
        if (b.weight !== a.weight) return b.weight - a.weight;
        if (typeof a.textIndex === "number" && typeof b.textIndex === "number") {
          return a.textIndex - b.textIndex;
        }
        return a.key.localeCompare(b.key);
      })
    : [];
  const leadSymptom = leadDescriptors[0]?.key || null;
  const leadLabel = leadDescriptors[0]?.label || (leadDomain ? `the ${leadDomain}` : null);
  const secondaryLabels = descriptors
    .filter((descriptor) => descriptor.key !== leadSymptom)
    .sort((a, b) => {
      if ((a.domain === leadDomain) !== (b.domain === leadDomain)) {
        return a.domain === leadDomain ? -1 : 1;
      }
      if (b.weight !== a.weight) return b.weight - a.weight;
      return (a.textIndex ?? Number.POSITIVE_INFINITY) - (b.textIndex ?? Number.POSITIVE_INFINITY);
    })
    .map((descriptor) => descriptor.label)
    .filter(Boolean);

  return {
    leadDomain,
    leadSymptom,
    leadLabel,
    rankedDomains: rankedDomains.map(({ domain, score }) => ({ domain, score })),
    secondaryLabels: [...new Set(secondaryLabels)].slice(0, 2),
    primaryEntities: buildPrimaryEntities(entities, leadDomain),
    hasMultipleSymptoms: descriptors.length >= 2,
    hasMultipleDomains: rankedDomains.length >= 2,
    acknowledgement: summarizeFocusLabels(secondaryLabels, { includeLead: true, leadLabel }),
    secondaryAcknowledgement: summarizeFocusLabels(secondaryLabels, { includeLead: false }),
  };
}

export { buildPrimaryEntities };
