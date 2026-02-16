/**
 * dashboard.js - Dashboard Page Logic (Frontend-only, based on user logs)
 *
 * Uses logs from db.js (localStorage) to:
 * - show Cycle Snapshot = current Cycle Day (based on last logged period start)
 * - show Cycle Phase (menstrual / follicular / fertile / ovulation / luteal)
 * - show Next Period start estimate (avg-cycle based)
 * - update Today's Insight based on current phase (simple, educational)
 * - advanced insights (account-only messaging stays, based on logs)
 * - render Cycle History dots from last cycle
 * - render Cycle Trends chart from cycle lengths
 * - export Cycle History report as a readable PDF (NOT a screenshot)
 */

import {
  renderNav,
  renderFooter,
  renderModeBanner,
  renderBloomieFab,
  formatDate,
  toDateKey
} from "./utils.js";

import { getAllLogs } from "./db.js";
import { getMode } from "./mode.js";

// --- Shared UI ---
renderNav("dashboard");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

// -------------------------
// Helpers (dates + logs)
// -------------------------
function isPeriodFlow(flow) {
  return ["spotting", "light", "medium", "heavy"].includes(
    String(flow || "").toLowerCase()
  );
}

function addDays(isoDate, delta) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return toDateKey(dt);
}

function diffDays(a, b) {
  // signed (b - a) in days
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / 86400000);
}

function sortAsc(a, b) {
  return String(a).localeCompare(String(b));
}

/**
 * Extract period start dates from logs.
 * A start = period-day where previous day is NOT a period-day.
 */
function getPeriodStartsFromLogs(logsByDate) {
  const dates = Object.keys(logsByDate || {}).sort(sortAsc);
  const periodDays = dates.filter((d) => isPeriodFlow(logsByDate[d]?.flow));

  const periodSet = new Set(periodDays);
  const starts = [];

  for (const d of periodDays) {
    const prev = addDays(d, -1);
    if (!periodSet.has(prev)) starts.push(d);
  }
  return [...new Set(starts)].sort(sortAsc);
}

/**
 * Cycle lengths from start[i] -> start[i+1]
 */
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

/**
 * Find the most recent period start that is <= today
 */
function getLastStartOnOrBeforeToday(periodStarts, todayKey) {
  if (!periodStarts.length) return null;
  let last = null;
  for (const s of periodStarts) {
    if (s <= todayKey) last = s;
  }
  return last;
}

/**
 * Phase estimation (simple + educational):
 * - assumes ovulation ≈ (cycleLength - 14)
 * - fertile window = ovulation-5 .. ovulation+1
 * - menstrual = day 1..5 (default)
 * - follicular = after menstrual until fertile window
 * - luteal = after ovulation+1 to end
 */
function estimatePhase(cycleDay, cycleLength) {
  const CL = cycleLength || 28; // fallback
  const ovulationDay = Math.max(10, Math.min(CL - 14, CL - 10)); // keep sane
  const fertileStart = Math.max(6, ovulationDay - 5);
  const fertileEnd = ovulationDay + 1;

  // Menstrual (default 1-5)
  if (cycleDay >= 1 && cycleDay <= 5) {
    return { key: "menstrual", label: "Menstrual", detail: `Day ${cycleDay}` };
  }

  // Ovulation
  if (cycleDay === ovulationDay) {
    return { key: "ovulation", label: "Ovulation", detail: `Day ${cycleDay}` };
  }

  // Fertile window
  if (cycleDay >= fertileStart && cycleDay <= fertileEnd) {
    return { key: "fertile", label: "Fertile Window", detail: `Day ${cycleDay}` };
  }

  // Follicular
  if (cycleDay > 5 && cycleDay < fertileStart) {
    return { key: "follicular", label: "Follicular", detail: `Day ${cycleDay}` };
  }

  // Luteal
  return { key: "luteal", label: "Luteal", detail: `Day ${cycleDay}` };
}

function setTodayInsights(phaseKey) {
  const box = document.getElementById("insights");
  if (!box) return;

  // Lightweight, phase-based tips (educational)
  const map = {
    menstrual: [
      { t: "Rest & comfort", d: "Prioritize sleep, warmth, and gentle movement if cramps are present." },
      { t: "Hydration", d: "Water + light meals can help with bloating and fatigue." },
      { t: "Track symptoms", d: "Logging pain, mood, and flow helps you spot patterns over time." }
    ],
    follicular: [
      { t: "Energy boost", d: "You may feel more energized—great time for planning and workouts." },
      { t: "Nutrition", d: "Balanced meals support steady energy and mood." },
      { t: "Consistency", d: "Keep logging even on non-period days to improve accuracy." }
    ],
    fertile: [
      { t: "Body signals", d: "Notice changes like discharge, energy, or mild cramps—everyone differs." },
      { t: "Hydration", d: "Staying hydrated can help with overall comfort." },
      { t: "Keep logging", d: "Accurate logs make your cycle estimates better over time." }
    ],
    ovulation: [
      { t: "Ovulation day", d: "Some people feel mild one-sided cramps—logging helps you learn your pattern." },
      { t: "Listen to your body", d: "If something feels off, it’s okay to rest and monitor symptoms." },
      { t: "Consistency", d: "Daily logs improve phase estimates and trend summaries." }
    ],
    luteal: [
      { t: "Mood & cravings", d: "Some people notice PMS changes—log mood, sleep, and symptoms." },
      { t: "Gentle routine", d: "Light movement and hydration can help reduce bloating." },
      { t: "Be kind to yourself", d: "Energy may dip—rest is productive too." }
    ]
  };

  const items = map[phaseKey] || map.follicular;
  box.innerHTML = items
    .map(
      (i) => `<div class="insight-item"><strong>${i.t}:</strong> ${i.d}</div>`
    )
    .join("");
}

