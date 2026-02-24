import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth, requireConsentApproved } from "../middleware/auth.js";

const router = express.Router();

// --- helpers ---
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

function isValidSeverity(n) {
  // Example: 0..5 scale
  return Number.isInteger(n) && n >= 0 && n <= 5;
}

function sanitizeText(s, max = 300) {
  if (typeof s !== "string") return "";
  return s.trim().slice(0, max);
}

// Collection path: symptomLogs/{uid}/entries/{dateKey}
// Document shape (example):
// {
//   dateKey,
//   items: [{ code: "cramps", severity: 3, note: "..." }, ...],
//   updatedAt, createdAt
// }

router.put("/:dateKey", requireAuth, requireConsentApproved(), async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];

    // Validate items
    const cleaned = items.map((it, idx) => {
      const code = typeof it.code === "string" ? it.code.trim() : "";
      const severity = Number(it.severity);

      if (!code) throw new Error(`items[${idx}].code is required`);
      if (!isValidSeverity(severity)) throw new Error(`items[${idx}].severity must be 0..5`);

      return {
        code,
        severity,
        note: sanitizeText(it.note, 200),
      };
    });

    // Optional: limit how many symptoms per day
    if (cleaned.length > 40) {
      return res.status(400).json({ error: "Too many symptom items for one day" });
    }

    const docRef = db.collection("symptomLogs").doc(uid).collection("entries").doc(dateKey);

    const payload = {
      dateKey,
      items: cleaned,
      updatedAt: new Date(),
    };

    const snap = await docRef.get();
    if (!snap.exists) payload.createdAt = new Date();

    await docRef.set(payload, { merge: true });

    return res.json({ ok: true, entry: payload });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Invalid request" });
  }
});

router.get("/:dateKey", requireAuth, requireConsentApproved(), async (req, res) => {
  const uid = req.user.uid;
  const { dateKey } = req.params;

  if (!isValidDateKey(dateKey)) {
    return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
  }

  const doc = await db.collection("symptomLogs").doc(uid).collection("entries").doc(dateKey).get();
  if (!doc.exists) return res.json(null);

  return res.json(doc.data());
});

router.get("/", requireAuth, requireConsentApproved(), async (req, res) => {
  const uid = req.user.uid;
  const start = req.query.start; // YYYY-MM-DD
  const end = req.query.end;     // YYYY-MM-DD

  if (start && !isValidDateKey(start)) return res.status(400).json({ error: "Invalid start" });
  if (end && !isValidDateKey(end)) return res.status(400).json({ error: "Invalid end" });

  let q = db.collection("symptomLogs").doc(uid).collection("entries").orderBy("dateKey", "desc").limit(60);

  if (start) q = q.where("dateKey", ">=", start);
  if (end) q = q.where("dateKey", "<=", end);

  const snap = await q.get();
  const items = snap.docs.map((d) => d.data());

  return res.json({ ok: true, items });
});

router.delete("/:dateKey", requireAuth, requireConsentApproved(), async (req, res) => {
  const uid = req.user.uid;
  const { dateKey } = req.params;

  if (!isValidDateKey(dateKey)) {
    return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
  }

  await db.collection("symptomLogs").doc(uid).collection("entries").doc(dateKey).delete();
  return res.json({ ok: true });
});

export default router;