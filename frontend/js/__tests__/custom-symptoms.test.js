import { describe, expect, it } from "vitest";
import {
  collectCustomSymptomRecurrence,
  customSymptomLooksUrgent,
  normalizeCustomSymptomText,
  summarizeCustomSymptoms,
} from "../custom-symptoms.js";

describe("custom symptom helpers", () => {
  it("normalizes text lightly for recurrence counting", () => {
    expect(normalizeCustomSymptomText("  Burning   Sensation ")).toBe("burning sensation");
  });

  it("counts repeated custom symptoms by normalized text", () => {
    const rows = collectCustomSymptomRecurrence({
      "2026-04-01": { otherSymptoms: [{ text: "Burning sensation" }] },
      "2026-04-10": { otherSymptoms: [{ text: "burning   sensation" }] },
      "2026-04-12": { otherSymptoms: [{ text: "jaw tightness" }] },
    }, 30, new Date("2026-04-15T12:00:00"));

    expect(rows[0].normalizedText).toBe("burning sensation");
    expect(rows[0].count).toBe(2);
  });

  it("flags obviously urgent wording without trying to interpret it medically", () => {
    expect(customSymptomLooksUrgent("fainting and chest pain")).toBe(true);
    expect(customSymptomLooksUrgent("itchy scalp")).toBe(false);
  });

  it("summarizes repeated custom symptoms into factual pattern messages", () => {
    const rows = summarizeCustomSymptoms({
      "2026-04-01": { otherSymptoms: [{ text: "Burning sensation in lower abdomen" }] },
      "2026-04-10": { otherSymptoms: [{ text: "burning   sensation in lower abdomen" }] },
      "2026-04-12": { otherSymptoms: [{ text: "Jaw tightness" }] },
    }, { days: 30, fromDate: new Date("2026-04-15T12:00:00") });

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("recurring");
    expect(rows[0].message).toContain("Burning sensation in lower abdomen");
  });

  it("can return a one-off readiness message for a recent custom symptom", () => {
    const rows = summarizeCustomSymptoms({
      "2026-04-12": { otherSymptoms: [{ text: "Dizziness after eating" }] },
    }, { days: 30, fromDate: new Date("2026-04-15T12:00:00") });

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("one_off");
    expect(rows[0].message).toContain("Saved to your symptom history");
  });
});
