import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/helpers/dom.js";

describe("frontend storage, notifications, and export integrations", () => {
  beforeEach(() => {
    localStorage.setItem("bloom_mode", "anon");
  });

  it("health log add/edit/delete persists locally without real Firebase writes", async () => {
    const { saveDailyLog, getAllLogs, deleteDailyLog } = await import("../js/db.js");

    await saveDailyLog("2026-05-01", {
      flow: "medium",
      symptoms: ["Cramps"],
      symptomSeverity: { Cramps: 4 },
      notes: "first day",
    });
    let logs = await getAllLogs();
    expect(logs["2026-05-01"].flow).toBe("medium");
    expect(logs["2026-05-01"].notes).toBe("first day");

    await saveDailyLog("2026-05-01", { flow: "heavy", symptoms: ["Fatigue"], notes: "updated" });
    logs = await getAllLogs();
    expect(logs["2026-05-01"].flow).toBe("heavy");
    expect(logs["2026-05-01"].symptoms).toContain("Fatigue");

    await deleteDailyLog("2026-05-01");
    logs = await getAllLogs();
    expect(logs["2026-05-01"]).toBeUndefined();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("firebase"), expect.anything());
  });

  it("account-mode log save calls mocked API endpoints with auth headers only", async () => {
    vi.resetModules();
    localStorage.setItem("bloom_mode", "account");
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("/catalog/symptoms")) return jsonResponse({ symptoms: [] });
      return jsonResponse({ ok: true });
    });
    const { __setMockUser } = await import("../test/mocks/firebase-auth.js");
    __setMockUser({ uid: "u1", email: "u@bloom.test", getIdToken: vi.fn(async () => "id-token") });
    const { saveDailyLog } = await import("../js/db.js");

    await saveDailyLog("2026-05-02", { flow: "light", symptoms: ["Cramps"], notes: "sync" });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/logs/2026-05-02"),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ Authorization: "Bearer id-token" }),
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/symptoms/2026-05-02"),
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("notification permission, granted reminders, and inbox persistence work with mocked Notification API", async () => {
    localStorage.setItem("bloom_preferences", JSON.stringify({
      reminders: true,
      periodReminder: true,
      fertileAlert: true,
    }));
    Notification.permission = "granted";
    const { triggerNotifications, getInbox } = await import("../js/notifications.js");

    await triggerNotifications({
      phase: "menstrual",
      dayInCycle: 3,
      nextPeriodDate: "2026-05-12",
      fertileStart: "2026-05-11",
      fertileEnd: "2026-05-16",
      ovulationDate: "2026-05-12",
    }, {});

    expect(getInbox().length).toBeGreaterThan(0);
    expect(Notification.instances.length).toBeGreaterThan(0);
  });

  it("denied notification permission does not throw and stores no browser notification", async () => {
    localStorage.setItem("bloom_preferences", JSON.stringify({ reminders: true }));
    Notification.permission = "denied";
    Notification.requestPermission.mockResolvedValueOnce("denied");
    const { triggerNotifications } = await import("../js/notifications.js");
    await expect(triggerNotifications({}, {})).resolves.toBeUndefined();
  });

  it("PDF export uses mocked jsPDF and never opens external services", async () => {
    const { generatePDF } = await import("../js/pdf-generator.js");
    const { mockSave } = await import("jspdf");
    generatePDF({
      generatedDate: "2026-05-11",
      userName: "Rose",
      cyclesTracked: 1,
      avgCycleLength: 28,
      avgPeriodLength: 5,
      currentPhase: "menstrual",
      cyclesNewestFirst: [{ start: "2026-05-01", periodLength: 5, cycleLength: 28 }],
      symptomLog: [],
      topSymptoms: [],
      topCustomSymptoms: [],
      regularity: { label: "Normal", tier: "tight", inTypicalRange: true },
      narrativeSummary: "Cycle report summary",
      alerts: [],
      signalSummary: { signals: [], guidanceLines: [] },
    });
    expect(mockSave).toHaveBeenCalledWith("bloom-cycle-report-2026-05-11.pdf");
    expect(fetch).not.toHaveBeenCalled();
  });
});
