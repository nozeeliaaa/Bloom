/**
 * bloom-utils.js
 * ─────────────────────────────────────────────────────────────
 * Shared utility functions for Bloom cycle and symptom engines.
 *
 * Canonical single source of truth — import from here instead of
 * defining local copies in each engine file.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Convert Date|number|string to Date safely */
export function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d;
}

/** Normalize to local midnight */
export function startOfDay(d) {
  const x = toDate(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole-day difference: (b − a) in days */
export function diffDays(a, b) {
  return Math.floor((startOfDay(b).getTime() - startOfDay(a).getTime()) / MS_PER_DAY);
}

/** Absolute whole-day difference */
export function diffDaysAbs(a, b) {
  return Math.abs(diffDays(a, b));
}

/** Clamp numeric value */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Mean of array */
export function mean(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return arr.reduce((sum, x) => sum + x, 0) / arr.length;
}

/** Median of array */
export function median(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Standard deviation of array */
export function stdDev(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

/** Safe recent slice */
export function lastN(arr, n) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(Math.max(0, arr.length - n));
}

/** Simple linear slope over equally spaced points */
export function slopeOfSeries(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const n = values.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (xs[i] - xMean) * (values[i] - yMean);
    denominator += Math.pow(xs[i] - xMean, 2);
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Build consistent signal object */
export function makeSignal({
  code,
  level,
  show,
  title    = "",
  message  = "",
  guidance = "",
  debug    = {},
  category = "general",
} = {}) {
  return { code, level, show, title, message, guidance, category, debug };
}
