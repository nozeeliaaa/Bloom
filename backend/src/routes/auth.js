import express from "express";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { auth, db } from "../firebaseAdmin.js";
import { sendMailTo } from "../mailer.js";
import { generateInviteToken } from "../utils/consentToken.js";

const router = express.Router();
const FRONTEND_URL = process.env.APP_BASE_URL || "https://bloom-8401a.web.app";

/**
 * Verify Firebase ID token from frontend
 */
router.post("/verify", async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing token" });
  try {
    const decoded = await auth.verifyIdToken(token);
    res.json({ uid: decoded.uid, email: decoded.email });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

/**
 * POST /api/auth/register-minor
 * Creates a DISABLED Firebase account + sends guardian consent email.
 * No account is active until the guardian approves.
 */
router.post("/register-minor", async (req, res) => {
  try {
    const { email, password, yearOfBirth, guardianEmail } = req.body || {};

    if (!email || !password || !yearOfBirth || !guardianEmail) {
      return res.status(400).json({ error: "email, password, yearOfBirth, and guardianEmail are all required." });
    }

    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRx.test(email) || !emailRx.test(guardianEmail)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    const yob = Number(yearOfBirth);
    if (!Number.isFinite(yob) || yob < 1900 || yob > new Date().getFullYear()) {
      return res.status(400).json({ error: "Invalid year of birth." });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    // Create a DISABLED Firebase account - teen cannot log in until guardian approves
    let userRecord;
    try {
      userRecord = await getAuth().createUser({
        email,
        password,
        emailVerified: false,
        disabled: true,
      });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        return res.status(409).json({ error: "An account with this email already exists." });
      }
      throw err;
    }

    const teenUid = userRecord.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Write user profile to Firestore
    await db.collection("users").doc(teenUid).set({
      role: "user",
      email,
      profile: {
        yearOfBirth: yob,
        ageBand: "10-17",
        mode: "account",
        consentSensitive: false,
        remindersEnabled: false,
        reminderTime: "09:00",
        nickname: null,
        avatar: "👤",
        goal: "period",
        onboardingCompleted: false,
      },
      healthProfile: { avgCycleLength: null, periodDuration: null, weightKg: null, heightCm: null, lmpDate: null },
      biometricProfile: { activityLevel: null, sleepScore: null, stressLevel: null },
      game: { xp: 0, level: 1, sessionsPlayed: 0 },
      createdAt: now,
      updatedAt: now,
    });

    // Create consent document
    const { token, expiresAt } = generateInviteToken();
    const consentId = `${teenUid}_pending_${Date.now()}`;
    const consentRef = db.collection("consents").doc(consentId);

    const backendUrl = `${req.protocol}://${req.get("host")}`;
    const approveLink = `${backendUrl}/api/consent/approve?token=${token}&consentId=${consentId}`;
    const denyLink    = `${backendUrl}/api/consent/deny?token=${token}&consentId=${consentId}`;

    await consentRef.set({
      teenUid,
      guardianUid: null,
      guardianEmail,
      guardianHasAccount: false,
      status: "pending",
      scope: { sensitiveModules: false, pregnancyMode: false },
      inviteToken: token,
      inviteTokenExpiresAt: expiresAt,
      inviteTokenUsed: false,
      requestedAt: now,
      statusUpdatedAt: now,
      decidedAt: null,
    });

    // Send guardian email
    await sendMailTo({
      to: guardianEmail,
      subject: "Action Required: A teen is requesting your consent on Bloom",
      html: `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:'Helvetica Neue',Arial,sans-serif;background:#f9f9f9;">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;padding:36px 32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="text-align:center;margin-bottom:24px;">
    <span style="font-size:2.5rem;">🌸</span>
    <h1 style="color:#c0003c;font-size:1.4rem;margin:8px 0 4px;">Bloom – Guardian Consent Request</h1>
  </div>
  <p style="color:#333;line-height:1.6;">Hello,</p>
  <p style="color:#333;line-height:1.6;">A teen has requested your consent to create an account on <strong>Bloom</strong>, a reproductive health tracking app. They listed you as their parent or guardian.</p>
  <p style="color:#333;line-height:1.6;">Please review this request and respond using the buttons below:</p>
  <div style="display:flex;justify-content:center;gap:16px;margin:28px 0;flex-wrap:wrap;">
    <a href="${approveLink}" style="display:inline-block;background:#27ae60;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;">✅ Approve Access</a>
    <a href="${denyLink}" style="display:inline-block;background:#c0003c;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;">❌ Deny Access</a>
  </div>
  <p style="color:#888;font-size:0.85rem;line-height:1.6;">These links expire in 48 hours. If you don't know who sent this, you can safely ignore it - no account will be activated without your approval.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  <p style="color:#aaa;font-size:0.8rem;text-align:center;">The Bloom Team &nbsp;|&nbsp; bloom-8401a.web.app</p>
</div>
</body></html>`,
    });

    return res.json({ ok: true, message: "Consent request sent to guardian." });
  } catch (err) {
    console.error("POST /auth/register-minor error:", err);
    return res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

export default router;