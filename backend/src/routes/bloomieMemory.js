/**
 * src/routes/bloomieMemory.js
 *
 * Bloomie memory lifecycle — Firestore collection: bloomieMemory/{uid}
 *
 * Schema intent:
 *   - ONE document per user, keyed by Firebase Auth UID.
 *   - Stores a COMPACT CONVERSATIONAL SNAPSHOT only — NOT raw cycle logs or
 *     raw symptom histories. Those live in cycleLogs/{uid} and
 *     symptomLogs/{uid} respectively.
 *   - Safe to read by the Bloomie assistant to personalise greetings, pick up
 *     where a previous session left off, and avoid repeating content.
 *
 * Routes:
 *   GET  /api/bloomie-memory          — load snapshot (creates doc if absent)
 *   POST /api/bloomie-memory/session  — lightweight session-start (increments count)
 *   PUT  /api/bloomie-memory          — full upsert after a meaningful exchange
 *   PATCH /api/bloomie-memory         — incremental mid-session update
 *
 * Lifecycle:
 *   - GET:   Ensures the document exists (creating it with safe defaults if
 *            absent), then returns the normalised snapshot.
 *   - POST /session: Marks a new session start. Increments sessionCount and
 *            refreshes timestamps. Does not touch conversational fields.
 *   - PUT:   Full upsert after a meaningful exchange. Increments sessionCount,
 *            writes createdAt on first call, derives priorSeverity server-side.
 *            Accepts the complete set of fields described in the schema below.
 *   - PATCH: Incremental update during a conversation. Uses identical
 *            validation as PUT but does not increment sessionCount. Suitable
 *            for mid-session writes (e.g. updating OOS count without ending
 *            the session). All unmentioned fields are left untouched.
 *
 * Consent note:
 *   requireConsentApproved() from middleware/auth.js is intentionally NOT
 *   applied here. That middleware re-reads users/{uid} from Firestore, but
 *   requireAuth() already does that read and populates req.user.ageBand at
 *   zero extra cost. More importantly, requireConsentApproved() 403s any
 *   user whose yearOfBirth is unset — blocking legitimate adult users who
 *   skipped profile setup. Instead, every write route performs an inline
 *   ageBand guard via isMinorWithoutConsent(), which is both cheaper and
 *   more precise.
 *
 * Fields stored (compact — never PII or raw medical records):
 *   uid                    — Firebase Auth UID (stored for admin queries)
 *   createdAt              — Server timestamp, set once on first write
 *   updatedAt              — Server timestamp, updated on every write
 *   lastSessionDate        — ISO string of when the last write happened
 *   sessionCount           — Integer; incremented by PUT and POST /session
 *   lastIntent             — Last classified chat intent key (e.g. "PERIOD_LATE")
 *   lastPatternSummary     — Short summary of detected symptom pattern (max 150 chars)
 *   lastSeverity           — "mild" | "moderate" | "severe" | null
 *   priorSeverity          — lastSeverity from the session before this one; set
 *                            server-side whenever lastSeverity is updated.
 *                            Enables Bloomie to say "last time your pain was
 *                            moderate — has it changed?" with zero extra reads.
 *                            Never sent by the client; always derived here.
 *   lastRedFlagRoute       — Node ID if a red-flag route fired (max 80 chars)
 *   lastSymptoms           — Array of UPPERCASE symptom codes (max 20)
 *   recentTopics           — Array of topic strings logged in recent sessions (max 5)
 *   recentConcernCategory  — Most recent category of concern (max 80 chars)
 *   lastUrgencyLevel       — "low" | "medium" | "high" | null
 *   lastDuration           — { days, weeks, unit, value } object or null
 *   lastPregnancyChance    — Boolean
 *   lastGreetingUsed       — Greeting text shown, to avoid repeating (max 200 chars)
 *   contentSuggestionsShown — Content IDs surfaced to this user (max 50)
 *   declinedSuggestions    — Content IDs the user dismissed (max 50)
 *   lastResolutionStatus   — "resolved" | "unresolved" | "skipped" | null
 *   closeIntentDetected    — Boolean
 *   lastOosCategory        — Out-of-scope category key | null
 *   oosCount               — Running total of OOS interactions
 *   lastSafeRedirect       — Last redirect label for out-of-scope queries (max 100 chars)
 *   urgentFlag             — Boolean; true if a safety escalation fired this session
 *   redFlagNoticeShown     — Boolean; true if the red-flag notice UI was shown
 *   reportedConditions     — User-stated conditions (whitelisted keys, max 20)
 *   activeTopicCluster     — Most recent active condition cluster key
 *   lastConcernsResolved   — Topic codes resolved this session (max 5)
 *   lastConcernsUnresolved — Topic codes left unresolved this session (max 5)
 *   lastAdviceGiven        — Advice prefix codes given this session (max 10)
 *
 * Caller responsibility — the following fields are backend-ready but require
 * the frontend to populate them in the PUT/PATCH payload. They will not
 * self-update:
 *   urgentFlag             — must be sent by safety escalation path
 *   lastUrgencyLevel       — must be sent when urgency is classified
 *   lastRedFlagRoute       — must be sent when a red-flag node fires
 *   lastPatternSummary     — must be sent when a symptom pattern is detected
 *   recentConcernCategory  — must be sent by the intent classifier
 *   oosCount / lastOosCategory — must be sent after out-of-scope interactions
 */

