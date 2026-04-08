/**
 * src/routes/preferences.js
 *
 * GET  /preferences      - load user preferences from Firestore
 * PUT  /preferences      - save user preferences to Firestore
 */

import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";


const router = express.Router();

// Valid preference values for server-side validation
const VALID_THEMES = ["light", "dark", "system"];
const VALID_REMINDER_TYPES = ["PERIOD_SOON", "LOG_REMINDER", "CHECK_IN", "FERTILE_WINDOW"];

// ─── GET /preferences ────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const doc = await db.collection("preferences").doc(uid).get();

    if (!doc.exists) {
      return res.json({ ok: true, preferences: null }); // frontend uses defaults
    }

    return res.json({ ok: true, preferences: doc.data() });
  } catch (err) {
    console.error("GET /preferences error:", err);
    return res.status(500).json({ error: "Failed to load preferences" });
  }
});

// ─── PUT /preferences ────────────────────────────────────────────────────────
router.put("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const body = req.body;
    console.log(`[preferences] PUT from uid=${uid} body=`, JSON.stringify(body));

    if (body.pregnancyMode !== undefined && req.user.ageBand === "10-17") {
      // Run the consent check manually for this field only
      const consentSnap = await db.collection("consents")
        .where("teenUid", "==", req.user.uid)
        .where("status", "==", "approved")
        .limit(1)
        .get();

      if (consentSnap.empty || !consentSnap.docs[0].data().scope?.pregnancyMode) {
        return res.status(403).json({
          error: "Guardian consent is required to enable pregnancy mode.",
          code: "PREGNANCY_CONSENT_REQUIRED",
        });
      }
    }
    // Build a validated preferences object - never blindly store req.body
    const prefs = {};

    if (body.theme !== undefined) {
      if (!VALID_THEMES.includes(body.theme)) {
        return res.status(400).json({ error: `theme must be one of: ${VALID_THEMES.join(", ")}` });
      }
      prefs.theme = body.theme;
    }

    if (body.blurMode !== undefined)    prefs.blurMode    = body.blurMode    === true;
    if (body.discreetMode !== undefined) prefs.discreetMode = body.discreetMode === true;
    if (body.compact !== undefined)     prefs.compact     = body.compact     === true;
    if (body.hideSensitive !== undefined) prefs.hideSensitive = body.hideSensitive === true;

    if (body.reminders !== undefined) {
      const r = body.reminders;
      prefs.reminders = {
        enabled:      r.enabled      === true,
        discreetCopy: r.discreetCopy === true,
        types: Array.isArray(r.types)
          ? r.types.filter(t => VALID_REMINDER_TYPES.includes(t))
          : [],
      };

      if (r.quietHours?.start && r.quietHours?.end) {
        prefs.reminders.quietHours = {
          start: String(r.quietHours.start).slice(0, 5),
          end:   String(r.quietHours.end).slice(0, 5),
        };
      }
    }

    if (body.notifications !== undefined) {
      prefs.notifications = {
        optIn: body.notifications.optIn === true,
      };
    }

    prefs.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await db.collection("preferences").doc(uid).set(prefs, { merge: true });

    // Audit log
    await logAudit({
      actorUid:   uid,
      actorRole:  req.user.role,
      action:     AUDIT_ACTIONS.PREFERENCES_UPDATED,
      entityType: "preferences",
      entityId:   uid,
      meta: { changedFields: Object.keys(prefs).filter(k => k !== "updatedAt") },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("PUT /preferences error:", err);
    return res.status(500).json({ error: "Failed to save preferences" });
  }
});

export default router;