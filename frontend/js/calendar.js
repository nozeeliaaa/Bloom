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

import { saveDailyLog, getAllLogs, deleteDailyLog, clearAllLogs } from "./db.js";
import { getUserGoal } from "./goals.js";
import { onAuthChange, getIdToken } from "./auth.js";
import { isAnonMode } from "./mode.js";

// ── Local cycle state computation (anon mode + auth fallback) ──────────────────
// Pure JS = mirrors backend cyclePhaseEngine + buildFutureCyclesBackend logic.
// Used when: (a) user is in anon mode, (b) auth token unavailable, (c) backend error.

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

function computeCycleStateLocally(logs) {
  const DISCLAIMER =
    "This is an educational estimate, not a medical prediction. Consult a healthcare provider for medical advice.";
  const EMPTY = {
    ready: false, phase: "unknown", phaseLabel: "Unknown",
    dayInCycle: null, avgCycleLength: null, predictedCycleLength: null,
    confidence: { level: "Low", windowDays: 5, message: "Log your first period to see predictions." },
    nextPeriodDate: null, ovulationDate: null, fertileStart: null, fertileEnd: null,
    cyclesLogged: 0, predictedPeriodDays: [], futureOvulationDates: [],
    allFertileDays: [], futureCycles: [], disclaimer: DISCLAIMER, source: "local",
  };

  const periodDays = Object.keys(logs || {})
    .filter(k => { const l = logs[k]; return l && l.flow && l.flow !== "none"; })
    .sort();

  if (!periodDays.length) return EMPTY;

  // Cluster starts & ends (gap > 3 days = new period)
  const cStarts = [], cEnds = [];
  let cs = periodDays[0], ce = periodDays[0];
  for (let i = 1; i < periodDays.length; i++) {
    if (_daysBetween(periodDays[i - 1], periodDays[i]) > 3) {
      cStarts.push(cs); cEnds.push(ce); cs = periodDays[i];
    }
    ce = periodDays[i];
  }
  cStarts.push(cs); cEnds.push(ce);

  const lastStart = cStarts[cStarts.length - 1];
  const lastEnd   = cEnds[cEnds.length - 1];

  // Cycle lengths
  const cycleLengths = [];
  for (let i = 1; i < cStarts.length; i++) {
    cycleLengths.push(_daysBetween(cStarts[i - 1], cStarts[i]));
  }
  const avgCycleLength = cycleLengths.length
    ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length)
    : 28;

  // Weighted-average predicted length (rule-based, mirrors backend fallback)
  let predictedCycleLength = avgCycleLength;
  if (cycleLengths.length > 0) {
    const n = cycleLengths.length;
    const weights = Array.from({ length: n }, (_, i) => i + 1);
    const sumW = weights.reduce((a, w) => a + w, 0);
    predictedCycleLength = Math.max(21, Math.min(45, Math.round(
      weights.reduce((a, w, i) => a + w * cycleLengths[i], 0) / sumW
    )));
  }

  // Day in cycle & phase
  const todayKey = toDateKey(new Date());
  const dayInCycle = _daysBetween(lastStart, todayKey) + 1;
  const folEnd  = Math.round(predictedCycleLength * 13 / 28);
  const ovDay   = Math.round(predictedCycleLength * 14 / 28);
  const ovEnd   = Math.round(predictedCycleLength * 16 / 28);

  let phase, phaseLabel;
  if (periodDays.includes(todayKey))    { phase = "menstrual";  phaseLabel = "Menstrual";  }
  else if (dayInCycle <= folEnd)        { phase = "follicular"; phaseLabel = "Follicular"; }
  else if (dayInCycle <= ovEnd)         { phase = "ovulatory";  phaseLabel = "Ovulatory";  }
  else if (dayInCycle <= predictedCycleLength) { phase = "luteal"; phaseLabel = "Luteal"; }
  else                                  { phase = "luteal";     phaseLabel = "Late Luteal"; }

  // Key dates
  const nextPeriodDate = _addDays(lastStart, predictedCycleLength);
  const ovulationDate  = _addDays(lastStart, ovDay - 1);
  const fertileStart   = _addDays(lastStart, ovDay - 6);
  const fertileEnd     = _addDays(lastStart, ovDay);

  // Confidence
  const confStr = cycleLengths.length >= 3 ? "high" : cycleLengths.length >= 1 ? "medium" : "low";
  const CONF_MAP = {
    high:   { level: "High",   windowDays: 0, message: "Your cycle is quite regular. This estimate is fairly reliable." },
    medium: { level: "Medium", windowDays: 2, message: "Your cycle varies slightly. Showing an estimated window." },
    low:    { level: "Low",    windowDays: 5, message: "Not enough history yet. Showing a wider estimate window." },
  };
  const confidence = CONF_MAP[confStr];

  // Future cycles (date strings = converted to Date objects by recomputeCycleData)
  const periodDuration = Math.max(1, _daysBetween(lastStart, lastEnd) + 1);
  const futureCycles = [];
  let chain = lastStart;
  for (let i = 0; i < 3; i++) {
    const pStart = _addDays(chain, predictedCycleLength);
    const pEnd   = _addDays(pStart, periodDuration - 1);
    const oDay   = _addDays(pStart, -14);
    const fS     = _addDays(oDay, -5);
    const fE     = _addDays(oDay, 1);
    const grow   = confidence.windowDays * (i + 1);
    futureCycles.push({
      cycleLength: predictedCycleLength,
      periodStart: pStart, periodEnd: pEnd, ovulationDay: oDay,
      fertileWindow: { start: fS, end: fE },
      earliestStart: _addDays(pStart, -grow), latestStart: _addDays(pStart, grow),
      isEstimate: true,
    });
    chain = pStart;
  }

  // Calendar overlays
  const predictedPeriodDays = [], futureOvulationDates = [], allFertileDays = [];
  let computedNextPeriod = null;
  for (const c of futureCycles) {
    if (!c.periodStart || c.periodStart <= todayKey) continue;
    const pMs = new Date(c.periodStart + "T00:00:00").getTime();
    if (cStarts.some(s => Math.abs(new Date(s + "T00:00:00").getTime() - pMs) <= 14 * 86400000)) continue;
    const dur = _daysBetween(c.periodStart, c.periodEnd) + 1;
    for (let i = 0; i < dur; i++) predictedPeriodDays.push(_addDays(c.periodStart, i));
    if (!computedNextPeriod) computedNextPeriod = c.periodStart;
    if (c.ovulationDay) futureOvulationDates.push(c.ovulationDay);
    if (c.fertileWindow?.start && c.fertileWindow?.end) {
      let d = c.fertileWindow.start;
      while (d <= c.fertileWindow.end) { allFertileDays.push(d); d = _addDays(d, 1); }
    }
  }

  const periodLogsCount = Object.keys(logs).filter(k => logs[k]?.flow && logs[k].flow !== "none").length;
  console.log(
    `[calendar] local state: mode=${isAnonMode() ? "anon" : "account"} phase=${phase}` +
    ` day=${dayInCycle} cycles=${cStarts.length} periodLogs=${periodLogsCount}` +
    ` predPeriodDays=${predictedPeriodDays.length}`
  );

  return {
    ready: true, phase, phaseLabel, dayInCycle,
    avgCycleLength, predictedCycleLength, confidence,
    nextPeriodDate: computedNextPeriod ?? nextPeriodDate,
    ovulationDate, fertileStart, fertileEnd,
    cyclesLogged: cStarts.length,
    predictedPeriodDays, futureOvulationDates, allFertileDays,
    futureCycles,
    disclaimer: DISCLAIMER, source: "local",
  };
}

