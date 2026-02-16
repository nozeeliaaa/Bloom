/**
 * calendar.js - Calendar Page Logic
 *
 * Interactive calendar with:
 * - Logged period day highlighting
 * - Predicted period day strikethrough overlay
 * - Fertile window and ovulation markers
 * - Legend explaining all visual indicators
 * - Log entry modal (flow, symptoms, severity, notes)
 *
 * COMP3901: Separated from HTML for modularity and readability.
 */
import {
  renderNav, renderFooter, renderModeBanner,
  toDateKey, getMonthName, getDaysInMonth, getFirstDayOfWeek,
  SYMPTOMS, FLOW_OPTIONS, openModal, closeModal, showToast
} from './utils.js';
import { saveDailyLog, getDailyLog, getAllLogs, deleteDailyLog } from './db.js';
import { getMockCycleData } from './mockCycle.js';

// Render shared UI
renderNav('calendar');
renderFooter();
renderModeBanner(document.getElementById('banner-area'));

// State
let currentYear, currentMonth;
let allLogs = {};
let cycleData = null;
let selectedDate = '';
let selectedFlow = 'none';
let selectedSymptoms = new Set();

const today = new Date();
currentYear = today.getFullYear();
currentMonth = today.getMonth();

/* ===== Build flow chips ===== */
const flowChips = document.getElementById('flow-chips');
FLOW_OPTIONS.forEach(f => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = f.charAt(0).toUpperCase() + f.slice(1);
  chip.dataset.value = f;
  chip.addEventListener('click', () => {
    selectedFlow = f;
    updateFlowChips();
  });
  flowChips.appendChild(chip);
});
function updateFlowChips() {
  flowChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.value === selectedFlow);
  });
}

/* ===== Build symptom chips ===== */
const symptomChips = document.getElementById('symptom-chips');
SYMPTOMS.forEach(s => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = s;
  chip.dataset.value = s;
  chip.addEventListener('click', () => {
    if (selectedSymptoms.has(s)) selectedSymptoms.delete(s);
    else selectedSymptoms.add(s);
    updateSymptomChips();
  });
  symptomChips.appendChild(chip);
});
function updateSymptomChips() {
  symptomChips.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('selected', selectedSymptoms.has(c.dataset.value));
  });
}

/* ===== Severity slider ===== */
const severityInput = document.getElementById('severity');
const severityValue = document.getElementById('severity-value');
severityInput.addEventListener('input', () => {
  severityValue.textContent = severityInput.value;
});

/* ===== Calendar rendering ===== */
async function loadLogs() {
  allLogs = await getAllLogs();
  cycleData = getMockCycleData();
  console.log("[cycleData keys]", Object.keys(cycleData || {}));
  console.log("[cycleData full]", JSON.stringify(cycleData, null, 2));

}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const headers = grid.querySelectorAll('.calendar-header-cell');
  grid.innerHTML = '';
  headers.forEach(h => grid.appendChild(h));

  document.getElementById('month-label').textContent = `${getMonthName(currentMonth)} ${currentYear}`;

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfWeek(currentYear, currentMonth);
  const todayKey = toDateKey(today);

  // Build sets for quick lookup
  const predictedSet = new Set(cycleData ? cycleData.predictedPeriodDays : []);
  const fertileSet = new Set();
  const ovulationSet = new Set();

  if (cycleData && cycleData.fertileStart && cycleData.fertileEnd) {
    // Build fertile window date set
    let d = new Date(cycleData.fertileStart + 'T00:00:00');
    const end = new Date(cycleData.fertileEnd + 'T00:00:00');
    while (d <= end) {
      fertileSet.add(toDateKey(d));
      d.setDate(d.getDate() + 1);
    }
  }
  if (cycleData && cycleData.ovulationDate) {
    ovulationSet.add(cycleData.ovulationDate);
  }

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'calendar-cell empty';
    empty.setAttribute('role', 'gridcell');
    grid.appendChild(empty);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(currentYear, currentMonth, d);
    const dateKey = toDateKey(dateObj);
    const cell = document.createElement('button');
    cell.className = 'calendar-cell';
    cell.setAttribute('role', 'gridcell');
    cell.setAttribute('aria-label', `${getMonthName(currentMonth)} ${d}, ${currentYear}`);

    // Day number span (needed for strikethrough styling)
    const dayNum = document.createElement('span');
    dayNum.className = 'day-number';
    dayNum.textContent = d;
    cell.appendChild(dayNum);

    if (dateKey === todayKey) cell.classList.add('today');

    const log = allLogs[dateKey];
    const isLoggedPeriod = log && log.flow && log.flow !== 'none';
    const isPredicted = predictedSet.has(dateKey) && !isLoggedPeriod;
    const isFertile = fertileSet.has(dateKey);
    const isOvulation = ovulationSet.has(dateKey);
    const isFuture = dateObj > today; // or dateKey > todayKey if you prefer string compare


    // Apply classes based on type
    if (isLoggedPeriod) {
      cell.classList.add('has-log', 'logged-period');
      const dot = document.createElement('span');
      dot.className = `flow-indicator flow-${log.flow}`;
      cell.appendChild(dot);
    } else if (log) {
      cell.classList.add('has-log');
    }

    if (isPredicted) {
      cell.classList.add('predicted-period');
    }
    if (isOvulation) {
      cell.classList.add('ovulation-day');
      if (isFuture) cell.classList.add('predicted-ovulation');
    } else if (isFertile) {
      cell.classList.add('fertile-day');
    }

    cell.addEventListener('click', () => openLogModal(dateKey));
    grid.appendChild(cell);
  }
}

