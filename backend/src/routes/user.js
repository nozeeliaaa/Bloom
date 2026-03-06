// src/routes/user.js
import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateUserProfile } from "../validators/validateUser.js";

const router = express.Router();

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
      // Role: preserve existing role, never let client set it directly
      role: existingProfile?.role || "user",

      goal: req.body.goal ?? existingProfile?.goal ?? "track_cycle",
      mode: req.body.mode ?? existingProfile?.mode ?? "account",

      yearOfBirth:
        req.body.yearOfBirth === undefined
          ? existingProfile?.yearOfBirth ?? null
          : req.body.yearOfBirth === null
          ? null
          : Number(req.body.yearOfBirth),

      consentSensitive: req.body.consentSensitive ?? existingProfile?.consentSensitive ?? false,
      remindersEnabled: req.body.remindersEnabled ?? existingProfile?.remindersEnabled ?? false,
      reminderTime: req.body.reminderTime ?? existingProfile?.reminderTime ?? "09:00",
    };

    await userRef.set(
      {
        profile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existing?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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