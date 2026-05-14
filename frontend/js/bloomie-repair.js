import { classifyRepairClarification } from "./bloomie-intent.js";
import { buildRepairClarificationCopy } from "./bloomie-clarifier.js";

export function handleRepairClarification(normalizedText, options = {}) {
  const {
    daysUntilNextPeriod = null,
    isLateContextActive = false,
    next = "START_MENU",
  } = options;

  const repair = classifyRepairClarification(normalizedText);
  if (!repair) return null;

  const targetName = repair.label === "frustration"
    ? "confused_with_bloomie"
    : "clarification_repair";

  const overdueDays = typeof daysUntilNextPeriod === "number" ? daysUntilNextPeriod : null;
  const hasLateContext = Boolean(isLateContextActive) || (typeof overdueDays === "number" && overdueDays < -1);

  const reply = buildRepairClarificationCopy({
    label: repair.label,
    daysUntilNextPeriod: overdueDays,
    isLateContextActive: hasLateContext,
  });

  return {
    classification: repair,
    targetName,
    reply,
    next,
    payload: {
      oos: targetName,
      repair: true,
      repairLabel: repair.label,
    },
  };
}
