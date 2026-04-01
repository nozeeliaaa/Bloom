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
import { getMode, isAnonMode } from "./mode.js";
import { computeCyclePhase } from "./phase.js";
import { runFullPrediction } from "./algorithms/cyclePredictor.js";
import { getUserGoal, goalLabel, goalDesc } from "./goals.js";
import { triggerNotifications } from "./notifications.js";

// algoPregnancy and algoCycleEngine are loaded lazily inside loadDashboard()
// to avoid top-level await, which is not supported in the configured build targets.
let algoPregnancy = null;
let algoCycleEngine = null;

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
      { t: "Consistent logging", d: "Keep logging even on non-period days - this data improves your cycle predictions over time." },
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
      { t: "Start logging", d: "No cycle data logged. Open Calendar to add your first period." },
      { t: "Consistency matters", d: "A few weeks of data is sufficient to begin identifying personal cycle patterns." },
      { t: "Log at your pace", d: "Insights improve as more data is recorded." },
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
      <p class="text-muted" style="margin-top:0.5rem;font-size:0.88rem;">Estimated from logged history</p>
      <p class="form-hint">Educational estimate. Not medical advice.</p>
    `;
  } else {
    el.innerHTML = `
      <span class="phase-badge phase-unknown">Not enough data</span>
      <p class="text-muted" style="margin-top:0.5rem;">${cycle.message || "Log period days to estimate phase."}</p>
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
            <p class="form-hint">Educational estimate.</p>
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
      <p class="form-hint">Estimate only. Not medical advice.</p>
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
      `<p class="text-muted" style="font-size:0.9rem;text-align:center;padding:1.25rem 0;">Log at least 2 periods to view the cycle trend.</p>`;
    return;
  }

  const avg = Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length);
  const labels = cycleStarts.slice(0, -1).map((s) => formatDate(s));
  const yPad = 8;
  const yMin = Math.max(10, Math.min(...cycleLengths) - yPad);
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
      fill: "tozeroy",
      fillcolor: "rgba(212,116,154,0.07)",
      hovertemplate: "<b>%{x}</b><br><b>%{y} days</b><extra></extra>",
    },
  ], {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 14, r: 24, b: 80, l: 52 },
    showlegend: true,
    legend: {
      orientation: "h",
      y: -0.38,
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
      automargin: true,
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
    EXTENDED_ABSENCE:          "Extended gap since last period",
    MISSED_PERIOD:             "Period may be late",
    LATE_PERIOD:               "Period seems late",
    IRREGULAR_CYCLE:           "Irregular pattern detected",
    LOW_PREDICTION_CONFIDENCE: "Prediction confidence low",
    LOGGING_GAP:               "Logging gap",
    PREDICTION_DRIFT:          "Prediction updated",
    SHORT_CYCLE:               "Short cycle noted",
    LONG_CYCLE:                "Long cycle noted",
    SHORTENING_CYCLE_TREND:    "Shortening cycle trend",
    LENGTHENING_CYCLE_TREND:   "Lengthening cycle trend",
    CYCLE_VARIABILITY_HIGH:    "Higher cycle variability",
    AMENORRHEA_RISK:           "Prolonged absence of period",
  }[code] || code.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function renderAdvancedInsights(advancedEl, { cycle, cycleLengths, lastPeriodStart, lastLogDate }) {
  if (!advancedEl) return;

  const today = new Date();
  const signals = [];

  const nextWindow = cycle.nextPeriodDate ? {
    start: new Date(cycle.nextPeriodDate + "T00:00:00"),
    end:   new Date(addDaysStr(cycle.nextPeriodDate, 5) + "T00:00:00"),
  } : null;

  const lastPeriodDate = lastPeriodStart ? new Date(lastPeriodStart + "T00:00:00") : null;
  const lastLogDateObj = lastLogDate    ? new Date(lastLogDate    + "T00:00:00") : null;

  // ── Cycle Engine (comprehensive signal set) ──
  if (algoCycleEngine) {
    try {
      const engineSignals = algoCycleEngine.generateCycleSignals({
        expectedNextPeriodWindow: nextWindow,
        today,
        lastPeriodStart: lastPeriodDate,
        lastLogDate:     lastLogDateObj,
        cycleLengths,
      });
      signals.push(...engineSignals);
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

  // Sort: high → medium → low
  const pri = { high: 3, medium: 2, low: 1 };
  signals.sort((a, b) => (pri[b.level] || 0) - (pri[a.level] || 0));

  advancedEl.innerHTML = signals.map(s => {
    const label = signalLabel(s.code);
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
          <div style="font-size:0.88rem;color:#555;line-height:1.55;">${s.message} Consider speaking to a healthcare provider.</div>
        </div>`;
    }
    return `<div class="insight-item"><strong>${label}:</strong> ${s.message}</div>`;
  }).join("") + `<p class="form-hint" style="margin-top:0.75rem;">Pattern-based signals only. Not medical diagnoses.</p>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadDashboard() {
  // Load algorithm modules here so we never hit a top-level await
  try {
    algoPregnancy = await import("./algorithms/pregnancyAlgorithm.js");
  } catch (_) {}
  try {
    algoCycleEngine = await import("./algorithms/bloom-cycle-engine.js");
  } catch (_) {}

  const mode = getMode();
  const logsByDate = await getAllLogs();
  const goal = getUserGoal();
  const cycle = computeCyclePhase(logsByDate);

  // Derived data used by algorithms and charts
  const cycleStarts = cycle.cycleStarts || [];
  const cycleLengths = [];
  for (let i = 1; i < cycleStarts.length; i++) {
    cycleLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
  }
  const lastPeriodStart = cycleStarts.length ? cycleStarts[cycleStarts.length - 1] : null;

  // Override cycle.phase with the predictor's getCurrentPhase if we have enough data
  if (lastPeriodStart) {
    // Find lastPeriodEnd: scan forward from lastPeriodStart for consecutive flow days
    let lastPeriodEndStr = lastPeriodStart;
    const d = new Date(lastPeriodStart + "T00:00:00");
    for (let i = 1; i <= 14; i++) {
      d.setDate(d.getDate() + 1);
      const key = toDateKey(d);
      if (logsByDate[key]?.flow && logsByDate[key].flow !== "none") {
        lastPeriodEndStr = key;
      } else {
        break;
      }
    }
    const periodStartDates = cycleStarts.map(s => new Date(s + "T00:00:00"));
    const lpsDate = new Date(lastPeriodStart + "T00:00:00");
    const lpeDate = new Date(lastPeriodEndStr + "T00:00:00");

    try {
      const prediction = runFullPrediction(periodStartDates, lpsDate, lpeDate);
      if (prediction.ready && prediction.currentPhase && prediction.currentPhase !== "unknown") {
        cycle.phase = prediction.currentPhase;
      }
      if (prediction.ready && prediction.nextPeriodStart) {
        cycle.nextPeriodDate = toDateKey(prediction.nextPeriodStart);
      }
      if (prediction.ready && prediction.futureCycles?.[0]?.fertileWindow) {
        cycle.fertileStart = toDateKey(prediction.futureCycles[0].fertileWindow.start);
        cycle.fertileEnd   = toDateKey(prediction.futureCycles[0].fertileWindow.end);
      }
      if (prediction.ready && prediction.ovulationDay) {
        cycle.ovulationDate = toDateKey(prediction.ovulationDay);
      }
    } catch (_) {}
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
      const confCls = cycle.confidence === "high" ? "conf-high" : cycle.confidence === "medium" ? "conf-medium" : "conf-low";
      snapshotEl.innerHTML = `
        <div class="stat-number">Day ${cycle.dayInCycle}</div>
        <p class="muted-line">
          ${cycle.avgCycleLength ? `Avg cycle: ${cycle.avgCycleLength} days` : "Log more data to improve predictions"}
          &nbsp;·&nbsp;<span class="fertility-conf ${confCls}">${cycle.confidence[0].toUpperCase() + cycle.confidence.slice(1)}</span>
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
  renderMythCard(logsByDate);
  renderCycleHistoryAndChart(cycle, logsByDate);

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
  setTodayInsights(phaseKey, goal, mode);

  // Advanced insights (algorithm-powered)
  renderAdvancedInsights(document.getElementById("advanced-insights"), {
    cycle, cycleLengths, lastPeriodStart, lastLogDate,
  });
}

// ─── Myth or Fact quiz card ──────────────────────────────────────────────────

const MYTH_BANK = [
  // ── Cycle & period basics ──────────────────────────────────────────────────
  {
    statement: "You cannot get pregnant during your period.",
    answer: "myth",
    explanation: "Pregnancy is less likely during menstruation but still possible. Sperm can survive up to 5 days inside the body, and people with shorter cycles may ovulate shortly after bleeding ends.",
    tags: ["cycle", "fertility"],
  },
  {
    statement: "A healthy menstrual cycle is always 28 days long.",
    answer: "myth",
    explanation: "Cycles between 21 and 35 days are all within the healthy range. Only about 10–15% of people have exactly a 28-day cycle. Consistency matters more than hitting a specific number.",
    tags: ["cycle"],
  },
  {
    statement: "Period blood contains toxins that need to be 'cleansed' from the body.",
    answer: "myth",
    explanation: "Period blood is simply the uterine lining shedding — it contains blood, mucus, and tissue. There are no toxins being expelled. The idea of menstrual blood being impure is a myth with no scientific basis.",
    tags: ["cycle", "period"],
  },
  {
    statement: "Brown period blood can be a normal part of your cycle.",
    answer: "fact",
    explanation: "Brown blood is simply older blood that has taken longer to leave the body and oxidised along the way. It commonly appears at the beginning or end of a period and is usually nothing to worry about.",
    tags: ["period", "blood"],
  },
  {
    statement: "The average person loses over 500 ml of blood during a period.",
    answer: "myth",
    explanation: "The typical amount of blood lost per period is 30–80 ml — roughly 2–6 tablespoons. Losing more than 80 ml (soaking a pad or tampon every hour for several hours) is considered heavy bleeding and worth discussing with a doctor.",
    tags: ["period", "flow"],
  },
  {
    statement: "Periods always last exactly 7 days.",
    answer: "myth",
    explanation: "Period length varies from person to person. Anywhere from 2 to 7 days is considered normal. What matters is that your own pattern stays relatively consistent.",
    tags: ["cycle", "period"],
  },
  {
    statement: "You can have a period without actually ovulating.",
    answer: "fact",
    explanation: "This is called an anovulatory cycle — your uterine lining still sheds, so bleeding occurs, but no egg was released. Anovulatory cycles are common during puberty, perimenopause, and times of high stress.",
    tags: ["cycle", "ovulation"],
  },
  {
    statement: "Period syncing between people who live together is scientifically proven.",
    answer: "myth",
    explanation: "Despite being widely believed, studies have not found reliable evidence that menstrual cycles sync up between housemates or friends. Perceived synchrony is more likely coincidence given how much cycle lengths vary.",
    tags: ["cycle"],
  },

  // ── Symptoms & PMS ─────────────────────────────────────────────────────────
  {
    statement: "PMS is just being emotional — it is not a real medical condition.",
    answer: "myth",
    explanation: "Premenstrual syndrome (PMS) is a recognised medical condition driven by hormonal fluctuations. Symptoms can include bloating, fatigue, breast tenderness, cramps, mood changes, and headaches — all with documented physiological causes.",
    tags: ["pms", "symptoms"],
  },
  {
    statement: "Severe period pain that disrupts daily life is always normal.",
    answer: "myth",
    explanation: "Mild cramping is common, but pain severe enough to miss school, work, or daily activities may be a sign of endometriosis, fibroids, or adenomyosis. It is worth speaking to a healthcare provider about pain that significantly impacts your life.",
    tags: ["pain", "cramps", "endometriosis"],
  },
  {
    statement: "Exercise can help relieve period cramps.",
    answer: "fact",
    explanation: "Gentle movement like walking, yoga, or light stretching encourages blood flow and triggers the release of endorphins, which are natural pain relievers. Many people find low-intensity exercise reduces cramping.",
    tags: ["cramps", "pain", "exercise"],
  },
  {
    statement: "Hormonal shifts before your period can cause real physical headaches.",
    answer: "fact",
    explanation: "Oestrogen levels drop in the days before menstruation begins. This drop is a well-documented trigger for migraines and tension headaches in many people, often called menstrual migraines.",
    tags: ["headache", "pms", "symptoms"],
  },
  {
    statement: "Bloating during your period means you are gaining permanent weight.",
    answer: "myth",
    explanation: "Period bloating is caused by hormonal changes that cause the body to retain water temporarily. It typically resolves within a few days of your period starting. It is not fat gain.",
    tags: ["bloating", "symptoms", "pms"],
  },
  {
    statement: "Cravings for chocolate or carbs before your period can have a physiological basis.",
    answer: "fact",
    explanation: "Drops in serotonin and magnesium before menstruation are linked to carbohydrate and chocolate cravings. Dark chocolate is genuinely high in magnesium, which may explain why it is such a common craving.",
    tags: ["pms", "cravings", "nutrition"],
  },
  {
    statement: "Caffeine makes period cramps worse for many people.",
    answer: "fact",
    explanation: "Caffeine can cause blood vessels to constrict and may increase oestrogen levels, which can worsen cramping. Reducing caffeine intake in the days before and during your period may help ease discomfort.",
    tags: ["cramps", "caffeine", "nutrition"],
  },
  {
    statement: "Having no PMS symptoms means your hormones are unhealthy.",
    answer: "myth",
    explanation: "Some people experience little to no PMS and that is completely normal. The absence of symptoms does not indicate a hormonal problem. PMS severity varies widely and is influenced by genetics, lifestyle, and individual hormonal patterns.",
    tags: ["pms", "symptoms"],
  },

  // ── Fertility & pregnancy ──────────────────────────────────────────────────
  {
    statement: "You can only get pregnant on one single day per cycle.",
    answer: "myth",
    explanation: "The fertile window spans approximately 6 days — the 5 days before ovulation and the day of ovulation itself. Sperm can survive inside the reproductive tract for up to 5 days, so timing does not need to be exact.",
    tags: ["fertility", "ovulation", "ttc"],
  },
  {
    statement: "Stress can delay or prevent ovulation.",
    answer: "fact",
    explanation: "High levels of stress trigger cortisol release, which can interfere with the hormonal signals that trigger ovulation. Chronic stress is a known cause of delayed or absent ovulation and irregular cycles.",
    tags: ["stress", "ovulation", "fertility"],
  },
  {
    statement: "Fertility drops sharply the moment you turn 30.",
    answer: "myth",
    explanation: "Fertility does decline with age, but the significant decline typically begins after 35, not 30. Many people conceive without difficulty in their early-to-mid 30s. The rate of decline accelerates after 37–38.",
    tags: ["fertility", "age"],
  },
  {
    statement: "After stopping hormonal birth control, it can take up to a year for fertility to return.",
    answer: "myth",
    explanation: "For most people, fertility returns within one to three months of stopping hormonal contraception. Some people conceive immediately. The exception is the injectable contraceptive (Depo-Provera), which can delay fertility return for up to a year.",
    tags: ["fertility", "contraception"],
  },
  {
    statement: "Most people can physically feel when they are ovulating.",
    answer: "myth",
    explanation: "The majority of people experience no noticeable ovulation symptoms. Some do feel mild pelvic cramping (mittelschmerz) or notice changes in cervical mucus, but ovulation cannot be reliably confirmed without testing tools.",
    tags: ["ovulation", "fertility"],
  },
  {
    statement: "Pre-ejaculate (pre-cum) can contain sperm and cause pregnancy.",
    answer: "fact",
    explanation: "Pre-ejaculate can contain sperm, particularly if a previous ejaculation occurred without urination between the two. This is why the withdrawal method has a higher failure rate than other forms of contraception.",
    tags: ["fertility", "contraception"],
  },
  {
    statement: "Morning sickness only happens in the morning.",
    answer: "myth",
    explanation: "The name 'morning sickness' is misleading — nausea and vomiting during early pregnancy can occur at any time of day or night. Many people experience it most severely in the afternoon or evening.",
    tags: ["pregnancy", "symptoms"],
  },
  {
    statement: "A pregnancy test taken on the day of a missed period can be accurate.",
    answer: "fact",
    explanation: "Most modern pregnancy tests are sensitive enough to detect hCG levels at around the time of a missed period. However, testing a few days after a missed period increases accuracy, as hCG levels rise rapidly in early pregnancy.",
    tags: ["pregnancy"],
  },

  // ── Menopause & perimenopause ──────────────────────────────────────────────
  {
    statement: "Menopause happens at exactly age 50 for everyone.",
    answer: "myth",
    explanation: "The average age of natural menopause is around 51, but the normal range is 45–55. Perimenopause — the transition phase with irregular cycles and symptoms — can begin in the early-to-mid 40s. Premature menopause can occur even earlier.",
    tags: ["menopause", "perimenopause"],
  },
  {
    statement: "Hot flashes only happen at night during menopause.",
    answer: "myth",
    explanation: "Hot flashes can occur at any time of day or night. Night sweats are simply hot flashes that happen during sleep. Both are caused by changes in oestrogen affecting the body's temperature regulation.",
    tags: ["menopause", "symptoms"],
  },
  {
    statement: "You cannot get pregnant during perimenopause.",
    answer: "myth",
    explanation: "Perimenopause does not mean you are infertile. Ovulation can still occur, even irregularly. Pregnancy is possible until you have gone 12 consecutive months without a period, which marks the official start of menopause.",
    tags: ["menopause", "perimenopause", "fertility"],
  },
  {
    statement: "Menopause is a single event that happens overnight.",
    answer: "myth",
    explanation: "Menopause is defined as 12 consecutive months without a period, but the transition — perimenopause — can last anywhere from 2 to 10 years beforehand. During this time, cycles become irregular and symptoms like hot flashes may begin.",
    tags: ["menopause", "perimenopause"],
  },
  {
    statement: "After menopause, vaginal bleeding should always be investigated.",
    answer: "fact",
    explanation: "Any vaginal bleeding that occurs 12 or more months after the last period is classified as postmenopausal bleeding and should be evaluated by a healthcare provider, as it can sometimes indicate uterine or cervical issues.",
    tags: ["menopause", "bleeding"],
  },

  // ── Contraception ──────────────────────────────────────────────────────────
  {
    statement: "The contraceptive pill protects against sexually transmitted infections.",
    answer: "myth",
    explanation: "Hormonal contraceptives prevent pregnancy but provide no protection against STIs. Only barrier methods such as condoms reduce the risk of STI transmission.",
    tags: ["contraception"],
  },
  {
    statement: "Using tampons can affect your virginity.",
    answer: "myth",
    explanation: "Tampons do not change your hymen in a medically significant way, nor do they have anything to do with sexual activity or virginity, which is a social concept not a physical state. They are safe to use for people of any age.",
    tags: ["period", "tampons"],
  },
  {
    statement: "Emergency contraception (the morning-after pill) is the same as an abortion pill.",
    answer: "myth",
    explanation: "Emergency contraception works primarily by delaying or preventing ovulation. It does not end an established pregnancy. The abortion pill (mifepristone/misoprostol) is a different medication that terminates an existing pregnancy.",
    tags: ["contraception"],
  },
  {
    statement: "Long-term use of the contraceptive pill can permanently reduce your fertility.",
    answer: "myth",
    explanation: "There is no evidence that using the pill for years causes lasting fertility issues. After stopping, most people return to their natural cycle and fertility within a few months.",
    tags: ["contraception", "fertility"],
  },

  // ── Conditions ─────────────────────────────────────────────────────────────
  {
    statement: "Endometriosis only affects older women.",
    answer: "myth",
    explanation: "Endometriosis can begin as early as the first menstrual period and commonly goes undiagnosed for years. It affects people of all ages who menstruate, and symptoms often start in adolescence.",
    tags: ["endometriosis", "pain", "cramps"],
  },
  {
    statement: "PCOS always causes weight gain.",
    answer: "myth",
    explanation: "Polycystic ovary syndrome (PCOS) presents very differently from person to person. While some people with PCOS gain weight due to insulin resistance, many are of average or low body weight. PCOS is a hormonal condition, not a weight condition.",
    tags: ["pcos", "symptoms"],
  },
  {
    statement: "Irregular periods are always a sign of PCOS.",
    answer: "myth",
    explanation: "Irregular cycles have many causes including stress, thyroid disorders, significant weight changes, over-exercise, certain medications, and perimenopause. PCOS is one possible cause, but a proper clinical diagnosis is needed — apps cannot diagnose it.",
    tags: ["cycle", "pcos", "irregular"],
  },
  {
    statement: "All vaginal discharge is a sign of infection.",
    answer: "myth",
    explanation: "Vaginal discharge is normal and healthy — it keeps the vagina clean and maintains its pH balance. Discharge naturally changes in colour, texture, and quantity throughout the cycle. Signs that may suggest infection include a strong unusual smell, unusual colour (green/grey), or significant itching.",
    tags: ["discharge", "vaginal health"],
  },
  {
    statement: "A Pap smear tests for sexually transmitted infections.",
    answer: "myth",
    explanation: "A Pap smear (cervical screening) tests for abnormal cells on the cervix caused by HPV, which can lead to cervical cancer. It is not an STI test. Separate swabs or blood tests are needed to screen for STIs.",
    tags: ["screening", "cervical health"],
  },
  {
    statement: "Ovarian cysts are always cancerous and dangerous.",
    answer: "myth",
    explanation: "Most ovarian cysts are benign (non-cancerous) functional cysts that form during ovulation and resolve on their own within a few weeks. Cancerous ovarian cysts are relatively rare. Many cysts are found incidentally and never cause symptoms.",
    tags: ["ovarian cysts", "symptoms"],
  },
  {
    statement: "Heavy periods are just inconvenient and not a medical concern.",
    answer: "myth",
    explanation: "Heavy menstrual bleeding (menorrhagia) can lead to iron-deficiency anaemia and significantly impact quality of life. It can also be caused by fibroids, endometriosis, thyroid disorders, or clotting issues — all of which benefit from medical evaluation.",
    tags: ["heavy flow", "flow", "symptoms"],
  },
  {
    statement: "Uterine fibroids always cause noticeable symptoms.",
    answer: "myth",
    explanation: "Many people have fibroids and never know it. Fibroids are non-cancerous growths in or around the uterus and are very common. When symptoms do occur, they can include heavy periods, pelvic pressure, or frequent urination.",
    tags: ["fibroids", "symptoms", "heavy flow"],
  },

  // ── Nutrition & lifestyle ──────────────────────────────────────────────────
  {
    statement: "You should avoid all exercise during your period.",
    answer: "myth",
    explanation: "There is no medical reason to avoid exercise during your period. Light to moderate activity is safe and can actually help with cramps, mood, and fatigue through endorphin release.",
    tags: ["exercise", "cramps", "period"],
  },
  {
    statement: "Eating iron-rich foods can help with period-related fatigue.",
    answer: "fact",
    explanation: "Menstruation causes iron loss, which can contribute to low energy. Eating iron-rich foods like leafy greens, lentils, red meat, and fortified cereals — especially with vitamin C to boost absorption — can help maintain iron levels.",
    tags: ["nutrition", "fatigue", "iron"],
  },
  {
    statement: "Swimming during your period is unsafe or unhygienic.",
    answer: "myth",
    explanation: "Swimming during your period is completely safe. Water pressure can temporarily reduce flow while you are submerged. Using a tampon, menstrual cup, or disc makes swimming comfortable and hygienic.",
    tags: ["period", "exercise"],
  },
  {
    statement: "Cold food and drinks cause menstrual cramps.",
    answer: "myth",
    explanation: "There is no scientific evidence that cold food or drinks cause or worsen cramps. Menstrual cramps are caused by prostaglandins — hormone-like chemicals that trigger uterine contractions — not by food temperature.",
    tags: ["cramps", "nutrition"],
  },
  {
    statement: "Your sleep can be disrupted by hormonal changes during your cycle.",
    answer: "fact",
    explanation: "Progesterone levels rise after ovulation and fall before menstruation, which can affect sleep quality. Many people report insomnia, vivid dreams, or night sweats in the days before their period due to these hormonal shifts.",
    tags: ["sleep", "cycle", "pms"],
  },

  // ── General reproductive health ────────────────────────────────────────────
  {
    statement: "Period cramps and labour contractions are caused by the same chemical.",
    answer: "fact",
    explanation: "Both are triggered by prostaglandins — compounds that cause smooth muscle to contract. Higher prostaglandin levels are linked to more intense menstrual cramps. Anti-inflammatory medications like ibuprofen work by reducing prostaglandin production.",
    tags: ["cramps", "pain"],
  },
  {
    statement: "Your menstrual cycle is always the same length every month.",
    answer: "myth",
    explanation: "Natural variation of a few days from cycle to cycle is completely normal. Factors like stress, illness, travel, and sleep changes can all shift the timing of ovulation and therefore cycle length.",
    tags: ["cycle", "irregular"],
  },
  {
    statement: "Skin breakouts before your period are caused by hormonal changes.",
    answer: "fact",
    explanation: "In the days before menstruation, a drop in oestrogen and progesterone can increase oil production in the skin. This hormonal shift is a common trigger for premenstrual breakouts, particularly around the chin and jaw.",
    tags: ["skin", "pms", "symptoms"],
  },
  {
    statement: "Darker colouring of the vulva or labia is abnormal.",
    answer: "myth",
    explanation: "The skin of the vulva and labia comes in a wide range of colours and shades, often darker than surrounding skin. This is entirely normal and caused by higher concentrations of melanin. Variation in appearance is natural.",
    tags: ["vaginal health"],
  },
  {
    statement: "Menstrual cups have a much higher risk of toxic shock syndrome than tampons.",
    answer: "myth",
    explanation: "Toxic shock syndrome (TSS) is associated primarily with leaving tampons in for too long, particularly high-absorbency ones. Menstrual cups are made of silicone or rubber and, when used as directed, carry a very low risk of TSS.",
    tags: ["period", "menstrual cup"],
  },
  {
    statement: "Hormonal birth control can mask the symptoms of underlying conditions like endometriosis.",
    answer: "fact",
    explanation: "Hormonal contraceptives can reduce or eliminate period pain and heavy bleeding, which are common symptoms of endometriosis. While this can provide welcome relief, it may also delay diagnosis if symptoms disappear without the underlying condition being addressed.",
    tags: ["endometriosis", "contraception"],
  },
  {
    statement: "The luteal phase (after ovulation) is the same length for everyone.",
    answer: "myth",
    explanation: "While the luteal phase is more consistent than the follicular phase, it typically ranges from 10 to 16 days. A luteal phase shorter than 10 days can sometimes affect the ability to sustain a pregnancy.",
    tags: ["cycle", "ovulation", "fertility"],
  },
  {
    statement: "Stress can cause your period to be late.",
    answer: "fact",
    explanation: "Psychological and physical stress activates the hypothalamic-pituitary-adrenal axis, which can suppress the hormonal signals needed for ovulation. A delayed or skipped ovulation pushes back the expected period date.",
    tags: ["stress", "cycle", "irregular"],
  },
  {
    statement: "A light or irregular period always means low fertility.",
    answer: "myth",
    explanation: "Period flow and regularity are influenced by many factors. A lighter period does not indicate fewer eggs or lower fertility. Ovulation — not period heaviness — determines fertility potential.",
    tags: ["fertility", "flow", "irregular"],
  },
  {
    statement: "Skipping periods intentionally on continuous birth control is medically harmful.",
    answer: "myth",
    explanation: "The monthly bleed on hormonal contraceptives like the pill is a withdrawal bleed, not a true period. There is no medical evidence that skipping it by running pill packs back-to-back is harmful. Many doctors recommend this for various health reasons.",
    tags: ["contraception", "cycle"],
  },
];

// ── Tags that relate to logged symptoms / user context ──────────────────────
const SYMPTOM_TAG_MAP = {
  "Cramps":           ["cramps", "pain"],
  "Back pain":        ["pain"],
  "Headache":         ["headache"],
  "Bloating":         ["bloating"],
  "Mood swings":      ["pms"],
  "Fatigue":          ["fatigue"],
  "Nausea":           ["symptoms"],
  "Acne":             ["skin"],
  "Breast tenderness":["pms", "symptoms"],
  "Hot flashes":      ["menopause"],
  "Night sweats":     ["menopause"],
  "Discharge":        ["discharge", "vaginal health"],
  "Spotting":         ["bleeding"],
  "Heavy flow":       ["heavy flow", "flow"],
  "Light flow":       ["flow"],
};

const SESSION_SIZE = 10; // questions per session

function buildQuizSession(logsByDate) {
  // Derive tags from recent logs (last 14 days)
  const recentTags = new Set();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  Object.entries(logsByDate || {}).forEach(([dateKey, entry]) => {
    if (new Date(dateKey + "T00:00:00") < cutoff) return;
    (entry.symptoms || []).forEach(sym => {
      (SYMPTOM_TAG_MAP[sym] || []).forEach(t => recentTags.add(t));
    });
    if (entry.flow && entry.flow !== "none") recentTags.add("period");
  });

  // Also factor in user goal
  const goal = localStorage.getItem("bloom_goal") || "period";
  if (goal === "ttc")           { recentTags.add("fertility"); recentTags.add("ttc"); }
  if (goal === "pregnancy")     { recentTags.add("pregnancy"); }
  if (goal === "perimenopause") { recentTags.add("menopause"); recentTags.add("perimenopause"); }

  // Score each item by relevance
  const scored = MYTH_BANK.map(item => {
    const overlap = (item.tags || []).filter(t => recentTags.has(t)).length;
    return { item, score: overlap + Math.random() * 0.5 }; // small random tiebreak
  });
  scored.sort((a, b) => b.score - a.score);

  // Take the top SESSION_SIZE
  return scored.slice(0, SESSION_SIZE).map(x => x.item);
}

function renderMythCard(logsByDate) {
  const card       = document.getElementById("myth-card");
  const metaEl     = document.getElementById("myth-quiz-meta");
  const statement  = document.getElementById("myth-statement");
  const answerRow  = document.getElementById("myth-answer-row");
  const feedbackEl = document.getElementById("myth-feedback");
  const factBox    = document.getElementById("myth-fact-box");
  const nextBtn    = document.getElementById("myth-next-btn");
  const progressBar = document.getElementById("myth-progress-bar");

  if (!card) return;

  let queue   = buildQuizSession(logsByDate);
  let qIndex  = 0;
  let score   = 0;
  let answered = false;

  function updateMeta() {
    const total = queue.length;
    metaEl.innerHTML = `
      <span>${qIndex + 1} of ${total}</span>
      <span class="myth-score-pill">Score: ${score}</span>
    `;
    progressBar.style.width = `${Math.round((qIndex / total) * 100)}%`;
  }

  function showQuestion() {
    answered = false;
    const item = queue[qIndex];

    updateMeta();
    statement.textContent = item.statement;

    feedbackEl.textContent = "";
    feedbackEl.className = "myth-feedback";
    factBox.textContent = "";
    factBox.classList.remove("visible");
    nextBtn.classList.remove("visible");

    // Randomise button order so the correct answer isn't always on the same side
    const buttons = Math.random() < 0.5
      ? [{ label: "Fact ✨", value: "fact" }, { label: "Myth 🌷", value: "myth" }]
      : [{ label: "Myth 🌷", value: "myth" }, { label: "Fact ✨", value: "fact" }];

    answerRow.innerHTML = "";
    buttons.forEach(({ label, value }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "myth-quiz-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => handleAnswer(value));
      answerRow.appendChild(btn);
    });
  }

  function handleAnswer(chosen) {
    if (answered) return;
    answered = true;

    const item    = queue[qIndex];
    const correct = chosen === item.answer;
    if (correct) score++;

    // Style buttons
    answerRow.querySelectorAll(".myth-quiz-btn").forEach(btn => {
      btn.disabled = true;
      const btnValue = btn.textContent.toLowerCase().includes("fact") ? "fact" : "myth";
      if (btnValue === chosen) {
        btn.classList.add(correct ? "selected-correct" : "selected-wrong");
      } else if (btnValue === item.answer) {
        btn.classList.add("reveal-correct");
      }
    });

    // Feedback
    feedbackEl.className = "myth-feedback " + (correct ? "correct" : "wrong");
    feedbackEl.textContent = correct ? "Correct 🌸" : "Not quite 🌷";

    // Explanation
    factBox.textContent = item.explanation;
    factBox.classList.add("visible");

    // Next button
    const isLast = qIndex >= queue.length - 1;
    nextBtn.textContent = isLast ? "See results →" : "Next →";
    nextBtn.classList.add("visible");

    updateMeta();
  }

  function showResults() {
    const total = queue.length;
    const pct   = Math.round((score / total) * 100);
    let message;
    if (pct === 100) message = "Perfect score! 🌸 You really know your body.";
    else if (pct >= 70) message = "Great work! 🌷 Keep exploring.";
    else if (pct >= 40) message = "Nice effort! 💡 Every question teaches something new.";
    else message = "Good start! 🌱 Learning about your body takes time.";

    card.querySelector(".card-body").innerHTML = `
      <div class="myth-session-done">
        <div class="myth-done-score">${score} / ${total}</div>
        <div class="myth-done-label">${message}</div>
        <button type="button" class="myth-replay-btn" id="myth-replay">Play again</button>
      </div>
      <div class="myth-progress" style="margin-top:1rem;">
        <div class="myth-progress-bar" style="width:${pct}%; background:#f59e0b;"></div>
      </div>
    `;
    document.getElementById("myth-replay").addEventListener("click", () => {
      queue  = buildQuizSession(logsByDate);
      qIndex = 0;
      score  = 0;
      // Re-grab elements after innerHTML reset
      card.querySelector(".card-body").innerHTML = `
        <div class="myth-quiz-meta" id="myth-quiz-meta"></div>
        <p class="myth-statement" id="myth-statement"></p>
        <div class="myth-answer-row" id="myth-answer-row"></div>
        <div class="myth-feedback" id="myth-feedback"></div>
        <div class="myth-fact-box" id="myth-fact-box"></div>
        <button type="button" class="myth-next-btn" id="myth-next-btn">Next →</button>
        <div class="myth-progress"><div class="myth-progress-bar" id="myth-progress-bar"></div></div>
      `;
      renderMythCard(logsByDate);
    });
  }

  nextBtn.addEventListener("click", () => {
    qIndex++;
    if (qIndex >= queue.length) {
      showResults();
    } else {
      showQuestion();
    }
  });

  showQuestion();
}

loadDashboard();

// Fire notifications after dashboard loads (cycle data computed inside loadDashboard)
getAllLogs().then(async logs => {
  const cycle = computeCyclePhase(logs);

  // Override with predictor values so notifications use the same dates as the dashboard
  const cycleStarts = cycle.cycleStarts || [];
  if (cycleStarts.length >= 1) {
    const lastPeriodStart = cycleStarts[cycleStarts.length - 1];
    let lastPeriodEndStr = lastPeriodStart;
    const d = new Date(lastPeriodStart + "T00:00:00");
    for (let i = 1; i <= 14; i++) {
      d.setDate(d.getDate() + 1);
      const key = toDateKey(d);
      if (logs[key]?.flow && logs[key].flow !== "none") {
        lastPeriodEndStr = key;
      } else { break; }
    }
    try {
      const periodStartDates = cycleStarts.map(s => new Date(s + "T00:00:00"));
      const pred = runFullPrediction(
        periodStartDates,
        new Date(lastPeriodStart + "T00:00:00"),
        new Date(lastPeriodEndStr + "T00:00:00"),
      );
      if (pred.ready) {
        if (pred.nextPeriodStart) cycle.nextPeriodDate = toDateKey(pred.nextPeriodStart);
        if (pred.futureCycles?.[0]?.fertileWindow) {
          cycle.fertileStart = toDateKey(pred.futureCycles[0].fertileWindow.start);
          cycle.fertileEnd   = toDateKey(pred.futureCycles[0].fertileWindow.end);
        }
      }
    } catch (_) {}
  }

  triggerNotifications(cycle, logs);
});
