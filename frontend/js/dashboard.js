/**
 * dashboard.js — Goal-based dashboard
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
import { getMode } from "./mode.js";
import { computeCyclePhase } from "./phase.js";
import { getUserGoal, goalLabel, goalDesc } from "./goals.js";
import { triggerNotifications } from "./notifications.js";

// algoPregnancy is loaded lazily inside loadDashboard() to avoid
// top-level await, which is not supported in the configured build targets.
let algoPregnancy = null;

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

function show(el, on) {
  if (!el) return;
  el.style.display = on ? "" : "none";
}

// ─── Phase-based insights ─────────────────────────────────────────────────────

const PHASE_INSIGHTS = {
  menstrual: {
    label: "Menstrual",
    items: [
      { t: "Rest & warmth", d: "Your body is shedding the uterine lining. Prioritise rest, warmth, and gentle movement such as light stretching or short walks." },
      { t: "Stay hydrated", d: "Water and warm herbal teas can ease cramping and reduce bloating." },
      { t: "Iron-rich foods", d: "Include leafy greens, beans, and fortified foods to replenish iron lost during bleeding." },
      { t: "Track your flow", d: "Logging flow intensity each day helps identify patterns. Consistently heavy flow over several days is worth discussing with a provider." },
    ],
    account_extra: [
      { t: "Heat therapy", d: "A warm compress on your lower abdomen can relax uterine muscles and ease cramps." },
    ],
  },
  follicular: {
    label: "Follicular",
    items: [
      { t: "Energy rising", d: "Oestrogen levels are increasing. Many people notice improved mood, focus, and energy in this phase." },
      { t: "Consistent logging", d: "Keep logging even on non-period days — this data improves your cycle predictions over time." },
      { t: "Nutrition support", d: "Foods rich in B vitamins, zinc, and omega-3 support follicular development." },
    ],
    account_extra: [
      { t: "Fertile window approaching", d: "Ovulation is ahead. Whether planning for or avoiding pregnancy, knowing your cycle timing is valuable." },
    ],
  },
  ovulation: {
    label: "Ovulation",
    items: [
      { t: "Fertile window", d: "You may be near your estimated fertile window. This is an educational estimate based on your logged history." },
      { t: "Body signals", d: "Some people notice clear stretchy cervical mucus, mild pelvic twinges, or a slight temperature rise around ovulation." },
      { t: "Stay consistent", d: "Daily logs through this phase greatly improve the accuracy of future predictions." },
    ],
    account_extra: [
      { t: "Peak energy", d: "Elevated oestrogen and testosterone around ovulation often bring peak energy and confidence." },
      { t: "Disclaimer", d: "Bloom cycle predictions are educational estimates only. Do not use them as a sole method of contraception." },
    ],
  },
  luteal: {
    label: "Luteal",
    items: [
      { t: "PMS awareness", d: "Progesterone rises after ovulation. Some people experience mood changes, bloating, or breast tenderness in this phase." },
      { t: "Prioritise sleep", d: "Aim for 7–9 hours. Consistent sleep timing helps stabilise mood and energy during the luteal phase." },
      { t: "Gentle movement", d: "Light exercise and hydration can help reduce bloating and support mood." },
    ],
    account_extra: [
      { t: "Cravings & mood", d: "Cravings for carbs and sweets are common. Balanced meals with protein and complex carbohydrates can help." },
      { t: "Prepare ahead", d: "Your next period may be approaching. Noting pre-menstrual symptoms builds a useful record over time." },
    ],
  },
  unknown: {
    label: "Unknown",
    items: [
      { t: "Start logging", d: "Log your first period day in the calendar to begin tracking your cycle." },
      { t: "Consistency matters", d: "Even a few weeks of data starts to reveal patterns specific to your body." },
      { t: "No pressure", d: "Bloom works at your pace. Log what feels right and your insights will grow." },
    ],
    account_extra: [],
  },
};

function getGoalTip(goal, phase) {
  const map = {
    ttc: {
      ovulation:  { t: "Prime conception timing", d: "You are near your estimated fertile window. Conception likelihood is highest in the 5 days before and on ovulation day." },
      follicular: { t: "Fertile window approaching", d: "Ovulation is estimated in the coming days. Track discharge and temperature changes." },
      luteal:     { t: "Testing window", d: "If conception occurred, the earliest pregnancy tests may detect hCG around 10–14 days post-ovulation." },
      menstrual:  { t: "New cycle", d: "Your fertile window will approach again in approximately the next 1–2 weeks." },
    },
    pregnancy: {
      default: { t: "Pregnancy mode active", d: "Update your LMP date in your profile for accurate due date tracking." },
    },
    perimenopause: {
      default: { t: "Perimenopause tracking", d: "Cycle irregularity is common. Log what you experience — your pattern matters more than a standard model." },
    },
  };
  const g = map[goal];
  if (!g) return null;
  return g[phase] ?? g.default ?? null;
}

function setTodayInsights(phaseKey, goal, mode) {
  const box = document.getElementById("insights");
  if (!box) return;

  const phaseData = PHASE_INSIGHTS[phaseKey] || PHASE_INSIGHTS.unknown;
  const items = [...phaseData.items];
  if (mode === "account") items.push(...phaseData.account_extra);

  const tip = getGoalTip(goal, phaseKey);
  if (tip) items.unshift(tip);

  box.innerHTML = items
    .map((i) => `<div class="insight-item"><strong>${i.t}:</strong> ${i.d}</div>`)
    .join("");
}

// ─── Phase card with colour badge ────────────────────────────────────────────

function renderPhaseCard(cycle) {
  const el = document.getElementById("cycle-phase");
  if (!el) return;

  const key = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : "unknown";
  const label = PHASE_INSIGHTS[key]?.label ?? "Unknown";

  if (key !== "unknown") {
    el.innerHTML = `
      <span class="phase-badge phase-${key}">
        <span class="phase-dot"></span>${label} phase
      </span>
      <p class="text-muted" style="margin-top:0.5rem;font-size:0.88rem;">Estimated from your logged history</p>
      <p class="form-hint">Educational estimate. Not medical advice.</p>
    `;
  } else {
    el.innerHTML = `
      <span class="phase-badge phase-unknown">Not enough data</span>
      <p class="text-muted" style="margin-top:0.5rem;">${cycle.message || "Log period days to estimate your phase."}</p>
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
        <p class="form-hint">Only shown for "Try to conceive" goal.</p>
      `;
    } else {
      el.innerHTML = `
        <div class="stat-number">Conception Window</div>
        <p class="text-muted">Log more period days to estimate your window.</p>
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
            <p class="form-hint">Educational estimate.</p>
          `;
          return;
        }
      } catch (_) {}
    }
    el.innerHTML = `
      <div class="stat-number">Track Pregnancy</div>
      <p class="text-muted">Add your LMP date in your profile to calculate your due date.</p>
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
      <p class="form-hint">Estimate only. Not medical advice.</p>
    `;
  } else {
    el.innerHTML = `
      <div class="stat-number">Next Period</div>
      <p class="text-muted">Log more period days to get an estimate.</p>
    `;
  }
}

// ─── TTC section ──────────────────────────────────────────────────────────────

function renderTtcTools(goal, cycle) {
  const card = document.getElementById("ttc-tools");
  const body = document.getElementById("ttc-tools-body");
  if (!card || !body) return;

  show(card, goal === "ttc");
  if (goal !== "ttc") return;

  const todayKey = toDateKey(new Date());

  // Fertility confidence from algorithm
  let confHtml = "";
  if (algoPregnancy && cycle.cycleStarts?.length >= 2) {
    try {
      const starts = cycle.cycleStarts.map((s) => new Date(s + "T00:00:00"));
      const lengths = [];
      for (let i = 1; i < starts.length; i++) {
        lengths.push(Math.round((starts[i] - starts[i - 1]) / 86400000));
      }
      const ovDay = cycle.ovulationDate ? new Date(cycle.ovulationDate + "T00:00:00") : null;
      if (ovDay) {
        const conf = algoPregnancy.fertilityConfidence(lengths, ovDay);
        const cls = conf.confidence === "High" ? "conf-high" : conf.confidence === "Medium" ? "conf-medium" : "conf-low";
        confHtml = `
          <div class="insight-item">
            <strong>Fertility Confidence:</strong>
            <span class="fertility-conf ${cls}" style="margin-left:0.4rem;">${conf.confidence}</span>
            <span class="text-muted" style="font-size:0.85rem;display:block;margin-top:0.2rem;">${conf.message}</span>
          </div>`;
      }
    } catch (_) {}
  }

  // Conception window
  const windowHtml = cycle.fertileStart && cycle.fertileEnd
    ? `${formatDate(cycle.fertileStart)} → ${formatDate(cycle.fertileEnd)}`
    : "Log more period days to estimate.";

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
      testHtml = `<div class="insight-item"><strong>When to test:</strong> Log more period days so Bloom can estimate testing guidance.</div>`;
    }
  }

  body.innerHTML = `
    <div class="insight-item"><strong>Conception Window:</strong> ${windowHtml}</div>
    ${confHtml}
    ${testHtml}
    <p class="form-hint" style="margin-top:.75rem;">Educational estimates only. Not medical advice.</p>
  `;
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
    const cycleLen = Number(profile.avgCycleLength) || 28;
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
      <div class="insight-item"><strong>Trimester:</strong> ${r.trimesterLabel ?? "—"} &bull; <strong>Week:</strong> ${week ?? "—"} &bull; <strong>Weeks remaining:</strong> ${r.weeksRemaining ?? "—"}</div>
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
      <p class="text-muted">No symptom logs yet. Tap days on the calendar to start logging.</p>
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

    return `
      <div class="cycle-card">
        <span class="cycle-card-title">${title}</span>
        <span class="cycle-card-subtitle">${subtitle}</span>
        <div class="cycle-dot-row">${dots.join("")}</div>
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
      dotsEl.innerHTML = `<p class="text-muted" style="font-size:0.9rem;">No periods logged yet. Tap a day on the calendar to start.</p>`;
    } else {
      const legend = `
        <div class="cycle-legend">
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-period"></span>Period</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-fertile"></span>Fertile</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-ovulation"></span>Ovulation</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-follicular"></span>Follicular</span>
          <span class="cycle-legend-item"><span class="cycle-dot-item dot-luteal"></span>Luteal</span>
        </div>`;

      const INITIAL_SHOW = 3;
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
      `<p class="text-muted" style="font-size:0.9rem;text-align:center;padding:1.25rem 0;">Log at least 2 periods to see your cycle trend.</p>`;
    return;
  }

  const avg = Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length);
  const labels = cycleStarts.slice(0, -1).map((s) => formatDate(s));
  const yPad = 8;
  const yMin = Math.max(10, Math.min(...cycleLengths) - yPad);
  const yMax = Math.min(55, Math.max(...cycleLengths) + yPad);

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
      fill: "tozeroy",
      fillcolor: "rgba(212,116,154,0.07)",
      hovertemplate: "<b>%{x}</b><br><b>%{y} days</b><extra></extra>",
    },
  ], {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 14, r: 20, b: 64, l: 44 },
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.32,
      x: 0,
      font: { family: "Nunito, sans-serif", size: 11 },
      bgcolor: "transparent",
    },
    yaxis: {
      range: [yMin, yMax],
      gridcolor: "rgba(0,0,0,0.06)",
      zeroline: false,
      tickfont: { family: "Nunito, sans-serif", size: 11 },
      ticksuffix: "d",
    },
    xaxis: {
      showgrid: false,
      tickfont: { family: "Nunito, sans-serif", size: 11 },
      tickangle: -20,
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadDashboard() {
  // Load algorithm module here so we never hit a top-level await
  try {
    algoPregnancy = await import("./algorithms/pregnancyAlgorithm.js");
  } catch (_) {}

  const mode = getMode();
  const logsByDate = await getAllLogs();
  const goal = getUserGoal();
  const cycle = computeCyclePhase(logsByDate);

  const goalBadge = document.getElementById("goal-badge");
  const goalDescEl = document.getElementById("goal-desc");
  if (goalBadge) goalBadge.textContent = goalLabel(goal);
  if (goalDescEl) goalDescEl.textContent = goalDesc(goal);

  // Cycle snapshot
  const snapshotEl = document.getElementById("cycle-snapshot");
  if (snapshotEl) {
    if (cycle.dayInCycle) {
      const confCls = cycle.confidence === "high" ? "conf-high" : cycle.confidence === "medium" ? "conf-medium" : "conf-low";
      snapshotEl.innerHTML = `
        <div class="stat-number">Day ${cycle.dayInCycle}</div>
        <p class="muted-line">
          ${cycle.avgCycleLength ? `Avg cycle: ${cycle.avgCycleLength} days` : "Keep logging to improve predictions"}
          &nbsp;·&nbsp;<span class="fertility-conf ${confCls}">${cycle.confidence[0].toUpperCase() + cycle.confidence.slice(1)}</span>
        </p>
      `;
    } else {
      snapshotEl.innerHTML = `
        <div class="stat-number">—</div>
        <p class="text-muted">Log a period day on the calendar to see your cycle day.</p>
      `;
    }
  }

  renderPhaseCard(cycle);
  renderGoalToolCard(goal, cycle);
  renderTtcTools(goal, cycle);
  renderPregnancyTools(goal);
  renderSymptomTools(goal, logsByDate);
  renderCycleHistoryAndChart(cycle, logsByDate);

  // PDF export — navigate to the full report page
  const pdfBtn = document.getElementById("export-pdf");
  if (pdfBtn) {
    pdfBtn.onclick = () => { window.location.href = "/pages/report.html"; };
  }

  const phaseKey = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : "unknown";
  setTodayInsights(phaseKey, goal, mode);

  // Advanced insights
  const advancedEl = document.getElementById("advanced-insights");
  if (advancedEl) {
    if (mode === "account") {
      const flags = [];
      if (cycle.avgCycleLength && cycle.avgCycleLength < 21)
        flags.push("Your average cycle is shorter than 21 days. This may be worth discussing with a healthcare provider.");
      if (cycle.avgCycleLength && cycle.avgCycleLength > 35)
        flags.push("Your average cycle is longer than 35 days. This can be worth monitoring with a provider.");

      advancedEl.innerHTML = flags.length
        ? flags.map((f) => `<div class="insight-item"><strong>Pattern note:</strong> ${f}</div>`).join("")
        : `<div class="insight-item">No unusual patterns detected. Keep logging for more detailed insights.</div>`;
    } else {
      advancedEl.innerHTML = `
        <div class="banner banner-info" style="margin:0;">
          <div><strong>Feature locked.</strong> <a href="/pages/register.html">Create an account</a> to unlock advanced pattern analysis.</div>
        </div>
      `;
    }
  }
}

loadDashboard();

// Fire notifications after dashboard loads (cycle data computed inside loadDashboard)
getAllLogs().then(logs => {
  const cycle = computeCyclePhase(logs);
  triggerNotifications(cycle, logs);
});
