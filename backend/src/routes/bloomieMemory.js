// src/routes/bloomieMemory.js
import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { requireConsent } from "../middleware/requireConsent.js";

const router = express.Router();

// All known symptom keys — used to whitelist incoming data
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

const VALID_URGENCY_LEVELS = new Set(["low", "medium", "high", "emergency"]);

// ── Default document schema ───────────────────────────────────────────────────
function buildDefaultMemory(uid, now) {
  return {
    uid,
    createdAt:              now,
    updatedAt:              now,
    lastSessionDate:        now,
    sessionCount:           0,
    recentTopics:           [],
    lastIntent:             null,
    lastSymptoms:           [],
    lastSeverity:           null,
    lastDuration:           null,
    lastPregnancyChance:    false,
    lastUrgencyLevel:       null,
    lastRedFlagRoute:       null,
    recentConcernCategory:  null,
    lastPatternSummary:     null,
  };
}

async function ensureBloomieMemory(uid) {
  const ref = db.collection("bloomieMemory").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(buildDefaultMemory(uid, now), { merge: true });
    return ref.get(); // re-read after creation
  }

  return snap;
}

// ── GET /api/bloomie-memory ───────────────────────────────────────────────────
// Returns memory doc. Creates with defaults if it doesn't exist.
router.get("/", requireAuth, requireConsent, async (req, res) => {
  try {
    const uid = req.user.uid;
    const snap = await ensureBloomieMemory(uid);
    return res.json({ memory: snap.data() });
  
  } catch (e) {
    console.error("bloomieMemory GET error:", e);
    res.status(500).json({ error: "Failed to load memory" });
  }
});

