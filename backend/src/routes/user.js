// src/routes/user.js
import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateUserProfile } from "../validators/validateUser.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";

const router = express.Router();

function computeAgeBand(yob) {
  const age = new Date().getFullYear() - yob;
  if (age >= 10 && age <= 17) return "10-17";
  if (age >= 18) return "18+";
  return null;
}

function normalizeBiometricLevel(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}


/* Create or update user profile */
router.post("/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    console.log(`[profile] POST from uid=${uid} body=`, JSON.stringify(req.body));

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    const existing = snap.exists ? snap.data() : null;
    const existingProfile = existing?.profile || {};
    const existingHealthProfile = existing?.healthProfile || {};
    const existingBiometricProfile = existing?.biometricProfile || {};

    const incomingBiometric =
      req.body.biometricProfile && typeof req.body.biometricProfile === "object"
        ? req.body.biometricProfile
        : {};

    const incomingSleepScore =
      req.body.sleepScore !== undefined ? req.body.sleepScore : incomingBiometric.sleepScore;
    const incomingActivityLevel =
      req.body.activityLevel !== undefined ? req.body.activityLevel : incomingBiometric.activityLevel;
    const incomingStressLevel =
      req.body.stressLevel !== undefined ? req.body.stressLevel : incomingBiometric.stressLevel;

    // ---- Validate incoming body ----
    const validation = validateUserProfile(req.body, existingProfile);
    if (!validation.valid) {
      console.log(`[profile] validation failed:`, validation.error);
      return res.status(400).json({ error: validation.error });
    }

    // ---- Build profile object ----
    const finalYearOfBirth =
      req.body.yearOfBirth === undefined
        ? existingProfile?.yearOfBirth ?? null
        : existingProfile?.yearOfBirth
        ? existingProfile.yearOfBirth
        : Number(req.body.yearOfBirth);

    const profile = {
      nickname: req.body.nickname !== undefined ? String(req.body.nickname).slice(0, 40) : (existingProfile?.nickname ?? null),
      avatar:
        req.body.avatar !== undefined
          ? (typeof req.body.avatar === "string" ? req.body.avatar.slice(0, 10) : "👤")
          : existingProfile?.avatar ?? "👤",
      goal:
        req.body.goal ??
        (
          existingProfile?.goal === "track_cycle"
            ? "period"
            : existingProfile?.goal === "no_period"
            ? "track_symptoms"
            : (existingProfile?.goal ?? "period")
        ),
      mode: req.body.mode ?? existingProfile?.mode ?? "account",
      yearOfBirth: finalYearOfBirth,
      ageBand: finalYearOfBirth ? computeAgeBand(finalYearOfBirth) : null,
      consentSensitive: req.body.consentSensitive ?? existingProfile?.consentSensitive ?? false,
      remindersEnabled: req.body.remindersEnabled ?? existingProfile?.remindersEnabled ?? false,
      reminderTime: req.body.reminderTime ?? existingProfile?.reminderTime ?? "09:00",
      // Clean legacy duplicated fields that belonged in healthProfile.
      role: admin.firestore.FieldValue.delete(),
      avgCycleLength: admin.firestore.FieldValue.delete(),
      periodDuration: admin.firestore.FieldValue.delete(),
      weightKg: admin.firestore.FieldValue.delete(),
      heightCm: admin.firestore.FieldValue.delete(),
      sleepScore: admin.firestore.FieldValue.delete(),
      activityLevel: admin.firestore.FieldValue.delete(),
      stressLevel: admin.firestore.FieldValue.delete(),
      lmpDate: admin.firestore.FieldValue.delete(),
      lmp: admin.firestore.FieldValue.delete(),
    };

    const healthProfile = {
      avgCycleLength: req.body.avgCycleLength !== undefined
        ? (req.body.avgCycleLength === null ? null : Number(req.body.avgCycleLength))
        : existingHealthProfile?.avgCycleLength ?? null,

      periodDuration: req.body.periodDuration !== undefined
        ? (req.body.periodDuration === null ? null : Number(req.body.periodDuration))
        : existingHealthProfile?.periodDuration ?? null,

      weightKg: req.body.weightKg !== undefined
        ? (req.body.weightKg === null ? null : Number(req.body.weightKg))
        : existingHealthProfile?.weightKg ?? null,

      heightCm: req.body.heightCm !== undefined
        ? (req.body.heightCm === null ? null : Number(req.body.heightCm))
        : existingHealthProfile?.heightCm ?? null,

      lmpDate: req.body.lmpDate !== undefined
        ? (req.body.lmpDate === null || req.body.lmpDate === "" ? null : String(req.body.lmpDate))
        : existingHealthProfile?.lmpDate ?? existingHealthProfile?.lmp ?? existingProfile?.lmpDate ?? null,

      // Remove any older alias field.
      lmp: admin.firestore.FieldValue.delete(),

      // Remove deprecated storage location for sleep score.
      sleepScore: admin.firestore.FieldValue.delete(),
    };

    const biometricProfile = {
      sleepScore:
        incomingSleepScore !== undefined
          ? (incomingSleepScore === null || incomingSleepScore === "" ? null : Number(incomingSleepScore))
          : existingBiometricProfile?.sleepScore ?? existingHealthProfile?.sleepScore ?? existingProfile?.sleepScore ?? null,
      activityLevel:
        incomingActivityLevel !== undefined
          ? normalizeBiometricLevel(incomingActivityLevel)
          : normalizeBiometricLevel(existingBiometricProfile?.activityLevel ?? existingProfile?.activityLevel),
      stressLevel:
        incomingStressLevel !== undefined
          ? normalizeBiometricLevel(incomingStressLevel)
          : normalizeBiometricLevel(existingBiometricProfile?.stressLevel ?? existingProfile?.stressLevel),
    };
    await userRef.set(
      {
        profile,
        healthProfile,
        biometricProfile,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: existing?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // ── Audit: track which fields changed ──
    const changedFields = Object.keys(req.body).filter((k) => k !== "role");

    // Special case: YOB being set for the first time is a locked action
    const yobJustSet =
      req.body.yearOfBirth !== undefined && !existingProfile?.yearOfBirth;

    if (yobJustSet) {
      const ageBand = computeAgeBand(Number(req.body.yearOfBirth));

      // Set as Firebase custom claim so middleware can read req.user.ageBand
      const existingClaims = req.user || {};
      await auth.setCustomUserClaims(uid, {
        role: existingClaims.role || "user",
        ageBand,
      });

      await logAudit({
        actorUid: uid,
        actorRole: req.user.role,
        action: AUDIT_ACTIONS.YOB_SET,
        entityType: "user",
        entityId: uid,
        meta: { changedFields: ["yearOfBirth", "ageBand"] },
      });
    } else if (changedFields.length) {
      await logAudit({
        actorUid:   uid,
        actorRole:  req.user.role,
        action:     AUDIT_ACTIONS.PROFILE_UPDATED,
        entityType: "user",
        entityId:   uid,
        meta:       { changedFields },
       });
      }
    
    const savedDoc = await userRef.get();
    const savedData = savedDoc.data();
  
    console.log(`[profile] saved uid=${uid}`, JSON.stringify(savedData));
    return res.json({
      ok: true,
      profile: savedData?.profile ?? null,
      healthProfile: savedData?.healthProfile ?? null,
      biometricProfile: savedData?.biometricProfile ?? null,
    });

  } catch (err) {
    console.error("POST /profile error:", err);
    return res.status(500).json({ error: "Failed to save profile" });
  }
});

