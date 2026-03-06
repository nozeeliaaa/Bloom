/**
 * report.js — Report for Doctor
 * - Shows a preview summary
 * - Generates the SAME readable PDF (not screenshot) from cycle history
 */

import { renderNav, renderFooter, renderModeBanner, renderBloomieFab, formatDate, toDateKey } from "./utils.js";
import { getAllLogs } from "./db.js";
import { computeCyclePhase } from "./phase.js";

renderNav("report");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

function isPeriodFlow(flow) {
  return ["spotting", "light", "medium", "heavy"].includes(String(flow || "").toLowerCase());
}

function addDays(isoDate, delta) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toDateKey(dt);
}

function diffDays(a, b) {
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}

function sortAsc(a, b) {
  return String(a).localeCompare(String(b));
}

function getPeriodStartsFromLogs(logsByDate) {
  const dates = Object.keys(logsByDate || {}).sort(sortAsc);
  const periodDays = dates.filter(d => isPeriodFlow(logsByDate[d]?.flow));
  const periodSet = new Set(periodDays);

  const starts = [];
  for (const d of periodDays) {
    const prev = addDays(d, -1);
    if (!periodSet.has(prev)) starts.push(d);
  }
  return [...new Set(starts)].sort(sortAsc);
}

function getCycles(periodStarts) {
  const cycles = [];
  for (let i = 0; i < periodStarts.length - 1; i++) {
    const start = periodStarts[i];
    const next = periodStarts[i + 1];
    const length = diffDays(start, next);
    if (length > 0 && length <= 90) cycles.push({ start, next, length });
  }
  return cycles;
}

function average(nums) {
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function generateCyclePDF(cycle, logsByDate) {
  if (!window.jspdf) { alert("PDF library not loaded. Check your connection and try again."); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const cycleStarts = cycle.cycleStarts || [];
  const cycleLengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    cycleLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }
  const avg = cycleLengths.length
    ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length)
    : null;

  const pageW = 210, margin = 18, cW = pageW - margin * 2;
  let y = 0;

  // ── Header band ──
  doc.setFillColor(212, 116, 154);
  doc.rect(0, 0, pageW, 20, "F");
  doc.setFontSize(15); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255);
  doc.text("Bloom — Health Report for Doctor", margin, 13);

  y = 28;
  doc.setFontSize(9.5); doc.setFont("helvetica", "normal"); doc.setTextColor(140, 110, 140);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, margin, y);
  y += 4;
  doc.setDrawColor(212, 116, 154); doc.line(margin, y, pageW - margin, y);
  y += 7;

  // ── Summary ──
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(184, 92, 130);
  doc.text("CYCLE SUMMARY", margin, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setTextColor(60, 40, 60);
  if (avg) { doc.text(`Average cycle length: ${avg} days`, margin, y); y += 5; }
  doc.text(`Cycles tracked: ${cycleStarts.length}`, margin, y); y += 5;
  if (cycleStarts.length) {
    doc.text(`Data from: ${formatDate(cycleStarts[0])}`, margin, y); y += 5;
  }
  y += 2;
  doc.setDrawColor(220, 200, 220); doc.line(margin, y, pageW - margin, y); y += 7;

  // ── Cycle details ──
  doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(184, 92, 130);
  doc.text("CYCLE DETAILS", margin, y); y += 7;

  const todayKey = toDateKey(new Date());

  [...cycleStarts].reverse().forEach((start, revIdx) => {
    const i = cycleStarts.length - 1 - revIdx;
    const cycleLen = cycleLengths[i];
    const isCurrent = cycleLen == null;
    const nextStart = isCurrent ? null : cycleStarts[i + 1];
    const cycleEndKey = nextStart ? addDays(nextStart, -1) : todayKey;

    if (y > 258) { doc.addPage(); y = 20; }

    const daysSoFar = diffDays(start, todayKey) + 1;
    const heading = isCurrent
      ? `Current cycle — Day ${daysSoFar} (started ${formatDate(start)})`
      : `${cycleLen} days — ${formatDate(start)} to ${formatDate(cycleEndKey)}`;

    doc.setFontSize(10.5); doc.setFont("helvetica", "bold"); doc.setTextColor(60, 40, 60);
    doc.text(heading, margin, y); y += 5;

    if (!isCurrent && nextStart) {
      const ov  = addDays(nextStart, -14);
      const fws = addDays(nextStart, -19);
      const fwe = addDays(nextStart, -13);
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.setTextColor(100, 80, 100);
      doc.text(`Ovulation (est.): ${formatDate(ov)}   Fertile window: ${formatDate(fws)} – ${formatDate(fwe)}`, margin + 3, y);
      y += 5;
    }

    // Symptoms logged in this cycle
    const symptoms = [];
    let d = 0;
    while (d <= 60) {
      const dk = addDays(start, d);
      if (dk > cycleEndKey) break;
      const log = logsByDate[dk];
      if (log?.symptoms?.length) symptoms.push(`${formatDate(dk)}: ${log.symptoms.join(", ")}`);
      if (log?.notes) symptoms.push(`${formatDate(dk)} (note): ${log.notes}`);
      d++;
    }

    if (symptoms.length) {
      doc.setFontSize(9); doc.setFont("helvetica", "italic"); doc.setTextColor(120, 100, 120);
      symptoms.forEach((s) => {
        if (y > 268) { doc.addPage(); y = 20; }
        const lines = doc.splitTextToSize(`  ${s}`, cW - 6);
        doc.text(lines, margin + 4, y);
        y += lines.length * 4.2;
      });
    }

    y += 3;
    doc.setDrawColor(230, 215, 230); doc.line(margin, y, pageW - margin, y); y += 5;
  });

  // ── Disclaimer ──
  if (y > 255) { doc.addPage(); y = 20; }
  y += 2;
  doc.setFontSize(8); doc.setFont("helvetica", "italic"); doc.setTextColor(160, 140, 160);
  const disc = "This report is for personal reference only and is not a medical document. Always consult a qualified healthcare provider for medical advice. Bloom is an educational tool.";
  doc.text(doc.splitTextToSize(disc, cW), margin, y);

  doc.save(`bloom-health-report-${todayKey}.pdf`);
}

