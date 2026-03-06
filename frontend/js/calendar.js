/**
 * calendar.js - Calendar Page Logic
 *
 * Features:
 * - Log flow, categorized symptoms with per-symptom severity, and notes
 * - Search symptoms by name
 * - Edit / delete individual day logs
 * - Clear All Logs button
 * - Predicted period overlay + fertile window + ovulation markers
 * - Prediction info panel (3 future cycles, confidence, current phase)
 */

import {
  renderNav, renderFooter, renderModeBanner, renderBloomieFab,
  toDateKey, getMonthName, getDaysInMonth, getFirstDayOfWeek,
  SYMPTOM_CATEGORIES, FLOW_OPTIONS, openModal, closeModal, showToast
} from "./utils.js";

import { saveDailyLog, getAllLogs, deleteDailyLog, clearAllLogs } from "./db.js";
import { computeCyclePhase } from "./phase.js";
import { getUserGoal } from "./goals.js";
import { runFullPrediction } from "./algorithms/cyclePredictor.js";
import { initAuthListener } from "./auth.js";
initAuthListener();

// Render shared UI
renderNav("calendar");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

// ── State ──────────────────────────────────────────────────────────────────
let currentYear, currentMonth;
let allLogs = {};
let cycleData = null;
let predResult = null;

let selectedDate = "";
let selectedFlow = "none";
let selectedSymptoms = new Set();
let selectedSymptomSeverity = new Map(); // symptom -> 1-5

const today = new Date();
currentYear = today.getFullYear();
currentMonth = today.getMonth();

// ── Helpers: logs → period data ────────────────────────────────────────────

function daysBetweenKeys(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

// Groups logged period days into distinct clusters (gap > 3 days = new period).
// This handles months of sparse logs correctly — missing days don't keep a period "open".
function getPeriodClusters(logsByDate) {
  const periodDays = Object.keys(logsByDate || {})
    .filter((dk) => { const l = logsByDate[dk]; return l && l.flow && l.flow !== "none"; })
    .sort();

  if (!periodDays.length) return [];

  const clusters = [];
  let start = periodDays[0], end = periodDays[0];

  for (let i = 1; i < periodDays.length; i++) {
    if (daysBetweenKeys(periodDays[i - 1], periodDays[i]) > 3) {
      clusters.push({ start, end });
      start = periodDays[i];
    }
    end = periodDays[i];
  }
  clusters.push({ start, end });
  return clusters;
}

function derivePeriodStartDatesFromLogs(logsByDate) {
  return getPeriodClusters(logsByDate).map((c) => new Date(c.start + "T00:00:00"));
}

function getLastPeriodRange(logsByDate) {
  const clusters = getPeriodClusters(logsByDate);
  if (!clusters.length) return { lastStart: null, lastEnd: null };
  const last = clusters[clusters.length - 1];
  return {
    lastStart: new Date(last.start + "T00:00:00"),
    lastEnd: new Date(last.end + "T00:00:00"),
  };
}

function buildCycleDataForCalendarFromAlgorithm(pred, baselinePhaseData) {
  const out = { ...baselinePhaseData };
  if (!pred?.ready) return out;

  const approxDuration =
    Array.isArray(baselinePhaseData?.predictedPeriodDays) && baselinePhaseData.predictedPeriodDays.length
      ? baselinePhaseData.predictedPeriodDays.length
      : 5;

  // Predicted period days — all future cycles
  const predictedDays = [];
  (pred.futureCycles || []).forEach((c) => {
    if (!c.periodStart) return;
    const duration = c.periodEnd
      ? Math.round((c.periodEnd - c.periodStart) / (1000 * 60 * 60 * 24)) + 1
      : approxDuration;
    for (let i = 0; i < duration; i++) {
      const d = new Date(c.periodStart);
      d.setDate(d.getDate() + i);
      predictedDays.push(toDateKey(d));
    }
  });
  if (predictedDays.length) {
    out.predictedPeriodDays = predictedDays;
    out.nextPeriodDate = toDateKey(pred.futureCycles[0].periodStart);
  }

  // Ovulation dates — all future cycles
  out.futureOvulationDates = (pred.futureCycles || [])
    .map((c) => (c.ovulationDay ? toDateKey(c.ovulationDay) : null))
    .filter(Boolean);

  // Fertile window days — all future cycles pre-expanded
  const allFertileDays = [];
  (pred.futureCycles || []).forEach((c) => {
    if (!c.fertileWindow?.start || !c.fertileWindow?.end) return;
    let d = new Date(c.fertileWindow.start);
    const end = new Date(c.fertileWindow.end);
    while (d <= end) {
      allFertileDays.push(toDateKey(d));
      d.setDate(d.getDate() + 1);
    }
  });
  out.allFertileDays = allFertileDays;

  if (pred.ovulationDay) out.ovulationDate = toDateKey(pred.ovulationDay);
  return out;
}

// ── Load & compute ─────────────────────────────────────────────────────────

async function recomputeCycleData() {
  let baseline;
  try { baseline = computeCyclePhase(allLogs); } catch (_) { baseline = {}; }
  const periodStarts = derivePeriodStartDatesFromLogs(allLogs);
  const { lastStart, lastEnd } = getLastPeriodRange(allLogs);

  console.log("[Bloom] recomputeCycleData — periodStarts:", periodStarts.length, "lastStart:", lastStart, "lastEnd:", lastEnd);

  if (lastStart && periodStarts.length >= 1) {
    const resolvedEnd = lastEnd || lastStart;
    let pred = null;
    try {
      pred = runFullPrediction(periodStarts, lastStart, resolvedEnd, 3);
      console.log("[Bloom] runFullPrediction — ready:", pred?.ready, "cyclesLogged:", pred?.cyclesLogged);
    } catch (e) {
      console.warn("[Bloom] runFullPrediction failed:", e);
    }

    if (pred) {
      predResult = pred;
      try {
        cycleData = buildCycleDataForCalendarFromAlgorithm(pred, baseline);
      } catch (e) {
        console.warn("[Bloom] buildCycleData failed:", e);
        cycleData = baseline;
      }
      return;
    }
  }

  predResult = null;
  cycleData = baseline;
}

async function loadLogs() {
  allLogs = await getAllLogs();
  await recomputeCycleData();
}

// ── Flow chips ─────────────────────────────────────────────────────────────

const flowChips = document.getElementById("flow-chips");
FLOW_OPTIONS.forEach((f) => {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = f.charAt(0).toUpperCase() + f.slice(1);
  chip.dataset.value = f;
  chip.addEventListener("click", () => { selectedFlow = f; updateFlowChips(); });
  flowChips.appendChild(chip);
});

function updateFlowChips() {
  flowChips.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("selected", c.dataset.value === selectedFlow);
  });
}

