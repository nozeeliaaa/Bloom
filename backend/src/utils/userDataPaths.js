import admin from "firebase-admin";
import { db } from "../firebaseAdmin.js";

export function userRef(uid) {
  return db.collection("users").doc(uid);
}

export function userSubDoc(uid, collectionName, docId) {
  return userRef(uid).collection(collectionName).doc(docId);
}

export async function ensureUserDocument(uid, extra = {}) {
  const ref = userRef(uid);
  const snap = await ref.get();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await ref.set(
    {
      phaseEstimation: snap.exists ? snap.data()?.phaseEstimation ?? null : null,
      lastPeriodStart: snap.exists ? snap.data()?.lastPeriodStart ?? null : null,
      averageCycleLength: snap.exists ? snap.data()?.averageCycleLength ?? null : null,
      cycleLengths: snap.exists ? snap.data()?.cycleLengths ?? [] : [],
      updatedAt: now,
      createdAt: snap.exists ? snap.data()?.createdAt ?? now : now,
      ...extra,
    },
    { merge: true }
  );

  return ref;
}

export const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();
