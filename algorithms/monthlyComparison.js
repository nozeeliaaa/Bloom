/**
 * bloom-monthly-comparison.js
 * ============================
 * Monthly comparison and change detection engine for Bloom.
 *
 * Extends bloom-cycle-engine.js — does NOT duplicate its logic.
 * Uses the existing signal detectors and adds structured monthly diff output.
 *
 * Output is consumed by:
 *   - Dashboard graphs
 *   - Bloomie explanations
 *   - PDF health reports
 *
 * COMP3901: Educational output only — not medical advice.
 */

import {
  mean, stdDev, lastN,
} from '../frontend/js/algorithms/bloom-utils.js';

import {
  detectCycleTrendSignal,
  detectIrregularCycleSignal,
  detectPredictionDriftSignal,
  computeRobustAverageCycleLength,
} from '../frontend/js/algorithms/bloom-cycle-engine.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} MonthlyComparison
 * @property {number}   cycleLengthChange        - days difference vs previous cycle
 * @property {string}   cycleLengthDirection     - 'longer' | 'shorter' | 'same'
 * @property {Object}   symptomFrequencyChange   - { [symptomName]: { prev, current, change } }
 * @property {string[]} newSymptoms              - symptoms not seen in previous period
 * @property {string[]} resolvedSymptoms         - symptoms from previous period not seen now
 * @property {number}   predictionDrift          - days between previous and current prediction
 * @property {string}   variabilityScore         - 'stable' | 'moderate' | 'variable' | 'highly variable'
 * @property {string}   variabilityLevel         - 'low' | 'medium' | 'high'
 * @property {number}   averageCycleLength       - robust average across all cycles
 * @property {string}   trend                    - 'lengthening' | 'shortening' | 'stable' | 'shifted'
 * @property {string}   summary                  - human readable summary sentence
 * @property {Object}   debug                    - raw values for testing
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function variabilityLabel(sd) {
  if (sd < 2)  return { score: 'stable',          level: 'low'    };
  if (sd < 4)  return { score: 'moderate',        level: 'low'    };
  if (sd < 7)  return { score: 'variable',        level: 'medium' };
  return             { score: 'highly variable',  level: 'high'   };
}

function directionLabel(change) {
  if (change > 1)  return 'longer';
  if (change < -1) return 'shorter';
  return 'same';
}

function trendFromSignal(signal) {
  if (signal.code === 'LENGTHENING_CYCLE_TREND') return 'lengthening';
  if (signal.code === 'SHORTENING_CYCLE_TREND')  return 'shortening';
  if (signal.code === 'SUDDEN_CYCLE_SHIFT')      return 'shifted';
  return 'stable';
}

/* ------------------------------------------------------------------ */
/* Core comparison function                                            */
/* ------------------------------------------------------------------ */

/**
 * Compare current cycle against previous cycles and return structured diff.
 *
 * @param {Object} params
 * @param {number[]}  params.cycleLengths          - all cycle lengths in order (oldest first)
 * @param {Object}    params.currentSymptoms        - { [symptomName]: count } for current period
 * @param {Object}    params.previousSymptoms       - { [symptomName]: count } for previous period
 * @param {Date|null} params.previousPredictedDate  - what the prediction was last time
 * @param {Date|null} params.currentPredictedDate   - what the prediction is now
 * @param {Date|null} params.today                  - defaults to new Date()
 * @returns {MonthlyComparison}
 */
