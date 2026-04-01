/**
 * backend/src/routes/contact.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Contact form endpoint - called from help.html.
 *
 * POST /api/contact
 *   Body: { subject, message, email? }
 *
 *   1. Saves the submission to Firestore (contactMessages collection).
 *   2. Sends an email notification to bloomhelpdesk@outlook.com.
 *
 * Rate-limited to 5 requests per 15 minutes per IP.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express        from "express";
import rateLimit      from "express-rate-limit";
import { db, admin }  from "../firebaseAdmin.js";
import { sendToHelpdesk } from "../mailer.js";

const FieldValue = admin.firestore.FieldValue;
const router     = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many messages sent. Please try again later." },
});

const VALID_SUBJECTS = new Set(["bug", "data", "privacy", "feedback", "accessibility", "other"]);

router.post("/", limiter, async (req, res) => {
  try {
    const { subject, message, email } = req.body;

    if (!VALID_SUBJECTS.has(subject)) {
      return res.status(400).json({ error: "Invalid subject." });
    }
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const safeSubject = subject.slice(0, 40);
    const safeMessage = message.trim().slice(0, 1200);
    const safeEmail   = typeof email === "string" ? email.trim().slice(0, 200) : null;

    // 1. Save to Firestore
    await db.collection("contactMessages").add({
      subject:   safeSubject,
      message:   safeMessage,
      ...(safeEmail && { replyEmail: safeEmail }),
      createdAt: FieldValue.serverTimestamp(),
    });

    // 2. Email the helpdesk
    const subjectLabel = {
      bug:           "Something is not working",
      data:          "Question about my data",
      privacy:       "Privacy concern",
      feedback:      "General feedback",
      accessibility: "Accessibility issue",
      other:         "Other",
    }[safeSubject] || safeSubject;

    const html = `
      <h2 style="font-family:sans-serif;color:#d85a98;">New message via Bloom Contact Form</h2>
      <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:560px;">
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;width:120px;">Subject</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${subjectLabel}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;">Reply-to</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;">${safeEmail || "<em>not provided</em>"}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold;background:#f9f0f5;vertical-align:top;">Message</td>
            <td style="padding:6px 12px;border-left:3px solid #d85a98;white-space:pre-wrap;">${safeMessage}</td></tr>
      </table>
      <p style="font-family:sans-serif;font-size:12px;color:#999;margin-top:16px;">
        Sent via Bloom Help &amp; Contact page
      </p>
    `;

    await sendToHelpdesk({
      subject:  `[Bloom Contact] ${subjectLabel}`,
      html,
      replyTo:  safeEmail || undefined,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("contact POST error:", e);
    res.status(500).json({ error: "Failed to send message." });
  }
});

export default router;
