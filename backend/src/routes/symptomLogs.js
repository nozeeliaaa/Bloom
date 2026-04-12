// src/routes/symptomLogs.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateSymptomItem } from "../validators/validateSymptomLog.js";

const router = express.Router();

// --- helpers ---
function isValidDateKey(dateKey) {
  return typeof dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateKey);
}

async function ensureSymptomLogsParent(uid) {
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

async function ensureSymptomLogsParent(uid) {
  const parentRef = db.collection("symptomLogs").doc(uid);
  const snap = await parentRef.get();
  if (!snap.exists) {
    await parentRef.set({ uid, createdAt: new Date(), updatedAt: new Date() });
  } else {
    await parentRef.set({ updatedAt: new Date() }, { merge: true });
  }
}

// Collection path: symptomLogs/{uid}/entries/{dateKey}
// Each doc holds an items[] array - multiple symptoms per day

// Create/Update symptoms for a day
router.put("/:dateKey", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { dateKey } = req.params;

    if (!isValidDateKey(dateKey)) {
      return res.status(400).json({ error: "Invalid dateKey. Use YYYY-MM-DD" });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (items.length === 0) {
      return res.status(400).json({ error: "items array is required and cannot be empty" });
    }

    if (items.length > 40) {
      return res.status(400).json({ error: "Too many symptom items for one day (max 40)" });
    }

    const cleaned = [];

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

    const docRef = db
      .collection("symptomLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey);

    const payload = {
      dateKey,
      items: cleaned,
      updatedAt: new Date(),
    };

    const snap = await docRef.get();
    if (!snap.exists) payload.createdAt = new Date();

    await ensureSymptomLogsParent(uid);

    await docRef.set(payload, { merge: true });

    return res.json({ ok: true, entry: payload });
  } catch (err) {
    console.error("PUT /api/symptoms/:dateKey error:", err);
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

    const doc = await db
      .collection("symptomLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey)
      .get();

    if (!doc.exists) return res.json(null);
    return res.json(doc.data());
  } catch (err) {
    console.error("GET /api/symptoms/:dateKey error:", err);
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

    let q = db
      .collection("symptomLogs")
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
    console.error("GET /api/symptoms error:", err);
    return res.status(500).json({ error: "Failed to fetch symptom logs" });
  }
});

// DELETE /api/symptoms - bulk delete all symptom logs for user
router.delete("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await db
      .collection("symptomLogs")
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
    await db.collection("symptomLogs").doc(uid).set(
      { updatedAt: new Date() },
      { merge: true }
    );
    return res.json({ ok: true, deleted: docs.length });
  } catch (err) {
    console.error("DELETE /api/symptoms error:", err);
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

    await db
      .collection("symptomLogs")
      .doc(uid)
      .collection("entries")
      .doc(dateKey)
      .delete();

    await db.collection("symptomLogs").doc(uid).set(
      { updatedAt: new Date() },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/symptoms/:dateKey error:", err);
    return res.status(500).json({ error: "Failed to delete symptom log" });
  }
});

export default router;