import { auth, db } from "../firebaseAdmin.js";
import admin from "firebase-admin";

function isFirebaseAuthTokenError(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || "");
  return (
    code.startsWith("auth/") ||
    /auth\/[a-z-]+|Firebase ID token|Decoding Firebase ID token|id token|token has expired|token has been revoked/i.test(message)
  );
}

function isTransientFirebaseBackendError(err) {
  const code = String(err?.code || "").toLowerCase();
  const message = String(err?.message || "").toLowerCase();
  return (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "resource-exhausted" ||
    code === "internal" ||
    code === "14" ||
    code === "4" ||
    message.includes("could not reach cloud firestore") ||
    message.includes("firestore backend") ||
    message.includes("deadline exceeded") ||
    message.includes("service unavailable") ||
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("enotfound")
  );
}

function normalizeBiometricLevel(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function deleteFieldValue() {
  return typeof admin.firestore.FieldValue.delete === "function"
    ? admin.firestore.FieldValue.delete()
    : null;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = await auth.verifyIdToken(token);
    const userRef = db.collection("users").doc(decoded.uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      const defaultUserDocument = {
        role: "user",
        email: decoded.email || null,
        profile: {
          nickname: null,
          avatar: "👤",
          yearOfBirth: null,
          goal: null,
          mode: "account",
          consentSensitive: false,
          remindersEnabled: false,
          reminderTime: "09:00",
        },
        healthProfile: {
          avgCycleLength: null,
          periodDuration: null,
          weightKg: null,
          heightCm: null,
          lmpDate: null,
        },
        biometricProfile: {
          activityLevel: null,
          sleepScore: null,
          stressLevel: null,
        },
        game: {
          xp: 0,
          level: 1,
          sessionsPlayed: 0,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (typeof userRef.set === "function") {
        await userRef.set(defaultUserDocument);
      }

      req.user = {
        uid: decoded.uid,
        email: decoded.email || null,
        email_verified: !!decoded.email_verified,
        role: "user",
        ageBand: null,
        yob: null,
      };

      return next();
    }

    if (decoded.email_verified === false) {
      return res.status(403).json({
        error: "Email not verified",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const data = userDoc.data() || {};
    if (data.disabled === true) {
      return res.status(403).json({
        error: "Account disabled",
        code: "ACCOUNT_DISABLED",
      });
    }

    const isAdminUser =
      data.role === "admin"
        ? (await db.collection("adminUsers").doc(decoded.uid).get()).exists
        : false;
    const profile = data.profile || {};
    const healthProfile = data.healthProfile || {};
    const biometricProfile = data.biometricProfile || {};

    if (!data.email && decoded.email) {
      if (typeof userRef.set === "function") {
        await userRef.set(
          {
            email: decoded.email,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }

      data.email = decoded.email;
    }

    const needsBackfill =
      !data.role ||
      !data.profile ||
      !data.healthProfile ||
      !data.game ||
      profile.nickname === undefined ||
      profile.avatar === undefined ||
      profile.yearOfBirth === undefined ||
      profile.goal === undefined ||
      profile.mode === undefined ||
      profile.consentSensitive === undefined ||
      profile.remindersEnabled === undefined ||
      profile.reminderTime === undefined ||
      profile.role !== undefined ||
      profile.avgCycleLength !== undefined ||
      profile.periodDuration !== undefined ||
      profile.sleepScore !== undefined ||
      profile.activityLevel !== undefined ||
      profile.stressLevel !== undefined ||
      profile.weightKg !== undefined ||
      profile.heightCm !== undefined ||
      profile.lmpDate !== undefined ||
      profile.lmp !== undefined ||
      healthProfile.sleepScore !== undefined ||
      healthProfile.lmpDate === undefined ||
      healthProfile.lmp !== undefined ||
      !data.biometricProfile ||
      biometricProfile.activityLevel === undefined ||
      biometricProfile.sleepScore === undefined ||
      biometricProfile.stressLevel === undefined ||
      profile.goal === "track_cycle";

    if (needsBackfill) {
      const backfill = {
        role: data.role || "user",
        email: data.email || decoded.email || null,
        profile: {
          nickname: profile.nickname ?? null,
          avatar: profile.avatar ?? "👤",
          yearOfBirth: profile.yearOfBirth ?? null,
          goal:
            profile.goal === "track_cycle"
              ? "period"
              : profile.goal === "no_period"
              ? "track_symptoms"
              : (profile.goal ?? "period"),
          mode: profile.mode ?? "account",
          consentSensitive: profile.consentSensitive ?? false,
          remindersEnabled: profile.remindersEnabled ?? false,
          reminderTime: profile.reminderTime ?? "09:00",
          role: deleteFieldValue(),
          avgCycleLength: deleteFieldValue(),
          periodDuration: deleteFieldValue(),
          sleepScore: deleteFieldValue(),
          activityLevel: deleteFieldValue(),
          stressLevel: deleteFieldValue(),
          weightKg: deleteFieldValue(),
          heightCm: deleteFieldValue(),
          lmpDate: deleteFieldValue(),
          lmp: deleteFieldValue(),
        },
        healthProfile: {
          avgCycleLength:
            healthProfile.avgCycleLength ?? profile.avgCycleLength ?? null,
          periodDuration:
            healthProfile.periodDuration ?? profile.periodDuration ?? null,
          weightKg:
            healthProfile.weightKg ?? profile.weightKg ?? null,
          heightCm:
            healthProfile.heightCm ?? profile.heightCm ?? null,
          lmpDate:
            healthProfile.lmpDate ?? healthProfile.lmp ?? profile.lmpDate ?? profile.lmp ?? null,
          lmp: deleteFieldValue(),
          sleepScore: deleteFieldValue(),
        },
        biometricProfile: {
          activityLevel:
            normalizeBiometricLevel(biometricProfile.activityLevel ?? profile.activityLevel),
          sleepScore:
            biometricProfile.sleepScore ?? healthProfile.sleepScore ?? profile.sleepScore ?? null,
          stressLevel:
            normalizeBiometricLevel(biometricProfile.stressLevel ?? profile.stressLevel),
        },
        game: {
          xp: data.game?.xp ?? 0,
          level: data.game?.level ?? 1,
          sessionsPlayed: data.game?.sessionsPlayed ?? 0,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      try {
        if (typeof userRef.set === "function") {
          await userRef.set(backfill, { merge: true });
        }

        data.role = backfill.role;
        data.email = backfill.email;
        data.profile = backfill.profile;
        data.healthProfile = backfill.healthProfile;
        data.biometricProfile = backfill.biometricProfile;
        data.game = backfill.game;
      } catch (backfillErr) {
        console.warn("requireAuth backfill skipped:", backfillErr?.message || backfillErr);
      }
    }

    const safeProfile = data.profile || {};
    const ageBand = deriveAgeBand(safeProfile.yearOfBirth);

    if (safeProfile.yearOfBirth && safeProfile.ageBand !== ageBand) {
      if (typeof userRef.set === "function") {
        await userRef.set(
          {
            profile: { ageBand },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
      data.profile = {
        ...safeProfile,
        ageBand,
      };
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      email_verified: !!decoded.email_verified,
      role: isAdminUser ? "admin" : (decoded.role || data.role || "user"),
      ageBand,
      yob: safeProfile.yearOfBirth || null,
    };

    return next();
  } catch (err) {
    console.error("requireAuth error:", err);
    if (isFirebaseAuthTokenError(err)) {
      return res.status(401).json({
        error: "Invalid token",
        code: err.code || "auth/invalid-token",
      });
    }

    if (isTransientFirebaseBackendError(err)) {
      return res.status(503).json({
        error: "Authentication temporarily unavailable",
        code: "AUTH_BACKEND_UNAVAILABLE",
      });
    }

    return res.status(500).json({
      error: "Authentication check failed",
      code: "AUTH_CHECK_FAILED",
    });
  }
}

export function requireRole(...allowed) {
  const allowedSet = new Set(allowed);
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!allowedSet.has(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export async function requireSensitiveAccess(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    if (req.user.ageBand === "18+") return next();

    if (!req.user.ageBand) {
      return res.status(403).json({ error: "Age verification required" });
    }

    const consentSnap = await db
      .collection("consents")
      .where("teenUid", "==", req.user.uid)
      .where("status", "==", "approved")
      .limit(1)
      .get();

    if (consentSnap.empty) {
      return res.status(403).json({ error: "Guardian consent required" });
    }

    return next();
  } catch (err) {
    console.error("requireSensitiveAccess error:", err);
    return res.status(500).json({ error: "Consent check failed" });
  }
}

export function deriveAgeBand(yob) {
  if (!yob) return null;
  const year = Number(yob);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > currentYear) return null;
  const age = currentYear - year;
  if (age >= 10 && age <= 17) return "10-17";
  if (age >= 18) return "18+";
  return null;
}

export function getAgeFromYob(yob) {
  const year = Number(yob);
  const current = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > current) return null;
  return current - year;
}

export function requireConsentApproved() {
  return async (req, res, next) => {
    try {
      const uid = req.user?.uid;
      if (!uid) return res.status(401).json({ error: "Unauthorized" });

      const snap = await db.collection("users").doc(uid).get();
      const profile = snap.exists ? (snap.data()?.profile || {}) : {};

      const age = getAgeFromYob(profile.yearOfBirth);
      if (age === null) return res.status(403).json({ error: "Consent required" });

      if (age >= 18) return next();

      if (profile.consentSensitive === true) return next();

      return res.status(403).json({ error: "Consent required" });
    } catch (err) {
      console.error("Consent check failed:", err);
      return res.status(500).json({ error: "Consent check failed" });
    }
  };
}
