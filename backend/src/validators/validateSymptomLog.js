// src/validators/validateSymptomLog.js
import { db } from "../firebaseAdmin.js";

/**
 * Validates the body of a POST /symptoms request.
 * Checks types, ranges, and that the symptomKey exists in the catalog.
 * Returns { valid: true } or { valid: false, error: string }
 */
export async function validateSymptomLog(body) {
  // --- symptomKey: required ---
  if (!body.symptomKey || typeof body.symptomKey !== "string") {
    return { valid: false, error: "symptomKey is required and must be a string" };
  }

  const key = body.symptomKey.trim().toUpperCase();

  // --- symptomKey must exist in the catalog ---
  const catalogDoc = await db.collection("symptomCatalog").doc(key).get();
  if (!catalogDoc.exists) {
    return { valid: false, error: `Unknown symptomKey: "${key}". Must match a catalog entry.` };
  }

  // --- severity: required, must be 0-5 integer ---
  if (body.severity === undefined || body.severity === null) {
    return { valid: false, error: "severity is required" };
  }

  const severity = Number(body.severity);
  if (!Number.isInteger(severity) || severity < 0 || severity > 5) {
    return { valid: false, error: "severity must be an integer between 0 and 5" };
  }

  // --- date: required, must be a valid YYYY-MM-DD string ---
  if (!body.date || typeof body.date !== "string") {
    return { valid: false, error: "date is required and must be a string (YYYY-MM-DD)" };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(body.date)) {
    return { valid: false, error: "date must be in YYYY-MM-DD format" };
  }

  const parsed = new Date(body.date);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: "date is not a valid calendar date" };
  }

  // --- notes: optional string, max 500 chars ---
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") {
      return { valid: false, error: "notes must be a string" };
    }
    if (body.notes.length > 500) {
      return { valid: false, error: "notes cannot exceed 500 characters" };
    }
  }

  // Return the normalized key so the route doesn't need to re-clean it
  return { valid: true, normalizedKey: key, catalogData: catalogDoc.data() };
}
