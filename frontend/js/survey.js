import { isAnonMode } from "./mode.js";
import { setUserGoal } from "./goals.js";

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
            <span id="surveyStepTag" class="survey-chip">Step 1 of 10</span>
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

    if (current.key === "lastPeriod") {
      const knows = document.querySelector(`input[name="knowsLastPeriod"]:checked`);
      if (knows) answers.knowsLastPeriod = knows.value;

      const dateEl = document.getElementById("lastPeriodDate");
      if (dateEl && dateEl.value) answers.lastPeriodDate = dateEl.value;

      const cycleLen = document.getElementById("cycleLength");
      if (cycleLen && cycleLen.value) answers.cycleLength = cycleLen.value;

      const flow = document.querySelector(`input[name="flow"]:checked`);
      if (flow) answers.flow = flow.value;

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

  function finish() {
    saveAnswers(answers);
    localStorage.setItem("bloom_onboarded", "1");

    // anon users go straight to dashboard, account users can go to register if you want
    if (isAnonMode()) window.location.href = "/pages/dashboard.html";
    else window.location.href = "/pages/dashboard.html";
  }

  function goNext() {
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
      finish();
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
  const goals = Array.isArray(answers.goals) ? answers.goals : [];
  const focus = answers.focusGoal || deriveFocusFromGoals(goals) || "track";

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
      key: "ageRange",
      title: "What’s your age range?",
      note: "This helps with safety + the right recommendations.",
      hint: "",
      render: () =>
        radioGroup(
          "ageRange",
          [
            { label: "Under 18", value: "under18" },
            { label: "18–24", value: "18-24" },
            { label: "25–34", value: "25-34" },
            { label: "35–44", value: "35-44" },
            { label: "45+", value: "45plus" },
            { label: "Prefer not to say", value: "na" },
          ],
          answers.ageRange
        ),
    },
    {
      key: "goals",
      type: "multi",
      title: "What can Bloom help you do?",
      note: "Select all goals that apply.",
      hint: "Select all that apply",
      autoAdvance: false,
      render: () =>
        cardMultiSelect(
          "goals",
          [
            { label: "Track my period", value: "track", icon: "🗓️" },
            { label: "Symptoms & relief", value: "symptoms", icon: "🩷" },
            { label: "Fertility / trying", value: "fertility", icon: "🌱" },
            { label: "Menopause / changes", value: "menopause", icon: "🌙" },
            { label: "Understand my body", value: "understand", icon: "🧠" },
            { label: "Just exploring", value: "exploring", icon: "✨" },
          ],
          answers.goals
        ),
      onNext: () => {
        const picked = Array.isArray(answers.goals) ? answers.goals : [];
        if (!picked.length) answers.goals = ["track"];
        answers.focusGoal = answers.focusGoal || deriveFocusFromGoals(answers.goals) || "track";
      },
    },
    {
      key: "focusGoal",
      title: "Which one should Bloom focus on first?",
      note: "This decides what questions we ask next.",
      hint: "",
      render: () => {
        const picked = Array.isArray(answers.goals) ? answers.goals : [];
        const opts = mapGoalsToCards(picked.length ? picked : ["track"]);
        return cardRadio("focusGoal", opts, answers.focusGoal || deriveFocusFromGoals(picked) || "track");
      },
      onNext: () => {
        answers.focusGoal = answers.focusGoal || deriveFocusFromGoals(answers.goals) || "track";
      },
    },
    {
      key: "periodTracking",
      title: "Do you track your periods right now?",
      note: "No judgment — this helps us meet you where you are.",
      hint: "",
      render: () =>
        radioGroup(
          "periodTracking",
          [
            { label: "Yes, I already track", value: "yes" },
            { label: "Sometimes / not consistently", value: "sometimes" },
            { label: "No, I don’t track", value: "no" },
          ],
          answers.periodTracking
        ),
    },
  ];

  const curated = [];

  if (focus === "track") {
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
              { value: "period", icon: "🔔", title: "Period start reminders", desc: "Heads-up before it begins" },
              { value: "ovulation", icon: "🌸", title: "Ovulation window", desc: "Optional — for planning" },
              { value: "both", icon: "✨", title: "Both", desc: "Period + ovulation window" },
              { value: "none", icon: "🫶", title: "No reminders", desc: "Keep it quiet for now" },
            ],
            answers.reminders || "period"
          ),
      }
    );
  }

  // keep your existing curated sections…
  // (Your snippet continues, so keep the rest of your file as-is.)
  // IMPORTANT: Do NOT reintroduce location.hash anywhere.

  const tail = [
    {
      key: "surprise",
      title: "Has your period ever caught you by surprise?",
      note: "We can improve predictions and reminders.",
      hint: "",
      render: () =>
        radioGroup(
          "surprise",
          [
            { label: "Yes, sometimes", value: "sometimes" },
            { label: "Yes, often", value: "often" },
            { label: "Rarely / no", value: "rarely" },
            { label: "Prefer not to answer", value: "na" },
          ],
          answers.surprise
        ),
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
            { value: "lowkey", icon: "🫶", title: "Low-key", desc: "Minimal notifications" },
            { value: "balanced", icon: "✨", title: "Balanced", desc: "Helpful reminders" },
            { value: "high", icon: "🔒", title: "High privacy", desc: "Keep it discreet" },
          ],
          answers.privacyPref || "balanced"
        ),
    },
    {
      key: "lastPeriod",
      title: "Last period + basics",
      note: "Optional details that improve tracking (best guess is fine).",
      hint: "",
      autoAdvance: false,
      render: () => lastPeriodBlock(answers),
      onNext: () => {
        answers.knowsLastPeriod = answers.knowsLastPeriod || "na";
      },
    },
  ];

  return [...base, ...curated, ...tail];
}