async function loadPreview() {
  const previewEl = document.getElementById("report-preview");
  const logsByDate = await getAllLogs();
  const cycle = computeCyclePhase(logsByDate);

  const periodStarts = getPeriodStartsFromLogs(logsByDate);
  const cycles = getCycles(periodStarts);
  const avgCycleLength = average(cycles.map(c => c.length));
  const periodDays = Object.keys(logsByDate).filter(d => isPeriodFlow(logsByDate[d]?.flow)).sort(sortAsc);

  if (!periodDays.length) {
    previewEl.innerHTML = `
      <p class="text-muted">Log period days in the Calendar to generate a report.</p>
      <a class="btn btn-outline" href="/pages/calendar.html" style="display:inline-block;margin-top:0.5rem;">Open Calendar</a>
    `;
  } else {
    const lastStart = periodStarts.length ? periodStarts[periodStarts.length - 1] : null;
    const nextDate = (avgCycleLength && lastStart) ? addDays(lastStart, avgCycleLength) : null;

    const cycleRows = cycles.slice(-5).reverse().map(c => `
      <tr>
        <td>${formatDate(c.start)}</td>
        <td>${formatDate(c.next)}</td>
        <td class="${c.length < 21 || c.length > 35 ? "out-of-range" : ""}">${c.length} days</td>
      </tr>`).join("");

    previewEl.innerHTML = `
      <div class="stat-row">
        <div class="stat-tile">
          <div class="stat-tile-label">Cycles tracked</div>
          <div class="stat-tile-value">${cycles.length}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-label">Avg cycle length</div>
          <div class="stat-tile-value">${avgCycleLength ? `${avgCycleLength}d` : "—"}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-label">Last period</div>
          <div class="stat-tile-value" style="font-size:1rem;">${lastStart ? formatDate(lastStart) : "—"}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile-label">Next expected</div>
          <div class="stat-tile-value" style="font-size:1rem;">${nextDate ? formatDate(nextDate) : "—"}</div>
        </div>
      </div>
      ${cycleRows ? `
        <p class="text-muted" style="font-size:0.85rem;margin-bottom:0.5rem;">Recent cycles (newest first):</p>
        <table class="cycle-table">
          <thead><tr><th>Period Start</th><th>Next Start</th><th>Length</th></tr></thead>
          <tbody>${cycleRows}</tbody>
        </table>` : ""}
    `;
  }

  // Wire up download button
  const btn = document.getElementById("download-report");
  if (btn) {
    btn.onclick = () => {
      if (!periodDays.length) {
        alert("No cycle history data yet. Log period days on the calendar first.");
        return;
      }
      generateCyclePDF(cycle, logsByDate);
    };
  }
}

loadPreview();
