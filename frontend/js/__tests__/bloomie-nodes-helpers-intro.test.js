import { describe, it, expect } from "vitest";
import { buildNodeHelpers } from "../bloomie-nodes-helpers.js";

function makeEnv(overrides = {}) {
  const ctx = {
    urgency: false,
    isAnon: false,
    isMinor: false,
    adviceGiven: new Set(),
    entityHistory: [],
    moodMentions: [],
    conversationProfile: { sessionDepth: 1, concernsUnresolved: [], concernsResolved: [] },
    ...overrides.ctx,
  };

  const base = {
    ctx,
    pick: (arr) => (Array.isArray(arr) ? arr[0] : arr),
    ack: () => "Okay.",
    addDays: (d, n) => {
      const x = new Date(d || Date.now());
      x.setDate(x.getDate() + n);
      return x;
    },
    fmtDate: (d) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }),
    daysBetween: (a, b) => Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24)),
    bloomieMemory: overrides.bloomieMemory || {},
    effectiveLmp: () => overrides.cd?.lmp || null,
    effectiveCycleLength: () => overrides.cd?.cycleLength || 28,
    getCurrentPhase: () => overrides.phase || null,
    daysUntilNextPeriod: () => ("daysLeft" in overrides ? overrides.daysLeft : null),
    SYMPTOM_TO_CATALOG_KEYS: {
      pelvic: ["PELVIC_PAIN"],
      late: ["LATE_PERIOD"],
      spotting: ["SPOTTING"],
      heavy: ["HEAVY_FLOW"],
    },
    CATALOG_LABELS: {
      PELVIC_PAIN: "pelvic pain",
      LATE_PERIOD: "late period",
      SPOTTING: "spotting",
      HEAVY_FLOW: "heavy bleeding",
    },
    buildRecallLine: overrides.buildRecallLine || (() => null),
    extractUrgency: () => false,
    greet: () => "Hey",
    buildCyclePersonalisationLine: () => null,
    hasLmpData: () => !!overrides.cd?.lmp,
    cd: overrides.cd || {},
    userMode: overrides.userMode || {
      isCycleTracking: false,
      isTTC: false,
      isPregnancy: false,
      isPostpartum: false,
      isBrowsing: true,
    },
    withNickname: (s) => s,
    pickAvoiding: (arr) => (Array.isArray(arr) ? arr[0] : arr),
    wasNodeRecentlySeen: () => false,
    insightFor: () => null,
    buildSymptomPatternLine: () => null,
    buildSymptomInsightLine: () => null,
    buildCycleSignalLine: () => null,
    getNickname: () => overrides.nickname || null,
  };

  return base;
}

describe("bloomie node helpers intro priority", () => {
  it("does not duplicate overdue context line in opening intro", () => {
    const lmp = new Date(Date.now() - 44 * 24 * 60 * 60 * 1000);
    const env = makeEnv({
      daysLeft: -16,
      cd: { lmp, cycleLength: 28 },
      userMode: { isCycleTracking: true, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: false },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const lines = buildIntro();
    const overdueLine = lines.filter((line) => /period may be a little late/i.test(line));
    expect(overdueLine.length).toBe(1);
  });

  it("overdue + repeated cramps uses guided combined intro", () => {
    const lmp = new Date(Date.now() - 44 * 24 * 60 * 60 * 1000);
    const env = makeEnv({
      daysLeft: -16,
      cd: { lmp, cycleLength: 28 },
      userMode: { isCycleTracking: true, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: false },
      bloomieMemory: { lastSessionDate: new Date().toISOString() },
      ctx: {
        entityHistory: [
          { symptoms: { pelvic: true } },
          { symptoms: { pelvic: true } },
        ],
      },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const intro = buildIntro().join("\n");
    expect(intro).toMatch(/period still looks late|period may be a little late/i);
    expect(intro).toMatch(/cramps have come up recently|cramps|spotting|pregnancy concerns/i);
  });

  it("returning user with only lastIntent falls back naturally", () => {
    const env = makeEnv({
      bloomieMemory: {
        lastSessionDate: new Date().toISOString(),
        lastIntent: "HEAVY_INTRO",
      },
      userMode: { isCycleTracking: false, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: true },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const intro = buildIntro().join("\n");
    expect(intro).toMatch(/heavy bleeding/i);
    expect(intro).toMatch(/pick up where we left off|still relevant/i);
  });

  it("returning user with repeated late concern surfaces continuity", () => {
    const env = makeEnv({
      bloomieMemory: { lastSessionDate: new Date().toISOString() },
      userMode: { isCycleTracking: false, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: true },
      ctx: {
        entityHistory: [
          { symptoms: { late: true } },
          { symptoms: { late: true } },
        ],
      },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const intro = buildIntro().join("\n");
    expect(intro).toMatch(/delayed or missed timing|late period/i);
  });

  it("returning user with repeated cramps concern surfaces continuity", () => {
    const env = makeEnv({
      bloomieMemory: { lastSessionDate: new Date().toISOString() },
      userMode: { isCycleTracking: false, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: true },
      ctx: {
        entityHistory: [
          { symptoms: { pelvic: true } },
          { symptoms: { pelvic: true } },
        ],
      },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const intro = buildIntro().join("\n");
    expect(intro).toMatch(/cramps|pelvic discomfort|pelvic pain/i);
  });

  it("anonymous user keeps anonymous intro behavior", () => {
    const env = makeEnv({
      ctx: { isAnon: true },
      userMode: { isCycleTracking: false, isTTC: false, isPregnancy: false, isPostpartum: false, isBrowsing: true },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const intro = buildIntro().join("\n");
    expect(intro).toMatch(/not signed in/i);
  });

  it("pregnancy mode keeps pregnancy-specific intro", () => {
    const lmp = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
    const env = makeEnv({
      cd: { lmp, cycleLength: 28 },
      userMode: { isCycleTracking: false, isTTC: false, isPregnancy: true, isPostpartum: false, isBrowsing: false },
      bloomieMemory: { lastSessionDate: new Date().toISOString() },
    });

    const { buildIntro } = buildNodeHelpers(env);
    const intro = buildIntro().join("\n");
    expect(intro).toMatch(/pregnancy tracking mode is on/i);
    expect(intro).toMatch(/weeks? along/i);
  });
});
