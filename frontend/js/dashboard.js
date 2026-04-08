/**
 * dashboard.js - Goal-based dashboard
 * One screen, content adapts to selected goal + cycle phase.
 *
 * PRESENTATION + INTEGRATION LAYER ONLY.
 * This file gathers user data, passes it to the approved engine files,
 * and renders the results. It must NOT contain reproductive-health
 * calculation logic (phase, next period, fertile window, ovulation, etc.).
 *
 * Approved engines used:
 *   - cyclesML.js + cyclePhaseEngine.js  → via fetchCycleState()
 *   - bloom-cycle-engine.js              → advanced insights
 *   - bloom-anomaly-engine.js            → advanced insights
 *   - bloom-symptom-engine.js            → advanced insights
 *   - pregnancyAlgorithm.js              → pregnancy/TTC goal only
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
import { getUserGoal, goalLabel, goalDesc, isGoalAgeLocked } from "./goals.js";
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
 * Data preparation only - identifies period cluster starts from logs.
 * Used to derive cycleLengths and lastPeriodStart for passing to the approved engines.
 *
 * All reproductive-health calculations (phase, next period, fertile window,
 * ovulation, confidence) come ONLY from the approved engine files via fetchCycleState.
 * Do NOT add calculation logic here.
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

  return {
    cycleStarts,
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
  el.style.display = on ? "block" : "none";
}

// ─── Phase-based insights ─────────────────────────────────────────────────────

// Phase insights are now provided by phase-education.js (getTodaysPhaseInsight)

function getGoalTip(goal, phase) {
  const map = {
    ttc: {
      ovulation:   { t: "Ovulation occurring - peak conception timing", d: "You are at or near your estimated ovulation day. Conception likelihood is highest today and the 2 days prior." },
      ovulatory:   { t: "Ovulation occurring - peak conception timing", d: "You are at or near your estimated ovulation day. Conception likelihood is highest today and the 2 days prior." },
      follicular:  { t: "Fertile window approaching", d: "Ovulation is estimated in the coming days. Track cervical mucus and basal body temperature changes." },
      luteal:      { t: "Two-week wait", d: "If conception occurred, the earliest pregnancy tests may detect hCG around 10-14 days post-ovulation. Rest and track any early symptoms." },
      late_luteal: { t: "Testing window opening", d: "You are in the late luteal phase. If your period is late, a pregnancy test taken now may be accurate." },
      menstrual:   { t: "New cycle beginning", d: "Your fertile window is expected again in approximately 1-2 weeks as you approach ovulation." },
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


  if (rawPhase !== "unknown") {
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:0.75rem 0;gap:0.35rem;">
        <span class="phase-badge phase-${cssKey}">
          <span class="phase-dot"></span>${label} Phase
        </span>
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
      <div class="stat-number">Symptom Mode</div>
      <p class="text-muted">Log symptoms freely.</p>
      <a class="btn btn-outline" href="/pages/calendar.html" style="margin-top:0.5rem;display:inline-block;">Log today</a>
    `;
    return;
  }

  if (goal === "ttc") {
    // cycle already has resolved fertileStart/fertileEnd/ovulationDate from loadDashboard
    const fertileStart = cycle.fertileStart ?? null;
    const fertileEnd   = cycle.fertileEnd   ?? null;

    let windowBadge = "";
    let windowDates = "";
    if (fertileStart && fertileEnd) {
      windowDates = `<p class="ttc-window-dates">${formatDate(fertileStart)} → ${formatDate(fertileEnd)}</p>`;
      if (todayKey >= fertileStart && todayKey <= fertileEnd) {
        windowBadge = `<span class="ttc-window-badge ttc-window--active">Fertile window active</span>`;
      } else if (todayKey < fertileStart) {
        const dTo = diffDays(todayKey, fertileStart);
        windowBadge = `<span class="ttc-window-badge ttc-window--upcoming">Window in ${dTo} day${dTo !== 1 ? "s" : ""}</span>`;
      }
    }

    el.innerHTML = `
      ${windowDates}
      ${windowBadge}
    `;
    return;
  }

  if (goal === "pregnancy") {
    const lmp = localStorage.getItem("bloom_lmp");
    if (lmp && algoPregnancy) {
      try {
        const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
        const r = algoPregnancy.estimatedDueDate(new Date(lmp + "T00:00:00"), Number(profile.avgCycleLength) || 28);
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

// ─── Try to Conceive fertility guidance card ──────────────────────────────────

function renderTtcTools(goal, cycle, logsByDate) {
  // The whole zone is shown/hidden as one block - individual cards inside don't need show()
  const zone = document.getElementById("ttc-zone");
  const body = document.getElementById("ttc-tools-body");
  if (!zone) return;

  show(zone, goal === "ttc");
  if (goal !== "ttc") return;
  if (!body) return;

  const todayKey = toDateKey(new Date());
  const isPostOv = cycle.ovulationDate && todayKey > cycle.ovulationDate;

  // ── LEFT CARD: "Fertility Insights" ─────────────────────────────────────────
  const fertileStart = cycle.fertileStart ?? null;
  const fertileEnd   = cycle.fertileEnd   ?? null;
  const ovDate       = cycle.ovulationDate ?? null;
  const phaseKey     = cycle.phase && cycle.phase !== "unknown" ? cycle.phase : null;

  // Date/window summary block
  let dateSummary = "";
  if (ovDate || fertileStart) {
    let windowLine = "";
    if (fertileStart && fertileEnd) {
      if (todayKey >= fertileStart && todayKey <= fertileEnd) {
        windowLine = `Your fertile window is <strong>active today</strong> (${formatDate(fertileStart)} → ${formatDate(fertileEnd)}).`;
      } else if (todayKey < fertileStart) {
        const dTo = diffDays(todayKey, fertileStart);
        windowLine = `Your fertile window opens in <strong>${dTo} day${dTo !== 1 ? "s" : ""}</strong>. Track cervical mucus and BBT for additional confirmation.`;
      } else {
        windowLine = `Your fertile window closed ${diffDays(fertileEnd, todayKey)} day${diffDays(fertileEnd, todayKey) !== 1 ? "s" : ""} ago.`;
      }
    }
    dateSummary = `
      <div class="ttc-insight-item">
        ${ovDate ? `<p class="ttc-insight-body" style="margin:0 0 0.3rem;">Estimated ovulation: <strong>${formatDate(ovDate)}</strong></p>` : ""}
        ${windowLine ? `<p class="ttc-insight-body" style="margin:0;">${windowLine}</p>` : ""}
      </div>`;
  }

  // Phase tip + phase insights
  const tip = phaseKey ? getGoalTip("ttc", phaseKey) : null;
  const phaseInsights = phaseKey
    ? getTodaysPhaseInsights({ phase: phaseKey, loggedSymptoms: [], count: 1 })
    : [];
  const insightItems = [];
  if (tip) insightItems.push({ t: tip.t, d: tip.d });
  if (phaseInsights[0]) insightItems.push({ t: phaseInsights[0].title, d: phaseInsights[0].body });

  const insightHtml = insightItems.map((item) => `
    <div class="ttc-insight-item ttc-insight-item--sep">
      <strong class="ttc-insight-heading">${item.t}</strong>
      <span class="ttc-insight-body">${item.d}</span>
    </div>`).join("");

  if (!dateSummary && !insightHtml) {
    body.innerHTML = `<p class="text-muted">Log period days over 1-2 cycles to see your fertility insights.</p>`;
  } else {
    body.innerHTML = dateSummary + insightHtml;
  }

  // ── CURRENT CYCLE SNIPPET (row 2, right card) ────────────────────────────────
  const currentCycleBody = document.getElementById("ttc-current-cycle-body");
  if (currentCycleBody) {
    const cycleStarts = cycle.cycleStarts || [];
    const localLengths = [];
    for (let i = 1; i < cycleStarts.length; i++) {
      localLengths.push(diffDays(cycleStarts[i - 1], cycleStarts[i]));
    }
    if (cycleStarts.length) {
      const cards = buildCycleCards(cycleStarts, localLengths, logsByDate || {});
      currentCycleBody.innerHTML = (cards[0] || "") + `
        <a href="/pages/cycle-history.html" class="btn btn-outline ttc-history-btn">
          View entire cycle history →
        </a>`;
    } else {
      currentCycleBody.innerHTML = `<p class="text-muted">Log a period day to see your cycle history.</p>`;
    }
  }

  // ── WHEN TO TEST CARD (row 1, right card) ────────────────────────────────────
  const testBody = document.getElementById("ttc-test-body");
  if (testBody) {
    const ovDateStr = cycle.ovulationDate ?? null;
    const ovLine = ovDateStr
      ? `<p class="ttc-insight-body" style="margin-top:0.5rem;">Ovulation estimated: ${formatDate(ovDateStr)}</p>`
      : "";

    if (isPostOv && algoPregnancy && ovDateStr && cycle.nextPeriodDate) {
      // Post-ovulation: show TWW + full test guidance
      try {
        const r = algoPregnancy.whenToTest(
          new Date(ovDateStr + "T00:00:00"),
          new Date(cycle.nextPeriodDate + "T00:00:00")
        );
        const dpo = diffDays(ovDateStr, todayKey);
        const pct = Math.min(Math.round((dpo / 14) * 100), 100);
        const twwLine = dpo >= 1 && dpo <= 20
          ? `<p class="ttc-test-tww">Two-week wait · Day ${dpo}</p>
             <div class="tww-bar" style="margin-bottom:0.6rem;"><div class="tww-bar__fill" style="width:${pct}%;"></div></div>`
          : "";
        const earlyLine = r.earlyTestDate
          ? `<p class="ttc-insight-body">Early test possible from: <strong>${formatDate(toDateKey(r.earlyTestDate))}</strong></p>`
          : "";
        testBody.innerHTML = `
          ${twwLine}
          <p class="ttc-test-headline">${r.message}</p>
          ${earlyLine}
          <p class="ttc-insight-body">${r.retestMessage}</p>
          ${ovLine}`;
      } catch (_) {
        testBody.innerHTML = `<p class="ttc-test-headline">Test after a missed period</p>
          <p class="ttc-insight-body">Next expected period: <strong>${formatDate(cycle.nextPeriodDate)}</strong></p>
          ${ovLine}`;
      }
    } else if (cycle.nextPeriodDate) {
      // Pre-ovulation: show expected period + ovulation
      const d = diffDays(todayKey, cycle.nextPeriodDate);
      testBody.innerHTML = `
        <p class="ttc-test-headline">Test after a missed period</p>
        <p class="ttc-insight-body">Next expected period: <strong>${formatDate(cycle.nextPeriodDate)}</strong>${d >= 0 ? ` · in ${d} day${d !== 1 ? "s" : ""}` : ""}</p>
        ${ovLine}`;
    } else {
      testBody.innerHTML = `<p class="text-muted">Log period days to estimate when to test.</p>`;
    }
  }
}

// ─── Rotating fertility facts slideshow ───────────────────────────────────────

const _FERTILITY_FACTS = [
  { text: "Your fertile window is roughly the five days before ovulation plus ovulation day itself." },
  { text: "Tracking consistently for 2-3 cycles helps Bloom build a more accurate fertility picture." },
  { text: "Cervical mucus shifts from dry to clear and stretchy as ovulation approaches - a helpful natural sign." },
  { text: "Basal body temperature rises slightly after ovulation and can help confirm when it occurred." },
  { text: "Stress, illness, and travel can shift ovulation timing - cycle patterns may vary month to month." },
  { text: "Most pregnancy tests are most reliable from the day after a missed period." },
  { text: "Iron-rich foods like callaloo, red peas, and lentils can support overall reproductive health." },
  { text: "Managing stress has been associated with improved fertility outcomes in research." },
  { text: "Rest and community support around pregnancy are valued traditions in many Caribbean households." },
  { text: "Folate intake before conception is clinically recommended to support early fetal development." },
];

let _factsTimer = null;

// Compact slideshow for the right-column facts ticker - no show() needed, zone controls visibility
function renderFactsSlideshow(goal) {
  if (goal !== "ttc") return;
  const body = document.querySelector(".facts-slideshow-body");
  if (!body) return;

  let current = 0;
  const total = _FERTILITY_FACTS.length;

  function renderSlide(idx) {
    const fact = _FERTILITY_FACTS[idx];
    const dots = _FERTILITY_FACTS.map((_, i) =>
      `<button class="facts-dot${i === idx ? " facts-dot--active" : ""}" data-idx="${i}" aria-label="Fact ${i + 1}"></button>`
    ).join("");

    body.innerHTML = `
      <div class="fact-bubble">
        <svg class="fact-quote-icon" width="20" height="16" viewBox="0 0 30 24" fill="currentColor">
          <path d="M0 24V13.714C0 7.514 3.857 2.743 11.571 0l1.715 2.743C9.343 4.114 7.286 6.343 6.857 9.429H12V24H0zm18 0V13.714C18 7.514 21.857 2.743 29.571 0l1.715 2.743C27.343 4.114 25.286 6.343 24.857 9.429H30V24H18z"/>
        </svg>
        <p class="fact-text">${fact.text}</p>
      </div>
      <div class="facts-compact-footer">
        <div class="facts-compact-dots">${dots}</div>
        <div class="facts-compact-nav">
          <button class="facts-arrow-sm" id="facts-prev" aria-label="Previous">&#8592;</button>
          <button class="facts-arrow-sm" id="facts-next" aria-label="Next">&#8594;</button>
        </div>
      </div>
    `;

    body.querySelector("#facts-prev")?.addEventListener("click", () => {
      current = (current - 1 + total) % total;
      resetTimer(); renderSlide(current);
    });
    body.querySelector("#facts-next")?.addEventListener("click", () => {
      current = (current + 1) % total;
      resetTimer(); renderSlide(current);
    });
    body.querySelectorAll(".facts-dot").forEach(dot => {
      dot.addEventListener("click", () => {
        current = Number(dot.dataset.idx);
        resetTimer(); renderSlide(current);
      });
    });
  }

  function resetTimer() {
    if (_factsTimer) clearInterval(_factsTimer);
    _factsTimer = setInterval(() => { current = (current + 1) % total; renderSlide(current); }, 8000);
  }

  renderSlide(0);
  resetTimer();
}

// ─── Pregnancy section ────────────────────────────────────────────────────────

// Twemoji SVG images via jsDelivr CDN — renders consistently on all platforms
const _TW = (cp) => `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${cp}.svg`;

const BABY_SIZES = [
  null, null, null, null,
  { label: "sweet pea",        img: _TW("1f331") }, // 4  🌱
  { label: "sesame seed",      img: _TW("1f331") }, // 5  🌱
  { label: "sweet pea",        img: _TW("1fad9") }, // 6  🫛
  { label: "blueberry",        img: _TW("1fad0") }, // 7  🫐
  { label: "kidney bean",      img: _TW("1fad8") }, // 8  🫘
  { label: "grape",            img: _TW("1f347") }, // 9  🍇
  { label: "small orange",     img: _TW("1f34a") }, // 10 🍊
  { label: "fig",              img: _TW("1f34b") }, // 11 🍋
  { label: "lime",             img: _TW("1f34b") }, // 12 🍋
  { label: "lemon",            img: _TW("1f34b") }, // 13 🍋
  { label: "peach",            img: _TW("1f351") }, // 14 🍑
  { label: "apple",            img: _TW("1f34e") }, // 15 🍎
  { label: "avocado",          img: _TW("1f951") }, // 16 🥑
  { label: "pear",             img: _TW("1f350") }, // 17 🍐
  { label: "bell pepper",      img: _TW("1fad1") }, // 18 🫑
  { label: "mango",            img: _TW("1f96d") }, // 19 🥭
  { label: "banana",           img: _TW("1f34c") }, // 20 🍌
  { label: "carrot",           img: _TW("1f955") }, // 21 🥕
  { label: "papaya",           img: _TW("1f348") }, // 22 🍈
  { label: "large mango",      img: _TW("1f96d") }, // 23 🥭
  { label: "corn",             img: _TW("1f33d") }, // 24 🌽
  { label: "cauliflower",      img: _TW("1f966") }, // 25 🥦
  { label: "lettuce",          img: _TW("1f96c") }, // 26 🥬
  { label: "head of lettuce",  img: _TW("1f96c") }, // 27 🥬
  { label: "eggplant",         img: _TW("1f346") }, // 28 🍆
  { label: "pumpkin",          img: _TW("1f383") }, // 29 🎃
  { label: "cabbage",          img: _TW("1f96c") }, // 30 🥬
  { label: "coconut",          img: _TW("1f965") }, // 31 🥥
  { label: "large pumpkin",    img: _TW("1f383") }, // 32 🎃
  { label: "pineapple",        img: _TW("1f34d") }, // 33 🍍
  { label: "cantaloupe",       img: _TW("1f348") }, // 34 🍈
  { label: "honeydew melon",   img: _TW("1f348") }, // 35 🍈
  { label: "large coconut",    img: _TW("1f965") }, // 36 🥥
  { label: "Swiss chard",      img: _TW("1f96c") }, // 37 🥬
  { label: "leek",             img: _TW("1f955") }, // 38 🥕
  { label: "small watermelon", img: _TW("1f349") }, // 39 🍉
  { label: "watermelon",       img: _TW("1f349") }, // 40 🍉
];

// ── Pregnancy week tips ───────────────────────────────────────────────────────
// Educational tips by trimester/week range. Not medical advice.
const PREGNANCY_WEEK_TIPS = [
  { weeks: [4,  8],  tips: [
    { t: "Folic acid matters now", d: "The neural tube forms in weeks 3-6. If you haven't already, start a prenatal vitamin with at least 400mcg of folate." },
    { t: "Nausea is common", d: "Morning sickness often peaks in weeks 6-9. Small, frequent meals and ginger tea can help manage it." },
    { t: "Fatigue is normal", d: "Your body is working hard to grow a placenta. Rest when you can - this usually eases in the second trimester." },
  ]},
  { weeks: [9,  13], tips: [
    { t: "First trimester closing", d: "Many people find nausea improves after week 10-12. Energy often returns as you enter the second trimester." },
    { t: "Hydration is key", d: "Blood volume increases significantly during pregnancy. Aim for 8-10 glasses of water daily." },
    { t: "Prenatal care", d: "Your first ultrasound is typically scheduled around weeks 10-12 to confirm dating and check development." },
  ]},
  { weeks: [14, 20], tips: [
    { t: "Second trimester energy", d: "This trimester is often the most comfortable. Many experience increased energy and reduced nausea." },
    { t: "Feeling movement", d: "First-time parents often feel fetal movement (quickening) between weeks 16-25. It may feel like flutters." },
    { t: "Anatomy scan", d: "The mid-pregnancy ultrasound (typically weeks 18-22) checks fetal anatomy and development." },
  ]},
  { weeks: [21, 27], tips: [
    { t: "Growing fast", d: "Your baby is gaining weight rapidly. Increasing your iron and calcium intake can support this growth." },
    { t: "Glucose screening", d: "Gestational diabetes screening is usually done between weeks 24-28. Discuss this with your provider." },
    { t: "Kick counting", d: "From around week 24, you can start tracking fetal movements. A pattern of regular movement is reassuring." },
  ]},
  { weeks: [28, 35], tips: [
    { t: "Third trimester begins", d: "Your baby's lungs, brain, and nervous system are maturing rapidly. Braxton Hicks contractions may begin." },
    { t: "Prepare for birth", d: "Now is a good time to attend birth preparation classes and discuss your birth preferences with your provider." },
    { t: "Rest positions matter", d: "Sleeping on your left side improves blood flow to the baby. Use pillows for support." },
  ]},
  { weeks: [36, 40], tips: [
    { t: "Nearly there", d: "Your baby is considered full term from week 39. They are likely head-down and preparing for birth." },
    { t: "Signs of labour", d: "Watch for regular contractions, water breaking, or bloody show. Contact your provider if these occur." },
    { t: "Nesting instinct", d: "Increased energy and urge to prepare the home is common late in pregnancy. Take care not to overdo it." },
  ]},
];

function getPregnancyWeekTips(week) {
  if (!week) return [];
  const match = PREGNANCY_WEEK_TIPS.find(({ weeks }) => week >= weeks[0] && week <= weeks[1]);
  return match ? match.tips : [{ t: "Stay in touch with your provider", d: "Regular antenatal visits are important throughout pregnancy. Track any new symptoms and share them at your appointments." }];
}

// ── Pregnancy symptom insights (uses logged symptoms) ────────────────────────
const PREGNANCY_SYMPTOM_MAP = {
  // Bleeding
  VAGINAL_BLEEDING:     { label: "Bleeding", note: "Any vaginal bleeding in pregnancy should be reported to your provider promptly, even if light." },
  SPOTTING:             { label: "Spotting", note: "Light spotting can occur in early pregnancy from implantation or cervical sensitivity. Always mention it to your provider." },
  HEAVY_FLOW:           { label: "Heavy bleeding", note: "Heavy bleeding during pregnancy requires prompt medical attention. Contact your provider or go to emergency care." },
  LARGE_CLOTS:          { label: "Blood clots", note: "Passing clots during pregnancy should always be assessed by your healthcare provider right away." },
  // Pain
  CRAMPS:               { label: "Cramping", note: "Mild cramping can be normal as the uterus stretches. Sharp, persistent, or one-sided pain should be assessed by your provider." },
  PELVIC_PAIN:          { label: "Pelvic pain", note: "Pelvic girdle pain is common as ligaments loosen. A support belt or prenatal physiotherapy can help. Severe pain warrants a check-up." },
  HEADACHE:             { label: "Headaches", note: "Common in pregnancy due to hormonal changes and increased blood volume. Stay hydrated and rest. Persistent or severe headaches should be checked." },
  JOINT_PAIN:           { label: "Joint pain", note: "Relaxin hormone loosens joints in preparation for birth, which can cause aching. Gentle movement and warm compresses help." },
  BREAST_TENDERNESS:    { label: "Breast tenderness", note: "Increased blood flow and hormones cause breast changes throughout pregnancy. A well-fitted, supportive bra makes a difference." },
  OVULATION_PAIN:       { label: "Pelvic twinges", note: "Round ligament pain — sharp twinges in the lower abdomen — is common as the uterus grows. Changing positions slowly can help." },
  // Digestive
  BLOATING:             { label: "Bloating", note: "Progesterone slows digestion, causing gas and bloating. Smaller meals and gentle movement can help." },
  GASSY:                { label: "Gas", note: "Increased gas is common throughout pregnancy. Eating slowly, avoiding carbonated drinks, and light walks after meals can ease it." },
  HEARTBURN:            { label: "Heartburn", note: "The growing uterus pushes stomach acid up. Smaller meals, avoiding lying down after eating, and sleeping with your head elevated can help." },
  NAUSEA:               { label: "Nausea", note: "Very common especially in the first trimester. Small, frequent meals and ginger can help. Severe or persistent vomiting (hyperemesis) warrants a call to your provider." },
  CONSTIPATION:         { label: "Constipation", note: "Iron supplements and progesterone slow the gut. Increase fibre, water, and gentle activity to help keep things moving." },
  DIARRHEA:             { label: "Diarrhoea", note: "Can occur in pregnancy due to hormonal changes or diet. Stay well hydrated and contact your provider if it persists." },
  // Discharge
  DISCHARGE_EGGWHITE:   { label: "Discharge changes", note: "Increased clear or white discharge is normal in pregnancy. Unusual colour, odour, or itching should be assessed." },
  DISCHARGE_CREAMY:     { label: "Creamy discharge", note: "Increased creamy discharge is common and normal. If it has an unusual smell or causes itching, check with your provider." },
  UNUSUAL_DISCHARGE:    { label: "Unusual discharge", note: "Any discharge that is yellow, green, or foul-smelling should be reported to your provider to rule out infection." },
  // Physical
  FATIGUE:              { label: "Fatigue", note: "Extremely common especially in the first and third trimesters. Prioritise rest, accept help, and eat iron-rich foods to support energy levels." },
  FLUID_RETENTION:      { label: "Swelling", note: "Mild swelling in legs and feet is common later in pregnancy. Sudden or severe swelling in the face or hands should be reported to your provider." },
  FREQUENT_URINATION:   { label: "Frequent urination", note: "Normal as the uterus grows and presses on the bladder. Reduce fluids in the evening if it disrupts sleep, but stay hydrated during the day." },
  WEIGHT_CHANGE:        { label: "Weight changes", note: "Steady weight gain is expected during pregnancy. Your provider will monitor this at each visit to ensure it's on track for you." },
  NASAL_CONGESTION:     { label: "Nasal congestion", note: "Pregnancy rhinitis — a stuffy nose caused by increased blood flow — is common. A humidifier and saline spray can help." },
  SMELL_SENSITIVITY:    { label: "Smell sensitivity", note: "Heightened sense of smell is very common in the first trimester and often linked to nausea. Avoiding strong scents where possible can help." },
  // Skin & Hair
  ACNE:                 { label: "Acne", note: "Hormonal changes can trigger breakouts. Gentle cleansers are best — avoid strong actives like retinoids during pregnancy." },
  DRY_SKIN:             { label: "Dry skin", note: "Skin stretching and hormonal shifts can cause dryness and itching. Fragrance-free moisturisers help, and staying hydrated matters too." },
  HAIR_THINNING:        { label: "Hair changes", note: "Some people experience hair thinning during pregnancy while others notice thicker hair. Postpartum hair shedding is also very common." },
  // Temperature
  HOT_FLASHES:          { label: "Feeling hot", note: "Increased metabolic rate and blood volume can make you feel overheated. Wear breathable fabrics, stay cool, and stay hydrated." },
  NIGHT_SWEATS:         { label: "Night sweats", note: "Hormonal shifts can cause night sweats, especially in the third trimester. Light bedding and a cool room can help." },
  // Cognitive
  BRAIN_FOG:            { label: "Brain fog", note: "Often called 'pregnancy brain', forgetfulness and difficulty concentrating are common and caused by hormonal and sleep changes." },
  FORGETFUL:            { label: "Forgetfulness", note: "Memory lapses during pregnancy are normal. Lists, reminders, and routines can help manage this." },
  POOR_CONCENTRATION:   { label: "Poor concentration", note: "Difficulty focusing is common throughout pregnancy. Rest, good nutrition, and reducing unnecessary stressors all support cognitive function." },
  // Mood
  MOOD_SWINGS:          { label: "Mood swings", note: "Hormonal fluctuations cause rapid emotional shifts throughout pregnancy. Connection, rest, and talking to someone you trust all help." },
  IRRITABILITY:         { label: "Irritability", note: "Feeling irritable is very common in pregnancy, driven by hormonal changes, discomfort, and disrupted sleep. Rest and boundaries matter." },
  ANXIETY:              { label: "Anxiety", note: "Worry about pregnancy and birth is common. Talking to someone you trust, prenatal yoga, or speaking with your midwife can all support your wellbeing." },
  DEPRESSION:           { label: "Low mood", note: "Prenatal depression affects many people and is treatable. Please speak with your provider or midwife — you do not have to manage this alone." },
  CRYING_SPELLS:        { label: "Crying spells", note: "Emotional sensitivity and tearfulness are very common in pregnancy. Hormonal changes are usually responsible, but if it feels overwhelming, speak to your provider." },
  STRESSED:             { label: "Stress", note: "Some stress is normal, but chronic stress can affect sleep and wellbeing. Breathing exercises, support from loved ones, and rest all help." },
  // Sleep
  INSOMNIA:             { label: "Sleep difficulty", note: "Common in all trimesters for different reasons — nausea, back pain, or anxiety. A body pillow, cool room, and wind-down routine can support better sleep." },
  // Appetite
  CRAVING_SWEET:        { label: "Sweet cravings", note: "Food cravings are very common in pregnancy. Satisfying them in moderation while maintaining balanced nutrition is a reasonable approach." },
  CRAVING_SALTY:        { label: "Salty cravings", note: "Salt cravings can occur as blood volume increases. Balance them with nutritious whole foods and adequate hydration." },
  CRAVING_GREASY:       { label: "Greasy food cravings", note: "Cravings for comfort foods are normal. Listen to your body while keeping a varied, nutritious diet overall." },
  CRAVING_SPICY:        { label: "Spicy food cravings", note: "Spicy food cravings are common — just be mindful of heartburn, which spicy foods can worsen during pregnancy." },
  APPETITE_INCREASE:    { label: "Increased appetite", note: "Increased hunger, especially in the second trimester, is normal as your baby grows rapidly. Focus on nutrient-dense foods." },
  APPETITE_DECREASE:    { label: "Decreased appetite", note: "Reduced appetite is common in the first trimester due to nausea. Eat small amounts often and focus on what you can tolerate." },
  // Reproductive
  VAGINAL_DRYNESS:      { label: "Vaginal dryness", note: "Can occur due to hormonal shifts. A water-based lubricant is safe to use during pregnancy if needed." },
  PAIN_DURING_SEX:      { label: "Discomfort during sex", note: "Common as the body changes. Many positions become uncomfortable — communication with your partner and trying different positions can help." },
  CERVICAL_MUCUS_CHANGE:{ label: "Cervical mucus changes", note: "Increased discharge throughout pregnancy is normal as the body maintains the mucus plug. Report any sudden gush of fluid to your provider." },
};

function renderPregnancySymptomInsights(logsByDate, week, lmp) {
  const body = document.getElementById("pregnancy-symptom-body");
  if (!body) return;

  // db.js stores symptoms as human-readable labels ("Nausea"), so convert
  // each to an uppercase code ("NAUSEA") before looking up in the map.
  const labelToCode = label =>
    String(label || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

  // Determine trimester date range from LMP so we scan the whole trimester
  const todayKey = toDateKey(new Date());
  let trimesterStartKey = todayKey;
  if (lmp && week) {
    const lmpMs = new Date(lmp + "T00:00:00").getTime();
    // Trimester boundaries in weeks: T1=1-12, T2=13-26, T3=27+
    const trimesterStartWeek = week <= 12 ? 1 : week <= 26 ? 13 : 27;
    const startMs = lmpMs + (trimesterStartWeek - 1) * 7 * 86400000;
    trimesterStartKey = toDateKey(new Date(startMs));
  }

  // Collect every unique symptom logged from trimester start to today
  const trimesterSymptoms = new Set();
  for (const [dk, entry] of Object.entries(logsByDate)) {
    if (dk < trimesterStartKey || dk > todayKey) continue;
    (entry.symptoms ?? []).forEach(s => trimesterSymptoms.add(labelToCode(s)));
  }

  const matched = [...trimesterSymptoms]
    .map(s => PREGNANCY_SYMPTOM_MAP[s])
    .filter(Boolean);

  if (!matched.length) {
    const genericTip = week && week <= 12
      ? "In the first trimester, common experiences include nausea, fatigue, and breast tenderness. Log your symptoms to receive personalised insights here."
      : week && week <= 26
      ? "The second trimester often brings more energy. Log any symptoms you notice and they will appear here with context."
      : "Log your daily symptoms in the calendar and they will appear here with pregnancy-specific context.";
    body.innerHTML = `<p class="text-muted preg-insight-body">${genericTip}</p><a class="btn btn-outline btn-log-today" href="/pages/calendar.html">Log today</a>`;
    return;
  }

  const trimesterLabel = week ? (week <= 12 ? "First trimester" : week <= 26 ? "Second trimester" : "Third trimester") : "This trimester";
  const tags = matched.map(m => `<span class="preg-symptom-tag">${m.label}</span>`).join("");

  body.innerHTML = `
    <p class="preg-insight-body" style="margin-bottom:0.5rem;">Logged during your ${trimesterLabel}:</p>
    <div class="preg-symptom-tags">${tags}</div>
    ${matched.map(m => `
      <div class="preg-insight-item">
        <span class="preg-insight-title">${m.label}</span>
        <span class="preg-insight-body">${m.note}</span>
      </div>`).join("")}
  `;
}

function renderPregnancyTools(goal, logsByDate) {
  const card = document.getElementById("pregnancy-tools");
  const body = document.getElementById("pregnancy-tools-body");
  const insightsZone = document.getElementById("pregnancy-insights");
  if (!card || !body) return;

  const isPreg = goal === "pregnancy";
  show(card, isPreg);
  document.body.classList.toggle("goal-pregnancy", isPreg);
  if (!isPreg) {
    if (insightsZone) insightsZone.style.display = "none";
    return;
  }

  const lmp = localStorage.getItem("bloom_lmp");

  if (!lmp || !algoPregnancy) {
    if (insightsZone) insightsZone.style.display = "none";
    body.innerHTML = `
      <p class="text-muted">Add your last menstrual period (LMP) date in your profile to see your due date, trimester, and weekly milestones.</p>
      <a class="btn btn-primary" href="/pages/profile-view.html" style="margin-top:0.75rem;display:inline-block;">Add LMP date</a>
    `;
    return;
  }

  if (insightsZone) insightsZone.style.display = "grid";

  let week = null;
  try {
    const profile = JSON.parse(localStorage.getItem("bloom_profile") || "{}");
    const cycleLen = Number(profile.avgCycleLength) || 28;
    // Parse LMP as local midnight to avoid UTC-offset shifting the date
    const lmpDate = new Date(lmp + "T00:00:00");
    console.log(`[pregnancy] LMP stored: ${lmp} → parsed: ${lmpDate.toDateString()} → daysAgo: ${Math.floor((Date.now() - lmpDate) / 86400000)}`);
    const r = algoPregnancy.estimatedDueDate(lmpDate, cycleLen);
    week = r.currentWeek;
    const size = week >= 4 && week <= 40 ? BABY_SIZES[week] : null;

    body.innerHTML = `
      ${size ? `
        <div class="baby-size-display">
          <img class="baby-size-img" src="${size.img}" alt="${size.label}" />
          <div class="baby-size-label">Your baby is the size of a ${size.label}</div>
          <div class="baby-size-week">Week ${week}</div>
        </div>` : ""}
      <div class="insight-item"><strong>EDD:</strong> ${formatDate(toDateKey(r.eddAdjusted))}${cycleLen !== 28 ? ` <span class="text-muted">(adjusted for ${cycleLen}-day cycle)</span>` : ""}</div>
      <div class="insight-item"><strong>Trimester:</strong> ${r.trimesterLabel ?? "-"} &bull; <strong>Week:</strong> ${week ?? "-"} &bull; <strong>Weeks remaining:</strong> ${r.weeksRemaining ?? "-"}</div>
      `;
  } catch (_) {
    body.innerHTML = `<p class="text-muted">Could not calculate due date. Check your LMP date in your profile.</p>`;
  }

  // Week tips card
  const weekTipsBody = document.getElementById("pregnancy-week-tips-body");
  if (weekTipsBody) {
    const tips = getPregnancyWeekTips(week);
    const weekBadge = week ? `<div class="preg-week-badge">Week ${week}</div>` : "";
    weekTipsBody.innerHTML = weekBadge + tips.map(tip => `
      <div class="preg-insight-item">
        <span class="preg-insight-title">${tip.t}</span>
        <span class="preg-insight-body">${tip.d}</span>
      </div>`).join("");
  }

  // Symptom insights card
  renderPregnancySymptomInsights(logsByDate ?? {}, week, lmp);
}

// ─── Symptom section ──────────────────────────────────────────────────────────

async function renderSymptomTools(goal, logsByDate, cycle) {
  const card = document.getElementById("symptom-tools");
  const body = document.getElementById("symptom-tools-body");
  const subtitle = document.getElementById("symptom-tools-subtitle");
  if (!card || !body) return;

  const on = goal === "no_period" || goal === "perimenopause";
  document.body.classList.toggle("goal-no-period", goal === "no_period");
  document.body.classList.toggle("goal-perimenopause", goal === "perimenopause");
  show(card, on);
  if (!on) return;

  // Use cyclePhaseEngine.js directly to get phase from logs (works without sign-in)
  let phase = cycle?.phase && cycle.phase !== "unknown" ? cycle.phase : null;
  let phaseLabel = cycle?.phaseLabel ?? null;
  if (!phase) {
    try {
      const { computeCyclePhaseML } = await import("../../backend/ml/inference/cyclePhaseEngine.js");
      const trimLogs = Object.fromEntries(
        Object.entries(logsByDate).filter(([, v]) => v?.flow && v.flow !== "none")
      );
      const result = computeCyclePhaseML(trimLogs);
      if (result?.phase && result.phase !== "unknown") {
        phase = result.phase;
        phaseLabel = result.phaseLabel ?? null;
      }
    } catch (_) {}
  }
  // Normalize late_luteal/ovulatory to engine keys
  const displayPhaseLabel = phaseLabel ?? (phase ? phase.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) : null);
  if (subtitle) {
    subtitle.textContent = phase
      ? `Based on your logs · ${displayPhaseLabel} Phase`
      : "Based on your recent logs";
  }

  // Build logged symptoms in engine format: [{code, severity}]
  // Use the most recently logged day within the last 7 days, not strictly today.
  const labelToCode = s => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const todayKey = toDateKey(new Date());

  let recentEntry = null;
  for (let d = 0; d < 7; d++) {
    const dk = addDaysStr(todayKey, -d);
    if (logsByDate[dk]?.symptoms?.length) { recentEntry = logsByDate[dk]; break; }
  }
  const todaySyms = recentEntry
    ? (recentEntry.symptoms ?? []).map(s => ({
        code: labelToCode(s),
        severity: recentEntry.symptomSeverity?.[s] ?? 3,
      }))
    : [];

  // Build symptom history in engine format for the last 90 days
  const symptomHistory = [];
  for (let d = 0; d < 90; d++) {
    const dk = addDaysStr(todayKey, -d);
    const entry = logsByDate[dk];
    if (!entry?.symptoms?.length) continue;
    symptomHistory.push({
      dateKey: dk,
      items: entry.symptoms.map(s => ({
        code: labelToCode(s),
        severity: entry.symptomSeverity?.[s] ?? 3,
      })),
    });
  }

  if (!symptomHistory.length) {
    body.innerHTML = `
      <p class="text-muted">No symptoms logged yet. Open the calendar to start tracking.</p>
      <a class="btn btn-outline btn-log-today" href="/pages/calendar.html">Open calendar</a>
    `;
    return;
  }

  if (!algoSymptomEngine) {
    body.innerHTML = `<p class="text-muted">Symptom engine loading — please refresh.</p>`;
    return;
  }

  // Normalize phase to engine's known keys (late_luteal and ovulatory map to luteal/ovulation)
  const ENGINE_PHASE_MAP = { late_luteal: "luteal", ovulatory: "ovulation" };
  const enginePhase = ENGINE_PHASE_MAP[phase] ?? phase ?? null;

  const signals = algoSymptomEngine.generateSymptomSignals({
    loggedSymptoms:  todaySyms,
    phase:           enginePhase,
    dayOfCycle:      cycle?.dayInCycle ?? null,
    cycleLengths:    [],
    cycleCount:      Math.max(cycle?.cyclesLogged ?? 0, symptomHistory.length > 0 ? 2 : 0),
    symptomHistory,
    today:           new Date(),
  });

  // If engine returned no visible signals but symptoms are logged,
  // fall back to showing phase-context for each logged symptom using SYMPTOM_PHASE_MAP.
  const levelColor = { high: "var(--color-danger)", medium: "var(--color-warning)", low: "var(--color-text-muted)" };

  if (signals.length) {
    body.innerHTML = signals.map(s => `
      <div class="preg-insight-item">
        <span class="preg-insight-title" style="color:${levelColor[s.level] ?? "var(--color-primary-dark)"};">${s.title}</span>
        <span class="preg-insight-body">${s.message}${s.guidance ? ` ${s.guidance}` : ""}</span>
      </div>`).join("");
    return;
  }

  // Fallback: use SYMPTOM_PHASE_MAP from the engine to show per-symptom context
  const phaseMap = algoSymptomEngine.SYMPTOM_PHASE_MAP;
  const expectedSet   = new Set(enginePhase ? (phaseMap[enginePhase]?.expected   ?? []) : []);
  const unexpectedSet = new Set(enginePhase ? (phaseMap[enginePhase]?.unexpected ?? []) : []);

  const allRecentCodes = new Set();
  symptomHistory.slice(0, 7).forEach(e => e.items?.forEach(i => allRecentCodes.add(i.code)));
  todaySyms.forEach(i => allRecentCodes.add(i.code));

  if (!allRecentCodes.size) {
    body.innerHTML = `<p class="text-muted">No recent symptoms found. Open the calendar to log symptoms.</p><a class="btn btn-outline btn-log-today" href="/pages/calendar.html">Open calendar</a>`;
    return;
  }

  const detailForSymptom = (code) => {
    const DETAIL_MAP = {
      BREAST_TENDERNESS: {
        why: "Breast tenderness often rises with hormone shifts, especially progesterone changes around ovulation and the luteal phase.",
        tip: "A supportive bra, less caffeine, and warm compresses can reduce discomfort.",
      },
      IRRITABILITY: {
        why: "Irritability is often linked to sleep disruption, stress load, and premenstrual hormone shifts.",
        tip: "Protect sleep, eat consistently, and log triggers so recurring patterns are easier to manage.",
      },
      HEARTBURN: {
        why: "Heartburn can rise around cycle transitions because progesterone can slow digestion.",
        tip: "Smaller meals, less late-night eating, and staying upright after meals can help.",
      },
      NAUSEA: {
        why: "Nausea can appear with hormonal shifts, pain flares, poor sleep, or digestive sensitivity.",
        tip: "Hydration and small frequent meals help; persistent or severe nausea should be medically reviewed.",
      },
      CRAMPS: {
        why: "Cramps are driven by uterine prostaglandins and often peak in early menstrual days.",
        tip: "Heat, gentle movement, hydration, and timely pain relief can make symptoms easier to handle.",
      },
      PELVIC_PAIN: {
        why: "Pelvic pain can be cycle-linked, especially around bleeding days or ovulation timing.",
        tip: "Track location and severity; worsening, severe, or one-sided pain should be checked.",
      },
      BLOATING: {
        why: "Bloating is common when progesterone slows gut motility and fluid shifts increase.",
        tip: "Hydration, lower sodium intake, and light movement can reduce pressure and discomfort.",
      },
      FATIGUE: {
        why: "Cycle-linked fatigue often appears when sleep quality dips or during late luteal and menstrual days.",
        tip: "Prioritize sleep consistency and iron-rich foods, especially if your flow is heavy.",
      },
      ANXIETY: {
        why: "Anxiety symptoms can intensify around hormonal transitions and cumulative stress.",
        tip: "Breathing routines, sleep consistency, and tracking timing can help identify triggers.",
      },
      LOW_MOOD: {
        why: "Low mood can increase when estrogen and progesterone fall in late luteal days.",
        tip: "Track mood with cycle timing; persistent low mood should be discussed with a clinician.",
      },
      SPOTTING: {
        why: "Spotting may happen with ovulation timing, hormonal fluctuations, or cycle disruption.",
        tip: "Track amount, timing, and accompanying symptoms to identify if a repeat pattern is forming.",
      },
      HEAVY_FLOW: {
        why: "Heavy flow can increase fatigue and pain burden and may affect cycle predictions.",
        tip: "Log flow intensity daily; soaking products rapidly needs urgent medical care.",
      },
    };

    if (DETAIL_MAP[code]) return DETAIL_MAP[code];

    if (code.includes("DISCHARGE") || code.includes("CERVICAL_MUCUS")) {
      return {
        why: "Discharge changes often reflect normal hormone shifts across the cycle.",
        tip: "Track color, texture, and timing; sudden odor, irritation, or pain should be checked.",
      };
    }
    if (code.includes("CRAVING") || code.includes("APPETITE")) {
      return {
        why: "Cravings and appetite changes are common with hormonal and energy fluctuations.",
        tip: "Regular balanced meals can reduce sharp hunger swings and energy crashes.",
      };
    }
    if (code.includes("MOOD") || ["CRYING_SPELLS", "STRESSED", "WITHDRAWN", "SOCIABLE"].includes(code)) {
      return {
        why: "Mood and social energy can shift significantly across cycle phases.",
        tip: "Tracking timing helps separate cycle-linked changes from day-to-day stress.",
      };
    }
    if (code.includes("PAIN") || code === "JOINT_OR_MUSCLE_PAIN") {
      return {
        why: "Pain symptoms can cluster around menstruation or ovulation windows.",
        tip: "Log location and intensity to identify predictable patterns and escalation points.",
      };
    }

    return {
      why: "This symptom can be cycle-linked, but its meaning is clearest when viewed as a repeating trend.",
      tip: "Keep logging timing and intensity so Bloom can personalize insights for your pattern.",
    };
  };

  const severityLabel = (avg) => {
    if (!Number.isFinite(avg)) return null;
    if (avg <= 2.0) return "mild";
    if (avg <= 3.3) return "moderate";
    if (avg <= 4.2) return "elevated";
    return "high";
  };

  const statsByCode = new Map();
  const cutoff14 = addDaysStr(todayKey, -13);
  for (const day of symptomHistory) {
    for (const item of (day.items || [])) {
      const code = item.code;
      const sev = Number(item.severity ?? 3);
      const stat = statsByCode.get(code) || {
        count14: 0,
        sev14Sum: 0,
        sev14Count: 0,
      };
      if (day.dateKey >= cutoff14) {
        stat.count14 += 1;
        stat.sev14Sum += sev;
        stat.sev14Count += 1;
      }
      statsByCode.set(code, stat);
    }
  }

  const codeToLabel = code => code.replace(/_/g, " ").toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());

  const items = [...allRecentCodes]
    .sort((a, b) => (statsByCode.get(b)?.count14 ?? 0) - (statsByCode.get(a)?.count14 ?? 0))
    .map(code => {
      const stats = statsByCode.get(code);
      const avg14 = stats?.sev14Count ? (stats.sev14Sum / stats.sev14Count) : null;
      const sevText = severityLabel(avg14);
      const frequency = stats?.count14
        ? `Logged ${stats.count14} time${stats.count14 !== 1 ? "s" : ""} in the last 14 days${sevText ? ` (${sevText} intensity)` : ""}.`
        : "Logged recently.";

      const isUnexpected = unexpectedSet.has(code);
      const isExpected   = expectedSet.has(code);
      const badge = isUnexpected
        ? `<span class="sym-badge sym-badge--warn">worth noting</span>`
        : isExpected
        ? `<span class="sym-badge sym-badge--typical">typical for this phase</span>`
        : "";

      const detail = detailForSymptom(code);
      const phaseContext = isUnexpected && phase
        ? `It is less typical in the ${phaseLabel ?? phase} phase, so watch for persistence or escalation.`
        : isExpected && phase
        ? `It is commonly seen in the ${phaseLabel ?? phase} phase.`
        : phase
        ? `Phase context is mixed in the ${phaseLabel ?? phase} phase, so multi-cycle trend matters most.`
        : "";

      const context = [frequency, detail.why, phaseContext, detail.tip].filter(Boolean).join(" ");

      return `
      <div class="preg-insight-item">
        <span class="preg-insight-title">${codeToLabel(code)}${badge}</span>
        <span class="preg-insight-body">${context}</span>
      </div>`;
    });

  body.innerHTML = items.join("");
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
    const subtitle = `${formatDate(start)} - ${isCurrent ? "present" : formatDate(cycleEndKey)}`;

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

  // Marker colours: red if outside typical 21-35 day range
  const markerColors = cycleLengths.map((l) => (l < 21 || l > 35 ? "#e05c7a" : "#D4749A"));

  Plotly.newPlot(canvas, [
    // ── Typical range ribbon (21-35 days) ──
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
      name: "Typical range (21-35d)",
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

  const signals = [];

  const today          = new Date();
  const lastPeriodDate = lastPeriodStart ? new Date(lastPeriodStart + "T00:00:00") : null;
  const lastLogDateObj = lastLogDate     ? new Date(lastLogDate     + "T00:00:00") : null;
  const nextWindow     = cycle.nextPeriodDate ? {
    start: new Date(cycle.nextPeriodDate + "T00:00:00"),
    end:   new Date(addDaysStr(cycle.nextPeriodDate, 5) + "T00:00:00"),
  } : null;

  // Cycle engine
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
    } catch (e) {
      console.warn("[dashboard] cycle engine error:", e.message);
    }
  }

  // Anomaly engine (requires ≥ 4 cycle lengths)
  if (algoAnomalyEngine && cycleLengths.length >= 4) {
    try {
      const anomalyResult = algoAnomalyEngine.generateAnomalySignals({
        actualCycleLengths:   cycleLengths,
        predictedCycleLength: mlPredictedCycleLength,
      });
      signals.push(...(anomalyResult.shownSignals || []));
    } catch (e) {
      console.warn("[dashboard] anomaly engine error:", e.message);
    }
  }

  // Symptom engine
  if (algoSymptomEngine && logsByDate) {
    try {
      const todayKey   = toDateKey(today);
      const todayLog   = logsByDate[todayKey] || {};
      const rawSymptoms = todayLog.symptoms || [];
      const loggedSymptoms = rawSymptoms.map(code => ({
        code,
        severity: todayLog.symptomSeverity?.[code] ?? 3,
      }));
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
        phase:           cycle.phase,
        dayOfCycle:      cycle.dayInCycle,
        cycleLengths,
        cycleCount:      (cycle.cycleStarts || []).length,
        symptomHistory,
        lastPeriodStart: lastPeriodDate,
        today,
      });
      signals.push(...symptomSignals);
    } catch (e) {
      console.warn("[dashboard] symptom engine error:", e.message);
    }
  }

  // ── Basic avg-cycle outlier flags (all goals) ──
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
  }).join("");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function loadDashboard() {
  const goal = getUserGoal();
  // ── Age-lock gate ─────────────────────────────────────────────────────────────
  // Try to Conceive, Track Pregnancy, and Track Perimenopause are 18+ goals.
  // If the user is under 18 and somehow reaches one, show a graceful locked state.
  if (isGoalAgeLocked(goal)) {
    const goalNames = { ttc: "Try to Conceive", pregnancy: "Track Pregnancy", perimenopause: "Track Perimenopause" };
    const goalName = goalNames[goal] || "this goal";
    const main = document.querySelector("main") || document.body;
    main.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:60vh;padding:2rem;text-align:center;gap:1rem;
      ">
        <div style="
          width:64px;height:64px;border-radius:50%;
          background:var(--color-primary-light,#fce4ec);
          display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem;
        ">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary,#e91e63)" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h2 style="margin:0;font-size:1.4rem;color:var(--color-text);">${goalName}</h2>
        <p style="margin:0;color:var(--color-text-muted);max-width:340px;line-height:1.6;font-size:0.95rem;">
          This goal is available to users aged 18 and older. You can switch to a different goal from your profile.
        </p>
        <a href="/pages/profile.html" class="btn btn-primary" style="margin-top:0.5rem;">Change goal</a>
      </div>`;
    return;
  }

  // Load modules and logs in parallel so initial dashboard work starts sooner.
  const moduleImportsPromise = Promise.all([
    import("./algorithms/pregnancyAlgorithm.js").catch(() => null),
    import("./algorithms/bloom-cycle-engine.js").catch(() => null),
    import("./algorithms/bloom-symptom-engine.js").catch(() => null),
    import("./algorithms/bloom-anomaly-engine.js").catch(() => null),
  ]);

  const logsByDate = await getAllLogs();
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
  } else {
    _cycleStatePromise = Promise.resolve(null);
  }

  // Complete module loading while cycle state is being resolved.
  [algoPregnancy, algoCycleEngine, algoSymptomEngine, algoAnomalyEngine] =
    await moduleImportsPromise;

  if (lastPeriodStart) {
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
      if (state.nextPeriodDate)     cycle.nextPeriodDate = state.nextPeriodDate;
      if (state.ovulationDate)      cycle.ovulationDate  = state.ovulationDate;
      if (state.fertileStart)       cycle.fertileStart   = state.fertileStart;
      if (state.fertileEnd)         cycle.fertileEnd     = state.fertileEnd;
      if (state.futureCycles?.length) cycle.futureCycles = state.futureCycles;
      if (state.source === "local") {
        console.log("[dashboard] using local fallback state = backend unavailable or anon mode");
      }
    }

    // FutureCycles resolution is now handled centrally in cycle-state.js
    // (_resolveFutureCycles runs on every fetchCycleState result before caching).
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
          ${cycle.avgCycleLength ? `Avg cycle: ${cycle.avgCycleLength} days` : ""}
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

  // Stamp goal class on body so CSS can hide/show TTC-specific elements
  document.body.classList.toggle("goal-ttc", goal === "ttc");

  renderPhaseCard(cycle);
  renderGoalToolCard(goal, cycle);
  renderTtcTools(goal, cycle, logsByDate);
  renderFactsSlideshow(goal);
  renderPregnancyTools(goal, logsByDate);
  renderSymptomTools(goal, logsByDate, cycle);
  renderCycleHistoryAndChart(cycle, logsByDate);

  // Append unified estimate note to the three top cards (always last)

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

  // Advanced insights (algorithm-powered, goal-gated)
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
