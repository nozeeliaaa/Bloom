/**
 * auth.js — Firebase Authentication Helpers (Frontend)
 * - Login / Register / Logout
 * - Email verification enforcement
 * - Password reset flow
 * - Password strength validation
 * - Supplies ID token for backend API calls in account mode
 * - Fetches Firestore user role (admin/user) and stores in localStorage
 */

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDB } from "./firebase.js";
import { setMode } from "./mode.js";

/** Local storage keys */
const ROLE_KEY = "bloom_user_role";
const IS_ADMIN_KEY = "bloom_is_admin";

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
  try {
    const db = getFirebaseDB();
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    const role = snap.exists() ? snap.data()?.role : null;

    localStorage.setItem(ROLE_KEY, role || "user");
    localStorage.setItem(IS_ADMIN_KEY, role === "admin" ? "1" : "0");

    return role === "admin";
  } catch (e) {
    localStorage.setItem(ROLE_KEY, "user");
    localStorage.setItem(IS_ADMIN_KEY, "0");
    console.warn("[auth] Could not sync role:", e);
    return false;
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

  const { createUserWithEmailAndPassword, sendEmailVerification } = await import("firebase/auth");
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
 * Login — blocks if email not verified.
 * Throws err.code = "auth/email-not-verified" so UI can offer resend.
 */
export async function login(email, password) {
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const res = await signInWithEmailAndPassword(auth(), email, password);

  if (!res.user.emailVerified) {
    const { signOut } = await import("firebase/auth");
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
  const { sendPasswordResetEmail } = await import("firebase/auth");
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
  const { signInWithEmailAndPassword, sendEmailVerification, signOut } = await import("firebase/auth");

  // Sign in temporarily (unverified users can sign in, just can't use the app)
  const res = await signInWithEmailAndPassword(auth(), email, password);
  await sendEmailVerification(res.user);
  await signOut(auth());
}

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────

export async function logout() {
  const { signOut } = await import("firebase/auth");
  clearCachedRole();
  await signOut(auth());
}