// ── Symptom categories UI ──────────────────────────────────────────────────

function buildSymptomUI() {
  const container = document.getElementById("symptom-categories");
  container.innerHTML = "";

  Object.entries(SYMPTOM_CATEGORIES).forEach(([cat, symptoms]) => {
    const section = document.createElement("div");
    section.className = "symptom-cat";
    section.dataset.category = cat;

    const label = document.createElement("div");
    label.className = "symptom-cat-label";
    label.textContent = cat;
    section.appendChild(label);

    const chips = document.createElement("div");
    chips.className = "chip-group";

    symptoms.forEach((s) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = s;
      chip.dataset.symptom = s;
      chip.addEventListener("click", () => toggleSymptom(s));
      chips.appendChild(chip);
    });

    section.appendChild(chips);
    container.appendChild(section);
  });
}

function toggleSymptom(s) {
  if (selectedSymptoms.has(s)) {
    selectedSymptoms.delete(s);
    selectedSymptomSeverity.delete(s);
  } else {
    selectedSymptoms.add(s);
    selectedSymptomSeverity.set(s, 3); // default severity: moderate
  }
  updateSymptomChips();
  updateSeverityPanel();
}

function updateSymptomChips() {
  document.querySelectorAll("#symptom-categories .chip[data-symptom]").forEach((c) => {
    c.classList.toggle("selected", selectedSymptoms.has(c.dataset.symptom));
  });
}

