// src/validators/validateUser.js

const VALID_GOALS = ["period", "track_symptoms", "ttc", "perimenopause", "pregnancy"];
const VALID_MODES = ["account", "guest"];
const VALID_ROLES = ["user", "teen", "guardian", "admin"];
const VALID_BIOMETRIC_LEVELS = ["low", "moderate", "high", "very_high"];

/**
 * Validates the body of a POST /profile request.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateUserProfile(body, existingProfile = null) {
  const currentYear = new Date().getFullYear();
  const incomingBiometric =
    body?.biometricProfile && typeof body.biometricProfile === "object"
      ? body.biometricProfile
      : {};
  const readBiometricField = (field) =>
    body?.[field] !== undefined ? body[field] : incomingBiometric?.[field];

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
  // --- nickname ---
  if (body.nickname !== undefined && body.nickname !== null) {
    if (typeof body.nickname !== "string") {
      return { valid: false, error: "nickname must be a string" };
    }
    if (body.nickname.trim().length > 40) {
      return { valid: false, error: "nickname must be 40 characters or fewer" };
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

  // --- sleepScore ---
  const sleepScore = readBiometricField("sleepScore");
  if (sleepScore !== undefined && sleepScore !== null && sleepScore !== "") {
    const val = Number(sleepScore);
    if (!Number.isFinite(val) || val < 1 || val > 10) {
      return { valid: false, error: "sleepScore must be a number between 1 and 10" };
    }
  }

  // --- activityLevel ---
  const activityLevel = readBiometricField("activityLevel");
  if (activityLevel !== undefined && activityLevel !== null && activityLevel !== "") {
    if (typeof activityLevel !== "string") {
      return { valid: false, error: "activityLevel must be a string" };
    }
    const normalized = activityLevel.trim().toLowerCase();
    if (!VALID_BIOMETRIC_LEVELS.includes(normalized)) {
      return { valid: false, error: `activityLevel must be one of: ${VALID_BIOMETRIC_LEVELS.join(", ")}` };
    }
  }

  // --- stressLevel ---
  const stressLevel = readBiometricField("stressLevel");
  if (stressLevel !== undefined && stressLevel !== null && stressLevel !== "") {
    if (typeof stressLevel !== "string") {
      return { valid: false, error: "stressLevel must be a string" };
    }
    const normalized = stressLevel.trim().toLowerCase();
    if (!VALID_BIOMETRIC_LEVELS.includes(normalized)) {
      return { valid: false, error: `stressLevel must be one of: ${VALID_BIOMETRIC_LEVELS.join(", ")}` };
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

  // --- lmpDate ---
  if (body.lmpDate !== undefined && body.lmpDate !== null) {
    if (typeof body.lmpDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.lmpDate)) {
      return { valid: false, error: "lmpDate must be in YYYY-MM-DD format" };
    }
    const parsed = new Date(`${body.lmpDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { valid: false, error: "lmpDate must be a valid date" };
    }
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (parsed.getTime() > todayUtc) {
      return { valid: false, error: "lmpDate cannot be in the future" };
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

  // --- nickname ---
  if (body.nickname !== undefined && body.nickname !== null) {
    if (typeof body.nickname !== "string") {
      return { valid: false, error: "nickname must be a string" };
    }
    if (body.nickname.trim().length > 40) {
      return { valid: false, error: "nickname must be 40 characters or fewer" };
    }
  }

  return { valid: true };
}
