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
  SYMPTOM_CATEGORIES, SYMPTOM_ICONS, FLOW_OPTIONS, openModal, closeModal, showToast
} from "./utils.js";

import { saveDailyLog, getAllLogs, deleteDailyLog, clearAllLogs, getSymptomCatalog } from "./db.js";
import { getUserGoal } from "./goals.js";
import { onAuthChange } from "./auth.js";
import { fetchCycleState } from "./cycle-state.js";
import {
  customSymptomLooksUrgent,
  normalizeCustomSymptomText,
  sanitizeCustomSymptomNote,
  sanitizeCustomSymptomText,
} from "./custom-symptoms.js";

// ── PRESENTATION + INTEGRATION LAYER ONLY ────────────────────────────────────
// This file gathers user data and passes it to the approved backend engines
// via fetchCycleState (→ cyclesML.js → cyclePhaseEngine.js).
// All reproductive-health calculations (phase, next period, fertile window,
// ovulation, confidence) are computed ONLY by the approved engine files.
// Do NOT add local calculation logic here.

// Date utility helpers - used only for processing data returned by approved engines.
function _addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

function _daysBetween(a, b) {
  return Math.round(
    (new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000
  );
}


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
let predictionPanelState = { status: "idle", errorMessage: "" };

let selectedDate = "";
let selectedFlow = "none";
let selectedSymptoms = new Set();
let selectedSymptomSeverity = new Map(); // symptom -> 1-5
let selectedOtherSymptoms = []; // [{ text, normalizedText, severity, note, createdAt, dateKey }]
let selectedSleepScore = null;
let selectedStressLevel = null;
let selectedActivityLevel = null;
let symptomCategories = Object.fromEntries(
  Object.entries(SYMPTOM_CATEGORIES).map(([cat, list]) => [cat, [...list]])
);
const BIOMETRIC_LEVELS = ["low", "moderate", "high", "very_high"];
const BIOMETRIC_LEVEL_LABELS = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

const today = new Date();
currentYear = today.getFullYear();
currentMonth = today.getMonth();

function setPredictionPanelState(status, errorMessage = "") {
  predictionPanelState = { status, errorMessage };
}

function buildSymptomCategoriesFromCatalog(catalogItems = []) {
  const grouped = {};
  for (const item of catalogItems) {
    const category = String(item?.category || "Other").trim() || "Other";
    const label = String(item?.label || "").trim();
    if (!label) continue;
    if (!grouped[category]) grouped[category] = [];
    if (!grouped[category].includes(label)) grouped[category].push(label);
  }
  return grouped;
}

async function loadCatalogSymptomsForUI() {
  const catalog = await getSymptomCatalog({ timeoutMs: 3500 });
  if (!Array.isArray(catalog) || !catalog.length) return;

  const grouped = buildSymptomCategoriesFromCatalog(catalog);
  if (!Object.keys(grouped).length) return;

  symptomCategories = grouped;
  buildSymptomUI();
  updateSymptomChips();
  updateSeverityPanel();
}

// ── Load & compute ─────────────────────────────────────────────────────────

async function recomputeCycleData() {
  const baseline = { predictedPeriodDays: [], phase: "unknown", dayInCycle: null, avgCycleLength: null };

  let state = null;
  try {
    state = await fetchCycleState(allLogs);
  } catch (err) {
    predResult = null;
    cycleData = baseline;
    throw err;
  }

  if (!state?.ready) {
    predResult = null;
    cycleData  = baseline;
    return;
  }

  // Always rebuild predictedPeriodDays from futureCycles using the locally-computed
  // period duration. The backend caches by period START date, so logging additional
  // days to an in-progress period doesn't bust its cache - it returns the duration
  // from when only 1 day was logged. allLogs is always up-to-date, so we recompute
  // the duration here and fill the correct number of days per future cycle.
  if (state.futureCycles?.length) {
    const todayKey = toDateKey(new Date());

    // Cluster period days from allLogs to get average period duration
    const pDays = Object.keys(allLogs)
      .filter(k => allLogs[k]?.flow && allLogs[k].flow !== "none").sort();

    let periodDuration = 5; // safe default if no logs
    if (pDays.length) {
      const cls = [];
      let cs = pDays[0], ce = pDays[0];
      for (let i = 1; i < pDays.length; i++) {
        if (_daysBetween(pDays[i - 1], pDays[i]) > 3) { cls.push({ s: cs, e: ce }); cs = pDays[i]; }
        ce = pDays[i];
      }
      cls.push({ s: cs, e: ce });
      const durations = cls.map(c => Math.max(1, _daysBetween(c.s, c.e) + 1));
      periodDuration  = Math.max(4, Math.round(durations.reduce((a, b) => a + b, 0) / durations.length));
    }

    const rebuilt = [];
    // Also fix periodEnd inside each futureCycle so the prediction panel shows
    // the correct date range (e.g. "May 21 - May 26") not "May 21 - May 21".
    state.futureCycles = state.futureCycles.map(c => {
      const pStart = typeof c.periodStart === "string" ? c.periodStart : null;
      if (!pStart) return c;
      const pEnd = _addDays(pStart, periodDuration - 1);
      return { ...c, periodEnd: pEnd };
    });
    for (const c of state.futureCycles) {
      const pStart = typeof c.periodStart === "string" ? c.periodStart : null;
      if (!pStart || pStart <= todayKey) continue;
      for (let i = 0; i < periodDuration; i++) rebuilt.push(_addDays(pStart, i));
    }
    console.log(
      `[calendar] predictedPeriodDays rebuilt from futureCycles:` +
      ` ${state.predictedPeriodDays?.length ?? 0} → ${rebuilt.length} (${periodDuration}d/cycle)`
    );
    state.predictedPeriodDays = rebuilt;
  }

  // Convert ISO date strings → Date objects for renderPredictionPanel
  const futureCycles = (state.futureCycles || []).map(c => ({
    ...c,
    periodStart:   c.periodStart   ? new Date(c.periodStart   + "T00:00:00") : null,
    periodEnd:     c.periodEnd     ? new Date(c.periodEnd     + "T00:00:00") : null,
    ovulationDay:  c.ovulationDay  ? new Date(c.ovulationDay  + "T00:00:00") : null,
    earliestStart: c.earliestStart ? new Date(c.earliestStart + "T00:00:00") : null,
    latestStart:   c.latestStart   ? new Date(c.latestStart   + "T00:00:00") : null,
    fertileWindow: c.fertileWindow ? {
      start: c.fertileWindow.start ? new Date(c.fertileWindow.start + "T00:00:00") : null,
      end:   c.fertileWindow.end   ? new Date(c.fertileWindow.end   + "T00:00:00") : null,
    } : null,
  }));

  predResult = {
    ready:               true,
    currentPhase:        state.phase,
    phaseLabel:          state.phaseLabel,
    cyclesLogged:        state.cyclesLogged,
    futureCycles,
    predictedCycleLength: state.predictedCycleLength,
    confidence:          state.confidence,
    disclaimer:          state.disclaimer,
    source:              state.source ?? "backend",
  };

  cycleData = {
    ...baseline,
    phase:                state.phase,
    phaseLabel:           state.phaseLabel,
    dayInCycle:           state.dayInCycle,
    avgCycleLength:       state.avgCycleLength,
    predictedPeriodDays:  state.predictedPeriodDays  ?? [],
    futureOvulationDates: state.futureOvulationDates ?? [],
    allFertileDays:       state.allFertileDays        ?? [],
    ovulationDate:        state.ovulationDate,
    nextPeriodDate:       state.nextPeriodDate,
    fertileStart:         state.fertileStart,
    fertileEnd:           state.fertileEnd,
  };
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

const sleepScoreInput = document.getElementById("sleep-score");
const stressLevelInput = document.getElementById("stress-level");
const activityLevelInput = document.getElementById("activity-level");
const sleepScoreValueEl = document.getElementById("sleep-score-value");
const stressLevelValueEl = document.getElementById("stress-level-value");
const activityLevelValueEl = document.getElementById("activity-level-value");

function normalizeSleepScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) return null;
  return parsed;
}

