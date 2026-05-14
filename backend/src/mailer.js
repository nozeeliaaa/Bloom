/**
 * backend/src/mailer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared email utility - provider-agnostic via env vars.
 *
 * Required env vars:
 *   SMTP_USER  - sender email address (e.g. bloomapp@gmail.com)
 *   SMTP_PASS  - app password for the sender account
 *
 * Optional env vars (defaults to Gmail):
 *   SMTP_HOST  - SMTP hostname      (default: smtp.gmail.com)
 *   SMTP_PORT  - SMTP port number   (default: 587)
 *   SMTP_FROM  - display name       (default: "Bloom App")
 *
 * Gmail setup (recommended):
 *   1. Enable 2-Step Verification on the Gmail account
 *   2. Go to myaccount.google.com → Security → App passwords
 *   3. Generate an app password for "Mail"
 *   4. Set SMTP_USER=your@gmail.com and SMTP_PASS=the16charpassword
 * ─────────────────────────────────────────────────────────────────────────────
 */

import nodemailer from "nodemailer";

function getConfig() {
  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || process.env.HELPDESK_EMAIL || "",
    pass: process.env.SMTP_PASS || process.env.HELPDESK_EMAIL_PASS || "",
    from: process.env.SMTP_FROM || "Bloom App",
  };
}

function createTransport() {
  const { host, port, user, pass } = getConfig();
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function isConfigured() {
  const { user, pass } = getConfig();
  return !!(user && pass);
}

/**
 * Send an email to an arbitrary recipient.
 * @param {{ to: string, subject: string, html: string }} opts
 */
export async function sendMailTo({ to, subject, html }) {
  if (!isConfigured()) {
    console.warn("[mailer] SMTP_USER / SMTP_PASS not set - skipping email to:", to);
    return false;
  }
  const { user, from } = getConfig();
  const transporter = createTransport();
  await transporter.sendMail({
    from: `"${from}" <${user}>`,
    to,
    subject,
    html,
  });
  return true;
}

/**
 * Send an email to the Bloom helpdesk inbox.
 * @param {{ subject: string, html: string, replyTo?: string }} opts
 */
export async function sendToHelpdesk({ subject, html, replyTo }) {
  if (!isConfigured()) {
    console.warn("[mailer] SMTP_USER / SMTP_PASS not set - skipping helpdesk email.");
    return false;
  }
  const { user, from } = getConfig();
  const transporter = createTransport();
  await transporter.sendMail({
    from: `"${from}" <${user}>`,
    to: user,
    replyTo: replyTo || user,
    subject,
    html,
  });
  return true;
}
