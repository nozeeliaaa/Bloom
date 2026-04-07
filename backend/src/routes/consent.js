// src/routes/consent.js
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateConsentRequest, validateConsentUpdate } from "../validators/validateConsent.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import { generateInviteToken, generateRevokeToken, isTokenExpired } from "../utils/consentToken.js";

const router = express.Router();

// ─── GET /consent/status ─────────────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snap = await db
      .collection("consents")
      .where("teenUid", "==", uid)
      .orderBy("requestedAt", "desc")
      .limit(1)
      .get();

    if (snap.empty) {
      return res.json({ ok: true, status: "none" });
    }

    const data = snap.docs[0].data();
    return res.json({
      ok: true,
      status: data.status,
      scope: data.scope,
      requestedAt: data.requestedAt,
      decidedAt: data.decidedAt || null,
    });
  } catch (err) {
    console.error("GET /consent/status error:", err);
    return res.status(500).json({ error: "Failed to fetch consent status" });
  }
});

// ─── POST /consent/request ───────────────────────────────────────────────────
router.post("/request", requireAuth, async (req, res) => {
  try {
    const teenUid = req.user.uid;

    if (req.user.ageBand !== "10-17") {
      return res.status(403).json({ error: "Only teens can request guardian consent" });
    }

    const validation = validateConsentRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const guardianEmail = validation.guardianEmail;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Check if guardian has a Bloom account
    let guardianUid = null;
    let guardianHasAccount = false;
    try {
      const guardianRecord = await auth.getUserByEmail(guardianEmail);
      guardianUid = guardianRecord.uid;
      guardianHasAccount = true;
    } catch {
      // Guardian has no account yet - invite still sent via email
    }

    if (guardianUid && guardianUid === teenUid) {
      return res.status(400).json({ error: "You cannot link yourself as a guardian" });
    }

    // Generate invite token
    const { token, expiresAt } = generateInviteToken();
    const consentId = guardianUid
      ? `${teenUid}_${guardianUid}`
      : `${teenUid}_pending_${Date.now()}`;

    const consentRef = db.collection("consents").doc(consentId);

    // Block duplicate pending/approved requests if guardian already has account
    if (guardianUid) {
      const existing = await consentRef.get();
      if (existing.exists) {
        const status = existing.data().status;
        if (status === "pending" || status === "approved") {
          return res.status(409).json({
            error: `A consent request already exists with status: ${status}`,
          });
        }
      }
    }

    // Save consent doc
    await consentRef.set({
      teenUid,
      guardianUid,           // null if guardian has no account yet
      guardianEmail,
      guardianHasAccount,
      status: "pending",
      scope: { sensitiveModules: false, pregnancyMode: false },
      inviteToken: token,
      inviteTokenExpiresAt: expiresAt,
      inviteTokenUsed: false,
      requestedAt: now,
      statusUpdatedAt: now,
      decidedAt: null,
    });

    if (guardianUid) {
      await db.collection("relationships").doc(consentId).set({
        teenUid,
        guardianUid,
        status: "invited",
        invitedAt: now,
      }, { merge: true });
    }

    // Build invite link
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    const approveLink = `${baseUrl}/api/consent/approve?token=${token}&consentId=${consentId}`;
    const denyLink    = `${baseUrl}/api/consent/deny?token=${token}&consentId=${consentId}`;

    // Write to mail collection - Firebase Trigger Email picks this up
    await db.collection("mail").add({
      to: guardianEmail,
      message: {
        subject: "A teen has requested your consent on Bloom",
        html: `
          <p>Hello,</p>
          <p>A teen has requested you to be their guardian on <strong>Bloom</strong>.</p>
          <p>Please respond to their request using one of the buttons below:</p>
          <p>
            <a href="${approveLink}" style="background:#27ae60;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:10px;">✅ Approve</a>
            <a href="${denyLink}" style="background:#c0003c;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">❌ Deny</a>
          </p>
          <p>These links expire in 48 hours.</p>
          ${!data.guardianHasAccount
            ? `<p>You'll need to <a href="${baseUrl}/signup">create a Bloom account</a> first before you can respond.</p>`
            : ""}
          <p>If you don't know who sent this, you can safely ignore this email.</p>
          <br/>
          <p>- The Bloom Team</p>
        `,
      },
    });

    await logAudit({
      actorUid:   teenUid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CONSENT_REQUESTED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  guardianUid || guardianEmail,
      meta:       { changedFields: ["status", "scope"], guardianHasAccount },
    });

    return res.json({ ok: true, message: "Consent invite sent to guardian's email" });
  } catch (err) {
    console.error("POST /consent/request error:", err);
    return res.status(500).json({ error: "Failed to send consent request" });
  }
});

// ─── POST /consent/verify-token ─────────────────────────────────────────────
// Guardian clicks the email link → frontend calls this to validate the token
router.post("/verify-token", requireAuth, async (req, res) => {
  try {
    const guardianUid = req.user.uid;
    const { token, consentId } = req.body;

    if (!token || !consentId) {
      return res.status(400).json({ error: "token and consentId are required" });
    }

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Consent request not found" });
    }

    const data = snap.data();

    // Validate token
    if (data.inviteToken !== token) {
      return res.status(401).json({ error: "Invalid invite token" });
    }

    if (data.inviteTokenUsed) {
      return res.status(409).json({ error: "This invite link has already been used" });
    }

    if (isTokenExpired(data.inviteTokenExpiresAt)) {
      return res.status(410).json({ error: "This invite link has expired" });
    }

    if (data.status !== "pending") {
      return res.status(409).json({
        error: `Consent is already ${data.status}`,
      });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Link guardian to consent doc if they didn't have an account when invite was sent
    const updates = {
      inviteTokenUsed: true,
      guardianUid,
      guardianHasAccount: true,
      statusUpdatedAt: now,
    };

    await consentRef.update(updates);

    // Ensure relationship doc exists now that guardian is confirmed
    const relationshipId = `${data.teenUid}_${guardianUid}`;
    await db.collection("relationships").doc(relationshipId).set({
      teenUid: data.teenUid,
      guardianUid,
      status: "invited",
      invitedAt: now,
    }, { merge: true });

    await logAudit({
      actorUid:   guardianUid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CONSENT_TOKEN_VERIFIED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  data.teenUid,
      meta:       { changedFields: ["guardianUid", "inviteTokenUsed"] },
    });

    return res.json({
      ok: true,
      message: "Token verified. You can now approve or deny this consent request.",
      consentId: relationshipId, // use this ID for PATCH /consent/respond
    });
  } catch (err) {
    console.error("POST /consent/verify-token error:", err);
    return res.status(500).json({ error: "Failed to verify token" });
  }
});

// ─── PATCH /consent/update-guardian-email/:consentId ────────────────────────
router.patch("/update-guardian-email/:consentId", requireAuth, async (req, res) => {
  try {
    const teenUid = req.user.uid;
    const { consentId } = req.params;

    if (req.user.ageBand !== "10-17") {
      return res.status(403).json({ error: "Only teens can update guardian email" });
    }

    const validation = validateConsentRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const newGuardianEmail = validation.guardianEmail;

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Consent request not found" });
    }

    const data = snap.data();

    // Only the teen who created the request can update it
    if (data.teenUid !== teenUid) {
      return res.status(403).json({ error: "Not authorized to update this consent request" });
    }

    // Can only update if still pending
    if (data.status !== "pending") {
      return res.status(409).json({
        error: `Cannot update guardian email on a consent with status: ${data.status}`,
      });
    }

    // Block if new email is the same as current
    if (data.guardianEmail === newGuardianEmail) {
      return res.status(400).json({ error: "New guardian email must be different from the current one" });
    }

    // Check if new guardian has a Bloom account
    let newGuardianUid = null;
    try {
      const record = await auth.getUserByEmail(newGuardianEmail);
      newGuardianUid = record.uid;
      if (newGuardianUid === teenUid) {
        return res.status(400).json({ error: "You cannot link yourself as a guardian" });
      }
    } catch {
      // No account - fine, invite still goes out
    }

    // Generate fresh token - invalidates old one by overwriting
    const { token, expiresAt } = generateInviteToken();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    const approveLink = `${baseUrl}/api/consent/approve?token=${token}&consentId=${consentId}`;
    const denyLink    = `${baseUrl}/api/consent/deny?token=${token}&consentId=${consentId}`;

    await consentRef.update({
      guardianEmail:          newGuardianEmail,
      guardianUid:            newGuardianUid,
      guardianHasAccount:     !!newGuardianUid,
      inviteToken:            token,
      inviteTokenExpiresAt:   expiresAt,
      inviteTokenUsed:        false,
      statusUpdatedAt:        now,
    });

    // Send new invite email
    await db.collection("mail").add({
      to: newGuardianEmail,
      message: {
        subject: "A teen has requested your consent on Bloom",
        html: `
          <p>Hello,</p>
          <p>A teen has requested you to be their guardian on <strong>Bloom</strong>.</p>
          <p>Please respond to their request using one of the buttons below:</p>
          <p>
            <a href="${approveLink}" style="background:#27ae60;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:10px;">✅ Approve</a>
            <a href="${denyLink}" style="background:#c0003c;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">❌ Deny</a>
          </p>
          <p>These links expire in 48 hours.</p>
          ${!data.guardianHasAccount
            ? `<p>You'll need to <a href="${baseUrl}/signup">create a Bloom account</a> first before you can respond.</p>`
            : ""}
          <p>If you don't know who sent this, you can safely ignore this email.</p>
          <br/>
          <p>- The Bloom Team</p>
        `,
      },
    });

    await logAudit({
      actorUid:   teenUid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CONSENT_REQUESTED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  newGuardianUid || newGuardianEmail,
      meta:       { changedFields: ["guardianEmail", "inviteToken"] },
    });

    return res.json({ ok: true, message: "Guardian email updated and new invite sent" });
  } catch (err) {
    console.error("PATCH /consent/update-guardian-email error:", err);
    return res.status(500).json({ error: "Failed to update guardian email" });
  }
});

// ─── POST /consent/resend/:consentId ────────────────────────────────────────
// Teen resends the guardian invite email (max 3 times per 24 hours)
router.post("/resend/:consentId", requireAuth, async (req, res) => {
  try {
    const teenUid = req.user.uid;
    const { consentId } = req.params;

    if (req.user.ageBand !== "10-17") {
      return res.status(403).json({ error: "Only teens can resend consent invites" });
    }

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Consent request not found" });
    }

    const data = snap.data();

    if (data.teenUid !== teenUid) {
      return res.status(403).json({ error: "Not authorized to resend this consent invite" });
    }

    if (data.status !== "pending" && data.status !== "expired") {
      return res.status(409).json({
        error: `Cannot resend invite for a consent with status: ${data.status}`,
      });
    }

    // ── Rate limit: max 3 resends per 24 hours ──
    const now = new Date();
    const resendLog = data.resendLog || [];

    // Filter to only resends in the last 24 hours
    const recentResends = resendLog.filter((timestamp) => {
      const t = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return now - t < 24 * 60 * 60 * 1000;
    });

    if (recentResends.length >= 3) {
      const oldest = recentResends[0].toDate
        ? recentResends[0].toDate()
        : new Date(recentResends[0]);
      const nextAvailableAt = new Date(oldest.getTime() + 24 * 60 * 60 * 1000);
      return res.status(429).json({
        error: "Maximum resends reached. You can resend again after 24 hours.",
        nextResendAvailableAt: nextAvailableAt.toISOString(),
      });
    }

    // ── Generate fresh token ──
    const { token, expiresAt } = generateInviteToken();
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    const approveLink = `${baseUrl}/api/consent/approve?token=${token}&consentId=${consentId}`;
    const denyLink    = `${baseUrl}/api/consent/deny?token=${token}&consentId=${consentId}`;
    const nowTimestamp = admin.firestore.FieldValue.serverTimestamp();

    await consentRef.update({
      inviteToken:          token,
      inviteTokenExpiresAt: expiresAt,
      inviteTokenUsed:      false,
      status:               "pending", // reset if it was expired
      statusUpdatedAt:      nowTimestamp,
      resendLog:            admin.firestore.FieldValue.arrayUnion(new Date()),
    });

    // ── Resend email ──
    await db.collection("mail").add({
      to: data.guardianEmail,
      message: {
        subject: "Reminder: A teen has requested your consent on Bloom",
        html: `
          <p>Hello,</p>
          <p>A teen has requested you to be their guardian on <strong>Bloom</strong>.</p>
          <p>Please respond to their request using one of the buttons below:</p>
          <p>
            <a href="${approveLink}" style="background:#27ae60;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:10px;">✅ Approve</a>
            <a href="${denyLink}" style="background:#c0003c;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">❌ Deny</a>
          </p>
          <p>These links expire in 48 hours.</p>
          ${!data.guardianHasAccount
            ? `<p>You'll need to <a href="${baseUrl}/signup">create a Bloom account</a> first before you can respond.</p>`
            : ""}
          <p>If you don't know who sent this, you can safely ignore this email.</p>
          <br/>
          <p>- The Bloom Team</p>
        `,
      },
    });

    await logAudit({
      actorUid:   teenUid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CONSENT_REQUESTED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  data.guardianUid || data.guardianEmail,
      meta:       { changedFields: ["inviteToken", "inviteTokenExpiresAt"], reasonCode: "resend" },
    });

    return res.json({
      ok: true,
      message: "Invite resent to guardian's email",
      resendsUsed: recentResends.length + 1,
      resendsRemaining: 3 - (recentResends.length + 1),
    });
  } catch (err) {
    console.error("POST /consent/resend error:", err);
    return res.status(500).json({ error: "Failed to resend consent invite" });
  }
});

// ─── GET /consent/approve ────────────────────────────────────────────────────
// Unauthenticated - guardian clicks approve link in email
// e.g. https://yourapp.com/consent/approve?token=abc&consentId=xyz
router.get("/approve", async (req, res) => {
  try {
    const { token, consentId } = req.query;
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    if (!token || !consentId) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    const data = snap.data();

    // Token mismatch
    if (data.inviteToken !== token) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    // Already used
    if (data.inviteTokenUsed) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=already-used`);
    }

    // Expired
    if (data.inviteTokenExpiresAt) {
      const expiresAt = data.inviteTokenExpiresAt.toDate
        ? data.inviteTokenExpiresAt.toDate()
        : new Date(data.inviteTokenExpiresAt);
      if (expiresAt < new Date()) {
        return res.redirect(`${baseUrl}/pages/consent-result.html?result=expired`);
      }
    }

    // Already resolved - idempotent
    if (data.status === "approved") {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=approved`);
    }

    if (data.status !== "pending") {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=already-resolved`);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const revokeToken = generateRevokeToken();
    const revokeLink = `${baseUrl}/api/consent/revoke-link?token=${revokeToken}&consentId=${consentId}`;

    await consentRef.update({
      status:               "approved",
      inviteTokenUsed:      true,
      statusUpdatedAt:      now,
      decidedAt:            now,
      scope: { sensitiveModules: true, pregnancyMode: false },
      revokeToken,
    });

    // Update relationship doc
    await db.collection("relationships").doc(consentId).set({
      status:      "active",
      activatedAt: now,
    }, { merge: true });

    // Send confirmation email to guardian with revoke link
    await db.collection("mail").add({
      to: data.guardianEmail,
      message: {
        subject: "You've approved Bloom access for a teen",
        html: `
          <p>Hello,</p>
          <p>You've approved access to <strong>Bloom</strong> for a teen in your care.</p>
          <p>If you ever want to revoke their access, just click the button below - no login required:</p>
          <p style="margin-top:1rem;">
            <a href="${revokeLink}" style="background:#c0003c;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">
              Revoke Access
            </a>
          </p>
          <p style="margin-top:1rem;font-size:0.9rem;color:#888;">
            Keep this email somewhere safe - this link is the easiest way to revoke access later.
          </p>
          <br/>
          <p>- The Bloom Team</p>
        `,
      },
    });

    await logAudit({
      actorUid:   data.guardianUid || "unauthenticated-guardian",
      actorRole:  "guardian",
      action:     AUDIT_ACTIONS.CONSENT_APPROVED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  data.teenUid,
      meta:       { changedFields: ["status", "decidedAt"], reasonCode: "email_link" },
    });

    return res.redirect(`${baseUrl}/pages/consent-result.html?result=approved`);
  } catch (err) {
    console.error("GET /consent/approve error:", err);
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    return res.redirect(`${baseUrl}/pages/consent-result.html?result=error`);
  }
});