function normalizeBiometricLevel(value) {
  if (value === undefined || value === null || value === "") return null;

  if (typeof value === "number" && Number.isInteger(value)) {
    return BIOMETRIC_LEVELS[value - 1] ?? null;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return BIOMETRIC_LEVELS.includes(normalized) ? normalized : null;
}

function levelToSliderValue(level) {
  const idx = BIOMETRIC_LEVELS.indexOf(level);
  return idx >= 0 ? idx + 1 : 2;
}

function sliderValueToLevel(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return BIOMETRIC_LEVELS[parsed - 1] ?? null;
}

function updateBiometricLabels() {
  sleepScoreValueEl.textContent =
    selectedSleepScore === null ? "Not set" : `${selectedSleepScore}/10`;
  stressLevelValueEl.textContent =
    selectedStressLevel ? BIOMETRIC_LEVEL_LABELS[selectedStressLevel] : "Not set";
  activityLevelValueEl.textContent =
    selectedActivityLevel ? BIOMETRIC_LEVEL_LABELS[selectedActivityLevel] : "Not set";
}

function resetBiometricInputs() {
  selectedSleepScore = null;
  selectedStressLevel = null;
  selectedActivityLevel = null;

  sleepScoreInput.value = "7";
  stressLevelInput.value = "2";
  activityLevelInput.value = "2";
  updateBiometricLabels();
}

function restoreBiometricsFromLog(existing = {}) {
  selectedSleepScore = normalizeSleepScore(existing.sleepScore);
  selectedStressLevel = normalizeBiometricLevel(existing.stressLevel);
  selectedActivityLevel = normalizeBiometricLevel(existing.activityLevel);

  sleepScoreInput.value = String(selectedSleepScore ?? 7);
  stressLevelInput.value = String(levelToSliderValue(selectedStressLevel));
  activityLevelInput.value = String(levelToSliderValue(selectedActivityLevel));
  updateBiometricLabels();
}

function setBiometricInputsDisabled(disabled) {
  sleepScoreInput.disabled = disabled;
  stressLevelInput.disabled = disabled;
  activityLevelInput.disabled = disabled;
}

sleepScoreInput.addEventListener("input", () => {
  selectedSleepScore = normalizeSleepScore(sleepScoreInput.value);
  updateBiometricLabels();
});

stressLevelInput.addEventListener("input", () => {
  selectedStressLevel = sliderValueToLevel(stressLevelInput.value);
  updateBiometricLabels();
});

activityLevelInput.addEventListener("input", () => {
  selectedActivityLevel = sliderValueToLevel(activityLevelInput.value);
  updateBiometricLabels();
});

// ── Symptom categories UI ──────────────────────────────────────────────────

function buildSymptomUI() {
  const container = document.getElementById("symptom-categories");
  container.innerHTML = "";

  Object.entries(symptomCategories).forEach(([cat, symptoms]) => {
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
      const icon = SYMPTOM_ICONS[s];
      chip.innerHTML = icon
        ? `<span class="chip-icon-wrap chip-icon-emoji" aria-hidden="true">${icon}</span>${s}`
        : s;
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
    const sIconUrl = SYMPTOM_ICONS[s];
    nameEl.innerHTML = sIconUrl
      ? `<span class="chip-icon-wrap chip-icon-emoji" aria-hidden="true">${sIconUrl}</span>${s}`
      : s;
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

function renderOtherSymptoms() {
  const list = document.getElementById("other-symptom-list");
  if (!list) return;

  if (!selectedOtherSymptoms.length) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = "";

  selectedOtherSymptoms.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "custom-symptom-item";

    // Name + remove
    const top = document.createElement("div");
    top.className = "custom-symptom-top";

    const name = document.createElement("div");
    name.className = "custom-symptom-name";
    name.textContent = item.text;
    top.appendChild(name);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "custom-sym-remove";
    removeBtn.innerHTML = "&times;";
    removeBtn.setAttribute("aria-label", `Remove ${item.text}`);
    removeBtn.addEventListener("click", () => {
      selectedOtherSymptoms.splice(idx, 1);
      renderOtherSymptoms();
    });
    top.appendChild(removeBtn);
    row.appendChild(top);

    // Severity
    const sevRow = document.createElement("div");
    sevRow.className = "custom-sym-sev-row";

    const sevLabel = document.createElement("span");
    sevLabel.className = "custom-sym-sev-label";
    sevLabel.textContent = "Severity:";
    sevRow.appendChild(sevLabel);

    const sevBtns = document.createElement("div");
    sevBtns.className = "severity-btns";
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "severity-btn" + (Number(item.severity) === i ? " active" : "");
      btn.textContent = String(i);
      btn.addEventListener("click", () => {
        selectedOtherSymptoms[idx].severity = i;
        renderOtherSymptoms();
      });
      sevBtns.appendChild(btn);
    }
    sevRow.appendChild(sevBtns);
    row.appendChild(sevRow);

    // Optional note
    const note = document.createElement("input");
    note.type = "text";
    note.className = "form-input custom-symptom-note";
    note.placeholder = "Optional note…";
    note.maxLength = 160;
    note.value = item.note || "";
    note.addEventListener("input", (e) => {
      selectedOtherSymptoms[idx].note = sanitizeCustomSymptomNote(e.target.value);
    });
    row.appendChild(note);

    list.appendChild(row);
  });
}

function addOtherSymptomFromInput() {
  const input = document.getElementById("other-symptom-input");
  if (!input) return;

  const text = sanitizeCustomSymptomText(input.value);
  if (!text) return;

  const normalizedText = normalizeCustomSymptomText(text);
  const existing = selectedOtherSymptoms.find((item) => item.normalizedText === normalizedText);
  if (existing) {
    showToast("That custom symptom is already added for this day.", "info");
    input.value = "";
    return;
  }

  selectedOtherSymptoms.push({
    text,
    normalizedText,
    severity: 3,
    note: "",
    createdAt: new Date().toISOString(),
    dateKey: selectedDate,
  });
  input.value = "";
  renderOtherSymptoms();
}

// ── Symptom search ─────────────────────────────────────────────────────────

// Related terms for each symptom label. Lets users find symptoms using
// everyday language even when the exact label isn't in the list.
const SYMPTOM_SYNONYMS = {
  "Vaginal bleeding":      ["period", "menstruation", "bleeding", "blood", "flow", "menstrual"],
  "Spotting":              ["light bleeding", "breakthrough bleeding", "implantation bleeding", "pink discharge"],
  "Heavy flow":            ["heavy period", "menorrhagia", "flooding", "heavy bleeding", "excessive bleeding"],
  "Large clots":           ["blood clots", "clotting", "clots"],
  "Cramps":                ["period cramps", "menstrual cramps", "uterine cramps", "abdominal pain", "stomach pain", "tummy pain", "tummy ache", "dysmenorrhea", "stomach cramps"],
  "Pelvic pain":           ["lower abdominal pain", "hip pain", "groin pain", "lower back pain", "pelvic pressure"],
  "Ovulation pain":        ["mittelschmerz", "ovulation cramps", "mid-cycle pain", "one-sided pain", "side pain"],
  "Headache":              ["migraine", "head pain", "tension headache", "head pressure"],
  "Joint or muscle pain":  ["body aches", "muscle ache", "joint pain", "stiffness", "myalgia", "back pain", "backache", "aching", "sore muscles", "soreness"],
  "Breast tenderness":     ["sore breasts", "nipple sensitivity", "nipple tenderness", "breast soreness", "breast pain", "chest tenderness", "boob pain", "mastalgia", "breast swelling", "tender breasts"],
  "Bloating":              ["swollen belly", "belly bloat", "stomach bloat", "fullness", "distension", "puffy belly", "swollen stomach"],
  "Gassy":                 ["gas", "flatulence", "wind", "farting", "trapped gas"],
  "Heartburn":             ["acid reflux", "indigestion", "gerd", "acid", "burning chest"],
  "Nausea":                ["feeling sick", "queasiness", "morning sickness", "upset stomach", "sick to stomach", "queasy"],
  "Constipation":          ["hard stool", "difficulty passing stool", "infrequent bowel movements", "can't poop", "no bowel movement"],
  "Diarrhea":              ["loose stool", "loose bowels", "runny stool", "stomach bug"],
  "No discharge":          ["dry", "no mucus", "dryness"],
  "Sticky discharge":      ["thick discharge", "tacky discharge", "sticky mucus"],
  "Creamy discharge":      ["lotion-like discharge", "milky discharge", "white discharge", "lotion discharge"],
  "Egg-white discharge":   ["stretchy discharge", "clear discharge", "fertile mucus", "ewcm", "slippery discharge"],
  "Unusual discharge":     ["abnormal discharge", "odour", "smell", "fishy", "color change", "green discharge", "yellow discharge"],
  "Fatigue":               ["tired", "exhausted", "lethargy", "low energy", "worn out", "weakness", "sluggish", "drained", "no energy"],
  "Insomnia":              ["can't sleep", "trouble sleeping", "sleep issues", "sleeplessness", "waking up", "restless sleep"],
  "Brain fog":             ["mental fog", "foggy", "cloudy thinking", "confusion", "unclear thinking", "foggy brain"],
  "Forgetfulness":         ["memory issues", "forgetting things", "memory loss", "forgetting"],
  "Poor concentration":    ["can't focus", "difficulty concentrating", "distracted", "attention", "unfocused", "focus issues"],
  "Mood swings":           ["emotional", "unstable mood", "ups and downs", "moody"],
  "Irritability":          ["irritable", "snappy", "agitated", "short-tempered", "grumpy", "cranky"],
  "Anxiety":               ["anxious", "worried", "nervous", "panic", "restless", "worry", "on edge"],
  "Low mood":              ["sad", "depression", "depressed", "feeling down", "unhappy", "hopeless", "melancholy", "blue", "down"],
  "Crying spells":         ["crying", "tearful", "weepy", "tears", "emotional crying"],
  "Calm":                  ["peaceful", "relaxed", "serene", "at ease", "content"],
  "Stressed":              ["stress", "overwhelmed", "pressure", "tense", "tension", "burnout"],
  "Acne":                  ["pimples", "spots", "breakout", "blemishes", "zits", "skin breakout", "pimple"],
  "Dry skin":              ["flaky skin", "itchy skin", "rough skin", "dehydrated skin", "skin dryness"],
  "Hair thinning":         ["hair loss", "shedding", "alopecia", "hair fall", "losing hair"],
  "Hot flashes":           ["hot flush", "sweating", "overheating", "heat waves", "flushing", "flush"],
  "Night sweats":          ["sweating at night", "nocturnal sweating", "waking up sweating", "drenched at night"],
  "Cold flashes":          ["chills", "feeling cold", "cold sweats", "shivering"],
  "Basal temp shift":      ["bbt", "temperature change", "basal body temperature", "temp rise", "thermometer"],
  "Sweet cravings":        ["sugar cravings", "wanting sweets", "chocolate cravings", "candy", "dessert cravings"],
  "Salty cravings":        ["salt cravings", "wanting chips", "sodium cravings", "chips"],
  "Greasy food cravings":  ["fatty food cravings", "fried food cravings", "junk food", "oily food"],
  "Spicy food cravings":   ["hot food cravings", "chilli cravings", "spice cravings"],
  "Increased appetite":    ["hungry", "more hungry", "overeating", "appetite increase", "eating more", "ravenous"],
  "Decreased appetite":    ["not hungry", "loss of appetite", "appetite loss", "eating less", "no appetite"],
  "Fluid retention":       ["water retention", "swelling", "edema", "puffiness", "swollen", "puffy face", "swollen hands"],
  "Frequent urination":    ["peeing a lot", "urinary frequency", "need to pee more", "bladder", "bathroom a lot"],
  "Smell sensitivity":     ["hyperosmia", "sensitive to smells", "smell aversion", "strong smells", "scent sensitivity"],
  "Nasal congestion":      ["stuffy nose", "blocked nose", "runny nose", "congestion", "sinus"],
  "Weight change":         ["weight gain", "weight loss", "scale change", "gained weight", "lost weight"],
  "Sociable":              ["social", "outgoing", "extroverted", "talkative", "friendly"],
  "Withdrawn":             ["antisocial", "isolated", "introverted", "reclusive", "avoiding people", "wanting to be alone"],
  "Missed period":         ["late period", "no period", "skipped period", "amenorrhea", "period late", "period missing"],
  "Irregular period":      ["irregular cycle", "unpredictable period", "cycle changes", "erratic period"],
  "Increased libido":      ["high sex drive", "horny", "aroused", "increased desire", "wanting sex"],
  "Decreased libido":      ["low sex drive", "low desire", "not interested in sex", "no libido"],
  "Cervical mucus change": ["cm change", "discharge change", "mucus change", "cervical fluid"],
  "Vaginal dryness":       ["dry vagina", "lubrication issues", "vaginal dryness", "dry"],
  "Pain during sex":       ["dyspareunia", "painful intercourse", "sex hurts", "painful sex", "intercourse pain"],
};

document.getElementById("symptom-search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll(".symptom-cat").forEach((cat) => {
    let visible = 0;
    cat.querySelectorAll(".chip[data-symptom]").forEach((chip) => {
      const label = chip.dataset.symptom;
      const synonyms = SYMPTOM_SYNONYMS[label] || [];
      const match = !q
        || chip.textContent.toLowerCase().includes(q)
        || synonyms.some((s) => s.includes(q));
      chip.style.display = match ? "" : "none";
      if (match) visible++;
    });
    cat.style.display = visible === 0 ? "none" : "";
  });
});

