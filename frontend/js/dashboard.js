/**
 * dashboard.js - Goal-based dashboard
 * One screen, content adapts to selected goal + cycle phase.
 */

import {
  renderNav,
  renderFooter,
  renderModeBanner,
  renderBloomieFab,
  formatDate,
  toDateKey,
} from "./utils.js";
import { getAllLogs } from "./db.js";
import { onAuthChange } from "./auth.js";
import { isAnonMode } from "./mode.js";
import { getUserGoal, goalLabel, goalDesc } from "./goals.js";
import { triggerNotifications } from "./notifications.js";
import { getTodaysPhaseInsights } from "./phase-education.js";
import { fetchCycleState } from "./cycle-state.js";

// Algorithm modules loaded lazily inside loadDashboard() = no top-level await
let algoPregnancy    = null;
let algoCycleEngine  = null;
let algoSymptomEngine = null;
let algoAnomalyEngine = null;

renderNav("dashboard");
renderFooter();
renderBloomieFab();
renderModeBanner(document.getElementById("banner-area"));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diffDays(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

function addDaysStr(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Build basic cycle stats from logs using the same cluster logic as calendar.js.
 * Returns cycleStarts, dayInCycle, avgCycleLength = no phase/confidence (those come from runFullPrediction).
 */
function buildCycleBase(logsByDate) {
  const periodDays = Object.keys(logsByDate)
    .filter(k => logsByDate[k]?.flow && logsByDate[k].flow !== "none")
    .sort();

  const cycleStarts = [];
  let prevDate = null;
  for (const day of periodDays) {
    if (!prevDate || diffDays(prevDate, day) > 3) cycleStarts.push(day);
    prevDate = day;
  }

  const lastStart = cycleStarts.length ? cycleStarts[cycleStarts.length - 1] : null;
  const dayInCycle = lastStart ? (diffDays(lastStart, toDateKey(new Date())) + 1) : null;

  const lengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    lengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }
  const avgCycleLength = lengths.length
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : null;

  return {
    cycleStarts,
    dayInCycle,
    avgCycleLength,
    phase: "unknown",
    confidence: "low",
    nextPeriodDate: null,
    fertileStart: null,
    fertileEnd: null,
    ovulationDate: null,
  };
}

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

// ─── Phase-based insights ─────────────────────────────────────────────────────

// Phase insights are now provided by phase-education.js (getTodaysPhaseInsight)

function getGoalTip(goal, phase) {
  const map = {
    ttc: {
      ovulation:  { t: "Prime conception timing", d: "You are near your estimated fertile window. Conception likelihood is highest in the 5 days before and on ovulation day." },
      follicular: { t: "Fertile window approaching", d: "Ovulation is estimated in the coming days. Track discharge and temperature changes." },
      luteal:     { t: "Testing window", d: "If conception occurred, the earliest pregnancy tests may detect hCG around 10–14 days post-ovulation." },
      menstrual:  { t: "New cycle", d: "The fertile window is expected again in approximately 1–2 weeks." },
    },
    pregnancy: {
      default: { t: "Pregnancy mode active", d: "Update LMP date in profile for accurate due date tracking." },
    },
    perimenopause: {
      default: { t: "Perimenopause tracking", d: "Cycle irregularity is common. Log what you experience - your pattern matters more than a standard model." },
    },
  };
  const g = map[goal];
  if (!g) return null;
  return g[phase] ?? g.default ?? null;
}

function setTodayInsights(phaseKey, goal, phaseLabel, loggedSymptoms = []) {
  const box = document.getElementById("insights");
  if (!box) return;

  // Resolve sub-phase: Late Luteal has its own education variants
  let resolvedKey = phaseKey;
  if (phaseLabel === "Late Luteal" || phaseKey === "late_luteal") {
    resolvedKey = "late_luteal";
  }

  // Pick 3 symptom-relevant education variants for today
  const insights = getTodaysPhaseInsights({ phase: resolvedKey, loggedSymptoms, count: 3 });
  const items = insights.map(i => ({ t: i.title, d: i.body }));

  // Prepend goal-specific tip when available
  const tip = getGoalTip(goal, resolvedKey) || getGoalTip(goal, phaseKey);
  if (tip) items.unshift(tip);

  box.innerHTML = items.map((i, idx) => `
    <div style="display:flex;gap:0.65rem;align-items:flex-start;padding:0.65rem 0;${idx > 0 ? "border-top:1px solid var(--color-border);" : ""}">
      <div>
        <strong style="color:var(--color-primary-dark);font-size:0.9rem;display:block;margin-bottom:0.2rem;">${i.t}</strong>
        <span style="font-size:0.875rem;color:var(--color-text-muted);line-height:1.55;">${i.d}</span>
      </div>
    </div>`).join("");
}

// ─── Phase card with colour badge ────────────────────────────────────────────

function renderPhaseCard(cycle) {
  const el = document.getElementById("cycle-phase");
  if (!el) return;

  const rawPhase = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : "unknown";
  // Resolve late_luteal from phaseLabel if available
  const isLateLuteal = cycle.phaseLabel === "Late Luteal";
  const key = isLateLuteal ? "late_luteal" : rawPhase;
  // Map internal phase keys → CSS class names (both must use the same class names)
  const CSS_MAP = { menstrual:"menstrual", follicular:"follicular", ovulation:"ovulation",
    ovulatory:"ovulation", luteal:"luteal", late_luteal:"luteal" };
  const cssKey = CSS_MAP[key] ?? "unknown";
  const PHASE_LABELS = { menstrual:"Menstrual", follicular:"Follicular", ovulatory:"Ovulatory",
    ovulation:"Ovulatory", luteal:"Luteal", late_luteal:"Late Luteal", unknown:"Calculating" };
  const label = PHASE_LABELS[key] ?? cycle.phaseLabel ?? "Unknown";

  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.justifyContent = "space-between";

  const isLocal = cycle.source === "local";
  const confNote = isLocal
    ? `<p class="card-estimate-note" style="text-align:center;margin:0.25rem 0 0;color:var(--color-text-muted);">Low confidence · rule-based estimate · log more cycles for ML accuracy</p>`
    : "";

  if (rawPhase !== "unknown") {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:0.75rem 0;gap:0.35rem;">
        <span class="phase-badge phase-${cssKey}">
          <span class="phase-dot"></span>${label} Phase
        </span>
        <p class="card-estimate-note" style="text-align:center;margin:0;">Estimated from your logged data · not medical advice</p>
        ${confNote}
      </div>
    `;
  } else {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:0.75rem 0;gap:0.35rem;">
        <span class="phase-badge phase-unknown">Calculating Phase</span>
        <p class="card-estimate-note" style="text-align:center;margin:0;">Log a period day to see your current phase.</p>
      </div>
    `;
  }
}

// ─── Goal tool card ───────────────────────────────────────────────────────────

function renderGoalToolCard(goal, cycle) {
  const el = document.getElementById("goal-tool");
  if (!el) return;
  const todayKey = toDateKey(new Date());

  if (goal === "no_period" || goal === "perimenopause") {
    el.innerHTML = `
      <div class="stat-number" style="font-size:1.2rem;">Symptom Mode</div>
      <p class="text-muted">Period predictions paused. Log symptoms freely.</p>
      <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;display:inline-block;">Log today</a>
    `;
    return;
  }

  if (goal === "ttc") {
    if (cycle.fertileStart && cycle.fertileEnd) {
      el.innerHTML = `
        <div class="stat-number" style="font-size:1.15rem;">Conception Window</div>
        <p class="text-muted" style="margin-top:0.25rem;">${formatDate(cycle.fertileStart)} → ${formatDate(cycle.fertileEnd)}</p>
      `;
    } else {
      el.innerHTML = `
        <div class="stat-number">Conception Window</div>
        <p class="text-muted">Log more period days to estimate the window.</p>
        <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;display:inline-block;">Open calendar</a>
      `;
    }
    return;
  }

  if (goal === "pregnancy") {
    const lmp = localStorage.getItem("bloom_lmp");
    if (lmp && algoPregnancy) {
      try {
        const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
        const r = algoPregnancy.estimatedDueDate(new Date(lmp), Number(profile.avgCycleLength) || 28);
        if (r.currentWeek) {
          el.innerHTML = `
            <div class="stat-number" style="font-size:1.3rem;">Week ${r.currentWeek}</div>
            <p class="text-muted" style="margin-top:0.25rem;">${r.trimesterLabel} · EDD ${formatDate(toDateKey(r.eddAdjusted))}</p>
          `;
          return;
        }
      } catch (_) {}
    }
    el.innerHTML = `
      <div class="stat-number">Track Pregnancy</div>
      <p class="text-muted">Add LMP date in profile to calculate due date.</p>
      <a class="btn btn-outline" href="/pages/profile-view.html" style="margin-top:0.5rem;display:inline-block;">Update profile</a>
    `;
    return;
  }

  // Default: next period
  if (cycle.nextPeriodDate) {
    const d = diffDays(todayKey, cycle.nextPeriodDate);
    el.innerHTML = `
      <div class="stat-number">${formatDate(cycle.nextPeriodDate)}</div>
      <p class="text-muted" style="margin-top:0.25rem;">Next expected period${d >= 0 ? ` · in ${d} day${d !== 1 ? "s" : ""}` : " · may have started"}</p>
    `;
  } else {
    el.innerHTML = `
      <div class="stat-number">Next Period</div>
      <p class="text-muted">Log more period days to generate a prediction.</p>
    `;
  }
}

// ─── TTC section ──────────────────────────────────────────────────────────────

function renderTtcTools(goal, cycle) {
  const card = document.getElementById("ttc-tools");
  const body = document.getElementById("ttc-tools-body");
  const insightsCard = document.getElementById("fertility-insights-card");
  const insightsBody = document.getElementById("fertility-insights-body");
  if (!card || !body) return;

  show(card, goal === "ttc");
  if (insightsCard) show(insightsCard, goal === "ttc");
  if (goal !== "ttc") return;

  const todayKey = toDateKey(new Date());

  // Fertility confidence from algorithm
  let algoConf = null; // { confidence, message } from pregnancyAlgorithm
  if (algoPregnancy && cycle.cycleStarts?.length >= 2) {
    try {
      const starts = cycle.cycleStarts.map((s) => new Date(s + "T00:00:00"));
      const lengths = [];
      for (let i = 1; i < starts.length; i++) {
        lengths.push(Math.round((starts[i] - starts[i - 1]) / 86400000));
      }
      const ovDay = cycle.ovulationDate ? new Date(cycle.ovulationDate + "T00:00:00") : null;
      if (ovDay) {
        algoConf = algoPregnancy.fertilityConfidence(lengths, ovDay);
      }
    } catch (_) {}
  }

  // Conception window
  const windowHtml = cycle.fertileStart && cycle.fertileEnd
    ? `${formatDate(cycle.fertileStart)} → ${formatDate(cycle.fertileEnd)}`
    : "Log more period days to estimate the window.";

  // When to test
  let testHtml = "";
  if (algoPregnancy && cycle.ovulationDate && cycle.nextPeriodDate) {
    try {
      const r = algoPregnancy.whenToTest(
        new Date(cycle.ovulationDate + "T00:00:00"),
        new Date(cycle.nextPeriodDate + "T00:00:00")
      );
      testHtml = `
        <div class="insight-item">
          <strong>When to test:</strong> ${r.message}
          <span class="text-muted" style="font-size:0.85rem;display:block;margin-top:0.2rem;">${r.retestMessage}</span>
        </div>`;
    } catch (_) {}
  }
  if (!testHtml) {
    if (cycle.nextPeriodDate) {
      const d = diffDays(todayKey, cycle.nextPeriodDate);
      testHtml = `<div class="insight-item"><strong>When to test:</strong> Best accuracy is usually the day after a missed period. Next expected period: ${formatDate(cycle.nextPeriodDate)} (~${d} day${d !== 1 ? "s" : ""}).</div>`;
    } else {
      testHtml = `<div class="insight-item"><strong>When to test:</strong> Log more period days to estimate testing guidance.</div>`;
    }
  }

  body.innerHTML = `
    <div class="insight-item"><strong>Conception Window:</strong> ${windowHtml}</div>
    ${testHtml}
    <p class="form-hint" style="margin-top:.75rem;">Educational estimates only. Not medical advice.</p>
  `;

  // ── Fertility Insights card ──────────────────────────────────────────────────
  if (insightsBody) {
    // Prefer the algorithm result; fall back to cycle engine's confidence label
    const label = algoConf?.confidence
      ?? (cycle?.confidence ? cycle.confidence.charAt(0).toUpperCase() + cycle.confidence.slice(1) : "Low");
    const cls  = label === "High" ? "conf-high" : label === "Medium" ? "conf-medium" : "conf-low";
    const desc = algoConf?.message
      ?? (label === "High"
        ? "Based on consistent cycle history and enough logged data."
        : label === "Medium"
        ? "Some history is available, but more logs will improve reliability."
        : "Limited or irregular data. Keep logging for better estimates.");

    insightsBody.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.6rem;">
        <span class="fertility-conf ${cls}" style="font-size:1.35rem;font-weight:800;padding:0.3rem 0.85rem;border-radius:8px;">${label}</span>
        <span class="text-muted" style="font-size:0.9rem;">${desc}</span>
      </div>
      <p class="form-hint">Educational estimate only. Log more cycles to improve confidence.</p>
      <a href="/pages/fertility.html" class="btn btn-outline" style="margin-top:0.6rem;display:inline-block;font-size:0.88rem;">
        View full fertility details →
      </a>
    `;
  }
}

// ─── Pregnancy section ────────────────────────────────────────────────────────

const BABY_SIZES = [
  null, null, null, null,
  { label: "orange pip",       emoji: "🟠" }, // 4
  { label: "sesame seed",      emoji: "🌱" }, // 5
  { label: "sweet pea",        emoji: "🫛" }, // 6
  { label: "blueberry",        emoji: "🫐" }, // 7
  { label: "kidney bean",      emoji: "🫘" }, // 8
  { label: "grape",            emoji: "🍇" }, // 9
  { label: "kumquat",          emoji: "🟡" }, // 10
  { label: "fig",              emoji: "🍈" }, // 11
  { label: "lime",             emoji: "🍋" }, // 12
  { label: "lemon",            emoji: "🍋" }, // 13
  { label: "peach",            emoji: "🍑" }, // 14
  { label: "apple",            emoji: "🍎" }, // 15
  { label: "avocado",          emoji: "🥑" }, // 16
  { label: "pear",             emoji: "🍐" }, // 17
  { label: "bell pepper",      emoji: "🫑" }, // 18
  { label: "mango",            emoji: "🥭" }, // 19
  { label: "banana",           emoji: "🍌" }, // 20
  { label: "carrot",           emoji: "🥕" }, // 21
  { label: "papaya",           emoji: "🍈" }, // 22
  { label: "large mango",      emoji: "🥭" }, // 23
  { label: "corn",             emoji: "🌽" }, // 24
  { label: "cauliflower",      emoji: "🥦" }, // 25
  { label: "scallion bunch",   emoji: "🌿" }, // 26
  { label: "head of lettuce",  emoji: "🥬" }, // 27
  { label: "eggplant",         emoji: "🍆" }, // 28
  { label: "butternut squash", emoji: "🎃" }, // 29
  { label: "cabbage",          emoji: "🥬" }, // 30
  { label: "coconut",          emoji: "🥥" }, // 31
  { label: "pumpkin",          emoji: "🎃" }, // 32
  { label: "pineapple",        emoji: "🍍" }, // 33
  { label: "cantaloupe",       emoji: "🍈" }, // 34
  { label: "honeydew melon",   emoji: "🍈" }, // 35
  { label: "breadfruit",       emoji: "🟤" }, // 36
  { label: "swiss chard",      emoji: "🌿" }, // 37
  { label: "leek",             emoji: "🌱" }, // 38
  { label: "small watermelon", emoji: "🍉" }, // 39
  { label: "watermelon",       emoji: "🍉" }, // 40
];

function renderPregnancyTools(goal) {
  const card = document.getElementById("pregnancy-tools");
  const body = document.getElementById("pregnancy-tools-body");
  if (!card || !body) return;

  show(card, goal === "pregnancy");
  if (goal !== "pregnancy") return;

  const lmp = localStorage.getItem("bloom_lmp");

  if (!lmp || !algoPregnancy) {
    body.innerHTML = `
      <p class="text-muted">Add your last menstrual period (LMP) date in your profile to see your due date, trimester, and weekly milestones.</p>
      <a class="btn btn-primary" href="/pages/profile-view.html" style="margin-top:0.75rem;display:inline-block;">Add LMP date</a>
      <p class="form-hint" style="margin-top:0.75rem;">Educational support only. Not medical advice.</p>
    `;
    return;
  }

  try {
    const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
    const cycleLen = Number(profile?.avgCycleLength ?? 28);
    const r = algoPregnancy.estimatedDueDate(new Date(lmp), cycleLen);
    const week = r.currentWeek;
    const size = week >= 4 && week <= 40 ? BABY_SIZES[week] : null;

    body.innerHTML = `
      ${size ? `
        <div class="baby-size-display">
          <div class="baby-size-emoji">${size.emoji}</div>
          <div class="baby-size-label">Your baby is the size of a ${size.label}</div>
          <div class="baby-size-week">Week ${week}</div>
        </div>` : ""}
      <div class="insight-item"><strong>EDD:</strong> ${formatDate(toDateKey(r.eddAdjusted))}${cycleLen !== 28 ? ` <span class="text-muted">(adjusted for ${cycleLen}-day cycle)</span>` : ""}</div>
      <div class="insight-item"><strong>Trimester:</strong> ${r.trimesterLabel ?? "-"} &bull; <strong>Week:</strong> ${week ?? "-"} &bull; <strong>Weeks remaining:</strong> ${r.weeksRemaining ?? "-"}</div>
      <p class="form-hint" style="margin-top:.75rem;">Educational estimate based on your LMP. Always confirm with your healthcare provider.</p>
    `;
  } catch (_) {
    body.innerHTML = `<p class="text-muted">Could not calculate due date. Check your LMP date in your profile.</p>`;
  }
}

// ─── Symptom section ──────────────────────────────────────────────────────────

function renderSymptomTools(goal, logsByDate) {
  const card = document.getElementById("symptom-tools");
  const body = document.getElementById("symptom-tools-body");
  if (!card || !body) return;

  const on = goal === "no_period" || goal === "perimenopause";
  show(card, on);
  if (!on) return;

  const entries = Object.entries(logsByDate || {})
    .filter(([, v]) => v?.symptoms?.length)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 5);

  if (!entries.length) {
    body.innerHTML = `
      <p class="text-muted">No symptom logs recorded. Open Calendar to log symptoms.</p>
      <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;display:inline-block;">Open calendar</a>
    `;
    return;
  }

  body.innerHTML = entries
    .map(([date, v]) => {
      const sym = v.symptoms.slice(0, 4).join(", ");
      const more = v.symptoms.length > 4 ? ` +${v.symptoms.length - 4} more` : "";
      return `<div class="insight-item"><strong>${formatDate(date)}:</strong> ${sym}${more}</div>`;
    })
    .join("");
}

// ─── Cycle history + trend chart ──────────────────────────────────────────────

// Returns an array of card HTML strings (most recent first)
function buildCycleCards(cycleStarts, cycleLengths, logsByDate) {
  const todayKey = toDateKey(new Date());

  return [...cycleStarts].reverse().map((start, revIdx) => {
    const i = cycleStarts.length - 1 - revIdx;
    const cycleLen = cycleLengths[i];
    const isCurrent = cycleLen == null;
    const nextStart = isCurrent ? null : cycleStarts[i + 1];
    const cycleEndKey = nextStart ? addDaysStr(nextStart, -1) : todayKey;

    // Compute phase boundaries for this cycle
    const ovulationKey    = nextStart ? addDaysStr(nextStart, -14) : null;
    const fertileStartKey = nextStart ? addDaysStr(nextStart, -19) : null;
    const fertileEndKey   = nextStart ? addDaysStr(nextStart, -13) : null;

    // Build dot array (cap at 40 for display)
    const displayLen = Math.min(cycleLen ?? (diffDays(start, todayKey) + 1), 40);
    const dots = [];
    for (let d = 0; d < displayLen; d++) {
      const dk = addDaysStr(start, d);
      const log = logsByDate[dk];
      const isPeriod = !!(log && log.flow && log.flow !== "none");
      let cls = "dot-follicular"; // default: follicular phase
      if (isPeriod) {
        cls = "dot-period";
      } else if (ovulationKey && dk === ovulationKey) {
        cls = "dot-ovulation";
      } else if (fertileStartKey && dk >= fertileStartKey && dk <= fertileEndKey) {
        cls = "dot-fertile";
      } else if (ovulationKey && dk > ovulationKey) {
        cls = "dot-luteal"; // after ovulation until next period
      }
      dots.push(`<span class="cycle-dot-item ${cls}" title="${dk}"></span>`);
    }

    const daysSoFar = diffDays(start, todayKey) + 1;
    const title    = isCurrent ? `Current cycle: ${daysSoFar} days` : `${cycleLen} days`;
    const subtitle = `${formatDate(start)} – ${isCurrent ? "present" : formatDate(cycleEndKey)}`;

    const nextParam = nextStart ? `&next=${nextStart}` : "";
    return `
      <div class="cycle-card cycle-card--clickable" role="button" tabindex="0"
           onclick="window.location.href='/pages/cycle-detail.html?start=${start}${nextParam}'"
           onkeydown="if(event.key==='Enter')window.location.href='/pages/cycle-detail.html?start=${start}${nextParam}'">
        <span class="cycle-card-title">${title}</span>
        <span class="cycle-card-subtitle">${subtitle}</span>
        <div class="cycle-dot-row">${dots.join("")}</div>
        <span class="cycle-card-arrow">›</span>
      </div>`;
  });
}

function renderCycleHistoryAndChart(cycle, logsByDate) {
  const cycleStarts = cycle.cycleStarts || [];
  const dotsEl = document.getElementById("cycle-dots");
  const canvas = document.getElementById("cycleChart");

  // Compute cycle lengths (days between consecutive period starts)
  const cycleLengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    cycleLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }

  // ── Dot-based cycle history ──
  if (dotsEl) {
    if (!cycleStarts.length) {
      dotsEl.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">No periods logged. Open Calendar to begin tracking.</p>`;
    } else {
      const legend = `
        <div class="cycle-legend">
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-period"></span>Period</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-fertile"></span>Fertile</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-ovulation"></span>Ovulation</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-follicular"></span>Follicular</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-luteal"></span>Luteal</span>
        </div>`;

      const INITIAL_SHOW = 4;
      const cardHTMLs = buildCycleCards(cycleStarts, cycleLengths, logsByDate);
      const visible = cardHTMLs.slice(0, INITIAL_SHOW);
      const extra   = cardHTMLs.slice(INITIAL_SHOW);

      let historyHTML = legend + visible.join("");
      if (extra.length) {
        historyHTML += `<div id="cycle-history-extra" class="hidden">${extra.join("")}</div>`;
        historyHTML += `<button type="button" id="show-more-cycles" class="btn btn-outline" style="margin-top:0.75rem;width:100%;">
          Show ${extra.length} more cycle${extra.length !== 1 ? "s" : ""}
        </button>`;
      }

      dotsEl.innerHTML = historyHTML;

      const moreBtn = document.getElementById("show-more-cycles");
      if (moreBtn) {
        moreBtn.onclick = () => {
          document.getElementById("cycle-history-extra").classList.remove("hidden");
          moreBtn.remove();
        };
      }
    }
  }

  // ── Trend chart (Plotly) ──
  if (!canvas) return;

  if (cycleLengths.length < 1) {
    canvas.closest(".chart-frame").innerHTML =
      `<p class="text-muted" style="font-size:0.9rem;text-align:center;padding:1.25rem 0;">Log at least 2 periods to view the cycle trend.</p>`;
    return;
  }

  const avg = Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length);
  const labels = cycleStarts.slice(0, -1).map((s) => formatDate(s));
  const yPad = 6;
  const yMin = Math.max(0, Math.min(...cycleLengths) - yPad);
  const yMax = Math.max(...cycleLengths) + yPad;

  // Marker colours: red if outside typical 21–35 day range
  const markerColors = cycleLengths.map((l) => (l < 21 || l > 35 ? "#e05c7a" : "#D4749A"));

  Plotly.newPlot(canvas, [
    // ── Typical range ribbon (21–35 days) ──
    {
      x: labels,
      y: Array(labels.length).fill(35),
      type: "scatter",
      mode: "none",
      showlegend: false,
      hoverinfo: "skip",
    },
    {
      x: labels,
      y: Array(labels.length).fill(21),
      type: "scatter",
      mode: "none",
      fill: "tonexty",
      fillcolor: "rgba(180,160,210,0.09)",
      name: "Typical range (21–35d)",
      hoverinfo: "skip",
    },
    // ── Average line ──
    {
      x: labels,
      y: Array(cycleLengths.length).fill(avg),
      type: "scatter",
      mode: "lines",
      name: `Avg: ${avg}d`,
      line: { color: "#B85C82", dash: "dot", width: 1.8 },
      hoverinfo: "skip",
    },
    // ── Cycle length line ──
    {
      x: labels,
      y: cycleLengths,
      type: "scatter",
      mode: "lines+markers",
      name: "Cycle length",
      line: { color: "#D4749A", width: 3, shape: "spline", smoothing: 1.1 },
      marker: {
        color: markerColors,
        size: 10,
        line: { color: "#fff", width: 2.5 },
      },
      hovertemplate: "<b>%{x}</b><br><b>%{y} days</b><extra></extra>",
    },
  ], {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 14, r: 16, b: 72, l: 48 },
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.28,
      x: 0,
      xanchor: "left",
      font: { family: "Nunito, sans-serif", size: 11 },
      bgcolor: "transparent",
    },
    yaxis: {
      range: [yMin, yMax],
      gridcolor: "rgba(0,0,0,0.06)",
      zeroline: false,
      tickfont: { family: "Nunito, sans-serif", size: 11 },
      ticksuffix: "d",
      automargin: true,
      autorange: false,
    },
    xaxis: {
      showgrid: false,
      tickfont: { family: "Nunito, sans-serif", size: 11 },
      tickangle: -30,
      automargin: true,
    },
    hovermode: "closest",
    annotations: [{
      x: labels[labels.length - 1],
      y: avg,
      xanchor: "right",
      yanchor: "bottom",
      text: `avg ${avg}d`,
      showarrow: false,
      font: { size: 10, color: "#B85C82", family: "Nunito, sans-serif" },
      yshift: 5,
    }],
  }, {
    responsive: true,
    displayModeBar: false,
  });
}

