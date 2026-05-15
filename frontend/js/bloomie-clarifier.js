function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function stableIndex(seed, len) {
  const text = normalizeWhitespace(seed).toLowerCase();
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % Math.max(1, len);
}

function chooseVariant(options, seed) {
  if (!Array.isArray(options) || !options.length) return null;
  return options[stableIndex(seed, options.length)];
}

export function promptFingerprint(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRepairClarificationCopy({ label, daysUntilNextPeriod = null, isLateContextActive = false } = {}) {
  const overdueDays = typeof daysUntilNextPeriod === "number" ? daysUntilNextPeriod : null;
  const hasLateContext = Boolean(isLateContextActive) || (typeof overdueDays === "number" && overdueDays < -1);

  return [
    label === "frustration"
      ? "My bad 🩷 I hear you."
      : "My bad 🩷 Let me say that more simply.",
    hasLateContext
      ? (typeof overdueDays === "number" && overdueDays < -1
          ? `Your logged dates suggest your period may be around ${Math.abs(overdueDays)} day${Math.abs(overdueDays) === 1 ? "" : "s"} late by estimate.`
          : "Your logged dates suggest your period may be later than expected.")
      : "I can rephrase this in a simpler way and keep helping from here.",
    "Do you want to focus on cramps, spotting, or pregnancy chance?",
  ];
}

export function buildClarifyingPrompt(prompt, {
  normalizedText = "",
  isRecentRepeat = false,
  isLateContextActive = false,
} = {}) {
  const original = String(prompt || "").trim();
  if (!original) {
    return { text: original, fingerprint: promptFingerprint(original) };
  }

  const fp = promptFingerprint(original);
  let resolved = original;

  if (isRecentRepeat) {
    const variants = {
      "is it more like nausea and stomach discomfort or do you feel generally unwell with things like chills or fever": [
        "Would you say this feels more like nausea/stomach discomfort, or more like feeling generally unwell (for example chills or fever)?",
        "Quick check so I can guide you better: is this mostly nausea/belly discomfort, or more an overall unwell feeling like chills/fever?",
      ],
      "where does the pain feel like it s coming from more in your belly lower pelvic area or somewhere else": [
        "Could you help me pinpoint it: is the discomfort more lower-pelvic/crampy, or more your stomach/belly in general?",
        "To make sure I stay on track, is the pain mostly low in the pelvis, or more in the stomach area?",
      ],
    };
    const options = variants[fp];
    if (options?.length) {
      resolved = chooseVariant(options, `${fp}|${normalizedText}`);
    } else {
      resolved = "I want to make sure I understand you right 🩷 Could you say the main symptom in a few words (for example: late period, cramps, discharge, mood)?";
    }
  }

  if (
    isLateContextActive &&
    /\b(pelvic|belly|stomach|pain)\b/.test(promptFingerprint(resolved)) &&
    /\b(stomach|belly|hurt|ache|pain)\b/.test(String(normalizedText || "").toLowerCase())
  ) {
    resolved = "Got you 💗 Since your period still seems off, quick check: is it more crampy low-pelvic pain, or more stomach/belly discomfort?";
  }

  return {
    text: resolved,
    fingerprint: promptFingerprint(resolved),
  };
}

export function buildFollowUpClarifier({ concern, missing = [], seed = "" } = {}) {
  if (!concern || !missing.length) return null;

  if (concern === "late_period") {
    if (missing.includes("pregnancy_possibility") && missing.includes("stress_or_routine")) {
      return {
        text: "Okay 🩷 I'll ask a couple things that can help narrow it down - any chance of pregnancy this cycle, or have stress, sleep, illness, or routine changes been different lately?",
      };
    }
    if (missing.includes("pregnancy_possibility")) {
      return { text: "Quick check 🩷 is there any chance of pregnancy this cycle?" };
    }
    return { text: "Quick check 🩷 have stress, sleep, illness, or routine changes been different lately?" };
  }

  if (concern === "pelvic_pain") {
    if (missing.includes("severity") && (missing.includes("bleeding_context") || missing.includes("cycle_timing"))) {
      return {
        text: "Quick check so I can guide you better 🩷 is the pain mild, moderate, or severe, and is it happening with bleeding or at another point in your cycle?",
      };
    }
    if (missing.includes("severity")) {
      return { text: "How strong would you say the pain is right now - mild, moderate, or severe?" };
    }
    return { text: "Is it happening with bleeding, or at another point in your cycle?" };
  }

  if (concern === "heavy_bleeding") {
    if (missing.includes("amount") && missing.includes("timing")) {
      return {
        text: "Quick check so I can triage this safely 🩷 are you soaking through a pad or tampon every hour, feeling dizzy or faint, passing large clots, having severe one-sided pain, or is the pain unbearable or much worse than usual?",
      };
    }
    if (missing.includes("amount")) {
      return {
        text: "Quick check 🩷 are you soaking through a pad or tampon every hour, feeling dizzy or faint, passing large clots, or having severe one-sided pain?",
      };
    }
    return {
      text: "How long has the heavier bleeding been going on - just today, a couple of days, or longer?",
    };
  }

  if (concern === "spotting") {
    if (missing.includes("amount") && missing.includes("timing")) {
      return {
        text: "Just to place it better 🩷 is it light spotting or more like bleeding, and was it around your expected period or at another time?",
      };
    }
    if (missing.includes("pain")) {
      return { text: "Are you getting any cramps or pain with the spotting?" };
    }
    return { text: "Was it closer to light spotting or more like bleeding?" };
  }

  return null;
}

export function buildSoftClarifierCopy({ normalizedText = "" } = {}) {
  return {
    reply: [
      chooseVariant([
        "I might be missing part of what you mean 🩷",
        "I hear you - let me make sure I understood 🩷",
      ], `${normalizedText}|soft_clarify`),
      "Is this about your cycle or a body symptom (like cramps, spotting, discharge, or mood changes)?",
    ],
    next: "ELSE_NOT_SURE_ROUTE",
    payload: { reason: "soft_clarify" },
  };
}
