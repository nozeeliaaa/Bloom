// src/routes/bloomieContentMatch.js
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../firebaseAdmin.js";
import { matchContentTopic, matchAllContentTopics } from "../utils/bloomie/routing/matchContentTopic.js";

const router = express.Router();

/**
 * POST /api/bloomie-content-match
 *
 * Body: { inputText: string, limit?: number }
 *
 * Returns the best content match for the given user input, filtered against
 * content already shown or declined (read from bloomieMemory).
 *
 * Auth: required — uid used to fetch memory exclusions, never from body.
 */
router.post("/", requireAuth, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const inputText = typeof req.body?.inputText === "string"
    ? req.body.inputText.trim().slice(0, 500)
    : "";

  if (!inputText) {
    return res.status(400).json({ error: "inputText is required" });
  }

  // Read exclusions from bloomieMemory — single read, best-effort
  let shownIds    = [];
  let declinedIds = [];
  try {
    const memDoc = await db.collection("bloomieMemory").doc(uid).get();
    if (memDoc.exists) {
      const data = memDoc.data();
      shownIds    = Array.isArray(data?.contentSuggestionsShown) ? data.contentSuggestionsShown : [];
      declinedIds = Array.isArray(data?.declinedSuggestions)     ? data.declinedSuggestions     : [];
    }
  } catch (err) {
    // Non-fatal — proceed without exclusions rather than blocking the match
    console.error(`[POST /api/bloomie-content-match] memory read uid=${uid}`, err.message ?? err);
  }

  const limit = Number.isInteger(req.body?.limit) && req.body.limit > 0
    ? Math.min(req.body.limit, 10)
    : 1;

  const result = limit === 1
    ? matchContentTopic(inputText, shownIds, declinedIds)
    : matchAllContentTopics(inputText, shownIds, declinedIds, limit);

  if (!result || (Array.isArray(result) && result.length === 0)) {
    return res.json({ match: null });
  }

  return res.json({ match: result });
});

export default router;
