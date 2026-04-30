/**
 * backend/src/routes/bloomieSafetyLog.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Safety event log endpoint.
 *
 * POST /api/bloomie-safety-log
 *   Writes one event to the bloomieSafetyLogs Firestore collection.
 *   Each document records a single safety-relevant routing event.
 *
 * Collection: bloomieSafetyLogs
 * Document ID: auto-generated
 * Fields:
 *   type        - "urgent_trigger" | "oos_fallback" | "escalation"
 *   uid         - Firebase UID of the user (from auth token)
 *   ts          - server timestamp
 *   input       - truncated normalised user text (max 300 chars)
 *   route       - the resolved route node (urgent_trigger / escalation)
 *   reason      - inferred reason string from inferRoute() payload
 *   category    - OOS category name (oos_fallback only)
 *   fromNode    - dialogue node active before escalation (escalation only)
 *   urgencyFlag - extractEntities().urgent was true (urgent_trigger)
 *   symptoms    - array of detected symptom keys
 *   reviewed    - false (admin sets to true after manual review)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import express                       from "express";
import { db, admin }                 from "../firebaseAdmin.js";

const FieldValue = admin.firestore.FieldValue;
import { requireAuth }               from "../middleware/auth.js";

const router = express.Router();

const VALID_TYPES      = new Set(["urgent_trigger", "oos_fallback", "escalation"]);
const VALID_RISK_LEVELS = new Set(["low", "moderate", "high"]);

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

// POST /api/bloomie-safety-log
router.post("/", requireAuth, async (req, res) => {
  try {
    const {
      type, input, route, reason,
      category, fromNode, urgencyFlag, symptoms,
      containsHealthKeywords, topic, riskLevel,
    } = req.body;

    // Validate type
    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid event type" });
    }

    // Build the log document - whitelist every field
    const doc = {
      type,
      uid:         req.user.uid,
      ts:          FieldValue.serverTimestamp(),
      reviewed:    false,
    };

    if (typeof input    === "string") doc.input    = input.slice(0, 300);
    if (typeof route    === "string") doc.route    = route.slice(0, 80);
    if (typeof reason   === "string") doc.reason   = reason.slice(0, 120);
    if (typeof category === "string") doc.category = category.slice(0, 80);
    if (typeof fromNode === "string") doc.fromNode = fromNode.slice(0, 80);
    if (urgencyFlag              !== undefined) doc.urgencyFlag              = !!urgencyFlag;
    if (containsHealthKeywords   !== undefined) doc.containsHealthKeywords   = !!containsHealthKeywords;
    if (typeof topic    === "string") doc.topic    = topic.slice(0, 80);
    if (typeof riskLevel === "string" && VALID_RISK_LEVELS.has(riskLevel)) doc.riskLevel = riskLevel;

    if (Array.isArray(symptoms)) {
      doc.symptoms = symptoms
        .filter(s => VALID_SYMPTOM_KEYS.has(s))
        .slice(0, 20);
    }

    await db.collection("bloomieSafetyLogs").add(doc);

    res.json({ ok: true });
  } catch (e) {
    // Log the error server-side but don't surface details to the client
    console.error("bloomieSafetyLog POST error:", e);
    res.status(500).json({ error: "Failed to write safety log" });
  }
});

export default router;
