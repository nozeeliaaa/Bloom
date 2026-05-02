// src/routes/cycleLogs.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateCycleLog } from "../validators/validateCycleLog.js";
import { ensureUserDocument, serverTimestamp, userSubDoc } from "../utils/userDataPaths.js";

const router = express.Router();

// --- helpers ---
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function toBool(val) {
  return val === true || val === "true";
}

const BIOMETRIC_LEVELS = ["low", "moderate", "high", "very_high"];

function normalizeBiometricLevel(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isInteger(value)) {
    return BIOMETRIC_LEVELS[value - 1] ?? null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return BIOMETRIC_LEVELS.includes(normalized) ? normalized : null;
}

function normalizeSleepScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return null;
  return parsed;
}

async function ensureCycleLogsParent(uid) {
  await ensureUserDocument(uid);
  const parentRef = db.collection("cycleLogs").doc(uid);
  const snap = await parentRef.get();
  if (!snap.exists) {
    await parentRef.set({ uid, createdAt: new Date(), updatedAt: new Date() });
  } else {
    await parentRef.set({ updatedAt: new Date() }, { merge: true });
  }
}
function canonicalCycleLogRef(uid, dateKey) {
  return userSubDoc(uid, "cycleLogs", dateKey);
}

function legacyCycleLogRef(uid, dateKey) {
  return db.collection("cycleLogs").doc(uid).collection("entries").doc(dateKey);
}

// Canonical path: users/{uid}/cycleLogs/{dateKey}
// Legacy mirror: cycleLogs/{uid}/entries/{dateKey}

// Create/Update one day's cycle log
router.put("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    // ---- Validate body ----
    const validation = validateCycleLog(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const docRef = canonicalCycleLogRef(uid, dateKey);

    const periodDay =
      req.body.periodDay === null || req.body.periodDay === undefined
        ? null
        : Number(req.body.periodDay);

    if (periodDay !== null && (!Number.isInteger(periodDay) || periodDay < 1 || periodDay > 10)) {
      return res.status(400).json({ error: "periodDay must be an integer between 1 and 10" });
    }

    const payload = {
      dateKey,
      periodDay,
      flowLevel: req.body.flowLevel ?? null,
      sleepScore: normalizeSleepScore(req.body.sleepScore),
      stressLevel: normalizeBiometricLevel(req.body.stressLevel),
      activityLevel: normalizeBiometricLevel(req.body.activityLevel),
      hadSex: toBool(req.body.hadSex),
      contraceptionUsed: toBool(req.body.contraceptionUsed),
      notes:
        typeof req.body.notes === "string"
          ? req.body.notes.trim().slice(0, 500)
          : "",
      updatedAt: serverTimestamp(),
    };

    const snap = await docRef.get();
    if (!snap.exists) payload.createdAt = serverTimestamp();

    await ensureCycleLogsParent(uid);
    await docRef.set(payload, { merge: true });
    await legacyCycleLogRef(uid, dateKey).set(payload, { merge: true });

    const userUpdate = {
      updatedAt: serverTimestamp(),
    };
    if (periodDay !== null && periodDay > 0) {
      userUpdate.lastPeriodStart = dateKey;
    }
    await db.collection("users").doc(uid).set(userUpdate, { merge: true });

    const saved = await docRef.get();
    return res.json({ ok: true, entry: saved.data() });
  } catch (err) {
    console.error("PUT /cycle-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to save cycle log" });
  }
});

// Get one day's cycle log
router.get("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    let doc = await canonicalCycleLogRef(uid, dateKey).get();
    if (!doc.exists) doc = await legacyCycleLogRef(uid, dateKey).get();

    if (!doc.exists) return res.json(null);
    return res.json(doc.data());
  } catch (err) {
    console.error("GET /cycle-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to fetch cycle log" });
  }
});

// List range
router.get("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { start, end } = req.query;

    if (start && !isValidDateKey(start)) {
      return res.status(400).json({ error: "Invalid start date. Use YYYY-MM-DD" });
    }
    if (end && !isValidDateKey(end)) {
      return res.status(400).json({ error: "Invalid end date. Use YYYY-MM-DD" });
    }

    let q = db.collection("users").doc(uid).collection("cycleLogs").orderBy("dateKey", "desc");

    if (start) q = q.where("dateKey", ">=", start);
    if (end) q = q.where("dateKey", "<=", end);

    // Only apply a cap when filtering by range - not on full history fetch
    if (start || end) q = q.limit(3650);

    let snap = await q.get();
    let items = snap.docs.map((d) => d.data());

    if (items.length === 0) {
      let legacy = db.collection("cycleLogs").doc(uid).collection("entries").orderBy("dateKey", "desc");
      if (start) legacy = legacy.where("dateKey", ">=", start);
      if (end) legacy = legacy.where("dateKey", "<=", end);
      if (start || end) legacy = legacy.limit(3650);
      snap = await legacy.get();
      items = snap.docs.map((d) => d.data());
    }

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("GET /cycle-logs error:", err);
    return res.status(500).json({ error: "Failed to fetch cycle logs" });
  }
});

// DELETE /api/logs - bulk delete all cycle logs for user
router.delete("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db.collection("users").doc(uid).collection("cycleLogs").get();

    // Firestore batch max 500 ops - chunk if needed
    const BATCH_SIZE = 500;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await db.collection("cycleLogs").doc(uid).set(
      { updatedAt: new Date() },
      { merge: true }
    );
    const legacySnap = await db.collection("cycleLogs").doc(uid).collection("entries").get();
    if (!legacySnap.empty) {
      const batch = db.batch();
      legacySnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    return res.json({ ok: true, deleted: docs.length + legacySnap.docs.length });

  } catch (err) {
    console.error("DELETE /api/logs error:", err);
    return res.status(500).json({ error: "Failed to delete all cycle logs" });
  }
});

// Delete one day
router.delete("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    await canonicalCycleLogRef(uid, dateKey).delete();
    await legacyCycleLogRef(uid, dateKey).delete();

    await db.collection("cycleLogs").doc(uid).set(
      { updatedAt: new Date() },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /cycle-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to delete cycle log" });
  }
});


export default router;