// ─── PDF export ───────────────────────────────────────────────────────────────
// Full report generation lives in report.js / pdf-report-data.js.
// The dashboard button navigates there so all PDF logic stays in one place.

// ─── Algorithm-powered advanced insights ─────────────────────────────────────

function signalLabel(code) {
  return {
    // Cycle engine
    EXTENDED_ABSENCE:             "Extended gap since last period",
    MISSED_PERIOD:                "Period may be late",
    LATE_PERIOD:                  "Period seems late",
    IRREGULAR_CYCLE:              "Irregular pattern detected",
    LOW_PREDICTION_CONFIDENCE:    "Prediction confidence low",
    LOGGING_GAP:                  "Logging gap",
    PREDICTION_DRIFT:             "Prediction updated",
    SHORTENING_CYCLE_TREND:       "Shortening cycle trend",
    LENGTHENING_CYCLE_TREND:      "Lengthening cycle trend",
    SUDDEN_CYCLE_SHIFT:           "Sudden cycle shift",
    SHORT_CYCLE:                  "Short cycle noted",
    LONG_CYCLE:                   "Long cycle noted",
    // Anomaly engine
    CYCLE_LENGTH_ANOMALY:         "Unusual cycle timing",
    RESIDUAL_DRIFT:               "Cycle pattern shifting",
    DEVIATION_CLUSTER:            "Repeated off-pattern cycles",
    HIGH_CYCLE_VARIABILITY:       "High cycle variability",
    // Symptom engine
    SEEK_URGENT_CARE:             "Urgent = seek medical care",
    URGENT_SYMPTOM_COMBINATION:   "Concerning symptom combination",
    HEAVY_BLEEDING_FLAG:          "Heavy bleeding flagged",
    SEVERE_PAIN_FLAG:             "Severe pain flagged",
    PHASE_UNEXPECTED_SYMPTOMS:    "Unusual symptoms for this phase",
    PMS_CLUSTER_DETECTED:         "PMS pattern detected",
    PERIMENOPAUSE_PATTERN:        "Perimenopause pattern",
    PREGNANCY_TEST_TIMING_RELEVANT: "Pregnancy test timing relevant",
    HORMONAL_PATTERN_POSSIBLE:    "Hormonal pattern possible",
  }[code] || code.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function renderAdvancedInsights(advancedEl, { cycle, cycleLengths, lastPeriodStart, lastLogDate, logsByDate, mlPredictedCycleLength }) {
  if (!advancedEl) return;

  const today = new Date();
  const signals = [];

  const nextWindow = cycle.nextPeriodDate ? {
    start: new Date(cycle.nextPeriodDate + "T00:00:00"),
    end:   new Date(addDaysStr(cycle.nextPeriodDate, 5) + "T00:00:00"),
  } : null;

  const lastPeriodDate = lastPeriodStart ? new Date(lastPeriodStart + "T00:00:00") : null;
  const lastLogDateObj = lastLogDate     ? new Date(lastLogDate     + "T00:00:00") : null;

  // ── 1. Cycle Engine (bloom-cycle-engine.js) ───────────────────────────────
  // Detects: late period, irregular cycles, logging gaps, cycle trends, etc.
  if (algoCycleEngine) {
    try {
      const cycleSignals = algoCycleEngine.generateCycleSignals({
        expectedNextPeriodWindow: nextWindow,
        today,
        lastPeriodStart: lastPeriodDate,
        lastLogDate:     lastLogDateObj,
        cycleLengths,
      });
      signals.push(...cycleSignals);
    } catch (_) {}
  }

  // ── 2. Anomaly Engine (bloom-anomaly-engine.js) ───────────────────────────
  // Detects: point anomalies, drift, deviation clusters, high variability
  if (algoAnomalyEngine && cycleLengths.length >= 4) {
    try {
      const anomalyResult = algoAnomalyEngine.generateAnomalySignals({
        actualCycleLengths:   cycleLengths,
        predictedCycleLength: mlPredictedCycleLength,
      });
      signals.push(...(anomalyResult.shownSignals || []));
    } catch (_) {}
  }

  // ── 3. Symptom Engine (bloom-symptom-engine.js) ───────────────────────────
  // Detects: phase mismatches, PMS clusters, perimenopause patterns, urgent symptoms
  if (algoSymptomEngine && logsByDate) {
    try {
      const todayKey = toDateKey(today);
      const todayLog = logsByDate[todayKey] || {};
      const rawSymptoms = todayLog.symptoms || [];

      // Build loggedSymptoms in the shape the engine expects: [{code, severity}]
      const loggedSymptoms = rawSymptoms.map(code => ({
        code,
        severity: todayLog.symptomSeverity?.[code] ?? 3,
      }));

      // Build symptomHistory from the last 90 days of logs
      const symptomHistory = Object.entries(logsByDate)
        .filter(([, l]) => l?.symptoms?.length)
        .map(([dateKey, l]) => ({
          dateKey,
          symptoms: (l.symptoms || []).map(code => ({
            code,
            severity: l.symptomSeverity?.[code] ?? 3,
          })),
        }))
        .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

      const symptomSignals = algoSymptomEngine.generateSymptomSignals({
        loggedSymptoms,
        phase:          cycle.phase,
        dayOfCycle:     cycle.dayInCycle,
        cycleLengths,
        cycleCount:     (cycle.cycleStarts || []).length,
        symptomHistory,
        lastPeriodStart: lastPeriodDate,
        today,
      });
      signals.push(...symptomSignals);
    } catch (_) {}
  }

  // ── Basic avg-cycle outlier flags ──
  if (cycle.avgCycleLength && cycle.avgCycleLength < 21 && !signals.some(s => s.code === "SHORT_CYCLE")) {
    signals.push({ code: "SHORT_CYCLE", level: "medium", show: true, message: "Your average cycle is shorter than 21 days. This may be worth discussing with a healthcare provider." });
  }
  if (cycle.avgCycleLength && cycle.avgCycleLength > 35 && !signals.some(s => s.code === "LONG_CYCLE")) {
    signals.push({ code: "LONG_CYCLE", level: "medium", show: true, message: "Your average cycle is longer than 35 days. This can be worth monitoring with a provider." });
  }

  if (!signals.length) {
    advancedEl.innerHTML = `<div class="insight-item">No unusual patterns detected. Keep logging for more detailed insights.</div>`;
    return;
  }

  // Sort: high → medium → low, deduplicate by code
  const seen = new Set();
  const pri = { high: 3, medium: 2, low: 1 };
  const deduped = signals
    .filter(s => { if (seen.has(s.code)) return false; seen.add(s.code); return true; })
    .sort((a, b) => (pri[b.level] || 0) - (pri[a.level] || 0));

  advancedEl.innerHTML = deduped.map(s => {
    const label = signalLabel(s.code);
    const guidance = s.guidance ? ` ${s.guidance}` : "";
    if (s.level === "high") {
      return `
        <div style="
          background: #fff8e7;
          border: 1px solid #f5c842;
          border-left: 3px solid #f59e0b;
          border-radius: 10px;
          padding: 0.75rem 1rem;
          margin-bottom: 0.75rem;
        ">
          <div style="font-weight:800;font-size:0.88rem;color:#92600a;margin-bottom:0.3rem;">⚠️ ${label}</div>
          <div style="font-size:0.88rem;color:#555;line-height:1.55;">${s.message}${guidance} Consider speaking to a healthcare provider.</div>
        </div>`;
    }
    return `<div class="insight-item"><strong>${label}:</strong> ${s.message}${guidance}</div>`;
  }).join("") + `<p class="form-hint" style="margin-top:0.75rem;">Pattern-based signals only. Not medical diagnoses.</p>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadDashboard() {
  // Load algorithm modules lazily = all in parallel
  [algoPregnancy, algoCycleEngine, algoSymptomEngine, algoAnomalyEngine] =
    await Promise.all([
      import("./algorithms/pregnancyAlgorithm.js").catch(() => null),
      import("./algorithms/bloom-cycle-engine.js").catch(() => null),
      import("./algorithms/bloom-symptom-engine.js").catch(() => null),
      import("./algorithms/bloom-anomaly-engine.js").catch(() => null),
    ]);

  const logsByDate = await getAllLogs();
  const goal = getUserGoal();
  const cycle = buildCycleBase(logsByDate);

  // Derived cycle history
  const cycleStarts = cycle.cycleStarts || [];
  const cycleLengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    cycleLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }
  const lastPeriodStart = cycleStarts.length ? cycleStarts[cycleStarts.length - 1] : null;

  // ── Cycle state: backend when signed in, local rule-based otherwise ──────────
  // fetchCycleState always returns at least a local estimate when period data exists,
  // so the dashboard degrades gracefully to a low-confidence prediction rather than
  // showing nothing when the backend is unavailable or the user is in anon mode.
  let predictedCycleLength = null;
  if (lastPeriodStart) {
    _cycleStatePromise = fetchCycleState(logsByDate);
    const state = await _cycleStatePromise;
    if (state?.ready) {
      cycle.phase          = state.phase          ?? cycle.phase;
      cycle.phaseLabel     = state.phaseLabel      ?? null;
      cycle.source         = state.source          ?? "backend";
      // confidence may be an object {level,message} (local) or a string (old path)
      const confLevel = typeof state.confidence === "object"
        ? state.confidence?.level?.toLowerCase()
        : state.confidence;
      cycle.confidence     = confLevel             ?? cycle.confidence;
      cycle.dayInCycle     = state.dayInCycle      ?? cycle.dayInCycle;
      cycle.avgCycleLength = state.avgCycleLength  ?? cycle.avgCycleLength;
      predictedCycleLength = state.predictedCycleLength ?? null;
      if (state.nextPeriodDate) cycle.nextPeriodDate = state.nextPeriodDate;
      if (state.ovulationDate)  cycle.ovulationDate  = state.ovulationDate;
      if (state.fertileStart)   cycle.fertileStart   = state.fertileStart;
      if (state.fertileEnd)     cycle.fertileEnd     = state.fertileEnd;
      if (state.source === "local") {
        console.log("[dashboard] using local fallback state = backend unavailable or anon mode");
      }
    }
  }

  const allLogDates = Object.keys(logsByDate)
    .filter(k => { const l = logsByDate[k]; return l?.flow || l?.symptoms?.length || l?.notes; })
    .sort();
  const lastLogDate = allLogDates.length ? allLogDates[allLogDates.length - 1] : null;

  const goalBadge = document.getElementById("goal-badge");
  const goalDescEl = document.getElementById("goal-desc");
  if (goalBadge) goalBadge.textContent = goalLabel(goal);
  if (goalDescEl) goalDescEl.textContent = goalDesc(goal);

  // Cycle snapshot
  const snapshotEl = document.getElementById("cycle-snapshot");
  if (snapshotEl) {
    if (cycle.dayInCycle) {
      const confNorm = (cycle.confidence || "low").toLowerCase();
      const confCls = confNorm === "high" ? "conf-high" : confNorm === "medium" ? "conf-medium" : "conf-low";
      const confLabel = confNorm.charAt(0).toUpperCase() + confNorm.slice(1);
      snapshotEl.innerHTML = `
        <div class="stat-number">Day ${cycle.dayInCycle}</div>
        <p class="muted-line">
          ${cycle.avgCycleLength ? `Avg cycle: ${cycle.avgCycleLength} days` : "Log more cycles to improve accuracy"}
          &nbsp;·&nbsp;<span class="fertility-conf ${confCls}">${confLabel} confidence</span>
        </p>
      `;
    } else {
      snapshotEl.innerHTML = `
        <div class="stat-number">-</div>
        <p class="text-muted">Log a period day in Calendar to view your cycle day.</p>
      `;
    }
  }

  renderPhaseCard(cycle);
  renderGoalToolCard(goal, cycle);
  renderTtcTools(goal, cycle);
  renderPregnancyTools(goal);
  renderSymptomTools(goal, logsByDate);
  renderCycleHistoryAndChart(cycle, logsByDate);

  // Append unified estimate note to the three top cards (always last)
  ["cycle-snapshot", "goal-tool"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Remove any pre-existing note so it's not duplicated on re-render
    el.querySelectorAll(".card-estimate-note").forEach(n => n.remove());
    const note = document.createElement("p");
    note.className = "card-estimate-note";
    note.textContent = "Estimated from your logged data · not medical advice";
    el.appendChild(note);
  });

  // Anon mode: hide advanced features
  if (isAnonMode()) {
    const advCard = document.getElementById("advanced-insights")?.closest(".card");
    if (advCard) {
      advCard.innerHTML = `
        <div style="text-align:center;padding:1.5rem 1rem;">
          <div style="font-size:1.5rem;margin-bottom:0.5rem;">🔒</div>
          <p style="font-weight:700;color:var(--color-primary-dark);margin:0 0 0.35rem;">Advanced Insights</p>
          <p style="font-size:0.88rem;color:var(--color-text-muted);margin:0 0 1rem;">Create a free account to unlock cycle predictions, personalised insights, and health reports.</p>
          <a href="/pages/register.html" class="btn btn-primary btn-sm">Create account</a>
        </div>`;
    }
    const pdfBtn = document.getElementById("export-pdf");
    if (pdfBtn) pdfBtn.style.display = "none";
  }

  // PDF export - generate and download directly without leaving the page
  const pdfBtn = document.getElementById("export-pdf");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", async () => {
      pdfBtn.disabled = true;
      const prev = pdfBtn.textContent;
      pdfBtn.textContent = "Generating…";
      try {
        const [{ generatePDF }, { buildReportData }] = await Promise.all([
          import("./pdf-generator.js"),
          import("./pdf-report-data.js"),
        ]);
        const userName = localStorage.getItem("bloom_user_name") ?? null;
        const data = buildReportData(logsByDate, cycle, userName);
        if (!data.cyclesTracked) {
          alert("No cycle history yet. Log period days in the Calendar first.");
          return;
        }
        generatePDF(data);
      } catch (e) {
        console.error("[export-pdf]", e);
        alert("Could not generate PDF. Please try again.");
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.textContent = prev;
      }
    });
  }

  const phaseKey = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : "unknown";
  const todaySymptoms = (logsByDate[toDateKey(new Date())]?.symptoms) || [];
  setTodayInsights(phaseKey, goal, cycle.phaseLabel, todaySymptoms);

  // Advanced insights (algorithm-powered)
  renderAdvancedInsights(document.getElementById("advanced-insights"), {
    cycle, cycleLengths, lastPeriodStart, lastLogDate,
    logsByDate,
    mlPredictedCycleLength: predictedCycleLength,
  });
}


// Shared cycle-state promise = set by loadDashboard, consumed by notifications.
// Avoids a second POST /api/cycles/state call on the same page load.
let _cycleStatePromise = null;

onAuthChange(() => { loadDashboard(); });

// Fire notifications using the same cycle state already fetched by loadDashboard.
// getAllLogs() is cached in db.js so no extra network call there either.
getAllLogs().then(async logs => {
  const cycle = buildCycleBase(logs);

  if (!isAnonMode() && (cycle.cycleStarts || []).length >= 1) {
    // Reuse the in-flight or resolved promise from loadDashboard if available
    const state = await (_cycleStatePromise ?? fetchCycleState(logs)).catch(() => null);
    if (state) {
      if (state.nextPeriodDate) cycle.nextPeriodDate = state.nextPeriodDate;
      if (state.fertileStart)   cycle.fertileStart   = state.fertileStart;
      if (state.fertileEnd)     cycle.fertileEnd     = state.fertileEnd;
    }
  }

  triggerNotifications(cycle, logs);
});