// -------------------------
// Render: Cycle History Dots
// -------------------------
function renderCycleHistory({ logsByDate, lastCycle }) {
  const dots = document.getElementById("cycle-dots");
  if (!dots) return;

  if (!lastCycle) {
    dots.innerHTML = `<p class="text-muted" style="margin:0;">No cycle history yet — log your period days on the calendar.</p>`;
    return;
  }

  const periodSet = new Set(
    Object.keys(logsByDate).filter((d) => isPeriodFlow(logsByDate[d]?.flow))
  );

  dots.innerHTML = "";
  for (let day = 1; day <= lastCycle.length; day++) {
    const date = addDays(lastCycle.start, day - 1);
    const dot = document.createElement("span");
    dot.className = "dot";

    // Mark only actual logged period days
    if (periodSet.has(date)) dot.classList.add("dot-period");

    dot.title = `${formatDate(date)}${periodSet.has(date) ? " • period logged" : ""}`;
    dots.appendChild(dot);
  }
}

// -------------------------
// Render: Cycle Trends Chart
// -------------------------
let cycleChartInstance = null;

function renderCycleTrendsChart(cycles) {
  const canvas = document.getElementById("cycleChart");
  if (!canvas || !window.Chart) return;

  if (cycleChartInstance) {
    cycleChartInstance.destroy();
    cycleChartInstance = null;
  }

  if (!cycles || cycles.length === 0) {
    const parent = canvas.parentElement;
    if (parent) {
      parent.innerHTML = `<p class="text-muted" style="margin:0;">No trend data yet — log at least two periods to see a graph.</p>`;
    }
    return;
  }

  const labels = cycles.map((c) => c.start);
  const data = cycles.map((c) => c.length);

  cycleChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Cycle length (days)", data }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { suggestedMin: 20, suggestedMax: 40 } }
    }
  });
}

// -------------------------
// Export Cycle History as readable PDF (NOT screenshot)
// -------------------------
function setupExportCycleHistoryPDF(getReportData) {
  const btn = document.getElementById("export-pdf");
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
      try {
        return formatDate(iso);
      } catch {
        return iso;
      }
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

    pdf.save("Bloom-Cycle-History-Report.pdf");
  });
}

