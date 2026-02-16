import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* Create or update user profile */
router.post("/profile", requireAuth, async (req, res) => {
  const uid = req.user.uid;

  const profile = {
    goal: req.body.goal ?? "track_cycle",          // "track_cycle" | "ttc"
    yearOfBirth: req.body.yearOfBirth ?? null,     // number | null
    consentSensitive: !!req.body.consentSensitive, // boolean
    remindersEnabled: !!req.body.remindersEnabled, // boolean
    reminderTime: req.body.reminderTime ?? "09:00",// "HH:MM"
    mode: req.body.mode ?? "account",              // "anon" | "account"
  };

  await db.collection("users").doc(uid).set(
    {
      profile,
      updatedAt: new Date(),
    },
    { merge: true }
  );

  res.json({ ok: true, profile });
});


/* Get user profile */
router.get("/profile", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const doc = await db.collection("users").doc(uid).get();

  if (!doc.exists) {
    return res.json(null);
  }

  res.json(doc.data());
});

export default router;
