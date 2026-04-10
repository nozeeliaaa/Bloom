import admin from "firebase-admin";
import { db } from "../src/firebaseAdmin.js";

function computeAgeBand(yob) {
  const year = Number(yob);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
    return null;
  }

  const age = currentYear - year;
  if (age >= 10 && age <= 17) return "10-17";
  if (age >= 18) return "18+";
  return null;
}

async function backfillAgeBands() {
  console.log("Starting ageBand backfill...");

  const snap = await db.collection("users").get();
  let checked = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    checked += 1;

    const data = doc.data() || {};
    const profile = data.profile || {};
    const yearOfBirth = profile.yearOfBirth ?? null;
    const currentAgeBand = profile.ageBand ?? null;

    const computedAgeBand = computeAgeBand(yearOfBirth);

    if (currentAgeBand === computedAgeBand) {
      skipped += 1;
      console.log(`- Skipped ${doc.id}: ageBand already correct (${computedAgeBand})`);
      continue;
    }

    await doc.ref.set(
      {
        profile: {
          ageBand: computedAgeBand,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated += 1;
    console.log(`✓ Updated ${doc.id}: ${currentAgeBand} -> ${computedAgeBand}`);
  }

  console.log("");
  console.log("AgeBand backfill complete.");
  console.log(`Checked: ${checked}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
}

backfillAgeBands()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("AgeBand backfill failed:", err);
    process.exit(1);
  });