// -------------------------
// Main dashboard load
// -------------------------
async function loadDashboard() {
  const mode = getMode();
  const logsByDate = await getAllLogs();

  const entriesAsc = Object.keys(logsByDate || {}).sort(sortAsc);
  const todayKey = toDateKey(new Date());

  const periodStarts = getPeriodStartsFromLogs(logsByDate);
  const cycles = getCycles(periodStarts);
  const avgCycleLength = average(cycles.map((c) => c.length));

  // Elements (NEW dashboard layout)
  const snapshotEl = document.getElementById("cycle-snapshot");
  const phaseEl = document.getElementById("cycle-phase");
  const nextPeriodEl = document.getElementById("next-period");
  const advancedEl = document.getElementById("advanced-insights");

  // --- No data ---
  if (!entriesAsc.length) {
    if (snapshotEl) snapshotEl.innerHTML = `<p class="text-muted">Log a period in the calendar to see your cycle day.</p>`;
    if (phaseEl) phaseEl.innerHTML = `<p class="text-muted">Not enough data yet. Keep logging to estimate your phase.</p>`;
    if (nextPeriodEl) nextPeriodEl.innerHTML = `<p class="text-muted">Not enough data yet. Keep logging to get an estimate.</p>`;

    setTodayInsights("follicular"); // harmless default
    renderCycleHistory({ logsByDate: {}, lastCycle: null });
    renderCycleTrendsChart([]);

    if (!window.__bloomExportSetupDone) {
      window.__bloomExportSetupDone = true;
      setupExportCycleHistoryPDF(async () => null);
    }
    return;
  }

  // --- Cycle Day (Snapshot) ---
  const lastStart = getLastStartOnOrBeforeToday(periodStarts, todayKey);

  let cycleDay = null;
  if (lastStart) {
    cycleDay = diffDays(lastStart, todayKey) + 1;
    if (cycleDay < 1) cycleDay = 1;
  }

  if (snapshotEl) {
    if (!lastStart) {
      // If user logged flows but nothing looks like a start yet:
      const periodDaysCount = Object.keys(logsByDate).filter((d) => isPeriodFlow(logsByDate[d]?.flow)).length;
      snapshotEl.innerHTML = `
        <div class="stat-number">${periodDaysCount}</div>
        <p class="text-muted">Period day${periodDaysCount !== 1 ? "s" : ""} logged so far. Log a few more days to calculate your cycle day.</p>
      `;
    } else {
      snapshotEl.innerHTML = `
        <div class="stat-number">Day ${cycleDay}</div>
        <p class="text-muted">Current cycle started on <strong>${formatDate(lastStart)}</strong></p>
      `;
    }
  }

  // --- Cycle Phase ---
  let phase = null;
  const confidence = cycles.length >= 2 ? "Higher" : "Low";
  const assumedLength = avgCycleLength || 28;

  if (!cycleDay || cycleDay > 120) {
    // safety fallback
    phase = { key: "unknown", label: "Unknown", detail: "Not enough data" };
  } else {
    phase = estimatePhase(cycleDay, assumedLength);
  }

  if (phaseEl) {
    if (phase.key === "unknown") {
      phaseEl.innerHTML = `
        <div class="stat-number">—</div>
        <p class="text-muted">Not enough data yet. Log period days to estimate your phase.</p>
      `;
    } else {
      phaseEl.innerHTML = `
        <div class="stat-number">${phase.label}</div>
        <p class="text-muted">${phase.detail} • Using a ${assumedLength}-day cycle (${confidence} confidence)</p>
        <p class="form-hint">Phase estimation is educational and not medical advice.</p>
      `;
    }
  }

  // Update Today’s Insight based on phase
  setTodayInsights(phase.key === "unknown" ? "follicular" : phase.key);

  // --- Next Period (estimate) ---
  if (nextPeriodEl) {
    if (avgCycleLength && periodStarts.length >= 1) {
      const lastAnyStart = periodStarts[periodStarts.length - 1];
      const nextDate = addDays(lastAnyStart, avgCycleLength);
      const daysUntil = diffDays(todayKey, nextDate);
      const isPast = new Date(nextDate + "T00:00:00") < new Date();

      nextPeriodEl.innerHTML = `
        <div class="stat-number">${formatDate(nextDate)}</div>
        <p class="text-muted">
          ${
            isPast
              ? "This date has passed. It may be late, or your cycle length may be changing."
              : `Approximately ${daysUntil} day${daysUntil !== 1 ? "s" : ""} from today`
          }
        </p>
        <p class="form-hint">This is an estimate based on your logged cycle history. It is not a medical prediction.</p>
      `;
    } else if (lastStart) {
      // give a soft estimate even without avg, using 28-day default
      const nextDate = addDays(lastStart, 28);
      const daysUntil = diffDays(todayKey, nextDate);

      nextPeriodEl.innerHTML = `
        <div class="stat-number">${formatDate(nextDate)}</div>
        <p class="text-muted">Estimate using a default 28-day cycle (about ${daysUntil} day${daysUntil !== 1 ? "s" : ""} from today).</p>
        <p class="form-hint">Log more cycles to personalize this estimate.</p>
      `;
    } else {
      nextPeriodEl.innerHTML = `<p class="text-muted">Not enough data yet. Log more period days to estimate your next start date.</p>`;
    }
  }

  // --- Advanced Insights (account-only messaging stays) ---
  if (advancedEl) {
    if (mode === "account") {
      const flags = [];

      if (avgCycleLength && avgCycleLength < 21) {
        flags.push("Your average cycle is shorter than 21 days. Consider discussing this with a healthcare provider.");
      }
      if (avgCycleLength && avgCycleLength > 35) {
        flags.push("Your average cycle is longer than 35 days. This could indicate irregular cycles worth monitoring.");
      }

      const heavyDays = Object.keys(logsByDate).filter(
        (d) => String(logsByDate[d]?.flow).toLowerCase() === "heavy"
      ).length;

      if (heavyDays > 5) {
        flags.push(
          `You've logged ${heavyDays} heavy-flow days. If heavy bleeding is persistent, consider consulting a provider.`
        );
      }

      if (flags.length) {
        advancedEl.innerHTML = flags
          .map((f) => `<div class="insight-item"><strong>Pattern flag:</strong> ${f}</div>`)
          .join("");
      } else {
        advancedEl.innerHTML = `<div class="insight-item">No unusual patterns detected. Keep logging for more detailed insights.</div>`;
      }
    } else {
      advancedEl.innerHTML = `
        <div class="banner banner-info" style="margin:0;">
          <div><strong>Feature locked.</strong> <a href="/pages/register.html">Create an account</a> to unlock advanced pattern insights and data export.</div>
        </div>
      `;
    }
  }

  // --- Cycle History + Trends ---
  const lastCycle = cycles.length ? cycles[cycles.length - 1] : null;
  renderCycleHistory({ logsByDate, lastCycle });
  renderCycleTrendsChart(cycles);

  // --- Setup export ONCE (uses computed data) ---
  if (!window.__bloomExportSetupDone) {
    window.__bloomExportSetupDone = true;

    setupExportCycleHistoryPDF(async () => {
      const periodDays = Object.keys(logsByDate)
        .filter((d) => isPeriodFlow(logsByDate[d]?.flow))
        .sort(sortAsc);

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
}

loadDashboard();
