import admin from "firebase-admin";
import { db } from "../../src/firebaseAdmin.js";

async function backfillGameData() {
  console.log("Starting game data backfill...");

  const snap = await db.collection("users").get();
  let checked = 0;
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    checked += 1;

    const data = doc.data() || {};
    const game = data.game || {};

    const hasCompleteGame =
      game.xp !== undefined &&
      game.level !== undefined &&
      game.sessionsPlayed !== undefined;

    if (hasCompleteGame) {
      skipped += 1;
      console.log(`- Skipped ${doc.id}: game already exists`);
      continue;
    }

    await doc.ref.set(
      {
        game: {
          xp: game.xp ?? 0,
          level: game.level ?? 1,
          sessionsPlayed: game.sessionsPlayed ?? 0,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    updated += 1;
    console.log(`✓ Updated ${doc.id}`);
  }

  console.log("");
  console.log("Game data backfill complete.");
  console.log(`Checked: ${checked}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
}

backfillGameData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Game data backfill failed:", err);
    process.exit(1);
  });