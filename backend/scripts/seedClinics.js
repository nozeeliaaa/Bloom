// scripts/seedClinics.js
// Run from backend root: node scripts/seedClinics.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/firebaseAdmin.js";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.resolve(__dirname, "../data/clinics.json");
const clinics = JSON.parse(fs.readFileSync(filePath, "utf8"));

async function seed() {
  console.log(`Seeding ${clinics.length} clinics into clinicDirectory...`);

  // Use batches of 500 (Firestore batch limit)
  const batchSize = 500;
  for (let i = 0; i < clinics.length; i += batchSize) {
    const batch = db.batch();
    const chunk = clinics.slice(i, i + batchSize);

    chunk.forEach((clinic) => {
      // Generate a clean doc ID from the name
      const docId = clinic.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      const ref = db.collection("clinicDirectory").doc(docId);
      batch.set(
        ref,
        {
          ...clinic,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
    console.log(`Seeded batch ${i / batchSize + 1}`);
  }

  console.log(`✅ Seeded ${clinics.length} clinics successfully.`);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});