/**
 * bloomie-safety.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Input / output safety layer for the Bloomie chat engine.
 *
 * This module is rule-based and deterministic — it contains no AI calls,
 * no LLM interaction, and no creative response generation.
 *
 * Responsibilities
 * ────────────────
 * 1. sanitizeInput(text)          — clean raw user text before it enters routing
 * 2. classifyInputSafety(text)    — detect and block unsafe request categories
 * 3. sanitizeBotLine(text)        — verify bot response lines are safe to render
 * 4. isHtmlPayloadAuthorized(meta) — enforce the meta.html bypass whitelist
 *
 * Integration points in assistant.js
 * ────────────────────────────────────
 *   A. After input capture (line ~770):
 *      const safeText = sanitizeInput(rawText);
 *      const safety   = classifyInputSafety(safeText);
 *      if (safety.blocked) { ... show safety.response; return; }
 *
 *   B. Inside say(), before pushMsg (line ~2374):
 *      const safeLine = sanitizeBotLine(t);
 *
 *   C. Inside render(), meta.html guard (line ~2762):
 *      if (m.meta?.html && !isHtmlPayloadAuthorized(m.meta)) { ... }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum characters accepted from a single user message. */
const MAX_INPUT_LENGTH = 800;

/**
 * Token set that marks a message object as authorised to carry raw HTML.
 * Set via authorizeHtmlPayload() exclusively inside buildSummaryCard().
 * Any other path attempting meta.html = true is rejected at render time.
 */
const HTML_AUTH_TOKEN = Symbol("bloomie_html_authorized");

// ─────────────────────────────────────────────────────────────────────────────
// 1. Input sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * sanitizeInput(rawText) → string
 *
 * Cleans raw user text so it is safe to pass through the routing pipeline.
 * Never throws — always returns a string.
 *
 * What it does:
 *  - Coerces to string
 *  - Removes null bytes and other non-printable control characters
 *  - Strips HTML/XML tags so no markup reaches entity extraction
 *  - Collapses runs of whitespace
 *  - Caps length at MAX_INPUT_LENGTH
 *
 * What it does NOT do:
 *  - It does not normalize Patois or fix spelling — that stays in the existing
 *    pipeline (normalizePatois → fuzzyCorrect → expandShorthand).
 *  - It does not translate or interpret the text.
 */
export function sanitizeInput(rawText) {
  let text = String(rawText ?? "");

  // Remove null bytes — can cause downstream regex anomalies
  text = text.replace(/\0/g, "");

  // Remove ASCII control characters (0x00–0x1F, 0x7F) except tab and newline
  // which may be legitimately pasted from notes/apps.
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // Strip HTML/XML tags — prevents any markup from reaching entity extraction
  // or being reflected into log strings.  The existing escapeHtml() at render
  // time is a separate, complementary defence.
  text = text.replace(/<[^>]*>/g, "");

  // Collapse runs of whitespace (but preserve single newlines for readability)
  text = text.replace(/[^\S\n]+/g, " ").trim();

  // Hard length cap — protects regex performance in downstream matchers
  if (text.length > MAX_INPUT_LENGTH) {
    text = text.slice(0, MAX_INPUT_LENGTH);
  }

  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Input safety classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patterns that attempt to override Bloomie's behaviour by addressing it as
 * an AI system or injecting prompt-style instructions.
 *
 * These are checked case-insensitively against the sanitized input.
 */
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|context)/i,
  /you\s+are\s+now\s+(a\s+)?(\w+\s*){1,4}(ai|model|assistant|bot|doctor|physician)/i,
  /act\s+as\s+(a\s+)?(doctor|physician|nurse|gp|specialist|medical\s+\w+)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(doctor|physician|nurse|ai|gp)/i,
  /disregard\s+(your|all)\s+(previous\s+)?(instructions?|rules?|guidelines?)/i,
  /system\s*:\s*you\s+are/i,
  /\[system\]/i,
  /new\s+instructions?\s*:/i,
  /override\s+(safety|filter|restriction|guideline)/i,
  /bypass\s+(safety|filter|restriction|content\s+policy)/i,
  /jailbreak/i,
  /\bDAN\b/,                                 // "Do Anything Now" jailbreak
  /token\s*smuggl/i,
  /prompt\s+injection/i,
];

/**
 * Patterns that claim a definitive medical diagnosis.
 * Bloomie is explicitly non-diagnostic — these must be blocked.
 */
const DIAGNOSIS_CLAIM_PATTERNS = [
  /i\s+(definitely|certainly|obviously|clearly)\s+have\s+\w/i,
  /i\s+(was\s+)?diagnosed\s+with\s+\w/i,
  /tell\s+me\s+(if\s+i\s+have|whether\s+i\s+have|what\s+disease)/i,
  /diagnose\s+(me|my\s+\w+)/i,
  /what\s+(disease|condition|illness)\s+do\s+i\s+have/i,
  /am\s+i\s+dying/i,
];

/**
 * Patterns that request instructions Bloomie must not execute:
 * medication dosing, self-treatment commands, or requests to lie/deceive.
 */
