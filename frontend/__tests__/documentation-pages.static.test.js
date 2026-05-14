import { describe, expect, it } from "vitest";
import { loadHtml, readFrontendFile, text, expectNoBadPlaceholders } from "../test/helpers/dom.js";

describe("frontend page structure for final documentation", () => {
  it("sign up page renders required account fields and guardian consent controls", () => {
    loadHtml("pages/register.html");
    expect(document.querySelector("#register-form")).toBeTruthy();
    expect(document.querySelector("#email[type='email']")).toBeTruthy();
    expect(document.querySelector("#password[type='password']")).toBeTruthy();
    expect(document.querySelector("#confirm-password[type='password']")).toBeTruthy();
    expect(document.querySelector("#yob")).toBeTruthy();
    expect(document.querySelector("#guardian-section")).toBeTruthy();
    expect(document.querySelector("#guardian-email[type='email']")).toBeTruthy();
    expect(document.querySelector("#terms-confirm[required]")).toBeTruthy();
    expectNoBadPlaceholders();
  });

  it("sign in page renders login, reset, resend verification, and anonymous entry points", () => {
    loadHtml("pages/login.html");
    expect(document.querySelector("#login-form")).toBeTruthy();
    expect(document.querySelector("#email[type='email']")).toBeTruthy();
    expect(document.querySelector("#password[type='password']")).toBeTruthy();
    expect(document.querySelector("#verify-notice")).toBeTruthy();
    expect(document.querySelector("#btn-resend")).toBeTruthy();
    expect(document.querySelector("#reset-panel")).toBeTruthy();
    expect(document.querySelector("#btn-anon")).toBeTruthy();
    expectNoBadPlaceholders();
  });

  it("survey page has the real app mount point and survey module", () => {
    loadHtml("pages/survey.html");
    expect(document.querySelector("main#app")).toBeTruthy();
    expect(readFrontendFile("pages/survey.html")).toContain('/js/survey-page.js');
  });

  it("profile and settings pages expose profile, goal, preference, theme, notification, and logout UI", () => {
    loadHtml("pages/profile.html");
    expect(document.querySelector("#goals-grid")).toBeTruthy();
    expect(document.querySelector("#profile-logout-btn")).toBeTruthy();
    expect(document.querySelector("a[href='/pages/profile-view.html']")).toBeTruthy();
    expect(document.querySelector("a[href='/pages/settings.html']")).toBeTruthy();

    loadHtml("pages/settings.html");
    expect(document.querySelector("#theme-light")).toBeTruthy();
    expect(document.querySelector("#theme-dark")).toBeTruthy();
    expect(document.querySelector("#theme-system")).toBeTruthy();
    expect(document.querySelector("#pref-period-reminder")).toBeTruthy();
    expect(document.querySelector("#pref-reminders")).toBeTruthy();
    expect(document.querySelector("#pref-fertile-alert")).toBeTruthy();
    expect(document.querySelector("#pref-discreet-notif")).toBeTruthy();
    expect(document.querySelector("#save-prefs")).toBeTruthy();
  });

  it("profile detail page contains delete account controls", () => {
    loadHtml("pages/profile-view.html");
    expect(text()).toMatch(/Delete account/i);
    expect(document.querySelector("#delete-account-btn, [id*='delete']")).toBeTruthy();
  });

  it("dashboard renders cycle summary, phase, goal, insights, history, trends, and export controls", () => {
    loadHtml("pages/dashboard.html");
    expect(document.querySelector("#goal-badge")).toBeTruthy();
    expect(document.querySelector("#cycle-snapshot")).toBeTruthy();
    expect(document.querySelector("#cycle-phase")).toBeTruthy();
    expect(document.querySelector("#goal-tool")).toBeTruthy();
    expect(document.querySelector("#insights")).toBeTruthy();
    expect(document.querySelector("#advanced-insights")).toBeTruthy();
    expect(document.querySelector("#cycle-dots")).toBeTruthy();
    expect(document.querySelector("#cycleChart")).toBeTruthy();
    expect(document.querySelector("#export-pdf")).toBeTruthy();
    expectNoBadPlaceholders();
  });

  it("calendar page renders navigation, legend, prediction panel, and log modal fields", () => {
    loadHtml("pages/calendar.html");
    expect(document.querySelector("#prev-month")).toBeTruthy();
    expect(document.querySelector("#next-month")).toBeTruthy();
    expect(document.querySelector("#month-label")).toBeTruthy();
    expect(document.querySelector("#calendar-grid")).toBeTruthy();
    expect(text()).toMatch(/Period \(logged\)/);
    expect(text()).toMatch(/Period \(predicted\)/);
    expect(text()).toMatch(/Fertile window/);
    expect(text()).toMatch(/Ovulation/);
    expect(document.querySelector("#log-modal")).toBeTruthy();
    expect(document.querySelector("#log-form")).toBeTruthy();
    expect(document.querySelector("#flow-chips")).toBeTruthy();
    expect(document.querySelector("#symptom-categories")).toBeTruthy();
    expect(document.querySelector("#notes")).toBeTruthy();
    expect(document.querySelector("#delete-log-btn")).toBeTruthy();
  });

  it("learn/pamphlets page exposes search, category filters, list view, reader view, and PDF metadata", () => {
    loadHtml("pages/pamphlets.html");
    expect(document.querySelector("#pamphlet-search")).toBeTruthy();
    expect(document.querySelector("#category-filters")).toBeTruthy();
    expect(document.querySelector("#pamphlet-grid")).toBeTruthy();
    expect(document.querySelector("#reader-view")).toBeTruthy();
    expect(document.querySelector("#reader-title")).toBeTruthy();
    expect(readFrontendFile("pages/pamphlets.html")).toMatch(/PDF|pdf/i);
  });

  it("clinic finder page exposes search, filters, location controls, map, and results grid", () => {
    loadHtml("pages/clinics.html");
    expect(document.querySelector("#search-clinics")).toBeTruthy();
    expect(document.querySelector("#filter-parish")).toBeTruthy();
    expect(document.querySelector("#filter-type")).toBeTruthy();
    expect(document.querySelector("#filter-service")).toBeTruthy();
    expect(document.querySelector("#btn-locate")).toBeTruthy();
    expect(document.querySelector("#btn-pin")).toBeTruthy();
    expect(document.querySelector("#clinic-map")).toBeTruthy();
    expect(document.querySelector("#clinic-grid")).toBeTruthy();
  });

  it("Bloomie page renders chat feed, settings, typing input, microphone, and send button", () => {
    loadHtml("pages/assistant.html");
    expect(document.querySelector("#chat-box")).toBeTruthy();
    expect(document.querySelector("#chat-form")).toBeTruthy();
    expect(document.querySelector("#chat-input")).toBeTruthy();
    expect(document.querySelector("#chat-mic-btn")).toBeTruthy();
    expect(document.querySelector(".chat-send-btn")).toBeTruthy();
    expect(document.querySelector("#chat-settings-btn")).toBeTruthy();
    expect(document.querySelector("#offline-badge")).toBeTruthy();
  });

  it("help and support page renders FAQ, resources, contact form, and success/error states", () => {
    loadHtml("pages/help.html");
    expect(document.querySelector("[data-tab='faq']")).toBeTruthy();
    expect(document.querySelectorAll(".faq-item").length).toBeGreaterThan(5);
    expect(document.querySelector("[data-tab='resources']")).toBeTruthy();
    expect(document.querySelector("[data-tab='contact']")).toBeTruthy();
    expect(document.querySelector("#contact-form")).toBeTruthy();
    expect(document.querySelector("#contact-subject")).toBeTruthy();
    expect(document.querySelector("#contact-message")).toBeTruthy();
    expect(document.querySelector("#contact-success")).toBeTruthy();
    expect(document.querySelector("#contact-error")).toBeTruthy();
  });

  it("admin dashboard contains overview, users, pamphlets, clinics, support, reviews, and edit modals", () => {
    loadHtml("pages/admin.html");
    for (const tab of ["overview", "users", "pamphlets", "clinics", "support", "reviews"]) {
      expect(document.querySelector(`[data-tab='${tab}']`)).toBeTruthy();
      expect(document.querySelector(`#tab-${tab}`)).toBeTruthy();
    }
    expect(document.querySelector("#users-search")).toBeTruthy();
    expect(document.querySelector("#pamphlet-add-btn")).toBeTruthy();
    expect(document.querySelector("#clinic-add-btn")).toBeTruthy();
    expect(document.querySelector("#support-response-modal")).toBeTruthy();
    expect(document.querySelector("#support-response-save-btn")).toBeTruthy();
  });

  it("navigation code includes the main user routes and admin-only link gating", () => {
    const utils = readFrontendFile("js/utils.js");
    expect(utils).toContain("/pages/dashboard.html");
    expect(utils).toContain("/pages/calendar.html");
    expect(utils).toContain("/pages/pamphlets.html");
    expect(utils).toContain("/pages/clinics.html");
    expect(utils).toContain("/pages/assistant.html");
    expect(utils).toMatch(/isAdmin|bloom_is_admin|admin/i);
  });
});
