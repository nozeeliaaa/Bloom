/**
 * src/utils/auditLog.js
 *
 * Writes a metadata-only audit trail to auditLogs/{logId}.
 * Never stores sensitive content — only actions, actors, and changed field names.
 *
 * Usage:
 *   import { logAudit } from "../utils/auditLog.js";
 *
 *   await logAudit({
 *     actorUid:   req.user.uid,
 *     actorRole:  req.user.role,
 *     action:     "CONSENT_APPROVED",
 *     entityType: "consent",
 *     entityId:   consentId,
 *     targetUid:  teenUid,
 *     meta: { changedFields: ["status"] }
 *   });
 */

import { db } from "../firebaseAdmin.js";
import admin from "firebase-admin";

// ─── Action constants (import these in routes instead of using raw strings) ───
export const AUDIT_ACTIONS = {
  // User
  YOB_SET:              "YOB_SET",
  PROFILE_UPDATED:      "PROFILE_UPDATED",
  ACCOUNT_DISABLED:     "ACCOUNT_DISABLED",
  ACCOUNT_ENABLED:      "ACCOUNT_ENABLED",
  ROLE_CHANGED:         "ROLE_CHANGED",

  // Consent
  CONSENT_REQUESTED:    "CONSENT_REQUESTED",
  CONSENT_APPROVED:     "CONSENT_APPROVED",
  CONSENT_DENIED:       "CONSENT_DENIED",
  CONSENT_REVOKED:      "CONSENT_REVOKED",

  // Exports
  EXPORT_REQUESTED:     "EXPORT_REQUESTED",
  EXPORT_DOWNLOADED:    "EXPORT_DOWNLOADED",

  // Admin actions
  ADMIN_VIEWED_USER:    "ADMIN_VIEWED_USER",
  CLINIC_ADDED:         "CLINIC_ADDED",
  CLINIC_UPDATED:       "CLINIC_UPDATED",
  CLINIC_DELETED:       "CLINIC_DELETED",
  PAMPHLET_ADDED:       "PAMPHLET_ADDED",
  PAMPHLET_UPDATED:     "PAMPHLET_UPDATED",
  PAMPHLET_DELETED:     "PAMPHLET_DELETED",

  // Preferences
  PREFERENCES_UPDATED:  "PREFERENCES_UPDATED",
};

/**
 * Write an audit log entry.
 *
 * @param {object} params
 * @param {string}  params.actorUid    - UID of the user performing the action
 * @param {string}  params.actorRole   - Role of the actor ("user"|"teen"|"guardian"|"admin")
 * @param {string}  params.action      - Action key (use AUDIT_ACTIONS constants)
 * @param {string}  params.entityType  - Type of entity affected ("user","consent","export","clinic",etc.)
 * @param {string}  [params.entityId]  - ID of the affected entity (optional)
 * @param {string}  [params.targetUid] - UID of the affected user (optional, for admin actions)
 * @param {object}  [params.meta]      - Extra metadata — NO sensitive content
 *   @param {string[]} [params.meta.changedFields] - Field names that changed (no values)
 *   @param {string}   [params.meta.reasonCode]    - Optional reason code
 */
export async function logAudit({
  actorUid,
  actorRole,
  action,
  entityType,
  entityId = null,
  targetUid = null,
  meta = {},
}) {
  // Silently skip if core fields are missing — never crash a route over logging
  if (!actorUid || !action || !entityType) {
    console.warn("[auditLog] Skipped — missing required fields:", { actorUid, action, entityType });
    return;
  }

  try {
    const entry = {
      actorUid,
      actorRole:  actorRole || "user",
      action,
      entityType,
      entityId:   entityId  || null,
      targetUid:  targetUid || null,
      meta:       sanitizeMeta(meta),
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("auditLogs").add(entry);
  } catch (err) {
    // Log to console but never throw — audit failure should not break the request
    console.error("[auditLog] Failed to write audit entry:", err.message);
  }
}

/**
 * Strips any potentially sensitive values from meta.
 * Only allows: changedFields (array of strings) and reasonCode (string).
 */
function sanitizeMeta(meta = {}) {
  const safe = {};

  if (Array.isArray(meta.changedFields)) {
    safe.changedFields = meta.changedFields
      .filter(f => typeof f === "string")
      .slice(0, 20); // cap at 20 field names
  }

  if (typeof meta.reasonCode === "string") {
    safe.reasonCode = meta.reasonCode.slice(0, 100);
  }

  return safe;
}