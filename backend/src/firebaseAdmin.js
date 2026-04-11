// src/firebaseAdmin.js
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serviceAccountPath = path.resolve(__dirname, "../serviceAccountKey.json");

function initAdmin() {
  if (admin.apps.length) return admin.app();

  let credential;

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(
      fs.readFileSync(serviceAccountPath, "utf8")
    );
    credential = admin.credential.cert(serviceAccount);
    console.log("Using serviceAccountKey.json");
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = admin.credential.cert(serviceAccount);
    console.log("Using FIREBASE_SERVICE_ACCOUNT");
  } else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
    credential = admin.credential.cert(serviceAccount);
    console.log("Using split FIREBASE_* env vars");
  } else {
    credential = admin.credential.applicationDefault();
    console.log("Using applicationDefault()");
  }

  admin.initializeApp({
    credential,
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      "bloom-8401a.firebasestorage.app",
  });

  return admin.app();
}

initAdmin();

export { admin };
export const db = admin.firestore();
export const auth = admin.auth();