document.getElementById("add-other-symptom-btn").addEventListener("click", addOtherSymptomFromInput);
document.getElementById("other-symptom-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addOtherSymptomFromInput();
  }
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
  const allowPredictedPeriod = ["period", "ttc", "perimenopause", "no_period", "track_symptoms"].includes(goal);
  const allowFertilityMarkers = ["period", "ttc", "perimenopause", "no_period", "track_symptoms"].includes(goal);

  const predictedSet = new Set(
    allowPredictedPeriod && cycleData?.predictedPeriodDays ? cycleData.predictedPeriodDays : []
  );
  const fertileSet = new Set();
  const ovulationSet = new Set();

  if (allowFertilityMarkers) {
    // Show exactly ONE fertile window on the calendar:
    // prefer the resolved top-level window from cycle-state; if missing, fall
    // back to the nearest future cycle window.
    let chosenFertileStart = cycleData?.fertileStart ?? null;
    let chosenFertileEnd = cycleData?.fertileEnd ?? null;
    let chosenOvulation = cycleData?.ovulationDate ?? null;

    if ((!chosenFertileStart || !chosenFertileEnd || !chosenOvulation) && predResult?.futureCycles?.length) {
      const todayMs = new Date(todayKey + "T00:00:00").getTime();
      const nearestFutureCycle = predResult.futureCycles.find((c) => {
        const endMs = c?.fertileWindow?.end?.getTime?.();
        return Number.isFinite(endMs) && endMs >= todayMs;
      });

      if (nearestFutureCycle) {
        if ((!chosenFertileStart || !chosenFertileEnd) &&
            nearestFutureCycle.fertileWindow?.start &&
            nearestFutureCycle.fertileWindow?.end) {
          chosenFertileStart = toDateKey(nearestFutureCycle.fertileWindow.start);
          chosenFertileEnd = toDateKey(nearestFutureCycle.fertileWindow.end);
        }
        if (!chosenOvulation && nearestFutureCycle.ovulationDay) {
          chosenOvulation = toDateKey(nearestFutureCycle.ovulationDay);
        }
      }
    }

    if (chosenFertileStart && chosenFertileEnd) {
      let d = new Date(chosenFertileStart + "T00:00:00");
      const end = new Date(chosenFertileEnd + "T00:00:00");
      while (d <= end) {
        fertileSet.add(toDateKey(d));
        d.setDate(d.getDate() + 1);
      }
    }
    if (chosenOvulation) {
      ovulationSet.add(chosenOvulation);
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

    if (!isPredicted) {
      if (isOvulation) {
        cell.classList.add("ovulation-day");
        if (isFuture) cell.classList.add("predicted-ovulation");
      } else if (isFertile) {
        cell.classList.add("fertile-day");
      }
    }

    cell.addEventListener("click", () => openLogModal(dateKey));
    grid.appendChild(cell);
  }
}

