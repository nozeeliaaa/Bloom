// src/utils/consentToken.js
import crypto from "crypto";

const TOKEN_EXPIRY_HOURS = 48;

export function generateInviteToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);
  return { token, expiresAt };
}

// Revoke tokens don't expire - guardian should be able to revoke at any time
export function generateRevokeToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function isTokenExpired(expiresAt) {
  // expiresAt is a Firestore Timestamp
  return expiresAt.toDate() < new Date();
}