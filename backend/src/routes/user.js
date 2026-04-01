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
    const existingProfile = existing?.profile || null;

    // ---- Validate incoming body ----
    const validation = validateUserProfile(req.body, existingProfile);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    // ---- Build profile object ----
    const profile = {
      role: existingProfile?.role || "user",
      goal: req.body.goal ?? (existingProfile?.goal === "track_cycle" ? "period" : existingProfile?.goal) ?? "period",
      mode: req.body.mode ?? existingProfile?.mode ?? "account",
      yearOfBirth:
        req.body.yearOfBirth === undefined
        ? existingProfile?.yearOfBirth ?? null
        : existingProfile?.yearOfBirth  
        ? existingProfile.yearOfBirth
        : Number(req.body.yearOfBirth),
      consentSensitive: req.body.consentSensitive ?? existingProfile?.consentSensitive ?? false,
      remindersEnabled: req.body.remindersEnabled ?? existingProfile?.remindersEnabled ?? false,
      reminderTime: req.body.reminderTime ?? existingProfile?.reminderTime ?? "09:00",

      avgCycleLength: req.body.avgCycleLength !== undefined
        ? (req.body.avgCycleLength === null ? null : Number(req.body.avgCycleLength))
        : existingProfile?.avgCycleLength ?? null,
      periodDuration: req.body.periodDuration !== undefined
        ? (req.body.periodDuration === null ? null : Number(req.body.periodDuration))
        : existingProfile?.periodDuration ?? null,
      weightKg: req.body.weightKg !== undefined
        ? (req.body.weightKg === null ? null : Number(req.body.weightKg))
        : existingProfile?.weightKg ?? null,
      heightCm: req.body.heightCm !== undefined
        ? (req.body.heightCm === null ? null : Number(req.body.heightCm))
        : existingProfile?.heightCm ?? null,
    };

    await userRef.set(
      {
        profile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existing?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // ── Audit: track which fields changed ──
    const changedFields = Object.keys(req.body).filter(
      (k) => k !== "role" // role changes go through admin route only
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

    return res.json({ ok: true, profile });
  } catch (err) {
    console.error("POST /profile error:", err);
    return res.status(500).json({ error: "Failed to save profile" });
  }
});

/* Get user profile */
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const doc = await db.collection("users").doc(uid).get();
    if (!doc.exists) return res.json(null);
    return res.json(doc.data());
  } catch (err) {
    console.error("GET /profile error:", err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;