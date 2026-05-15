// src/jobs/ageUpgrade.js
import { db, auth } from "../firebaseAdmin.js";
import { logAudit, AUDIT_ACTIONS } from "../utils/auditLog.js";


export async function runAgeUpgradeJob() {
  console.log("[ageUpgrade] Running age upgrade job...");

  try {
    const currentYear = new Date().getFullYear();

    // Find all users with ageBand "10-17" stored in their profile
    const snap = await db.collection("users")
      .where("profile.ageBand", "==", "10-17")
      .get();

    if (snap.empty) {
      console.log("[ageUpgrade] No teens to upgrade.");
      return;
    }

    const upgrades = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const yob = data.profile?.yearOfBirth;

      if (!yob) continue;

      const age = currentYear - yob;
      if (age >= 18) {
        upgrades.push({ uid: docSnap.id, data });
      }
    }

    console.log(`[ageUpgrade] Found ${upgrades.length} user(s) to upgrade.`);

    for (const { uid, data } of upgrades) {
      try {
        // Update Firestore
        await db.collection("users").doc(uid).set(
          { profile: { ageBand: "18+" } },
          { merge: true }
        );

        // Update Firebase custom claim
        await auth.setCustomUserClaims(uid, {
          role:    data.role || "user",
          ageBand: "18+",
        });

        // Revoke any active consents - they're now an adult
        const consentSnap = await db.collection("consents")
          .where("teenUid", "==", uid)
          .where("status", "==", "approved")
          .get();

        for (const c of consentSnap.docs) {
          await c.ref.update({
            status: "revoked",
            statusUpdatedAt: new Date(),
            revokedReason: "user_turned_18",
          });
        }

        await logAudit({
          actorUid:   "system",
          actorRole:  "admin",
          action:     AUDIT_ACTIONS.ROLE_CHANGED,
          entityType: "user",
          entityId:   uid,
          meta:       { changedFields: ["ageBand"], reasonCode: "age_upgrade" },
        });

        console.log(`[ageUpgrade] Upgraded uid: ${uid} to 18+`);
      } catch (err) {
        console.error(`[ageUpgrade] Failed to upgrade uid ${uid}:`, err.message);
      }
    }

  } catch (err) {
    console.error("[ageUpgrade] Job failed:", err.message);
  }
}
