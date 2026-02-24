import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// --- helpers ---
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function asNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function assertNonNegativeOrNull(n, fieldName) {
  if (n === null) return;
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
}

function assertBool(v, fieldName) {
  if (typeof v !== "boolean") throw new Error(`${fieldName} must be boolean`);
}

// Collection path: cycleLogs/{uid}/entries/{dateKey}

// Create/Update one day’s cycle log
router.put("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    // Example cycle fields (keep minimal; you can expand later)
    // You can adjust these based on your UI.
    const periodDay = asNumberOrNull(req.body.periodDay); // e.g., 1..N
    const flowLevel = asNumberOrNull(req.body.flowLevel); // 0..3 (example)
    const hadSex = req.body.hadSex; // boolean
    const contraceptionUsed = req.body.contraceptionUsed; // boolean
    const notes = typeof req.body.notes === "string" ? req.body.notes.trim().slice(0, 500) : "";

    assertNonNegativeOrNull(periodDay, "periodDay");
    assertNonNegativeOrNull(flowLevel, "flowLevel");
    if (hadSex !== undefined) assertBool(hadSex, "hadSex");
    if (contraceptionUsed !== undefined) assertBool(contraceptionUsed, "contraceptionUsed");

    const docRef = db.collection("cycleLogs").doc(uid).collection("entries").doc(dateKey);

    const payload = {
      dateKey,
      periodDay,
      flowLevel,
      hadSex: hadSex ?? false,
      contraceptionUsed: contraceptionUsed ?? false,
      notes,
      updatedAt: new Date(),
    };

    // If doc doesn’t exist, also set createdAt
    const snap = await docRef.get();
    if (!snap.exists) payload.createdAt = new Date();

    await docRef.set(payload, { merge: true });

    return res.json({ ok: true, entry: payload });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Invalid request" });
  }
});

// Get one day’s cycle log
router.get("/:dateKey", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { dateKey } = req.params;

  if (!isValidDateKey(dateKey)) {
    return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
  }

  const doc = await db.collection("cycleLogs").doc(uid).collection("entries").doc(dateKey).get();
  if (!doc.exists) return res.json(null);

  return res.json(doc.data());
});

// List range (simple)
router.get("/", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const start = req.query.start; // YYYY-MM-DD
  const end = req.query.end;     // YYYY-MM-DD

  if (start && !isValidDateKey(start)) return res.status(400).json({ error: "Invalid start" });
  if (end && !isValidDateKey(end)) return res.status(400).json({ error: "Invalid end" });

  let q = db.collection("cycleLogs").doc(uid).collection("entries").orderBy("dateKey", "desc").limit(60);

  // Range filter (optional)
  if (start) q = q.where("dateKey", ">=", start);
  if (end) q = q.where("dateKey", "<=", end);

  const snap = await q.get();
  const items = snap.docs.map((d) => d.data());

  return res.json({ ok: true, items });
});

// Delete one day
router.delete("/:dateKey", requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const { dateKey } = req.params;

  if (!isValidDateKey(dateKey)) {
    return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
  }

  await db.collection("cycleLogs").doc(uid).collection("entries").doc(dateKey).delete();
  return res.json({ ok: true });
});

export default router;