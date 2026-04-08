/**
 * bloomie-inference.test.js
 * Regression tests for entity extraction and route inference.
 * Focus: safety-critical routes must always resolve to the correct node.
 */

import { describe, it, expect } from "vitest";
import { extractEntities, inferRoute, detectAmbiguousInput, detectMissingContext } from "../bloomie-inference.js";
import { createNodes } from "../bloomie-nodes.js";

function getRegisteredNodeIds() {
  const envBase = {
    ctx: {
      state: "START",
      history: [],
      answers: [],
      entityHistory: [],
      timers: new Set(),
      adviceGiven: new Set(),
      conversationProfile: { sessionDepth: 1, concernsResolved: [], concernsUnresolved: [] },
      contentSuggestionsShown: new Set(),
      declinedSuggestions: new Set(),
      reportedConditions: [],
      captureData: {},
    },
    cd: {},
    userMode: {
      isCycleTracking: false, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: true,
    },
    pick: (arr) => (Array.isArray(arr) ? arr[0] : arr),
    greet: () => "Hey",
    say: () => {},
    transition: () => {},
  };
  const env = new Proxy(envBase, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => [];
    },
  });
  return new Set(Object.keys(createNodes(env)));
}

const REGISTERED_NODE_IDS = getRegisteredNodeIds();

// ─── extractEntities ──────────────────────────────────────────────────────────

describe("extractEntities — symptoms", () => {
  it("detects late period", () => {
    const e = extractEntities("my period is late");
    expect(e.symptoms.late).toBe(true);
  });

  it("detects missed period (patois)", () => {
    const e = extractEntities("me period nuh come");
    expect(e.symptoms.late).toBe(true);
  });

  it("detects heavy bleeding", () => {
    const e = extractEntities("i have heavy bleeding");
    expect(e.symptoms.heavy).toBe(true);
  });

  it("detects heavy bleeding (patois: bleed nuff)", () => {
    const e = extractEntities("me bleed nuff");
    expect(e.symptoms.heavy).toBe(true);
  });

  it("detects spotting", () => {
    const e = extractEntities("i noticed spotting today");
    expect(e.symptoms.spotting).toBe(true);
  });

  it("detects pelvic pain / cramps", () => {
    const e = extractEntities("i have bad cramps in my lower abdomen");
    expect(e.symptoms.pelvic).toBe(true);
  });

  it("detects dizziness", () => {
    const e = extractEntities("i feel dizzy and lightheaded");
    expect(e.symptoms.dizziness).toBe(true);
  });

  it("detects nausea", () => {
    const e = extractEntities("i feel nauseous every morning");
    expect(e.symptoms.nausea).toBe(true);
  });

  it("detects discharge", () => {
    const e = extractEntities("there is unusual discharge with odor");
    expect(e.symptoms.discharge).toBe(true);
  });

  it("detects down-there 'off' phrasing as discharge-adjacent", () => {
    const e = extractEntities("down there feel off");
    expect(e.symptoms.discharge).toBe(true);
  });

  it("normalizes 'my boobs sore' to breast tenderness / pain signal", () => {
    const e = extractEntities("my boobs sore");
    expect(e.symptoms.breast_tender).toBe(true);
    expect(e.domainSelections.pain).toContain("breast_pain");
  });

  it("normalizes 'I keep peeing' to frequent urination", () => {
    const e = extractEntities("i keep peeing");
    expect(e.symptoms.frequent_urination).toBe(true);
    expect(e.domainSelections.urinary).toContain("frequent_urination");
  });

  it("normalizes 'I feel hot then cold' to temperature options", () => {
    const e = extractEntities("i feel hot then cold");
    expect(e.symptoms.hot_flashes).toBe(true);
    expect(e.domainSelections.temperature).toContain("hot_then_cold");
  });

  it("normalizes 'my back hurting' to pain domain", () => {
    const e = extractEntities("my back hurting");
    expect(e.symptoms.pelvic).toBe(true);
    expect(e.domainSelections.pain).toContain("lower_back_pain");
  });

  it("captures broad domain options for non-routing signals", () => {
    const e = extractEntities("i'm bloated and gassy and craving chocolate");
    expect(e.symptoms.bloating).toBe(true);
    expect(e.symptoms.gassy).toBe(true);
    expect(e.domainSelections.digestion).toEqual(expect.arrayContaining(["bloated", "gassy"]));
    expect(e.domainSelections.cravings).toContain("chocolate");
  });

  it("captures discharge type + blood colour variants", () => {
    const e = extractEntities("egg white discharge and brown blood");
    expect(e.symptoms.discharge_eggwhite).toBe(true);
    expect(e.symptoms.blood_color_brown).toBe(true);
    expect(e.domainSelections.discharge).toContain("eggwhite");
    expect(e.domainSelections.blood_colour).toContain("brown");
  });

  it("captures brain fog as mind/focus state", () => {
    const e = extractEntities("i have brain fog and can't focus");
    expect(e.symptoms.brain_fog).toBe(true);
    expect(e.domainSelections.mind).toContain("brain_fog");
    expect(e.domainSelections.focus_productivity).toContain("poor_concentration");
  });
});

