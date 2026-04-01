/**
 * bloomie-logger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fire-and-forget safety event logger.
 *
 * Writes structured events to POST /api/bloomie-safety-log.
 * Never throws — logging must never interrupt the chat flow.
 * Silently skips if user is not in account mode (not signed in).
 *
 * Three event types:
 *   urgent_trigger  — inferRoute / keyword router resolved to HEAVY_URGENT
 *   oos_fallback    — user input fell to OOS handler (no health route matched)
 *   escalation      — HEAVY_URGENT node actually rendered ("seek care" shown)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getIdToken } from "./auth.js";
import { isAccountMode } from "./mode.js";

const API_BASE = window.BLOOM_API_BASE || "";

export function logSafetyEvent(type, payload = {}) {
  // Skip logging for anonymous users — no account, no record
  if (!isAccountMode()) return;

  // Kick off async without awaiting or propagating errors
  _send(type, payload).catch(() => {});
}

async function _send(type, payload) {
  const token = await getIdToken();
  if (!token) return;

  const body = {
    type,
    ...sanitize(payload),
  };

  await fetch(`${API_BASE}/bloomie-safety-log`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function sanitize(payload) {
  const out = {};
  if (typeof payload.input    === "string") out.input    = payload.input.slice(0, 300);
  if (typeof payload.route    === "string") out.route    = payload.route;
  if (typeof payload.reason   === "string") out.reason   = payload.reason;
  if (typeof payload.category === "string") out.category = payload.category;
  if (typeof payload.fromNode === "string") out.fromNode = payload.fromNode;
  if (payload.urgencyFlag     !== undefined) out.urgencyFlag = !!payload.urgencyFlag;
  if (Array.isArray(payload.symptoms))            out.symptoms              = payload.symptoms.slice(0, 20);
  if (payload.containsHealthKeywords !== undefined) out.containsHealthKeywords = !!payload.containsHealthKeywords;
  return out;
}
