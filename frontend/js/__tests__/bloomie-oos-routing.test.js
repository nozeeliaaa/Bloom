import { describe, it, expect } from "vitest";
import { createOOS } from "../bloomie-oos.js";

function makeRouter(options = {}) {
  const ctx = {
    adviceGiven: new Set(),
    greeted: false,
    lastOOS: null,
    oosStreakCount: 0,
    ...options.ctx,
  };

  const env = {
    ctx,
    consent: () => "",
    getCurrentPhase: () => null,
    phaseNudge: () => null,
    insightFor: () => null,
    pickPriorityConcern: () => null,
    bloomieMemory: options.bloomieMemory || null,
    daysUntilNextPeriod: options.daysUntilNextPeriod || (() => null),
    isLateContextActive: options.isLateContextActive || (() => false),
  };

  const { routeUserText } = createOOS(env);
  return { ctx, routeUserText };
}

describe("bloomie OOS routing - false-positive guards", () => {
  it("keeps 'my cramps are affecting school' in-scope", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("my cramps are affecting school");
    expect(routed.next).toBe("PELVIC_SAFETY_GATE");
    expect(routed.payload?.oos).toBeUndefined();
  });

  it("keeps pre-period cravings in-scope", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("i'm craving chocolate before my period");
    expect(routed.payload?.oos).toBeUndefined();
    expect(routed.next).not.toBe("START_MENU");
  });

  it("keeps stress + late period in-scope", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("my period is late because i'm stressed from work");
    expect(routed.payload?.oos).toBeUndefined();
    expect(routed.next).not.toBe("START_MENU");
  });

  it("routes explicit PCOS concern to education route", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("i think i have pcos");
    expect(routed.next).toBe("EDUC_PCOS");
    expect(routed.payload?.oos).toBeUndefined();
  });

  it("routes app-help question with period words to APP_HELP", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("where is the button to log my period");
    expect(routed.next).toBe("APP_HELP");
  });

  it("keeps 'hungry all day before my period' in-scope", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("i'm hungry all day before my period");
    expect(routed.payload?.oos).toBeUndefined();
    expect(routed.next).not.toBe("START_MENU");
  });
});

describe("bloomie OOS routing - true positives and warm fallback", () => {
  it("still catches emergency language", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("i can't breathe and i feel like i might faint");
    expect(routed.next).toBe("EMERGENCY_REDIRECT");
  });

  it("still routes medication dosage questions", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("how much ibuprofen can i take for cramps");
    expect(routed.next).toBe("MEDICATION_REDIRECT");
  });

  it("still handles genuine weather/sports/jokes/telecom OOS", () => {
    const { routeUserText } = makeRouter();

    const weather = routeUserText("what's the weather tomorrow");
    expect(weather.payload?.oos).toBe("weather");

    const sports = routeUserText("what was the football score");
    expect(sports.payload?.oos).toBe("sports");

    const jokes = routeUserText("lol make me laugh");
    expect(jokes.payload?.oos).toBe("jokes");

    const telecom = routeUserText("digicel data plan not working");
    expect(telecom.payload?.oos).toBe("telecom");
  });

  it("uses soft warm default fallback for unclear unmatched input", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("tell me a bedtime story about dragons");

    expect(routed.next).toBe("START_MENU");
    expect(routed.payload?.oos).toBe("default");
    expect(Array.isArray(routed.reply)).toBe(true);
    expect(routed.reply.join(" ")).toMatch(/outside my lane|not sure i caught|best with period/i);
  });

  it("routes 'kmt what?' to clarification repair instead of default OOS", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("kmt what?");
    expect(routed.payload?.oos).toBe("clarification_repair");
    expect(routed.reply.join(" ")).toMatch(/my bad|more simply|cramps|spotting|pregnancy chance/i);
  });

  it("routes 'me nuh understand' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("me nuh understand");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("routes 'what do you mean?' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("what do you mean?");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("clarification repair uses late-context wording when period is overdue", () => {
    const { routeUserText } = makeRouter({ daysUntilNextPeriod: () => -16 });
    const routed = routeUserText("kmt what?");
    expect(routed.payload?.oos).toBe("clarification_repair");
    expect(routed.reply.join(" ")).toMatch(/later than expected|16 day/i);
  });
});
