/**
 * Authentication module
 * Wraps Firebase Auth for Account Mode
 */
import { getFirebaseAuth, isFirebaseConfigured } from './firebase.js';
import { setMode } from './mode.js';

export async function register(email, password) {
  if (!isFirebaseConfigured()) throw new Error('Firebase not configured');
  const auth = await getFirebaseAuth();
  const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  setMode('account');
  return cred.user;
}

export async function login(email, password) {
  if (!isFirebaseConfigured()) throw new Error('Firebase not configured');
  const auth = await getFirebaseAuth();
  const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  const cred = await signInWithEmailAndPassword(auth, email, password);
  setMode('account');
  return cred.user;
}

export async function logout() {
  if (!isFirebaseConfigured()) return;
  const auth = await getFirebaseAuth();
  const { signOut } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  await signOut(auth);
  setMode('anon');
}

export async function getCurrentUser() {
  if (!isFirebaseConfigured()) return null;
  const auth = await getFirebaseAuth();
  return auth?.currentUser || null;
}

export async function onAuthChange(callback) {
  if (!isFirebaseConfigured()) {
    callback(null);
    return () => {};
  }
  const auth = await getFirebaseAuth();
  const { onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
  return onAuthStateChanged(auth, callback);
}
export async function getIdToken() {
  const user = await getCurrentUser();
  if (!user) return null;
  return await user.getIdToken();
}