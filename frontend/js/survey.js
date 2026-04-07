import { isAnonMode } from "./mode.js";
import { setUserGoal } from "./goals.js";
import { getIdToken } from "./auth.js";

export function Survey() {
  return `
    <section class="survey-page">
      <div class="survey-shell">
        <div class="survey-card card">

          <div class="survey-appbar">
            <button class="survey-linkbtn" id="surveyBackTop" type="button" aria-label="Back">←</button>

            <div class="survey-brand">
              <div class="survey-brand__dot">🩷</div>
              <div class="survey-brand__name">Bloom</div>
            </div>

            <button class="survey-linkbtn" id="btnSkipTop" type="button">Skip</button>
          </div>

          <div class="survey-progress" aria-label="Setup progress">
            <div id="surveyBar" class="survey-progress__bar" style="width:12%"></div>
          </div>

          <div class="survey-meta">
            <span id="surveyStepTag" class="survey-chip">Step 1 of 11</span>
            <span id="surveyHint" class="survey-hint"></span>
          </div>

          <div id="surveyBody" class="survey-body"></div>

          <div class="survey-actions">
            <button class="btn" id="btnBack" type="button">Back</button>
            <button class="btn btn-primary primary survey-next" id="btnNext" type="button">Next</button>
          </div>

          <p class="tiny-note" style="margin-top:10px; opacity:0.85;">
            Bloom doesn’t diagnose. We use your answers to tailor your dashboard, tips, and Bloomie suggestions.
          </p>

        </div>
      </div>
    </section>
  `;
}

