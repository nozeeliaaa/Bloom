/**
 * bloomie-patois.test.js
 * Unit tests for the Patois normalisation pipeline, with focused coverage
 * of the exported fuzzyCorrect function.
 */

import { describe, it, expect } from "vitest";
import { fuzzyCorrect, normalizePatois, detectPatois, detectUserTone, detectUserToneWithScores, updateSessionTone } from "../bloomie-patois.js";
import { createCtx } from "../bloomie-session.js";

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

// ─── detectUserTone ───────────────────────────────────────────────────────────

describe("detectUserTone — distressed", () => {
  it("detects English distress signals", () => {
    expect(detectUserTone("i don't know what to do i'm so scared")).toBe("distressed");
    expect(detectUserTone("i'm freaking out right now")).toBe("distressed");
    expect(detectUserTone("help me i don't know anymore")).toBe("distressed");
    expect(detectUserTone("something wrong and i feel like i'm losing it")).toBe("distressed");
  });

  it("detects Patois distress signals", () => {
    expect(detectUserTone("mi nuh know wah fi do, mi worried bad")).toBe("distressed");
    expect(detectUserTone("sumn wrong and mi stress bad")).toBe("distressed");
  });
});

describe("detectUserTone — frustrated", () => {
  it("detects repeated-issue frustration", () => {
    expect(detectUserTone("this keeps happening every single time")).toBe("frustrated");
    expect(detectUserTone("sick and tired of dealing with this again")).toBe("frustrated");
  });

  it("detects Patois frustration", () => {
    expect(detectUserTone("nutten nuh work mi done wid dis")).toBe("frustrated");
  });
});

describe("detectUserTone — exhausted", () => {
  it("detects English exhaustion signals", () => {
    expect(detectUserTone("i'm exhausted and can't deal with this anymore")).toBe("exhausted");
    expect(detectUserTone("i feel drained i have no energy")).toBe("exhausted");
    expect(detectUserTone("running on empty honestly")).toBe("exhausted");
  });

  it("detects Patois exhaustion signals", () => {
    expect(detectUserTone("mi cya bada right now mi body tired")).toBe("exhausted");
    expect(detectUserTone("cyan deal, mi feel done out")).toBe("exhausted");
  });
});

describe("detectUserTone — angry", () => {
  it("detects anger signals", () => {
    expect(detectUserTone("i'm so vex right now this is ridiculous")).toBe("angry");
    expect(detectUserTone("mi vex bad, not fair at all")).toBe("angry");
  });
});

describe("detectUserTone — casual", () => {
  it("detects casual tone by keywords", () => {
    expect(detectUserTone("omg lol okay what")).toBe("casual");
    expect(detectUserTone("bruh idk what to think")).toBe("casual");
  });

  it("detects casual tone by short message length", () => {
    expect(detectUserTone("late period?")).toBe("casual");
    expect(detectUserTone("hi")).toBe("casual");
  });
});

describe("detectUserTone — neutral", () => {
  it("returns neutral for plain health questions", () => {
    expect(detectUserTone("my period is 5 days late and i am wondering what might be causing it")).toBe("neutral");
    expect(detectUserTone("i have been experiencing spotting between my periods for two weeks")).toBe("neutral");
  });

  it("returns neutral for empty or null input", () => {
    expect(detectUserTone("")).toBe("neutral");
    expect(detectUserTone(null)).toBe("neutral");
  });
});

describe("detectUserTone — priority ordering", () => {
  it("distressed takes priority over casual short-message rule", () => {
    // "help me" is ≤ 40 chars AND matches distressed — distressed wins
    expect(detectUserTone("help me")).toBe("distressed");
  });

  it("exhausted takes priority over casual", () => {
    expect(detectUserTone("mi done")).toBe("exhausted");
  });
});

// ─── NEW: weighted matching and overlap resolution ─────────────────────────────

describe("detectUserTone — casual + distressed overlap", () => {
  it("'lol I'm scared' → distressed (not casual)", () => {
    // A single casual word must not override a clear distress signal
    expect(detectUserTone("lol I'm scared")).toBe("distressed");
  });

  it("'omg help me' → distressed (not casual)", () => {
    expect(detectUserTone("omg help me")).toBe("distressed");
  });

  it("'lmao I don't know what to do' → distressed", () => {
    expect(detectUserTone("lmao I don't know what to do")).toBe("distressed");
  });
});