// ── Backend API helper ─────────────────────────────────────────────────────────

/**
 * POST /api/cycles/state → canonical cycle state from backend.
 * Falls back to local computation when:
 *   - user is in anon mode (no token by design)
 *   - auth token not yet available (cold load race)
 *   - backend is unreachable or returns an error
 */
function _trimLogsForBackend(logs) {
  const todayKey = toDateKey(new Date());
  const d = new Date(todayKey + "T00:00:00");
  d.setDate(d.getDate() - 90);
  const cutoff = toDateKey(d);
  const trimmed = {};
  for (const [k, v] of Object.entries(logs || {})) {
    if ((v?.flow && v.flow !== "none") || k >= cutoff) trimmed[k] = v;
  }
  return trimmed;
}

async function fetchCycleState(logs) {
  const token = await getIdToken();

  // sessionStorage cache: same key format as dashboard.js so both share hits
  const periodDays = Object.keys(logs || {})
    .filter(k => logs[k]?.flow && logs[k].flow !== "none").sort();
  const lastPeriodDay = periodDays[periodDays.length - 1] || "none";
  const todayKey = toDateKey(new Date());
  const cacheKey = `bloom_cs_v1_${token ? "acct" : "anon"}_${lastPeriodDay}_${todayKey}`;

  try {
    const hit = sessionStorage.getItem(cacheKey);
    if (hit) {
      const { state, ts } = JSON.parse(hit);
      if (Date.now() - ts < 6 * 60 * 60 * 1000) {
        console.log("[calendar] cycle state (cache)");
        return state;
      }
    }
  } catch (_) {}

  let result = null;

  if (token) {
    try {
      const res = await fetch("/api/cycles/state", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ logs: _trimLogsForBackend(logs) }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.state) {
          console.log(`[calendar] cycle state (backend): phase=${json.state.phase} day=${json.state.dayInCycle}`);
          result = { ...json.state, source: "backend" };
        }
      } else {
        console.warn("[calendar] fetchCycleState backend error", res.status);
      }
    } catch (e) {
      console.warn("[calendar] fetchCycleState backend unreachable:", e.message);
    }
  }

  if (!result) result = computeCycleStateLocally(logs);

  try { sessionStorage.setItem(cacheKey, JSON.stringify({ state: result, ts: Date.now() })); } catch (_) {}
  return result;
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