// ─── Game progress ────────────────────────────────────────────────────────────

function computeLevel(xp) {
  if (xp >= 2250) return 10;
  if (xp >= 1800) return 9;
  if (xp >= 1400) return 8;
  if (xp >= 1050) return 7;
  if (xp >= 750)  return 6;
  if (xp >= 500)  return 5;
  if (xp >= 300)  return 4;
  if (xp >= 150)  return 3;
  if (xp >= 50)   return 2;
  return 1;
}

router.get("/game", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("users").doc(req.user.uid).get();
    const game = snap.data()?.game || { xp: 0, level: 1, sessionsPlayed: 0 };
    return res.json({ ok: true, game });
  } catch (err) {
    console.error("GET /game error:", err);
    return res.status(500).json({ error: "Failed to fetch game progress" });
  }
});

router.post("/game", requireAuth, async (req, res) => {
  try {
    const { xpEarned } = req.body;
    if (typeof xpEarned !== "number" || xpEarned < 0 || xpEarned > 300) {
      return res.status(400).json({ error: "Invalid xpEarned value" });
    }
    const userRef = db.collection("users").doc(req.user.uid);
    const snap = await userRef.get();
    const existing = snap.data()?.game || { xp: 0, level: 1, sessionsPlayed: 0 };
    const newXP      = (existing.xp || 0) + xpEarned;
    const newLevel   = computeLevel(newXP);
    const newSessions = (existing.sessionsPlayed || 0) + 1;
    await userRef.set({ game: { xp: newXP, level: newLevel, sessionsPlayed: newSessions } }, { merge: true });
    return res.json({ ok: true, game: { xp: newXP, level: newLevel, sessionsPlayed: newSessions } });
  } catch (err) {
    console.error("POST /game error:", err);
    return res.status(500).json({ error: "Failed to save game progress" });
  }
});

/* Get user profile */
router.get("/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const doc = await db.collection("users").doc(uid).get();
    if (!doc.exists) return res.json(null);
    const data = doc.data();
    // Normalize legacy goal value before returning
    if (data?.profile?.goal === "track_cycle") {
      data.profile.goal = "period";
    }
    return res.json(data);
  } catch (err) {
    console.error("GET /profile error:", err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
