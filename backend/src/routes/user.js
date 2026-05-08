import express from "express";
import admin from "firebase-admin";
import { db, auth } from "../firebaseAdmin.js";
import { requireAuth } from "../middleware/auth.js";
import { validateUserProfile } from "../validators/validateUser.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";

const router = express.Router();

function isFirestoreQuotaError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return err?.code === 8 || msg.includes("resource_exhausted") || msg.includes("quota exceeded");
}

function computeAgeBand(yob) {
  const age = new Date().getFullYear() - yob;
  if (age >= 10 && age <= 17) return "10-17";
  if (age >= 18) return "18+";
  return null;
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
    const existingBiometricProfile = existing?.biometricProfile || {};

    const validation = validateUserProfile(req.body, existingProfile);
    if (!validation.valid) {
      console.log(`[profile] validation failed:`, validation.error);
      return res.status(400).json({ error: validation.error });
    }

    const finalYearOfBirth =
      req.body.yearOfBirth === undefined
        ? existingProfile?.yearOfBirth ?? null
        : existingProfile?.yearOfBirth
        ? existingProfile.yearOfBirth
        : Number(req.body.yearOfBirth);

    const profile = {
      nickname:
        req.body.nickname !== undefined
          ? String(req.body.nickname).slice(0, 40)
          : (existingProfile?.nickname ?? null),
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
    };

    const healthProfile = {
      avgCycleLength:
        req.body.avgCycleLength !== undefined
          ? (req.body.avgCycleLength === null ? null : Number(req.body.avgCycleLength))
          : existing?.healthProfile?.avgCycleLength ?? null,

      periodDuration:
        req.body.periodDuration !== undefined
          ? (req.body.periodDuration === null ? null : Number(req.body.periodDuration))
          : existing?.healthProfile?.periodDuration ?? null,

      weightKg:
        req.body.weightKg !== undefined
          ? (req.body.weightKg === null ? null : Number(req.body.weightKg))
          : existing?.healthProfile?.weightKg ?? null,

      heightCm:
        req.body.heightCm !== undefined
          ? (req.body.heightCm === null ? null : Number(req.body.heightCm))
          : existing?.healthProfile?.heightCm ?? null,
    };

    const biometricProfile = {
      sleepScore: existingBiometricProfile.sleepScore ?? null,
      stressLevel: existingBiometricProfile.stressLevel ?? null,
      activityLevel: existingBiometricProfile.activityLevel ?? null,
    };

    const existingPhaseProfile = existing?.phaseProfile || {};

    const phaseProfile = {
      lastPeriodStart: existing?.lastPeriodStart ?? existingPhaseProfile.lastPeriodStart ?? null,
      phaseEstimation: existing?.phaseEstimation ?? existingPhaseProfile.phaseEstimation ?? null,
    };

    console.log(`[profile] writing users/${uid}.profile`, {
      nickname: profile.nickname,
      avatar: profile.avatar,
      yearOfBirth: profile.yearOfBirth,
    });

    await userRef.set({
      profile,
      healthProfile,
      biometricProfile,
      lastPeriodStart: phaseProfile.lastPeriodStart,
      averageCycleLength: healthProfile.avgCycleLength,
      cycleLengths: existing?.cycleLengths ?? [],
      phaseEstimation: phaseProfile.phaseEstimation,
      phaseProfile,   
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[profile] Firestore write success uid=${uid}`);

    const changedFields = Object.keys(req.body).filter((k) => k !== "role");

    const yobJustSet =
      req.body.yearOfBirth !== undefined && !existingProfile?.yearOfBirth;

    if (yobJustSet) {
      const ageBand = computeAgeBand(Number(req.body.yearOfBirth));

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
        actorUid: uid,
        actorRole: req.user.role,
        action: AUDIT_ACTIONS.PROFILE_UPDATED,
        entityType: "user",
        entityId: uid,
        meta: { changedFields },
      });
    }

    let savedData = {
      ...(existing || {}),
      profile,
      healthProfile,
      biometricProfile,
      phaseProfile,
    };
    try {
      const savedDoc = await userRef.get();
      if (savedDoc?.exists && typeof savedDoc.data === "function") {
        savedData = savedDoc.data();
      }
    } catch (readErr) {
      console.warn(`[profile] post-save read skipped uid=${uid}:`, readErr?.message || readErr);
    }

    console.log(`[profile] saved uid=${uid}`, JSON.stringify(savedData));
    return res.json({
      ok: true,
      profile: savedData?.profile ?? null,
      healthProfile: savedData?.healthProfile ?? null,
      biometricProfile: savedData?.biometricProfile ?? null,
      phaseProfile: savedData?.phaseProfile ?? null,
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
  if (xp >= 750) return 6;
  if (xp >= 500) return 5;
  if (xp >= 300) return 4;
  if (xp >= 150) return 3;
  if (xp >= 50) return 2;
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

    const newXP = (existing.xp || 0) + xpEarned;
    const newLevel = computeLevel(newXP);
    const newSessions = (existing.sessionsPlayed || 0) + 1;

    await userRef.set(
      { game: { xp: newXP, level: newLevel, sessionsPlayed: newSessions } },
      { merge: true }
    );

    return res.json({
      ok: true,
      game: { xp: newXP, level: newLevel, sessionsPlayed: newSessions },
    });
  } catch (err) {
    console.error("POST /game error:", err);
    return res.status(500).json({ error: "Failed to save game progress" });
  }
});

/* Get user profile */
router.get("/profile", requireAuth, async (req, res) => {
  try {
    if (req.user?.firestoreDegraded) {
      return res.json({
        degraded: true,
        profile: null,
        healthProfile: null,
        biometricProfile: null,
        phaseProfile: null,
        game: null,
      });
    }

    const uid = req.user.uid;
    const doc = await db.collection("users").doc(uid).get();
    if (!doc.exists) return res.json(null);

    const data = doc.data();

    if (data?.profile?.goal === "track_cycle") {
      data.profile.goal = "period";
    }

    return res.json(data);
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      console.warn("GET /profile quota exceeded; returning degraded profile payload");
      return res.json({
        degraded: true,
        profile: null,
        healthProfile: null,
        biometricProfile: null,
        phaseProfile: null,
        game: null,
      });
    }

    console.error("GET /profile error:", err?.message ?? err);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