export function compareMonthly({
  cycleLengths           = [],
  currentSymptoms        = {},
  previousSymptoms       = {},
  previousPredictedDate  = null,
  currentPredictedDate   = null,
  today                  = new Date(),
} = {}) {

  // ── Cycle length change ─────────────────────────────────────
  const n = cycleLengths.length;
  const currentCycleLength  = n >= 1 ? cycleLengths[n - 1] : null;
  const previousCycleLength = n >= 2 ? cycleLengths[n - 2] : null;

  const cycleLengthChange = (currentCycleLength !== null && previousCycleLength !== null)
    ? currentCycleLength - previousCycleLength
    : 0;

  const cycleLengthDirection = directionLabel(cycleLengthChange);

  // ── Variability ─────────────────────────────────────────────
  const recent = lastN(cycleLengths, 6);
  const sd     = recent.length >= 2 ? stdDev(recent) : 0;
  const { score: variabilityScore, level: variabilityLevel } = variabilityLabel(sd);

  // ── Robust average ──────────────────────────────────────────
  const { average: averageCycleLength } = computeRobustAverageCycleLength(cycleLengths);

  // ── Trend (reuse existing detector) ─────────────────────────
  const trendSignal = detectCycleTrendSignal({ cycleLengths });
  const trend       = trendFromSignal(trendSignal);

  // ── Prediction drift (reuse existing detector) ──────────────
  const driftSignal    = detectPredictionDriftSignal({ previousPredictedDate, currentPredictedDate });
  const predictionDrift = driftSignal.debug?.shiftDays ?? 0;

  // ── Symptom frequency change ────────────────────────────────
  const allSymptoms = new Set([
    ...Object.keys(currentSymptoms),
    ...Object.keys(previousSymptoms),
  ]);

  const symptomFrequencyChange = {};
  for (const symptom of allSymptoms) {
    const prev    = previousSymptoms[symptom] ?? 0;
    const current = currentSymptoms[symptom]  ?? 0;
    symptomFrequencyChange[symptom] = {
      prev,
      current,
      change: current - prev,
    };
  }

  // ── New and resolved symptoms ───────────────────────────────
  const newSymptoms = Object.keys(currentSymptoms).filter(
    (s) => !previousSymptoms[s] || previousSymptoms[s] === 0
  );

  const resolvedSymptoms = Object.keys(previousSymptoms).filter(
    (s) => (!currentSymptoms[s] || currentSymptoms[s] === 0) && previousSymptoms[s] > 0
  );

  // ── Summary sentence ────────────────────────────────────────
  const summaryParts = [];

  if (currentCycleLength !== null && previousCycleLength !== null) {
    if (cycleLengthDirection === 'same') {
      summaryParts.push(`Your cycle length stayed consistent at ${currentCycleLength} days.`);
    } else {
      summaryParts.push(
        `Your cycle was ${Math.abs(cycleLengthChange)} day${Math.abs(cycleLengthChange) !== 1 ? 's' : ''} ${cycleLengthDirection} than last month (${currentCycleLength} vs ${previousCycleLength} days).`
      );
    }
  }

  if (newSymptoms.length > 0) {
    summaryParts.push(`New this cycle: ${newSymptoms.join(', ')}.`);
  }

  if (resolvedSymptoms.length > 0) {
    summaryParts.push(`No longer reported: ${resolvedSymptoms.join(', ')}.`);
  }

  if (trend !== 'stable') {
    summaryParts.push(`Your cycles appear to be ${trend}.`);
  }

  if (predictionDrift > 4) {
    summaryParts.push(`Bloom updated your next predicted date by ${predictionDrift} days based on recent data.`);
  }

  const summary = summaryParts.length > 0
    ? summaryParts.join(' ')
    : 'No significant changes detected this cycle.';

  return {
    cycleLengthChange,
    cycleLengthDirection,
    symptomFrequencyChange,
    newSymptoms,
    resolvedSymptoms,
    predictionDrift,
    variabilityScore,
    variabilityLevel,
    averageCycleLength,
    trend,
    summary,
    debug: {
      currentCycleLength,
      previousCycleLength,
      recentCycles: recent,
      stdDev:       Number(sd.toFixed(2)),
      cycleCount:   n,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Pattern detection for content boosting                             */
/* ------------------------------------------------------------------ */

/**
 * Detect recurring patterns from cycle + symptom history.
 * Used to boost relevant pamphlet content automatically.
 *
 * @param {Object} params
 * @param {number[]} params.cycleLengths       - all cycle lengths
 * @param {Object[]} params.symptomHistory     - array of { symptoms: string[], date: string }
 * @param {number}   params.minOccurrences     - how many times a pattern must repeat (default 3)
 * @returns {{ patterns: string[], boostTags: string[] }}
 */
export function detectRecurringPatterns({
  cycleLengths    = [],
  symptomHistory  = [],
  minOccurrences  = 3,
} = {}) {
  const patterns  = [];
  const boostTags = [];

  // ── Irregular cycles ────────────────────────────────────────
  const irregularSignal = detectIrregularCycleSignal({ cycleLengths });
  if (irregularSignal.show) {
    patterns.push('irregular_cycles');
    boostTags.push('irregular', 'hormonal_imbalance', 'cycle_variability');
  }

  // ── Symptom frequency counting ──────────────────────────────
  const symptomCounts = {};
  for (const entry of symptomHistory) {
    if (!entry?.symptoms) continue;
    for (const symptom of entry.symptoms) {
      symptomCounts[symptom] = (symptomCounts[symptom] || 0) + 1;
    }
  }

  const recurringSymptoms = Object.entries(symptomCounts)
    .filter(([, count]) => count >= minOccurrences)
    .map(([symptom]) => symptom);

  // Map recurring symptoms to boost tags
  const symptomTagMap = {
    cramps:       ['painful_periods', 'dysmenorrhea'],
    fatigue:      ['fatigue', 'energy', 'iron_deficiency'],
    headache:     ['headaches', 'hormonal_headaches'],
    bloating:     ['bloating', 'pms'],
    moodswings:   ['mood', 'pmdd', 'pms'],
    nausea:       ['nausea', 'hormonal_imbalance'],
    heavyflow:    ['heavy_bleeding', 'menorrhagia'],
    spotting:     ['spotting', 'irregular'],
    backpain:     ['pain', 'dysmenorrhea'],
    breasttender: ['pms', 'hormonal_changes'],
  };

  for (const symptom of recurringSymptoms) {
    patterns.push(`recurring_${symptom}`);
    const tags = symptomTagMap[symptom] || [symptom];
    boostTags.push(...tags);
  }

  // ── Cycle length patterns ────────────────────────────────────
  if (cycleLengths.length >= 3) {
    const recent = lastN(cycleLengths, 6);
    const avg    = mean(recent);

    if (avg > 35) {
      patterns.push('consistently_long_cycles');
      boostTags.push('long_cycles', 'pcos', 'hormonal_imbalance');
    }
    if (avg < 24) {
      patterns.push('consistently_short_cycles');
      boostTags.push('short_cycles', 'hormonal_imbalance');
    }
  }

  return {
    patterns,
    boostTags: [...new Set(boostTags)], // deduplicate
  };
}