import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ─── Validation constants ────────────────────────────────────────────────────

/**
 * Valid symptom codes — uppercase, matching the symptomCatalog and bloom engine.
 * These mirror ALL_SYMPTOM_CODES from bloom-symptom-engine.js.
 * Update this list when symptomCatalog gains new entries.
 */
const VALID_SYMPTOM_KEYS = new Set([
  // Bleeding
  "VAGINAL_BLEEDING", "SPOTTING", "HEAVY_FLOW", "LARGE_CLOTS",
  // Pain
  "CRAMPS", "PELVIC_PAIN", "OVULATION_PAIN", "HEADACHE", "JOINT_PAIN", "BREAST_TENDERNESS",
  // Digestive
  "BLOATING", "GASSY", "HEARTBURN", "NAUSEA", "CONSTIPATION", "DIARRHEA",
  // Discharge
  "DISCHARGE_NONE", "DISCHARGE_STICKY", "DISCHARGE_CREAMY",
  "DISCHARGE_EGGWHITE", "UNUSUAL_DISCHARGE",
  // Physical
  "FATIGUE", "FLUID_RETENTION", "FREQUENT_URINATION", "WEIGHT_CHANGE",
  "NASAL_CONGESTION", "SMELL_SENSITIVITY",
  // Skin / hair
  "ACNE", "DRY_SKIN", "HAIR_THINNING",
  // Temperature
  "HOT_FLASHES", "NIGHT_SWEATS", "COLD_FLASHES", "BBT_SHIFT",
  // Cognitive
  "BRAIN_FOG", "FORGETFUL", "POOR_CONCENTRATION",
  // Mood
  "MOOD_SWINGS", "IRRITABILITY", "ANXIETY", "DEPRESSION",
  "CRYING_SPELLS", "CALM", "STRESSED",
  // Sleep / appetite
  "INSOMNIA",
  "CRAVING_SWEET", "CRAVING_SALTY", "CRAVING_GREASY", "CRAVING_SPICY",
  "APPETITE_INCREASE", "APPETITE_DECREASE",
  // Reproductive
  "INCREASED_LIBIDO", "DECREASED_LIBIDO", "CERVICAL_MUCUS_CHANGE",
  "VAGINAL_DRYNESS", "PAIN_DURING_SEX", "MISSED_PERIOD", "IRREGULAR_PERIOD",
]);

const VALID_SEVERITIES        = new Set(["mild", "moderate", "severe"]);
const VALID_URGENCY_LEVELS    = new Set(["low", "medium", "high"]);
const VALID_RESOLUTION_STATUS = new Set(["resolved", "unresolved", "skipped"]);
const VALID_OOS_CATEGORIES    = new Set([
  "diagnosis_request", "unsafe_instruction",
  "unrelated_query",   "platform_question",
]);
const VALID_TOPIC_CODES   = new Set(["late", "heavy", "spot", "pelvic", "mood", "pregnancy", "discharge", "general"]);
const VALID_ADVICE_PREFIXES = ["told_to_test", "told_to_seek_care", "told_to_monitor", "logging_nudge"];

/**
 * Condition keys that may appear in reportedConditions / activeTopicCluster.
 * Must stay in sync with CONDITION_META in bloomie-routing.js.
 */
const VALID_CONDITION_KEYS = new Set([
  "pcos", "endometriosis", "fibroids", "adenomyosis", "ovarian_cysts",
  "pmdd", "perimenopause", "menopause", "amenorrhea", "anemia", "thyroid",
]);

// ─── Validation helpers ──────────────────────────────────────────────────────

