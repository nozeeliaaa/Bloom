/**
 * Firebase initialization (Vite / npm SDK)
 * - Single source of truth (NO CDN imports)
 * - Sync exports for auth + db
 */

import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig.js";

let app = null;
let auth = null;
let db = null;

function isConfigured() {
  return firebaseConfig?.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";
}

function initFirebase() {
  if (!isConfigured()) {
    console.warn("[Bloom] Firebase not configured. Running in anonymous-only mode.");
    return;
  }

  // Prevent double-init in Vite HMR
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }

  auth = getAuth(app);
  db = getFirestore(app);
}

// init immediately
initFirebase();

export function getFirebaseAuth() {
  return auth;
}

export function getFirebaseDB() {
  return db;
}

export function isFirebaseConfigured() {
  return isConfigured();
}

// Optional: quick flag (kept for compatibility)
export const firebaseReady = !!auth && !!db;