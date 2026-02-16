import express from "express";
import { auth } from "../firebaseAdmin.js";

const router = express.Router();

/**
 * Verify Firebase ID token from frontend
 */
router.post("/verify", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    res.json({ uid: decoded.uid, email: decoded.email });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

export default router;
