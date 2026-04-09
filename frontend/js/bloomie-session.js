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
 *   state           - current dialogue node key
 *   history         - raw message log [{ from, text, meta, t }]
 *   answers         - structured Q&A pairs for PDF export
 *   multiDraft      - pending multi-select node data
 *   locked          - UI is locked (during async transitions)
 *   timers          - Set of active setTimeout IDs (cleared on transition)
 *   capture         - active date/value capture descriptor
 *   captureData     - accumulated capture values for the current sequence
 *   captureReturnTo - node to resume after capture sequence completes
 *   greeted         - true after first greeting (prevents repeated intros)
 *   lastEntities    - merged entity snapshot from the last routed message
 *   lastInferredReason - reason string from the last inferRoute() call
 *   lastCycleCtx    - cycle context snapshot at the time guidance was built
 *   entityHistory   - rolling window (max 3) of raw entity sets for follow-up memory
 *   lastOOS         - last out-of-scope category fired, for follow-up context
 *   lastIntent      - last routed health intent (late/heavy/spot/mood/pelvic/pregnancy)
 *   sessionMode     - mode the user confirmed THIS session (overrides Firestore mode)
 *   sessionData     - user-entered cycle values this session (lmp, cycleLength)
 *   topic           - current health topic e.g. "late_period", "heavy_bleeding"
 *   riskLevel       - "low" | "moderate" | "high"
 *   urgency         - true when the current thread has an urgent flag
 *   adviceGiven     - Set of string codes for advice already surfaced this session
 *                     e.g. "told_to_test", "told_to_seek_care", "told_to_monitor"
 *   isTyping        - true while Bloomie is "thinking" (typing indicator visible)
 *   backgroundContext - symptom snapshot seeded from a prior session that is older
 *                     than 24 hours. Not merged into entityHistory so it cannot
 *                     influence inferRoute or topic-switch detection. Available
 *                     for reference by recall helpers and PDF export.
 *                     Shape mirrors an entityHistory entry plus a `seededAt` ISO
 *                     string. Null when no stale prior-session data exists.
 *   flowId          - integer counter incremented each time the user sends a message.
 *                     Buttons rendered by a previous render pass capture the flowId
 *                     at render time; clicks are ignored when flowId has advanced,
 *                     preventing stale buttons from yanking the user back into an
 *                     old flow after they have already changed topics.
 *   nodeFlowId      - flowId value at the time the current node's choices were last
 *                     rendered. matchTypedToChoice compares this against
 *                     (ctx.flowId - 1) - the epoch immediately before the user's
 *                     current message - and skips the match when they differ,
 *                     mirroring the stale-button guard used by button clicks.
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
    inlineChoices:      null,       // one-off quick replies injected via say(..., { choices })
    inlineQuestion:     null,       // optional question label paired with inlineChoices
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
    isTyping:           false,
    backgroundContext:  null,
    flowId:             0,
    nodeFlowId:         -1,
    insightsGiven:      new Set(),  // keys like "luteal_mood" - prevents repeated full insights
    cycleVariability:   null,       // range (max–min) across last 3 logged cycle lengths, null if unknown
    currentTone:        null,       // tone resolved for the current message ('distressed'|'angry'|…|'neutral')
    previousTone:       null,       // tone from the prior turn - used for session stability blending
    toneRequestId:      0,          // monotonic token for in-flight async tone resolution; stale promises must not mutate ctx
    usedOpeners:        new Set(),  // opener strings already shown - prevents repetition within a session
    symptomSignals:     null,       // pre-computed SymptomSignal[] from bloom-symptom-engine, or null
    aiSignals:          null,       // ExtractedSignals from bloomie-extract.js, or null when unavailable.
                                    // Advisory only — never used to override rule-based urgent routing.
                                    // Shape: { symptoms, timing, severity, tone, repair,
                                    //          pregnancySignals, redFlags, confidence }
    cumulativeRiskFlags:      new Set(),  // accumulates risk signal flags across conversation
    pendingAmbiguityContext:  null,        // stored when ambiguity question was asked
    isMinor:                  false,
    isAnon:                   false,
    ageGroup:                 "unknown",   // "adult" | "minor" | "unknown" (policy-derived)
    hasGuardianConsent:       false,       // consent gate for minors
    policySeed:               null,        // seed provided by assistant page/profile context
    policyContext:            null,        // per-turn policy context object
    policyAnonDisclosureShown: false,      // one-time anonymous disclosure guard
    policyTrustedAdultNudgePending: false, // set by policy when minor medium/high risk
    userNickname:             null,
    lastNicknameUsedAtDepth:  null,
    preEndChatState:          null,   // state to restore if user cancels END_CHAT_CONFIRM
    resolutionStatus:         null,   // "resolved" | "unresolved" | "skipped" — set by RESOLUTION_CHECK
    closeIntentDetected:      false,  // true when user typed a goodbye phrase (END_CHAT_PATTERN fired)
    closeConfirmationPending: false,  // true while END_CHAT_CONFIRM node is visible
    pendingUnresolvedTopic:   null,   // unresolved topic currently being confirmed at close-time
    closeSkipUnresolvedPrompt: false, // one-shot bypass so "_no, done" can reach CLOSE without re-prompt loop
    pendingContradictionContext: null,     // stored when contradiction was detected
    pendingContextProbe:      null,        // stored when missing-context probe was asked
    pendingQuestion:          null,        // { type: "yes_no"|"severity"|"timing"|"duration"|"test_result"|"choice", nodeState: string }
                                          // set whenever Bloomie renders a node with choices; cleared after exactly
                                          // one user message so extended answer matching is strictly turn-bound.
    recentInputs:         [],              // rolling array of last 5 raw user inputs for loop detection
    pendingConcerns:      [],              // overload handler: remaining concerns after user picks first
    resolvedContradictions: [],            // contradictions and concerns already surfaced this session

    // ── Confidence-tier routing (Prompt 1) ─────────────────────────────────
    routeConfidence:        null,          // last computeRouteConfidence() result
    pendingRoute:           null,          // { next, payload } set when MEDIUM tier asks confirmation
    narrowingCandidates:    null,          // [{ id, label, next }] for LOW tier NARROWING
    lastConfidence:         null,          // last full ConfidenceResult (including route/competitors/ambiguous)
    confidenceFallbackCount: 0,            // how many times CONFIDENCE_FALLBACK has been shown this session
    narrowingAttemptCount:  0,             // consecutive disambiguation attempts (NARROWING/CONFIDENCE_FALLBACK)
    lastNarrowingPrompt:    null,          // fingerprint of last narrowing prompt variant used

    // ── Conversation intelligence (Prompt 2) ───────────────────────────────
    conversationProfile: {
      topicsDiscussed:      [],            // topic codes covered this session
      concernsResolved:     [],            // topics where user received guidance without pushback
      concernsUnresolved:   [],            // topics raised but not fully addressed
      lastGuidanceGiven:    null,          // code of last advice surfaced
      userEngagementLevel:  "normal",      // "high" | "normal" | "low"
      sessionDepth:         0,             // count of typed free-text messages (not button taps)
      returnedTopic:        null,          // topic code if user returned to a resolved topic
    },
    sessionSymptoms:      new Set(),       // all symptom entity keys detected across the session
    verbosity:            "normal",        // "concise" | "normal" | "detailed"
    oosStreakCount:        0,              // consecutive OOS responses (for conversational repair)
    isRetryAttempt:       false,          // true when user has sent same message twice (second repeat handling)
    loggingGapPending:    false,          // true when a symptom-logging-gap nudge is queued for next response
    bloomieAnomalyCtx:    null,           // computed at mount: { cycleAnomaly, severitySpike, level }
    moodMentions:         [],             // [{ depth, tone, intent }] — appended each time mood is detected

    // ── Reported (user-confirmed) conditions ──────────────────────────────
    reportedConditions:    [],     // condition keys stated as existing diagnoses this session,
                                   // e.g. ["pcos", "anemia"]; seeded from bloomieMemory at mount
    activeReportedCondition: null, // conditionKey from the most-recent detectReportedCondition hit;
                                   // read by REPORTED_CONDITION_ACK.say()

    // ── Anti-repetition ────────────────────────────────────────────────────
    nodeHistory:           [],            // ordered list of visited node keys (capped at NODE_HISTORY_MAX)
    contentSuggestionsShown: new Set(),   // content IDs shown this session; seeded from bloomieMemory at mount
    declinedSuggestions:   new Set(),     // content IDs the user declined; seeded from bloomieMemory at mount
    lastUsedGreeting:      null,          // first line of buildIntro() used this session; flushed to memory on save
    lastClarifierFingerprint: null,       // fingerprint of last clarifying follow-up question emitted
    lastClarifierTurn:       -1,          // flowId when clarifying follow-up was last emitted
    lastBotLineFingerprint:  null,        // fingerprint of most recently emitted bot line (live generation only)
  };
}