router.post("/session", requireAuth, requireConsent, async (req, res) => {
  try {
    const uid = req.user.uid;
    const ref = db.collection("bloomieMemory").doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await ensureBloomieMemory(uid);

    await ref.set(
      {
        lastSessionDate: now,
        sessionCount: admin.firestore.FieldValue.increment(1),
        updatedAt: now,
      },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("session start error:", e);
    res.status(500).json({ error: "Failed to start session" });
  }
});

router.patch("/", requireAuth, requireConsent, async (req, res) => {
  try {
    const uid = req.user.uid;
    const ref = db.collection("bloomieMemory").doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await ensureBloomieMemory(uid);

    const {
      lastIntent,
      lastSymptoms,
      recentTopics,
      lastSeverity,
      lastDuration,
      lastPregnancyChance,
      lastUrgencyLevel,
      lastRedFlagRoute,
      recentConcernCategory,
      lastPatternSummary,
    } = req.body;

    const update = { updatedAt: now };

    if (lastIntent !== undefined) {
      update.lastIntent = typeof lastIntent === "string"
        ? lastIntent.slice(0, 100)
        : null;
    }

    if (lastSymptoms !== undefined) {
      update.lastSymptoms = Array.isArray(lastSymptoms)
        ? lastSymptoms.filter(s => VALID_SYMPTOM_KEYS.has(s)).slice(0, 10)
        : [];
    }

    if (recentTopics !== undefined) {
      update.recentTopics = Array.isArray(recentTopics)
        ? recentTopics.slice(0, 10).map(t => String(t).slice(0, 50))
        : [];
    }

    if (lastSeverity !== undefined) {
      update.lastSeverity = VALID_SEVERITIES.has(lastSeverity) ? lastSeverity : null;
    }

    if (lastDuration !== undefined) {
      update.lastDuration =
        typeof lastDuration === "string"
          ? lastDuration.slice(0, 100)
          : null;
    }

    if (lastPregnancyChance !== undefined) {
      update.lastPregnancyChance = !!lastPregnancyChance;
    }

    if (lastUrgencyLevel !== undefined) {
      update.lastUrgencyLevel = VALID_URGENCY_LEVELS.has(lastUrgencyLevel)
        ? lastUrgencyLevel
        : null;
    }

    if (lastRedFlagRoute !== undefined) {
      update.lastRedFlagRoute = typeof lastRedFlagRoute === "string"
        ? lastRedFlagRoute.slice(0, 200)
        : null;
    }

    if (recentConcernCategory !== undefined) {
      update.recentConcernCategory = typeof recentConcernCategory === "string"
        ? recentConcernCategory.slice(0, 100)
        : null;
    }

    if (lastPatternSummary !== undefined) {
      update.lastPatternSummary = typeof lastPatternSummary === "string"
        ? lastPatternSummary.slice(0, 500)
        : null;
    }

    await ref.set(update, { merge: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error("PATCH error:", e);
    res.status(500).json({ error: "Failed to update memory" });
  }
});

// ── POST /api/bloomie-memory ─────────────────────────────────────────────────
router.post("/", requireAuth, requireConsent, async (req, res) => {
  try {
    const uid = req.user.uid;
    const ref = db.collection("bloomieMemory").doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const {
      lastIntent,
      lastSymptoms,
      recentTopics,
      lastSeverity,
      lastDuration,
      lastPregnancyChance,
      lastUrgencyLevel,
      lastRedFlagRoute,
      recentConcernCategory,
      lastPatternSummary,
    } = req.body;

    // Ensure doc exists first — create with defaults if missing
    await ensureBloomieMemory(uid);

    // Build partial update — only include fields that were sent
    const update = {
      updatedAt:       now,
    };

    if (lastIntent !== undefined) {
      update.lastIntent = typeof lastIntent === "string"
        ? lastIntent.slice(0, 100)
        : null;
    }

    if (lastSymptoms !== undefined) {
      update.lastSymptoms = Array.isArray(lastSymptoms)
        ? lastSymptoms.filter(s => VALID_SYMPTOM_KEYS.has(s)).slice(0, 10)
        : [];
    }

    if (recentTopics !== undefined) {
      update.recentTopics = Array.isArray(recentTopics)
        ? recentTopics.slice(0, 10).map(t => String(t).slice(0, 50))
        : [];
    }

    if (lastSeverity !== undefined) {
      update.lastSeverity = VALID_SEVERITIES.has(lastSeverity) ? lastSeverity : null;
    }

    if (lastDuration !== undefined) {
      update.lastDuration =
        typeof lastDuration === "string"
          ? lastDuration.slice(0, 100)
          : null;
    }

    if (lastPregnancyChance !== undefined) {
      update.lastPregnancyChance = !!lastPregnancyChance;
    }

    if (lastUrgencyLevel !== undefined) {
      update.lastUrgencyLevel = VALID_URGENCY_LEVELS.has(lastUrgencyLevel)
        ? lastUrgencyLevel
        : null;
    }

    if (lastRedFlagRoute !== undefined) {
      update.lastRedFlagRoute = typeof lastRedFlagRoute === "string"
        ? lastRedFlagRoute.slice(0, 200)
        : null;
    }

    if (recentConcernCategory !== undefined) {
      update.recentConcernCategory = typeof recentConcernCategory === "string"
        ? recentConcernCategory.slice(0, 100)
        : null;
    }

    if (lastPatternSummary !== undefined) {
      update.lastPatternSummary = typeof lastPatternSummary === "string"
        ? lastPatternSummary.slice(0, 500)
        : null;
    }

    await ref.set(update, { merge: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error("bloomieMemory POST error:", e);
    res.status(500).json({ error: "Failed to update memory" });
  }
});

// ── PUT /api/bloomie-memory ───────────────────────────────────────────────────
// Full session snapshot save — kept for backwards compatibility.
router.put("/", requireAuth, requireConsent, async (req, res) => {
  try {
    const uid = req.user.uid;
    const ref = db.collection("bloomieMemory").doc(uid);
    const now = admin.firestore.FieldValue.serverTimestamp();

    const { lastSymptoms, lastIntent, lastSeverity, lastDuration, lastPregnancyChance, recentTopics } = req.body;

    const symptoms = Array.isArray(lastSymptoms)
      ? lastSymptoms.filter(s => VALID_SYMPTOM_KEYS.has(s)).slice(0, 10)
      : [];

    const severity = VALID_SEVERITIES.has(lastSeverity) ? lastSeverity : null;

    const duration =
      typeof lastDuration === "string"
        ? lastDuration.slice(0, 100)
        : null;

    const topics = Array.isArray(recentTopics)
      ? recentTopics.slice(0, 10).map(t => String(t).slice(0, 50))
      : [];

    const existing = await ref.get();

    const memory = {
      uid,
      updatedAt: now,
      lastSymptoms: symptoms,
      lastIntent: typeof lastIntent === "string" ? lastIntent.slice(0, 100) : null,
      lastSeverity: severity,
      lastDuration: duration,
      lastPregnancyChance: !!lastPregnancyChance,
      recentTopics: topics,
    };

    if (!existing.exists) {
      memory.createdAt = now;
      memory.lastUrgencyLevel      = null;
      memory.lastRedFlagRoute      = null;
      memory.recentConcernCategory = null;
      memory.lastPatternSummary    = null;
    }

    await ref.set(memory, { merge: true });

    return res.json({ ok: true });
  } catch (e) {
    console.error("bloomieMemory PUT error:", e);
    res.status(500).json({ error: "Failed to save memory" });
  }
});

export default router;