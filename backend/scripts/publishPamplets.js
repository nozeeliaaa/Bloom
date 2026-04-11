import { db } from "../src/firebaseAdmin.js";

async function publishAllPamphlets() {
  const snap = await db.collection("pamphlets").get();

  const batch = db.batch();

  snap.forEach(doc => {
    batch.update(doc.ref, { status: "published" });
  });

  await batch.commit();
  console.log("All pamphlets published ✅");
}

publishAllPamphlets();