function updateSeverityPanel() {
  const panel = document.getElementById("severity-panel");
  const list = document.getElementById("symptom-severity-list");

  if (!selectedSymptoms.size) {
    panel.style.display = "none";
    return;
  }

  panel.style.display = "block";
  list.innerHTML = "";

  selectedSymptoms.forEach((s) => {
    const row = document.createElement("div");
    row.className = "severity-row";

    const nameEl = document.createElement("span");
    nameEl.className = "severity-symptom-name";
    nameEl.textContent = s;
    row.appendChild(nameEl);

    const btns = document.createElement("div");
    btns.className = "severity-btns";
    const current = selectedSymptomSeverity.get(s) || 3;

    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "severity-btn" + (current === i ? " active" : "");
      btn.textContent = String(i);
      btn.dataset.val = String(i);
      btn.addEventListener("click", () => {
        selectedSymptomSeverity.set(s, i);
        updateSeverityPanel();
      });
      btns.appendChild(btn);
    }

    row.appendChild(btns);
    list.appendChild(row);
  });
}

// ── Symptom search ─────────────────────────────────────────────────────────

document.getElementById("symptom-search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll(".symptom-cat").forEach((cat) => {
    let visible = 0;
    cat.querySelectorAll(".chip[data-symptom]").forEach((chip) => {
      const match = !q || chip.textContent.toLowerCase().includes(q);
      chip.style.display = match ? "" : "none";
      if (match) visible++;
    });
    cat.style.display = visible === 0 ? "none" : "";
  });
});

// ── Calendar rendering ─────────────────────────────────────────────────────

function renderCalendar() {
  const grid = document.getElementById("calendar-grid");
  const headers = grid.querySelectorAll(".calendar-header-cell");

  grid.innerHTML = "";
  headers.forEach((h) => grid.appendChild(h));

  document.getElementById("month-label").textContent = `${getMonthName(currentMonth)} ${currentYear}`;

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfWeek(currentYear, currentMonth);
  const todayKey = toDateKey(today);

  const goal = getUserGoal();
  const allowPredictedPeriod = ["period", "ttc", "perimenopause"].includes(goal);
  const allowFertilityMarkers = ["period", "ttc", "perimenopause"].includes(goal);

  const predictedSet = new Set(
    allowPredictedPeriod && cycleData?.predictedPeriodDays ? cycleData.predictedPeriodDays : []
  );
  const fertileSet = new Set();
  const ovulationSet = new Set();

  if (allowFertilityMarkers) {
    if (cycleData?.allFertileDays?.length) {
      cycleData.allFertileDays.forEach((dk) => fertileSet.add(dk));
    } else if (cycleData?.fertileStart && cycleData?.fertileEnd) {
      let d = new Date(cycleData.fertileStart + "T00:00:00");
      const end = new Date(cycleData.fertileEnd + "T00:00:00");
      while (d <= end) { fertileSet.add(toDateKey(d)); d.setDate(d.getDate() + 1); }
    }

    if (cycleData?.futureOvulationDates?.length) {
      cycleData.futureOvulationDates.forEach((dk) => ovulationSet.add(dk));
    } else if (cycleData?.ovulationDate) {
      ovulationSet.add(cycleData.ovulationDate);
    }
  }

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "calendar-cell empty";
    empty.setAttribute("role", "gridcell");
    grid.appendChild(empty);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(currentYear, currentMonth, d);
    const dateKey = toDateKey(dateObj);

    const cell = document.createElement("button");
    cell.className = "calendar-cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `${getMonthName(currentMonth)} ${d}, ${currentYear}`);

    const dayNum = document.createElement("span");
    dayNum.className = "day-number";
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    if (dateKey === todayKey) cell.classList.add("today");

    const log = allLogs[dateKey];
    const isLoggedPeriod = log && log.flow && log.flow !== "none";
    const isPredicted = predictedSet.has(dateKey) && !isLoggedPeriod;
    const isFertile = fertileSet.has(dateKey);
    const isOvulation = ovulationSet.has(dateKey);
    const isFuture = dateObj > today;

    if (isLoggedPeriod) {
      cell.classList.add("has-log", "logged-period");
      const dot = document.createElement("span");
      dot.className = `flow-indicator flow-${log.flow}`;
      cell.appendChild(dot);
    } else if (log) {
      cell.classList.add("has-log");
    }

    if (isPredicted) cell.classList.add("predicted-period");

    if (isOvulation) {
      cell.classList.add("ovulation-day");
      if (isFuture) cell.classList.add("predicted-ovulation");
    } else if (isFertile) {
      cell.classList.add("fertile-day");
    }

    cell.addEventListener("click", () => openLogModal(dateKey));
    grid.appendChild(cell);
  }
}

