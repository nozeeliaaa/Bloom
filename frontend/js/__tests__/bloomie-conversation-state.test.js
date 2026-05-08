import { describe, expect, it } from "vitest";
import {
  createEmptyConversationState,
  extractBleedingConversationSignals,
  mergeBleedingConversationState,
  buildNodeHelpers,
} from "../bloomie-nodes-helpers.js";

describe("Bloomie bleeding conversation state", () => {
  it("extracts clot and heavy-flow signals from free text", () => {
    const signals = extractBleedingConversationSignals("i have heavy bleeding with clots", {
      symptoms: { heavy: true, large_clots: false },
      pregnancy: {},
    });
    expect(signals.heavyFlow).toBe(true);
    expect(signals.clots).toBe(true);
  });

  it("overwrites a prior clot answer when the user corrects themselves", () => {
    const initial = mergeBleedingConversationState(createEmptyConversationState(), { clots: true });
    const corrected = mergeBleedingConversationState(initial, extractBleedingConversationSignals("no clots"));
    expect(corrected.symptoms.clots).toBe(false);
    expect(corrected.symptoms.clotsLarge).toBe(false);
  });

  it("prioritizes clot-size follow-up when clots were mentioned", () => {
    const ctx = {
      conversationState: createEmptyConversationState(),
      history: [{ from: "user", text: "i'm having clots" }],
      entityHistory: [{ symptoms: { large_clots: false }, pregnancy: {} }],
      urgency: false,
      adviceGiven: new Set(),
      moodMentions: [],
      isAnon: false,
      conversationProfile: { sessionDepth: 1, concernsUnresolved: [] },
      heavyFlags: {},
    };

    const helpers = buildNodeHelpers({
      ctx,
      pick: (arr) => arr[0],
      ack: () => "okay",
      addDays: (date, days) => new Date(new Date(date).getTime() + days * 86400000),
      fmtDate: () => "Apr 10",
      daysBetween: () => 0,
      bloomieMemory: null,
      effectiveLmp: null,
      effectiveCycleLength: null,
      getCurrentPhase: () => null,
      daysUntilNextPeriod: () => null,
      SYMPTOM_TO_CATALOG_KEYS: {},
      CATALOG_LABELS: {},
      buildRecallLine: () => null,
      extractUrgency: () => false,
      greet: () => "Hey",
      buildCyclePersonalisationLine: () => null,
      hasLmpData: false,
      cd: {},
      userMode: {},
      withNickname: (line) => line,
      pickAvoiding: (arr) => arr[0],
      wasNodeRecentlySeen: () => false,
      insightFor: () => null,
      buildSymptomPatternLine: () => null,
      buildSymptomInsightLine: () => null,
      buildCycleSignalLine: () => null,
      getNickname: () => null,
      pregnancyAlgorithm: null,
    });

    helpers.syncBleedingConversationState();
    expect(helpers.getBleedingConversationState().symptoms.clots).toBe(true);
    expect(helpers.getNextBleedingFollowUp()).toBe("clots_size");
  });
});
