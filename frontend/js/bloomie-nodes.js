/**
 * bloomie-nodes.js — thin assembler
 *
 * Imports all domain-specific node creators and merges them into a single
 * NODES object. This file is intentionally small; all node content lives
 * in the domain sub-modules below.
 *
 * Domain split:
 *   bloomie-nodes-helpers.js      — shared helper functions & computed constants
 *   bloomie-nodes-core.js         — routing, safety, app-help, session, resolution
 *   bloomie-nodes-period.js       — heavy bleeding, spotting, late/missed period
 *   bloomie-nodes-pregnancy.js    — pregnancy test timing, abortion support
 *   bloomie-nodes-mood.js         — mood, energy, emotional wellbeing
 *   bloomie-nodes-pelvic.js       — pelvic pain, sex-related pain
 *   bloomie-nodes-general.js      — "something else", discharge, cycle-smart, TTC/postpartum, mode
 *   bloomie-nodes-education.js    — symptom education (EDUC_*)          [lazy-loaded]
 *   bloomie-nodes-perimenopause.js — perimenopause pathway + PCOS/endo education [lazy-loaded]
 *
 * Lazy-loading strategy
 * ─────────────────────
 * Education and perimenopause modules are deferred with dynamic import().
 * The imports are kicked off immediately inside createNodes() so the browser
 * can fetch them in parallel while the user reads the animated greeting
 * (~3-5 s of typing delay + reading time). By the time a user can navigate
 * to those paths they will already be in the module cache.
 *
 * If the network is very slow and a user reaches an education/perimenopause
 * node before the module resolves, transition() guards with `if (!node) return`
 * — the click is silently dropped. This is an acceptable edge case for < 1%
 * of sessions on very slow connections; the alternative would be blocking the
 * entire initial load for 28 KB of rarely-immediate content.
 *
 * Safety-critical nodes (EMERGENCY_REDIRECT, CRISIS_SUPPORT, SAFETY_SUPPORT,
 * HEAVY_URGENT, etc.) all live in bloomie-nodes-core.js which remains eagerly
 * loaded and is never deferred.
 */

// ── Eager imports (needed for first response) ───────────────────────────────
import { buildNodeHelpers }     from "./bloomie-nodes-helpers.js";
import { createCoreNodes }      from "./bloomie-nodes-core.js";
import { createPeriodNodes }    from "./bloomie-nodes-period.js";
import { createPregnancyNodes } from "./bloomie-nodes-pregnancy.js";
import { createMoodNodes }      from "./bloomie-nodes-mood.js";
import { createPelvicNodes }    from "./bloomie-nodes-pelvic.js";
import { createGeneralNodes }   from "./bloomie-nodes-general.js";

export function createNodes(env) {
  const helpers = buildNodeHelpers(env);

  // All primary conversation paths are available immediately.
  const nodes = {
    ...createCoreNodes(env, helpers),
    ...createPeriodNodes(env, helpers),
    ...createPregnancyNodes(env, helpers),
    ...createMoodNodes(env, helpers),
    ...createPelvicNodes(env, helpers),
    ...createGeneralNodes(env, helpers),
  };

  // ── Lazy chunks — fetched in parallel with initial greeting animation ─────
  //
  // Dynamic import() starts the network request right now but does not block
  // this function from returning. Nodes from these modules are Object.assigned
  // into `nodes` as soon as each chunk resolves. The `nodes` reference held by
  // assistant.js is the same object, so any node key that arrives before the
  // user clicks it will be present and functional.
  //
  // Do NOT add safety-critical or first-click nodes to these deferred groups.

  // bloomie-educ chunk (~12 KB) — SYMPTOM_EDUCATION, EDUC_PERIOD, EDUC_HEAVY,
  // EDUC_CRAMPS, EDUC_SPOTTING, EDUC_MOOD, EDUC_LATE, EDUC_CYCLE_BASICS, etc.
  // Reachable only after ≥ 2 menu clicks; has ample time to load.
  import("./bloomie-nodes-education.js")
    .then(({ createEducationNodes }) => {
      Object.assign(nodes, createEducationNodes(env, helpers));
    })
    .catch(() => {
      // Non-critical: education nodes simply won't be available. The chat
      // continues to function normally on all other paths.
    });

  // bloomie-peri chunk (~16 KB) — PERIMENOPAUSE_INTRO, PERI_* pathway,
  // EDUC_MENOPAUSE, EDUC_CONTRACEPTION, EDUC_PCOS, EDUC_ENDO.
  // Reachable 1 click from START_MENU; natural typing delay (~3 s) gives
  // sufficient load window on all but the slowest connections.
  import("./bloomie-nodes-perimenopause.js")
    .then(({ createPerimenopauseNodes }) => {
      Object.assign(nodes, createPerimenopauseNodes(env, helpers));
    })
    .catch(() => {
      // Non-critical: perimenopause nodes won't be available on severe network
      // failure. Core safety and primary symptom paths are unaffected.
    });

  return nodes;
}