// ── Modal logic ────────────────────────────────────────────────────────────

function openLogModal(dateKey) {
  selectedDate = dateKey;
  document.getElementById("modal-title").textContent = `Log: ${formatDateDisplay(dateKey)}`;

  // Reset state
  selectedFlow = "none";
  selectedSymptoms.clear();
  selectedSymptomSeverity.clear();
  document.getElementById("notes").value = "";
  document.getElementById("delete-log-btn").style.display = "none";
  document.getElementById("symptom-search").value = "";

  // Restore hidden categories/chips after search reset
  document.querySelectorAll(".symptom-cat").forEach((c) => (c.style.display = ""));
  document.querySelectorAll(".chip[data-symptom]").forEach((c) => (c.style.display = ""));

  // Load existing log from in-memory cache (populated on init)
  const existing = allLogs[dateKey];
  if (existing) {
    selectedFlow = existing.flow || "none";

    if (existing.symptoms) {
      existing.symptoms.forEach((s) => selectedSymptoms.add(s));
    }
    if (existing.symptomSeverity) {
      Object.entries(existing.symptomSeverity).forEach(([s, v]) =>
        selectedSymptomSeverity.set(s, Number(v))
      );
    } else if (existing.severity && selectedSymptoms.size) {
      // Backwards compat: distribute old global severity to all symptoms
      selectedSymptoms.forEach((s) =>
        selectedSymptomSeverity.set(s, Number(existing.severity))
      );
    }

    if (existing.notes) document.getElementById("notes").value = existing.notes;
    document.getElementById("delete-log-btn").style.display = "inline-flex";
  }

  updateFlowChips();
  updateSymptomChips();
  updateSeverityPanel();
  openModal("log-modal");
}

function formatDateDisplay(dateKey) {
  const [y, m, d] = dateKey.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

// ── Save ───────────────────────────────────────────────────────────────────

document.getElementById("log-form").addEventListener("submit", (e) => {
  e.preventDefault();

  const dateKey = selectedDate;
  const data = {
    flow: selectedFlow,
    symptoms: Array.from(selectedSymptoms),
    symptomSeverity: Object.fromEntries(selectedSymptomSeverity),
    notes: document.getElementById("notes").value.trim(),
  };

  // Update in-memory and close modal immediately — don't wait for network
  allLogs[dateKey] = { ...data, date: dateKey };
  closeModal("log-modal");
  renderCalendar();
  showToast("Log saved successfully!");

  // Persist + recompute predictions in background
  saveDailyLog(dateKey, data)
    .then(() => recomputeCycleData())
    .catch(() => {})
    .finally(() => renderPredictionPanel());
});

// ── Delete single log ──────────────────────────────────────────────────────

document.getElementById("delete-log-btn").addEventListener("click", () => {
  if (!confirm("Delete this log entry?")) return;

  const dateKey = selectedDate;

  // Update in-memory and close modal immediately
  delete allLogs[dateKey];
  closeModal("log-modal");
  renderCalendar();
  showToast("Log deleted.", "info");

  // Persist deletion + recompute in background
  deleteDailyLog(dateKey)
    .then(() => recomputeCycleData())
    .catch(() => {})
    .finally(() => renderPredictionPanel());
});

// ── Clear all logs ─────────────────────────────────────────────────────────

document.getElementById("clear-all-logs-btn").addEventListener("click", async () => {
  if (!confirm("Clear ALL logs?\n\nThis will permanently delete every period and symptom entry. This cannot be undone.")) return;
  await clearAllLogs();
  allLogs = {};
  await recomputeCycleData();
  renderCalendar();
  renderPredictionPanel();
  showToast("All logs cleared.", "info");
});

// ── Close handlers ─────────────────────────────────────────────────────────

document.getElementById("modal-close-btn").addEventListener("click", () => closeModal("log-modal"));
document.getElementById("cancel-btn").addEventListener("click", () => closeModal("log-modal"));
document.getElementById("log-modal").addEventListener("click", (e) => {
  if (e.target.id === "log-modal") closeModal("log-modal");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal("log-modal");
});

// ── Month navigation ───────────────────────────────────────────────────────

document.getElementById("prev-month").addEventListener("click", () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
});

