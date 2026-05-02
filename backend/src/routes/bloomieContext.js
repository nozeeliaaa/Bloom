// src/routes/bloomieContext.js
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { buildSafeBloomieContext } from "../utils/bloomie/context/buildSafeBloomieContext.js";

const router = express.Router();

/**
 * GET /api/bloomie-context
 *
 * Returns a clean, runtime-only context object for Bloomie.
 * Built fresh per request - never stored.
 *
 * Auth: required (user can only access their own context - uid from token).
 */
router.get("/", requireAuth, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  try {
    const context = await buildSafeBloomieContext(uid);
    return res.json(context);
  } catch (err) {
    // buildSafeBloomieContext never throws by design, but guard at the route boundary too.
    console.error(`[GET /api/bloomie-context] uid=${uid}`, err.message ?? err);
    return res.status(500).json({ error: "Failed to build context" });
  }
});

export default router;
