import { auth, db } from "../firebaseAdmin.js";
import admin from "firebase-admin";

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
      await userRef.set({
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
        },
        game: {
          xp: 0,
          level: 1,
          sessionsPlayed: 0,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

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

    const data = userDoc.data() || {};
    const profile = data.profile || {};
    const healthProfile = data.healthProfile || {};

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
      profile.weightKg !== undefined ||
      profile.heightCm !== undefined ||
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
        },
        game: {
          xp: data.game?.xp ?? 0,
          level: data.game?.level ?? 1,
          sessionsPlayed: data.game?.sessionsPlayed ?? 0,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.set(backfill, { merge: true });

      data.role = backfill.role;
      data.email = backfill.email;
      data.profile = backfill.profile;
      data.healthProfile = backfill.healthProfile;
    }

    const safeProfile = data.profile || {};
    const ageBand = deriveAgeBand(safeProfile.yearOfBirth);

    if (safeProfile.yearOfBirth && safeProfile.ageBand !== ageBand) {
      await userRef.set(
        {
          profile: { ageBand },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      data.profile = {
        ...safeProfile,
        ageBand,
      };
    }

    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      email_verified: !!decoded.email_verified,
      role: decoded.role || data.role || "user",
      ageBand,
      yob: safeProfile.yearOfBirth || null,
    };

    return next();
  } catch (err) {
    console.error("requireAuth error:", err);
    return res.status(401).json({ error: "Invalid token" });
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