document.getElementById("next-month").addEventListener("click", () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
});

// ── Prediction panel ───────────────────────────────────────────────────────

function fmtShort(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

const PHASE_META = {
  menstrual:  { label: "Menstrual",  cls: "phase-menstrual"  },
  follicular: { label: "Follicular", cls: "phase-follicular" },
  ovulatory:  { label: "Ovulatory",  cls: "phase-ovulation"  },
  ovulation:  { label: "Ovulatory",  cls: "phase-ovulation"  },
  luteal:     { label: "Luteal",     cls: "phase-luteal"     },
  unknown:    { label: "Unknown",    cls: "phase-unknown"    },
};
const PHASE_ORDER = ["menstrual", "follicular", "ovulatory", "luteal"];
const CYCLE_LABELS = ["Next cycle", "Month 2", "Month 3"];

function renderPredictionPanel() {
  const panel = document.getElementById("prediction-panel");
  if (!panel) return;

  const goal = getUserGoal();
  if (!["period", "ttc", "perimenopause"].includes(goal)) {
    panel.innerHTML = "";
    return;
  }

  if (!predResult?.ready) {
    panel.innerHTML = `
      <section class="card" style="text-align:center;padding:1.25rem 1rem;color:var(--color-text-muted);font-size:0.92rem;">
        Log a period day (select any flow other than None) to see cycle predictions.
      </section>`;
    return;
  }

  const { confidence, currentPhase, futureCycles, cyclesLogged, comparison, disclaimer } = predResult;
  const confCls = confidence.level === "High" ? "conf-high" : confidence.level === "Medium" ? "conf-medium" : "conf-low";
  const phaseKey = currentPhase || "unknown";
  const phaseMeta = PHASE_META[phaseKey] || PHASE_META.unknown;

  const cycleCards = (futureCycles || []).slice(0, 3).map((c, i) => {
    const windowDays = c.earliestStart && c.latestStart
      ? Math.round((c.latestStart - c.earliestStart) / (1000 * 60 * 60 * 24) / 2)
      : 0;
    const windowNote = windowDays > 0 ? ` <span class="pred-window">± ${windowDays} days</span>` : "";
    return `
      <div class="pred-cycle-card">
        <div class="pred-cycle-title">${CYCLE_LABELS[i] || `Month ${i + 1}`}${windowNote}</div>
        <div class="pred-cycle-row"><span>Period</span><span>${fmtShort(c.periodStart)} – ${fmtShort(c.periodEnd)}</span></div>
        <div class="pred-cycle-row"><span>Ovulation</span><span>${fmtShort(c.ovulationDay)}</span></div>
        <div class="pred-cycle-row"><span>Fertile window</span><span>${fmtShort(c.fertileWindow?.start)} – ${fmtShort(c.fertileWindow?.end)}</span></div>
      </div>`;
  }).join("");

  panel.innerHTML = `
    <section class="card pred-section">
      <div class="pred-row-space">
        <span class="pred-section-label">Confidence</span>
        <span class="conf-badge ${confCls}">${confidence.level}</span>
      </div>
      <p class="pred-msg">${confidence.message}</p>
      <p class="pred-cycles-note">${cyclesLogged} cycle${cyclesLogged !== 1 ? "s" : ""} logged</p>
    </section>

    <section class="card pred-section">
      <div class="pred-row-space">
        <span class="pred-section-label">Current phase</span>
        <span class="phase-badge ${phaseMeta.cls}">${phaseMeta.label}</span>
      </div>
      <div class="phase-pills-row">
        ${PHASE_ORDER.map((k) => {
          const m = PHASE_META[k];
          const active = k === phaseKey || (k === "ovulatory" && phaseKey === "ovulation");
          return `<span class="phase-pill${active ? " phase-pill--active " + m.cls : ""}">${m.label}</span>`;
        }).join("")}
      </div>
    </section>

    <section class="card pred-section">
      <h3 class="pred-section-h3">Next 3 predicted cycles</h3>
      ${cycleCards}
      <p class="pred-disclaimer" style="margin-top:0.75rem;">${disclaimer}</p>
    </section>`;
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  buildSymptomUI();
  await loadLogs();
  renderCalendar();
  renderPredictionPanel();
}
init();