/* ===== Modal logic ===== */
async function openLogModal(dateKey) {
  selectedDate = dateKey;
  document.getElementById('modal-title').textContent = `Log: ${formatDateDisplay(dateKey)}`;

  selectedFlow = 'none';
  selectedSymptoms.clear();
  severityInput.value = 1;
  severityValue.textContent = '1';
  document.getElementById('notes').value = '';
  document.getElementById('delete-log-btn').style.display = 'none';

  const existing = allLogs[dateKey] || await getDailyLog(dateKey);
  if (existing) {
    selectedFlow = existing.flow || 'none';
    if (existing.symptoms) existing.symptoms.forEach(s => selectedSymptoms.add(s));
    if (existing.severity) {
      severityInput.value = existing.severity;
      severityValue.textContent = existing.severity;
    }
    if (existing.notes) document.getElementById('notes').value = existing.notes;
    document.getElementById('delete-log-btn').style.display = 'inline-flex';
  }

  updateFlowChips();
  updateSymptomChips();
  openModal('log-modal');
}

function formatDateDisplay(dateKey) {
  const [y, m, d] = dateKey.split('-');
  const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/* ===== Form submission ===== */
document.getElementById('log-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    flow: selectedFlow,
    symptoms: Array.from(selectedSymptoms),
    severity: parseInt(severityInput.value),
    notes: document.getElementById('notes').value.trim()
  };

  await saveDailyLog(selectedDate, data);
  console.log("[Calendar] saved", selectedDate, data);
  console.log("[Calendar] localStorage logs now:", localStorage.getItem("bloom_daily_logs"));
  allLogs[selectedDate] = data;
  cycleData = getMockCycleData(); // Recompute predictions
  closeModal('log-modal');
  renderCalendar();
  showToast('Log saved successfully!');
});

/* ===== Delete ===== */
document.getElementById('delete-log-btn').addEventListener('click', async () => {
  if (confirm('Delete this log entry?')) {
    await deleteDailyLog(selectedDate);
    delete allLogs[selectedDate];
    cycleData = getMockCycleData();
    closeModal('log-modal');
    renderCalendar();
    showToast('Log deleted.', 'info');
  }
});

/* ===== Modal close handlers ===== */
document.getElementById('modal-close-btn').addEventListener('click', () => closeModal('log-modal'));
document.getElementById('cancel-btn').addEventListener('click', () => closeModal('log-modal'));
document.getElementById('log-modal').addEventListener('click', (e) => {
  if (e.target.id === 'log-modal') closeModal('log-modal');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal('log-modal');
});

/* ===== Month navigation ===== */
document.getElementById('prev-month').addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
});
document.getElementById('next-month').addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
});

/* ===== Init ===== */
async function init() {
  await loadLogs();
  renderCalendar();
}
init();
