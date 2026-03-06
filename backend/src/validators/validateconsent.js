// src/validators/validateConsent.js

const VALID_STATUSES = ["pending", "approved", "denied"];

/**
 * Validates a consent status update (guardian approving/denying).
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateConsentUpdate(body) {
  // --- status: required ---
  if (!body.status) {
    return { valid: false, error: "status is required" };
  }

  if (!VALID_STATUSES.includes(body.status)) {
    return {
      valid: false,
      error: `status must be one of: ${VALID_STATUSES.join(", ")}`,
    };
  }

  return { valid: true };
}

/**
 * Validates a guardian consent request (teen initiating).
 * guardianEmail is required to send the invite.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateConsentRequest(body) {
  if (!body.guardianEmail || typeof body.guardianEmail !== "string") {
    return { valid: false, error: "guardianEmail is required" };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(body.guardianEmail.trim())) {
    return { valid: false, error: "guardianEmail must be a valid email address" };
  }

  return { valid: true, guardianEmail: body.guardianEmail.trim().toLowerCase() };
}