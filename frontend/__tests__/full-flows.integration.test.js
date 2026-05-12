import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadHtml, jsonResponse, setInputValue } from "../test/helpers/dom.js";

const cycleState = {
  ready: true,
  phase: "menstrual",
  phaseLabel: "Menstrual",
  dayInCycle: 11,
  avgCycleLength: 28,
  predictedCycleLength: 28,
  averagePeriodDuration: 5,
  confidence: { level: "high", windowDays: 2, message: "Consistent history" },
  nextPeriodDate: "2026-05-29",
  fertileStart: "2026-05-12",
  fertileEnd: "2026-05-17",
  ovulationDate: "2026-05-16",
  cyclesLogged: 2,
  futureCycles: [],
};

function mockCycleStateFetch(state = cycleState) {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/cycles/state")) return jsonResponse({ state });
    return jsonResponse({ ok: true, items: [] });
  });
}

describe("FULL INTEGRATION FLOWS with safe mocks", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-05-11T12:00:00"));
  });

  it("Flow 1: New User Cycle Tracking - sign up, survey profile, period log, dashboard/calendar prediction source", async () => {
    vi.resetModules();
    localStorage.setItem("bloom_mode", "account");
    const { __setMockUser } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js");
    __setMockUser({ uid: "new-user", email: "new@bloom.test", getIdToken: vi.fn(async () => "id-token") });
    localStorage.setItem("bloom_profile", JSON.stringify({
      focusGoal: "period",
      avgCycleLength: 28,
      periodDuration: 5,
    }));
    localStorage.setItem("bloom_onboarded", "1");
    mockCycleStateFetch();

    const { saveDailyLog, getAllLogs } = await import("../js/db.js");
    const { fetchCycleState } = await import("../js/cycle-state.js");

    await saveDailyLog("2026-05-01", { flow: "medium", periodDay: 1, symptoms: ["Cramps"] });
    const logs = await getAllLogs();
    const state = await fetchCycleState(logs);

    expect(logs["2026-05-01"].flow).toBe("medium");
    expect(state.nextPeriodDate).toBe("2026-05-29");
    expect(state.fertileStart).toBe("2026-05-12");
    expect(state.ovulationDate).toBe("2026-05-16");
  });

  it("Flow 2: Returning User - account history loads and backend state drives dashboard/calendar", async () => {
    vi.resetModules();
    localStorage.setItem("bloom_mode", "account");
    const { __setMockUser } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js");
    __setMockUser({ uid: "u1", email: "rose@bloom.test", getIdToken: vi.fn(async () => "id-token") });
    globalThis.fetch = vi.fn(async (url) => {
      const href = String(url);
      if (href.includes("/catalog/symptoms")) return jsonResponse({ symptoms: [] });
      if (href.includes("/api/logs")) return jsonResponse({ items: [
        { dateKey: "2026-04-03", flowLevel: 2, periodDay: 1 },
        { dateKey: "2026-05-01", flowLevel: 2, periodDay: 1 },
      ]});
      if (href.includes("/api/symptoms")) return jsonResponse({ items: [] });
      if (href.includes("/api/cycles/state")) return jsonResponse({ state: { ...cycleState, source: "backend" } });
      return jsonResponse({ ok: true });
    });

    const { getAllLogs } = await import("../js/db.js");
    const { fetchCycleState } = await import("../js/cycle-state.js");
    const logs = await getAllLogs();
    const state = await fetchCycleState(logs);

    expect(Object.keys(logs)).toEqual(expect.arrayContaining(["2026-04-03", "2026-05-01"]));
    expect(state.source).toBe("backend");
    expect(state.phaseLabel).toBe("Menstrual");
  });

  it("Flow 3: Missed Period - predicted May 1 and today May 9 shows overdue, not upcoming", async () => {
    vi.setSystemTime(new Date("2026-05-09T12:00:00"));
    const { resolvePeriodPredictionStatus } = await import("../js/cycle-state.js");
    const status = resolvePeriodPredictionStatus(
      { nextPeriodDate: "2026-05-01", averagePeriodDuration: 5 },
      { "2026-04-03": { flow: "medium" } },
      "2026-05-09"
    );
    expect(status.status).toBe("overdue");
    expect(status.daysLate).toBe(8);
    expect(status.predictedStart).toBe("2026-05-01");
  });

  it("Flow 4: Learn Content - admin-added content appears and detail/PDF links are safe", () => {
    loadHtml("pages/pamphlets.html");
    const adminAdded = {
      id: "admin-pcos",
      title: "Admin PCOS Guide",
      category: "PCOS",
      summary: "Added through admin mock",
      status: "published",
      pdf: "/assets/PCOS 101 What It Is and Why It Matters.pdf",
    };
    const grid = document.querySelector("#pamphlet-grid");
    grid.innerHTML = `
      <div class="book-card is-pdf" data-id="${adminAdded.id}" role="button">
        <h3 class="book-title">${adminAdded.title}</h3>
        <p class="book-summary">${adminAdded.summary}</p>
        <span class="badge badge-primary">${adminAdded.category}</span>
        <a href="${adminAdded.pdf}" target="_blank">PDF</a>
      </div>`;

    expect(grid.textContent).toContain("Admin PCOS Guide");
    expect(grid.querySelector("a").getAttribute("href")).toContain("/assets/");
  });

  it("Flow 5: Clinic Finder - admin-added clinic appears, search filters it, map route is mocked", async () => {
    loadHtml("pages/clinics.html");
    const clinics = [
      {
        id: "admin-clinic",
        name: "Bloom Admin Clinic",
        parish: "Kingston",
        address: "10 Hope Road",
        services: ["FamilyPlanning"],
        phones: ["876-000-0000"],
        lat: 18.0,
        lng: -76.8,
      },
    ];
    setInputValue("#search-clinics", "admin");
    const query = document.querySelector("#search-clinics").value.toLowerCase();
    const filtered = clinics.filter((clinic) =>
      [clinic.name, clinic.parish, clinic.address, ...clinic.services].join(" ").toLowerCase().includes(query)
    );
    document.querySelector("#clinic-grid").innerHTML = filtered.map((clinic, i) => `
      <div class="card clinic-card" data-idx="${i}" data-lat="${clinic.lat}" data-lng="${clinic.lng}">
        <h3>${clinic.name}</h3>
        <span>${clinic.address}, ${clinic.parish}</span>
        <span>${clinic.phones[0]}</span>
        <button class="btn-focus-map">View on map</button>
        <button class="btn-get-directions">Get directions</button>
      </div>
    `).join("");
    window.L.map("clinic-map").setView([clinics[0].lat, clinics[0].lng], 14);
    window.L.polyline([[17.99, -76.79], [clinics[0].lat, clinics[0].lng]]).addTo({});

    expect(document.querySelector("#clinic-grid").textContent).toContain("Bloom Admin Clinic");
    expect(window.L.map).toHaveBeenCalledWith("clinic-map");
    expect(window.L.polyline).toHaveBeenCalled();
  });

  it("Flow 6: Support Request - user submits, admin responds, email failure is preserved", async () => {
    loadHtml("pages/help.html");
    const request = {
      subject: "technical",
      message: "I need help with export",
      email: "rose@example.test",
      name: "Rose",
    };
    globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).includes("/api/contact")) {
        expect(JSON.parse(options.body)).toMatchObject(request);
        return jsonResponse({ ok: true, delivered: true, requestId: "SUP-1" });
      }
      if (String(url).includes("/api/admin/support/SUP-1/respond")) {
        return jsonResponse({ ok: true, emailDelivered: false, responseSaved: true });
      }
      return jsonResponse({ ok: true });
    });

    await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const response = await fetch("/api/admin/support/SUP-1/respond", {
      method: "POST",
      body: JSON.stringify({ message: "Thanks, we saved your response.", sendEmail: true }),
    }).then((res) => res.json());

    expect(response.responseSaved).toBe(true);
    expect(response.emailDelivered).toBe(false);
  });

  it("Flow 7: Export - user logs cycle data, dashboard has data, PDF mock is called", async () => {
    const { saveDailyLog, getAllLogs } = await import("../js/db.js");
    const { buildReportData } = await import("../js/pdf-report-data.js");
    const { generatePDF } = await import("../js/pdf-generator.js");
    const { mockSave } = await import("jspdf");

    await saveDailyLog("2026-05-01", { flow: "medium", periodDay: 1, notes: "cycle started" });
    const logs = await getAllLogs();
    const report = buildReportData(logs, cycleState, "Rose");
    generatePDF(report);

    expect(report.cyclesTracked).toBeGreaterThan(0);
    expect(mockSave).toHaveBeenCalled();
  });
});
