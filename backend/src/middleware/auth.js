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
      // Brand new user - create full doc with all expected fields
      await userRef.set({
        role: "user",
        email: decoded.email || null,
        profile: {
          role: "user",
          nickname: null,
          avatar: null,
          goal: "period",
          mode: "account",
          yearOfBirth: null,
          avgCycleLength: null,
          periodDuration: null,
          weightKg: null,
          heightCm: null,
          consentSensitive: false,
          remindersEnabled: false,
          reminderTime: "09:00",
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      req.user = {
        uid:            decoded.uid,
        email:          decoded.email || null,
        email_verified: !!decoded.email_verified,
        role:           "user",
        ageBand:        null,
        yob:            null,
      };

      return next();
    }

    // Doc exists - read it
    const data    = userDoc.data();
    const profile = data?.profile || {};

    // Backfill any missing fields for legacy accounts
    const needsBackfill = !data.role || !data.profile ||
      profile.nickname === undefined || profile.avatar === undefined ||
      profile.avgCycleLength === undefined || profile.goal === "track_cycle";
    if (needsBackfill) {
      const backfill = {
        role: data.role || profile.role || "user",
        email: data.email || decoded.email || null,
        profile: {
          role:             profile.role             || "user",
          nickname:         profile.nickname         ?? null,
          avatar:           profile.avatar           ?? null,
          goal:             profile.goal === "track_cycle" ? "period" : (profile.goal || "period"),
          mode:             profile.mode             || "account",
          yearOfBirth:      profile.yearOfBirth      ?? null,
          avgCycleLength:   profile.avgCycleLength   ?? null,
          periodDuration:   profile.periodDuration   ?? null,
          weightKg:         profile.weightKg         ?? null,
          heightCm:         profile.heightCm         ?? null,
          consentSensitive: profile.consentSensitive ?? false,
          remindersEnabled: profile.remindersEnabled ?? false,
          reminderTime:     profile.reminderTime     || "09:00",
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await userRef.set(backfill, { merge: true });

      // Use the backfilled values going forward
      Object.assign(data, backfill);
      Object.assign(profile, backfill.profile);
    }

    const ageBand = deriveAgeBand(profile.yearOfBirth);

    req.user = {
      uid:            decoded.uid,
      email:          decoded.email || null,
      email_verified: !!decoded.email_verified,
      role:           decoded.role || data.role || profile.role || "user",
      ageBand,
      yob:            profile.yearOfBirth || null,
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
  if (age >= 13 && age <= 17) return "13-17";
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