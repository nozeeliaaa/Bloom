// src/routes/consent.js
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateConsentRequest, validateConsentUpdate } from "../validators/validateConsent.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";

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

    if (req.user.ageBand !== "13-17") {
      return res.status(403).json({ error: "Only teens can request guardian consent" });
    }

    const validation = validateConsentRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const guardianEmail = validation.guardianEmail;

    let guardianRecord;
    try {
      guardianRecord = await auth.getUserByEmail(guardianEmail);
    } catch {
      return res.status(404).json({
        error: "No account found with that email. The guardian must have a Bloom account.",
      });
    }

    const guardianUid = guardianRecord.uid;

    if (guardianUid === teenUid) {
      return res.status(400).json({ error: "You cannot link yourself as a guardian" });
    }

    const consentId = `${teenUid}_${guardianUid}`;
    const consentRef = db.collection("consents").doc(consentId);
    const existing = await consentRef.get();

    if (existing.exists) {
      const status = existing.data().status;
      if (status === "pending" || status === "approved") {
        return res.status(409).json({
          error: `A consent request already exists with status: ${status}`,
        });
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await consentRef.set({
      teenUid,
      guardianUid,
      status: "pending",
      scope: { sensitiveModules: false, pregnancyMode: false },
      requestedAt: now,
      statusUpdatedAt: now,
      decidedAt: null,
    });

    await db.collection("relationships").doc(consentId).set({
      teenUid,
      guardianUid,
      status: "invited",
      invitedAt: now,
    }, { merge: true });

    await logAudit({
      actorUid:   teenUid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.CONSENT_REQUESTED,
      entityType: "consent",
      entityId:   consentId,
      targetUid:  guardianUid,
      meta:       { changedFields: ["status", "scope"] },
    });

    return res.json({ ok: true, message: "Consent request sent to guardian" });
  } catch (err) {
    console.error("POST /consent/request error:", err);
    return res.status(500).json({ error: "Failed to send consent request" });
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