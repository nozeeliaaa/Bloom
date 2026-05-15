import { describe, expect, it } from "vitest";
import {
  createPendingClarification,
  resolveClarificationReply,
} from "../bloomie-clarification-resolver.js";
import { getClarificationSpec } from "../bloomie-clarification-specs.js";

describe("pending clarification resolver", () => {
  const painClarifier = createPendingClarification({
    prompt: "Where does the pain feel like it's coming from - more in your belly, lower pelvic area, or somewhere else?",
    kind: "missing_context",
    originalText: "i have pain",
    spec: getClarificationSpec("pain_location"),
  });

  it("resolves broader belly-location replies", () => {
    const result = resolveClarificationReply("my belly in general", painClarifier);
    expect(result?.status).toBe("resolved");
    expect(result?.value).toBe("belly_general");
  });

  it("marks patois dismissal as declined", () => {
    const result = resolveClarificationReply("nuh bada", painClarifier);
    expect(result?.status).toBe("declined");
  });

  it("marks forget it as declined", () => {
    const result = resolveClarificationReply("forget it", painClarifier);
    expect(result?.status).toBe("declined");
  });

  it("redirects when stronger new symptom information appears", () => {
    const result = resolveClarificationReply(
      "yellow discharge too",
      painClarifier,
      {
        entities: {
          symptoms: { discharge: true, unusual_discharge: true },
          pregnancy: {},
        },
        detectInputDomains(entities) {
          const domains = new Set();
          if (entities?.symptoms?.discharge || entities?.symptoms?.unusual_discharge) domains.add("discharge");
          return domains;
        },
      }
    );
    expect(result?.status).toBe("redirected");
    expect(result?.domains).toContain("discharge");
  });

  it("captures a different body part instead of re-asking", () => {
    const result = resolveClarificationReply("my back", painClarifier);
    expect(result?.status).toBe("resolved");
    expect(result?.value).toBe("back");
  });

  it("classifies idk as unclear", () => {
    const result = resolveClarificationReply("idk", painClarifier);
    expect(result?.status).toBe("unclear");
  });

  it("supports generic expected values like random", () => {
    const result = resolveClarificationReply("random", {
      key: "timing_pattern",
      expectedDomain: "timing",
      expectedValues: ["before_period", "during_period", "random"],
      status: "pending",
    });
    expect(result?.status).toBe("resolved");
    expect(result?.value).toBe("random");
  });

  it("uses explicit schema instead of prompt wording to resolve replies", () => {
    const result = resolveClarificationReply(
      "my belly in general",
      createPendingClarification({
        prompt: "Custom copy that does not describe the body parts directly.",
        kind: "missing_context",
        originalText: "i have pain",
        spec: getClarificationSpec("pain_location"),
      })
    );
    expect(result?.status).toBe("resolved");
    expect(result?.value).toBe("belly_general");
  });
});
