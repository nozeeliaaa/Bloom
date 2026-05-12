import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");
const exists = (...parts) => existsSync(path.join(ROOT, ...parts));
const page = (name) => read("frontend", "pages", name);
const hasId = (html, id) => new RegExp(`id=["']${id}["']`).test(html);

describe("frontend page shells", () => {
  const pages = [
    "home.html",
    "dashboard.html",
    "calendar.html",
    "assistant.html",
    "clinics.html",
    "pamphlets.html",
    "login.html",
    "register.html",
    "profile.html",
    "settings.html",
    "help.html",
    "admin.html",
  ];

  pages.forEach((file) => {
    it(`${file} has a usable HTML shell`, () => {
      const html = page(file);

      expect(html).toMatch(/<!doctype html>|<html/i);
      expect(html).toMatch(/<title>/i);
      expect(html).toMatch(/<body|<main/i);
      expect(html).toContain("/css/main.css");
    });
  });
});

describe("frontend page script wiring", () => {
  const scriptCases = [
    ["calendar.html", "/js/calendar.js"],
    ["cal.html", "/js/cal.js"],
    ["settings.html", "/js/settings.js"],
    ["survey.html", "/js/survey-page.js"],
    ["report.html", "/js/report.js"],
    ["admin.html", "/js/admin.js"],
    ["admin-safety.html", "/js/admin-safety.js"],
    ["dashboard.html", "/js/dashboard.js"],
    ["assistant.html", "mountChat"],
    ["clinics.html", "Leaflet"],
  ];

  scriptCases.forEach(([file, expected]) => {
    it(`${file} includes ${expected}`, () => {
      expect(page(file)).toContain(expected);
    });
  });
});

describe("critical frontend controls", () => {
  const elementCases = [
    ["calendar.html", "calendar-grid"],
    ["calendar.html", "log-modal"],
    ["calendar.html", "log-form"],
    ["calendar.html", "flow-chips"],
    ["calendar.html", "sleep-score"],
    ["calendar.html", "stress-level"],
    ["calendar.html", "activity-level"],
    ["calendar.html", "symptom-search"],
    ["calendar.html", "other-symptom-input"],
    ["calendar.html", "prediction-panel"],
    ["dashboard.html", "cycleChart"],
    ["clinics.html", "search-clinics"],
    ["clinics.html", "filter-parish"],
    ["clinics.html", "filter-type"],
    ["clinics.html", "filter-service"],
    ["clinics.html", "btn-locate"],
    ["clinics.html", "clinic-map"],
    ["clinics.html", "clinic-grid"],
    ["pamphlets.html", "pamphlet-grid"],
    ["settings.html", "save-prefs"],
  ];

  elementCases.forEach(([file, id]) => {
    it(`${file} exposes #${id}`, () => {
      expect(hasId(page(file), id)).toBe(true);
    });
  });
});

describe("shared navigation routes", () => {
  const routeCases = [
    "/pages/dashboard.html",
    "/pages/calendar.html",
    "/pages/assistant.html",
    "/pages/pamphlets.html",
    "/pages/clinics.html",
    "/pages/profile.html",
    "/pages/privacy.html",
    "/pages/terms.html",
  ];

  routeCases.forEach((route) => {
    it(`utils.js links to ${route}`, () => {
      expect(read("frontend", "js", "utils.js")).toContain(route);
    });
  });
});

describe("frontend data contracts", () => {
  const symptoms = JSON.parse(read("frontend", "data", "symptoms.json"));
  const clinics = JSON.parse(read("frontend", "data", "clinics.json"));
  const pamphlets = JSON.parse(read("frontend", "data", "pamphlets.json"));

  it("symptoms data is a non-empty array", () => {
    expect(Array.isArray(symptoms)).toBe(true);
    expect(symptoms.length).toBeGreaterThan(100);
  });

  it("symptom keys are unique", () => {
    const keys = symptoms.map((item) => item.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("symptoms include severity scale metadata", () => {
    expect(symptoms.every((item) => "severityScale" in item)).toBe(true);
  });

  it("symptoms include expected menstrual tracking entries", () => {
    const keys = new Set(symptoms.map((item) => item.key));

    // VAGINAL_BLEEDING, HEAVY_FLOW were removed from the catalog (user decision).
    // Verify at least one pain-category entry and one mood-category entry are present.
    expect(keys.has("CRAMPS")).toBe(true);
    expect(symptoms.some((s) => s.category === "Pain")).toBe(true);
  });

  it("symptoms include teen-safe booleans", () => {
    expect(symptoms.every((item) => typeof item.teenSafe === "boolean")).toBe(true);
  });

  it("symptoms cover mood and cravings categories", () => {
    const categories = new Set(symptoms.map((item) => item.category));

    expect(categories.has("Mood")).toBe(true);
    expect(categories.has("Cravings")).toBe(true);
  });

  it("clinics data is a non-empty array", () => {
    expect(Array.isArray(clinics)).toBe(true);
    expect(clinics.length).toBeGreaterThan(20);
  });

  it("clinics include active records", () => {
    expect(clinics.some((clinic) => clinic.status === "active")).toBe(true);
  });

  it("clinics include required display fields", () => {
    expect(clinics.every((clinic) => clinic.name && clinic.address && clinic.parish)).toBe(true);
  });

  it("clinics include service arrays", () => {
    expect(clinics.every((clinic) => Array.isArray(clinic.services))).toBe(true);
  });

  it("clinics cover health centers and hospitals", () => {
    const types = new Set(clinics.map((clinic) => clinic.type));

    expect(types.has("health_center")).toBe(true);
    expect(types.has("hospital")).toBe(true);
  });

  it("pamphlets data is a non-empty array", () => {
    expect(Array.isArray(pamphlets)).toBe(true);
    expect(pamphlets.length).toBeGreaterThan(20);
  });

  it("pamphlets include title and category metadata", () => {
    expect(pamphlets.every((item) => item.title && item.category)).toBe(true);
  });

  it("pamphlets include key educational categories", () => {
    const categories = new Set(pamphlets.map((item) => item.category));

    expect(categories.has("PCOS")).toBe(true);
    expect(categories.has("Endometriosis")).toBe(true);
  });
});

describe("frontend CSS assets", () => {
  const cssFiles = [
    "admin.css",
    "base.css",
    "calendar.css",
    "components.css",
    "dashboard.css",
    "main.css",
    "pages.css",
    "settings.css",
    "survey.css",
    "theme.css",
  ];

  cssFiles.forEach((file) => {
    it(`${file} exists and contains stylesheet rules`, () => {
      const css = read("frontend", "css", file);

      expect(exists("frontend", "css", file)).toBe(true);
      expect(css.length).toBeGreaterThan(50);
      expect(css).toContain("{");
    });
  });
});

describe("legal, consent, and support pages", () => {
  const legalCases = [
    ["privacy.html", "Privacy"],
    ["terms.html", "Terms"],
    ["accessibility.html", "Accessibility"],
    ["cookie-policy.html", "Cookie"],
    ["consent-pending.html", "consent"],
    ["guardian-consent.html", "guardian"],
  ];

  legalCases.forEach(([file, text]) => {
    it(`${file} contains ${text} content`, () => {
      expect(page(file)).toContain(text);
    });
  });
});
