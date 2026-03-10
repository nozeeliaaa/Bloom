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
    const userDoc = await db.collection("users").doc(decoded.uid).get();

    if (!userDoc.exists) {
      // Auto-create a minimal user doc on first sign-in
      await db.collection("users").doc(decoded.uid).set({
        role: "user",                    // top-level role
        profile: {
          role: "user",
          yearOfBirth: null,
          consentSensitive: false,
          remindersEnabled: false,
          reminderTime: "09:00",
          mode: "account",
          goal: "track_cycle",
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

    const data    = userDoc.data();
    const profile = data?.profile || {};

    // Backfill top-level role for existing accounts missing it
    if (!data.role) {
      await db.collection("users").doc(decoded.uid).update({
        role:      profile.role || "user",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
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