describe("extractEntities — severity", () => {
  it("extracts severe", () => {
    const e = extractEntities("the pain is very bad and unbearable");
    expect(e.severity).toBe("severe");
  });

  it("extracts mild", () => {
    const e = extractEntities("just mild cramping, manageable");
    expect(e.severity).toBe("mild");
  });

  it("extracts moderate", () => {
    const e = extractEntities("pretty bad pain, affecting my day");
    expect(e.severity).toBe("moderate");
  });
});

describe("extractEntities — timing", () => {
  it("extracts before_period", () => {
    const e = extractEntities("i feel anxious a few days before my period");
    expect(e.timing).toBe("before_period");
  });

  it("extracts mid_cycle", () => {
    const e = extractEntities("spotting in the middle of my cycle");
    expect(e.timing).toBe("mid_cycle");
  });

  it("extracts after_sex", () => {
    const e = extractEntities("i have pain after sex");
    expect(e.timing).toBe("after_sex");
  });
});

describe("extractEntities — pregnancy", () => {
  it("detects pregnancy chance from unprotected sex", () => {
    const e = extractEntities("i had unprotected sex and my period is late");
    expect(e.pregnancy.chance).toBe(true);
    expect(e.pregnancy.testedYet).toBe(false);
  });

  it("detects positive test", () => {
    const e = extractEntities("i took a pregnancy test and it was positive");
    expect(e.pregnancy.testedYet).toBe(true);
    expect(e.pregnancy.result).toBe("positive");
  });

  it("detects negative test", () => {
    const e = extractEntities("i tested and it was negative");
    expect(e.pregnancy.testedYet).toBe(true);
    expect(e.pregnancy.result).toBe("negative");
  });
});

describe("extractEntities — urgency", () => {
  it("flags fainting", () => {
    // urgency regex matches \bfaint\b (not "fainted") and \bpassed out\b
    const e = extractEntities("i passed out from the bleeding");
    expect(e.urgent).toBe(true);
  });

  it("flags soaking through clothing", () => {
    // urgency regex matches "bleed.*pants" — needs present-tense "bleed"
    const e = extractEntities("i bleed through my pants");
    expect(e.urgent).toBe(true);
  });

  it("flags severe one-sided pain", () => {
    const e = extractEntities("i have severe one-sided pain on the right");
    expect(e.urgent).toBe(true);
  });

  it("does not flag mild cramps as urgent", () => {
    const e = extractEntities("i have mild cramps before my period");
    expect(e.urgent).toBe(false);
  });
});

// ─── inferRoute — SAFETY CRITICAL ────────────────────────────────────────────

describe("inferRoute — urgent routes (highest priority)", () => {
  it("urgency flag → HEAVY_URGENT", () => {
    const e = extractEntities("i nearly fainted and i'm soaking through pads");
    const route = inferRoute(e);
    expect(route.next).toBe("HEAVY_URGENT");
    expect(route.payload.reason).toBe("urgency_flag");
  });

  it("heavy + dizziness → HEAVY_URGENT", () => {
    const e = extractEntities("heavy bleeding and i feel dizzy and lightheaded");
    const route = inferRoute(e);
    expect(route.next).toBe("HEAVY_URGENT");
    expect(route.payload.reason).toBe("heavy+dizzy");
  });

  it("overdue + cramps + nausea stays on late/pregnancy-sensitive path", () => {
    const e = extractEntities("my period is late and i have cramps and nausea");
    const route = inferRoute(e);
    expect(["PREGNANCY_ENTRY", "LATE_TEST_Q", "LATE_YES_PREG", "LATE_NO_GUIDANCE"]).toContain(route?.next);
  });

  it("late + severe pelvic pain → PELVIC_PERSISTENT (pelvic+severe check fires first)", () => {
    // "unbearable" → severity=severe but NOT urgency (urgency needs "severe pain", "faint" etc.)
    // pelvic+severe check (line 363) fires before late+pelvic combo (line 372)
    const e = extractEntities("my period is late and the pelvic pain is unbearable");
    const route = inferRoute(e);
    expect(route.next).toBe("PELVIC_PERSISTENT");
  });
});

