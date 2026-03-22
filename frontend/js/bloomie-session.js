/**
 * bloomie-session.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Session / state management for Bloomie chat.
 *
 * createCtx() returns the canonical initial context shape used by
 * initBloomieChat(). Keeping it here makes the shape inspectable and
 * testable without instantiating the full chat engine.
 *
 * ctx shape:
 *   state           — current dialogue node key
 *   history         — raw message log [{ from, text, meta, t }]
 *   answers         — structured Q&A pairs for PDF export
 *   multiDraft      — pending multi-select node data
 *   locked          — UI is locked (during async transitions)
 *   timers          — Set of active setTimeout IDs (cleared on transition)
 *   capture         — active date/value capture descriptor
 *   captureData     — accumulated capture values for the current sequence
 *   captureReturnTo — node to resume after capture sequence completes
 *   greeted         — true after first greeting (prevents repeated intros)
 *   lastEntities    — merged entity snapshot from the last routed message
 *   lastInferredReason — reason string from the last inferRoute() call
 *   lastCycleCtx    — cycle context snapshot at the time guidance was built
 *   entityHistory   — rolling window (max 3) of raw entity sets for follow-up memory
 *   lastOOS         — last out-of-scope category fired, for follow-up context
 *   lastIntent      — last routed health intent (late/heavy/spot/mood/pelvic/pregnancy)
 *   sessionMode     — mode the user confirmed THIS session (overrides Firestore mode)
 *   sessionData     — user-entered cycle values this session (lmp, cycleLength)
 *   topic           — current health topic e.g. "late_period", "heavy_bleeding"
 *   riskLevel       — "low" | "moderate" | "high"
 *   urgency         — true when the current thread has an urgent flag
 *   adviceGiven     — Set of string codes for advice already surfaced this session
 *                     e.g. "told_to_test", "told_to_seek_care", "told_to_monitor"
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * createCtx() → ctx
 * Returns the initial blank session state.
 * Called once per initBloomieChat() invocation.
 */
export function createCtx() {
  return {
    state:              "START",
    history:            [],
    answers:            [],
    multiDraft:         null,
    locked:             false,
    timers:             new Set(),
    capture:            null,
    captureData:        {},
    captureReturnTo:    null,
    greeted:            false,
    lastEntities:       null,
    lastInferredReason: null,
    lastCycleCtx:       null,
    entityHistory:      [],
    lastOOS:            null,
    lastIntent:         null,
    sessionMode:        null,
    sessionData:        {},
    topic:              null,
    riskLevel:          "low",
    urgency:            false,
    adviceGiven:        new Set(),
  };
}
