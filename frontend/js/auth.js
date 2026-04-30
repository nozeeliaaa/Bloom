/**
 * auth.js - Firebase Authentication Helpers (Frontend)
 * - Login / Register / Logout
 * - Email verification enforcement
 * - Password reset flow
 * - Password strength validation
 * - Supplies ID token for backend API calls in account mode
 * - Fetches Firestore user role (admin/user) and stores in localStorage
 */

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDB } from "./firebase.js";
import { getMode, setMode } from "./mode.js";

/** Local storage keys */
const ROLE_KEY = "bloom_user_role";
const IS_ADMIN_KEY = "bloom_is_admin";
const ROLE_SYNC_TIMEOUT_MS = 1800;

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
export async function getIdToken({ waitForAuthMs = 1200 } = {}) {
  let user = getUser();

  // On first page load there is a short window where currentUser is still null
  // even though an account session exists. Wait briefly in account mode so
  // backend calls don't incorrectly fall back to local/anon paths.
  if (!user && getMode() === "account" && waitForAuthMs > 0) {
    const a = auth();
    if (a) {
      user = await new Promise((resolve) => {
        let settled = false;
        let unsub = () => {};
        let timer = null;
        const finish = (u) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          try { unsub(); } catch (_) {}
          resolve(u ?? null);
        };
        timer = setTimeout(() => finish(a.currentUser ?? null), waitForAuthMs);
        unsub = onAuthStateChanged(a, (u) => finish(u));
      });
    }
  }

  if (!user) return null;
  try {
    return await user.getIdToken();
  } catch (_) {
    return null;
  }
}

// ─────────────────────────────────────────
// PASSWORD STRENGTH
// ─────────────────────────────────────────

/**
 * Validates password strength.
 * Returns { valid: boolean, errors: string[] }
 */
export function validatePassword(password) {
  const errors = [];

  if (!password || password.length < 8) {
    errors.push("At least 8 characters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("At least one uppercase letter");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("At least one number");
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push("At least one special character (e.g. !, @, #)");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Returns a strength label and score (0-4) based on how many rules pass.
 */
export function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"];
  const colors = ["#e74c3c", "#e74c3c", "#f39c12", "#2ecc71", "#27ae60"];

  return { score, label: labels[score], color: colors[score] };
}

// ─────────────────────────────────────────
// ROLE MANAGEMENT
// ─────────────────────────────────────────

async function syncUserRole(user) {
  const cachedRole = localStorage.getItem(ROLE_KEY);
  const cachedIsAdmin = localStorage.getItem(IS_ADMIN_KEY);

  try {
    const tokenResult = await user.getIdTokenResult().catch(() => null);
    const claimRole = tokenResult?.claims?.role;
    if (claimRole === "admin") {
      localStorage.setItem(ROLE_KEY, "admin");
      localStorage.setItem(IS_ADMIN_KEY, "1");
      return true;
    }

    const db = getFirebaseDB();
    if (!db) {
      localStorage.setItem(ROLE_KEY, cachedRole || "user");
      localStorage.setItem(IS_ADMIN_KEY, cachedIsAdmin === "1" ? "1" : "0");
      return cachedIsAdmin === "1";
    }

    const ref = doc(db, "users", user.uid);
    const snap = await Promise.race([
      getDoc(ref),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("role sync timeout")), ROLE_SYNC_TIMEOUT_MS)
      ),
    ]);

    // Backend schema: role is top-level users/{uid}.role
    // Keep nested fallback for older docs.
    const role = snap.exists() ? (snap.data()?.role ?? snap.data()?.profile?.role) : null;

    localStorage.setItem(ROLE_KEY, role || "user");
    localStorage.setItem(IS_ADMIN_KEY, role === "admin" ? "1" : "0");

    return role === "admin";
  } catch (e) {
    localStorage.setItem(ROLE_KEY, cachedRole || "user");
    localStorage.setItem(IS_ADMIN_KEY, cachedIsAdmin === "1" ? "1" : "0");
    console.warn("[auth] Could not sync role:", e);
    return cachedIsAdmin === "1";
  }
}

function clearCachedRole() {
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(IS_ADMIN_KEY);
}

