import express from "express";
import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const ALLOWED_RESPONSES = new Set(["yes", "not_sure", "no"]);
const ALLOWED_PHASES = new Set([
  "menstrual",
  "follicular",
  "ovulation",
  "luteal",
]);

router.post("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const {
      response,
      correctedPhase = null,
      bleedingConfirmed = false,
      cycleDay = null,
      predictedPhase = null,
      confidence = null,
      notes = null,
    } = req.body || {};

    if (!ALLOWED_RESPONSES.has(response)) {
      return res.status(400).json({ error: "Invalid response value." });
    }

    if (correctedPhase !== null && !ALLOWED_PHASES.has(correctedPhase)) {
      return res.status(400).json({ error: "Invalid correctedPhase value." });
    }

    if (predictedPhase !== null && !ALLOWED_PHASES.has(predictedPhase)) {
      return res.status(400).json({ error: "Invalid predictedPhase value." });
    }

    const feedbackRef = db
      .collection("phaseFeedback")
      .doc(uid)
      .collection("entries")
      .doc();

    await feedbackRef.set({
      uid,
      response,
      correctedPhase,
      bleedingConfirmed: !!bleedingConfirmed,
      cycleDay: cycleDay === null ? null : Number(cycleDay),
      predictedPhase,
      confidence,
      notes: notes ? String(notes).slice(0, 500) : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    let phaseUpdate = null;

    if (response === "no" && bleedingConfirmed === true) {
      phaseUpdate = {
        lastPeriodStart: new Date().toISOString().slice(0, 10),
        phaseEstimation: {
          estimatedPhase: "menstrual",
          confidence: {
            level: "high",
            score: 0.9,
          },
          override: {
            source: "user_feedback",
            reason: "bleeding_confirmed",
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      };
    } else if (response === "no" && correctedPhase) {
      phaseUpdate = {
        phaseEstimation: {
          estimatedPhase: correctedPhase,
          confidence: {
            level: "medium",
            score: 0.7,
          },
          override: {
            source: "user_feedback",
            reason: "phase_corrected",
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      };
    }

    if (phaseUpdate) {
      await db.collection("users").doc(uid).set(
        {
          phaseProfile: {
            lastPeriodStart:
              phaseUpdate.lastPeriodStart ?? admin.firestore.FieldValue.delete(),
            phaseEstimation: phaseUpdate.phaseEstimation ?? null,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    return res.json({
      ok: true,
      feedbackId: feedbackRef.id,
      phaseUpdated: !!phaseUpdate,
    });
  } catch (err) {
    console.error("POST /phase-feedback error:", err);
    return res.status(500).json({ error: "Failed to save phase feedback" });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;

    const snap = await db
      .collection("phaseFeedback")
      .doc(uid)
      .collection("entries")
      .orderBy("createdAt", "desc")
      .get();

    const entries = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({ ok: true, entries });
  } catch (err) {
    console.error("GET /phase-feedback error:", err);
    return res.status(500).json({ error: "Failed to fetch phase feedback" });
  }
});

export default router;