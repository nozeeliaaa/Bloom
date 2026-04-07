/**
 * Firebase initialization (Vite / npm SDK)
 * - Single source of truth (NO CDN imports)
 * - Sync exports for auth + db + messaging
 */
 
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";
import { firebaseConfig } from "./firebaseConfig.js";
 
let app      = null;
let auth     = null;
let db       = null;
let messaging = null;
 
function isConfigured() {
  return firebaseConfig?.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";
}
 
async function initFirebase() {
  if (!isConfigured()) {
    console.warn("[Bloom] Firebase not configured. Running in anonymous-only mode.");
    return;
  }
 
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
 
  auth = getAuth(app);
  db   = getFirestore(app);
 
  // FCM is only supported in browsers that support service workers
  try {
    const supported = await isSupported();
    if (supported) {
      messaging = getMessaging(app);
    }
  } catch (e) {
    console.warn("[Bloom] FCM not supported in this environment:", e);
  }
}
 
// init immediately
initFirebase();
 
export function getFirebaseAuth()      { return auth; }
export function getFirebaseDB()        { return db; }
export function getFirebaseMessaging() { return messaging; }
export function isFirebaseConfigured() { return isConfigured(); }
export const firebaseReady = !!auth && !!db;