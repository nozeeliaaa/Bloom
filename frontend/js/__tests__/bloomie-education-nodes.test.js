import { describe, it, expect } from "vitest";
import { createNodes } from "../bloomie-nodes.js";
import { createEducationNodes } from "../bloomie-nodes-education.js";
import { createPerimenopauseNodes } from "../bloomie-nodes-perimenopause.js";
import { buildNodeHelpers } from "../bloomie-nodes-helpers.js";

function makeEnv() {
  const ctx = {
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
    nodeHistory: [],
    sessionSymptoms: new Set(),
    moodMentions: [],
  };

  const envBase = {
    ctx,
    bloomieMemory: {},
    cd: { lmp: null, cycleLength: 28, nextPeriodDate: null },
    userMode: {
      isCycleTracking: false,
      isTTC: false,
      isPregnancy: false,
      isPostpartum: false,
      isBrowsing: true,
      hasLogs: false,
    },
    pick: (arr) => (Array.isArray(arr) ? arr[0] : arr),
    consent: () => "If you're comfortable sharing -",
    safeFooter: () => ["_This is educational information, not a diagnosis._"],
    greet: () => "Hey",
    ack: () => "Okay.",
    addDays: (d, n) => {
      const x = new Date(d || Date.now());
      x.setDate(x.getDate() + n);
      return x;
    },
    fmtDate: () => "Jan 1",
    daysBetween: () => 0,
    effectiveLmp: () => null,
    effectiveCycleLength: () => 28,
    getCurrentPhase: () => null,
    daysUntilNextPeriod: () => null,
    hasLmpData: () => false,
    withNickname: (s) => s,
    getNickname: () => null,
    pickAvoiding: (pool) => (Array.isArray(pool) ? pool[0] : pool),
    wasNodeRecentlySeen: () => false,
    insightFor: () => null,
    buildSymptomPatternLine: () => null,
    buildSymptomInsightLine: () => null,
    buildCycleSignalLine: () => null,
    buildCyclePersonalisationLine: () => null,
    buildRecallLine: () => null,
    extractUrgency: () => false,
    SYMPTOM_TO_CATALOG_KEYS: {},
    CATALOG_LABELS: {},
  };

  return new Proxy(envBase, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => [];
    },
  });
}

describe("education nodes expansion", () => {
  it("registers new EDUC_* nodes and all next targets exist", () => {
    const env = makeEnv();
    const helpers = buildNodeHelpers(env);

    const baseNodes = createNodes(env);
    const educationNodes = createEducationNodes(env, helpers);
    const periNodes = createPerimenopauseNodes(env, helpers);

    const allNodes = {
      ...baseNodes,
      ...educationNodes,
      ...periNodes,
    };

    const NEW_NODE_IDS = [
      "EDUC_MORE_SYMPTOMS",
      "EDUC_CONDITIONS",
      "EDUC_CERVICAL_MUCUS",
      "EDUC_BLOOD_COLOUR",
      "EDUC_CLOTS",
      "EDUC_BLOATING",
      "EDUC_FATIGUE",
      "EDUC_BREAST_TENDERNESS",
      "EDUC_HEADACHES",
      "EDUC_ACNE",
      "EDUC_NAUSEA",
      "EDUC_PAIN_DURING_SEX",
      "EDUC_BIRTH_CONTROL_CYCLE",
      "EDUC_FIBROIDS",
      "EDUC_PMDD",
      "EDUC_ANEMIA_HEAVY",
    ];

    for (const id of NEW_NODE_IDS) {
      expect(educationNodes[id]).toBeDefined();
    }

    for (const [id, node] of Object.entries(educationNodes)) {
      const choices = Array.isArray(node.choices) ? node.choices : [];
      for (const choice of choices) {
        expect(choice.next, `${id} -> ${choice.id}`).toBeTruthy();
        expect(allNodes[choice.next], `${id} -> ${choice.next}`).toBeDefined();
      }
    }

    expect(educationNodes.SYMPTOM_EDUCATION.choices.some(c => c.next === "EDUC_MORE_SYMPTOMS")).toBe(true);
    expect(educationNodes.SYMPTOM_EDUCATION.choices.some(c => c.next === "EDUC_CONDITIONS")).toBe(true);
  });
});
