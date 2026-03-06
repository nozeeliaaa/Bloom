// backend/src/middleware/auth.js
import { auth, db } from "../firebaseAdmin.js";

// ─── Main auth middleware ────────────────────────────────────────────────────
// Verifies Firebase token, loads role + profile from Firestore,
// and attaches enriched user object to req.user
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }

  const token = header.split(" ")[1];

  try {
    // 1) Verify the Firebase ID token
    const decoded = await auth.verifyIdToken(token);

    // 2) Load the user's Firestore doc
    const userDoc = await db.collection("users").doc(decoded.uid).get();

    if (!userDoc.exists) {
      // Auto-create a minimal user doc on first sign-in
      await db.collection("users").doc(decoded.uid).set({
        profile: {
          role: "user",
          yearOfBirth: null,
          consentSensitive: false,
          remindersEnabled: false,
          reminderTime: "09:00",
          mode: "account",
          goal: "track_cycle",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
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

    const data = userDoc.data();
    const profile = data?.profile || {};

    // 3) Derive ageBand from yearOfBirth
    const ageBand = deriveAgeBand(profile.yearOfBirth);

    // 4) Attach enriched user — role comes from Firestore, not the token
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      email_verified: !!decoded.email_verified,
      role: profile.role || "user",
      ageBand,           // "13-17" | "18+" | null
      yob: profile.yearOfBirth || null,
    };

    return next();
  } catch (err) {
    console.error("requireAuth error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ─── Role gate middleware ────────────────────────────────────────────────────
// Usage: requireRole("admin") or requireRole("admin", "user")
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
// Blocks teens from sensitive modules unless guardian consent is approved.
// Adults (18+) pass through automatically.
export async function requireSensitiveAccess(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    // Adults always pass
    if (req.user.ageBand === "18+") return next();

    // If age is unknown, block by default
    if (!req.user.ageBand) {
      return res.status(403).json({ error: "Age verification required" });
    }

    // Teen: check consents collection for approved guardian consent
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
  return null; // under 13 — handle separately if needed
}

// Kept for backward compatibility with any code that imports this
export function getAgeFromYob(yob) {
  const year = Number(yob);
  const current = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > current) return null;
  return current - year;
}