export function mountSurvey() {
  // If already onboarded, skip to dashboard
  if (localStorage.getItem("bloom_onboarded") === "1") {
    window.location.href = "/pages/dashboard.html";
    return;
  }

  const body = document.getElementById("surveyBody");
  const tag = document.getElementById("surveyStepTag");
  const hint = document.getElementById("surveyHint");
  const bar = document.getElementById("surveyBar");
  const btnBack = document.getElementById("btnBack");
  const btnNext = document.getElementById("btnNext");
  const btnSkipTop = document.getElementById("btnSkipTop");
  const topBack = document.getElementById("surveyBackTop");

  if (!body || !tag || !bar || !btnBack || !btnNext || !btnSkipTop || !topBack) return;

  const answers = loadAnswers();

  let steps = buildSteps(answers);
  let stepIndex = 0;

  function rebuildStepsKeepPosition() {
    const prevKey = steps[stepIndex]?.key;
    steps = buildSteps(answers);
    const newIndex = steps.findIndex((s) => s.key === prevKey);
    stepIndex = newIndex >= 0 ? newIndex : Math.min(stepIndex, steps.length - 1);
  }

  function readCurrentStepInputs() {
    const current = steps[stepIndex];
    if (!current) return;

    if (current.type === "multi") {
      const selected = Array.from(
        document.querySelectorAll(`input[name="${current.key}[]"]:checked`)
      ).map((el) => el.value);
      answers[current.key] = selected;
      return;
    }

    if (current.type === "range") {
      const el = document.getElementById(current.key);
      if (el) answers[current.key] = String(el.value);
      return;
    }

    if (current.type === "select") {
      const el = document.getElementById(current.key);
      if (el && el.value) answers[current.key] = el.value;
      return;
    }

    if (current.key === "lastPeriod") {
      const knows = document.querySelector(`input[name="knowsLastPeriod"]:checked`);
      if (knows) answers.knowsLastPeriod = knows.value;

      const dateEl = document.getElementById("lastPeriodDate");
      if (dateEl && dateEl.value) answers.lastPeriodDate = dateEl.value;

      const cycleLen = document.getElementById("cycleLength");
      if (cycleLen && cycleLen.value) answers.cycleLength = cycleLen.value;

      const periodDur = document.getElementById("periodDuration");
      if (periodDur && periodDur.value) answers.periodDuration = periodDur.value;

      const flow = document.querySelector(`input[name="flow"]:checked`);
      if (flow) answers.flow = flow.value;

      return;
    }

    if (current.key === "bodyBasics") {
      const w = document.getElementById("surveyWeight");
      if (w && w.value) answers.surveyWeight = w.value;

      const h = document.getElementById("surveyHeight");
      if (h && h.value) answers.surveyHeight = h.value;

      return;
    }

    const selected = document.querySelector(`input[name="${current.key}"]:checked`);
    if (selected) answers[current.key] = selected.value;
  }

  function canAutoAdvance(step) {
    if (!step) return false;
    if (step.autoAdvance === false) return false;
    if (step.type === "multi") return false;
    if (step.type === "range") return false;
    if (step.type === "select") return false;
    if (step.key === "lastPeriod") return false;
    return true;
  }

  function updateUI() {
    const total = steps.length;
    const stepNum = stepIndex + 1;

    tag.textContent = `Step ${stepNum} of ${total}`;
    bar.style.width = `${Math.round((stepNum / total) * 100)}%`;

    const s = steps[stepIndex];
    hint.textContent = s.hint || "";

    body.innerHTML = `
      <div class="survey-panel">
        <div class="survey-title">
          <h3>${escapeHtml(s.title)}</h3>
        </div>
        <div class="survey-note">${escapeHtml(s.note)}</div>
        ${s.render()}
      </div>
    `;

    wireRangeLabels(s);

    // keep original behavior, but using your mode system
    btnBack.disabled = stepIndex === 0;
    btnNext.textContent = stepIndex === total - 1 ? (isAnonMode() ? "Finish" : "Continue") : "Next";
  }

  async function finish() {
    // Coerce YOB to number before persisting
    if (answers.yob) answers.yob = Number(answers.yob);

    // Map survey keys → profile keys so profile page reads them correctly
    if (answers.cycleLength)   answers.avgCycleLength = Number(answers.cycleLength);
    if (answers.periodDuration) answers.periodDuration = Number(answers.periodDuration);
    if (answers.surveyWeight)  answers.weightKg = Number(answers.surveyWeight);
    if (answers.surveyHeight)  answers.heightCm = Number(answers.surveyHeight);

    saveAnswers(answers); // also calls setUserGoal(answers.focusGoal)
    localStorage.setItem("bloom_onboarded", "1");

    // Save LMP so pregnancy/cycle cards can use it immediately
    if (answers.lastPeriodDate) {
      localStorage.setItem("bloom_lmp", answers.lastPeriodDate);
    }

    if (answers.yob) {
      localStorage.setItem("bloom_yob_locked", "true");
    }

    // Sync all profile data to backend (account mode only) - await so it completes before navigation
    if (!isAnonMode()) await writeProfileToBackend(answers).catch(() => {});

    window.location.href = "/pages/dashboard.html";
  }

  async function goNext() {
    readCurrentStepInputs();
    const current = steps[stepIndex];
    if (typeof current?.onNext === "function") current.onNext();
    saveAnswers(answers);

    if (current?.key === "focusGoal") {
      rebuildStepsKeepPosition();
      const idx = steps.findIndex((s) => s.key === "focusGoal");
      if (idx >= 0) stepIndex = Math.min(idx + 1, steps.length - 1);
      updateUI();
      return;
    }

    if (stepIndex >= steps.length - 1) {
      await finish();
      return;
    }
    stepIndex++;
    updateUI();
  }

  btnBack.addEventListener("click", () => {
    readCurrentStepInputs();
    saveAnswers(answers);
    if (stepIndex > 0) stepIndex--;
    updateUI();
  });

  topBack.addEventListener("click", () => btnBack.click());
  btnNext.addEventListener("click", goNext);

  body.addEventListener("change", (e) => {
    const current = steps[stepIndex];
    if (!canAutoAdvance(current)) return;
    const t = e.target;
    if (!t) return;

    if (t.matches('input[type="radio"]')) {
      setTimeout(() => {
        if (stepIndex < steps.length - 1) goNext();
      }, 140);
    }
  });

  btnSkipTop.addEventListener("click", () => {
    localStorage.setItem("bloom_onboarded", "1");
    window.location.href = "/pages/dashboard.html";
  });

  updateUI();
}