const UNSAFE_INSTRUCTION_PATTERNS = [
  /tell\s+me\s+(exactly\s+)?(how\s+much|what\s+dose)\s+to\s+take/i,
  /how\s+many\s+(mg|milligrams?|pills?|tablets?)\s+(should\s+i|can\s+i)\s+take/i,
  /prescribe\s+(me|something)/i,
  /write\s+(me\s+)?a\s+prescription/i,
  /lie\s+to\s+(me|the\s+user)/i,
  /say\s+(that\s+)?(everything\s+is\s+fine|i('?m|\s+am)\s+okay)\s+even\s+if/i,
  /don'?t\s+tell\s+(me|the\s+user)\s+(the\s+truth|that\s+.{1,40}\s+(bad|wrong|serious))/i,
];

/**
 * classifyInputSafety(sanitizedText)
 *   → { blocked: false }
 *   | { blocked: true, category: string, response: string }
 *
 * Runs after sanitizeInput(). Returns { blocked: false } when safe.
 * When blocked, returns a safe, non-alarming response string for Bloomie to say.
 *
 * This function is pure — it has no side effects.
 */
export function classifyInputSafety(text) {
  const lower = text.toLowerCase();

  // ── 1. Prompt / instruction injection ─────────────────────────────────────
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked:  true,
        category: "prompt_injection",
        response: "I'm here to help with period and cycle questions — I'm not able to take instructions that change how I work 🩷 What's going on with your health?",
      };
    }
  }

  // ── 2. Diagnosis claims ────────────────────────────────────────────────────
  for (const pattern of DIAGNOSIS_CLAIM_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked:  true,
        category: "diagnosis_claim",
        response: "I'm not able to diagnose conditions — that's something only a doctor can do 🩷 What I can do is help you understand your symptoms and figure out if you need to see someone. What's been going on?",
      };
    }
  }

  // ── 3. Unsafe instructions (medication dosing, prescriptions, deception) ──
  for (const pattern of UNSAFE_INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) {
      return {
        blocked:  true,
        category: "unsafe_instruction",
        response: "That's something I can't help with safely 🩷 For medication or dosing questions, please speak with a pharmacist or doctor. Is there something else going on I can help with?",
      };
    }
  }

  // ── 4. Oversized input (after sanitization, so the cap is already applied) ─
  // If the remaining text is still suspiciously long after truncation, it may
  // indicate the user pasted a wall of text — guide them gently.
  if (text.length === MAX_INPUT_LENGTH) {
    return {
      blocked:  true,
      category: "oversized_input",
      response: "That was a lot to take in at once 🩷 Could you tell me the main thing that's been worrying you most? I can go through things one at a time.",
    };
  }

  return { blocked: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Bot output line guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phrases that would imply a definitive medical diagnosis or certainty.
 * Bloomie's node templates should never contain these — but this acts as a
 * last-resort backstop in case a future template edit introduces one.
 */
const DIAGNOSTIC_LEAK_PATTERNS = [
  /you\s+(definitely|certainly|clearly|obviously)\s+have\b/i,
  /this\s+(is|means)\s+you\s+have\b/i,
  /\byou\s+are\s+pregnant\b/i,           // Bloomie must say "could be" / "worth testing"
  /\byou\s+have\s+(pcos|endometriosis|fibroids)\b/i,
  /\bthis\s+is\s+(definitely|certainly)\s+(cancer|a\s+tumou?r)\b/i,
];

/**
 * sanitizeBotLine(text) → string
 *
 * Verifies a bot response line before it is passed to pushMsg().
 * - If the line contains a diagnostic claim, replaces it with a safe fallback.
 * - Strips any HTML tags that have no business in a plain-text bot bubble
 *   (protects against accidental raw HTML in a template string).
 * - Never throws — always returns a string.
 *
 * Note: this is a safety net, not a template validator. Node templates in
 * bloomie-nodes.js are the source of truth; this catches regressions.
 */
export function sanitizeBotLine(text) {
  if (typeof text !== "string") return "";

  // Strip any stray HTML tags from bot template strings.
  // Legitimate structured HTML goes through the meta.html path with
  // buildSummaryCard(), which pre-escapes all content. Plain bot lines
  // should never contain raw tags.
  let safe = text.replace(/<[^>]*>/g, "");

  // Check for diagnostic leaks and substitute a safe fallback line.
  for (const pattern of DIAGNOSTIC_LEAK_PATTERNS) {
    if (pattern.test(safe)) {
      console.warn("[bloomie-safety] Diagnostic phrase detected in bot line — substituting fallback.", safe);
      return "I want to make sure I'm giving you accurate information — this is something worth discussing with a doctor or nurse 🩷";
    }
  }

  return safe;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. meta.html authorization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * authorizeHtmlPayload(meta) → meta
 *
 * Call this inside buildSummaryCard() (the only legitimate source of raw HTML
 * in bot messages) when constructing the meta object for pushMsg().
 *
 * Sets the Symbol token that isHtmlPayloadAuthorized() checks at render time.
 * The Symbol is non-enumerable and cannot be JSON-round-tripped or forged
 * from outside this module.
 *
 * Usage:
 *   pushMsg("bot", buildSummaryCard(), authorizeHtmlPayload({ html: true }));
 */
export function authorizeHtmlPayload(meta = {}) {
  return { ...meta, [HTML_AUTH_TOKEN]: true };
}

/**
 * isHtmlPayloadAuthorized(meta) → boolean
 *
 * Returns true ONLY when the meta object was created via authorizeHtmlPayload().
 * Call this inside render() before allowing m.meta.html to bypass escapeHtml().
 *
 * Usage in render():
 *   const renderRaw = m.meta?.html && isHtmlPayloadAuthorized(m.meta);
 *   const content   = renderRaw ? m.text : escapeHtml(m.text).replaceAll("\n", "<br>");
 */
export function isHtmlPayloadAuthorized(meta) {
  return meta != null && meta[HTML_AUTH_TOKEN] === true;
}
