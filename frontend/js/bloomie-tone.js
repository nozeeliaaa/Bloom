/**
 * bloomie-tone.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Hybrid two-layer emotion detection for Bloomie.
 *
 * Layer 1 - rule-based (synchronous, always runs):
 *   detectToneWithConfidence(text)  → { tone, confidence, signals, hasUnknownTokens }
 *
 * Layer 2 - AI-assisted (async, 800 ms hard timeout):
 *   classifyEmotionAI(rawInput, ruleResult) → { confirms, tone, intensity, subtext } | null
 *
 * Combined resolver (only export assistant.js calls):
 *   resolveTone(rawInput, ctx) → { tone, intensity, subtext, source }
 *
 * Source values:
 *   "rule+ai_confirmed" - high confidence rule result confirmed by AI
 *   "ai_primary"        - rule was low / had unknown tokens, AI took over
 *   "ai_override"       - AI disagreed with rule result
 *   "rule_only"         - AI call failed / timed out; rule tone used
 *
 * Hard rules:
 *   - AI writes ONLY to ctx.currentTone (via resolveTone return).
 *   - API failure = silent fallback; Bloomie behaves as today.
 *   - Never send conversation history to AI.
 *   - source field always present.
 *   - Tone behaviour never activates on first message (sessionDepth gate).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { normalizePatois } from "./bloomie-patois.js";

// ── Known vocabulary ──────────────────────────────────────────────────────────
// After normalizePatois() all Patois is mapped to English.  Any remaining token
// longer than 2 chars that is NOT in this set is flagged as hasUnknownTokens,
// driving confidence to "low" so the AI layer can interpret it instead.
const KNOWN_VOCAB = new Set([
  // Function words / pronouns
  "the","a","an","and","but","or","of","in","on","at","to","for","with","from",
  "by","as","that","this","which","what","when","how","if","its","it","he","she",
  "we","they","them","their","who","all","some","any","one","two","three","four",
  "five","six","seven","eight","nine","ten","am","is","was","are","be","been",
  "have","has","had","do","did","not","no","so","up","out","about","also",
  "still","even","then","than","too","just","like","really","very","bit","lot",
  "yes","yep","yeah","nope","true","false","ok","okay",

  // Common verbs
  "can","will","would","could","should","may","might","must","need","want",
  "going","see","know","think","say","come","go","make","look","use","find",
  "give","tell","feel","try","leave","put","mean","keep","let","seem","help",
  "show","hear","run","move","believe","hold","ask","getting","doing","looking",
  "trying","starting","happening","coming","feeling","thinking","wondering",
  "asking","having","been","dont","doesnt","cant","wont","shouldnt","wouldnt",
  "isnt","arent","wasnt","havent","hadnt","didnt","wasnt","wouldve","couldve",

  // Common adjectives / adverbs
  "bad","good","great","little","big","old","new","high","low","first","last",
  "long","small","large","next","early","young","few","real","best","free",
  "hard","right","left","strong","different","possible","sure","other","same",
  "short","normal","usual","regular","important","specific","possible","recent",

  // Health / menstrual vocab
  "period","periods","cycle","cycles","bleeding","bleed","blood","late","early",
  "pain","pains","cramp","cramps","heavy","light","spotting","spot","discharge",
  "pregnant","pregnancy","test","positive","negative","irregular","symptoms",
  "symptom","severe","mild","moderate","dizziness","dizzy","nausea","nauseated",
  "pelvic","uterus","ovary","ovaries","ovulation","hormone","hormones","flow",
  "clot","clots","spotty","lmp","weeks","days","months","day","week","month",
  "ago","today","now","time","date","year","years","morning","night","yesterday",

  // Emotional / psychological vocab
  "scared","worried","anxious","anxiety","stressed","stress","upset","tired",
  "exhausted","frustrated","angry","happy","calm","confused","unsure","nervous",
  "worry","afraid","fear","hope","sad","depressed","depression","mood","moods",
  "emotional","emotions","overwhelmed","helpless","hopeful","reassured","okay",
  "fine","alright","better","worse","much","more","less","bit","quite","pretty",

  // Social / chat tokens
  "lol","lmao","omg","fr","ugh","haha","bruh","bro","sis","bestie","ngl","tbh",
  "idk","idc","wait","what","wow","oh","hi","hey","hello","bye","thanks","thank",
  "please","sorry","me","my","you","your","him","his","her","our","their","its",

  // Deflecting phrases (individual tokens)
  "probably","nothing","serious","nevermind","matter","deal","maybe","perhaps",
  "just","asking","curious","ignore","scratch","fine","only","simply","anyway",

  // Numbers / time expressions (tokens that appear after normalization)
  "second","minute","hour","past","since","around","before","after","between",
  "during","while","twice","once","usually","sometimes","often","always","never",
  "within","until","already","yet","soon","eventually","recently","probably",

  // Words appended by INTENT_BOOSTERS in normalizePatois (always safe, internal)
  "stain","soaking","irritable","lightheaded","amenorrhea","missing","absent",
  "ttc","conceive","fertile","postpartum","breastfeeding","lifestyle","change",
  "weight","exercise","birth","control","pill","contraception","distress",
  "trying","ovulation","lifestyle","breastfeeding","birth","after",
]);

// ── Tone signal patterns ───────────────────────────────────────────────────────
// Each pattern is a separate entry so we can COUNT signal hits per category.
// Tested against normalizePatois() output (lowercase) so Patois is handled.

const TONE_SIGNALS = {
  distressed: [
    /\b(scared|freaking out|so scared)\b/,
    /\b(don'?t know what to do|mi nuh know wah fi do)\b/,
    /\b(worried|stress(?:ed)? out|a worry mi)\b/,
    /\b(frightened|terrified|panic(?:king)?)\b/,
    /\b(something(?:'s)? wrong|sumn wrong|feel(?:ing)? like something(?:'s)? wrong)\b/,
    /\b(help me|please help|i need help)\b/,
    /\b(upset|mi so upset)\b/,
    /\b(lost|confused and scared)\b/,
  ],
  anxious: [
    /\b(anxious|anxiety)\b/,
    /\b(nervous|on edge|uneasy)\b/,
    /\b(what if|what does this mean|could this be)\b/,
    /\b(should i be worried|is this normal|am i okay)\b/,
    /\b(overthinking|can'?t stop thinking)\b/,
    /\b(heart racing|heart is racing)\b/,
    /\b(just want(?:ing)? to know|just need(?:ing)? to know)\b/,
  ],
  frustrated: [
    /\b(again|still happening|why does this keep)\b/,
    /\b(every time|always|sick and tired|sick of this)\b/,
    /\b(this keeps|nuh stop|mi tired of)\b/,
    /\b(every single|not again|happening again)\b/,
    /\b(i give up|pointless|nothing works)\b/,
    /\b(nutten nuh work|mi done wid dis)\b/,
    // Bot-directed frustration / dismissal
    /\b(you can'?t help|you cant help|useless)\b/,
    /\b(you don'?t understand|you dont understand)\b/,
    /\b(whatever|nvm)\b/,
    /\b(this app is trash|this is useless)\b/,
    /\b(you r dumb|you are dumb|you'?re dumb)\b/,
  ],
  casual: [
    /\b(lol|lmao+|omg|fr)\b/,
    /\b(ugh+|haha+)\b/,
    /\b(no way|wait what)\b/,
    /\b(dead+|mi weak)\b/,
    /\b(bruh|bro\b|sis\b|bestie)\b/,
    /\b(ngl|tbh|idk|idc)\b/,
    /[\u{1F602}\u{1F923}]/u,
  ],
  deflecting: [
    /\b(it'?s probably nothing|probably nothing|nothing serious)\b/,
    /\b(never\s?mind|forget it|nevermind)\b/,
    /\b(doesn'?t matter|don'?t worry about it)\b/,
    /\b(i'?m fine,? just asking|just asking|just curious)\b/,
    /\b(not a big deal|no big deal|it'?s fine)\b/,
    /\b(ignore (?:that|me)|scratch that)\b/,
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// detectToneWithConfidence(text)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Rule-based tone detection with confidence scoring.
 *
 * Confidence rules:
 *   high   - exactly 1 tone category matches with 2+ signals
 *   medium - exactly 1 tone category matches with 1 signal
 *   low    - 0 matches, multi-tone (ambiguous), OR hasUnknownTokens
 *
 * @param  {string} text
 * @returns {{ tone: string, confidence: "high"|"medium"|"low", signals: object, hasUnknownTokens: boolean }}
 */