/* ------------------ Step Builder (curated flow) ------------------ */
function buildSteps(answers) {
  // focusGoal now uses real dashboard goal IDs directly
  const focus = answers.focusGoal || "period";

  const base = [
    {
      key: "consent",
      title: "Let’s set you up",
      note: "Quick setup so Bloom feels tailored to you.",
      hint: "",
      render: () => consentCard(),
      autoAdvance: false,
      onNext: () => {
        answers.consent = answers.consent ?? "yes";
      },
    },
    {
      key: "yob",
      type: "select",
      title: "What year were you born?",
      note: "Helps us give you age-appropriate content. This can only be set once.",
      hint: "",
      autoAdvance: false,
      render: () => yobSelectBlock(answers.yob),
    },
    {
      // Single step - directly picks the dashboard goal
      key: "focusGoal",
      title: "What would you like Bloom to focus on?",
      note: "This sets up your dashboard. You can change it anytime.",
      hint: "",
      autoAdvance: false,
      render: () =>
        cardRadio(
          "focusGoal",
          [
            { value: "period",        icon: "🗓️", title: "Track my period",              desc: "Cycle predictions, phases, and period timing" },
            { value: "track_symptoms",     icon: "🩷", title: "Track symptoms",               desc: "Log symptoms and patterns without period predictions" },
            { value: "ttc",           icon: "🌱", title: "Try to conceive",              desc: "Fertility window, ovulation insights, and timing tools" },
            { value: "perimenopause", icon: "🌙", title: "Track menopause / perimenopause", desc: "Cycle changes, hot flashes, and transitions" },
            { value: "pregnancy",     icon: "🤰", title: "Track my pregnancy",           desc: "Due date, trimester milestones, and pregnancy logs" },
          ],
          answers.focusGoal || "period"
        ),
      onNext: () => {
        answers.focusGoal = answers.focusGoal || "period";
      },
    },
  ];

  const curated = [];

  // Steps only relevant when tracking periods, trying to conceive, or pregnancy
  if (["period", "ttc", "pregnancy"].includes(focus)) {
    curated.push({
      key: "lastPeriod",
      title: "Last period + basics",
      note: "Optional details that improve tracking (best guess is fine).",
      hint: "",
      autoAdvance: false,
      render: () => lastPeriodBlock(answers),
      onNext: () => {
        answers.knowsLastPeriod = answers.knowsLastPeriod || "na";
      },
    });
  }

  // Regularity + reminders only for period tracking and TTC
  if (["period", "ttc"].includes(focus)) {
    curated.push(
      {
        key: "regularity",
        title: "Are your cycles usually regular?",
        note: "This affects prediction accuracy.",
        hint: "",
        render: () =>
          radioGroup(
            "regularity",
            [
              { label: "Mostly regular", value: "regular" },
              { label: "Sometimes irregular", value: "sometimes" },
              { label: "Very irregular", value: "irregular" },
              { label: "Not sure", value: "na" },
            ],
            answers.regularity
          ),
      },
      {
        key: "reminders",
        title: "Do you want reminders?",
        note: "You can change this anytime.",
        hint: "",
        render: () =>
          cardRadio(
            "reminders",
            [
              { value: "period",    icon: "🔔", title: "Period start reminders", desc: "Heads-up before it begins" },
              { value: "ovulation", icon: "🌸", title: "Ovulation window",       desc: "For planning ahead" },
              { value: "both",      icon: "✨", title: "Both",                   desc: "Period + ovulation window" },
              { value: "none",      icon: "🫶", title: "No reminders",           desc: "Keep it quiet for now" },
            ],
            answers.reminders || "period"
          ),
      }
    );
  }

  const tail = [
    {
      key: "bodyBasics",
      title: "A few optional details",
      note: "Helps personalise insights. All fields are optional - you can fill these in later from your profile.",
      hint: "All optional",
      autoAdvance: false,
      render: () => bodyBasicsBlock(answers),
    },
    {
      key: "privacyPref",
      title: "How private do you want Bloom to feel?",
      note: "This only changes the vibe + what we highlight; you can edit later.",
      hint: "",
      render: () =>
        cardRadio(
          "privacyPref",
          [
            { value: "lowkey",   icon: "🫶", title: "Low-key",       desc: "Minimal notifications" },
            { value: "balanced", icon: "✨", title: "Balanced",      desc: "Helpful reminders" },
            { value: "high",     icon: "🔒", title: "High privacy",  desc: "Keep it discreet" },
          ],
          answers.privacyPref || "balanced"
        ),
    },
  ];

  return [...base, ...curated, ...tail];
}

