import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function isValidScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 5;
}

function isValidDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function toScore(val) {
  if (val === null || val === undefined) return val;
  const n = Number(val);
  return Number.isInteger(n) ? n : val; // let validator catch non-integers
}

// PUT /api/biometric-logs/:dateKey
router.put("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;
    const raw = req.body || {};

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey format. Use YYYY-MM-DD." });
    }

    const update = {};

    if (raw.sleepScore !== undefined) {
      const val = toScore(raw.sleepScore);
      if (val !== null && !isValidScore(val)) {
        return res.status(400).json({ error: "sleepScore must be an integer from 0 to 5 or null." });
      }
      update.sleepScore = val;
    }

    if (raw.stressLevel !== undefined) {
      const val = toScore(raw.stressLevel);
      if (val !== null && !isValidScore(val)) {
        return res.status(400).json({ error: "stressLevel must be an integer from 0 to 5 or null." });
      }
      update.stressLevel = val;
    }

    if (raw.activityLevel !== undefined) {
      const val = toScore(raw.activityLevel);
      if (val !== null && !isValidScore(val)) {
        return res.status(400).json({ error: "activityLevel must be an integer from 0 to 5 or null." });
      }
      update.activityLevel = val;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "No biometric fields provided." });
    }

    const entryRef = db
      .collection("biometricLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey);

    const existingEntrySnap = await entryRef.get();
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const existingUser = userSnap.exists ? userSnap.data() || {} : {};
    const existingBiometricProfile = existingUser.biometricProfile || {};

    await entryRef.set(
      {
        uid,
        dateKey,
        ...update,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existingEntrySnap.exists
          ? existingEntrySnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp()
          : admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await userRef.set(
      {
        biometricProfile: {
          sleepScore:
            update.sleepScore !== undefined
              ? update.sleepScore
              : existingBiometricProfile.sleepScore ?? null,
          stressLevel:
            update.stressLevel !== undefined
              ? update.stressLevel
              : existingBiometricProfile.stressLevel ?? null,
          activityLevel:
            update.activityLevel !== undefined
              ? update.activityLevel
              : existingBiometricProfile.activityLevel ?? null,
        },
        "healthProfile.sleepScore": admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const savedSnap = await entryRef.get();
    return res.json({ ok: true, biometricLog: { id: savedSnap.id, ...savedSnap.data() } });
  } catch (err) {
    console.error("PUT /biometric-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to save biometric log" });
  }
});

// GET /api/biometric-logs/:dateKey
router.get("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey format. Use YYYY-MM-DD." });
    }

    const snap = await db
      .collection("biometricLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey)
      .get();

    if (!snap.exists) {
      return res.json({ ok: true, biometricLog: null });
    }

    return res.json({ ok: true, biometricLog: { id: snap.id, ...snap.data() } });
  } catch (err) {
    console.error("GET /biometric-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to fetch biometric log" });
  }
});

// GET /api/biometric-logs
router.get("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snap = await db
      .collection("biometricLogs")
      .doc(uid)
      .collection("entries")
      .orderBy("dateKey", "desc")
      .get();

    const biometricLogs = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ ok: true, biometricLogs });
  } catch (err) {
    console.error("GET /biometric-logs error:", err);
    return res.status(500).json({ error: "Failed to fetch biometric logs" });
  }
});

// DELETE /api/biometric-logs/:dateKey
router.delete("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey format. Use YYYY-MM-DD." });
    }

    await db
      .collection("biometricLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey)
      .delete();

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /biometric-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to delete biometric log" });
  }
});

export default router;