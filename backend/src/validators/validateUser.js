// src/validators/validateUser.js

const VALID_GOALS = ["period", "track_symptoms", "ttc", "perimenopause", "pregnancy"];
const VALID_MODES = ["account", "guest"];
const VALID_ROLES = ["user", "teen", "guardian", "admin"];

/**
 * Validates the body of a POST /profile request.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateUserProfile(body, existingProfile = null) {
  const currentYear = new Date().getFullYear();

  // --- yearOfBirth ---
  if (body.yearOfBirth !== undefined && body.yearOfBirth !== null) {
    const yob = Number(body.yearOfBirth);

    if (!Number.isInteger(yob) || yob < 1900 || yob > currentYear) {
      return { valid: false, error: "yearOfBirth must be a valid year between 1900 and now" };
    }

    // Edit-once enforcement: if already set and different, block it
    const existingYob = existingProfile?.yearOfBirth;
    if (
      existingYob !== null &&
      existingYob !== undefined &&
      existingYob !== yob
    ) {
      return { valid: false, error: "yearOfBirth is locked and cannot be changed" };
    }

    // Age floor: must be at least 10
    const age = currentYear - yob;
    if (age < 10) {
      return { valid: false, error: "User must be at least 10 years old" };
    }
  }

  // --- avgCycleLength ---
  if (body.avgCycleLength !== undefined && body.avgCycleLength !== null) {
    const val = Number(body.avgCycleLength);
    if (!Number.isFinite(val) || val <= 0 || val > 365) {
      return { valid: false, error: "avgCycleLength must be a positive number (days)" };
    }
  }

  // --- periodDuration ---
  if (body.periodDuration !== undefined && body.periodDuration !== null) {
    const val = Number(body.periodDuration);
    if (!Number.isFinite(val) || val <= 0 || val > 30) {
      return { valid: false, error: "periodDuration must be a positive number (days)" };
    }
  }

  // --- weightKg ---
  if (body.weightKg !== undefined && body.weightKg !== null) {
    const val = Number(body.weightKg);
    if (!Number.isFinite(val) || val <= 0 || val > 700) {
      return { valid: false, error: "weightKg must be a positive number" };
    }
  }

  // --- heightCm ---
  if (body.heightCm !== undefined && body.heightCm !== null) {
    const val = Number(body.heightCm);
    if (!Number.isFinite(val) || val <= 0 || val > 300) {
      return { valid: false, error: "heightCm must be a positive number" };
    }
  }

  // --- goal ---
  if (body.goal !== undefined && !VALID_GOALS.includes(body.goal)) {
    return { valid: false, error: `goal must be one of: ${VALID_GOALS.join(", ")}` };
  }

  // --- mode ---
  if (body.mode !== undefined && !VALID_MODES.includes(body.mode)) {
    return { valid: false, error: `mode must be one of: ${VALID_MODES.join(", ")}` };
  }

  // --- role (only checked if present - setting role is an admin action) ---
  if (body.role !== undefined && !VALID_ROLES.includes(body.role)) {
    return { valid: false, error: `role must be one of: ${VALID_ROLES.join(", ")}` };
  }

  // --- booleans ---
  if (body.consentSensitive !== undefined && typeof body.consentSensitive !== "boolean") {
    return { valid: false, error: "consentSensitive must be a boolean" };
  }

  if (body.remindersEnabled !== undefined && typeof body.remindersEnabled !== "boolean") {
    return { valid: false, error: "remindersEnabled must be a boolean" };
  }

  // --- reminderTime: simple HH:MM format check ---
  if (body.reminderTime !== undefined) {
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRegex.test(body.reminderTime)) {
      return { valid: false, error: "reminderTime must be in HH:MM format (e.g. 09:00)" };
    }
  }

  return { valid: true };
}