/* ------------------ UI Blocks ------------------ */
// (Keep ALL the helper functions from your original file below this point)
// consentCard, cardRadio, radioGroup, rangeBlock, lastPeriodBlock, cardMultiSelect,
// wireRangeLabels, deriveFocusFromGoals, mapGoalsToCards, loadAnswers, saveAnswers,
// escapeHtml, escapeAttr

function yobSelectBlock(selectedYear) {
  const currentYear = new Date().getFullYear();
  const opts = ['<option value="">- Select year -</option>'];
  for (let y = currentYear; y >= 1930; y--) {
    const sel = String(selectedYear) === String(y) ? "selected" : "";
    opts.push(`<option value="${y}" ${sel}>${y}</option>`);
  }
  return `
    <div style="margin-top:14px;">
      <select id="yob" class="input" style="width:100%;padding:10px 14px;font-size:1rem;border-radius:12px;border:1px solid rgba(0,0,0,0.12);background:#fff;color:#333;">
        ${opts.join("")}
      </select>
      <div class="tiny-note" style="margin-top:8px;opacity:0.8;">Optional - you can skip this. Once set, it can only be changed by contacting support.</div>
    </div>
  `;
}

async function writeProfileToBackend(answers) {
  try {
    const token = await getIdToken();
    if (!token) return;
    const apiBase = window.BLOOM_API_BASE || "";
    const payload = {};
    if (answers.focusGoal)     payload.goal           = answers.focusGoal;
    if (answers.yob)           payload.yearOfBirth    = Number(answers.yob);
    if (answers.nickname)      payload.nickname       = answers.nickname;
    if (answers.avgCycleLength) payload.avgCycleLength = Number(answers.avgCycleLength);
    if (answers.periodDuration) payload.periodDuration = Number(answers.periodDuration);
    if (answers.weightKg)      payload.weightKg       = Number(answers.weightKg);
    if (answers.heightCm)      payload.heightCm       = Number(answers.heightCm);
    await fetch(`${apiBase}/api/user/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    // silently fail - localStorage is the source of truth on this device
  }
}

async function writeYobToBackend(yearOfBirth) {
  try {
    const token = await getIdToken();
    if (!token) return;
    const apiBase = window.BLOOM_API_BASE || "";
    await fetch(`${apiBase}/api/user/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ yearOfBirth }),
    });
  } catch {
    // silently fail - localStorage is the source of truth on this device
  }
}

