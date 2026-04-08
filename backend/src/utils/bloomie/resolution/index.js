/**
 * src/utils/bloomie/resolution/index.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolution module — handles session close / wrap-up logic for Bloomie.
 *
 * Responsible for:
 *  • Detecting close intent ("thanks", "bye", "that's all")
 *  • Determining resolution status (resolved / unresolved / skipped)
 *  • Building session-end memory patches
 *
 * Placeholder — implementation to follow.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// No-op stubs — replace with real implementations as needed.

/**
 * detectCloseIntent(inputText) → boolean
 * Returns true when the input signals the user is ending the session.
 */
export function detectCloseIntent(inputText) {
  if (typeof inputText !== "string") return false;
  return /\b(thanks?|thank you|bye|goodbye|that'?s? all|done|ok thanks?|great thanks?)\b/i
    .test(inputText);
}

/**
 * buildResolutionPatch(status, closeDetected?) → object
 * Returns memory fields for the session close event.
 *
 * @param {"resolved"|"unresolved"|"skipped"} status
 * @param {boolean} [closeDetected=false]
 */
export function buildResolutionPatch(status, closeDetected = false) {
  const VALID = new Set(["resolved", "unresolved", "skipped"]);
  return {
    lastResolutionStatus: VALID.has(status) ? status : "skipped",
    closeIntentDetected:  !!closeDetected,
  };
}
