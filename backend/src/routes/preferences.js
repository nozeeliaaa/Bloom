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

const VALID_THEMES = ["light", "dark", "system"];
const VALID_REMINDER_TYPES = ["PERIOD_SOON", "LOG_REMINDER", "CHECK_IN", "FERTILE_WINDOW"];

function isValidTime(str) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
}

// ─── GET /preferences ────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const doc = await db.collection("preferences").doc(uid).get();

    if (!doc.exists) {
      return res.json({ ok: true, preferences: null });
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

    // Guard against malformed body
    if (typeof body !== "object" || body === null) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    if (body.pregnancyMode !== undefined && req.user.ageBand === "10-17") {
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

    const prefs = {};

    if (body.theme !== undefined) {
      if (!VALID_THEMES.includes(body.theme)) {
        return res.status(400).json({ error: `theme must be one of: ${VALID_THEMES.join(", ")}` });
      }
      prefs.theme = body.theme;
    }

    if (body.blurMode      !== undefined) prefs.blurMode      = body.blurMode      === true;
    if (body.discreetMode  !== undefined) prefs.discreetMode  = body.discreetMode  === true;
    if (body.compact       !== undefined) prefs.compact       = body.compact       === true;
    if (body.hideSensitive !== undefined) prefs.hideSensitive = body.hideSensitive === true;

    if (body.reminders !== undefined) {
      const r = body.reminders;
      prefs.reminders = {
        enabled:      r.enabled      === true,
        discreetCopy: r.discreetCopy === true,
      };

      if (Array.isArray(r.types)) {
        const invalidTypes = r.types.filter(t => !VALID_REMINDER_TYPES.includes(t));
        if (invalidTypes.length) {
          return res.status(400).json({
            error: `Invalid reminder types: ${invalidTypes.join(", ")}`,
          });
        }
        prefs.reminders.types = r.types;
      } else {
        prefs.reminders.types = [];
      }

      if (r.quietHours !== undefined) {
        const { start, end } = r.quietHours || {};

        if (!start || !end) {
          return res.status(400).json({
            error: "quietHours requires both start and end in HH:mm format",
          });
        }

        if (!isValidTime(start) || !isValidTime(end)) {
          return res.status(400).json({
            error: "Invalid quietHours format. Use HH:mm (e.g. 09:00)",
          });
        }

        prefs.reminders.quietHours = {
          start,
          end,
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