function consentCard() {
  return `
    <div style="
      display:flex; gap:12px; align-items:flex-start;
      padding:14px; border-radius:18px;
      background:rgba(255, 92, 138, 0.08);
      border:1px solid rgba(255, 92, 138, 0.16);
      margin-top:14px;
    ">
      <div style="
        width:54px; height:54px; border-radius:999px;
        display:flex; align-items:center; justify-content:center;
        background:rgba(255, 92, 138, 0.14);
        border:1px solid rgba(255, 92, 138, 0.18);
        flex:0 0 auto; font-size:22px;
      ">🩷</div>

      <div style="min-width:0;">
        <div style="font-weight:850; margin-bottom:6px; font-size:16px;">Quick heads up</div>
        <div class="tiny-note" style="margin:0; font-size:13px;">
          This setup helps Bloom tailor your dashboard, tips, and Bloomie suggestions.
          You can skip anything or change it later.
        </div>
        <div class="pill" style="margin-top:12px;">🔐 No diagnosis • Personalized guidance</div>
      </div>
    </div>
  `;
}

function cardRadio(name, options, selectedValue) {
  const val = selectedValue ?? "";
  return `
    <div class="q-2col">
      ${options
        .map((opt) => {
          const checked = val === opt.value ? "checked" : "";
          return `
            <label class="cardPick">
              <input type="radio" name="${name}" value="${escapeAttr(opt.value)}" ${checked} />
              <div class="cardPick__dot" aria-hidden="true"></div>
              <div class="cardPick__icon">${opt.icon}</div>
              <div class="cardPick__meta">
                <div class="cardPick__title">${escapeHtml(opt.title)}</div>
                <div class="cardPick__desc">${escapeHtml(opt.desc || "")}</div>
              </div>
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function radioGroup(name, options, selectedValue) {
  return `
    <div class="q-grid">
      ${options
        .map((opt) => {
          const checked = selectedValue === opt.value ? "checked" : "";
          return `
            <label class="opt">
              <input type="radio" name="${name}" value="${escapeAttr(opt.value)}" ${checked} />
              <span style="font-weight:650;">${escapeHtml(opt.label)}</span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;
}

function rangeBlock(id, value, min, max, ticks) {
  const safeVal = escapeAttr(String(value ?? min));
  return `
    <div class="sliderRow">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <span class="pill">Value: <strong id="${id}_label">${escapeHtml(safeVal)}</strong></span>
        <span class="tiny-note" style="opacity:0.85;">${escapeHtml(min)}–${escapeHtml(max)}</span>
      </div>

      <input id="${id}" type="range" min="${escapeAttr(min)}" max="${escapeAttr(max)}" step="1" value="${safeVal}" />

      <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
        ${(ticks || [])
          .map((t) => `<span class="tiny-note" style="opacity:0.8;">${escapeHtml(t.v)} • ${escapeHtml(t.t)}</span>`)
          .join("")}
      </div>
    </div>
  `;
}

function lastPeriodBlock(answers) {
  const knows = answers.knowsLastPeriod || "na";
  const dateVal = answers.lastPeriodDate || "";
  const cycleLen = answers.cycleLength || "";
  const periodDur = answers.periodDuration || "";
  const flowVal = answers.flow || "";

  return `
    <div style="display:grid; gap:14px; margin-top:14px;">
      ${radioGroup(
        "knowsLastPeriod",
        [
          { label: "I know the start date", value: "yes" },
          { label: "I don’t remember", value: "no" },
          { label: "I’m not sure", value: "na" },
        ],
        knows
      )}

      <div class="miniGrid">
        <div style="
          padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,0.07);
          background:rgba(255,255,255,0.92);
        ">
          <div class="tiny-note" style="margin-bottom:8px;">Last period start (optional)</div>
          <input
            id="lastPeriodDate"
            type="date"
            value="${escapeAttr(dateVal)}"
            class="input"
            style="width:100%;"
          />
          <div class="tiny-note" style="margin-top:8px; opacity:0.8;">Best guess is fine.</div>
        </div>

        <div style="
          padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,0.07);
          background:rgba(255,255,255,0.92);
        ">
          <div class="tiny-note" style="margin-bottom:8px;">Average cycle length in days (optional)</div>
          <input
            id="cycleLength"
            type="number"
            inputmode="numeric"
            placeholder="e.g., 28"
            min="15"
            max="60"
            value="${escapeAttr(cycleLen)}"
            class="input"
            style="width:100%;"
          />
          <div class="tiny-note" style="margin-top:8px; opacity:0.8;">Leave blank if unsure.</div>
        </div>

        <div style="
          padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,0.07);
          background:rgba(255,255,255,0.92);
        ">
          <div class="tiny-note" style="margin-bottom:8px;">Typical period duration in days (optional)</div>
          <input
            id="periodDuration"
            type="number"
            inputmode="numeric"
            placeholder="e.g., 5"
            min="1"
            max="14"
            value="${escapeAttr(periodDur)}"
            class="input"
            style="width:100%;"
          />
          <div class="tiny-note" style="margin-top:8px; opacity:0.8;">How many days it usually lasts.</div>
        </div>
      </div>

      <div style="
        padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,0.07);
        background:rgba(255,255,255,0.92);
      ">
        <div class="tiny-note" style="margin-bottom:10px;">Typical flow (optional)</div>
        ${cardRadio(
          "flow",
          [
            { value: "light", icon: "🌸", title: "Light", desc: "Usually light bleeding" },
            { value: "medium", icon: "🩷", title: "Medium", desc: "Typical/average" },
            { value: "heavy", icon: "🩸", title: "Heavy", desc: "Soaks pads/tampons faster" },
            { value: "na", icon: "✨", title: "Not sure", desc: "Skip this for now" },
          ],
          flowVal || "na"
        )}
      </div>
    </div>
  `;
}

function bodyBasicsBlock(answers) {
  const weight = answers.surveyWeight || "";
  const height = answers.surveyHeight || "";

  return `
    <div style="display:grid; gap:14px; margin-top:14px;">
      <div class="miniGrid">
        <div style="
          padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,0.07);
          background:rgba(255,255,255,0.92);
        ">
          <div class="tiny-note" style="margin-bottom:8px;">Weight in kg (optional)</div>
          <input
            id="surveyWeight"
            type="number"
            inputmode="decimal"
            placeholder="e.g., 60"
            min="20"
            max="300"
            step="0.1"
            value="${escapeAttr(weight)}"
            class="input"
            style="width:100%;"
          />
        </div>

        <div style="
          padding:14px;border-radius:18px;border:1px solid rgba(0,0,0,0.07);
          background:rgba(255,255,255,0.92);
        ">
          <div class="tiny-note" style="margin-bottom:8px;">Height in cm (optional)</div>
          <input
            id="surveyHeight"
            type="number"
            inputmode="decimal"
            placeholder="e.g., 165"
            min="50"
            max="272"
            step="0.1"
            value="${escapeAttr(height)}"
            class="input"
            style="width:100%;"
          />
        </div>
      </div>
      <div class="tiny-note" style="text-align:center; opacity:0.75;">You can change units (kg/lb, cm/ft) any time on your profile page.</div>
    </div>
  `;
}

/* ------------------ Helpers ------------------ */
function wireRangeLabels(step) {
  if (!step || step.type !== "range") return;
  const el = document.getElementById(step.key);
  const label = document.getElementById(`${step.key}_label`);
  if (!el || !label) return;

  const sync = () => (label.textContent = String(el.value));
  el.addEventListener("input", sync);
  sync();
}

/* ------------------ storage ------------------ */
function loadAnswers() {
  try {
    return JSON.parse(localStorage.getItem("bloom_profile") || "{}");
  } catch {
    return {};
  }
}
function saveAnswers(obj) {
  localStorage.setItem("bloom_profile", JSON.stringify(obj || {}));
  setUserGoal((obj || {}).focusGoal);
}

/* ------------------ safety helpers ------------------ */
function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function escapeAttr(text) {
  return escapeHtml(text).replaceAll("`", "&#96;");
}
