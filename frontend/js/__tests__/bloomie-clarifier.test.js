import { describe, it, expect } from "vitest";
import {
  buildClarifyingPrompt,
  buildFollowUpClarifier,
  buildRepairClarificationCopy,
  buildSoftClarifierCopy,
  promptFingerprint,
} from "../bloomie-clarifier.js";
import { buildFollowUpQuestion } from "../bloomie-response-layers.js";

describe("bloomie clarifier wording", () => {
  it("builds a repeat-safe clarifying prompt variant", () => {
    const prompt = "Where does the pain feel like it's coming from - more in your belly/lower pelvic area, or somewhere else?";
    const result = buildClarifyingPrompt(prompt, {
      normalizedText: "my belly hurts",
      isRecentRepeat: true,
      isLateContextActive: false,
    });
    expect(result.text).toMatch(/lower-pelvic|stomach area|belly/i);
    expect(result.fingerprint).toBe(promptFingerprint(result.text));
  });

  it("applies late-context pain wording override", () => {
    const result = buildClarifyingPrompt("Where does the pain feel like it's coming from?", {
      normalizedText: "my stomach hurt and period late",
      isRecentRepeat: false,
      isLateContextActive: true,
    });
    expect(result.text).toMatch(/period still seems off|stomach\/belly discomfort|crampy low-pelvic/i);
  });

  it("builds shared follow-up wording for late-period missing clues", () => {
    const followUp = buildFollowUpClarifier({
      concern: "late_period",
      missing: ["pregnancy_possibility", "stress_or_routine"],
    });
    expect(followUp?.text).toMatch(/chance of pregnancy|stress|routine/i);
  });

  it("builds shared soft OOS clarification copy", () => {
    const result = buildSoftClarifierCopy({ normalizedText: "wah going on wid me" });
    expect(result.next).toBe("ELSE_NOT_SURE_ROUTE");
    expect(result.payload?.reason).toBe("soft_clarify");
    expect(result.reply.join(" ")).toMatch(/cycle or a body symptom|cramps|spotting|discharge|mood changes/i);
  });

  it("builds shared repair copy for clarification context", () => {
    const lines = buildRepairClarificationCopy({
      label: "clarification",
      daysUntilNextPeriod: -4,
      isLateContextActive: false,
    });
    expect(lines.join(" ")).toMatch(/more simply|4 day|pregnancy chance/i);
  });
});

describe("shared wording delegation", () => {
  it("response-layer follow-up delegates to shared clarifier wording", () => {
    const context = {
      text: "mi period late",
      normalizedText: "mi period late",
      inferredReason: "late+short_duration",
      inferredNext: null,
      lastIntent: null,
      sessionDepth: 1,
      isShortFollowUp: false,
      hasPendingClarifier: false,
      entities: {
        symptoms: {
          late: true,
          implicit_late: false,
          spotting: false,
          pelvic: false,
          discharge: false,
        },
        severity: null,
        timing: null,
        pregnancy: { chance: false, testedYet: false, result: null },
        urgent: false,
      },
    };

    const shared = buildFollowUpClarifier({
      concern: "late_period",
      missing: ["pregnancy_possibility", "stress_or_routine", "cycle_context"],
    });

    expect(buildFollowUpQuestion(context)).toBe(shared.text);
  });
});
