import { describe, it, expect } from "vitest";
import { extractEntities } from "../bloomie-inference.js";
import { rankTurnFocus } from "../bloomie-turn-focus.js";

describe("rankTurnFocus", () => {
  it("chooses discharge as the lead thread for cramps and yellow discharge", () => {
    const text = "cramps and yellow discharge";
    const focus = rankTurnFocus(extractEntities(text), text);

    expect(focus.leadDomain).toBe("discharge");
    expect(focus.leadLabel).toMatch(/yellow discharge|discharge change/i);
    expect(focus.secondaryLabels.join(" ")).toMatch(/cramps/i);
  });

  it("keeps brain fog ahead of low energy inside one mood thread", () => {
    const text = "brain fog and low energy";
    const focus = rankTurnFocus(extractEntities(text), text);

    expect(focus.leadDomain).toBe("mood");
    expect(focus.leadSymptom).toBe("brain_fog");
    expect(focus.secondaryLabels.join(" ")).toMatch(/low energy/i);
  });

  it("prioritizes bleeding for clots and cramps", () => {
    const text = "clots and cramps";
    const focus = rankTurnFocus(extractEntities(text), text);

    expect(focus.leadDomain).toBe("bleeding");
    expect(focus.leadLabel).toMatch(/clots|bleeding/i);
    expect(focus.secondaryLabels.join(" ")).toMatch(/cramps/i);
  });

  it("prioritizes nausea over bloating in digestive symptom clusters", () => {
    const text = "bloating and nausea";
    const focus = rankTurnFocus(extractEntities(text), text);

    expect(focus.leadDomain).toBe("digestive");
    expect(focus.leadSymptom).toBe("nausea");
    expect(focus.secondaryLabels.join(" ")).toMatch(/bloating/i);
  });
});
