// backend/src/middleware/auth.js
import { auth, db } from "../firebaseAdmin.js";
import admin from "firebase-admin";

// ─── Main auth middleware ────────────────────────────────────────────────────
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
        profile: {
          nickname: null,
          yearOfBirth: null,
          goal: null,
          mode: "account",
          consentSensitive: false,
          remindersEnabled: false,
          reminderTime: "09:00",
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

    const needsBackfill =
      !data.role ||
      !data.profile ||
      data.profile.nickname === undefined ||
      data.profile.yearOfBirth === undefined ||
      data.profile.goal === undefined ||
      data.profile.mode === undefined ||
      data.profile.consentSensitive === undefined ||
      data.profile.remindersEnabled === undefined ||
      data.profile.reminderTime === undefined ||
      data.profile.role !== undefined ||
      data.profile.goal === "track_cycle";

    if (needsBackfill) {
      const normalizedGoal =
        profile.goal === "track_cycle" ? null : (profile.goal ?? null);

      const backfill = {
        role: data.role || "user",
        profile: {
          nickname: profile.nickname ?? null,
          yearOfBirth: profile.yearOfBirth ?? null,
          goal: normalizedGoal,
          mode: profile.mode ?? "account",
          consentSensitive: profile.consentSensitive ?? false,
          remindersEnabled: profile.remindersEnabled ?? false,
          reminderTime: profile.reminderTime ?? "09:00",
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.set(backfill, { merge: true });

      data.role = backfill.role;
      data.profile = backfill.profile;
    }

    const safeProfile = data.profile || {};
    const ageBand = deriveAgeBand(safeProfile.yearOfBirth);

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

// ─── Role gate middleware ────────────────────────────────────────────────────
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

// ─── Sensitive access gate ───────────────────────────────────────────────────
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

// ─── Helpers ─────────────────────────────────────────────────────────────────
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