export function isAdminCached() {
  return localStorage.getItem(IS_ADMIN_KEY) === "1";
}

export async function isAdmin() {
  const user = getUser();
  if (!user) return false;

  const cached = localStorage.getItem(IS_ADMIN_KEY);
  if (cached === "1") return true;
  if (cached === "0") return false;

  return await syncUserRole(user);
}

// ─────────────────────────────────────────
// AUTH LISTENER
// ─────────────────────────────────────────

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
    }

    if (typeof onChange === "function") {
      onChange(user);
    }
  });
}

export function onAuthChange(callback) {
  const a = auth();
  if (!a) {
    if (typeof callback === "function") callback(null);
    return () => {};
  }
  return onAuthStateChanged(a, async (user) => {
    if (user) {
      setMode("account");
      await syncUserRole(user);
    } else {
      clearCachedRole();
      setMode("anon");
    }
    if (typeof callback === "function") callback(user);
  });
}

// ─────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────

/**
 * Register a new user.
 * - Enforces password strength
 * - Sends email verification automatically
 */
export async function register(email, password) {
  const { valid, errors } = validatePassword(password);
  if (!valid) {
    const err = new Error("Password does not meet requirements: " + errors.join(", "));
    err.code = "auth/weak-password-custom";
    err.errors = errors;
    throw err;
  }

  const res = await createUserWithEmailAndPassword(auth(), email, password);

  await sendEmailVerification(res.user);

  setMode("account");
  await syncUserRole(res.user);
  return res.user;
}

// ─────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────

/**
 * Login - blocks if email not verified.
 * Throws err.code = "auth/email-not-verified" so UI can offer resend.
 */
export async function login(email, password) {
  const res = await signInWithEmailAndPassword(auth(), email, password);

  if (!res.user.emailVerified) {
    // Auto-send verification email so they don't have to click Resend
    try { await sendEmailVerification(res.user); } catch (_) {}
    await signOut(auth());

    const err = new Error("Please verify your email before logging in.");
    err.code = "auth/email-not-verified";
    err.unverifiedEmail = email;
    throw err;
  }

  setMode("account");
  await syncUserRole(res.user);
  return res.user;
}

// ─────────────────────────────────────────
// PASSWORD RESET
// ─────────────────────────────────────────

export async function sendPasswordReset(email) {
  if (!email?.trim()) {
    throw new Error("Please enter your email address.");
  }
  await sendPasswordResetEmail(auth(), email.trim());
}

// ─────────────────────────────────────────
// RESEND VERIFICATION EMAIL
// ─────────────────────────────────────────

/**
 * Signs in temporarily just to resend the verification email,
 * then signs back out. Used when a user hasn't verified yet.
 */
export async function resendVerificationEmail(email, password) {
  // Sign in temporarily (unverified users can sign in, just can't use the app)
  const res = await signInWithEmailAndPassword(auth(), email, password);
  await sendEmailVerification(res.user);
  await signOut(auth());
}

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────

// All localStorage keys that belong to the signed-in user.
// These must be cleared on logout so the next user starts with a clean slate.
const USER_LOCAL_KEYS = [
  "bloom_daily_logs",
  "bloom_assistant_session",
  "bloomie_state_v2",
  "bloomieMemory",
  "bloom_bloomie_memory",
  "bloom_avatar",
  "bloom_goal",
  "bloom_onboarded",
  "bloom_yob_locked",
  "bloom_profile",
  "bloom_lmp",
  "bloom_user_name",
  "bloom_notification_inbox",
  "bloom_notified",
  "bloom_preferences",
  "bloom_show_mode_banner_once",
  "bloom_last_activity_ts",
];

export function clearLocalSessionData() {
  clearCachedRole();
  USER_LOCAL_KEYS.forEach((key) => localStorage.removeItem(key));

  // Remove cycle-state caches persisted in localStorage by older builds.
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("bloom_cs_v1_") || key.startsWith("bloom_biometric_cs_v1_")) {
      localStorage.removeItem(key);
    }
  }

  try {
    sessionStorage.clear();
  } catch (_) {}
}

export async function logout() {
  clearLocalSessionData();
  setMode("anon");
  await signOut(auth());
}
