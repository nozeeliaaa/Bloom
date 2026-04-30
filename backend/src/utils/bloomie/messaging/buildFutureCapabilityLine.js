/**
 * src/utils/bloomie/messaging/buildFutureCapabilityLine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds a safe, transparent future-capability messaging line for Bloomie.
 *
 * Rules:
 *  • Always indicates FUTURE capability - never implies current capability.
 *  • Uses gentle uncertain language ("may", "could", "over time", "in future versions").
 *  • Never mentions diagnosis improvement or treatment capability.
 *  • Never surfaces during urgent flows (returns null when urgentFlag is true).
 *  • Returns one brief, warm line or null.
 *  • Deterministic - no randomness, making responses stable and testable.
 *
 * Use cases:
 *  1. User asks how Bloomie could improve in future             → "improvement"
 *  2. User asks why Bloomie is still general                   → "general_scope"
 *  3. User asks whether Bloomie can become more personalised   → "personalization"
 *  4. Bloomie explaining future product possibilities          → "future_products"
 *  5. Generic / unknown context                                → "general"
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// Message pools - indexed by context key.
// Each entry is an array of safe, interchangeable lines.
// Index 0 is the default; additional lines reserved for future A/B use.
// ─────────────────────────────────────────────────────────────────────────────

const FUTURE_LINES = {
  improvement: [
    "As Bloom evolves, richer logged history could help make cycle-related support more tailored over time.",
    "In future versions, longer-term records may allow for better pattern awareness as more data builds up over time.",
  ],
  personalization: [
    "Right now I use the information available in Bloom, but future versions may support more personalised pattern awareness as longer-term logs build over time 🩷",
    "Over time, more complete cycle and symptom logs could help future versions of Bloom offer more tailored support.",
  ],
  general_scope: [
    "At the moment I stay grounded in the information currently available, but future improvements may allow better long-term pattern tracking.",
    "I work with what's currently logged in Bloom - as records build over time, future versions may be able to offer more tailored insights.",
  ],
  future_products: [
    "As Bloom evolves, richer logged history could help make cycle-related support more tailored over time.",
    "Future versions may support better personalisation as longer-term data becomes available.",
  ],
  general: [
    "Right now I use the information available in Bloom, but future versions may support more personalised pattern awareness as longer-term logs build over time 🩷",
    "As Bloom evolves, richer logged history could help make cycle-related support more tailored over time.",
  ],
};

const VALID_CONTEXTS = new Set(Object.keys(FUTURE_LINES));

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection patterns
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT_PATTERNS = [
  {
    context: "personalization",
    pattern: /\b(more personal(ised|ized)?|tailored|customis(ed|e)|customiz(ed|e)|specific to me|know me better|remember me|my (medical |health )?records?|medical (records?|history)|health (records?|history)|clinical (records?|data)|full history)\b/i,
  },
  {
    context: "improvement",
    pattern: /\b(improve|get better|better over time|learn more|more accurate|smarter|develop|grow)\b/i,
    secondaryPattern: /\b(bloom|bloomie|you|app)\b/i,
  },
  {
    context: "general_scope",
    pattern: /\b(why (is|are|do) you (so |still |always )?(general|basic|limited|the same)|why (can|can'?t) you|why (don'?t|do not) you know|so (general|basic|limited))\b/i,
  },
  {
    context: "future_products",
    pattern: /\b(future (versions?|updates?|features?|plans?|capabilities|releases?)|will you ever|could you ever|one day|eventually|in (the )?future|upcoming (features?|versions?|updates?))\b/i,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildFutureCapabilityLine(context, options) → string | null
 *
 * Returns one safe, future-framed capability line for the given context,
 * or null if the flow is urgent or the context is unrecognised.
 *
 * @param {string} [context="general"] - one of: "general" | "improvement" |
 *   "personalization" | "general_scope" | "future_products"
 * @param {object} [options]
 * @param {boolean} [options.urgentFlag=false] - when true returns null;
 *   future-capability lines must never surface during urgent or red-flag flows.
 * @returns {string|null}
 */
export function buildFutureCapabilityLine(context = "general", { urgentFlag = false } = {}) {
  if (urgentFlag) return null;

  const key = VALID_CONTEXTS.has(context) ? context : "general";
  return FUTURE_LINES[key][0];
}

/**
 * detectFutureCapabilityContext(text) → string | null
 *
 * Inspects normalised input text and returns the most appropriate
 * future-capability context key, or null if none matched.
 *
 * Designed to be called before routing so the caller can decide whether
 * to attach a future-capability line to a response.
 *
 * @param {string} text - raw or normalised user input
 * @returns {"improvement"|"personalization"|"general_scope"|"future_products"|null}
 */
export function detectFutureCapabilityContext(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const t = text.toLowerCase().trim();

  for (const { context, pattern, secondaryPattern } of CONTEXT_PATTERNS) {
    if (!pattern.test(t)) continue;
    if (secondaryPattern && !secondaryPattern.test(t)) continue;
    return context;
  }

  return null;
}
