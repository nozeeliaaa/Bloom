/**
 * scripts/migrateUserRoles.js
 *
 * One-time script to backfill missing role + profile fields
 * on all existing user documents in Firestore.
 *
 * Run from backend folder:
 *   node scripts/migrateUserRoles.js
 */

import { db } from "../src/firebaseAdmin.js";
import admin from "firebase-admin";

async function migrateUserRoles() {
  console.log("Starting user role migration...");

  const snapshot = await db.collection("users").get();

  if (snapshot.empty) {
    console.log("No users found.");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const docSnap of snapshot.docs) {
    const data    = docSnap.data();
    const profile = data?.profile || {};

    const needsRoleField   = !data.role;
    const needsProfileField = !data.profile;

    if (!needsRoleField && !needsProfileField) {
      skipped++;
      continue;
    }

    const backfill = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (needsRoleField) {
      backfill.role = profile.role || "user";
    }

    if (needsProfileField) {
      backfill.profile = {
        role:             "user",
        yearOfBirth:      null,
        consentSensitive: false,
        remindersEnabled: false,
        reminderTime:     "09:00",
        mode:             "account",
        goal:             "track_cycle",
      };
    }

    await docSnap.ref.set(backfill, { merge: true });

    console.log(`  ✓ Patched: ${docSnap.id} (${data.email || "no email"})`);
    updated++;
  }

  console.log(`\nDone. ${updated} updated, ${skipped} already correct.`);
  process.exit(0);
}

migrateUserRoles().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});