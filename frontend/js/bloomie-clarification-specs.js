const CLARIFICATION_SPECS = {
  pain_location: {
    key: "pain_location",
    expectedDomain: "pain",
    expectedValues: ["pelvic", "belly_general", "stomach_general", "back", "elsewhere"],
  },
  bleeding_amount: {
    key: "bleeding_amount",
    expectedDomain: "bleeding",
    expectedValues: ["spotting", "period_like", "heavy", "manageable"],
  },
  discharge_descriptor: {
    key: "discharge_descriptor",
    expectedDomain: "discharge",
    expectedValues: ["color", "smell", "texture", "amount", "pain", "irritation"],
  },
  dizziness_context: {
    key: "dizziness_context",
    expectedDomain: "bleeding",
    expectedValues: ["with_bleeding", "on_its_own"],
  },
  general_symptom_context: {
    key: "general_symptom_context",
    expectedDomain: "general",
    expectedValues: ["nausea", "generally_unwell", "feverish"],
  },
};

export function getClarificationSpec(key) {
  if (!key || !CLARIFICATION_SPECS[key]) return null;
  return { ...CLARIFICATION_SPECS[key] };
}

export function createClarificationDescriptor(prompt, specKey = null) {
  return {
    prompt,
    spec: getClarificationSpec(specKey),
  };
}

