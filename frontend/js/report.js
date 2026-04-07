/**
 * report.js - Bloom Personal Cycle Report page
 * PDF generation lives in pdf-generator.js.
 */

import {
  renderNav,
  renderFooter,
  renderModeBanner,
  renderBloomieFab,
} from "./utils.js";
import { getAllLogs }         from "./db.js";
import { fetchCycleState }   from "./cycle-state.js";
import { buildReportData, formatDateMed } from "./pdf-report-data.js";
import { generatePDF }       from "./pdf-generator.js";

renderNav("report");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

async function loadPreview() {
  const previewEl  = document.getElementById("report-preview");
  const logsByDate = await getAllLogs();

  console.log("[report] fetching cycle state…");
  const cycleState = await fetchCycleState(logsByDate);
  console.log(
    `[report] cycle state resolved: source=${cycleState.source}` +
    ` phase=${cycleState.phase} day=${cycleState.dayInCycle}` +
    ` predictedLen=${cycleState.predictedCycleLength}` +
    ` conf=${cycleState.confidence?.level} cyclesLogged=${cycleState.cyclesLogged}`
  );

  const userName = localStorage.getItem("bloom_user_name") ?? null;
  const report   = buildReportData(logsByDate, cycleState, userName);

  if (!report.cyclesTracked) {
    previewEl.innerHTML = `
      <p class="text-muted">Log period days in the Calendar to generate a report.</p>
      <a class="btn btn-outline" href="/pages/calendar.html"
         style="display:inline-block;margin-top:0.5rem;">Open Calendar</a>
    `;
  } else {
    const { avgCycleLength, avgPeriodLength, cyclesTracked,
            lastPeriodStart, nextPeriodDate, regularity,
            predictedCycleLength, confidenceLevel } = report;

    const cycleRows = report.cyclesNewestFirst.slice(0, 5).map((c) => `
      <tr>
        <td>${formatDateMed(c.start)}</td>
        <td>${c.periodLength ? `${c.periodLength}d` : "-"}</td>
        <td class="${
          !c.isCurrent && c.cycleLength && (c.cycleLength < 21 || c.cycleLength > 35)
            ? "out-of-range" : ""
        }">${c.isCurrent ? `Day ${c.daysSoFar}` : c.cycleLength ? `${c.cycleLength}d` : "-"}</td>
      </tr>`).join("");

    const regularityBadge = regularity?.label && regularity.label !== "Not enough data"
      ? `<span class="regularity-badge">${regularity.label}</span>`
      : "";

    const predTile = predictedCycleLength && predictedCycleLength !== avgCycleLength
      ? `<div class="stat-tile">
           <div class="stat-tile-label">Predicted cycle</div>
           <div class="stat-tile-value">${predictedCycleLength}d</div>
         </div>`
      : "";

    previewEl.innerHTML = `
      ${regularityBadge}
      <div class="stat-row">
        <div class="stat-tile">
          <div class="stat-tile-label">Cycles tracked</div>
          <div class="stat-tile-value">${cyclesTracked}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-label">Avg cycle</div>
          <div class="stat-tile-value">${avgCycleLength ? `${avgCycleLength}d` : "-"}</div>
        </div>
        ${predTile}
        <div class="stat-tile">
          <div class="stat-tile-label">Avg period</div>
          <div class="stat-tile-value">${avgPeriodLength ? `${avgPeriodLength}d` : "-"}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-label">Last period</div>
          <div class="stat-tile-value stat-value-sm">
            ${lastPeriodStart ? formatDateMed(lastPeriodStart) : "-"}
          </div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-label">Next expected</div>
          <div class="stat-tile-value stat-value-sm">
            ${nextPeriodDate ? formatDateMed(nextPeriodDate) : "-"}
          </div>
        </div>
      </div>
      ${cycleRows ? `
        <p class="recent-label">Recent cycles (newest first)</p>
        <table class="cycle-table">
          <thead>
            <tr><th>Period Start</th><th>Period Length</th><th>Cycle Length</th></tr>
          </thead>
          <tbody>${cycleRows}</tbody>
        </table>` : ""}
      ${confidenceLevel && confidenceLevel !== "High" && report.confidenceMessage ? `
        <p class="text-muted" style="font-size:0.8rem;margin-top:0.75rem;">
          ${report.confidenceMessage}
        </p>` : ""}
    `;
  }

  const btn = document.getElementById("download-report");
  if (btn) {
    btn.addEventListener("click", () => {
      if (!report.cyclesTracked) {
        alert("No cycle history yet. Log period days in the Calendar first.");
        return;
      }
      console.log("[report] generating PDF…", report);
      generatePDF(report);
    });
  }
}

loadPreview();
