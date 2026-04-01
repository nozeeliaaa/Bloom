// src/middleware/requireConsent.js
import { db } from "../firebaseAdmin.js";

/**
 * Middleware: blocks teens from accessing sensitive modules
 * unless they have an approved consent from a guardian.
 *
 * Non-teens (adults, admins) pass through automatically.
 * Attach to any route that is a "sensitive module".
 */
export async function requireConsent(req, res, next) {
  try {
    const user = req.user;

    // Only enforce for teens
    if (user.ageBand !== "10-17") return next();

    const snap = await db
      .collection("consents")
      .where("teenUid", "==", user.uid)
      .where("status", "==", "approved")
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(403).json({
        error: "Guardian consent is required to access this feature.",
        code: "CONSENT_REQUIRED",
      });
    }

    const consent = snap.docs[0].data();

    // Double-check scope even if status is approved
    if (!consent.scope?.sensitiveModules) {
      return res.status(403).json({
        error: "Your guardian's consent does not cover this feature.",
        code: "CONSENT_SCOPE_INSUFFICIENT",
      });
    }

    // Attach consent data to req in case the route needs it
    req.consent = { id: snap.docs[0].id, ...consent };

    return next();
  } catch (err) {
    console.error("[requireConsent] Error:", err);
    return res.status(500).json({ error: "Failed to verify consent status" });
  }
}

/**
 * Middleware: specifically gates pregnancy mode.
 * Requires consent AND scope.pregnancyMode === true.
 */
export async function requirePregnancyConsent(req, res, next) {
  try {
    const user = req.user;

    if (user.ageBand !== "13-17") return next();

    const snap = await db
      .collection("consents")
      .where("teenUid", "==", user.uid)
      .where("status", "==", "approved")
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(403).json({
        error: "Guardian consent is required to access pregnancy mode.",
        code: "CONSENT_REQUIRED",
      });
    }

    const consent = snap.docs[0].data();

    if (!consent.scope?.pregnancyMode) {
      return res.status(403).json({
        error: "Your guardian has not enabled pregnancy mode access.",
        code: "PREGNANCY_CONSENT_REQUIRED",
      });
    }

    req.consent = { id: snap.docs[0].id, ...consent };
    return next();
  } catch (err) {
    console.error("[requirePregnancyConsent] Error:", err);
    return res.status(500).json({ error: "Failed to verify consent status" });
  }
}