// ── Modal logic ────────────────────────────────────────────────────────────

function openLogModal(dateKey) {
  selectedDate = dateKey;
  const isFuture = new Date(dateKey + "T00:00:00") > new Date();

  document.getElementById("modal-title").textContent =
    `Log: ${formatDateDisplay(dateKey)}${isFuture ? " - notes only" : ""}`;

  // Show/hide the future date notice
  const notice = document.getElementById("future-date-notice");
  if (notice) notice.hidden = !isFuture;

  // Disable flow chips for future dates (only "none" is allowed)
  flowChips.querySelectorAll(".chip").forEach((chip) => {
    const isNoneChip = chip.dataset.value === "none";
    chip.disabled = isFuture && !isNoneChip;
    chip.classList.toggle("chip--disabled", isFuture && !isNoneChip);
  });

  // Disable symptom chips for future dates
  document.querySelectorAll("#symptom-categories .chip[data-symptom]").forEach((chip) => {
    chip.disabled = isFuture;
    chip.classList.toggle("chip--disabled", isFuture);
  });
  document.getElementById("other-symptom-input").disabled = isFuture;
  document.getElementById("add-other-symptom-btn").disabled = isFuture;
  setBiometricInputsDisabled(isFuture);

  // Reset state
  selectedFlow = "none";
  selectedSymptoms.clear();
  selectedSymptomSeverity.clear();
  selectedOtherSymptoms = [];
  resetBiometricInputs();
  document.getElementById("notes").value = "";
  document.getElementById("other-symptom-input").value = "";
  document.getElementById("delete-log-btn").style.display = "none";
  document.getElementById("symptom-search").value = "";

  // Restore hidden categories/chips after search reset
  document.querySelectorAll(".symptom-cat").forEach((c) => (c.style.display = ""));
  document.querySelectorAll(".chip[data-symptom]").forEach((c) => (c.style.display = ""));

  // Load existing log from in-memory cache (populated on init)
  const existing = allLogs[dateKey];
  if (existing) {
    selectedFlow = existing.flow || "none";
    restoreBiometricsFromLog(existing);

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

    if (Array.isArray(existing.otherSymptoms)) {
      selectedOtherSymptoms = existing.otherSymptoms
        .map((item) => ({
          text: sanitizeCustomSymptomText(item?.text),
          normalizedText: normalizeCustomSymptomText(item?.normalizedText || item?.text),
          severity: Number(item?.severity ?? 3),
          note: sanitizeCustomSymptomNote(item?.note),
          createdAt: typeof item?.createdAt === "string" ? item.createdAt : new Date().toISOString(),
          dateKey: item?.dateKey || dateKey,
        }))
        .filter((item) => item.text);
    }

    if (existing.notes) document.getElementById("notes").value = existing.notes;
    document.getElementById("delete-log-btn").style.display = "inline-flex";
  }

  updateFlowChips();
  updateSymptomChips();
  updateSeverityPanel();
  renderOtherSymptoms();
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

  // Block flow and symptoms on future dates regardless of how the modal was reached
  if (new Date(dateKey + "T00:00:00") > new Date()) {
    if (
      selectedFlow !== "none" ||
      selectedSymptoms.size > 0 ||
      selectedOtherSymptoms.length > 0 ||
      selectedSleepScore !== null ||
      selectedStressLevel !== null ||
      selectedActivityLevel !== null
    ) {
      showToast("Future dates are notes only. Flow, symptoms, and biometrics cannot be logged ahead.", "error");
      return;
    }
  }

  const data = {
    flow: selectedFlow,
    sleepScore: selectedSleepScore,
    stressLevel: selectedStressLevel,
    activityLevel: selectedActivityLevel,
    symptoms: Array.from(selectedSymptoms),
    symptomSeverity: Object.fromEntries(selectedSymptomSeverity),
    otherSymptoms: selectedOtherSymptoms.map((item) => ({
      text: sanitizeCustomSymptomText(item.text),
      normalizedText: normalizeCustomSymptomText(item.normalizedText || item.text),
      severity: Number(item.severity ?? 3),
      note: sanitizeCustomSymptomNote(item.note),
      createdAt: item.createdAt || new Date().toISOString(),
      dateKey,
    })).filter((item) => item.text),
    notes: document.getElementById("notes").value.trim(),
  };

  // Update in-memory and close modal immediately - don't wait for network
  allLogs[dateKey] = { ...data, date: dateKey };
  closeModal("log-modal");
  renderCalendar();
  let saveMessage = "Log saved successfully!";
  if (data.otherSymptoms.length) {
    saveMessage = "Saved to your symptom history. Custom symptoms are tracked in your history, but are not yet used in pattern predictions.";
    if (data.otherSymptoms.some((item) => customSymptomLooksUrgent(item.text))) {
      saveMessage += " If this symptom feels severe, sudden, or worrying, consider seeking medical advice.";
    }
  }
  showToast(saveMessage);

  // Persist + recompute in background, then re-render both grid and panel.
  // renderCalendar() is called again so the predicted period overlay reflects
  // the updated cycleData (e.g. clears old predicted window when new period logged).
  saveDailyLog(dateKey, data)
    .then(() => recomputeCycleData())
    .then(() => {
      setPredictionPanelState("ready");
      renderCalendar();
      renderPredictionPanel();
    })
    .catch(() => {
      setPredictionPanelState("error", "Your log was saved, but predictions could not be refreshed.");
      renderPredictionPanel();
    });
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

  // Persist deletion + recompute in background = render panel only after recompute finishes
  deleteDailyLog(dateKey)
    .then(() => recomputeCycleData())
    .then(() => {
      setPredictionPanelState("ready");
      renderPredictionPanel();
    })
    .catch(() => {
      setPredictionPanelState("error", "Log deleted, but prediction refresh failed.");
      renderPredictionPanel();
    });
});

