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

  it("keeps core Jamaican conversational cases in-scope", () => {
    const { routeUserText } = makeRouter();
    const inputs = [
      "it nuh come yet",
      "still no",
      "kmt",
      "mi nuh feel right",
      "condom bruk",
      "brown blood",
      "my cycle all over the place",
      "this normal?",
      "same thing",
      "mi a stress bad",
    ];
    for (const input of inputs) {
      const routed = routeUserText(input);
      expect(routed.payload?.oos).not.toBe("default");
    }
  });

  it("routes condom-break phrasing to recent sex test timing flow", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("condom broke last night");
    expect(routed.next).toBe("TEST_RECENT_SEX_INTRO");
  });

  it("routes heavy-flow metaphor phrasing to heavy flow triage", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("mi period heavy like river");
    expect(routed.next).toBe("HEAVY_INTRO");
  });

  it("routes postpartum low mood phrasing to mood safety path", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("mi nuh feel happy after baby");
    expect(routed.next).toBe("MOOD_SAFETY_CHECK");
  });

  it("routes TTC duration concern to TTC intro", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("trying 8 months no baby");
    expect(routed.next).toBe("TTC_INTRO");
  });

  it("routes fear-of-telling-mom phrasing to minor support node", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("mi scared fi tell mi mama");
    expect(routed.next).toBe("MINOR_TRUSTED_ADULT_SUPPORT");
    expect(routed.payload?.oos).toBe("minor_trusted_support");
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
    expect(routed.reply.join(" ")).toMatch(/missing something|tell me a little more|cycle|symptom/i);
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

  it("routes 'what dat mean' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("what dat mean");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("routes 'weh yuh mean' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("weh yuh mean");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("routes 'seh dat again' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("seh dat again");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("routes 'look yah nuh' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("look yah nuh");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("routes 'seh wah' to clarification repair", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("seh wah");
    expect(routed.payload?.oos).toBe("clarification_repair");
  });

  it("clarification repair uses late-context wording when period is overdue", () => {
    const { routeUserText } = makeRouter({ daysUntilNextPeriod: () => -16 });
    const routed = routeUserText("kmt what?");
    expect(routed.payload?.oos).toBe("clarification_repair");
    expect(routed.reply.join(" ")).toMatch(/later than expected|16 day/i);
  });

  it("uses soft clarification route for vague health phrasing before hard OOS", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("wah going on wid me");
    expect(routed.next).toBe("ELSE_NOT_SURE_ROUTE");
    expect(routed.payload?.oos).toBeUndefined();
    expect(routed.payload?.reason).toBe("soft_clarify");
  });

  it("routes reassurance phrasing to in-scope check path", () => {
    const { routeUserText } = makeRouter();
    const routed = routeUserText("this normal?");
    expect(routed.next).toBe("ELSE_NOT_SURE_ROUTE");
    expect(routed.payload?.oos).toBeUndefined();
  });
});
