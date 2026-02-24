import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * TEMP: Catalog endpoints (so server boots).
 * Later we’ll connect these to Firestore catalogClinics + catalogSymptoms.
 */

// If you want these public, remove requireAuth.
router.get("/clinics", requireAuth, (req, res) => {
  res.json({ ok: true, clinics: [] });
});

router.get("/symptoms", requireAuth, (req, res) => {
  res.json({ ok: true, symptoms: [] });
});

export default router;