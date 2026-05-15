// src/validators/validateCycleLog.js

const VALID_FLOW_LEVELS = [0, 1, 2, 3]; // 0=none, 1=light, 2=medium, 3=heavy
const VALID_BIOMETRIC_LEVELS = ["low", "moderate", "high", "very_high"];

function normalizeBiometricLevel(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isInteger(value)) {
    return VALID_BIOMETRIC_LEVELS[value - 1] ?? null;
  }

  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return VALID_BIOMETRIC_LEVELS.includes(normalized) ? normalized : null;
}

/**
 * Validates the body of a PUT /cycle-logs/:dateKey request.
 * Returns { valid: true } or { valid: false, error: string }
 */
export function validateCycleLog(body) {
  // --- periodDay: must be a non-negative integer if present ---
  if (body.periodDay !== undefined && body.periodDay !== null) {
    const pd = Number(body.periodDay);
    if (!Number.isInteger(pd) || pd < 0) {
      return { valid: false, error: "periodDay must be a non-negative integer" };
    }
    // Sanity cap: no cycle day above 60
    if (pd > 60) {
      return { valid: false, error: "periodDay cannot exceed 60" };
    }
  }

  // --- flowLevel: must be within valid range if present ---
  if (body.flowLevel !== undefined && body.flowLevel !== null) {
    const fl = Number(body.flowLevel);
    if (!VALID_FLOW_LEVELS.includes(fl)) {
      return {
        valid: false,
        error: `flowLevel must be one of: ${VALID_FLOW_LEVELS.join(", ")} (0=none, 1=light, 2=medium, 3=heavy)`,
      };
    }
  }

  // --- sleepScore: integer 1..10 if present ---
  if (body.sleepScore !== undefined && body.sleepScore !== null && body.sleepScore !== "") {
    const sleep = Number(body.sleepScore);
    if (!Number.isInteger(sleep) || sleep < 1 || sleep > 10) {
      return { valid: false, error: "sleepScore must be an integer from 1 to 10" };
    }
  }

  // --- stressLevel: low|moderate|high|very_high if present ---
  if (body.stressLevel !== undefined && body.stressLevel !== null && body.stressLevel !== "") {
    if (!normalizeBiometricLevel(body.stressLevel)) {
      return {
        valid: false,
        error: `stressLevel must be one of: ${VALID_BIOMETRIC_LEVELS.join(", ")}`,
      };
    }
  }

  // --- activityLevel: low|moderate|high|very_high if present ---
  if (body.activityLevel !== undefined && body.activityLevel !== null && body.activityLevel !== "") {
    if (!normalizeBiometricLevel(body.activityLevel)) {
      return {
        valid: false,
        error: `activityLevel must be one of: ${VALID_BIOMETRIC_LEVELS.join(", ")}`,
      };
    }
  }

  // --- booleans ---
  if (body.hadSex !== undefined && typeof body.hadSex !== "boolean") {
    return { valid: false, error: "hadSex must be a boolean" };
  }

  if (body.contraceptionUsed !== undefined && typeof body.contraceptionUsed !== "boolean") {
    return { valid: false, error: "contraceptionUsed must be a boolean" };
  }

  // --- notes: string, max 500 chars ---
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      return { valid: false, error: "notes must be a string" };
    }
    if (body.notes.length > 500) {
      return { valid: false, error: "notes cannot exceed 500 characters" };
    }
  }

  return { valid: true };
}
