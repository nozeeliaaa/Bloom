// src/firebaseAdmin.js
import admin from "firebase-admin";
import fs from "fs";

function initAdmin() {
  // Prevent re-init on hot reload or in tests
  if (admin.apps.length) return admin.app();

  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Production / hosted environment: full JSON string in env var
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
  } else if (fs.existsSync("./serviceAccountKey.json")) {
    // Local dev fallback: key file on disk
    const serviceAccount = JSON.parse(
      fs.readFileSync("./serviceAccountKey.json", "utf8")
    );
    credential = admin.credential.cert(serviceAccount);
  } else {
    // Platform-managed credentials (e.g. Google Cloud Run, App Engine)
    credential = admin.credential.applicationDefault();
  }

  admin.initializeApp({ credential });
  return admin.app();
}

initAdmin();

export { admin };
export const db = admin.firestore();
export const auth = admin.auth();