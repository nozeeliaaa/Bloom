/**
 * bloomie-patois.test.js
 * Unit tests for the Patois normalisation pipeline, with focused coverage
 * of the exported fuzzyCorrect function.
 */

import { describe, it, expect } from "vitest";
import { fuzzyCorrect, normalizePatois, detectPatois } from "../bloomie-patois.js";

// ─── fuzzyCorrect ─────────────────────────────────────────────────────────────

describe("fuzzyCorrect — exact matches", () => {
  it("returns the term itself when input is already correct", () => {
    expect(fuzzyCorrect("pregnancy")).toBe("pregnancy");
    expect(fuzzyCorrect("period")).toBe("period");
    expect(fuzzyCorrect("ovulation")).toBe("ovulation");
    expect(fuzzyCorrect("spotting")).toBe("spotting");
    expect(fuzzyCorrect("pcos")).toBe("pcos");
    expect(fuzzyCorrect("iud")).toBe("iud");
  });
});

describe("fuzzyCorrect — threshold=1 for tokens < 8 chars", () => {
  it("corrects a dropped letter in a short term", () => {
    expect(fuzzyCorrect("dizy")).toBe("dizzy");       // 4 chars, dist 1
    expect(fuzzyCorrect("perod")).toBe("period");     // 5 chars, dist 1
    expect(fuzzyCorrect("nausia")).toBe("nausea");    // 6 chars, dist 1
  });

  it("does NOT correct transpositions in short terms (standard Levenshtein, dist=2 > threshold=1)", () => {
    // "peroid" is a transposition of "period" but costs 2 ops in standard Levenshtein —
    // threshold for 6-char tokens is 1, so no correction is made.
    expect(fuzzyCorrect("peroid")).toBeNull();
  });

  it("does NOT correct when distance exceeds 1 for short terms", () => {
    // "dzy" fails both the length proportion guard and dist > 1
    expect(fuzzyCorrect("dzy")).toBeNull();
  });
});

describe("fuzzyCorrect — threshold=2 for tokens ≥ 8 chars", () => {
  it("corrects a single dropped letter in a long term", () => {
    expect(fuzzyCorrect("pregnacy")).toBe("pregnancy");   // 8 chars, dist 1
    expect(fuzzyCorrect("spoting")).toBe("spotting");     // 7 chars but dist 1 ≤ threshold 1
    expect(fuzzyCorrect("bleding")).toBe("bleeding");     // 7 chars, dist 1 ≤ threshold 1
  });

  it("corrects a transposition in a long term (dist=2)", () => {
    expect(fuzzyCorrect("ovultaion")).toBe("ovulation");  // 9 chars, dist 2
  });

  it("corrects a dropped letter + substitution in a long term", () => {
    expect(fuzzyCorrect("menstraton")).toBe("menstruation"); // 10 chars, dist 2
  });
});

describe("fuzzyCorrect — null cases", () => {
  it("returns null for unrelated words", () => {
    expect(fuzzyCorrect("hello")).toBeNull();
    expect(fuzzyCorrect("cat")).toBeNull();
    expect(fuzzyCorrect("table")).toBeNull();
  });

  it("returns null for tokens under minimum length", () => {
    expect(fuzzyCorrect("")).toBeNull();
    expect(fuzzyCorrect("ab")).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(fuzzyCorrect(null)).toBeNull();
    expect(fuzzyCorrect(undefined)).toBeNull();
  });
});

// ─── normalizePatois — medical misspelling correction end-to-end ──────────────

describe("normalizePatois — medical term fuzzy correction end-to-end", () => {
  it("corrects a misspelled medical term in plain English input", () => {
    const result = normalizePatois("i have been spoting between my periods");
    expect(result).toMatch(/spotting/);
  });

  it("corrects a misspelled long medical term not in the Patois dictionary", () => {
    // "ovultaion" (dist=2 from "ovulation") — not in WORD_MAP so only caught by medical fuzzy
    const result = normalizePatois("my ovultaion was late this month");
    expect(result).toMatch(/ovulation/);
  });

  it("prefers the closer medical match over a more distant Patois near-miss", () => {
    // "pregnacy" is dist=1 from "pregnancy" and dist=2 from the Patois entry "pregnant".
    // The combined scorer should pick "pregnancy".
    const result = normalizePatois("i think i might have a pregnacy");
    expect(result).toMatch(/pregnancy/);
  });

  it("does not corrupt correct medical terms already in the text", () => {
    const result = normalizePatois("my ovulation was late this month");
    expect(result).toMatch(/ovulation/);
  });
});

// ─── normalizePatois — Patois pipeline unchanged ─────────────────────────────

describe("normalizePatois — Patois normalisation still works", () => {
  it("translates a basic Patois phrase", () => {
    const result = normalizePatois("mi belly a hurt");
    expect(result).toMatch(/stomach pain|cramp/i);
  });

  it("handles code-switching", () => {
    const result = normalizePatois("my period late an mi belly a hurt");
    expect(result).toMatch(/period/);
    expect(result).toMatch(/stomach|cramp/i);
  });
});

// ─── detectPatois ─────────────────────────────────────────────────────────────

describe("detectPatois", () => {
  it("detects Patois signals", () => {
    expect(detectPatois("mi belly a hurt")).toBe(true);
    expect(detectPatois("wah gwaan")).toBe(true);
  });

  it("returns false for plain English", () => {
    expect(detectPatois("my period is late")).toBe(false);
    expect(detectPatois("i have cramping")).toBe(false);
  });
});
