// src/routes/cycleLogs.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateCycleLog } from "../validators/validateCycleLog.js";

const router = express.Router();

// --- helpers ---
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function toBool(val) {
  return val === true || val === "true";
}

async function ensureCycleLogsParent(uid) {
  const parentRef = db.collection("cycleLogs").doc(uid);
  const snap = await parentRef.get();
  if (!snap.exists) {
    await parentRef.set({ uid, createdAt: new Date(), updatedAt: new Date() });
  } else {
    await parentRef.set({ updatedAt: new Date() }, { merge: true });
  }
}

// Create/Update one day's cycle log
router.put("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    const validation = validateCycleLog(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const docRef = db
      .collection("cycleLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey);

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
      hadSex: toBool(req.body.hadSex),
      contraceptionUsed: toBool(req.body.contraceptionUsed),
      notes:
        typeof req.body.notes === "string"
          ? req.body.notes.trim().slice(0, 500)
          : "",
      updatedAt: new Date(),
    };

    const snap = await docRef.get();
    if (!snap.exists) payload.createdAt = new Date();

    await ensureCycleLogsParent(uid);
    await docRef.set(payload, { merge: true });

    return res.json({ ok: true, entry: payload });
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

    const doc = await db
      .collection("cycleLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey)
      .get();

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

    let q = db
      .collection("cycleLogs")
      .doc(uid)
      .collection("entries")
      .orderBy("dateKey", "desc");

    if (start) q = q.where("dateKey", ">=", start);
    if (end) q = q.where("dateKey", "<=", end);

    if (start || end) q = q.limit(3650);

    const snap = await q.get();
    const items = snap.docs.map((d) => d.data());

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
    const snap = await db
      .collection("cycleLogs")
      .doc(uid)
      .collection("entries")
      .get();

    if (snap.empty) return res.json({ ok: true, deleted: 0 });

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
    return res.json({ ok: true, deleted: docs.length });

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

    await db
      .collection("cycleLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey)
      .delete();

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