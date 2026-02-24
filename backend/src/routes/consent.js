import express from "express";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

/**
 * TEMP placeholder so server can boot.
 * We'll implement real invite/approve/deny workflow later.
 */
router.get("/status", requireAuth, (req, res) => {
  res.json({ ok: true, status: "pending" });
});

export default router;