/**
 * clampStr(val, max)
 * Returns a string trimmed and capped at `max` characters, null when the caller
 * explicitly sent null, or undefined ("don't touch this field") for any other
 * non-string value. Used for all optional text fields in PUT/PATCH payloads.
 */
function clampStr(val, max) {
  if (typeof val === "string") return val.trim().slice(0, max);
  if (val === null) return null;
  return undefined;
}

/**
 * pickEnum(val, validSet)
 * Returns `val` when it is a member of `validSet`, null when the caller
 * explicitly sent null, or undefined for any other value. Used for all
 * optional enum fields in PUT/PATCH payloads.
 */
function pickEnum(val, validSet) {
  if (validSet.has(val)) return val;
  if (val === null) return null;
  return undefined;
}

// ─── Read-time normalisation ─────────────────────────────────────────────────

/**
 * normaliseMemoryForRead(data)
 *
 * Resets session-specific boolean flags to false when lastSessionDate is from
 * a prior calendar day (UTC). This is a read-time correction only — no extra
 * Firestore write occurs.
 *
 * Problem: flags like `closeIntentDetected` and `urgentFlag` are written as
 * true when a session ends. On the next session the frontend resets its local
 * ctx, but if no meaningful exchange occurs (e.g. no symptoms logged),
 * persistMemory() never fires and these flags stay true in Firestore from the
 * previous session — potentially misleading the assistant.
 *
 * Fields reset when stale:
 *   closeIntentDetected — user said goodbye last session, not this one
 *   urgentFlag          — urgent route fired last session, not this one
 *
 * Fields intentionally preserved across sessions (not reset here):
 *   redFlagNoticeShown   — prevents repeatedly surfacing the safety notice UI
 *   lastResolutionStatus — useful context for "how did last session end?"
 */
function normaliseMemoryForRead(data) {
  if (!data) return data;

  const todayUTC = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const lastDate = typeof data.lastSessionDate === "string"
    ? data.lastSessionDate.slice(0, 10)
    : null;

  // Same-day session — return as-is; stale session — reset transient flags.
  if (lastDate && lastDate >= todayUTC) return data;

  return {
    ...data,
    closeIntentDetected: false,
    urgentFlag:          false,
  };
}

// ─── Default document structure ──────────────────────────────────────────────

/**
 * MEMORY_DEFAULTS
 *
 * Safe initial state for a brand-new bloomieMemory document. Mirrors
 * BLOOMIE_MEMORY_DEFAULTS on the frontend (db.js) so the first GET always
 * returns a shape the frontend can consume without null-checking every field.
 *
 * Static values only — server timestamps (createdAt, updatedAt) and uid are
 * added at write time by ensureBloomieMemory().
 */
const MEMORY_DEFAULTS = {
  // Lifecycle
  sessionCount:           0,
  lastSessionDate:        null,
  // Conversational state
  lastIntent:             null,
  lastPatternSummary:     null,
  lastSeverity:           null,
  priorSeverity:          null,
  lastUrgencyLevel:       null,
  lastRedFlagRoute:       null,
  lastDuration:           null,
  lastPregnancyChance:    false,
  // Symptom / topic memory
  lastSymptoms:           [],
  recentTopics:           [],
  recentConcernCategory:  null,
  // Safety / OOS state
  urgentFlag:             false,
  redFlagNoticeShown:     false,
  lastOosCategory:        null,
  oosCount:               0,
  lastSafeRedirect:       null,
  // Interaction state
  lastResolutionStatus:   null,
  closeIntentDetected:    false,
  lastGreetingUsed:       null,
  // Content tracking
  contentSuggestionsShown: [],
  declinedSuggestions:     [],
  // Condition memory
  reportedConditions:     [],
  activeTopicCluster:     null,
  // Cross-session concern continuity
  lastConcernsResolved:   [],
  lastConcernsUnresolved: [],
  lastAdviceGiven:        [],
};

// ─── Document lifecycle helpers ───────────────────────────────────────────────

/**
 * ensureBloomieMemory(uid)
 *
 * Guarantees that bloomieMemory/{uid} exists. If the document is absent it is
 * created with MEMORY_DEFAULTS plus server-generated timestamps.
 *
 * Returns the stored document data so callers can use it immediately without
 * a second Firestore round-trip.
 *
 * Note: on first creation the returned object contains null for createdAt /
 * updatedAt because FieldValue.serverTimestamp() is not resolved locally.
 * All other fields are present and safe.
 */
