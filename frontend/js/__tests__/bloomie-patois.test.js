/**
 * bloomie-patois.test.js
 * Unit tests for the Patois normalisation pipeline, with focused coverage
 * of the exported fuzzyCorrect function.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { fuzzyCorrect, normalizePatois, detectPatois, detectUserTone, detectUserToneWithScores, updateSessionTone, _resetFuzzyCache, _getFuzzyCacheHits } from "../bloomie-patois.js";
import { createCtx } from "../bloomie-session.js";

// ─── fuzzyCorrect ─────────────────────────────────────────────────────────────

describe("fuzzyCorrect - exact matches", () => {
  it("returns the term itself when input is already correct", () => {
    expect(fuzzyCorrect("pregnancy")).toBe("pregnancy");
    expect(fuzzyCorrect("period")).toBe("period");
    expect(fuzzyCorrect("ovulation")).toBe("ovulation");
    expect(fuzzyCorrect("spotting")).toBe("spotting");
    expect(fuzzyCorrect("pcos")).toBe("pcos");
    expect(fuzzyCorrect("iud")).toBe("iud");
  });
});

describe("fuzzyCorrect - threshold=1 for tokens < 8 chars", () => {
  it("corrects a dropped letter in a short term", () => {
    expect(fuzzyCorrect("dizy")).toBe("dizzy");       // 4 chars, dist 1
    expect(fuzzyCorrect("perod")).toBe("period");     // 5 chars, dist 1
    expect(fuzzyCorrect("nausia")).toBe("nausea");    // 6 chars, dist 1
  });

  it("corrects transpositions in short terms via phonetic table (Damerau-Levenshtein)", () => {
    // "peroid" is in PHONETIC_VARIANTS - caught before Levenshtein runs.
    expect(fuzzyCorrect("peroid")).toBe("period");
  });

  it("does NOT correct when distance exceeds 1 for short terms", () => {
    // "dzy" fails both the length proportion guard and dist > 1
    expect(fuzzyCorrect("dzy")).toBeNull();
  });
});

describe("fuzzyCorrect - threshold=2 for tokens ≥ 8 chars", () => {
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

describe("fuzzyCorrect - null cases", () => {
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

// ─── normalizePatois - medical misspelling correction end-to-end ──────────────
// normalizePatois() calls fuzzyCorrect() internally (Stage 3), so the full
// pipeline result is available from a single normalizePatois() call.

describe("normalizePatois - medical term fuzzy correction end-to-end", () => {
  it("corrects a misspelled medical term in plain English input", () => {
    const result = normalizePatois("i have been spoting between my periods");
    expect(result).toMatch(/spotting/);
  });

  it("corrects a misspelled long medical term not in the Patois dictionary", () => {
    // "ovultaion" (dist=1, DL transposition from "ovulation")
    const result = normalizePatois("my ovultaion was late this month");
    expect(result).toMatch(/ovulation/);
  });

  it("corrects pregnacy to pregnancy", () => {
    const result = normalizePatois("i think i might have a pregnacy");
    expect(result).toMatch(/pregnancy/);
  });

  it("does not corrupt correct medical terms already in the text", () => {
    const result = normalizePatois("my ovulation was late this month");
    expect(result).toMatch(/ovulation/);
  });
});

// ─── normalizePatois - Patois pipeline unchanged ─────────────────────────────

describe("normalizePatois - Patois normalisation still works", () => {
  it("translates a basic Patois phrase", () => {
    const result = normalizePatois("mi belly a hurt");
    expect(result).toMatch(/stomach pain|cramp/i);
  });

  it("handles code-switching", () => {
    const result = normalizePatois("my period late an mi belly a hurt");
    expect(result).toMatch(/period/);
    expect(result).toMatch(/stomach|cramp/i);
  });

  it("does not append synthetic routing boosters to the normalized text", () => {
    expect(normalizePatois("Heavy BLEEDING")).toBe("heavy bleeding");
    expect(normalizePatois("my period late")).toBe("my period late");
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

describe("detectUserTone - distressed", () => {
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

describe("detectUserTone - frustrated", () => {
  it("detects repeated-issue frustration", () => {
    expect(detectUserTone("this keeps happening every single time")).toBe("frustrated");
    expect(detectUserTone("sick and tired of dealing with this again")).toBe("frustrated");
  });

  it("detects Patois frustration", () => {
    expect(detectUserTone("nutten nuh work mi done wid dis")).toBe("frustrated");
  });
});

describe("detectUserTone - exhausted", () => {
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

describe("detectUserTone - angry", () => {
  it("detects anger signals", () => {
    expect(detectUserTone("i'm so vex right now this is ridiculous")).toBe("angry");
    expect(detectUserTone("mi vex bad, not fair at all")).toBe("angry");
  });
});

describe("detectUserTone - casual", () => {
  it("detects casual tone by keywords", () => {
    expect(detectUserTone("omg lol okay what")).toBe("casual");
    expect(detectUserTone("bruh idk what to think")).toBe("casual");
  });

  it("detects casual tone by short message length", () => {
    expect(detectUserTone("late period?")).toBe("casual");
    expect(detectUserTone("hi")).toBe("casual");
  });
});

describe("detectUserTone - neutral", () => {
  it("returns neutral for plain health questions", () => {
    expect(detectUserTone("my period is 5 days late and i am wondering what might be causing it")).toBe("neutral");
    expect(detectUserTone("i have been experiencing spotting between my periods for two weeks")).toBe("neutral");
  });

  it("returns neutral for empty or null input", () => {
    expect(detectUserTone("")).toBe("neutral");
    expect(detectUserTone(null)).toBe("neutral");
  });
});

describe("detectUserTone - priority ordering", () => {
  it("distressed takes priority over casual short-message rule", () => {
    // "help me" is ≤ 40 chars AND matches distressed - distressed wins
    expect(detectUserTone("help me")).toBe("distressed");
  });

  it("exhausted takes priority over casual", () => {
    expect(detectUserTone("mi done")).toBe("exhausted");
  });
});

// ─── NEW: weighted matching and overlap resolution ─────────────────────────────

describe("detectUserTone - casual + distressed overlap", () => {
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

describe("detectUserTone - 'mi weak' casual slang vs fatigue context", () => {
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

describe("detectUserTone - short messages under 40 chars not casual when urgent", () => {
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

describe("detectUserTone - mixed Patois/English tone detection", () => {
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

describe("detectUserTone - priority resolution across 3 competing tones", () => {
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

describe("detectUserToneWithScores - returns scores alongside tone", () => {
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

// ─── normalizePatois - new conversational Patois phrases ─────────────────────

describe("normalizePatois - frustration, agreement, and conversational phrases", () => {
  it("normalizes 'u nuh understand' → 'you don't understand'", () => {
    expect(normalizePatois("u nuh understand")).toMatch(/you don't understand/i);
  });

  it("normalizes 'dat nuh right' → 'that's not right'", () => {
    expect(normalizePatois("dat nuh right")).toMatch(/that's not right/i);
  });

  it("normalizes 'u useless' → 'you're useless'", () => {
    expect(normalizePatois("u useless")).toMatch(/you're useless/i);
  });

  it("normalizes 'mi agree' → 'i agree'", () => {
    expect(normalizePatois("mi agree")).toMatch(/i agree/i);
  });

  it("normalizes 'start ova' → 'start over'", () => {
    expect(normalizePatois("start ova")).toMatch(/start over/i);
  });

  it("normalizes 'wah gwaan' → 'what's going on'", () => {
    expect(normalizePatois("wah gwaan")).toMatch(/what's going on/i);
  });

  it("normalizes 'help mi' → 'help me'", () => {
    expect(normalizePatois("help mi")).toMatch(/help me/i);
  });

  it("normalizes 'kmt' to frustration signal", () => {
    expect(normalizePatois("kmt")).toMatch(/frustrated/i);
  });

  it("normalizes 'look yah nuh' as a pause/hold signal", () => {
    expect(normalizePatois("look yah nuh")).toMatch(/wait hold on/i);
  });

  it("normalizes 'wah going on wid me' to concern framing", () => {
    expect(normalizePatois("wah going on wid me")).toMatch(/what is going on with me/i);
    expect(normalizePatois("wah going on wid me")).toMatch(/feel off|unwell/i);
  });

  it("normalizes 'it nuh come yet' to late-period phrasing", () => {
    expect(normalizePatois("it nuh come yet")).toMatch(/period has not come yet/i);
  });

  it("normalizes 'cho man' as frustration marker", () => {
    expect(normalizePatois("cho man")).toMatch(/frustrated/i);
  });

  it("normalizes 'condom bruk' to unprotected-sex signal", () => {
    expect(normalizePatois("condom bruk")).toMatch(/condom broke unprotected sex/i);
  });

  it("normalizes 'mi nuh feel right' robustly", () => {
    expect(normalizePatois("mi nuh feel right")).toMatch(/do not feel right/i);
  });

  it("normalizes heavy-flow metaphor phrasing", () => {
    expect(normalizePatois("mi period heavy like river")).toMatch(/very heavy bleeding/i);
  });

  it("normalizes minor support fear phrasing", () => {
    expect(normalizePatois("mi scared fi tell mi mama")).toMatch(/scared to tell my mom/i);
  });

  it("normalizes postpartum low mood phrasing", () => {
    expect(normalizePatois("mi nuh feel happy after baby")).toMatch(/postpartum low mood/i);
  });

  it("normalizes 'mi vex' → 'i'm angry'", () => {
    expect(normalizePatois("mi vex")).toMatch(/i'm angry/i);
  });

  it("normalizes 'mi cyan cope' → 'i can't cope'", () => {
    expect(normalizePatois("mi cyan cope")).toMatch(/i can't cope/i);
  });

  it("normalizes 'nuh mind' → 'never mind'", () => {
    expect(normalizePatois("nuh mind")).toMatch(/never mind/i);
  });
});

describe("updateSessionTone - session tone stability", () => {
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

// ─── NEW: fuzzyCorrect - phonetic variants ────────────────────────────────────

describe("fuzzyCorrect - phonetic variants (panadol)", () => {
  it("panandol → panadol", () => expect(fuzzyCorrect("panandol")).toBe("panadol"));
  it("panadoll → panadol", () => expect(fuzzyCorrect("panadoll")).toBe("panadol"));
  it("panaodl  → panadol", () => expect(fuzzyCorrect("panaodl")).toBe("panadol"));
  it("pnadol   → panadol", () => expect(fuzzyCorrect("pnadol")).toBe("panadol"));
});

describe("fuzzyCorrect - phonetic variants (pregnancy / spotting / bleeding)", () => {
  it("pregnat  → pregnant",  () => expect(fuzzyCorrect("pregnat")).toBe("pregnant"));
  it("pregnacy → pregnancy", () => expect(fuzzyCorrect("pregnacy")).toBe("pregnancy"));
  it("spotian  → spotting",  () => expect(fuzzyCorrect("spotian")).toBe("spotting"));
  it("bleding  → bleeding",  () => expect(fuzzyCorrect("bleding")).toBe("bleeding"));
  it("disscharge → discharge", () => expect(fuzzyCorrect("disscharge")).toBe("discharge"));
  it("ibupropen → ibuprofen", () => expect(fuzzyCorrect("ibupropen")).toBe("ibuprofen"));
  it("menstral → menstrual",  () => expect(fuzzyCorrect("menstral")).toBe("menstrual"));
  it("endometrosis → endometriosis", () => expect(fuzzyCorrect("endometrosis")).toBe("endometriosis"));
  it("menapose → menopause",  () => expect(fuzzyCorrect("menapose")).toBe("menopause"));
});

// ─── NEW: fuzzyCorrect - Levenshtein catches ──────────────────────────────────

describe("fuzzyCorrect - Levenshtein catches (not in phonetic table)", () => {
  it("spottng  → spotting  (deletion)",      () => expect(fuzzyCorrect("spottng")).toBe("spotting"));
  it("bleedin  → bleeding  (deletion)",      () => expect(fuzzyCorrect("bleedin")).toBe("bleeding"));
  it("craming  → cramping  (phonetic/dl)",   () => expect(fuzzyCorrect("craming")).toBe("cramping"));
  it("nausous  → nauseous  (substitution)",  () => expect(fuzzyCorrect("nausous")).toBe("nauseous"));
  it("dizy     → dizzy     (deletion)",      () => expect(fuzzyCorrect("dizy")).toBe("dizzy"));
  it("ibprofen → ibuprofen (deletion)",      () => expect(fuzzyCorrect("ibprofen")).toBe("ibuprofen"));
  it("perod    → period    (deletion)",      () => expect(fuzzyCorrect("perod")).toBe("period"));
  it("ovultaion → ovulation (transposition)", () => expect(fuzzyCorrect("ovultaion")).toBe("ovulation"));
});

// ─── NEW: fuzzyCorrect - protected Patois tokens ─────────────────────────────

describe("fuzzyCorrect - protected tokens must NOT be corrected", () => {
  it("mi  → null (protected)",  () => expect(fuzzyCorrect("mi")).toBeNull());
  it("nuh → null (protected)",  () => expect(fuzzyCorrect("nuh")).toBeNull());
  it("fi  → null (too short)",  () => expect(fuzzyCorrect("fi")).toBeNull());
  it("bad → null (protected)",  () => expect(fuzzyCorrect("bad")).toBeNull());
});

// ─── NEW: fuzzyCorrect - short words not fuzzily corrected ───────────────────

describe("fuzzyCorrect - short words must NOT be fuzzily corrected", () => {
  it("pad → null (not corrected to 'pain')", () => expect(fuzzyCorrect("pad")).toBeNull());
  it("pms → null (too short for fuzzy)",     () => expect(fuzzyCorrect("pms")).toBeNull());
});

// ─── NEW: full sentence correction (via normalizePatois which calls fuzzyCorrect) ──

describe("full sentence correction through normalizePatois pipeline", () => {
  it("corrects 'bleding' in a mixed Patois/English sentence", () => {
    expect(normalizePatois("mi belly a hurt and i have bleding")).toMatch(/bleeding/);
  });

  it("corrects 'panandol' and 'craming' in a Patois sentence", () => {
    const result = normalizePatois("me need panandol fi di craming");
    expect(result).toMatch(/panadol/);
    expect(result).toMatch(/cramping/);
  });

  it("corrects 'pregnent' and 'spotian' in a plain English sentence", () => {
    const result = normalizePatois("i think im pregnent and spotian");
    expect(result).toMatch(/pregnant/);
    expect(result).toMatch(/spotting/);
  });
});

// ─── NEW: fuzzyCorrect - correction cache ────────────────────────────────────

describe("fuzzyCorrect - correction cache", () => {
  beforeEach(() => _resetFuzzyCache());

  it("returns same result on second call (cached)", () => {
    const first  = fuzzyCorrect("bleding");
    const second = fuzzyCorrect("bleding");
    expect(first).toBe("bleeding");
    expect(second).toBe("bleeding");
  });

  it("increments cache hit counter on second call", () => {
    fuzzyCorrect("panandol");           // miss - populates cache
    fuzzyCorrect("panandol");           // hit
    expect(_getFuzzyCacheHits()).toBe(1);
  });

  it("third call also hits cache", () => {
    fuzzyCorrect("menstral");
    fuzzyCorrect("menstral");
    fuzzyCorrect("menstral");
    expect(_getFuzzyCacheHits()).toBe(2);
  });
});