// ── Clear all logs ─────────────────────────────────────────────────────────

document.getElementById("clear-all-logs-btn").addEventListener("click", async () => {
  if (!confirm("Clear ALL logs?\n\nThis will permanently delete every period and symptom entry. This cannot be undone.")) return;
  await clearAllLogs();
  allLogs = {};
  try {
    await recomputeCycleData();
    setPredictionPanelState("ready");
  } catch (_) {
    setPredictionPanelState("error", "Logs were cleared, but predictions could not be refreshed.");
  }
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
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

const PHASE_META = {
  menstrual:  { label: "Menstrual",  cls: "phase-menstrual"  },
  follicular: { label: "Follicular", cls: "phase-follicular" },
  ovulatory:  { label: "Ovulatory",  cls: "phase-ovulation"  },
  luteal:     { label: "Luteal",     cls: "phase-luteal"     },
  unknown:    { label: "Unknown",    cls: "phase-unknown"    },
};
const PHASE_ORDER = ["menstrual", "follicular", "ovulatory", "luteal"];
const CYCLE_LABELS = ["Next cycle", "Month 2", "Month 3"];

function renderPredictionPanel() {
  const panel = document.getElementById("prediction-panel");
  if (!panel) return;

  const goal = getUserGoal();
  if (!["period", "ttc", "perimenopause", "no_period", "track_symptoms"].includes(goal)) {
    panel.innerHTML = "";
    return;
  }

  if (predictionPanelState.status === "loading") {
    panel.innerHTML = `
      <section class="card" style="text-align:center;padding:1.25rem 1rem;color:var(--color-text-muted);font-size:0.92rem;">
        Loading your cycle predictions…
      </section>`;
    return;
  }

  if (predictionPanelState.status === "error") {
    panel.innerHTML = `
      <section class="card" style="text-align:center;padding:1.25rem 1rem;">
        <p class="text-muted" style="margin:0 0 0.75rem;">
          ${predictionPanelState.errorMessage || "We couldn't load your predictions right now."}
        </p>
        <button id="retry-prediction-load" class="btn btn-outline btn-sm" type="button">Try again</button>
      </section>`;
    const retryBtn = document.getElementById("retry-prediction-load");
    if (retryBtn) {
      retryBtn.onclick = async () => {
        setPredictionPanelState("loading");
        renderPredictionPanel();
        try {
          await recomputeCycleData();
          setPredictionPanelState("ready");
        } catch (_) {
          setPredictionPanelState("error", "Still having trouble loading predictions. Please try again in a moment.");
        }
        renderCalendar();
        renderPredictionPanel();
      };
    }
    return;
  }

  if (!predResult?.ready) {
    panel.innerHTML = `
      <section class="card" style="text-align:center;padding:1.25rem 1rem;color:var(--color-text-muted);font-size:0.92rem;">
        Log a period day (select any flow other than None) to see cycle predictions.
      </section>`;
    return;
  }

  const { confidence, currentPhase, futureCycles, cyclesLogged } = predResult;
  // Normalise confidence level to Title Case = backends may return "high"/"High"
  const confLevelNorm = confidence?.level
    ? confidence.level.charAt(0).toUpperCase() + confidence.level.slice(1).toLowerCase()
    : "Low";
  const confCls = confLevelNorm === "High" ? "conf-high" : confLevelNorm === "Medium" ? "conf-medium" : "conf-low";
  const phaseKey = currentPhase || "unknown";
  const phaseMeta = PHASE_META[phaseKey] || PHASE_META.unknown;

  // Only show cycles that start today or in the future = skip stale past predictions
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const upcomingCycles = (futureCycles || []).filter(c => c.periodStart && c.periodStart.getTime() >= todayMs);

  const cycleCards = upcomingCycles.slice(0, 3).map((c, i) => {
    const windowDays = c.earliestStart && c.latestStart
      ? Math.round((c.latestStart - c.earliestStart) / (1000 * 60 * 60 * 24) / 2)
      : 0;
    const windowNote = windowDays > 0 ? ` <span class="pred-window">± ${windowDays} days</span>` : "";
    return `
      <div class="pred-cycle-card">
        <div class="pred-cycle-title">${CYCLE_LABELS[i] || `Month ${i + 1}`}${windowNote}</div>
        <div class="pred-cycle-row"><span>Period</span><span>${fmtShort(c.periodStart)} - ${fmtShort(c.periodEnd)}</span></div>
        <div class="pred-cycle-row"><span>Ovulation</span><span>${fmtShort(c.ovulationDay)}</span></div>
        <div class="pred-cycle-row"><span>Fertile window</span><span>${fmtShort(c.fertileWindow?.start)} - ${fmtShort(c.fertileWindow?.end)}</span></div>
      </div>`;
  }).join("");

  panel.innerHTML = `
    <section class="card pred-section">
      <div class="pred-row-space">
        <span class="pred-section-label">Confidence</span>
        <span class="conf-badge ${confCls}">${confLevelNorm}</span>
      </div>
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
      <h3 class="pred-section-h3">Upcoming predicted cycles</h3>
      ${cycleCards || `<p style="color:var(--color-text-muted);font-size:0.9rem;">Log your current period to update predictions.</p>`}
    </section>`;
}

// ── Init ───────────────────────────────────────────────────────────────────
// We wait for Firebase auth state to resolve (onAuthChange fires once on load)
// before calling loadLogs + recomputeCycleData. This ensures getIdToken() has a
// real token when the user is signed in (currentUser is null for ~200-500 ms after
// page load). In anon mode onAuthChange fires immediately with user=null, which is
// also fine = fetchCycleState falls back to local computation.

let _initDone = false;

async function init() {
  buildSymptomUI();
  loadCatalogSymptomsForUI().catch(() => {});
  setPredictionPanelState("loading");
  renderPredictionPanel();
  // Render calendar shell immediately with logged days (no predictions yet)
  try {
    allLogs = await getAllLogs();
  } catch (_) {
    allLogs = {};
    setPredictionPanelState("error", "We couldn't load your calendar logs right now.");
  }
  renderCalendar();
  // Auth state may not have resolved yet; wait for it before fetching cycle state
  // onAuthChange fires once on load regardless of sign-in state
  onAuthChange(async () => {
    if (_initDone) return; // fire only once per page load
    _initDone = true;
    await loadCatalogSymptomsForUI().catch(() => {});
    setPredictionPanelState("loading");
    renderPredictionPanel();
    try {
      await recomputeCycleData();
      setPredictionPanelState("ready");
    } catch (_) {
      setPredictionPanelState("error", "We couldn't refresh your cycle predictions.");
    }
    renderCalendar();
    renderPredictionPanel();
  });
}
init();
