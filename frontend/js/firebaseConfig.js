/**
 * Firebase Configuration
 *
 * Replace these placeholder values with your actual Firebase project config.
 * You can find these in your Firebase Console > Project Settings > General > Your Apps.
 *
 * For production, use environment variables or a build step to inject these.
 * This file should be in .gitignore for security.
 */
// Deployment-friendly API base:
// - Local dev (Vite): keep empty string to use proxy (/api -> http://127.0.0.1:4000)
// - Production (static hosting): optionally set window.BLOOM_API_BASE before modules load
// - Vite build: supports VITE_BLOOM_API_BASE
const viteApiBase = (typeof import.meta !== "undefined" && import.meta?.env?.VITE_BLOOM_API_BASE) || "";
const globalApiBase = typeof window.BLOOM_API_BASE === "string" ? window.BLOOM_API_BASE : "";
window.BLOOM_API_BASE = String(viteApiBase || globalApiBase).trim();

const host = window.location.hostname || "";
const isLocalHost =
  host === "localhost" ||
  host === "127.0.0.1" ||
  host === "0.0.0.0";
const isNetlifyHost = host.endsWith(".netlify.app");

if (!window.BLOOM_API_BASE && !isLocalHost && !isNetlifyHost) {
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
