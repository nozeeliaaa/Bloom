#!/usr/bin/env node
import { extractEntities, inferRoute, detectDownplaying } from "../frontend/js/bloomie-inference.js";
import { normalizeText, looksLikeGibberish, scoreSignals, resolveSignals, computeRouteConfidence, detectOutOfScope } from "../frontend/js/bloomie-routing.js";
import { normalizePatois, fuzzyCorrect, collapseRepeatedLetters, expandShorthand, detectPatois } from "../frontend/js/bloomie-patois.js";
import { detectToneWithConfidence } from "../frontend/js/bloomie-tone.js";
import { buildGuidanceResponse } from "../frontend/js/bloomie-templates.js";

// ── Minimal OOS categories (patterns only, no ctx-dependent replies) ──────────
// Extracted from bloomie-oos.js for pattern-matching purposes only.
const OOS_CATEGORIES = [
  { name: "greeting",          patterns: [/^(hi|hello|hey|yo|sup|hiya|morning|afternoon|evening)$/, /^\b(hi|hello|hey|yo|sup|hiya)\b\s*$/] },
  { name: "food",              patterns: [/\b(hungry|food|eat|eating|snack|cook|recipe|dinner|lunch|breakfast|meal)\b/, /\b(craving|cravings)\b/, /\b(kfc|pizza|burger|patty|taco|fries|ice cream|chocolate)\b/] },
  { name: "weather",           patterns: [/\b(weather|rain|forecast|temperature|hot|cold|storm|hurricane|sunshine)\b/] },
  { name: "sports",            patterns: [/\b(score|match|game|league|team|football|soccer|basketball|cricket|volleyball|netball)\b/] },
  { name: "entertainment",     patterns: [/\b(song|music|album|artist|playlist|netflix|movie|show|watch|listen|tiktok|instagram|youtube)\b/] },
  { name: "relationships",     patterns: [/\b(bf|girlfriend|boyfriend|my man|my girl|cheat|cheating|break up|breakup|situationship|talking stage|he left|she left)\b/] },
  { name: "money",             patterns: [/\b(cash|money|broke|loan|rent|salary|payday|credit|debt|rich|bills)\b/, /\b(make money|earn money|get paid|send money|cash app|paypal|venmo)\b/] },
  { name: "school",            patterns: [/\b(school|exam|homework|study|class|college|university|teacher|grade|assignment)\b/] },
  { name: "insults",           patterns: [/\b(stupid|idiot|dumb|trash|shut up|f\*+k|fuck|bitch|useless|waste)\b/] },
  { name: "jokes",             patterns: [/\b(joke|funny|laugh|humor|tell me a joke|make me laugh)\b/] },
  { name: "bored_tired",       patterns: [/^(i'm bored|im bored|i'?m tired|bored|tired)$/, /^(ok|okay|sure|maybe|yes|no|yep|nope|nah|yeah)$/] },
  { name: "time_question",     patterns: [/\b(what time|what('s| is) the time|what day is it)\b/] },
  { name: "mental_health_general", patterns: [/\b(depressed|depression|panic attack|panic|overthinking|stressed out|burnout|burnt out|breaking down|can't cope|cant cope)\b/] },
  { name: "non_repro_health",  patterns: [/\b(cold|flu|fever|headache|allergy|rash|sore throat|cough|infection)\b/] },
  { name: "pregnancy_confusion", patterns: [/\b(pregnant|pregnancy|positive test|negative test|missed period and)\b/] },
  { name: "see_doctor_q",      patterns: [/(should i (see|go to|visit|call) (a |my )?(doctor|physician|provider))/, /(is this serious|is this normal|when (should|do) i (go|seek|get) (help|care|checked|medical))/] },
  { name: "dismissal",         patterns: [/\b(forget it|never mind|nevermind|whatever|nvm|nm)\b/, /\b(you cant help|you can't help|this is useless|this app is trash|you r dumb|you are dumb)\b/] },
];

const HEALTH_OVERRIDE = [
  /\b(late|missed|no period|period.*not come|period.*nuh come)\b/,
  /\b(heavy|soaking|clot|bleeding|bleed)\b/,
  /\b(spotting|spot|brown|pink discharge)\b/,
  /\b(cramp|pelvic|pain|belly.*hurt|stomach.*hurt)\b/,
  /\b(mood|sad|anxious|irritable|tired|fatigue|drained|cry|tearful|depressed)\b/,
  /\b(discharge|odor|smell)\b/,
  /\b(pregnant|pregnancy|breed)\b/,
  /\b(nausea|nauseous|vomit|dizzy)\b/,
  /\b(it still hasn't come|still hasn't come|it hasn't come|hasn't arrived)\b/,
  /\b(implicit_late|still waiting)\b/,
  /\b(feel so low|feel off|cant stop crying|can't stop crying)\b/,
  /\b(bleeding a lot|so much blood|really heavy)\b/,
  /\b(hurts so much|pain is really bad|can't handle)\b/,
];

function pipelineNormalize(raw) {
  const p1 = normalizePatois(raw);
  const p2 = fuzzyCorrect(p1) ?? p1;
  const p3 = collapseRepeatedLetters(p2);
  const p4 = expandShorthand(p3);
  return normalizeText(p4);
}

function checkOOS(raw, normalized) {
  const oos = detectOutOfScope(raw, OOS_CATEGORIES, HEALTH_OVERRIDE);
  return oos ? oos.name : null;
}

function runDiag(raw) {
  const normalized  = pipelineNormalize(raw);
  const entities    = extractEntities(normalized);
  const route       = inferRoute(entities);
  const { sig, has }= scoreSignals(normalized);
  const multiRoute  = resolveSignals(sig, has);
  const confidence  = computeRouteConfidence(sig, entities);
  const toneResult  = detectToneWithConfidence(raw);
  const isPatois    = detectPatois(raw);
  const gibberish   = looksLikeGibberish(normalized);
  const oosCategory = checkOOS(raw, normalized);

  const actualRoute = route?.next ?? (multiRoute?.next ?? null);
  const guidance    = actualRoute ? buildGuidanceResponse(entities, route?.payload?.reason) : null;
  const preview     = guidance?.lines?.[0] ?? guidance?.scenario ?? null;

  // Active symptom flags
  const activeSymptoms = Object.entries(entities.symptoms || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k);

  return {
    input:          raw,
    normalized,
    isPatois,
    route:          actualRoute,
    oosCategory,
    confidence:     confidence.tier,
    confidenceScore:confidence.score,
    primaryIntent:  confidence.primaryIntent,
    tone:           toneResult.tone,
    toneConfidence: toneResult.confidence,
    gibberish,
    urgent:         entities.urgent || false,
    activeSymptoms,
    preview,
  };
}

// ── Test groups ───────────────────────────────────────────────────────────────

const GROUPS = [
  {
    name: "IMPLICIT SYMPTOMS - should route to a health flow",
    expected: "health route (not null, not OOS)",
    cases: [
      "it still hasnt come",
      "i didnt get it",
      "nothing yet",
      "still waiting",
      "im pregnant",
      "i think im pregnant",
      "could i be pregnant",
      "it hurts so much",
      "the pain is really bad",
      "i cant handle the cramps",
      "im bleeding a lot",
      "so much blood",
      "its really heavy",
      "i feel so low",
      "i cant stop crying",
      "i just feel off",
    ],
  },
  {
    name: "PATOIS - should route same as English equivalents",
    expected: "health route matching English equivalent",
    cases: [
      "mi period nuh come yet",
      "mi belly a kill mi",
      "mi feel sick bad",
      "nuh blood nuh come",
      "everyting feel wrong",
    ],
  },
  {
    name: "FRUSTRATION / DISMISSAL - should NOT loop OOS",
    expected: "dismissal/insults OOS or null route, NOT a health route",
    cases: [
      "you cant help",
      "this is useless",
      "forget it",
      "nvm",
      "whatever",
      "you dont understand",
      "you r dumb",
      "this app is trash",
    ],
  },
  {
    name: "OFF-TOPIC - should NOT produce health guidance",
    expected: "OOS category, null route, no health guidance",
    cases: [
      "i want food",
      "i'm hungry",
      "what time is it",
      "i'm tired",
      "i'm bored",
      "tell me a joke",
      "what's the weather",
      "hello",
      "ok",
      "yes",
      "no",
      "maybe",
    ],
  },
  {
    name: "EDGE CASES",
    expected: "various - see notes",
    cases: [
      "",
      "a",
      "MY PERIOD IS LATE",
      "pleaseeeee help",
      "it hurtssss",
      "mi period late and i'm scared",
      "7",
      "28",
      "march 15",
      "3 weeks ago",
      "I have been experiencing significant pelvic discomfort and pressure in my lower abdomen for the past two weeks and my period has not come yet I am now about 10 days late and also noticing some light brown spotting and I feel more emotional than usual I do not know if I could be pregnant but I am worried about what is going on with my body and whether this is something serious that requires medical attention",
    ],
  },
];

// ── Bug report accumulators ───────────────────────────────────────────────────
const bugs = {
  wrong_route:          [],
  oos_false_positive:   [],
  guidance_false_positive: [],
  tone_miss:            [],
  patois_miss:          [],
  crashes:              [],
};

// ── Run and print ─────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("  BLOOMIE DIAGNOSTIC RUN");
console.log("══════════════════════════════════════════════════════════════\n");

for (const group of GROUPS) {
  console.log(`\n── ${group.name}`);
  console.log(`   Expected: ${group.expected}`);
  console.log("   " + "─".repeat(70));

  for (const input of group.cases) {
    let result;
    try {
      result = runDiag(input);
    } catch (err) {
      console.log(`   [CRASH] "${input}" → ${err.message}`);
      bugs.crashes.push({ input, error: err.message });
      continue;
    }

    const r = result;
    const routeStr    = r.route ?? "null";
    const oosStr      = r.oosCategory ?? "-";
    const toneStr     = `${r.tone}(${r.toneConfidence})`;
    const confStr     = `${r.confidence}(${r.confidenceScore})`;
    const patoisStr   = r.isPatois ? "PATOIS" : "-";
    const gibStr      = r.gibberish ? "GIBBERISH" : "-";
    const symStr      = r.activeSymptoms.length ? r.activeSymptoms.join(",") : "none";
    const previewStr  = r.preview ? `"${String(r.preview).slice(0, 60)}"` : "-";

    console.log(`   IN:  "${input || "(empty)"}"`);
    console.log(`        route=${routeStr} | oos=${oosStr} | conf=${confStr} | tone=${toneStr}`);
    console.log(`        patois=${patoisStr} | gibberish=${gibStr} | symptoms=[${symStr}]`);
    console.log(`        preview=${previewStr}`);
    console.log();

    // ── Bug detection ─────────────────────────────────────────────────────────

    // IMPLICIT SYMPTOMS group: must have a route
    if (group.name.startsWith("IMPLICIT")) {
      if (!r.route) {
        bugs.oos_false_positive.push({ input, note: "no route - fell through without health route", ...r });
      }
      // Frustration inputs inside this group that produce a health route are OK
    }

    // PATOIS group: must have a route
    if (group.name.startsWith("PATOIS")) {
      if (!r.route) {
        bugs.patois_miss.push({ input, note: "Patois input produced no route", normalized: r.normalized, ...r });
      }
    }

    // FRUSTRATION group: route should be null (no health route - just OOS/deflect)
    if (group.name.startsWith("FRUSTRATION")) {
      if (r.route && !["CRISIS_SUPPORT","SAFETY_SUPPORT"].includes(r.route)) {
        bugs.wrong_route.push({ input, note: `frustration/dismissal routed to health flow: ${r.route}`, ...r });
      }
      // Tone should be "frustrated" or "distressed" - if "neutral" on clearly frustrated inputs, flag
      const frustrationInputs = ["you cant help","this is useless","forget it","whatever","you dont understand","you r dumb","this app is trash"];
      if (frustrationInputs.includes(input.toLowerCase()) && r.tone === "neutral") {
        bugs.tone_miss.push({ input, note: `tone=neutral on obvious frustration/dismissal`, tone: r.tone, ...r });
      }
    }

    // OFF-TOPIC group: should have NO health route AND no health guidance
    if (group.name.startsWith("OFF-TOPIC")) {
      if (r.route) {
        bugs.guidance_false_positive.push({ input, note: `off-topic routed to health: ${r.route}`, ...r });
      }
      if (r.preview && !r.oosCategory) {
        bugs.guidance_false_positive.push({ input, note: `off-topic produced guidance preview with no OOS category`, preview: r.preview, ...r });
      }
    }
  }
}

// ── Bug report ────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════════");
console.log("  BUG REPORT");
console.log("══════════════════════════════════════════════════════════════\n");

const sections = [
  ["WRONG ROUTE (routed somewhere incorrect)",                        bugs.wrong_route],
  ["OOS FALSE POSITIVE (should have routed but didn't)",             bugs.oos_false_positive],
  ["GUIDANCE FALSE POSITIVE (produced health advice it shouldn't)",  bugs.guidance_false_positive],
  ["TONE MISS (frustration/distress not detected)",                  bugs.tone_miss],
  ["PATOIS MISS (Patois input failed where English equivalent passed)", bugs.patois_miss],
  ["CRASHES OR ERRORS",                                              bugs.crashes],
];

for (const [label, items] of sections) {
  console.log(`── ${label}`);
  if (items.length === 0) {
    console.log("   ✓ None\n");
  } else {
    for (const b of items) {
      console.log(`   ✗ "${b.input}"`);
      console.log(`     → ${b.note}`);
      if (b.normalized && b.normalized !== b.input?.toLowerCase()) console.log(`     normalized: "${b.normalized}"`);
      if (b.route)      console.log(`     route: ${b.route}`);
      if (b.oosCategory)console.log(`     oos: ${b.oosCategory}`);
      if (b.tone)       console.log(`     tone: ${b.tone}(${b.toneConfidence})`);
    }
    console.log();
  }
}

const totalBugs = Object.values(bugs).reduce((a, b) => a + b.length, 0);
console.log(`Total bugs found: ${totalBugs}`);
console.log();
