/**
 * backend/src/routes/contact.js
 *
 * POST /api/contact
 *   Saves the submission to Firestore (contactMessages collection) and
 *   sends an email notification to bloomhelpdesk@outlook.com.
 *   Returns a requestId (BLM-YYYY-XXXXX) to show the user.
 *
 * Rate-limited to 5 requests per 15 minutes per IP.
 */

import express       from "express";
import rateLimit     from "express-rate-limit";
import { db, admin } from "../firebaseAdmin.js";
import { sendToHelpdesk } from "../mailer.js";

const FieldValue = admin.firestore.FieldValue;
const router     = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many messages sent. Please try again later." },
});

const VALID_SUBJECTS = new Set(["bug", "data", "privacy", "feedback", "accessibility", "other"]);

const SUBJECT_LABELS = {
  bug:           "Something is not working",
  data:          "Question about my data",
  privacy:       "Privacy concern",
  feedback:      "General feedback",
  accessibility: "Accessibility issue",
  other:         "Other",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function generateRequestId() {
  const year   = new Date().getFullYear();
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  return `BLM-${year}-${suffix}`;
}

router.post("/", limiter, async (req, res) => {
  try {
    const { subject, message, email, name, userId } = req.body;

    if (!VALID_SUBJECTS.has(subject)) {
      return res.status(400).json({ error: "Invalid subject." });
    }
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const safeSubject = subject.slice(0, 40);
    const safeMessage = message.trim().slice(0, 1200);
    const safeEmail   = typeof email  === "string" ? email.trim().slice(0, 200) : null;
    const safeName    = typeof name   === "string" ? name.trim().slice(0, 100)  : null;
    const safeUserId  = typeof userId === "string" ? userId.slice(0, 128)       : null;

    const requestId = generateRequestId();

    // 1 = Save to Firestore (best-effort)
    let stored = false;
    try {
      await db.collection("contactMessages").add({
        requestId,
        subject:    safeSubject,
        message:    safeMessage,
        replyEmail: safeEmail   || null,
        name:       safeName    || null,
        userId:     safeUserId  || null,
        status:     "not_started",
        source:     "contact-form",
        createdAt:  FieldValue.serverTimestamp(),
      });
      stored = true;
    } catch (writeErr) {
      console.warn("[contact] Firestore write failed:", writeErr?.message || writeErr);
    }

    const subjectLabel = SUBJECT_LABELS[safeSubject] || safeSubject;

    // 2 = Email the helpdesk (non-fatal if it fails)
    const html = `
      <h2 style="font-family:sans-serif;color:#d85a98;">New message via Bloom Contact Form</h2>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:560px;">
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;width:130px;">Request ID</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;font-family:monospace;">${escapeHtml(requestId)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Subject</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${escapeHtml(subjectLabel)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Name</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${safeName ? escapeHtml(safeName) : "<em>not provided</em>"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Reply-to</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${safeEmail ? escapeHtml(safeEmail) : "<em>not provided</em>"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">User ID</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;font-family:monospace;">${safeUserId ? escapeHtml(safeUserId) : "<em>anonymous</em>"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;vertical-align:top;">Message</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;white-space:pre-wrap;">${escapeHtml(safeMessage)}</td></tr>
      </table>
      <p style="font-family:sans-serif;font-size:12px;color:#999;margin-top:16px;">
        Sent via Bloom Help &amp; Contact page &mdash; ${new Date().toUTCString()}
      </p>
    `;

    let emailSent = false;
    try {
      emailSent = await sendToHelpdesk({
        subject: `[Bloom Contact] ${subjectLabel} - ${requestId}`,
        html,
        replyTo: safeEmail || undefined,
      });
    } catch (mailErr) {
      console.warn("[contact] email send failed:", mailErr.message);
    }

    if (!emailSent) {
      return res.status(503).json({
        error: "Helpdesk inbox is temporarily unavailable. Please try again shortly.",
        requestId,
        delivered: false,
        stored,
      });
    }

    res.json({ ok: true, requestId, stored, delivered: true });
  } catch (e) {
    console.error("[contact] POST error:", e);
    res.status(500).json({ error: "Failed to send message. Please try again." });
  }
});

export default router;
