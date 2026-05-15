/**
 * backend/src/routes/bloomieAnalytics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomie analytics event ingestion endpoint.
 * Modelled on bloomieSafetyLog.js - same structure, auth optional.
 *
 * POST /api/bloomie/analytics
 *   Writes one event to the bloomie_analytics Firestore collection.
 *   Auth is optional: uid defaults to "anonymous" for unauthenticated users.
 *   Returns 200 even on Firestore failure - logging must never block the chat.
 *
 * Rate limit: 60 requests / minute per IP (using express-rate-limit).
 *
 * Collection: bloomie_analytics
 * Valid event types:
 *   route_matched        - HIGH confidence route selected
 *   route_clarification  - MEDIUM confidence soft confirmation shown
 *   route_fallback       - CONFIDENCE_FALLBACK triggered (repeat low-conf)
 *   route_no_match       - LOW confidence, NARROWING shown
 *   urgency_escalation   - any _URGENT node reached
 *   oos_event            - OOS handler fired
 *   oos_repair           - NARROWING triggered by OOS streak repair
 *   emotion_classified   - tone resolved for a message
 *   session_end          - beforeunload fired
 *   memory_recall_used   - backgroundContext or entityHistory seeded
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express    from "express";
import rateLimit  from "express-rate-limit";
import { db, admin } from "../firebaseAdmin.js";
import { auth }      from "../firebaseAdmin.js";

const FieldValue = admin.firestore.FieldValue;
const router = express.Router();

const VALID_EVENT_TYPES = new Set([
  "route_matched",
  "route_clarification",
  "route_fallback",
  "route_no_match",
  "urgency_escalation",
  "oos_event",
  "oos_repair",
  "emotion_classified",
  "session_end",
  "memory_recall_used",
]);

// ── Rate limiter: 60 requests / minute per IP ─────────────────────────────────
const analyticsLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            (req) => req.method === "OPTIONS",
  handler:         (_req, res) =>
    res.status(429).json({ error: "Too many requests. Please wait a moment." }),
});

// ── Optional auth helper ──────────────────────────────────────────────────────
// Attempts to verify the Bearer token; sets req.uid to the Firebase UID on
// success, or "anonymous" if the token is absent or invalid. Never blocks.
async function resolveUid(req) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return "anonymous";
    const token   = header.split(" ")[1];
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid || "anonymous";
  } catch {
    return "anonymous";
  }
}

// POST /api/bloomie/analytics
router.post("/", analyticsLimiter, async (req, res) => {
  // Always return 200 - logging must never interrupt the chat
  try {
    const { eventType, payload = {}, meta = {}, ts } = req.body ?? {};

    if (!eventType || !VALID_EVENT_TYPES.has(eventType)) {
      // Unknown event types are silently discarded - logging must never block the chat
      return res.json({ ok: true });
    }

    const uid = await resolveUid(req);

    const doc = {
      eventType,
      uid,
      ts:       FieldValue.serverTimestamp(),
      clientTs: typeof ts === "number" ? ts : null,
    };

    // ── Whitelist payload fields ──────────────────────────────────────────────
    if (typeof payload.route         === "string") doc.route         = payload.route.slice(0, 80);
    if (typeof payload.reason        === "string") doc.reason        = payload.reason.slice(0, 120);
    if (typeof payload.input         === "string") doc.input         = payload.input.slice(0, 120); // already anonymised client-side
    if (typeof payload.tone          === "string") doc.tone          = payload.tone.slice(0, 40);
    if (typeof payload.source        === "string") doc.source        = payload.source.slice(0, 40);
    if (typeof payload.type          === "string") doc.type          = payload.type.slice(0, 40);
    if (typeof payload.primaryIntent === "string") doc.primaryIntent = payload.primaryIntent.slice(0, 40);
    if (typeof payload.fallbackCount === "number") doc.fallbackCount = payload.fallbackCount;
    if (typeof payload.streak        === "number") doc.streak        = payload.streak;
    if (typeof payload.sessionDepth  === "number") doc.sessionDepth  = payload.sessionDepth;

    // ── Whitelist meta (session snapshot) fields ──────────────────────────────
    if (typeof meta.sessionDepth            === "number") doc.meta_sessionDepth            = meta.sessionDepth;
    if (typeof meta.currentState            === "string") doc.meta_currentState            = meta.currentState.slice(0, 80);
    if (typeof meta.confidenceTier          === "string") doc.meta_confidenceTier          = meta.confidenceTier.slice(0, 20);
    if (typeof meta.toneSource              === "string") doc.meta_toneSource              = meta.toneSource.slice(0, 40);
    if (typeof meta.tone                    === "string") doc.meta_tone                    = meta.tone.slice(0, 40);
    if (typeof meta.confidenceFallbackCount === "number") doc.meta_confidenceFallbackCount = meta.confidenceFallbackCount;
    if (typeof meta.urgency                 === "string") doc.meta_urgency                 = meta.urgency.slice(0, 40);
    if (typeof meta.oosStreakCount          === "number") doc.meta_oosStreakCount          = meta.oosStreakCount;

    try {
      await db.collection("bloomie_analytics").add(doc);
    } catch (firestoreErr) {
      // Log server-side but never surface to client - return 200 anyway
      console.error("bloomieAnalytics: Firestore write failed:", firestoreErr.message);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("bloomieAnalytics POST error:", e);
    // Never 500 - logging must not interrupt the chat
    res.json({ ok: true });
  }
});

export default router;
