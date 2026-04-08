/**
 * bloomie-logger.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fire-and-forget safety + analytics event loggers.
 *
 * logSafetyEvent   — writes to POST /api/bloomie-safety-log (auth required)
 *   Three safety event types:
 *     urgent_trigger  — inferRoute / keyword router resolved to HEAVY_URGENT
 *     oos_fallback    — user input fell to OOS handler (no health route matched)
 *     escalation      — HEAVY_URGENT node actually rendered ("seek care" shown)
 *
 * logAnalyticsEvent — writes to POST /api/bloomie/analytics (auth optional)
 *   Ten analytics event types:
 *     route_matched        — HIGH confidence route selected
 *     route_clarification  — MEDIUM confidence, soft confirmation shown
 *     route_fallback       — CONFIDENCE_FALLBACK triggered (repeat low-conf)
 *     route_no_match       — LOW confidence, NARROWING shown
 *     urgency_escalation   — any _URGENT node reached
 *     oos_event            — OOS handler fired
 *     oos_repair           — NARROWING triggered by OOS streak
 *     emotion_classified   — tone resolved for a message
 *     session_end          — beforeunload fired
 *     memory_recall_used   — backgroundContext or entityHistory seeded from storage
 *
 * Neither function ever throws — logging must never interrupt the chat flow.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getIdToken } from "./auth.js";
import { isAccountMode } from "./mode.js";
import { isBloomieDebugEnabled } from "./bloom-storage.js";

const API_BASE = (typeof window !== "undefined" && window.BLOOM_API_BASE) || "";

// ── Timeout constants ─────────────────────────────────────────────────────────
// Safety log is given a slightly longer window; analytics is capped tighter.
const SAFETY_LOG_TIMEOUT_MS  = 5000;
const ANALYTICS_TIMEOUT_MS   = 2000;

// ── fetchWithTimeout ──────────────────────────────────────────────────────────
//
// Wraps fetch() with a hard deadline that *actually cancels* the in-flight
// request when the deadline fires.  The old Promise.race() approach let the
// underlying connection continue to consume resources and hold a TCP slot open
// even after the caller had already moved on — only the JS-side Promise was
// settled, not the network request.
//
// How it works:
//   1. An AbortController is created and its signal is passed to fetch().
//   2. A setTimeout schedules controller.abort() at the deadline.
//   3. .finally() always clears the timer — whether the fetch resolved,
//      rejected, or was aborted — so no dangling timers outlive fast responses.
//   4. If abort fires first, fetch() rejects with a DOMException whose
//      .name === "AbortError".  All callers wrap calls in .catch(() => {})
//      so this is silently swallowed — it never surfaces to the user.
//
// Failure taxonomy after this change:
//   - Timeout:         AbortController fires → fetch rejects AbortError → caught
//   - Network failure: fetch rejects TypeError → caught
//   - HTTP non-2xx:    fetch resolves (response.ok === false) → handled per call
//   - AbortController unavailable (ancient runtime): graceful degradation to
//     plain fetch with no timeout — acceptable for best-effort logging.
//
function fetchWithTimeout(url, options, timeoutMs) {
  let controller, timerId;
  try {
    controller = new AbortController();
    timerId = setTimeout(() => controller.abort(), timeoutMs);
  } catch {
    // AbortController not available — fall back to plain fetch with no timeout.
    return fetch(url, options);
  }
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timerId));
}

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

  await fetchWithTimeout(
    `${API_BASE}/api/bloomie-safety-log`,
    {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    SAFETY_LOG_TIMEOUT_MS,
  );
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

// ─── Analytics event logger ──────────────────────────────────────────────────

/**
 * Strips identifying details from raw input text before it leaves the client.
 * Lowercases, replaces all digit sequences with [NUM], replaces month names
 * with [DATE], and truncates to 120 chars.
 */
export function anonymise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\d+/g, "[NUM]")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, "[DATE]")
    .slice(0, 120);
}

/**
 * Snapshot of conversation state attached to every analytics event.
 * ctx may be null (e.g. session_end fired after ctx teardown) — all fields
 * default gracefully.
 */
