/**
 * Firebase Configuration
 *
 * Replace these placeholder values with your actual Firebase project config.
 * You can find these in your Firebase Console > Project Settings > General > Your Apps.
 *
 * For production, use environment variables or a build step to inject these.
 * This file should be in .gitignore for security.
 */
// Empty string = use Vite proxy (/api → http://127.0.0.1:4000). Avoids CORS entirely.
if (typeof window !== "undefined" && window.BLOOM_API_BASE === undefined) {
  window.BLOOM_API_BASE = "";
}

export const firebaseConfig = {
  apiKey:            "AIzaSyCoY7010ONRgfc9ic6orCefKgSFAbAaOtg",
  authDomain:        "bloom-8401a.firebaseapp.com",
  projectId:         "bloom-8401a",
  storageBucket:     "bloom-8401a.firebasestorage.app",
  messagingSenderId: "538005116995",
  appId:             "1:538005116995:web:09eb9bb0e066ddbfd91cf6",
};
