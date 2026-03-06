/**
 * auth.js — Firebase Authentication Helpers (Frontend)
 * - Login / Register / Logout
 * - Supplies ID token for backend API calls in account mode
 * - Fetches Firestore user role (admin/user) and stores in localStorage
 */

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDB } from "./firebase.js";
import { setMode } from "./mode.js";

/** Local storage keys */
const ROLE_KEY = "bloom_user_role";      // "admin" | "user"
const IS_ADMIN_KEY = "bloom_is_admin";   // "1" or "0"

/** Returns current Firebase Auth instance */
export function auth() {
  return getFirebaseAuth();
}

/** Get currently logged-in user */
export function getUser() {
  return auth()?.currentUser ?? null;
}

/** Alias kept for backwards compatibility */
export const getCurrentUser = getUser;

/** Get the Firebase ID token (for backend calls) */
export async function getIdToken() {
  const user = getUser();
  if (!user) return null;
  return await user.getIdToken();
}

/** Read user role from Firestore and cache it locally */
async function syncUserRole(user) {
  try {
    const db = getFirebaseDB();
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    const role = snap.exists() ? snap.data()?.role : null;

    localStorage.setItem(ROLE_KEY, role || "user");
    localStorage.setItem(IS_ADMIN_KEY, role === "admin" ? "1" : "0");

    return role === "admin";
  } catch (e) {
    // If rules block it or network fails, default to non-admin
    localStorage.setItem(ROLE_KEY, "user");
    localStorage.setItem(IS_ADMIN_KEY, "0");
    console.warn("[auth] Could not sync role:", e);
    return false;
  }
}

/** Clear cached role */
function clearCachedRole() {
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(IS_ADMIN_KEY);
}

/** Helper: is current user admin? (cached) */
export function isAdminCached() {
  return localStorage.getItem(IS_ADMIN_KEY) === "1";
}

/**
 * ✅ NEW: Async admin check used by navbar/admin page gating
 * - Returns false if not logged in
 * - Ensures role has been synced at least once
 */
export async function isAdmin() {
  const user = getUser();
  if (!user) return false;

  // If we already have a cached value, use it
  const cached = localStorage.getItem(IS_ADMIN_KEY);
  if (cached === "1") return true;
  if (cached === "0") return false;

  // Otherwise sync from Firestore
  return await syncUserRole(user);
}

/** Listen for auth changes (used to keep mode accurate) */
export function initAuthListener(onChange = null) {
  const a = auth();
  if (!a) {
    if (typeof onChange === "function") onChange(null);
    return;
  }
  onAuthStateChanged(a, async (user) => {
    if (user) {
      setMode("account");
      await syncUserRole(user);
    } else {
      clearCachedRole();
      // don't force anon if you allow browsing without login
      // setMode("anon");
    }

    if (typeof onChange === "function") {
      onChange(user);
    }
  });
}

/** Register new account */
export async function register(email, password) {
  const { createUserWithEmailAndPassword } = await import("firebase/auth");
  const res = await createUserWithEmailAndPassword(auth(), email, password);
  setMode("account");
  await syncUserRole(res.user);
  return res.user;
}

/** Login */
export async function login(email, password) {
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const res = await signInWithEmailAndPassword(auth(), email, password);
  setMode("account");
  await syncUserRole(res.user);
  return res.user;
}

/** Logout */
export async function logout() {
  const { signOut } = await import("firebase/auth");
  clearCachedRole();
  await signOut(auth());
}
/**
 * Compatibility helper for pages that expect onAuthChange().
 * Usage:
 *   const unsubscribe = onAuthChange((user) => { ... })
 */
export function onAuthChange(callback) {
  const a = auth();
  if (!a) {
    // Firebase not configured — fire callback immediately with null user
    if (typeof callback === "function") callback(null);
    return () => {};
  }
  return onAuthStateChanged(a, async (user) => {
    if (user) {
      setMode("account");
      await syncUserRole(user);
    } else {
      clearCachedRole();
    }
    if (typeof callback === "function") callback(user);
  });
}