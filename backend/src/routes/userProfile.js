// src/routes/userProfile.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// GET /api/user/profile - return sanitised nickname for the authenticated user.
// Ownership is enforced: uid comes exclusively from the verified token set by
// requireAuth. No request parameter can redirect this to another user's data.
router.get("/", requireAuth, async (req, res) => {
  // Explicit ownership guard - belt-and-suspenders after requireAuth.
  // Guards against middleware ordering changes or future refactors.
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ nickname: null });
  if (req.user?.firestoreDegraded) return res.json({ nickname: null, degraded: true });

  try {
    // Schema: users/{uid} stores a nested `profile` object - NOT a subcollection.
    // { profile: { nickname, role, goal, yearOfBirth, ... }, createdAt, updatedAt }
    const doc = await db.collection("users").doc(uid).get();

    if (!doc.exists) return res.json({ nickname: null });

    const raw = doc.data()?.profile?.nickname;
    if (typeof raw !== "string") return res.json({ nickname: null });

    // Trim whitespace
    let nickname = raw.trim();

    // Remove script/style blocks including their content before tag stripping,
    // so payloads like <script>alert(1)</script> don't leave residue.
    nickname = nickname.replace(/<script\b[^>]*>.*?<\/script>/gis, "");
    nickname = nickname.replace(/<style\b[^>]*>.*?<\/style>/gis, "");

    // Strip all remaining HTML tags (must happen before truncation so long
    // tag attributes like onerror="..." are not split by the length cap).
    nickname = nickname.replace(/<[^>]*>/g, "");

    // Truncate to 30 characters (after sanitization, not before)
    nickname = nickname.slice(0, 30);

    // Trim again after tag removal
    nickname = nickname.trim();

    // If empty after sanitisation, return null
    if (!nickname) return res.json({ nickname: null });

    return res.json({ nickname });
  } catch (err) {
    // Log server-side for observability - never send error details to the client.
    console.error(`[GET /api/user/profile] uid=${uid}`, err.message ?? err);
    return res.json({ nickname: null });
  }
});

export default router;
