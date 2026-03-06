// src/routes/consent.js
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateConsentRequest, validateConsentUpdate } from "../validators/validateConsent.js";

const router = express.Router();

// ─── GET /consent/status ─────────────────────────────────────────────────────
// Teen checks their own consent status
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
// Teen requests guardian consent by providing guardian's email
router.post("/request", requireAuth, async (req, res) => {
  try {
    const teenUid = req.user.uid;

    // Only teens should be requesting consent
    if (req.user.ageBand !== "13-17") {
      return res.status(403).json({ error: "Only teens can request guardian consent" });
    }

    // Validate body
    const validation = validateConsentRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const guardianEmail = validation.guardianEmail;

    // Look up guardian by email in Firebase Auth
    let guardianRecord;
    try {
      guardianRecord = await auth.getUserByEmail(guardianEmail);
    } catch {
      return res.status(404).json({
        error: "No account found with that email. The guardian must have a Bloom account.",
      });
    }

    const guardianUid = guardianRecord.uid;

    // Prevent self-linking
    if (guardianUid === teenUid) {
      return res.status(400).json({ error: "You cannot link yourself as a guardian" });
    }

    const consentId = `${teenUid}_${guardianUid}`;
    const consentRef = db.collection("consents").doc(consentId);
    const existing = await consentRef.get();

    // Don't create duplicate if already pending or approved
    if (existing.exists) {
      const status = existing.data().status;
      if (status === "pending" || status === "approved") {
        return res.status(409).json({
          error: `A consent request already exists with status: ${status}`,
        });
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Create consent doc
    await consentRef.set({
      teenUid,
      guardianUid,
      status: "pending",
      scope: {
        sensitiveModules: false,
        pregnancyMode: false,
      },
      requestedAt: now,
      statusUpdatedAt: now,
      decidedAt: null,
    });

    // Create / update relationship doc
    const relationshipRef = db.collection("relationships").doc(consentId);
    await relationshipRef.set({
      teenUid,
      guardianUid,
      status: "invited",
      invitedAt: now,
    }, { merge: true });

    return res.json({ ok: true, message: "Consent request sent to guardian" });
  } catch (err) {
    console.error("POST /consent/request error:", err);
    return res.status(500).json({ error: "Failed to send consent request" });
  }
});

// ─── PATCH /consent/respond/:consentId ──────────────────────────────────────
// Guardian approves or denies a consent request
router.patch("/respond/:consentId", requireAuth, async (req, res) => {
  try {
    const guardianUid = req.user.uid;
    const { consentId } = req.params;

    // Validate body
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

    // Only the linked guardian can respond
    if (data.guardianUid !== guardianUid) {
      return res.status(403).json({ error: "You are not the guardian for this consent request" });
    }

    // Can only respond to pending requests
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
      // If approved, grant scope
      ...(newStatus === "approved" && {
        scope: {
          sensitiveModules: true,
          pregnancyMode: false, // pregnancy mode requires separate opt-in
        },
      }),
    });

    // Update relationship status too
    const relationshipRef = db.collection("relationships").doc(consentId);
    await relationshipRef.set({
      status: newStatus === "approved" ? "active" : "revoked",
      activatedAt: newStatus === "approved" ? now : null,
      revokedAt: newStatus === "denied" ? now : null,
    }, { merge: true });

    return res.json({ ok: true, status: newStatus });
  } catch (err) {
    console.error("PATCH /consent/respond error:", err);
    return res.status(500).json({ error: "Failed to update consent" });
  }
});

// ─── GET /consent/pending ────────────────────────────────────────────────────
// Guardian sees all pending consent requests for them
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
// Teen or guardian can revoke an active consent
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

    // Only the teen or guardian involved can revoke
    if (data.teenUid !== uid && data.guardianUid !== uid) {
      return res.status(403).json({ error: "Not authorized to revoke this consent" });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    await consentRef.update({
      status: "denied",
      statusUpdatedAt: now,
    });

    await db.collection("relationships").doc(consentId).set({
      status: "revoked",
      revokedAt: now,
    }, { merge: true });

    return res.json({ ok: true, message: "Consent revoked" });
  } catch (err) {
    console.error("DELETE /consent/revoke error:", err);
    return res.status(500).json({ error: "Failed to revoke consent" });
  }
});

export default router;