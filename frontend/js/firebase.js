/**
 * Firebase initialization
 * Lazily loads Firebase SDK from CDN and initializes once
 */
import { firebaseConfig } from './firebaseConfig.js';

let app = null;
let auth = null;
let db = null;
let firebaseReady = false;

function isConfigured() {
  return firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY';
}

async function loadFirebaseSDK() {
  if (firebaseReady) return;
  if (!isConfigured()) {
    console.warn('[Bloom] Firebase not configured. Running in anonymous-only mode.');
    return;
  }

  try {
    // Dynamic import from CDN
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    firebaseReady = true;
  } catch (err) {
    console.error('[Bloom] Failed to load Firebase:', err);
  }
}

export async function getFirebaseAuth() {
  await loadFirebaseSDK();
  return auth;
}

export async function getFirebaseDB() {
  await loadFirebaseSDK();
  return db;
}

export function isFirebaseConfigured() {
  return isConfigured();
}

export { firebaseReady };