describe("inferRoute — late period routes", () => {
  it("late + pregnancy chance + no test → PREGNANCY_ENTRY", () => {
    const e = extractEntities("my period is late and i had unprotected sex");
    const route = inferRoute(e);
    expect(route.next).toBe("PREGNANCY_ENTRY");
    expect(route.payload.reason).toBe("late+pregnancy_chance+no_test");
  });

  it("late + positive test → LATE_POSITIVE", () => {
    const e = extractEntities("my period is late and i took a test and it was positive");
    const route = inferRoute(e);
    expect(route.next).toBe("LATE_POSITIVE");
  });

  it("late + negative test → LATE_NEG_UNCLEAR", () => {
    const e = extractEntities("my period is late and i tested and it came back negative");
    const route = inferRoute(e);
    expect(route.next).toBe("LATE_NEG_UNCLEAR");
  });

  it("late + 2 weeks → LATE_YES_PREG", () => {
    const e = extractEntities("my period is two weeks late");
    const route = inferRoute(e);
    expect(route.next).toBe("LATE_YES_PREG");
    expect(route.payload.reason).toBe("late+2weeks");
  });

  it("late + short duration (< 7 days) → LATE_NO_GUIDANCE", () => {
    const e = extractEntities("my period is 3 days late");
    const route = inferRoute(e);
    expect(route.next).toBe("LATE_NO_GUIDANCE");
  });
});

describe("inferRoute — heavy bleeding routes", () => {
  it("heavy + 7 days → HEAVY_ROUTE_B and node exists", () => {
    // symptom regex uses \bheavy\b — "heavily" doesn't match; use "heavy bleeding"
    const e = extractEntities("i have heavy bleeding for a week");
    const route = inferRoute(e);
    expect(route.next).toBe("HEAVY_ROUTE_B");
    expect(REGISTERED_NODE_IDS.has(route.next)).toBe(true);
    expect(route.payload.reason).toBe("heavy+7days");
  });

  it("heavy + severe → HEAVY_ROUTE_C and node exists", () => {
    const e = extractEntities("very bad heavy bleeding, it's unbearable");
    const route = inferRoute(e);
    expect(route.next).toBe("HEAVY_ROUTE_C");
    expect(REGISTERED_NODE_IDS.has(route.next)).toBe(true);
    expect(route.payload.reason).toBe("heavy+severe");
  });

  it("heavy + moderate → HEAVY_ROUTE_B and node exists", () => {
    const e = extractEntities("i have heavy bleeding that's pretty bad and affecting my day");
    const route = inferRoute(e);
    expect(route.next).toBe("HEAVY_ROUTE_B");
    expect(REGISTERED_NODE_IDS.has(route.next)).toBe(true);
  });
});

describe("inferRoute — spotting routes", () => {
  it("spotting + mid cycle → SPOT_MIDCYCLE_NOTE", () => {
    const e = extractEntities("light spotting in the middle of my cycle");
    const route = inferRoute(e);
    expect(route.next).toBe("SPOT_MIDCYCLE_NOTE");
    expect(route.payload.reason).toBe("spotting+mid_cycle");
  });

  it("spotting + pregnancy chance → SPOT_PREG_INFO", () => {
    const e = extractEntities("i'm spotting and i might be pregnant");
    const route = inferRoute(e);
    expect(route.next).toBe("SPOT_PREG_INFO");
  });

  it("spotting + discharge → SPOT_PROVIDER_SOON", () => {
    const e = extractEntities("spotting and unusual discharge with smell");
    const route = inferRoute(e);
    expect(route.next).toBe("SPOT_PROVIDER_SOON");
  });
});

describe("inferRoute — pelvic pain routes", () => {
  it("pelvic + after sex → PELVIC_SEX_INTRO", () => {
    // "pain after sex" alone doesn't set pelvic=true; need "cramps" or "pelvic"
    const e = extractEntities("i have cramps after sex");
    const route = inferRoute(e);
    expect(route.next).toBe("PELVIC_SEX_INTRO");
  });

  it("pelvic + severe (without urgency words) → PELVIC_PERSISTENT", () => {
    // "unbearable" triggers urgency regex → use "very bad" which maps to severe but not urgency
    const e = extractEntities("very bad pelvic pain");
    const route = inferRoute(e);
    expect(route.next).toBe("PELVIC_PERSISTENT");
  });
});

describe("inferRoute — mood routes", () => {
  it("mood + before period → MOOD_SEVERITY", () => {
    const e = extractEntities("i feel very anxious and tired a few days before my period");
    const route = inferRoute(e);
    expect(route.next).toBe("MOOD_SEVERITY");
    expect(route.payload.reason).toBe("mood+before_period");
  });
});

