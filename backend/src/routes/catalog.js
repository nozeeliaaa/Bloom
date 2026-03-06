// src/routes/catalog.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// ─── GET /catalog/clinics ────────────────────────────────────────────────────
// Returns clinic directory, filterable by parish and type
router.get("/clinics", requireAuth, async (req, res) => {
  try {
    const { parish, type } = req.query;

    let q = db.collection("clinicDirectory").where("status", "==", "active");

    if (parish) q = q.where("parish", "==", parish);
    if (type) q = q.where("type", "==", type);

    const snap = await q.get();
    const clinics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return res.json({ ok: true, clinics });
  } catch (err) {
    console.error("GET /catalog/clinics error:", err);
    return res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

// ─── GET /catalog/symptoms ───────────────────────────────────────────────────
// Returns symptom catalog, filtered by teenSafe and sensitive flags
router.get("/symptoms", requireAuth, async (req, res) => {
  try {
    const { teenSafe, excludeSensitive } = req.query;

    let q = db.collection("symptomCatalog");

    // Filter for teen-safe symptoms if requested
    if (teenSafe === "true") {
      q = q.where("teenSafe", "==", true);
    }

    // Exclude sensitive symptoms if requested
    if (excludeSensitive === "true") {
      q = q.where("sensitive", "==", false);
    }

    const snap = await q.get();
    const symptoms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Sort by category then label client-side (avoids needing extra index)
    symptoms.sort((a, b) =>
      a.category.localeCompare(b.category) || a.label.localeCompare(b.label)
    );

    return res.json({ ok: true, symptoms });
  } catch (err) {
    console.error("GET /catalog/symptoms error:", err);
    return res.status(500).json({ error: "Failed to fetch symptoms" });
  }
});

export default router;