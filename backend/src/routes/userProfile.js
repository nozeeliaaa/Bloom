// src/routes/userProfile.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/user/profile — return sanitised nickname for the authenticated user
router.get("/", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.user.uid).collection("profile").doc("data").get();

    if (!doc.exists) return res.json({ nickname: null });

    const raw = doc.data()?.nickname;
    if (typeof raw !== "string") return res.json({ nickname: null });

    // Trim whitespace
    let nickname = raw.trim();

    // Truncate to 30 characters
    nickname = nickname.slice(0, 30);

    // Strip HTML / script tags
    nickname = nickname.replace(/<[^>]*>/g, "");

    // Trim again after tag removal
    nickname = nickname.trim();

    // If empty after sanitisation, return null
    if (!nickname) return res.json({ nickname: null });

    return res.json({ nickname });
  } catch {
    return res.json({ nickname: null });
  }
});

export default router;
