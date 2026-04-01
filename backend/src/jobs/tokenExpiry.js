// src/jobs/tokenExpiry.js
import { db } from "../firebaseAdmin.js";

export async function runTokenExpiryJob() {
  console.log("[tokenExpiry] Running token expiry job...");

  try {
    const now = new Date();

    const snap = await db.collection("consents")
      .where("status", "==", "pending")
      .get();

    if (snap.empty) {
      console.log("[tokenExpiry] No pending consents to check.");
      return;
    }

    let expired = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const expiresAt = data.inviteTokenExpiresAt;

      if (!expiresAt) continue;

      const expiryDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);

      if (expiryDate < now && !data.inviteTokenUsed) {
        await docSnap.ref.update({
          status: "expired",
          statusUpdatedAt: now,
        });
        expired++;
        console.log(`[tokenExpiry] Expired consent: ${docSnap.id}`);
      }
    }

    console.log(`[tokenExpiry] Expired ${expired} consent(s).`);
  } catch (err) {
    console.error("[tokenExpiry] Job failed:", err.message);
  }
}