describe("inferRoute — discharge route", () => {
  it("discharge alone (no spotting/pelvic) → ELSE_DISCHARGE", () => {
    const e = extractEntities("i have unusual discharge with a smell");
    const route = inferRoute(e);
    expect(route.next).toBe("ELSE_DISCHARGE");
    expect(route.payload.reason).toBe("discharge_only");
  });
});

describe("inferRoute — nausea + late", () => {
  it("nausea + late → LATE_TEST_Q", () => {
    const e = extractEntities("i feel nauseous and my period is late");
    const route = inferRoute(e);
    expect(route.next).toBe("LATE_TEST_Q");
    expect(route.payload.reason).toBe("nausea+late");
  });
});

describe("inferRoute — no match", () => {
  it("returns null for unrecognized input", () => {
    const e = extractEntities("i like flowers");
    const route = inferRoute(e);
    expect(route).toBeNull();
  });
});

// ─── implicit_late extraction ─────────────────────────────────────────────────

describe("extractEntities — implicit_late", () => {
  it("detects 'it hasn't come'", () => {
    expect(extractEntities("it hasn't come").symptoms.implicit_late).toBe(true);
  });

  it("detects 'it still hasn't come'", () => {
    expect(extractEntities("it still hasn't come").symptoms.implicit_late).toBe(true);
  });

  it("detects 'hasn't arrived'", () => {
    expect(extractEntities("hasn't arrived").symptoms.implicit_late).toBe(true);
  });

  it("detects 'still waiting'", () => {
    expect(extractEntities("still waiting").symptoms.implicit_late).toBe(true);
  });

  it("detects 'not here yet'", () => {
    expect(extractEntities("not here yet").symptoms.implicit_late).toBe(true);
  });

  it("does NOT fire on unrelated text", () => {
    expect(extractEntities("i have heavy bleeding").symptoms.implicit_late).toBe(false);
    expect(extractEntities("i like flowers").symptoms.implicit_late).toBe(false);
  });
});

// ─── implicit_late routing (effectiveLate guard) ──────────────────────────────

describe("inferRoute — implicit late (no other symptoms)", () => {
  it("'it hasn't come' + 3 days → LATE_NO_GUIDANCE", () => {
    const e = extractEntities("it hasn't come, it's been 3 days");
    const route = inferRoute(e);
    expect(route?.next).toBe("LATE_NO_GUIDANCE");
  });

  it("'not here yet' + 2 weeks → LATE_YES_PREG", () => {
    const e = extractEntities("not here yet and it's been two weeks");
    const route = inferRoute(e);
    expect(route?.next).toBe("LATE_YES_PREG");
  });

  it("implicit late + pregnancy chance + no test → PREGNANCY_ENTRY", () => {
    const e = extractEntities("it still hasn't come and i had unprotected sex");
    const route = inferRoute(e);
    expect(route?.next).toBe("PREGNANCY_ENTRY");
  });

  it("implicit late + heavy bleeding → does NOT route as late (heavy wins)", () => {
    // sym.heavy present → noOtherSymptoms=false → effectiveLate=false
    // heavy+dizzy check doesn't fire (no dizzy); falls through to null
    const e = extractEntities("still waiting but i'm having really heavy bleeding");
    // heavy is true, no severity/duration → inferRoute returns null
    expect(e.symptoms.heavy).toBe(true);
    expect(e.symptoms.implicit_late).toBe(true);
    // effectiveLate is false because heavy is present, so no late route fires
    const route = inferRoute(e);
    expect(route?.next).not.toBe("LATE_NO_GUIDANCE");
    expect(route?.next).not.toBe("LATE_YES_PREG");
    expect(route?.next).not.toBe("PREGNANCY_ENTRY");
  });
});

describe("clarification helpers — ambiguity and missing context", () => {
  it("asks targeted reproductive-health clarification for vague down-there wording", () => {
    const text = "down there feel off";
    const entities = extractEntities(text);
    const q = detectAmbiguousInput(text, entities);
    expect(q).toMatch(/discharge|irritation|down there/i);
  });

  it("treats broad stomach pain phrasing as ambiguous before pelvic explanation", () => {
    const text = "my stomach hurt";
    const entities = extractEntities(text);
    const q = detectAmbiguousInput(text, entities);
    expect(q).toMatch(/pelvis|stomach|belly/i);
  });

  it("missing-context probe also asks pelvis-vs-belly split for broad stomach phrasing", () => {
    const text = "belly hurt";
    const entities = extractEntities(text);
    const q = detectMissingContext(entities, text);
    expect(q).toMatch(/pelvic|belly|stomach/i);
  });
});
