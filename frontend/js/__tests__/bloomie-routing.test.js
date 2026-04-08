/**
 * bloomie-routing.test.js
 * Regression tests for intent detection and routing logic.
 * Focus: safety-critical signal combinations that must never mis-route.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeText,
  looksLikeGibberish,
  scoreSignals,
  resolveSignals,
} from "../bloomie-routing.js";

// ─── normalizeText ────────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("lowercases and trims", () => {
    expect(normalizeText("  Heavy BLEEDING  ")).toBe("heavy bleeding");
  });

  it("strips special chars except apostrophe", () => {
    expect(normalizeText("it's late!!")).toBe("it's late");
  });

  it("handles null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

// ─── looksLikeGibberish ───────────────────────────────────────────────────────

describe("looksLikeGibberish", () => {
  it("accepts known short words", () => {
    expect(looksLikeGibberish("hi")).toBe(false);
    expect(looksLikeGibberish("omg")).toBe(false);
  });

  it("rejects single unknown char", () => {
    expect(looksLikeGibberish("x")).toBe(true);
  });

  it("rejects repeated character strings", () => {
    expect(looksLikeGibberish("aaaaaaa")).toBe(true);
  });

  it("accepts normal health phrases", () => {
    expect(looksLikeGibberish("late period")).toBe(false);
    expect(looksLikeGibberish("heavy bleeding")).toBe(false);
  });
});

// ─── scoreSignals ─────────────────────────────────────────────────────────────

describe("scoreSignals — late period", () => {
  it("scores 'my period is late'", () => {
    const { has } = scoreSignals("my period is late");
    expect(has("late")).toBe(true);
  });

  it("scores 'missed period'", () => {
    const { has } = scoreSignals("i missed my period this month");
    expect(has("late")).toBe(true);
  });
});

describe("scoreSignals — heavy bleeding", () => {
  it("scores 'heavy bleeding'", () => {
    const { has } = scoreSignals("i have heavy bleeding");
    expect(has("heavy")).toBe(true);
  });

  it("scores patois: 'bleed bad'", () => {
    const { has } = scoreSignals("me bleed bad");
    expect(has("heavy")).toBe(true);
  });

  it("scores soaking through products", () => {
    const { has } = scoreSignals("i'm soaking through pads every hour");
    expect(has("heavy")).toBe(true);
  });
});

describe("scoreSignals — spotting", () => {
  it("scores 'spotting'", () => {
    const { has } = scoreSignals("i noticed some spotting");
    expect(has("spot")).toBe(true);
  });

  it("scores 'brown discharge'", () => {
    const { has } = scoreSignals("i have brown discharge between periods");
    expect(has("spot")).toBe(true);
  });
});

describe("scoreSignals — mood", () => {
  it("scores 'anxious and tired'", () => {
    const { has } = scoreSignals("i feel anxious and so tired");
    expect(has("mood")).toBe(true);
  });
});

describe("scoreSignals — pelvic pain", () => {
  it("scores 'cramps'", () => {
    const { has } = scoreSignals("i have really bad cramps");
    expect(has("pelvic")).toBe(true);
  });

  it("scores 'belly hurt'", () => {
    const { has } = scoreSignals("my belly hurts so much");
    expect(has("pelvic")).toBe(true);
  });
});

describe("scoreSignals — pregnancy", () => {
  it("scores 'might be pregnant'", () => {
    const { has } = scoreSignals("i think i might be pregnant");
    expect(has("pregnancy")).toBe(true);
  });

  it("scores 'unprotected sex'", () => {
    const { has } = scoreSignals("i had unprotected sex last week");
    expect(has("pregnancy")).toBe(true);
  });

  it("scores pregnancy-test phrasing without explicit 'pregnancy' keyword", () => {
    const triggerPhrases = [
      "pregnancy test",
      "positive test",
      "negative test",
      "i took a test",
      "i took a pregnancy test",
      "my test came back positive",
      "my test came back negative",
    ];
    triggerPhrases.forEach((phrase) => {
      const { has } = scoreSignals(phrase);
      expect(has("pregnancy")).toBe(true);
    });
  });

  it("does not score non-pregnancy 'test' language", () => {
    const nonPregnancyPhrases = [
      "blood test",
      "iron test",
      "urine test",
      "let me test something",
      "test results",
    ];
    nonPregnancyPhrases.forEach((phrase) => {
      const { has } = scoreSignals(phrase);
      expect(has("pregnancy")).toBe(false);
    });
  });
});

// ─── resolveSignals — SAFETY CRITICAL combos ─────────────────────────────────

describe("resolveSignals — safety-critical combinations", () => {
  it("late + pregnancy → LATE_TEST_Q", () => {
    const { sig, has } = scoreSignals("my period is late and i think i might be pregnant");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("LATE_TEST_Q");
  });

  it("heavy + mood → HEAVY_INTRO", () => {
    const { sig, has } = scoreSignals("heavy bleeding and i feel so tired and low mood");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("HEAVY_INTRO");
  });

  it("pelvic + heavy → HEAVY_RISK_SYMPTOMS", () => {
    const { sig, has } = scoreSignals("heavy bleeding with bad pelvic pain and cramps");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("HEAVY_RISK_SYMPTOMS");
  });

  it("late + pelvic (no heavy) → LATE_INTRO", () => {
    const { sig, has } = scoreSignals("my period is late and i have cramps");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("LATE_INTRO");
  });

  it("spot + discharge → SPOT_PROVIDER_SOON", () => {
    const { sig, has } = scoreSignals("spotting and unusual discharge with smell");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("SPOT_PROVIDER_SOON");
  });

  it("spot + pregnancy → SPOT_PREG_INFO", () => {
    const { sig, has } = scoreSignals("i'm spotting and i think i might be pregnant");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("SPOT_PREG_INFO");
  });

  it("discharge alone → ELSE_DISCHARGE", () => {
    const { sig, has } = scoreSignals("i have unusual discharge with odor");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("ELSE_DISCHARGE");
  });

  it("no combo match returns null (single signal falls to caller)", () => {
    const { sig, has } = scoreSignals("my period is late");
    const route = resolveSignals(sig, has);
    // Late alone has no multi-signal rule — returns null so caller handles it
    expect(route).toBeNull();
  });
});
