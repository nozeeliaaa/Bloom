import { describe, it, expect } from "vitest";
import { handleRepairClarification } from "../bloomie-repair.js";

describe("handleRepairClarification", () => {
  it("returns a clarification repair payload for confusion phrasing", () => {
    const result = handleRepairClarification("kmt what?", {
      daysUntilNextPeriod: null,
      isLateContextActive: false,
    });

    expect(result?.targetName).toBe("clarification_repair");
    expect(result?.payload?.oos).toBe("clarification_repair");
    expect(result?.reply.join(" ")).toMatch(/more simply|cramps|spotting|pregnancy chance/i);
  });

  it("returns a frustration repair payload for mismatch feedback", () => {
    const result = handleRepairClarification("not what i asked", {
      daysUntilNextPeriod: null,
      isLateContextActive: false,
    });

    expect(result?.targetName).toBe("confused_with_bloomie");
    expect(result?.classification?.label).toBe("frustration");
  });

  it("uses overdue late-context wording when available", () => {
    const result = handleRepairClarification("what do you mean", {
      daysUntilNextPeriod: -16,
      isLateContextActive: false,
    });

    expect(result?.reply.join(" ")).toMatch(/later than expected|16 day/i);
  });
});
