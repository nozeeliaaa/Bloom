import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/* Create or update user profile */
router.post("/profile", requireAuth, async (req, res) => {
  const uid = req.user.uid;

  const userRef = db.collection("users").doc(uid);
  const snap = await userRef.get();
  const existing = snap.exists ? snap.data() : null;

  // ---- YOB validation + edit-once enforcement ----
  const incomingYob = req.body.yearOfBirth;

  const currentYear = new Date().getFullYear();

  if (incomingYob !== undefined && incomingYob !== null) {
    const yobNum = Number(incomingYob);

    if (!Number.isInteger(yobNum) || yobNum < 1900 || yobNum > currentYear) {
      return res.status(400).json({ error: "Invalid yearOfBirth" });
    }

    const existingYob = existing?.profile?.yearOfBirth;

    // If already set, block changes
    if (existingYob !== null && existingYob !== undefined && existingYob !== yobNum) {
      return res.status(409).json({ error: "yearOfBirth is locked and cannot be changed" });
    }
  }

  const profile = {
    goal: req.body.goal ?? "track_cycle", // "track_cycle" | "ttc"
    // If no incomingYob, keep existing; if incomingYob is valid, save it
    yearOfBirth:
      incomingYob === undefined
        ? existing?.profile?.yearOfBirth ?? null
        : incomingYob === null
        ? null
        : Number(incomingYob),
    consentSensitive: !!req.body.consentSensitive,
    remindersEnabled: !!req.body.remindersEnabled,
    reminderTime: req.body.reminderTime ?? "09:00",
    mode: req.body.mode ?? "account",
  };

  await userRef.set(
    {
      profile,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  res.json({ ok: true, profile });
});

/* Get user profile */
router.get("/profile", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const doc = await db.collection("users").doc(uid).get();

  if (!doc.exists) return res.json(null);

  res.json(doc.data());
});

export default router;