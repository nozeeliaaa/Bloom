#!/usr/bin/env node
/**
 * eval/harness.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bloomie Evaluation Harness
 *
 * Runs all cases from eval/cases.js through the full Bloomie pipeline and
 * computes four metrics:
 *
 *   1. Routing accuracy     - correct route / total routing cases
 *   2. Red-flag recall      - urgent cases correctly flagged / total urgent cases
 *   3. False reassurance    - urgent cases missed / total urgent cases (target: 0%)
 *   4. Fallback quality     - OOS/gibberish correctly handled / total fallback cases
 *
 * Usage:
 *   node eval/harness.js
 *   node eval/harness.js --verbose         show all case results
 *   node eval/harness.js --failures-only   show only failures
 *   node eval/harness.js --tag red_flag    filter by tag
 *   node eval/harness.js --category routing
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { cases }          from "./cases.js";
import { extractEntities, inferRoute, detectDownplaying, detectAmbiguousInput, detectContradiction, detectMissingContext, checkCumulativeRisk } from "../frontend/js/bloomie-inference.js";
import { buildGuidanceResponse }       from "../frontend/js/bloomie-templates.js";
import { normalizeText, looksLikeGibberish, scoreSignals, resolveSignals, computeRouteConfidence }
                                       from "../frontend/js/bloomie-routing.js";
import { normalizePatois, fuzzyCorrect, collapseRepeatedLetters, expandShorthand }
                                       from "../frontend/js/bloomie-patois.js";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args         = process.argv.slice(2);
const VERBOSE      = args.includes("--verbose");
const FAIL_ONLY    = args.includes("--failures-only");
const TAG_FILTER   = args.includes("--tag")      ? args[args.indexOf("--tag") + 1]      : null;
const CAT_FILTER   = args.includes("--category") ? args[args.indexOf("--category") + 1] : null;


// ─── Pipeline runner ──────────────────────────────────────────────────────────

// Full pipeline normalization (mirrors assistant.js steps 3–6):
//   normalizePatois → fuzzyCorrect → collapseRepeatedLetters → expandShorthand → normalizeText
function pipelineNormalize(rawInput) {
  const p1 = normalizePatois(rawInput);
  const p2 = fuzzyCorrect(p1) ?? p1;
  const p3 = collapseRepeatedLetters(p2);
  const p4 = expandShorthand(p3);
  return normalizeText(p4);
}

function runPipeline(rawInput) {
  const normalized = pipelineNormalize(rawInput);
  const entities   = extractEntities(normalized);
  const route      = inferRoute(entities);
  const guidance   = route
    ? buildGuidanceResponse(entities, route.payload?.reason)
    : buildGuidanceResponse(entities);

  const { sig, has } = scoreSignals(normalized);
  const multiRoute   = resolveSignals(sig, has);
  const confidence   = computeRouteConfidence(sig, entities);

  return {
    normalized,
    entities,
    route,
    guidance,
    multiRoute,
    confidence,
    gibberish:     looksLikeGibberish(normalized),
    urgent:        entities.urgent || route?.next === "HEAVY_URGENT",
    actualRoute:   route?.next ?? null,
    scenario:      guidance?.scenario ?? null,
    downplaying:   detectDownplaying(normalized),
    ambiguous:     detectAmbiguousInput(normalized, entities) !== null,
    contradiction: detectContradiction(normalized, entities) !== null,
    missingContext: detectMissingContext(entities, normalized) !== null,
  };
}

// Runs a multi-turn case: history = array of prior messages, current = the final message
function runMultiTurnCumulative(history, current) {
  const allMessages = [...(history || []), current];
  const entityHistory = allMessages.map(msg => extractEntities(pipelineNormalize(msg)));
  return checkCumulativeRisk(entityHistory);
}


// ─── Case evaluator ───────────────────────────────────────────────────────────

function evaluateCase(c) {
  const result = runPipeline(c.input);
  const exp    = c.expected;
  const checks = [];

  // Check: expected route
  if (exp.route !== undefined) {
    const pass = result.actualRoute === exp.route;
    checks.push({ name: "route", pass, expected: exp.route, got: result.actualRoute });
  }

  // Check: expected no route (inferRoute returns null)
  if (exp.noRoute === true) {
    const pass = result.actualRoute === null;
    checks.push({ name: "noRoute", pass, expected: null, got: result.actualRoute });
  }

  // Check: urgency
  if (exp.urgent !== undefined) {
    const pass = result.urgent === exp.urgent;
    checks.push({ name: "urgent", pass, expected: exp.urgent, got: result.urgent });
  }

  // Check: gibberish detection
  if (exp.gibberish !== undefined) {
    const pass = result.gibberish === exp.gibberish;
    checks.push({ name: "gibberish", pass, expected: exp.gibberish, got: result.gibberish });
  }

  // Check: scenario from template layer
  if (exp.scenario !== undefined) {
    const pass = result.scenario === exp.scenario;
    checks.push({ name: "scenario", pass, expected: exp.scenario, got: result.scenario });
  }

  // Check: downplaying detection
  if (exp.downplaying !== undefined) {
    const pass = result.downplaying === exp.downplaying;
    checks.push({ name: "downplaying", pass, expected: exp.downplaying, got: result.downplaying });
  }

  // Check: ambiguity question fires
  if (exp.ambiguous !== undefined) {
    const pass = result.ambiguous === exp.ambiguous;
    checks.push({ name: "ambiguous", pass, expected: exp.ambiguous, got: result.ambiguous });
  }

  // Check: contradiction detected
  if (exp.contradiction !== undefined) {
    const pass = result.contradiction === exp.contradiction;
    checks.push({ name: "contradiction", pass, expected: exp.contradiction, got: result.contradiction });
  }

  // Check: missing context probe fires
  if (exp.missingContext !== undefined) {
    const pass = result.missingContext === exp.missingContext;
    checks.push({ name: "missingContext", pass, expected: exp.missingContext, got: result.missingContext });
  }

  // Check: confidence tier (high / medium / low)
  if (exp.confidence !== undefined) {
    const pass = result.confidence?.tier === exp.confidence;
    checks.push({ name: "confidence", pass, expected: exp.confidence, got: result.confidence?.tier });
  }

  // Check: cumulative escalation (multi-turn case - uses c.history field)
  if (exp.cumulativeEscalation !== undefined) {
    const cumResult = runMultiTurnCumulative(c.history || [], c.input);
    const pass = cumResult.escalate === exp.cumulativeEscalation;
    checks.push({ name: "cumulativeEscalation", pass, expected: exp.cumulativeEscalation, got: cumResult.escalate });
  }

  const passed = checks.every(ch => ch.pass);
  return { ...c, result, checks, passed };
}


// ─── Metric computation ───────────────────────────────────────────────────────

function computeMetrics(evaluated) {
  // 1. Routing accuracy - routing + edge cases with expected.route
  const routingCases = evaluated.filter(c =>
    (c.category === "routing" || c.category === "edge") &&
    c.expected.route !== undefined
  );
  const routingCorrect = routingCases.filter(c =>
    c.checks.find(ch => ch.name === "route")?.pass
  ).length;

  // 2. Red-flag recall - all red_flag cases + any case with expected.urgent = true
  const redFlagCases = evaluated.filter(c =>
    c.category === "red_flag" || c.expected.urgent === true
  );
  const redFlagCaught = redFlagCases.filter(c => c.result.urgent === true).length;

  // 3. False reassurance - urgent cases where urgent was NOT caught.
  //    Exclude cumulative-escalation-only cases (single-turn pipeline cannot flag them
  //    as urgent by design; urgency is only detectable across turns via checkCumulativeRisk).
  const falseReassurance = redFlagCases.filter(c =>
    c.result.urgent === false &&
    !(c.expected.cumulativeEscalation !== undefined && c.expected.urgent === undefined)
  ).length;

  // 4. Fallback quality - fallback cases with gibberish or noRoute checks
  const fallbackCases = evaluated.filter(c => c.category === "fallback");
  const fallbackCorrect = fallbackCases.filter(c => c.passed).length;

  return {
    routing:          { correct: routingCorrect,   total: routingCases.length },
    redFlag:          { caught: redFlagCaught,      total: redFlagCases.length },
    falseReassurance: { count: falseReassurance,    total: redFlagCases.length },
    fallback:         { correct: fallbackCorrect,   total: fallbackCases.length },
  };
}


// ─── Formatting helpers ───────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  red:    "\x1b[31m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
  white:  "\x1b[97m",
  bgRed:  "\x1b[41m",
  bgGreen:"\x1b[42m",
};

function pct(n, d) {
  if (d === 0) return "N/A ";
  return ((n / d) * 100).toFixed(1).padStart(5) + "%";
}

function bar(n, d, width = 20) {
  if (d === 0) return "─".repeat(width);
  const filled = Math.round((n / d) * width);
  return C.green + "█".repeat(filled) + C.grey + "░".repeat(width - filled) + C.reset;
}

function statusIcon(pass) {
  return pass ? C.green + "✓" + C.reset : C.red + "✗" + C.reset;
}


// ─── Report renderer ──────────────────────────────────────────────────────────

function printReport(evaluated, metrics) {
  const totalPassed  = evaluated.filter(c => c.passed).length;
  const totalFailed  = evaluated.length - totalPassed;

  console.log();
  console.log(C.bold + C.cyan + "╔══════════════════════════════════════════════════════════╗" + C.reset);
  console.log(C.bold + C.cyan + "║           BLOOMIE EVALUATION HARNESS                     ║" + C.reset);
  console.log(C.bold + C.cyan + "╚══════════════════════════════════════════════════════════╝" + C.reset);
  console.log();
  console.log(`  Total cases : ${C.bold}${evaluated.length}${C.reset}`);
  console.log(`  Passed      : ${C.green}${C.bold}${totalPassed}${C.reset}`);
  console.log(`  Failed      : ${totalFailed > 0 ? C.red + C.bold : C.green}${totalFailed}${C.reset}`);
  console.log();

  // ── Metric summary ─────────────────────────────────────────────────────────
  console.log(C.bold + "  METRIC SUMMARY" + C.reset);
  console.log("  " + "─".repeat(60));

  const { routing, redFlag, falseReassurance, fallback } = metrics;

  const routingPct = routing.total ? (routing.correct / routing.total) * 100 : 100;
  const rfPct      = redFlag.total  ? (redFlag.caught  / redFlag.total)  * 100 : 100;
  const frPct      = redFlag.total  ? (falseReassurance.count / redFlag.total) * 100 : 0;
  const fbPct      = fallback.total ? (fallback.correct / fallback.total) * 100 : 100;

  const routingIcon = routingPct >= 90  ? C.green + "✓" : routingPct >= 75 ? C.yellow + "⚠" : C.red + "✗";
  const rfIcon      = rfPct      >= 95  ? C.green + "✓" : rfPct      >= 85 ? C.yellow + "⚠" : C.red + "✗";
  const frIcon      = frPct      === 0  ? C.green + "✓" : frPct       < 10 ? C.yellow + "⚠" : C.red + "✗";
  const fbIcon      = fbPct      >= 85  ? C.green + "✓" : fbPct      >= 70 ? C.yellow + "⚠" : C.red + "✗";

  console.log(`  ${routingIcon + C.reset}  Routing accuracy     ${bar(routing.correct, routing.total)}  ${pct(routing.correct, routing.total)}  (${routing.correct}/${routing.total})`);
  console.log(`  ${rfIcon      + C.reset}  Red-flag recall      ${bar(redFlag.caught,  redFlag.total)}  ${pct(redFlag.caught,  redFlag.total)}  (${redFlag.caught}/${redFlag.total})`);
  console.log(`  ${frIcon      + C.reset}  False reassurance    ${bar(falseReassurance.count, redFlag.total, 20)}  ${pct(falseReassurance.count, redFlag.total)}  (${falseReassurance.count}/${redFlag.total}) ${frPct === 0 ? C.green + "← target: 0%" + C.reset : C.red + "← TARGET: 0%" + C.reset}`);
  console.log(`  ${fbIcon      + C.reset}  Fallback quality     ${bar(fallback.correct, fallback.total)}  ${pct(fallback.correct, fallback.total)}  (${fallback.correct}/${fallback.total})`);
  console.log();

  // ── Category breakdown ─────────────────────────────────────────────────────
  const categories = [...new Set(evaluated.map(c => c.category))];
  console.log(C.bold + "  BY CATEGORY" + C.reset);
  console.log("  " + "─".repeat(60));
  for (const cat of categories) {
    const catCases   = evaluated.filter(c => c.category === cat);
    const catPassed  = catCases.filter(c => c.passed).length;
    const icon       = catPassed === catCases.length ? C.green + "✓" : catPassed > catCases.length * 0.8 ? C.yellow + "⚠" : C.red + "✗";
    console.log(`  ${icon + C.reset}  ${cat.padEnd(16)}  ${String(catPassed).padStart(3)} / ${catCases.length.toString().padEnd(3)}  ${pct(catPassed, catCases.length)}`);
  }
  console.log();

  // ── Failures ───────────────────────────────────────────────────────────────
  const failures = evaluated.filter(c => !c.passed);
  if (failures.length > 0) {
    console.log(C.bold + C.red + `  FAILURES (${failures.length})` + C.reset);
    console.log("  " + "─".repeat(60));
    for (const c of failures) {
      console.log();
      console.log(`  ${C.bold}${c.id}${C.reset}  ${C.grey}[${c.category}]${C.reset}  "${C.yellow}${c.input.slice(0, 70)}${c.input.length > 70 ? "…" : ""}${C.reset}"`);
      for (const ch of c.checks.filter(ch => !ch.pass)) {
        console.log(`    ${C.red}✗${C.reset} ${ch.name.padEnd(12)} expected: ${C.green}${JSON.stringify(ch.expected)}${C.reset}   got: ${C.red}${JSON.stringify(ch.got)}${C.reset}`);
      }
      if (c.notes) {
        console.log(`    ${C.grey}note: ${c.notes}${C.reset}`);
      }
    }
    console.log();
  } else {
    console.log(C.green + C.bold + "  All cases passed!" + C.reset);
    console.log();
  }

  // ── Verbose: all results ───────────────────────────────────────────────────
  if (VERBOSE || FAIL_ONLY) {
    const toShow = FAIL_ONLY ? evaluated.filter(c => !c.passed) : evaluated;
    console.log(C.bold + `  ALL RESULTS${FAIL_ONLY ? " (failures only)" : ""}` + C.reset);
    console.log("  " + "─".repeat(60));
    for (const c of toShow) {
      const icon   = statusIcon(c.passed);
      const route  = c.result.actualRoute ?? "null";
      const urgent = c.result.urgent ? C.red + "URGENT" + C.reset : "ok";
      console.log(`  ${icon}  ${C.bold}${c.id}${C.reset}  route=${C.cyan}${route}${C.reset}  urgent=${urgent}`);
      console.log(`     ${C.grey}"${c.input.slice(0, 80)}${c.input.length > 80 ? "…" : ""}"${C.reset}`);
    }
    console.log();
  }
}


// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // Apply filters
  let filteredCases = cases;
  if (TAG_FILTER)  filteredCases = filteredCases.filter(c => c.tags.includes(TAG_FILTER));
  if (CAT_FILTER)  filteredCases = filteredCases.filter(c => c.category === CAT_FILTER);

  if (filteredCases.length === 0) {
    console.error(`No cases match the given filter.`);
    process.exit(1);
  }

  // Run evaluation
  const evaluated = filteredCases.map(evaluateCase);
  const metrics   = computeMetrics(evaluated);

  // Print report
  printReport(evaluated, metrics);

  // Exit code: 1 if any false reassurance, else 0 if all pass, else 1
  const { falseReassurance, redFlag } = metrics;
  if (falseReassurance.count > 0) {
    console.error(C.red + C.bold + `  FATAL: ${falseReassurance.count} red-flag case(s) were not caught. Fix immediately.` + C.reset + "\n");
    process.exit(1);
  }
  const allPassed = evaluated.every(c => c.passed);
  process.exit(allPassed ? 0 : 1);
}

main();
