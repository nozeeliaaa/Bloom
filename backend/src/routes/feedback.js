/**
 * backend/src/routes/feedback.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomie thumbs-up / thumbs-down feedback endpoint.
 *
 * POST /api/feedback
 *   Stores one feedback event in the bloomieFeedback Firestore collection.
 *   Auth is optional - logged-in users are identified by uid; anonymous users
 *   are stored with userId: "anonymous".
 *
 * Collection: bloomieFeedback
 * Fields:
 *   sessionId          - random ID for the chat session
 *   userId             - Firebase uid, or "anonymous"
 *   nodeId             - ctx.state when the reaction was given
 *   flowName           - ctx.topic at that moment
 *   messageText        - the bot message text being reacted to
 *   feedbackType       - "thumbs_up" | "thumbs_down"
 *   comment            - optional free-text comment (omitted if empty)
 *   conversationSlice  - last 3 messages [{ from, text }] for context
 *   createdAt          - server timestamp
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express       from "express";
import { db, admin } from "../firebaseAdmin.js";

const FieldValue = admin.firestore.FieldValue;
const router     = express.Router();

const VALID_FEEDBACK_TYPES = new Set(["thumbs_up", "thumbs_down"]);

// POST /api/feedback
router.post("/", async (req, res) => {
  try {
    // Optional auth - attempt to verify token if present; proceed as anonymous
    // if the header is absent or the token is invalid.
    let uid = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(" ")[1]);
        uid = decoded.uid;
      } catch (_) {
        // Expired or invalid token - treat as anonymous rather than rejecting
      }
    }

    const {
      sessionId,
      nodeId,
      flowName,
      messageText,
      feedbackType,
      comment,
      conversationSlice,
    } = req.body;

    // feedbackType is the only required field
    if (!VALID_FEEDBACK_TYPES.has(feedbackType)) {
      return res.status(400).json({ error: "Invalid feedbackType. Must be thumbs_up or thumbs_down." });
    }

    // Build the document - every field is explicitly whitelisted and bounded
    const docData = {
      userId:      uid || "anonymous",
      feedbackType,
      createdAt:   FieldValue.serverTimestamp(),
    };

    if (typeof sessionId   === "string") docData.sessionId   = sessionId.slice(0, 64);
    if (typeof nodeId      === "string") docData.nodeId      = nodeId.slice(0, 80);
    if (typeof flowName    === "string") docData.flowName    = flowName.slice(0, 80);
    if (typeof messageText === "string") docData.messageText = messageText.slice(0, 500);
    if (typeof comment     === "string" && comment.trim()) {
      docData.comment = comment.slice(0, 300);
    }

    if (Array.isArray(conversationSlice)) {
      docData.conversationSlice = conversationSlice
        .slice(0, 3)
        .map((m) => ({
          from: typeof m?.from === "string" ? m.from.slice(0, 10) : "unknown",
          text: typeof m?.text === "string" ? m.text.slice(0, 200) : "",
        }));
    }

    await db.collection("bloomieFeedback").add(docData);

    res.json({ ok: true });
  } catch (e) {
    console.error("feedback POST error:", e);
    res.status(500).json({ error: "Failed to write feedback" });
  }
});

export default router;
