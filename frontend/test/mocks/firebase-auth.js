import { vi } from "vitest";

let currentUser = null;
const listeners = new Set();

export function __setMockUser(user) {
  currentUser = user;
  for (const cb of listeners) cb(currentUser);
}

export function __getMockUser() {
  return currentUser;
}

export const onAuthStateChanged = vi.fn((auth, callback) => {
  listeners.add(callback);
  callback(currentUser);
  return () => listeners.delete(callback);
});

export const createUserWithEmailAndPassword = vi.fn(async (_auth, email) => {
  currentUser = {
    uid: "new-user",
    email,
    emailVerified: true,
    getIdToken: vi.fn(async () => "mock-token"),
  };
  return { user: currentUser };
});

export const sendEmailVerification = vi.fn(async () => undefined);

export const signInWithEmailAndPassword = vi.fn(async (_auth, email) => {
  currentUser = {
    uid: "signed-in-user",
    email,
    emailVerified: true,
    getIdToken: vi.fn(async () => "mock-token"),
  };
  return { user: currentUser };
});

export const sendPasswordResetEmail = vi.fn(async () => undefined);
export const signOut = vi.fn(async () => { currentUser = null; });
export const getAuth = vi.fn(() => ({ get currentUser() { return currentUser; } }));
