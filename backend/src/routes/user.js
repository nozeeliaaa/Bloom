// src/routes/user.js
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateUserProfile } from "../validators/validateUser.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";

const router = express.Router();

function computeAgeBand(yob) {
  const age = new Date().getFullYear() - yob;
  if (age >= 10 && age <= 17) return "10-17";
  if (age >= 18) return "18+";
  return null;
}


/* Create or update user profile */
router.post("/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    const existing = snap.exists ? snap.data() : null;
    const existingProfile = existing?.profile || {};

    // ---- Validate incoming body ----
    const validation = validateUserProfile(req.body, existingProfile);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // ---- Build profile object ----
    let yearOfBirth = existingProfile?.yearOfBirth ?? null;

    if (req.body.yearOfBirth !== undefined && !existingProfile?.yearOfBirth) {
      yearOfBirth = Number(req.body.yearOfBirth);
    }

    const profile = {
      nickname:
        req.body.nickname !== undefined
          ? (typeof req.body.nickname === "string"
            ? req.body.nickname.trim().slice(0, 40)
            : null)
          : existingProfile?.nickname ?? null,

      yearOfBirth,

      goal:
        req.body.goal !== undefined
          ? req.body.goal
          : existingProfile?.goal ?? null,

      mode:
        req.body.mode !== undefined
          ? req.body.mode
          : existingProfile?.mode ?? "account",

      consentSensitive:
        req.body.consentSensitive !== undefined
          ? req.body.consentSensitive
          : existingProfile?.consentSensitive ?? false,

      remindersEnabled:
        req.body.remindersEnabled !== undefined
          ? req.body.remindersEnabled
          : existingProfile?.remindersEnabled ?? false,

      reminderTime:
        req.body.reminderTime !== undefined
          ? req.body.reminderTime
          : existingProfile?.reminderTime ?? "09:00",
    };

    const existingHealthProfile = existing?.healthProfile || {};

    const healthProfile = {
      avgCycleLength:
        req.body.avgCycleLength !== undefined
          ? (req.body.avgCycleLength === null ? null : Number(req.body.avgCycleLength))
          : existingHealthProfile.avgCycleLength ?? null,

      periodDuration:
        req.body.periodDuration !== undefined
          ? (req.body.periodDuration === null ? null : Number(req.body.periodDuration))
          : existingHealthProfile.periodDuration ?? null,

      weightKg:
        req.body.weightKg !== undefined
          ? (req.body.weightKg === null ? null : Number(req.body.weightKg))
          : existingHealthProfile.weightKg ?? null,

      heightCm:
        req.body.heightCm !== undefined
          ? (req.body.heightCm === null ? null : Number(req.body.heightCm))
          : existingHealthProfile.heightCm ?? null,
    };

    await userRef.set(
      {
        profile,
        healthProfile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existing?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // ── Audit: track which fields changed ──
    const allowedChangedFields = [
      "nickname",
      "yearOfBirth",
      "goal",
      "mode",
      "consentSensitive",
      "remindersEnabled",
      "reminderTime",
    ];

    const changedFields = Object.keys(req.body).filter((k) =>
      allowedChangedFields.includes(k)
    );

    // Special case: YOB being set for the first time is a locked action
    const yobJustSet =
      req.body.yearOfBirth !== undefined && !existingProfile?.yearOfBirth;

    if (yobJustSet) {
      const ageBand = computeAgeBand(Number(req.body.yearOfBirth));

      // Store ageBand in Firestore
      await userRef.set({ profile: { ageBand } }, { merge: true });

      // Set as Firebase custom claim so middleware can read req.user.ageBand
      const existingClaims = req.user || {};
      await auth.setCustomUserClaims(uid, {
        role:    existingClaims.role    || "user",
        ageBand: ageBand,
      });

      await logAudit({
        actorUid:   uid,
        actorRole:  req.user.role,
        action:     AUDIT_ACTIONS.YOB_SET,
        entityType: "user",
        entityId:   uid,
        meta:       { changedFields: ["yearOfBirth", "ageBand"] },
      });
    } else if (changedFields.length) {
      await logAudit({
        actorUid:   uid,
        actorRole:  req.user.role,
        action:     AUDIT_ACTIONS.PROFILE_UPDATED,
        entityType: "user",
        entityId:   uid,
        meta:       { changedFields },
       });
      }

    const savedDoc = await userRef.get();
    return res.json({
      ok: true,
      profile: savedDoc.data()?.profile ?? null,
     });
  } catch (err) {
    console.error("POST /profile error:", err);
    return res.status(500).json({ error: "Failed to save profile" });
  }
});

/* Get user profile */
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userRef = db.collection("users").doc(uid);
    const doc = await userRef.get();

    if (!doc.exists) {
      const defaultUser = {
        profile: {
          nickname: null,
          yearOfBirth: null,
          goal: null,
          mode: "account",
          consentSensitive: false,
          remindersEnabled: false,
          reminderTime: "09:00",
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.set(defaultUser, { merge: true });
      const newDoc = await userRef.get();
      return res.json(newDoc.data());
    }

    return res.json(doc.data());
  } catch (err) {
    console.error("GET /profile error:", err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;