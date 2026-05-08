import { describe, it, expect } from "vitest";
import {
  findSymptomMatchesFromText,
  getAllSymptoms,
  getSensitiveSymptoms,
  getSymptomByKey,
  getSymptomsByCategory,
  getTeenSafeSymptoms,
  groupSymptomMatchesByCategory,
  normalizeCategory,
} from "../bloomie-symptom-catalog.js";
import { extractEntities } from "../bloomie-inference.js";

describe("bloomie symptom catalog helper", () => {
  it("loads symptoms from the backend catalog", () => {
    expect(getAllSymptoms().length).toBeGreaterThan(100);
    expect(getSymptomByKey("BRAIN_FOG")?.label).toBe("Brain fog");
  });

  it("normalizes categories and filters teen/sensitive flags", () => {
    expect(normalizeCategory("Blood Colour")).toBe("blood_colour");
    expect(getSymptomsByCategory("Pain").some((item) => item.key === "CRAMPS")).toBe(true);
    expect(getTeenSafeSymptoms().every((item) => item.teenSafe === true)).toBe(true);
    expect(getSensitiveSymptoms().some((item) => item.key === "DISCHARGE_YELLOW")).toBe(true);
  });

  it("matches yellow discharge and cramps from free text", () => {
    const matches = findSymptomMatchesFromText("I have yellow discharge and cramps");
    expect(matches.map((m) => m.key)).toEqual(expect.arrayContaining(["DISCHARGE_YELLOW", "CRAMPS"]));

    const grouped = groupSymptomMatchesByCategory(matches);
    expect(grouped.discharge?.map((m) => m.key)).toContain("DISCHARGE_YELLOW");
    expect(grouped.pain?.map((m) => m.key)).toContain("CRAMPS");
  });

  it("matches breasts sore and bloated using catalog labels plus safe aliases", () => {
    const matches = findSymptomMatchesFromText("my breasts sore and I feel bloated");
    expect(matches.map((m) => m.key)).toEqual(expect.arrayContaining(["BREAST_TENDERNESS", "BLOATING"]));
  });

  it("matches brain fog, low energy, and headache", () => {
    const matches = findSymptomMatchesFromText("I'm having brain fog, low energy, and headache");
    expect(matches.map((m) => m.key)).toEqual(expect.arrayContaining(["BRAIN_FOG", "LOW_ENERGY", "HEADACHE"]));
  });

  it("matches frequent urination and nausea", () => {
    const matches = findSymptomMatchesFromText("frequent urination and nausea");
    expect(matches.map((m) => m.key)).toEqual(expect.arrayContaining(["FREQUENT_URINATION", "NAUSEA"]));
  });

  it("matches representative blood-colour phrasing", () => {
    const matches = findSymptomMatchesFromText("my period blood is brown and kind of rusty");
    expect(matches.map((m) => m.key)).toContain("BROWN_BLOOD");
  });

  it("matches representative pain phrasing with intensity separation", () => {
    const matches = findSymptomMatchesFromText("i have a stabbing pelvic pain and my lower back is hurting");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["SHARP_PELVIC_PAIN", "LOWER_BACK_PAIN"])
    );
  });

  it("matches representative stool phrasing", () => {
    const matches = findSymptomMatchesFromText("pooping hurts and i still feel like more is left");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["PAINFUL_BOWEL", "INCOMPLETE_EVACUATION"])
    );
  });

  it("matches representative discharge phrasing", () => {
    const matches = findSymptomMatchesFromText("i have fishy discharge and so much discharge lately");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["DISCHARGE_FOUL_SMELL", "DISCHARGE_INCREASED"])
    );
  });

  it("matches representative urinary phrasing", () => {
    const matches = findSymptomMatchesFromText("it burns to pee and i need to pee right away");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["BURNING_URINATION", "URINARY_URGENCY"])
    );
  });

  it("matches representative energy phrasing with stronger low-energy language", () => {
    const matches = findSymptomMatchesFromText("i am completely drained and food makes me tired");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["VERY_LOW_ENERGY", "FATIGUE_AFTER_MEALS"])
    );
  });

  it("matches representative mind phrasing", () => {
    const matches = findSymptomMatchesFromText("i keep forgetting things and i cant focus at work");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["FORGETFUL", "POOR_CONCENTRATION"])
    );
  });

  it("matches representative sleep phrasing", () => {
    const matches = findSymptomMatchesFromText("i keep waking up and i cant stay asleep after that");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["FREQUENT_WAKING", "DIFFICULTY_STAYING_ASLEEP"])
    );
  });

  it("matches representative mood phrasing", () => {
    const matches = findSymptomMatchesFromText("my mood is all over the place and everything annoys me");
    expect(matches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["MOOD_SWINGS", "IRRITABILITY"])
    );
  });

  it("matches chat-like skin and period-acne phrasing", () => {
    const itchy = findSymptomMatchesFromText("my skin is itchy");
    expect(itchy.map((m) => m.key)).toContain("SKIN_SENSITIVITY");

    const periodAcne = findSymptomMatchesFromText("around my period i get bumps or acne");
    expect(periodAcne.map((m) => m.key)).toEqual(
      expect.arrayContaining(["HORMONAL_BREAKOUTS", "ACNE"])
    );
  });

  it("matches chat-like hair, heat, sweat, and sleep phrasing", () => {
    const hair = findSymptomMatchesFromText("my hair is dry");
    expect(hair.map((m) => m.key)).toContain("DRY_HAIR");

    const hot = findSymptomMatchesFromText("im always feeling hot");
    expect(hot.map((m) => m.key)).toContain("HOT_FLASHES");

    const sweat = findSymptomMatchesFromText("every morning i wake up sweating");
    expect(sweat.map((m) => m.key)).toContain("NIGHT_SWEATS");

    const sleep = findSymptomMatchesFromText("i cant sleep at night");
    expect(sleep.map((m) => m.key)).toContain("INSOMNIA");
  });

  it("matches chat-like heart/body and focus phrasing", () => {
    const heart = findSymptomMatchesFromText("my chest feels tight and im short of breath");
    expect(heart.map((m) => m.key)).toEqual(
      expect.arrayContaining(["CHEST_TIGHTNESS", "SHORTNESS_OF_BREATH"])
    );

    const focus = findSymptomMatchesFromText("im overwhelmed by my tasks and i keep putting things off");
    expect(focus.map((m) => m.key)).toEqual(
      expect.arrayContaining(["OVERWHELMED_TASKS", "PROCRASTINATING"])
    );
  });

  it("matches chat-like fertility and weight phrasing", () => {
    const fertility = findSymptomMatchesFromText("i feel dry down there and my sex drive is low");
    expect(fertility.map((m) => m.key)).toEqual(
      expect.arrayContaining(["VAGINAL_DRYNESS", "DECREASED_LIBIDO"])
    );

    const weight = findSymptomMatchesFromText("im retaining water and i feel puffy");
    expect(weight.map((m) => m.key)).toEqual(
      expect.arrayContaining(["WATER_RETENTION", "FEELING_PUFFY"])
    );
  });

  it("matches the latest chat-like phrasing bundle", () => {
    const mood = findSymptomMatchesFromText("im in such a happy mood");
    expect(mood.map((m) => m.key)).toContain("CALM");

    const cravings = findSymptomMatchesFromText("i just really want some chocolate and milk rn");
    expect(cravings.map((m) => m.key)).toEqual(
      expect.arrayContaining(["CRAVING_CHOCOLATE", "CRAVING_DAIRY"])
    );

    const libido = findSymptomMatchesFromText("im not interested in sex ive never been interested in sex");
    expect(libido.map((m) => m.key)).toContain("DECREASED_LIBIDO");

    const body = findSymptomMatchesFromText("i lost a bunch of weight and my face is puffy and i look fat");
    expect(body.map((m) => m.key)).toEqual(
      expect.arrayContaining(["WEIGHT_LOSS", "FACIAL_PUFFINESS", "FEELING_PUFFY"])
    );

    const smell = findSymptomMatchesFromText("its like i can smell everything and i smell something and i wanna throw up");
    expect(smell.map((m) => m.key)).toEqual(
      expect.arrayContaining(["SMELL_SENSITIVITY", "NAUSEA"])
    );

    const physical = findSymptomMatchesFromText("im so bloated my heart is racing and im constantly sweating");
    expect(physical.map((m) => m.key)).toEqual(
      expect.arrayContaining(["BLOATING", "HEART_RACING", "INCREASED_SWEATING"])
    );

    const recovering = findSymptomMatchesFromText("i just started feeling better");
    expect(recovering.map((m) => m.key)).toContain("RECOVERING");
  });
});

describe("extractEntities catalog integration", () => {
  it("returns structured catalog matches and category groups", () => {
    const entities = extractEntities("I have yellow discharge and cramps");
    expect(entities.catalogMatches.map((m) => m.key)).toEqual(
      expect.arrayContaining(["DISCHARGE_YELLOW", "CRAMPS"])
    );
    expect(entities.catalogMatchesByCategory.discharge?.map((m) => m.key)).toContain("DISCHARGE_YELLOW");
    expect(entities.catalogMatchesByCategory.pain?.map((m) => m.key)).toContain("CRAMPS");
  });
});