describe("detectUserTone — 'mi weak' casual slang vs fatigue context", () => {
  it("'mi weak' alone → casual (Patois laughing slang, no fatigue signals)", () => {
    expect(detectUserTone("mi weak")).toBe("casual");
  });

  it("'mi weak' with fatigue signals → exhausted (weighted match)", () => {
    // "drained" and "no energy" are exhausted signals; "mi weak" is casual slang
    // exhausted wins by priority even though casual also has 1 match
    expect(detectUserTone("mi weak, I'm drained")).toBe("exhausted");
  });

  it("'mi weak no energy' → exhausted", () => {
    expect(detectUserTone("mi weak no energy")).toBe("exhausted");
  });
});

describe("detectUserTone — short messages under 40 chars not casual when urgent", () => {
  it("'I'm scared' (short) → distressed, not casual", () => {
    expect(detectUserTone("I'm scared")).toBe("distressed");
  });

  it("'help me now' (short) → distressed, not casual", () => {
    expect(detectUserTone("help me now")).toBe("distressed");
  });

  it("'so vex' (short) → angry, not casual", () => {
    expect(detectUserTone("so vex")).toBe("angry");
  });

  it("'exhausted and drained' (short) → exhausted, not casual", () => {
    expect(detectUserTone("exhausted and drained")).toBe("exhausted");
  });

  it("'late period?' (short, no serious signals) → casual", () => {
    // Short message with no tone signals should still be casual
    expect(detectUserTone("late period?")).toBe("casual");
  });
});

describe("detectUserTone — mixed Patois/English tone detection", () => {
  it("'mi belly a hurt mi bad I'm scared' → distressed (mixed)", () => {
    expect(detectUserTone("mi belly a hurt mi bad I'm scared")).toBe("distressed");
  });

  it("'mi vex bad, this is ridiculous' → angry (mixed)", () => {
    expect(detectUserTone("mi vex bad, this is ridiculous")).toBe("angry");
  });

  it("'I feel drained, mi cya bada' → exhausted (mixed)", () => {
    expect(detectUserTone("I feel drained, mi cya bada")).toBe("exhausted");
  });

  it("'mi nuh know wah fi do I'm so worried' → distressed (Patois phrase + English)", () => {
    expect(detectUserTone("mi nuh know wah fi do I'm so worried")).toBe("distressed");
  });
});

describe("detectUserTone — priority resolution across 3 competing tones", () => {
  it("vex + drained + scared → distressed (highest priority wins)", () => {
    // All three serious tones match; distressed > angry > exhausted
    expect(detectUserTone("I'm vex and drained and scared")).toBe("distressed");
  });

  it("angry + exhausted signals (no distressed) → angry", () => {
    expect(detectUserTone("mi vex bad and running on empty")).toBe("angry");
  });

  it("exhausted + frustrated signals (no distressed/angry) → exhausted", () => {
    expect(detectUserTone("I'm exhausted and this keeps happening every time")).toBe("exhausted");
  });

  it("'upset' resolves to distressed, not angry", () => {
    // Per spec: 'upset' → distressed over angry
    expect(detectUserTone("I'm really upset")).toBe("distressed");
  });

  it("Patois expletive contributes to angry detection", () => {
    expect(detectUserTone("blood claat this is ridiculous")).toBe("angry");
  });
});

describe("detectUserToneWithScores — returns scores alongside tone", () => {
  it("returns tone and scores object", () => {
    const { tone, scores } = detectUserToneWithScores("I'm scared and panicking");
    expect(tone).toBe("distressed");
    expect(scores.distressed).toBeGreaterThanOrEqual(1);
  });

  it("confidence is true when 2+ signals match", () => {
    const { confidence } = detectUserToneWithScores("I'm scared and worried and don't know what to do");
    expect(confidence).toBe(true);
  });

  it("neutral returns empty scores and false confidence", () => {
    // Long enough to not trigger the short-message casual signal, no tone words
    const { tone, confidence } = detectUserToneWithScores("my period is 5 days late and i am wondering what might be causing it");
    expect(tone).toBe("neutral");
    expect(confidence).toBe(false);
  });
});

describe("updateSessionTone — session tone stability", () => {
  it("sets currentTone on first message", () => {
    const ctx = createCtx();
    updateSessionTone(ctx, "I'm scared");
    expect(ctx.currentTone).toBe("distressed");
  });

  it("stores previousTone on subsequent messages", () => {
    const ctx = createCtx();
    updateSessionTone(ctx, "I'm so vex");
    updateSessionTone(ctx, "I'm exhausted now");
    expect(ctx.previousTone).toBe("angry");
    expect(ctx.currentTone).toBe("exhausted");
  });

  it("holds previous tone when new message is ambiguous (neutral)", () => {
    const ctx = createCtx();
    updateSessionTone(ctx, "I'm really scared");
    // A neutral follow-up should not wipe the distressed context
    updateSessionTone(ctx, "my period is 5 days late");
    expect(ctx.currentTone).toBe("distressed");
  });
});
