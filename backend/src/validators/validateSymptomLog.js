import { db } from "../firebaseAdmin.js";

export async function validateSymptomItem(item, index = 0) {
  if (!item || typeof item !== "object") {
    return { valid: false, error: `items[${index}] must be an object` };
  }

  if (!item.code || typeof item.code !== "string") {
    return { valid: false, error: `items[${index}].code is required and must be a string` };
  }

  const code = item.code.trim().toUpperCase();

  const catalogDoc = await db.collection("symptomCatalog").doc(code).get();
  if (!catalogDoc.exists) {
    return { valid: false, error: `items[${index}].code "${code}" is not a valid symptom key` };
  }

  const severity = Number(item.severity);
  if (!Number.isInteger(severity) || severity < 0 || severity > 5) {
    return { valid: false, error: `items[${index}].severity must be an integer between 0 and 5` };
  }

  let note = "";
  if (item.note !== undefined) {
    if (typeof item.note !== "string") {
      return { valid: false, error: `items[${index}].note must be a string` };
    }
    note = item.note.trim().slice(0, 200);
  }

  return {
    valid: true,
    normalized: {
      code,
      severity,
      note,
    },
    catalogData: catalogDoc.data(),
  };
}