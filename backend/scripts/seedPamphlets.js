// scripts/seedPamphlets.js
// Run from backend root: node scripts/seedPamphlets.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/firebaseAdmin.js";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.resolve(__dirname, "../../frontend/data/pamphlets.json");
const pamphlets = JSON.parse(fs.readFileSync(filePath, "utf8"));

async function seed() {
  console.log(`Seeding ${pamphlets.length} pamphlets into Firestore 'pamphlets' collection...`);

  const batchSize = 500;
  for (let i = 0; i < pamphlets.length; i += batchSize) {
    const batch = db.batch();
    const chunk = pamphlets.slice(i, i + batchSize);

    chunk.forEach((pamphlet) => {
      const ref = db.collection("pamphlets").doc(pamphlet.id);
      batch.set(
        ref,
        {
          ...pamphlet,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
    console.log(`  Committed batch ${Math.floor(i / batchSize) + 1} (${chunk.length} docs)`);
  }

  console.log("Done! All pamphlets seeded.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