let selectedDate = "";
let selectedFlow = "none";
let selectedSymptoms = new Set();
let selectedSymptomSeverity = new Map(); // symptom -> 1-5

const today = new Date();
currentYear = today.getFullYear();
currentMonth = today.getMonth();

// ── Load & compute ─────────────────────────────────────────────────────────

async function recomputeCycleData() {
  const baseline = { predictedPeriodDays: [], phase: "unknown", dayInCycle: null, avgCycleLength: null };

  const state = await fetchCycleState(allLogs);
  if (!state?.ready) {
    predResult = null;
    cycleData  = baseline;
    return;
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
      const iconUrl = SYMPTOM_ICONS[s];
      chip.innerHTML = iconUrl
        ? `<span class="chip-icon-wrap"><img src="${iconUrl}" alt="" class="chip-icon-img" loading="lazy"></span>${s}`
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
      ? `<span class="chip-icon-wrap"><img src="${sIconUrl}" alt="" class="chip-icon-img" loading="lazy"></span>${s}`
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

  // Block flow and symptoms on future dates regardless of how the modal was reached
  if (new Date(dateKey + "T00:00:00") > new Date()) {
    if (selectedFlow !== "none" || selectedSymptoms.size > 0) {
      showToast("You cannot log flow or symptoms for a future date.", "error");
      return;
    }
  }

  const data = {
    flow: selectedFlow,
    symptoms: Array.from(selectedSymptoms),
    symptomSeverity: Object.fromEntries(selectedSymptomSeverity),
    notes: document.getElementById("notes").value.trim(),
  };

  // Update in-memory and close modal immediately - don't wait for network
  allLogs[dateKey] = { ...data, date: dateKey };
  closeModal("log-modal");
  renderCalendar();
  showToast("Log saved successfully!");

  // Persist + recompute predictions in background = render panel only after recompute finishes
  saveDailyLog(dateKey, data)
    .then(() => recomputeCycleData())
    .then(() => renderPredictionPanel())
    .catch(() => renderPredictionPanel());
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
    .then(() => renderPredictionPanel())
    .catch(() => renderPredictionPanel());
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

  const { confidence, currentPhase, futureCycles, cyclesLogged, disclaimer } = predResult;
  // Normalise confidence level to Title Case = backends may return "high"/"High"
  const confLevelNorm = confidence?.level
    ? confidence.level.charAt(0).toUpperCase() + confidence.level.slice(1).toLowerCase()
    : "Low";
  const confCls = confLevelNorm === "High" ? "conf-high" : confLevelNorm === "Medium" ? "conf-medium" : "conf-low";
  const phaseKey = currentPhase || "unknown";
  const phaseMeta = PHASE_META[phaseKey] || PHASE_META.unknown;
  const isLocalFallback = predResult.source === "local";

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
        <div class="pred-cycle-row"><span>Period</span><span>${fmtShort(c.periodStart)} – ${fmtShort(c.periodEnd)}</span></div>
        <div class="pred-cycle-row"><span>Ovulation</span><span>${fmtShort(c.ovulationDay)}</span></div>
        <div class="pred-cycle-row"><span>Fertile window</span><span>${fmtShort(c.fertileWindow?.start)} – ${fmtShort(c.fertileWindow?.end)}</span></div>
      </div>`;
  }).join("");

  panel.innerHTML = `
    <section class="card pred-section">
      <div class="pred-row-space">
        <span class="pred-section-label">Confidence</span>
        <span class="conf-badge ${confCls}">${confLevelNorm}${isLocalFallback ? " · rule-based" : ""}</span>
      </div>
      <p class="pred-msg">${confidence.message}</p>
      ${isLocalFallback ? `<p class="pred-msg" style="color:var(--color-text-muted);font-size:0.82rem;">Predictions are rule-based estimates = sign in or log more cycles for ML-enhanced accuracy.</p>` : ""}
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
      <p class="pred-disclaimer" style="margin-top:0.75rem;">${disclaimer}</p>
    </section>`;
}

// ── Init ───────────────────────────────────────────────────────────────────
// We wait for Firebase auth state to resolve (onAuthChange fires once on load)
// before calling loadLogs + recomputeCycleData. This ensures getIdToken() has a
// real token when the user is signed in (currentUser is null for ~200–500 ms after
// page load). In anon mode onAuthChange fires immediately with user=null, which is
// also fine = fetchCycleState falls back to local computation.

let _initDone = false;

async function init() {
  buildSymptomUI();
  // Render calendar shell immediately with logged days (no predictions yet)
  allLogs = await getAllLogs();
  renderCalendar();
  // Auth state may not have resolved yet; wait for it before fetching cycle state
  // onAuthChange fires once on load regardless of sign-in state
  onAuthChange(async () => {
    if (_initDone) return; // fire only once per page load
    _initDone = true;
    await recomputeCycleData();
    renderCalendar();
    renderPredictionPanel();
  });
}
init();