export function detectToneWithConfidence(text) {
  if (!text) {
    return { tone: "neutral", confidence: "low", signals: {}, hasUnknownTokens: false };
  }

  const normalized = normalizePatois(text);
  const t = normalized.toLowerCase();

  // Unknown-token check: after normalization, flag tokens > 2 chars not in KNOWN_VOCAB.
  // Strip apostrophes first so contractions ("don't" → "dont") match the vocab.
  const tokens = t.replace(/'/g, "").split(/\W+/).filter(s => s.length > 2);
  const hasUnknownTokens = tokens.some(tok => !KNOWN_VOCAB.has(tok));

  // Count signal hits per category
  const signals = {};
  for (const [tone, patterns] of Object.entries(TONE_SIGNALS)) {
    signals[tone] = patterns.filter(rx => rx.test(t)).length;
  }

  // Find categories that matched at all
  const positives = Object.entries(signals).filter(([, v]) => v > 0);
  const multiTone = positives.length >= 2;

  // Pick the top category (highest signal count)
  positives.sort((a, b) => b[1] - a[1]);
  const topEntry = positives[0];
  const tone = topEntry ? topEntry[0] : "neutral";
  const topCount = topEntry ? topEntry[1] : 0;

  let confidence;
  if (hasUnknownTokens || topCount === 0 || multiTone) {
    confidence = "low";
  } else if (topCount >= 2) {
    confidence = "high";
  } else {
    confidence = "medium"; // exactly 1 signal, unambiguous category
  }

  return { tone, confidence, signals, hasUnknownTokens };
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyEmotionAI(rawInput, ruleResult)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Stateless AI emotion classifier.
 *
 * - Model: claude-haiku-4-5-20251001, max_tokens: 60
 * - 800 ms hard timeout via AbortController
 * - Returns null silently on any failure (network error, timeout, parse error)
 * - Never sends conversation history
 *
 * @param  {string} rawInput
 * @param  {{ tone: string, confidence: string }} ruleResult
 * @returns {Promise<{ confirms: boolean, tone: string, intensity: string, subtext: string }|null>}
 */
export async function classifyEmotionAI(rawInput, ruleResult) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 800);

  try {
    const apiKey =
      typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env.VITE_ANTHROPIC_API_KEY ?? "")
        : "";

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 60,
        system: [
          "You are a single-message emotion classifier for a women's health chat app.",
          `Rule-based result: tone="${ruleResult.tone}", confidence="${ruleResult.confidence}".`,
          "Respond ONLY with a JSON object - no surrounding text, no markdown.",
          'Format: {"confirms":true,"tone":"distressed|anxious|frustrated|casual|deflecting|neutral","intensity":"high|medium|low","subtext":"<one short phrase or none>"}',
        ].join(" "),
        messages: [{ role: "user", content: rawInput }],
      }),
    });

    clearTimeout(timeoutId);
    if (!resp.ok) return null;

    const data = await resp.json();
    const raw = data?.content?.[0]?.text?.trim() ?? "";
    const parsed = JSON.parse(raw);

    if (typeof parsed.confirms !== "boolean" || typeof parsed.tone !== "string") {
      return null;
    }
    return {
      confirms:  Boolean(parsed.confirms),
      tone:      String(parsed.tone),
      intensity: String(parsed.intensity ?? "medium"),
      subtext:   String(parsed.subtext ?? "none"),
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveTone(rawInput, ctx)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Hybrid resolver - always calls both layers; AI call is non-blocking.
 *
 * Resolution priority:
 *   1. API null              → rule tone, intensity "medium", subtext "none"  (rule_only)
 *   2. low confidence / unknownTokens → all from AI                          (ai_primary)
 *   3. high confidence + AI confirms  → rule tone, AI intensity/subtext      (rule+ai_confirmed)
 *   4. AI tone ≠ rule tone            → all from AI + log warning            (ai_override)
 *   5. Otherwise (medium confirmed)   → rule tone, AI intensity/subtext      (rule+ai_confirmed)
 *
 * Stability gate: if resolved tone ≠ ctx.previousTone AND sessionDepth < 2,
 * hold the previous tone (prevents jarring shifts in the first two messages).
 *
 * @param  {string} rawInput
 * @param  {object} ctx       Session context (reads previousTone, conversationProfile)
 * @returns {Promise<{ tone: string, intensity: string, subtext: string, source: string }>}
 */
export async function resolveTone(rawInput, ctx) {
  const sessionDepth = ctx.conversationProfile?.sessionDepth ?? 0;
  const previousTone = ctx.previousTone ?? null;

  // Both run immediately - AI is non-blocking (fired while pipeline normalises)
  const ruleResult = detectToneWithConfidence(rawInput);
  const aiResult   = await classifyEmotionAI(rawInput, ruleResult);

  let tone, intensity, subtext, source;

  if (aiResult === null) {
    // API failure - silent fallback
    tone      = ruleResult.tone;
    intensity = "medium";
    subtext   = "none";
    source    = "rule_only";

  } else if (ruleResult.confidence === "low" || ruleResult.hasUnknownTokens) {
    // Rule can't be trusted - use AI entirely
    tone      = aiResult.tone;
    intensity = aiResult.intensity;
    subtext   = aiResult.subtext;
    source    = "ai_primary";

  } else if (ruleResult.confidence === "high" && aiResult.confirms) {
    // Strong rule agreement
    tone      = ruleResult.tone;
    intensity = aiResult.intensity;
    subtext   = aiResult.subtext;
    source    = "rule+ai_confirmed";

  } else if (aiResult.tone !== ruleResult.tone) {
    // AI disagrees - override and log
    console.warn(
      "[Bloomie Tone] AI override:",
      ruleResult.tone, "(rule,", ruleResult.confidence, ") →", aiResult.tone, "(AI)"
    );
    tone      = aiResult.tone;
    intensity = aiResult.intensity;
    subtext   = aiResult.subtext;
    source    = "ai_override";

  } else {
    // Medium confidence + AI confirms, or any remaining confirmatory case
    tone      = ruleResult.tone;
    intensity = aiResult.intensity;
    subtext   = aiResult.subtext;
    source    = "rule+ai_confirmed";
  }

  // Stability gate: hold previous tone in the first two messages
  if (previousTone !== null && tone !== previousTone && sessionDepth < 2) {
    tone = previousTone;
  }

  return { tone, intensity, subtext, source };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyToneToLines(lines, toneResult, sessionDepth)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Applies tone-aware transformations to a lines array before say() renders it.
 *
 * Only activates when source ≠ "rule_only" AND sessionDepth ≥ 2.
 * No-ops on casual / neutral - unchanged.
 *
 * @param  {string[]} lines
 * @param  {{ tone: string, intensity: string, source: string }} toneResult
 * @param  {number} sessionDepth
 * @returns {string[]}
 */
export function applyToneToLines(lines, toneResult, sessionDepth) {
  if (!toneResult || toneResult.source === "rule_only" || sessionDepth < 2) {
    return lines;
  }
  const { tone, intensity } = toneResult;
  let result = [...lines];

  if (tone === "distressed" && intensity === "high") {
    // Max 3 content lines; acknowledgment opener (no medical jargon)
    result = result.slice(0, 3);
    const firstIsAck = /i hear you|you're not alone|i'm here with you/i.test(result[0] ?? "");
    if (!firstIsAck) {
      result = [
        "I hear you - you're not alone in this.",
        ...result.slice(0, 2),
      ];
    }

  } else if (tone === "distressed" && intensity === "medium") {
    // Warm grounding opener
    const firstIsWarm = /take a breath|i'm here|let's figure|here with you/i.test(result[0] ?? "");
    if (!firstIsWarm) {
      result = [
        "Take a breath - I'm here and we'll look at this together.",
        ...result,
      ];
    }

  } else if (tone === "anxious") {
    // Reassurance before info
    const firstIsReassurance = /it'?s okay|understandable|you'?re okay|normal to/i.test(result[0] ?? "");
    if (!firstIsReassurance) {
      result = [
        "It's okay to have questions - let's look at this together.",
        ...result,
      ];
    }

  } else if (tone === "frustrated") {
    // Strip soft filler from start of lines, lead with direct answer
    result = result.map(l =>
      l.replace(/^(so,?\s+|well,?\s+|actually,?\s+|now,?\s+let me\s+|let me\s+)/i, "").trim()
    ).filter(Boolean);

  } else if (tone === "deflecting") {
    // Gently name the deflection, then continue normally
    const firstIsGentleNaming = /i notice|it's okay to minimise|worth taking a look/i.test(result[0] ?? "");
    if (!firstIsGentleNaming) {
      result = [
        "I notice you might be downplaying this a little - that's okay. It's still worth taking a look.",
        ...result,
      ];
    }
  }
  // casual / neutral → unchanged

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyToneToChoices(choices, toneResult, sessionDepth)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Trims and augments the choices (buttons) array based on resolved tone.
 *
 * Only activates when source ≠ "rule_only" AND sessionDepth ≥ 2.
 *
 * Rules:
 *   distressed+high   → max 2 buttons
 *   distressed+medium → max 3 buttons
 *   anxious           → add "I just want reassurance" button if absent; no cap
 *   frustrated        → max 2 buttons
 *   others            → unchanged
 *
 * @param  {Array<{ id: string, label: string, next?: string }>} choices
 * @param  {{ tone: string, intensity: string, source: string }} toneResult
 * @param  {number} sessionDepth
 * @returns {Array}
 */
export function applyToneToChoices(choices, toneResult, sessionDepth) {
  if (!toneResult || toneResult.source === "rule_only" || sessionDepth < 2) {
    return choices;
  }
  const { tone, intensity } = toneResult;
  let result = [...choices];

  if (tone === "distressed" && intensity === "high") {
    result = result.slice(0, 2);

  } else if (tone === "distressed" && intensity === "medium") {
    result = result.slice(0, 3);

  } else if (tone === "anxious") {
    const hasReassurance = result.some(c =>
      /reassurance|just reassurance|just want reassurance/i.test(c.label)
    );
    if (!hasReassurance) {
      result = [
        ...result,
        { id: "tone_reassurance", label: "I just want reassurance", next: null },
      ];
    }

  } else if (tone === "frustrated") {
    result = result.slice(0, 2);
  }

  return result;
}
