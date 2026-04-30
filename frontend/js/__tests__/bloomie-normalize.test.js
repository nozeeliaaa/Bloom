import { describe, it, expect } from "vitest";
import { normalizeBloomieText } from "../bloomie-normalize.js";
import { normalizeText } from "../bloomie-routing.js";

describe("normalizeBloomieText", () => {
  it("preserves the existing assistant/tone normalization result by default", () => {
    expect(normalizeBloomieText("  Heavy BLEEDING!!  ")).toBe("heavy bleeding");
  });

  it("matches routing normalization when stripSpecialChars is enabled", () => {
    expect(normalizeBloomieText("it's late!!", { stripSpecialChars: true })).toBe("it's late");
    expect(normalizeBloomieText("  Heavy BLEEDING!!  ", { stripSpecialChars: true })).toBe("heavy bleeding");
  });

  it("returns intermediate stages for assistant debug parity", () => {
    const result = normalizeBloomieText("mi belly a hurttt", { returnStages: true });
    expect(result.patoisNorm).toBeTypeOf("string");
    expect(result.fuzzyNorm).toBeTypeOf("string");
    expect(result.collapsed).toBeTypeOf("string");
    expect(result.normalized).toBeTypeOf("string");
  });

  it("stays aligned with normalizeText wrapper", () => {
    expect(normalizeText("my period late")).toBe(
      normalizeBloomieText("my period late", { stripSpecialChars: true })
    );
  });
});
