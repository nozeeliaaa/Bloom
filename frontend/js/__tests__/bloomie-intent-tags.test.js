// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { classifyRepairClarification, extractMultiIntentTags } from "../bloomie-intent.js";
import { extractEntities } from "../bloomie-inference.js";

describe("repair / clarification classifier", () => {
  it("classifies kmt what as clarification", () => {
    const c = classifyRepairClarification("kmt what?");
    expect(c?.label).toBe("clarification");
  });

  it("classifies patois confusion variants", () => {
    expect(classifyRepairClarification("mi nuh get it")?.label).toBe("clarification");
    expect(classifyRepairClarification("seh that again")?.label).toBe("clarification");
    expect(classifyRepairClarification("what dat mean")?.label).toBe("clarification");
    expect(classifyRepairClarification("weh yuh mean")?.label).toBe("clarification");
  });

  it("classifies mismatch feedback as frustration", () => {
    const c = classifyRepairClarification("not what i asked");
    expect(c?.label).toBe("frustration");
  });
});

describe("multi-label intent tagging", () => {
  it("captures overlapping health tags without forcing one intent", () => {
    const text = "my period is late and i have cramps and nausea";
    const e = extractEntities(text);
    const tags = extractMultiIntentTags(text, e, { repair: null });
    expect(tags.tags).toEqual(expect.arrayContaining(["late_period", "cramps", "pelvic_pain", "nausea"]));
    expect(tags.confidence).toBeGreaterThan(0);
  });

  it("adds clarification tag when repair classifier fires", () => {
    const text = "what you mean";
    const e = extractEntities(text);
    const repair = classifyRepairClarification(text);
    const tags = extractMultiIntentTags(text, e, { repair });
    expect(tags.tags).toContain("clarification");
  });

  it("includes red_flag on heavy + dizziness combo", () => {
    const text = "heavy bleeding with clots and dizzy";
    const e = extractEntities(text);
    const tags = extractMultiIntentTags(text, e, { repair: null });
    expect(tags.tags).toContain("red_flag");
    expect(tags.tags).toEqual(expect.arrayContaining(["heavy_bleeding"]));
  });
});
