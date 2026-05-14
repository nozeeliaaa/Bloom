import { describe, expect, it, vi } from "vitest";

vi.mock("../bloomie-logger.js", () => ({
  bloomieDiagnostic: vi.fn(),
}));

import { validateExtractedSignals } from "../bloomie-extract.js";

describe("bloomie AI extraction validation", () => {
  it("canonicalizes legacy AI symptom aliases to local entity vocabulary", () => {
    const result = validateExtractedSignals({
      symptoms: ["dizzy", "cramps", "odor", "breast_pain", "migraine", "back_pain"],
      timing: ["late_period"],
      severity: "severe",
      tone: "anxious",
      repair: false,
      pregnancySignals: ["cramps", "dizzy"],
      redFlags: ["syncope_risk"],
      confidence: 0.91,
    });

    expect(result?.symptoms).toEqual([
      "dizziness",
      "pelvic",
      "discharge_foul_smell",
      "breast_tender",
      "headache",
      "joint_pain",
    ]);
    expect(result?.pregnancySignals).toEqual(["pelvic", "dizziness"]);
  });
});