/* ------------------ UI Blocks ------------------ */
// (Keep ALL the helper functions from your original file below this point)
// consentCard, cardRadio, radioGroup, rangeBlock, lastPeriodBlock, cardMultiSelect,
// wireRangeLabels, deriveFocusFromGoals, mapGoalsToCards, loadAnswers, saveAnswers,
// escapeHtml, escapeAttr

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
          <div class="tiny-note" style="margin-bottom:8px;">Average cycle length (optional)</div>
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

function cardMultiSelect(key, options, selectedValues) {
  const picked = Array.isArray(selectedValues)
    ? selectedValues
    : selectedValues
    ? [selectedValues]
    : [];

  return `
    <div class="q-2col">
      ${options
        .map((opt) => {
          const checked = picked.includes(opt.value) ? "checked" : "";
          return `
            <label class="cardPick">
              <input
                type="checkbox"
                name="${key}[]"
                value="${escapeAttr(opt.value)}"
                ${checked}
              />
              <div class="cardPick__dot" aria-hidden="true"></div>
              <div class="cardPick__icon">${opt.icon}</div>
              <div class="cardPick__meta">
                <div class="cardPick__title">${escapeHtml(opt.label)}</div>
                <div class="cardPick__desc">Tap to select</div>
              </div>
            </label>
          `;
        })
        .join("")}
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

function deriveFocusFromGoals(goals) {
  const g = Array.isArray(goals) ? goals : [];
  const priority = ["symptoms", "fertility", "menopause", "track", "understand", "exploring"];
  return priority.find((p) => g.includes(p)) || "";
}

function mapGoalsToCards(goalValues) {
  const all = {
    track: { value: "track", icon: "🗓️", title: "Period tracking", desc: "Predictions, reminders, patterns" },
    symptoms: { value: "symptoms", icon: "🩷", title: "Symptoms & relief", desc: "Cramps, mood, bloating, headaches" },
    fertility: { value: "fertility", icon: "🌱", title: "Fertility / trying", desc: "Cycle insights + timing support" },
    menopause: { value: "menopause", icon: "🌙", title: "Menopause / changes", desc: "Transitions, hot flashes, sleep" },
    understand: { value: "understand", icon: "🧠", title: "Understand my body", desc: "Education + what’s “normal”" },
    exploring: { value: "exploring", icon: "✨", title: "Just exploring", desc: "Low-pressure setup" },
  };
  const unique = Array.from(new Set(goalValues || []));
  const cards = unique.map((k) => all[k]).filter(Boolean);
  return cards.length ? cards : [all.track];
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
  setUserGoal(answers.focusGoal);
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