export function buildSessionMeta(ctx) {
  return {
    sessionDepth:            ctx?.conversationProfile?.sessionDepth ?? 0,
    currentState:            ctx?.state                             ?? null,
    confidenceTier:          ctx?.lastConfidence?.tier              ?? null,
    toneSource:              ctx?.toneResult?.source                ?? null,
    tone:                    ctx?.toneResult?.tone ?? ctx?.currentTone ?? null,
    confidenceFallbackCount: ctx?.confidenceFallbackCount           ?? 0,
    urgency:                 ctx?.riskLevel                         ?? null,
    oosStreakCount:          ctx?.oosStreakCount                     ?? 0,
    isMinor:                 ctx?.isMinor                           ?? false,
    isAnon:                  ctx?.isAnon                            ?? false,
  };
}

function sanitizeAnalytics(payload) {
  const out = {};
  if (typeof payload.route         === "string") out.route         = payload.route.slice(0, 80);
  if (typeof payload.reason        === "string") out.reason        = payload.reason.slice(0, 120);
  if (typeof payload.input         === "string") out.input         = anonymise(payload.input);
  if (typeof payload.tone          === "string") out.tone          = payload.tone.slice(0, 40);
  if (typeof payload.source        === "string") out.source        = payload.source.slice(0, 40);
  if (typeof payload.type          === "string") out.type          = payload.type.slice(0, 40);
  if (typeof payload.primaryIntent === "string") out.primaryIntent = payload.primaryIntent.slice(0, 40);
  if (typeof payload.fallbackCount === "number") out.fallbackCount = payload.fallbackCount;
  if (typeof payload.streak        === "number") out.streak        = payload.streak;
  if (typeof payload.sessionDepth  === "number") out.sessionDepth  = payload.sessionDepth;
  return out;
}

/**
 * Fire-and-forget analytics logger.
 * Auth is optional — anonymous users are tracked without a uid.
 * Cancels the request via AbortController after ANALYTICS_TIMEOUT_MS (2000 ms)
 * so a slow network never holds open a connection beyond that window.
 */
export function logAnalyticsEvent(eventType, payload = {}, ctx = null) {
  _sendAnalytics(eventType, payload, ctx).catch(() => {});
}

// ─── Debug console logger ─────────────────────────────────────────────────────
//
// Gated on a localStorage flag — zero output in production by default.
// Enable from the browser DevTools console:
//   localStorage.setItem("BLOOMIE_DEBUG", "true")   then refresh
//   localStorage.removeItem("BLOOMIE_DEBUG")          to disable
//
// All Bloomie routing diagnostics go through bloomieDebug() so they can be
// toggled or removed from one place.  Each call produces one console line,
// filterable by "[Bloomie:" in the DevTools console search box.
//
// Categories and what they record:
//   "route"            — route chosen, source (inferRoute / keyword_router / intent_ai), reason
//   "confidence"       — tier (high/medium/low), primary intent, signal score
//   "ai"               — intent AI source, route chosen, whether it changed routing
//   "fallback"         — OOS or START_MENU fallback and why rules gave up
//   "unhandled_health" — health-related message that fell to generic OOS reply

const _DEBUG =
  typeof window !== "undefined" &&
  isBloomieDebugEnabled();

const _CAT_STYLES = {
  route:            "color:#6366f1;font-weight:bold",  // indigo  — routing decision
  confidence:       "color:#0ea5e9;font-weight:bold",  // sky     — confidence tier
  ai:               "color:#8b5cf6;font-weight:bold",  // violet  — AI layer result
  fallback:         "color:#f59e0b;font-weight:bold",  // amber   — rule fallback / OOS
  unhandled_health: "color:#ef4444;font-weight:bold",  // red     — health msg dropped
  diagnostic:       "color:#db2777;font-weight:bold",  // pink    — internal diagnostics
};

/**
 * bloomieDebug(category, fields)
 *
 * Structured debug logger for Bloomie routing diagnostics.
 * Only emits when localStorage.BLOOMIE_DEBUG === "true".
 *
 * Usage:
 *   bloomieDebug("route", { route: "LATE_INTRO", source: "inferRoute" });
 *
 * @param {"route"|"confidence"|"ai"|"fallback"|"unhandled_health"} category
 * @param {Record<string, *>} fields  Key/value pairs printed inline.
 */
