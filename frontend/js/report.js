/**
 * report.js — Report for Doctor
 * - Shows a preview summary
 * - Generates the SAME readable PDF (not screenshot) from cycle history
 */

import { renderNav, renderFooter, renderModeBanner, renderBloomieFab, formatDate, toDateKey } from "./utils.js";
import { getAllLogs } from "./db.js";

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

function setupExportCycleHistoryPDF(getReportData) {
  const btn = document.getElementById("download-report");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (!window.jspdf) {
      alert("jsPDF not loaded.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const report = await getReportData();

    if (!report) {
      alert("No cycle history data yet. Log period days on the calendar first.");
      return;
    }

    const { generatedOn, cycleCount, avgCycleLength, cycles, periodStarts, periodDays } = report;

    const pdf = new jsPDF("p", "pt", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin;

    function ensureSpace(minSpace = 60) {
      if (y > pageHeight - margin - minSpace) {
        pdf.addPage();
        y = margin;
      }
    }

    function addTitle(text) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(18);
      pdf.text(text, margin, y);
      y += 20;
    }

    function addSub(text) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(80);
      pdf.text(text, margin, y);
      pdf.setTextColor(0);
      y += 16;
    }

    function addSectionHeader(text) {
      ensureSpace(80);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(text, margin, y);
      y += 10;
      pdf.setDrawColor(220);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 16;
    }

    function addParagraph(text) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      const lines = pdf.splitTextToSize(text, pageWidth - margin * 2);
      for (const line of lines) {
        ensureSpace(20);
        pdf.text(line, margin, y);
        y += 14;
      }
    }

    function addKeyValueRow(key, value) {
      ensureSpace(20);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text(key, margin, y);
      pdf.setFont("helvetica", "normal");
      pdf.text(String(value), margin + 180, y);
      y += 14;
    }

    function fmt(iso) {
      try { return formatDate(iso); } catch { return iso; }
    }

    addTitle("Bloom — Cycle History Report");
    addSub(`Generated on: ${generatedOn}`);
    addSub("Based on the period logs you entered in the Bloom calendar.");

    addSectionHeader("Summary");
    addKeyValueRow("Cycles tracked:", cycleCount);
    addKeyValueRow("Average cycle length:", avgCycleLength ? `${avgCycleLength} days` : "Not enough data yet");
    addKeyValueRow("Period starts found:", periodStarts.length);
    addKeyValueRow("Period days logged:", periodDays.length);

    addSectionHeader("Cycle History (Start → Next Start)");
    if (!cycles.length) {
      addParagraph("Not enough data to compute cycles yet. Log at least two separate periods (two start dates).");
    } else {
      ensureSpace(80);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text("Cycle Start", margin, y);
      pdf.text("Next Start", margin + 210, y);
      pdf.text("Length", margin + 380, y);
      y += 10;

      pdf.setDrawColor(220);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 16;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);

      for (const c of cycles) {
        ensureSpace(30);
        pdf.text(fmt(c.start), margin, y);
        pdf.text(fmt(c.next), margin + 210, y);
        pdf.text(`${c.length} days`, margin + 380, y);
        y += 16;
      }
    }

    addSectionHeader("Recent Period Days Logged");
    if (!periodDays.length) {
      addParagraph("No period days logged yet.");
    } else {
      const last = periodDays.slice(-30);
      addParagraph(`Showing the most recent ${last.length} logged period day${last.length !== 1 ? "s" : ""}:`);
      addParagraph(last.map(fmt).join(", "));
    }

    addSectionHeader("Disclaimer");
    addParagraph(
      "Bloom provides educational tracking support and is not a substitute for professional medical advice. " +
      "If you have health concerns, consult a qualified healthcare provider."
    );

    pdf.save("Bloom-Health-Report.pdf");
  });
}

async function loadPreview() {
  const previewEl = document.getElementById("report-preview");
  const logsByDate = await getAllLogs();

  const periodStarts = getPeriodStartsFromLogs(logsByDate);
  const cycles = getCycles(periodStarts);
  const avgCycleLength = average(cycles.map(c => c.length));
  const periodDays = Object.keys(logsByDate).filter(d => isPeriodFlow(logsByDate[d]?.flow)).sort(sortAsc);

  if (!periodDays.length) {
    previewEl.innerHTML = `
      <span class="badge">No data yet</span>
      <p class="muted">Log period days in the Calendar to generate a report.</p>
    `;
  } else {
    const lastStart = periodStarts.length ? periodStarts[periodStarts.length - 1] : null;
    const nextDate = (avgCycleLength && lastStart) ? addDays(lastStart, avgCycleLength) : null;

    previewEl.innerHTML = `
      <div class="kv">
        <div class="k">Cycles tracked</div><div class="v">${cycles.length}</div>
        <div class="k">Avg cycle length</div><div class="v">${avgCycleLength ? `${avgCycleLength} days` : "Not enough data"}</div>
        <div class="k">Last period start</div><div class="v">${lastStart ? formatDate(lastStart) : "Unknown"}</div>
        <div class="k">Next expected</div><div class="v">${nextDate ? formatDate(nextDate) : "Not enough data"}</div>
      </div>
      <p class="muted" style="margin-top:0.75rem;">Most recent period days:</p>
      <p>${periodDays.slice(-10).map(d => formatDate(d)).join(", ")}</p>
    `;
  }

  // export uses current computed data
  setupExportCycleHistoryPDF(async () => {
    if (!periodDays.length) return null;
    return {
      generatedOn: new Date().toLocaleString(),
      cycleCount: cycles.length,
      avgCycleLength,
      cycles,
      periodStarts,
      periodDays
    };
  });
}

loadPreview();
