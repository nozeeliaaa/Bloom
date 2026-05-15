// src/routes/symptomLogs.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateSymptomItem } from "../validators/validateSymptomLog.js";
import { ensureUserDocument, serverTimestamp, userSubDoc } from "../utils/userDataPaths.js";

const router = express.Router();

// --- helpers ---
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

async function ensureSymptomLogsParent(uid) {
  await ensureUserDocument(uid);
  const parentRef = db.collection("symptomLogs").doc(uid);
  const snap = await parentRef.get();
  if (!snap.exists) {
    await parentRef.set({ uid, createdAt: new Date(), updatedAt: new Date() });
  } else {
    await parentRef.set({ updatedAt: new Date() }, { merge: true });
  }
}

async function hasSensitiveConsent(uid) {
  const snap = await db
    .collection("consents")
    .where("teenUid", "==", uid)
    .where("status", "==", "approved")
    .limit(1)
    .get();

  if (snap.empty) return false;

  const consent = snap.docs[0].data();
  return !!consent.scope?.sensitiveModules;
}

function cleanOtherSymptom(item, dateKey) {
  const text = typeof item?.text === "string" ? item.text.trim().slice(0, 80) : "";
  if (!text) return null;

  const normalizedText =
    typeof item?.normalizedText === "string"
      ? item.normalizedText.trim().toLowerCase().slice(0, 80)
      : text.toLowerCase();
  const severity = Number(item?.severity ?? 3);
  const note = typeof item?.note === "string" ? item.note.trim().slice(0, 160) : "";
  const createdAt = typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString();

  return {
    text,
    normalizedText,
    severity: Number.isInteger(severity) && severity >= 0 && severity <= 5 ? severity : 3,
    note,
    createdAt,
    dateKey,
  };
}

function canonicalSymptomLogRef(uid, dateKey) {
  return userSubDoc(uid, "symptomLogs", dateKey);
}

function legacySymptomLogRef(uid, dateKey) {
  return db.collection("symptomLogs").doc(uid).collection("entries").doc(dateKey);
}

function mergeDocsByDateKey(...snaps) {
  const byDate = new Map();
  for (const snap of snaps) {
    if (!snap?.docs) continue;
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const dateKey = data.dateKey || doc.id;
      if (!dateKey) continue;
      byDate.set(dateKey, { dateKey, ...data });
    }
  }
  return [...byDate.values()].sort((a, b) => String(b.dateKey).localeCompare(String(a.dateKey)));
}

// Canonical path: users/{uid}/symptomLogs/{dateKey}
// Legacy mirror: symptomLogs/{uid}/entries/{dateKey}
// Each doc holds an items[] array - multiple catalog symptoms per day.

// Create/Update symptoms for a day
router.put("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (items.length > 40) {
      return res.status(400).json({ error: "Too many symptom items for one day (max 40)" });
    }

    const cleaned = [];
    const otherSymptoms = Array.isArray(req.body.otherSymptoms)
      ? req.body.otherSymptoms.map((item) => cleanOtherSymptom(item, dateKey)).filter(Boolean).slice(0, 20)
      : [];

    if (items.length === 0 && otherSymptoms.length === 0) {
      return res.status(400).json({ error: "items or otherSymptoms is required" });
    }

    const teenHasSensitiveConsent =
        req.user.ageBand === "10-17"
          ? await hasSensitiveConsent(uid)
          : true;


    for (let idx = 0; idx < items.length; idx++) {
      const result = await validateSymptomItem(items[idx], idx);

      if (!result.valid) {
        return res.status(400).json({ error: result.error });
      }
      
      const { normalized, catalogData } = result;

      if (catalogData.sensitive && !teenHasSensitiveConsent) {
        return res.status(403).json({
          error: `Symptom "${normalized.code}" requires guardian consent`,
          code: "CONSENT_REQUIRED",
        });
      }

      cleaned.push(normalized);
    }

    const docRef = canonicalSymptomLogRef(uid, dateKey);

    const payload = {
      dateKey,
      items: cleaned,
      otherSymptoms,
      updatedAt: serverTimestamp(),
    };

    const snap = await docRef.get();
    if (!snap.exists) payload.createdAt = serverTimestamp();

    await ensureSymptomLogsParent(uid);

    await docRef.set(payload, { merge: true });
    await legacySymptomLogRef(uid, dateKey).set(payload, { merge: true });

    const saved = await docRef.get();
    return res.json({ ok: true, entry: saved.data() });
  } catch (err) {
    console.error("PUT /api/symptom-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to save symptom log" });
  }
});

// Get one day's symptom log
router.get("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    let doc = await canonicalSymptomLogRef(uid, dateKey).get();
    if (!doc.exists) doc = await legacySymptomLogRef(uid, dateKey).get();

    if (!doc.exists) return res.json(null);
    return res.json(doc.data());
  } catch (err) {
    console.error("GET /api/symptom-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to fetch symptom log" });
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

    let q = db.collection("users").doc(uid).collection("symptomLogs").orderBy("dateKey", "desc");

    if (start) q = q.where("dateKey", ">=", start);
    if (end) q = q.where("dateKey", "<=", end);

    if (start || end) q = q.limit(3650);

    let legacy = db.collection("symptomLogs").doc(uid).collection("entries").orderBy("dateKey", "desc");
    if (start) legacy = legacy.where("dateKey", ">=", start);
    if (end) legacy = legacy.where("dateKey", "<=", end);
    if (start || end) legacy = legacy.limit(3650);

    const [legacySnap, canonicalSnap] = await Promise.all([legacy.get(), q.get()]);
    const items = mergeDocsByDateKey(legacySnap, canonicalSnap);

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("GET /api/symptom-logs error:", err);
    return res.status(500).json({ error: "Failed to fetch symptom logs" });
  }
});

// DELETE /api/symptom-logs - bulk delete all symptom logs for user
router.delete("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db.collection("users").doc(uid).collection("symptomLogs").get();

    const BATCH_SIZE = 500;
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      docs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    await db.collection("symptomLogs").doc(uid).set(
      { updatedAt: new Date() },
      { merge: true }
    );
    const legacySnap = await db.collection("symptomLogs").doc(uid).collection("entries").get();
    if (!legacySnap.empty) {
      const batch = db.batch();
      legacySnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    return res.json({ ok: true, deleted: docs.length + legacySnap.docs.length });
  } catch (err) {
    console.error("DELETE /api/symptom-logs error:", err);
    return res.status(500).json({ error: "Failed to delete all symptom logs" });
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

    await canonicalSymptomLogRef(uid, dateKey).delete();
    await legacySymptomLogRef(uid, dateKey).delete();

    await db.collection("symptomLogs").doc(uid).set(
      { updatedAt: new Date() },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/symptom-logs/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to delete symptom log" });
  }
});

export default router;
