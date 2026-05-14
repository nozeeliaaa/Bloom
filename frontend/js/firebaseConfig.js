/**
 * Firebase Configuration
 *
 * Replace these placeholder values with your actual Firebase project config.
 * You can find these in your Firebase Console > Project Settings > General > Your Apps.
 *
 * For production, use environment variables or a build step to inject these.
 * This file should be in .gitignore for security.
 */
const defaultApiBase = "https://bloom-backend-538005116995.us-central1.run.app";
const localApiBase = "http://127.0.0.1:4000";
const hasWindow = typeof window !== "undefined";
const host = hasWindow ? (window.location.hostname || "") : "";
const isLocalHost =
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "0.0.0.0";

const viteApiBase = import.meta.env.VITE_BLOOM_API_BASE || "";
const storedApiBase = hasWindow
  ? String(window.localStorage?.getItem("bloom_api_base") || "").trim()
  : "";
const globalApiBase = hasWindow && typeof window.BLOOM_API_BASE === "string" ? window.BLOOM_API_BASE : "";
const resolvedApiBase = String(
  viteApiBase ||
  storedApiBase ||
  globalApiBase ||
  (isLocalHost ? localApiBase : defaultApiBase)
).trim().replace(/\/+$/, "");
if (hasWindow) window.BLOOM_API_BASE = resolvedApiBase;

if (hasWindow && !window.BLOOM_API_BASE && !isLocalHost) {
  console.warn(
    "[Bloom] BLOOM_API_BASE is not set. API requests to /api/* will return 404 on static hosting. " +
      "Set window.BLOOM_API_BASE to your backend URL (example: https://bloom-backend.onrender.com)."
  );
}

export const firebaseConfig = {
  apiKey:            "AIzaSyCoY7010ONRgfc9ic6orCefKgSFAbAaOtg",
  authDomain:        "bloom-8401a.firebaseapp.com",
  projectId:         "bloom-8401a",
  storageBucket:     "bloom-8401a.firebasestorage.app",
  messagingSenderId: "538005116995",
  appId:             "1:538005116995:web:09eb9bb0e066ddbfd91cf6",
};
