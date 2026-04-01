// src/routes/bloomieMemory.js
import express from "express";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { requireConsent } from "../middleware/requireConsent.js";

const router = express.Router();

// All known entity symptom keys — used to whitelist incoming data
const VALID_SYMPTOM_KEYS = new Set([
  "late","heavy","spotting","pelvic","mood","discharge","nausea","dizziness",
  "large_clots","ovulation_pain","headache","joint_pain","breast_tender",
  "bloating","gassy","heartburn","constipation","diarrhea",
  "discharge_eggwhite","discharge_creamy","discharge_sticky","unusual_discharge",
  "acne","dry_skin","hair_thinning","hot_flashes","night_sweats","cold_flashes",
  "bbt_shift","brain_fog","forgetful","poor_concentration","anxiety","depression",
  "crying_spells","irritability","insomnia","craving_sweet","craving_salty",
  "craving_greasy","craving_spicy","appetite_increase","appetite_decrease",
  "libido_high","libido_low","cervical_mucus","vaginal_dryness","pain_during_sex",
  "irregular","fluid_retention","frequent_urination","weight_change",
  "smell_sensitivity","nasal_congestion",
]);

const VALID_SEVERITIES = new Set(["mild", "moderate", "severe"]);

// GET /api/bloomie-memory — load last session snapshot
router.get("/", requireAuth, requireConsent, async (req, res) => {
  try {
    const doc = await db.collection("bloomieMemory").doc(req.user.uid).get();
    if (!doc.exists) return res.json(null);
    res.json(doc.data());
  } catch (e) {
    console.error("bloomieMemory GET error:", e);
    res.status(500).json({ error: "Failed to load memory" });
  }
});

// PUT /api/bloomie-memory — save compact session snapshot
router.put("/", requireAuth, requireConsent, async (req, res) => {
  try {
    const { lastSymptoms, lastIntent, lastSeverity, lastDuration, lastPregnancyChance, recentTopics } = req.body;

    const symptoms = Array.isArray(lastSymptoms)
      ? lastSymptoms.filter(s => VALID_SYMPTOM_KEYS.has(s)).slice(0, 20)
      : [];

    const severity = VALID_SEVERITIES.has(lastSeverity) ? lastSeverity : null;

    const duration = lastDuration && typeof lastDuration === "object"
      ? {
          days:  typeof lastDuration.days === "number"  ? lastDuration.days  : null,
          weeks: typeof lastDuration.weeks === "number" ? lastDuration.weeks : null,
          unit:  typeof lastDuration.unit  === "string" ? lastDuration.unit.slice(0, 20) : null,
          value: typeof lastDuration.value === "number" ? lastDuration.value : null,
        }
      : null;

    const topics = Array.isArray(recentTopics)
      ? recentTopics.slice(0, 5).map(t => String(t).slice(0, 50))
      : [];

    const memory = {
      lastSessionDate:    new Date().toISOString(),
      lastSymptoms:       symptoms,
      lastIntent:         typeof lastIntent === "string" ? lastIntent.slice(0, 100) : null,
      lastSeverity:       severity,
      lastDuration:       duration,
      lastPregnancyChance: !!lastPregnancyChance,
      recentTopics:       topics,
    };

    await db.collection("bloomieMemory").doc(req.user.uid).set(memory);
    res.json({ ok: true });
  } catch (e) {
    console.error("bloomieMemory PUT error:", e);
    res.status(500).json({ error: "Failed to save memory" });
  }
});

export default router;
