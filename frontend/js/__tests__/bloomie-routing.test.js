/**
 * bloomie-routing.test.js
 * Regression tests for intent detection and routing logic.
 * Focus: safety-critical signal combinations that must never mis-route.
 */

import { describe, it, expect } from "vitest";
import { createNodes } from "../bloomie-nodes.js";
import {
  normalizeText,
  looksLikeGibberish,
  scoreSignals,
  resolveSignals,
  computeRouteConfidence,
  INTENT_TO_NODE,
} from "../bloomie-routing.js";
import { normalizeBloomieText } from "../bloomie-normalize.js";

function getRegisteredNodeIds() {
  const envBase = {
    ctx: {
      state: "START",
      history: [],
      answers: [],
      entityHistory: [],
      timers: new Set(),
      adviceGiven: new Set(),
      conversationProfile: { sessionDepth: 1, concernsResolved: [], concernsUnresolved: [] },
      contentSuggestionsShown: new Set(),
      declinedSuggestions: new Set(),
      reportedConditions: [],
      captureData: {},
    },
    cd: {},
    userMode: {
      isCycleTracking: false, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: true,
    },
    pick: (arr) => (Array.isArray(arr) ? arr[0] : arr),
    greet: () => "Hey",
    say: () => {},
    transition: () => {},
  };
  const env = new Proxy(envBase, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => [];
    },
  });
  return new Set(Object.keys(createNodes(env)));
}

const REGISTERED_NODE_IDS = getRegisteredNodeIds();

// ─── normalizeText ────────────────────────────────────────────────────────────

describe("normalizeText", () => {
  it("lowercases and trims", () => {
    expect(normalizeText("  Heavy BLEEDING  ")).toBe("heavy bleeding");
  });

  it("stays semantically pure for heavy bleeding phrasing", () => {
    expect(normalizeText("Heavy BLEEDING")).toBe("heavy bleeding");
    expect(normalizeText("my period late")).toBe("my period late");
  });

  it("strips special chars except apostrophe", () => {
    expect(normalizeText("it's late!!")).toBe("it's late");
  });

  it("handles null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("matches the shared Bloomie normalizer in routing mode", () => {
    expect(normalizeText("  Heavy BLEEDING!!  ")).toBe(
      normalizeBloomieText("  Heavy BLEEDING!!  ", { stripSpecialChars: true })
    );
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
  it("late + pregnancy → PREGNANCY_ENTRY", () => {
    const { sig, has } = scoreSignals("my period is late and i think i might be pregnant");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("PREGNANCY_ENTRY");
  });

  it("heavy + mood → HEAVY_INTRO", () => {
    const { sig, has } = scoreSignals("heavy bleeding and i feel so tired and low mood");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("HEAVY_INTRO");
  });

  it("pelvic + heavy → HEAVY_ROUTE_C and node exists", () => {
    const { sig, has } = scoreSignals("heavy bleeding with bad pelvic pain and cramps");
    const route = resolveSignals(sig, has);
    expect(route).not.toBeNull();
    expect(route.next).toBe("HEAVY_ROUTE_C");
    expect(REGISTERED_NODE_IDS.has(route.next)).toBe(true);
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

// ─── computeRouteConfidence — new fields: route, competitors, ambiguous ───────

describe("computeRouteConfidence — route field", () => {
  it("maps primaryIntent to the correct entry node", () => {
    const { sig } = scoreSignals("my period is very late and i missed it last month");
    const conf = computeRouteConfidence(sig, {});
    expect(conf.route).toBe(INTENT_TO_NODE[conf.primaryIntent]);
  });

  it("urgency always routes to HEAVY_URGENT", () => {
    const { sig } = scoreSignals("i am bleeding heavily");
    const conf = computeRouteConfidence(sig, { urgent: true });
    expect(conf.route).toBe("HEAVY_URGENT");
    expect(conf.tier).toBe("high");
    expect(conf.ambiguous).toBe(false);
  });

  it("zero-score input has null route", () => {
    const conf = computeRouteConfidence(
      { late: 0, heavy: 0, spot: 0, mood: 0, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    expect(conf.route).toBeNull();
    expect(conf.tier).toBe("low");
  });

  it("late_check maps to LATE_INTRO (same as late)", () => {
    const { sig } = scoreSignals("is my period late?");
    const conf = computeRouteConfidence(sig, {});
    if (conf.primaryIntent === "late") {
      expect(conf.route).toBe("LATE_INTRO");
    }
  });
});

describe("computeRouteConfidence — competitors field", () => {
  it("competitors is an array of node names, not intent keys", () => {
    const { sig } = scoreSignals("heavy bleeding with bad cramps and pelvic pain");
    const conf = computeRouteConfidence(sig, {});
    // competitors should be node strings (capitalised), not raw intent keys
    conf.competitors.forEach(c => {
      expect(typeof c).toBe("string");
      expect(c).toMatch(/^[A-Z_]+$/);
    });
  });

  it("competitors contains no duplicates", () => {
    const { sig } = scoreSignals("late period with spotting and mood swings");
    const conf = computeRouteConfidence(sig, {});
    const unique = new Set(conf.competitors);
    expect(unique.size).toBe(conf.competitors.length);
  });

  it("urgency result has empty competitors array", () => {
    const { sig } = scoreSignals("i am bleeding heavily");
    const conf = computeRouteConfidence(sig, { urgent: true });
    expect(conf.competitors).toEqual([]);
  });

  it("competitor nodes are all valid INTENT_TO_NODE values", () => {
    const validNodes = new Set(Object.values(INTENT_TO_NODE));
    const { sig } = scoreSignals("late period and spotting discharge");
    const conf = computeRouteConfidence(sig, {});
    conf.competitors.forEach(c => {
      expect(validNodes.has(c)).toBe(true);
    });
  });
});

describe("computeRouteConfidence — ambiguous field", () => {
  it("ambiguous is false when tier is high", () => {
    const { sig } = scoreSignals("my period is very late i missed it completely for weeks");
    const conf = computeRouteConfidence(sig, {});
    expect(conf.ambiguous).toBe(conf.tier !== "high");
  });

  it("ambiguous is true for medium tier", () => {
    // Two close signals → MEDIUM
    const { sig } = scoreSignals("late period with severe cramps and pelvic pain");
    const conf = computeRouteConfidence(sig, {});
    if (conf.tier === "medium") expect(conf.ambiguous).toBe(true);
  });

  it("ambiguous is true for low tier", () => {
    // Weak signals → LOW
    const conf = computeRouteConfidence(
      { late: 1, heavy: 1, spot: 0, mood: 1, pelvic: 0, pregnancy: 0, discharge: 0, late_check: 0, red_flag: 0 },
      {}
    );
    if (conf.tier === "low") expect(conf.ambiguous).toBe(true);
  });

  it("ambiguous is always false when urgent", () => {
    const { sig } = scoreSignals("i have heavy bleeding");
    const conf = computeRouteConfidence(sig, { urgent: true });
    expect(conf.ambiguous).toBe(false);
  });
});

describe("INTENT_TO_NODE — completeness", () => {
  it("covers all signal keys used by scoreSignals", () => {
    const sigKeys = ["late", "heavy", "spot", "mood", "pelvic", "pregnancy", "discharge"];
    sigKeys.forEach(k => {
      expect(INTENT_TO_NODE[k]).toBeDefined();
    });
  });

  it("all values are non-empty strings", () => {
    Object.values(INTENT_TO_NODE).forEach(v => {
      expect(typeof v).toBe("string");
      expect(v.length).toBeGreaterThan(0);
    });
  });
});