export function bloomieDebug(category, fields = {}) {
  if (!_DEBUG) return;
  const style = _CAT_STYLES[category] ?? "color:#6b7280;font-weight:bold";
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}:${Array.isArray(v) ? `[${v.join(",")}]` : v}`)
    .join("  ");
  console.log(`%c[Bloomie:${category}]%c ${parts}`, style, "color:inherit");
}

// ─── Internal diagnostic logger ───────────────────────────────────────────────
//
// Structured events for silent fallback points inside Bloomie.
// Never surfaces details to the user — purely internal observability.
//
// Console output is gated on the same BLOOMIE_DEBUG localStorage flag as
// bloomieDebug().  Backend storage fires for every call so failures are
// visible post-session even without the flag.
//
// Event schema (all fields optional except `event`):
//   event          — one of the DIAGNOSTIC_EVENT_TYPES below
//   ts             — Unix ms (auto-set)
//   module         — source file (e.g. "bloomie-tone", "bloomie-intent", "db")
//   stage          — function or step within the module
//   confidence     — rule confidence tier if relevant
//   fallbackTarget — what Bloomie fell back to (e.g. "rule_tone", "rule_routing")
//   reason         — non-sensitive error description (≤120 chars, never raw user text)
//
// Diagnostic event catalogue:
//   ai_timeout           — AI call exceeded the hard timeout
//   ai_parse_error       — AI returned unparseable / malformed JSON
//   ai_unavailable       — Backend AI endpoint returned non-2xx or is unconfigured
//   ai_invalid_response  — AI returned valid JSON but invalid field values
//   ai_override          — AI disagreed with rule result (AI took precedence)
//   fallback_to_rules    — AI failed/null; rule-based path used instead
//   vague_input_no_ai_assist — Low-confidence but no health keywords; AI skipped
//   routing_low_confidence   — Rule layer returned low-confidence tier
//   cache_read_failed    — localStorage or Firestore read silently failed
//   cache_write_failed   — localStorage or Firestore write silently failed
//   backend_unavailable  — A backend endpoint returned non-2xx unexpectedly
//   memory_load_failed   — Bloomie memory could not be loaded for the session
//   profile_sync_failed  — User profile could not be loaded or saved
//   settings_sync_failed — User settings could not be synced

/**
 * bloomieDiagnostic(event, fields, ctx?)
 *
 * Emit a structured internal diagnostic event.
 * - Console output gated on BLOOMIE_DEBUG (same as bloomieDebug).
 * - Backend analytics call fires always so failures are visible post-session.
 * - ctx is optional; pass it when available for richer session meta.
 * - Never include raw user health content in fields.reason or any field.
 *
 * @param {string}           event  - Diagnostic event name (see catalogue above)
 * @param {Record<string,*>} fields - Diagnostic context (non-sensitive)
 * @param {object|null}      [ctx]  - Session context (optional)
 */
export function bloomieDiagnostic(event, fields = {}, ctx = null) {
  // Structured console output (debug-gated)
  bloomieDebug("diagnostic", { event, ...fields });

  // Fire to analytics backend — fire-and-forget, never blocks
  logAnalyticsEvent(event, {
    source: typeof fields.module        === "string" ? fields.module.slice(0, 40)        : undefined,
    type:   typeof fields.stage         === "string" ? fields.stage.slice(0, 40)         : undefined,
    reason: typeof fields.reason        === "string" ? fields.reason.slice(0, 120)       : undefined,
    route:  typeof fields.fallbackTarget === "string" ? fields.fallbackTarget.slice(0, 80) : undefined,
    tone:   typeof fields.confidence    === "string" ? fields.confidence.slice(0, 40)    : undefined,
  }, ctx);
}

async function _sendAnalytics(eventType, payload, ctx) {
  const body = {
    eventType,
    payload: sanitizeAnalytics(payload),
    meta:    buildSessionMeta(ctx),
    ts:      Date.now(),
  };

  const token = isAccountMode() ? await getIdToken().catch(() => null) : null;
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  await fetchWithTimeout(
    `${API_BASE}/api/bloomie/analytics`,
    {
      method:  "POST",
      headers,
      body:    JSON.stringify(body),
    },
    ANALYTICS_TIMEOUT_MS,
  );
}
