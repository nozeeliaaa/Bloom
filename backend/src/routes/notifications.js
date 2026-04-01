/**
 * backend/src/routes/notifications.js
 *
 * POST   /notifications/token  — save FCM token for the current user
 * DELETE /notifications/token  — remove FCM token for the current user
 */

import express from "express";
import { db }  from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import admin from "firebase-admin";

const router = express.Router();

// ── POST /notifications/token ─────────────────────────────────────────────────
router.post("/token", requireAuth, async (req, res) => {
  const { token } = req.body || {};

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "FCM token is required" });
  }

  try {
    const uid = req.user.uid;

    await db.collection("users").doc(uid).set(
      {
        fcmTokens: admin.firestore.FieldValue.arrayUnion(token),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await logAudit({
      actorUid:   uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.PREFERENCES_UPDATED,
      entityType: "fcmToken",
      entityId:   uid,
      targetUid:  uid,
      meta:       { changedFields: ["fcmTokens"] },
    });

    return res.status(200).json({ message: "FCM token saved." });
  } catch (err) {
    console.error("POST /notifications/token error:", err);
    return res.status(500).json({ error: "Failed to save FCM token." });
  }
});

// ── DELETE /notifications/token ───────────────────────────────────────────────
router.delete("/token", requireAuth, async (req, res) => {
  const { token } = req.body || {};

  try {
    const uid     = req.user.uid;
    const userRef = db.collection("users").doc(uid);

    if (token) {
      // Remove a specific token
      await userRef.set(
        { fcmTokens: admin.firestore.FieldValue.arrayRemove(token) },
        { merge: true }
      );
    } else {
      // Remove all tokens (e.g. user turned off all notifications)
      await userRef.set(
        { fcmTokens: [] },
        { merge: true }
      );
    }

    await logAudit({
      actorUid:   uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.PREFERENCES_UPDATED,
      entityType: "fcmToken",
      entityId:   uid,
      targetUid:  uid,
      meta:       { changedFields: ["fcmTokens"] },
    });

    return res.status(200).json({ message: "FCM token removed." });
  } catch (err) {
    console.error("DELETE /notifications/token error:", err);
    return res.status(500).json({ error: "Failed to remove FCM token." });
  }
});

export default router;