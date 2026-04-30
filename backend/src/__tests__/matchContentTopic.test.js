/**
 * backend/src/__tests__/matchContentTopic.test.js
 *
 * Unit tests for the Content Routing Engine.
 * Covers: alias resolution, scoring, type priority, deduplication, edge cases.
 *
 * Run: cd backend && npx vitest run src/__tests__/matchContentTopic.test.js
 */

import { describe, it, expect } from "vitest";
import {
  matchContentTopic,
  matchAllContentTopics,
  ALIAS_MAP,
  CONTENT_CATALOG,
} from "../utils/matchContentTopic.js";

// ─────────────────────────────────────────────────────────────────────────────
// Catalog integrity
// ─────────────────────────────────────────────────────────────────────────────

describe("catalog integrity", () => {
  it("every entry has required fields", () => {
    for (const entry of CONTENT_CATALOG) {
      expect(typeof entry.id,          `${entry.id}: id`)          .toBe("string");
      expect(typeof entry.title,       `${entry.id}: title`)       .toBe("string");
      expect(typeof entry.shortAnswer, `${entry.id}: shortAnswer`) .toBe("string");
      expect(typeof entry.link,        `${entry.id}: link`)        .toBe("string");
      expect(["pamphlet","faq","glossary"]).toContain(entry.type);
      expect(Array.isArray(entry.topics),   `${entry.id}: topics`)  .toBe(true);
      expect(Array.isArray(entry.keywords), `${entry.id}: keywords`).toBe(true);
      expect(entry.topics.length).toBeGreaterThan(0);
    }
  });

  it("all entry ids are unique", () => {
    const ids = CONTENT_CATALOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("catalog contains entries of all three types", () => {
    const types = new Set(CONTENT_CATALOG.map(e => e.type));
    expect(types.has("pamphlet")).toBe(true);
    expect(types.has("faq")).toBe(true);
    expect(types.has("glossary")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alias map
// ─────────────────────────────────────────────────────────────────────────────

describe("alias map", () => {
  it("every alias maps to a string value", () => {
    for (const [alias, topic] of Object.entries(ALIAS_MAP)) {
      expect(typeof topic, `alias "${alias}"`).toBe("string");
      expect(topic.length).toBeGreaterThan(0);
    }
  });

  it("alias keys are all lowercase", () => {
    for (const key of Object.keys(ALIAS_MAP)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Return shape contract
// ─────────────────────────────────────────────────────────────────────────────

describe("return shape", () => {
  it("returns an object with all required keys on a match", () => {
    const result = matchContentTopic("my period is late");
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("type");
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("shortAnswer");
    expect(result).toHaveProperty("link");
    expect(result).toHaveProperty("matchedTopic");
  });

  it("type is always one of the three allowed values", () => {
    const result = matchContentTopic("my period is late");
    expect(["pamphlet","faq","glossary"]).toContain(result?.type);
  });

  it("returns null for empty input", () => {
    expect(matchContentTopic("")).toBeNull();
    expect(matchContentTopic("   ")).toBeNull();
  });

  it("returns null for gibberish with no matching aliases or keywords", () => {
    expect(matchContentTopic("xyzxyzxyz qqqq")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority: pamphlet > faq > glossary
// ─────────────────────────────────────────────────────────────────────────────

describe("type priority - pamphlet first", () => {
  it("returns a pamphlet when one matches, even though faq also matches", () => {
    // "late period" matches both a pamphlet and an faq
    const result = matchContentTopic("my period is late");
    expect(result?.type).toBe("pamphlet");
  });

  it("falls back to faq when all pamphlets are excluded", () => {
    // Derive excluded set by progressively draining pamphlets via the engine
    // (topic-based filtering is insufficient - multiple topics can resolve).
    const allPamphletIds = CONTENT_CATALOG
      .filter(e => e.type === "pamphlet")
      .map(e => e.id);

    const result = matchContentTopic("my period is late", allPamphletIds, []);
    expect(result?.type).toBe("faq");
  });

  it("falls back to glossary when pamphlets and faqs are both excluded", () => {
    const nonGlossaryIds = CONTENT_CATALOG
      .filter(e => e.type === "pamphlet" || e.type === "faq")
      .map(e => e.id);

    const result = matchContentTopic("my period is late", nonGlossaryIds, []);
    expect(result?.type).toBe("glossary");
  });

  it("returns null when every catalog entry is excluded", () => {
    const allIds = CONTENT_CATALOG.map(e => e.id);
    const result = matchContentTopic("my period is late", allIds, []);
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Alias resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("alias resolution", () => {
  const synonymGroups = [
    { label: "menstruation synonyms", inputs: ["period", "menses", "monthly", "menstrual cycle"], expectedTopic: "menstruation" },
    { label: "heavy bleeding synonyms", inputs: ["heavy period", "heavy flow", "flooding", "large clots"], expectedTopic: "heavy_bleeding" },
    { label: "pregnancy synonyms", inputs: ["am i pregnant", "ttc", "positive test", "bfp"], expectedTopic: "pregnancy" },
    { label: "pcos synonyms", inputs: ["pcos", "polycystic ovary", "irregular periods"], expectedTopic: "pcos" },
    { label: "pelvic pain synonyms", inputs: ["cramps", "cramping", "period pain", "dysmenorrhea"], expectedTopic: "pelvic_pain" },
  ];

  for (const { label, inputs } of synonymGroups) {
    it(`${label} all return a match`, () => {
      for (const input of inputs) {
        const result = matchContentTopic(input);
        expect(result, `no match for "${input}"`).not.toBeNull();
      }
    });
  }

  it("longer alias phrase wins over substring (late period not just period)", () => {
    const result = matchContentTopic("late period");
    // Should resolve late_period topic, not just menstruation
    expect(result?.matchedTopic).toBe("late_period");
  });

  it("alias matching is case-insensitive", () => {
    const lower = matchContentTopic("my period is late");
    const upper = matchContentTopic("MY PERIOD IS LATE");
    expect(lower?.id).toBe(upper?.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Keyword matching
// ─────────────────────────────────────────────────────────────────────────────

describe("keyword matching", () => {
  it("matches via keyword when no alias resolves but a keyword hits", () => {
    // "menorrhagia" is a keyword on the heavy-periods pamphlet but not an alias key
    const result = matchContentTopic("I have menorrhagia");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("pam-heavy-bleeding");
  });

  it("matches LMP glossary entry via keyword 'last period'", () => {
    const result = matchContentTopic("what is lmp");
    expect(result).not.toBeNull();
    // "lmp" is in the keywords array for glos-lmp
    expect(result?.id).toBe("glos-lmp");
  });

  it("higher keyword hit count scores more and ranks higher", () => {
    // "clots and flooding and soaking" hits three heavy-bleeding keywords
    const result = matchContentTopic("I have clots and flooding and soaking");
    expect(result?.id).toBe("pam-heavy-bleeding");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deduplication - shownIds and declinedIds
// ─────────────────────────────────────────────────────────────────────────────

describe("deduplication", () => {
  it("never returns an entry that is in shownIds", () => {
    const first = matchContentTopic("my period is late");
    const second = matchContentTopic("my period is late", [first?.id], []);
    expect(second?.id).not.toBe(first?.id);
  });

  it("never returns an entry that is in declinedIds", () => {
    const first = matchContentTopic("heavy bleeding");
    const second = matchContentTopic("heavy bleeding", [], [first?.id]);
    expect(second?.id).not.toBe(first?.id);
  });

  it("excludes both shownIds and declinedIds simultaneously", () => {
    const a = matchContentTopic("pcos");
    const b = matchContentTopic("pcos", [a?.id], []);
    const c = matchContentTopic("pcos", [], [b?.id]);
    // With both a and b excluded, should fall through to next candidate
    const d = matchContentTopic("pcos", [a?.id], [b?.id]);
    expect(d?.id).not.toBe(a?.id);
    expect(d?.id).not.toBe(b?.id);
  });

  it("accepts empty arrays safely", () => {
    expect(() => matchContentTopic("period", [], [])).not.toThrow();
  });

  it("ignores non-array shownIds/declinedIds without throwing", () => {
    expect(() => matchContentTopic("period", null, undefined)).not.toThrow();
    expect(() => matchContentTopic("period", "bad", 123)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// matchAllContentTopics
// ─────────────────────────────────────────────────────────────────────────────

describe("matchAllContentTopics", () => {
  it("returns an array", () => {
    const results = matchAllContentTopics("period");
    expect(Array.isArray(results)).toBe(true);
  });

  it("returns at most `limit` results", () => {
    const results = matchAllContentTopics("period cramps hormones", [], [], 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("default limit is 3", () => {
    const results = matchAllContentTopics("period cramps mood hormones pregnancy");
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("all returned ids are unique", () => {
    const results = matchAllContentTopics("period cramps hormones");
    const ids = results.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no returned id is in shownIds", () => {
    const first = matchAllContentTopics("period", [], [], 3);
    const firstIds = first.map(r => r.id);
    const second = matchAllContentTopics("period", firstIds, [], 3);
    for (const r of second) {
      expect(firstIds).not.toContain(r.id);
    }
  });

  it("returns empty array for empty input", () => {
    expect(matchAllContentTopics("")).toEqual([]);
  });

  it("result entries all have the required shape", () => {
    const results = matchAllContentTopics("late period heavy bleeding");
    for (const r of results) {
      expect(r).toHaveProperty("type");
      expect(r).toHaveProperty("id");
      expect(r).toHaveProperty("title");
      expect(r).toHaveProperty("shortAnswer");
      expect(r).toHaveProperty("link");
      expect(r).toHaveProperty("matchedTopic");
    }
  });

  it("orders by pamphlet first when multiple types match", () => {
    const results = matchAllContentTopics("late period", [], [], 3);
    if (results.length > 1) {
      const types = results.map(r => r.type);
      // pamphlet should appear before faq which should appear before glossary
      const pamIdx = types.indexOf("pamphlet");
      const faqIdx = types.indexOf("faq");
      const gloIdx = types.indexOf("glossary");
      if (pamIdx !== -1 && faqIdx !== -1) expect(pamIdx).toBeLessThan(faqIdx);
      if (faqIdx !== -1 && gloIdx !== -1) expect(faqIdx).toBeLessThan(gloIdx);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles non-string inputText without throwing", () => {
    expect(() => matchContentTopic(null)).not.toThrow();
    expect(() => matchContentTopic(undefined)).not.toThrow();
    expect(() => matchContentTopic(42)).not.toThrow();
  });

  it("returns null for a very long string of random characters", () => {
    const noise = "z".repeat(800);
    expect(matchContentTopic(noise)).toBeNull();
  });

  it("matchedTopic is one of the entry's own topics", () => {
    const result = matchContentTopic("heavy bleeding clots");
    expect(result).not.toBeNull();
    const entry = CONTENT_CATALOG.find(e => e.id === result?.id);
    expect(entry?.topics).toContain(result?.matchedTopic);
  });

  it("link always starts with /resources/", () => {
    const inputs = ["period", "pcos", "ovulation", "pregnancy", "discharge"];
    for (const input of inputs) {
      const result = matchContentTopic(input);
      if (result) expect(result.link.startsWith("/resources/")).toBe(true);
    }
  });
});
