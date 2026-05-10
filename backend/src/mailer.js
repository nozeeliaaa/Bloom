/**
 * backend/src/mailer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared email utility using Outlook SMTP.
 *
 * Required env vars:
 *   HELPDESK_EMAIL_PASS  - password for bloomhelpdesk@outlook.com
 *
 * Usage:
 *   import { sendToHelpdesk } from "../mailer.js";
 *   await sendToHelpdesk({ subject: "...", html: "..." });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import nodemailer from "nodemailer";

const HELPDESK_EMAIL = "bloomhelpdesk@outlook.com";

function createTransport() {
  return nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: HELPDESK_EMAIL,
      pass: process.env.HELPDESK_EMAIL_PASS,
    },
  });
}
/**
 * Send an email to the Bloom helpdesk inbox.
 * @param {{ subject: string, html: string, replyTo?: string }} opts
 */
export async function sendToHelpdesk({ subject, html, replyTo }) {
  if (!process.env.HELPDESK_EMAIL_PASS) {
    console.warn("[mailer] HELPDESK_EMAIL_PASS not set - skipping email.");
    return false;
  }

  const transporter = createTransport();
  await transporter.sendMail({
    from: `"Bloom App" <${HELPDESK_EMAIL}>`,
    to:   HELPDESK_EMAIL,
    replyTo: replyTo || HELPDESK_EMAIL,
    subject,
    html,
  });
  return true;
}

/**
 * Send an email to an arbitrary recipient (e.g. guardian consent emails).
 * @param {{ to: string, subject: string, html: string }} opts
 */
export async function sendMailTo({ to, subject, html }) {
  if (!process.env.HELPDESK_EMAIL_PASS) {
    console.warn("[mailer] HELPDESK_EMAIL_PASS not set - skipping email.");
    return false;
  }

  const transporter = createTransport();
  await transporter.sendMail({
    from: `"Bloom App" <${HELPDESK_EMAIL}>`,
    to,
    subject,
    html,
  });
  return true;
}
