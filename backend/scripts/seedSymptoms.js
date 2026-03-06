// scripts/seedSymptoms.js
// Run from backend root: node scripts/seedSymptoms.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "../src/firebaseAdmin.js";
import admin from "firebase-admin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.resolve(__dirname, "../data/symptoms.json");
const symptoms = JSON.parse(fs.readFileSync(filePath, "utf8"));

async function seed() {
  console.log(`Seeding ${symptoms.length} symptoms into symptomCatalog...`);

  const batch = db.batch();

  symptoms.forEach((s) => {
    const ref = db.collection("symptomCatalog").doc(s.key);
    batch.set(
      ref,
      {
        ...s,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
  console.log(`✅ Seeded ${symptoms.length} symptoms successfully.`);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});