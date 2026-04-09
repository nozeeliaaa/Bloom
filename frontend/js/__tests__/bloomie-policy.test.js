import { describe, it, expect } from "vitest";
import { buildPolicyContext, evaluatePolicyDecision, sanitizeMinorEnglishLine } from "../bloomie-policy.js";

describe("bloomie policy layer", () => {
  it("blocks minors without guardian consent", () => {
    const policyCtx = buildPolicyContext({
      ctx: { isMinor: true, isAnon: false, declaredAge: 15 },
      normalizedText: "my period late",
      entities: { symptoms: { late: true }, urgent: false },
      tags: ["late_period"],
      repair: null,
      policySeed: { ageGroup: "minor", hasGuardianConsent: false },
    });
    const decision = evaluatePolicyDecision(policyCtx);
    expect(decision.action).toBe("block_minor_no_consent");
  });

  it("hard blocks explicit sexual roleplay", () => {
    const policyCtx = buildPolicyContext({
      ctx: { isMinor: false, isAnon: false },
      normalizedText: "let us do sex chat",
      entities: { symptoms: {}, urgent: false },
      tags: [],
      repair: null,
      policySeed: { ageGroup: "adult", hasGuardianConsent: false },
    });
    const decision = evaluatePolicyDecision(policyCtx);
    expect(decision.action).toBe("hard_block_unsafe_topic");
  });

  it("keeps minor output in clear English", () => {
    const out = sanitizeMinorEnglishLine("mi nuh understand wah yuh mean");
    expect(out.toLowerCase()).toContain("i");
    expect(out.toLowerCase()).toContain("not");
    expect(out.toLowerCase()).toContain("you");
  });
});
