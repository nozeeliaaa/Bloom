import { db, auth } from "../firebaseAdmin.js";

const DELETE_BATCH_SIZE = 250;

async function deleteDocumentTree(docRef) {
  let deleted = 0;

  if (typeof docRef.listCollections === "function") {
    const childCollections = await docRef.listCollections();
    for (const childCollection of childCollections) {
      deleted += await deleteCollectionTree(childCollection);
    }
  }

  await docRef.delete();
  return deleted + 1;
}

async function deleteCollectionTree(collectionRef) {
  let deleted = 0;

  while (true) {
    const snap = await collectionRef.limit(DELETE_BATCH_SIZE).get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      deleted += await deleteDocumentTree(doc.ref);
    }
  }

  return deleted;
}

async function deleteDocsMatching(collectionName, field, value) {
  let deleted = 0;

  while (true) {
    const snap = await db
      .collection(collectionName)
      .where(field, "==", value)
      .limit(DELETE_BATCH_SIZE)
      .get();

    if (snap.empty) break;

    for (const doc of snap.docs) {
      deleted += await deleteDocumentTree(doc.ref);
    }
  }

  return deleted;
}

export async function deleteBloomUserData(uid, { deleteAuthUser = true } = {}) {
  if (!uid || typeof uid !== "string") {
    throw new Error("A valid uid is required");
  }

  const stats = {
    firestoreDocumentsDeleted: 0,
    authDeleted: false,
    authAlreadyMissing: false,
  };

  const directDocs = [
    db.collection("users").doc(uid),
    db.collection("preferences").doc(uid),
    db.collection("cycleLogs").doc(uid),
    db.collection("symptomLogs").doc(uid),
    db.collection("biometricLogs").doc(uid),
    db.collection("phaseFeedback").doc(uid),
    db.collection("bloomieMemory").doc(uid),
    db.collection("adminUsers").doc(uid),
  ];

  for (const docRef of directDocs) {
    stats.firestoreDocumentsDeleted += await deleteDocumentTree(docRef);
  }

  const queryDeletes = [
    ["consents", "teenUid"],
    ["consents", "guardianUid"],
    ["relationships", "teenUid"],
    ["relationships", "guardianUid"],
    ["contactMessages", "userId"],
    ["bloomieFeedback", "userId"],
    ["bloomieSafetyLogs", "uid"],
    ["bloomie_analytics", "uid"],
  ];

  for (const [collectionName, field] of queryDeletes) {
    stats.firestoreDocumentsDeleted += await deleteDocsMatching(collectionName, field, uid);
  }

  if (deleteAuthUser) {
    try {
      await auth.deleteUser(uid);
      stats.authDeleted = true;
    } catch (err) {
      if (err?.code === "auth/user-not-found") {
        stats.authAlreadyMissing = true;
      } else {
        throw err;
      }
    }
  }

  return stats;
}
