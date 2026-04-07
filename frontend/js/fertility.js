/**
 * fertility.js - TTC-only tools page
 * Account mode only + goal must be "ttc"
 */

import { renderNav, renderFooter, renderModeBanner, renderBloomieFab, formatDate, toDateKey } from "./utils.js";
import { isAccountMode } from "./mode.js";
import { getUserGoal } from "./goals.js";
import { getAllLogs } from "./db.js";
import { computeCyclePhase } from "./phase.js";

function diffDays(a, b) {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}

function redirect(path) {
  window.location.href = path;
}

function guardAccess() {
  // ✅ account-only
  if (!isAccountMode()) {
    redirect("/pages/login.html");
    return false;
  }

  // ✅ TTC-only
  const goal = getUserGoal();
  if (goal !== "ttc") {
    redirect("/pages/dashboard.html");
    return false;
  }

  return true;
}

function renderConceptionWindow(cycle) {
  const el = document.getElementById("conception-window");
  if (!el) return;

  if (cycle?.fertileStart && cycle?.fertileEnd) {
    el.innerHTML = `
      <div class="stat-number">${formatDate(cycle.fertileStart)} → ${formatDate(cycle.fertileEnd)}</div>
      <p class="text-muted">This is your estimated conception window based on logged history.</p>
      ${cycle.ovulationDate ? `<p class="form-hint">Estimated peak day: ${formatDate(cycle.ovulationDate)}</p>` : `<p class="form-hint">Log more cycles to estimate a peak day.</p>`}
    `;
    return;
  }

  el.innerHTML = `
    <div class="stat-number">Not enough data</div>
    <p class="text-muted">Log period days in the calendar to estimate your conception window.</p>
    <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;">Open calendar</a>
  `;
}

function renderConfidence(cycle) {
  const el = document.getElementById("fertility-confidence");
  if (!el) return;

  // computeCyclePhase already returns a "confidence" label in your dashboard
  const confidence = cycle?.confidence || "Low";

  const desc =
    confidence === "High"
      ? "Based on consistent cycle history and enough logged data."
      : confidence === "Medium"
      ? "Some history is available, but more logs will improve reliability."
      : "Limited or irregular data. Keep logging for better estimates.";

  el.innerHTML = `
    <div class="stat-number">${confidence}</div>
    <p class="text-muted">${desc}</p>
    <p class="form-hint">Educational estimate only.</p>
  `;
}

function renderWhenToTest(cycle) {
  const el = document.getElementById("testing-guidance");
  if (!el) return;

  const todayKey = toDateKey(new Date());

  // If we have an ovulation estimate, guide based on DPO
  if (cycle?.ovulationDate) {
    const dpo = diffDays(cycle.ovulationDate, todayKey);

    // Typical guidance (non-medical): most tests more accurate after missed period,
    // some early tests around 10–12 DPO, more reliable 12–14 DPO.
    let headline = "Testing guidance";
    let text = "Many tests are most reliable after a missed period.";
    let hint = "";

    if (dpo < 0) {
      headline = "Too early to test";
      text = "Your estimated peak day is in the future. Testing now may not be meaningful.";
      hint = "Keep logging for improved estimates.";
    } else if (dpo <= 9) {
      headline = `Early window (about ${dpo} days after peak)`;
      text = "It may be too early for many tests. Consider waiting closer to a missed period for reliability.";
      hint = "If you test early, retest later if your period is late.";
    } else if (dpo <= 13) {
      headline = `Testing window (about ${dpo} days after peak)`;
      text = "Some tests may detect pregnancy around this time, but results vary.";
      hint = "For best accuracy, test after a missed period.";
    } else {
      headline = `Good time to test (about ${dpo} days after peak)`;
      text = "If your period is late, many tests are more reliable now.";
      hint = "If you get a negative result and your period still doesn’t start, consider retesting later.";
    }

    el.innerHTML = `
      <div class="stat-number">${headline}</div>
      <p class="text-muted">${text}</p>
      <p class="form-hint">Estimated peak day: ${formatDate(cycle.ovulationDate)} • Educational guidance only.</p>
      ${hint ? `<p class="form-hint">${hint}</p>` : ""}
    `;
    return;
  }

  // Fallback: use next period estimate if available
  if (cycle?.nextPeriodDate) {
    const daysUntil = diffDays(todayKey, cycle.nextPeriodDate);

    el.innerHTML = `
      <div class="stat-number">Best accuracy: after a missed period</div>
      <p class="text-muted">
        Your next expected period is ${formatDate(cycle.nextPeriodDate)} (~${daysUntil} day${daysUntil !== 1 ? "s" : ""}).
        Testing is usually more reliable if your period is late.
      </p>
      <p class="form-hint">Educational guidance only.</p>
    `;
    return;
  }

  el.innerHTML = `
    <div class="stat-number">Not enough data</div>
    <p class="text-muted">Log period days so Bloom can estimate timing tools for testing guidance.</p>
    <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;">Open calendar</a>
  `;
}

async function init() {
  // UI chrome
  renderNav("fertility");
  renderFooter();
  renderBloomieFab();
  renderModeBanner(document.getElementById("banner-area"));

  if (!guardAccess()) return;

  const logs = await getAllLogs();
  const cycle = computeCyclePhase(logs);

  renderConceptionWindow(cycle);
  renderConfidence(cycle);
  renderWhenToTest(cycle);
}

init();