async function ensureBloomieMemory(uid) {
  const ref  = db.collection("bloomieMemory").doc(uid);
  const snap = await ref.get();

  if (snap.exists) return snap.data();

  const doc = {
    ...MEMORY_DEFAULTS,
    uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(doc);

  // Return a plain object (timestamps not resolved locally).
  return { ...MEMORY_DEFAULTS, uid, createdAt: null, updatedAt: null };
}

/**
 * isMinorWithoutConsent(user)
 *
 * Returns true when the request is from a confirmed minor (ageBand "13-17")
 * who has not yet received guardian consent. Adults with no yearOfBirth on
 * record (ageBand null) pass through — they are not confirmed minors.
 *
 * req.user is fully hydrated by requireAuth(), so this check costs nothing
 * beyond a property read.
 */
function isMinorWithoutConsent(user) {
  return user.ageBand === "13-17" && !user.consentSensitive;
}

// ─── Shared validation / patch builder ────────────────────────────────────────

/**
 * buildMemoryPatch(body, storedData, opts)
 *
 * Validates and sanitises every recognised field from `body` against the
 * Bloomie memory schema and returns a Firestore-ready patch object.
 *
 * Fields absent from `body` are omitted from the patch entirely, so stored
 * values they did not mention survive the write unchanged (merge-safe).
 *
 * opts:
 *   uid              {string}  — always required; written as patch.uid
 *   isFirst          {boolean} — true on the very first document write
 *                                (writes createdAt, sets sessionCount to 1)
 *   incrementSession {boolean} — true for PUT (increments sessionCount),
 *                                false for PATCH (leaves sessionCount untouched)
 */
function buildMemoryPatch(body, storedData, { uid, isFirst, incrementSession }) {
  const patch = {};

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  patch.uid             = uid;
  patch.lastSessionDate = new Date().toISOString();
  patch.updatedAt       = admin.firestore.FieldValue.serverTimestamp();

  if (incrementSession) {
    patch.sessionCount = isFirst ? 1 : admin.firestore.FieldValue.increment(1);
  }
  if (isFirst) {
    patch.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  // ── Symptom codes ─────────────────────────────────────────────────────────
  const symptoms = Array.isArray(body.lastSymptoms)
    ? body.lastSymptoms
        .filter(s => typeof s === "string" && VALID_SYMPTOM_KEYS.has(s.toUpperCase()))
        .map(s => s.toUpperCase())
        .slice(0, 20)
    : undefined;
  if (symptoms !== undefined) patch.lastSymptoms = symptoms;

  // ── Severity + server-derived priorSeverity ───────────────────────────────
  // priorSeverity is derived entirely server-side — never trusted from the
  // client. When the caller sends a new lastSeverity (or clears it with null),
  // we snapshot the currently stored value first, giving Bloomie a one-step
  // look-back ("last time your pain was moderate — has it changed?") with
  // zero additional Firestore reads.
  const severity = pickEnum(body.lastSeverity, VALID_SEVERITIES);
  if (severity !== undefined) {
    patch.lastSeverity  = severity;
    patch.priorSeverity = pickEnum(storedData?.lastSeverity ?? null, VALID_SEVERITIES) ?? null;
  }

  // ── Enums ─────────────────────────────────────────────────────────────────
  const urgencyLevel = pickEnum(body.lastUrgencyLevel, VALID_URGENCY_LEVELS);
  if (urgencyLevel !== undefined) patch.lastUrgencyLevel = urgencyLevel;

  const resolutionStatus = pickEnum(body.lastResolutionStatus, VALID_RESOLUTION_STATUS);
  if (resolutionStatus !== undefined) patch.lastResolutionStatus = resolutionStatus;

  const oosCategory = pickEnum(body.lastOosCategory, VALID_OOS_CATEGORIES);
  if (oosCategory !== undefined) patch.lastOosCategory = oosCategory;

  // ── Duration object ───────────────────────────────────────────────────────
  // Stored as a structured object, not a plain string, to support precise
  // duration arithmetic on the frontend ("3 days" vs "about a week").
  if (body.lastDuration && typeof body.lastDuration === "object") {
    patch.lastDuration = {
      days:  typeof body.lastDuration.days  === "number" ? body.lastDuration.days  : null,
      weeks: typeof body.lastDuration.weeks === "number" ? body.lastDuration.weeks : null,
      unit:  typeof body.lastDuration.unit  === "string" ? body.lastDuration.unit.slice(0, 20) : null,
      value: typeof body.lastDuration.value === "number" ? body.lastDuration.value : null,
    };
  } else if (body.lastDuration === null) {
    patch.lastDuration = null;
  }

  // ── Arrays ────────────────────────────────────────────────────────────────
  if (Array.isArray(body.recentTopics))
    patch.recentTopics = body.recentTopics.slice(0, 5).map(t => String(t).slice(0, 50));

  if (Array.isArray(body.contentSuggestionsShown))
    patch.contentSuggestionsShown = body.contentSuggestionsShown
      .filter(id => typeof id === "string" && id.length > 0 && id.length <= 80)
      .slice(0, 50);

  if (Array.isArray(body.declinedSuggestions))
    patch.declinedSuggestions = body.declinedSuggestions
      .filter(id => typeof id === "string" && id.length > 0 && id.length <= 80)
      .slice(0, 50);

  if (Array.isArray(body.reportedConditions))
    patch.reportedConditions = body.reportedConditions
      .filter(k => typeof k === "string" && VALID_CONDITION_KEYS.has(k))
      .slice(0, 20);

  if (Array.isArray(body.lastConcernsResolved))
    patch.lastConcernsResolved = body.lastConcernsResolved
      .filter(t => typeof t === "string" && VALID_TOPIC_CODES.has(t))
      .slice(0, 5);

  if (Array.isArray(body.lastConcernsUnresolved))
    patch.lastConcernsUnresolved = body.lastConcernsUnresolved
      .filter(t => typeof t === "string" && VALID_TOPIC_CODES.has(t))
      .slice(0, 5);

  if (Array.isArray(body.lastAdviceGiven))
    patch.lastAdviceGiven = body.lastAdviceGiven
      .filter(k => typeof k === "string" && k.length <= 60 &&
        VALID_ADVICE_PREFIXES.some(pfx => k === pfx || k.startsWith(pfx + "_")))
      .slice(0, 10);

  // ── Clamped strings ───────────────────────────────────────────────────────
  const lastGreetingUsed      = clampStr(body.lastGreetingUsed,      200);
  const lastSafeRedirect      = clampStr(body.lastSafeRedirect,      100);
  const lastPatternSummary    = clampStr(body.lastPatternSummary,    150);
  const lastRedFlagRoute      = clampStr(body.lastRedFlagRoute,       80);
  const recentConcernCategory = clampStr(body.recentConcernCategory,  80);

  if (lastGreetingUsed      !== undefined) patch.lastGreetingUsed      = lastGreetingUsed;
  if (lastSafeRedirect      !== undefined) patch.lastSafeRedirect      = lastSafeRedirect;
  if (lastPatternSummary    !== undefined) patch.lastPatternSummary    = lastPatternSummary;
  if (lastRedFlagRoute      !== undefined) patch.lastRedFlagRoute      = lastRedFlagRoute;
  if (recentConcernCategory !== undefined) patch.recentConcernCategory = recentConcernCategory;

  // ── lastIntent (free string or null) ──────────────────────────────────────
  if (typeof body.lastIntent === "string")
    patch.lastIntent = body.lastIntent.slice(0, 100);
  else if (body.lastIntent === null)
    patch.lastIntent = null;

  // ── oosCount (non-negative integer) ───────────────────────────────────────
  if (typeof body.oosCount === "number" && body.oosCount >= 0)
    patch.oosCount = Math.floor(body.oosCount);

  // ── activeTopicCluster (whitelisted condition key or null) ─────────────────
  if (typeof body.activeTopicCluster === "string" && VALID_CONDITION_KEYS.has(body.activeTopicCluster))
    patch.activeTopicCluster = body.activeTopicCluster;
  else if (body.activeTopicCluster === null)
    patch.activeTopicCluster = null;

  // ── Booleans ──────────────────────────────────────────────────────────────
  if (typeof body.lastPregnancyChance === "boolean") patch.lastPregnancyChance = body.lastPregnancyChance;
  if (typeof body.closeIntentDetected === "boolean") patch.closeIntentDetected = body.closeIntentDetected;
  if (typeof body.urgentFlag          === "boolean") patch.urgentFlag          = body.urgentFlag;
  if (typeof body.redFlagNoticeShown  === "boolean") patch.redFlagNoticeShown  = body.redFlagNoticeShown;

  return patch;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/bloomie-memory
 *
 * Returns the stored snapshot for the authenticated user. If no document
 * exists yet (first-time user), one is created with MEMORY_DEFAULTS and
 * that is returned. Session-specific flags (closeIntentDetected, urgentFlag)
 * are normalised to false when lastSessionDate is from a prior calendar day.
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const data = await ensureBloomieMemory(req.user.uid);
    res.json(normaliseMemoryForRead(data));
  } catch (e) {
    console.error("[bloomieMemory GET]", e.message);
    res.status(500).json({ error: "Failed to load memory" });
  }
});

