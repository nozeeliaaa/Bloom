/**
 * backend/src/routes/feedback.js
 *
 * POST /api/feedback
 * - Stores Bloomie thumbs-up/thumbs-down feedback in Firestore.
 * - Forwards every feedback event to the Bloom helpdesk inbox.
 */

import express from "express";
import { db, admin } from "../firebaseAdmin.js";
import { sendToHelpdesk } from "../mailer.js";

const FieldValue = admin.firestore.FieldValue;
const router = express.Router();

const VALID_FEEDBACK_TYPES = new Set(["thumbs_up", "thumbs_down"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

router.post("/", async (req, res) => {
  try {
    let uid = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const decoded = await admin.auth().verifyIdToken(authHeader.split(" ")[1]);
        uid = decoded.uid;
      } catch (_) {
        uid = null;
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
    } = req.body || {};

    if (!VALID_FEEDBACK_TYPES.has(feedbackType)) {
      return res.status(400).json({ error: "Invalid feedbackType. Must be thumbs_up or thumbs_down." });
    }

    const safeSessionId = typeof sessionId === "string" ? sessionId.slice(0, 64) : null;
    const safeNodeId = typeof nodeId === "string" ? nodeId.slice(0, 80) : null;
    const safeFlowName = typeof flowName === "string" ? flowName.slice(0, 80) : null;
    const safeMessageText = typeof messageText === "string" ? messageText.slice(0, 500) : "";
    const safeComment = typeof comment === "string" && comment.trim() ? comment.slice(0, 300) : null;

    const safeConversationSlice = Array.isArray(conversationSlice)
      ? conversationSlice.slice(0, 3).map((m) => ({
          from: typeof m?.from === "string" ? m.from.slice(0, 10) : "unknown",
          text: typeof m?.text === "string" ? m.text.slice(0, 200) : "",
        }))
      : [];

    const docData = {
      userId: uid || "anonymous",
      feedbackType,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (safeSessionId) docData.sessionId = safeSessionId;
    if (safeNodeId) docData.nodeId = safeNodeId;
    if (safeFlowName) docData.flowName = safeFlowName;
    if (safeMessageText) docData.messageText = safeMessageText;
    if (safeComment) docData.comment = safeComment;
    if (safeConversationSlice.length) docData.conversationSlice = safeConversationSlice;

    let stored = false;
    try {
      await db.collection("bloomieFeedback").add(docData);
      stored = true;
    } catch (writeErr) {
      console.warn("[feedback] Firestore write failed:", writeErr?.message || writeErr);
    }

    const feedbackLabel = feedbackType === "thumbs_up" ? "Helpful" : "Not Helpful";
    const conversationHtml = safeConversationSlice.length
      ? `<ul>${safeConversationSlice.map((m) => `<li><strong>${escapeHtml(m.from)}:</strong> ${escapeHtml(m.text)}</li>`).join("")}</ul>`
      : "<em>Not provided</em>";

    const html = `
      <h2 style="font-family:sans-serif;color:#d85a98;">New Bloomie Feedback</h2>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:620px;">
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;width:150px;">Feedback</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${escapeHtml(feedbackLabel)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">User ID</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;font-family:monospace;">${escapeHtml(uid || "anonymous")}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Session ID</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;font-family:monospace;">${escapeHtml(safeSessionId || "n/a")}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Node</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${escapeHtml(safeNodeId || "n/a")}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Flow</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${escapeHtml(safeFlowName || "n/a")}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;vertical-align:top;">Message</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;white-space:pre-wrap;">${escapeHtml(safeMessageText || "n/a")}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;vertical-align:top;">Comment</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;white-space:pre-wrap;">${escapeHtml(safeComment || "n/a")}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;vertical-align:top;">Recent context</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${conversationHtml}</td></tr>
      </table>
      <p style="font-family:sans-serif;font-size:12px;color:#999;margin-top:16px;">
        Sent via Bloomie feedback endpoint - ${new Date().toUTCString()}
      </p>
    `;

    let emailed = false;
    try {
      emailed = await sendToHelpdesk({
        subject: `[Bloom Feedback] ${feedbackLabel}`,
        html,
      });
    } catch (mailErr) {
      console.warn("[feedback] helpdesk email failed:", mailErr?.message || mailErr);
    }

    if (!stored && !emailed) {
      return res.status(500).json({ error: "Failed to store or forward feedback" });
    }

    return res.json({ ok: true, stored, emailed });
  } catch (e) {
    console.error("feedback POST error:", e);
    return res.status(500).json({ error: "Failed to process feedback" });
  }
});

export default router;
