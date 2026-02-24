import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// serviceAccountKey.json is in /backend (one level above /src)
const keyPath = path.join(__dirname, "../serviceAccountKey.json");

if (!fs.existsSync(keyPath)) {
  throw new Error(`Missing serviceAccountKey.json at: ${keyPath}`);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const auth = admin.auth();
export const db = admin.firestore();
export default admin;