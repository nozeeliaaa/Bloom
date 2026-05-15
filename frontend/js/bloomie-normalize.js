import { normalizePatois, fuzzyCorrect, collapseRepeatedLetters, expandShorthand } from "./bloomie-patois.js";

export function normalizeBloomieText(text, options = {}) {
  const {
    stripSpecialChars = false,
    lowercase = true,
    trim = true,
    returnStages = false,
  } = options;

  const raw = String(text || "");
  const patoisNorm = normalizePatois(raw);
  const fuzzyNorm = fuzzyCorrect(patoisNorm) ?? patoisNorm;
  const collapsed = collapseRepeatedLetters(fuzzyNorm);
  const expanded = expandShorthand(collapsed);

  let normalized = String(expanded || "");
  if (lowercase) normalized = normalized.toLowerCase();
  if (stripSpecialChars) normalized = normalized.replace(/[^\w\s'']/g, " ");
  if (trim || stripSpecialChars) normalized = normalized.replace(/\s+/g, " ").trim();

  if (returnStages) {
    return {
      raw,
      patoisNorm,
      fuzzyNorm,
      collapsed,
      expanded,
      normalized,
    };
  }

  return normalized;
}