// ─── GET /consent/deny ──────────────────────────────────────────────────────
// Unauthenticated - guardian clicks deny link in email
router.get("/deny", async (req, res) => {
  try {
    const { token, consentId } = req.query;
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";

    if (!token || !consentId) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    const data = snap.data();

    if (data.inviteToken !== token) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    if (data.inviteTokenUsed) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=already-used`);
    }

    if (data.inviteTokenExpiresAt) {
      const expiresAt = data.inviteTokenExpiresAt.toDate
        ? data.inviteTokenExpiresAt.toDate()
        : new Date(data.inviteTokenExpiresAt);
      if (expiresAt < new Date()) {
        return res.redirect(`${baseUrl}/pages/consent-result.html?result=expired`);
      }
    }

    // Already resolved - idempotent
    if (data.status === "denied") {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=denied`);
    }

    if (data.status !== "pending") {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=already-resolved`);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await consentRef.update({
      status:          "denied",
      inviteTokenUsed: true,
      statusUpdatedAt: now,
      decidedAt:       now,
    });

    await db.collection("relationships").doc(consentId).set({
      status:    "revoked",
      revokedAt: now,
    }, { merge: true });

    await logAudit({
      actorUid:   data.guardianUid || "unauthenticated-guardian",
      actorRole:  "guardian",
      action:     AUDIT_ACTIONS.CONSENT_DENIED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  data.teenUid,
      meta:       { changedFields: ["status", "decidedAt"], reasonCode: "email_link" },
    });

    return res.redirect(`${baseUrl}/pages/consent-result.html?result=denied`);
  } catch (err) {
    console.error("GET /consent/deny error:", err);
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    return res.redirect(`${baseUrl}/pages/consent-result.html?result=error`);
  }
});

// ─── PATCH /consent/respond/:consentId ──────────────────────────────────────
router.patch("/respond/:consentId", requireAuth, async (req, res) => {
  try {
    const guardianUid = req.user.uid;
    const { consentId } = req.params;

    const validation = validateConsentUpdate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Consent request not found" });
    }

    const data = snap.data();

    if (data.guardianUid !== guardianUid) {
      return res.status(403).json({ error: "You are not the guardian for this consent request" });
    }

    if (data.status !== "pending") {
      return res.status(409).json({
        error: `Cannot respond to a consent request with status: ${data.status}`,
      });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const newStatus = req.body.status; // "approved" or "denied"

    await consentRef.update({
      status: newStatus,
      statusUpdatedAt: now,
      decidedAt: now,
      ...(newStatus === "approved" && {
        scope: { sensitiveModules: true, pregnancyMode: false },
      }),
    });

    await db.collection("relationships").doc(consentId).set({
      status: newStatus === "approved" ? "active" : "revoked",
      activatedAt: newStatus === "approved" ? now : null,
      revokedAt:   newStatus === "denied"   ? now : null,
    }, { merge: true });

    await logAudit({
      actorUid:   guardianUid,
      actorRole:  req.user.role,
      action:     newStatus === "approved"
        ? AUDIT_ACTIONS.CONSENT_APPROVED
        : AUDIT_ACTIONS.CONSENT_DENIED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  data.teenUid,
      meta:       { changedFields: ["status", "decidedAt"] },
    });

    return res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("PATCH /consent/respond error:", err);
    return res.status(500).json({ error: "Failed to update consent" });
  }
});

// ─── GET /consent/pending ────────────────────────────────────────────────────
router.get("/pending", requireAuth, async (req, res) => {
  try {
    const guardianUid = req.user.uid;

    const snap = await db
      .collection("consents")
      .where("guardianUid", "==", guardianUid)
      .where("status", "==", "pending")
      .get();

    const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.json({ ok: true, requests });
  } catch (err) {
    console.error("GET /consent/pending error:", err);
    return res.status(500).json({ error: "Failed to fetch pending requests" });
  }
});

// ─── GET /consent/revoke-link ────────────────────────────────────────────────
// Unauthenticated - guardian clicks revoke link from their approval confirmation email
router.get("/revoke-link", async (req, res) => {
  try {
    const { token, consentId } = req.query;
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";

    if (!token || !consentId) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    const data = snap.data();

    if (data.revokeToken !== token) {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=invalid`);
    }

    if (data.status === "denied") {
      return res.redirect(`${baseUrl}/pages/consent-result.html?result=already-revoked`);
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await consentRef.update({
      status:          "denied",
      statusUpdatedAt: now,
      decidedAt:       now,
      revokeToken:     null, // invalidate so link can't be reused
    });

    await db.collection("relationships").doc(consentId).set({
      status:    "revoked",
      revokedAt: now,
    }, { merge: true });

    await logAudit({
      actorUid:   data.guardianUid || "unauthenticated-guardian",
      actorRole:  "guardian",
      action:     AUDIT_ACTIONS.CONSENT_REVOKED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  data.teenUid,
      meta:       { changedFields: ["status"], reasonCode: "revoke_link" },
    });

    return res.redirect(`${baseUrl}/pages/consent-result.html?result=revoked`);
  } catch (err) {
    console.error("GET /consent/revoke-link error:", err);
    const baseUrl = process.env.APP_BASE_URL || "https://yourapp.com";
    return res.redirect(`${baseUrl}/pages/consent-result.html?result=error`);
  }
});

// ─── DELETE /consent/revoke/:consentId ──────────────────────────────────────
router.delete("/revoke/:consentId", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { consentId } = req.params;

    const consentRef = db.collection("consents").doc(consentId);
    const snap = await consentRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Consent not found" });
    }

    const data = snap.data();

    if (data.teenUid !== uid && data.guardianUid !== uid) {
      return res.status(403).json({ error: "Not authorized to revoke this consent" });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await consentRef.update({ status: "denied", statusUpdatedAt: now });

    await db.collection("relationships").doc(consentId).set({
      status: "revoked",
      revokedAt: now,
    }, { merge: true });

    await logAudit({
      actorUid:   uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CONSENT_REVOKED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  uid === data.teenUid ? data.guardianUid : data.teenUid,
      meta:       { changedFields: ["status"] },
    });

    return res.json({ ok: true, message: "Consent revoked" });
  } catch (err) {
    console.error("DELETE /consent/revoke error:", err);
    return res.status(500).json({ error: "Failed to revoke consent" });
  }
});

export default router;