/**
 * POST /api/bloomie-memory/session
 *
 * Lightweight session-start endpoint. Increments sessionCount and refreshes
 * timestamps without touching any conversational fields. The frontend should
 * call this when the Bloomie chat UI mounts and the user is about to start a
 * new session, so sessionCount stays meaningful even in sessions where no
 * symptoms are discussed and persistMemory() never fires.
 *
 * Consent guard: same inline ageBand check as PUT.
 */
router.post("/session", requireAuth, async (req, res) => {
  if (isMinorWithoutConsent(req.user)) {
    return res.status(403).json({ error: "Guardian consent required to start a session" });
  }

  try {
    // Ensure the document exists before incrementing — safe for first-time users.
    await ensureBloomieMemory(req.user.uid);

    await db.collection("bloomieMemory").doc(req.user.uid).set({
      sessionCount:    admin.firestore.FieldValue.increment(1),
      lastSessionDate: new Date().toISOString(),
      updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    res.json({ ok: true });
  } catch (e) {
    console.error("[bloomieMemory POST /session]", e.message);
    res.status(500).json({ error: "Failed to start session" });
  }
});

/**
 * PUT /api/bloomie-memory
 *
 * Full upsert after a meaningful exchange. This is the primary write route
 * called by persistMemory() on the frontend.
 *
 * Lifecycle:
 *   - First call: creates the document with createdAt; sessionCount = 1.
 *   - Subsequent calls: increments sessionCount, refreshes timestamps.
 *   - All incoming fields are validated and sanitised before writing.
 *   - Fields not included in this payload are preserved from the previous
 *     snapshot via { merge: true }.
 *   - priorSeverity is derived server-side whenever lastSeverity is present.
 *
 * Consent guard (inline, no extra DB read):
 *   requireAuth already reads users/{uid} and sets req.user.ageBand.
 *   Teen users (ageBand "13-17") without guardian consent are blocked from
 *   writing memory. Adults with no yearOfBirth set (ageBand null) pass through
 *   — they are not confirmed minors.
 */
router.put("/", requireAuth, async (req, res) => {
  if (isMinorWithoutConsent(req.user)) {
    return res.status(403).json({ error: "Guardian consent required to save session data" });
  }

  try {
    const uid  = req.user.uid;
    const ref  = db.collection("bloomieMemory").doc(uid);
    const snap = await ref.get();

    const isFirst    = !snap.exists;
    const storedData = snap.exists ? snap.data() : null;

    const patch = buildMemoryPatch(req.body, storedData, {
      uid,
      isFirst,
      incrementSession: true,
    });

    await ref.set(patch, { merge: true });
    res.json({ ok: true, created: isFirst });
  } catch (e) {
    console.error("[bloomieMemory PUT]", e.message);
    res.status(500).json({ error: "Failed to save memory" });
  }
});

/**
 * PATCH /api/bloomie-memory
 *
 * Incremental mid-session update. Accepts the same field set as PUT and uses
 * identical validation, but does NOT increment sessionCount. Suitable for
 * updating a single field (e.g. oosCount, urgentFlag, redFlagNoticeShown)
 * during an ongoing conversation without marking a full session boundary.
 *
 * Merge-safe: only fields explicitly present in the request body are written.
 * All other stored fields are preserved.
 *
 * Consent guard: same inline ageBand check as PUT.
 */
router.patch("/", requireAuth, async (req, res) => {
  if (isMinorWithoutConsent(req.user)) {
    return res.status(403).json({ error: "Guardian consent required to update session data" });
  }

  try {
    const uid  = req.user.uid;
    const ref  = db.collection("bloomieMemory").doc(uid);
    const snap = await ref.get();

    // PATCH requires the document to already exist. If it doesn't, the frontend
    // should call GET first (which triggers ensureBloomieMemory), then PATCH.
    if (!snap.exists) {
      return res.status(404).json({ error: "No memory document found. Call GET first to initialise." });
    }

    const patch = buildMemoryPatch(req.body, snap.data(), {
      uid,
      isFirst:          false,
      incrementSession: false,
    });

    await ref.set(patch, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error("[bloomieMemory PATCH]", e.message);
    res.status(500).json({ error: "Failed to update memory" });
  }
});

export default router;
