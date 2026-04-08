/**
 * mythFab.js - Floating "Myth or Fact" game button + modal
 * Levels up as the user earns XP by answering questions correctly.
 */

import { getIdToken, onAuthChange } from "/js/auth.js";

// ─── Level config ─────────────────────────────────────────────────────────────
const LEVELS = [
  { level: 1,  label: "Bloom Beginner",    emoji: "🌱", minXP: 0    },
  { level: 2,  label: "Cycle Curious",     emoji: "🌸", minXP: 50   },
  { level: 3,  label: "Period Aware",      emoji: "💡", minXP: 150  },
  { level: 4,  label: "Flow Explorer",     emoji: "🌺", minXP: 300  },
  { level: 5,  label: "Wellness Seeker",   emoji: "✨", minXP: 500  },
  { level: 6,  label: "Cycle Scholar",     emoji: "🦋", minXP: 750  },
  { level: 7,  label: "Body Wise",         emoji: "🌙", minXP: 1050 },
  { level: 8,  label: "Hormone Expert",    emoji: "🩷", minXP: 1400 },
  { level: 9,  label: "Bloom Champion",    emoji: "👑", minXP: 1800 },
  { level: 10, label: "Bloom Master",      emoji: "🌟", minXP: 2250 },
];
const XP_PER_CORRECT = 10;
const XP_PERFECT_BONUS = 25;
const SESSION_SIZE = 10;
const LS_GAME = "bloom_game";

function getLevelInfo(xp) {
  let current = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.minXP) current = l; }
  const nextIdx = LEVELS.findIndex(l => l.level === current.level) + 1;
  const next = LEVELS[nextIdx] || null;
  const xpInLevel  = xp - current.minXP;
  const xpNeeded   = next ? next.minXP - current.minXP : 0;
  const pct        = next ? Math.min(100, Math.round((xpInLevel / xpNeeded) * 100)) : 100;
  return { current, next, xpInLevel, xpNeeded, pct };
}

// ─── Local XP store ───────────────────────────────────────────────────────────
function loadGame() {
  try { return JSON.parse(localStorage.getItem(LS_GAME)) || { xp: 0, level: 1, sessionsPlayed: 0 }; }
  catch { return { xp: 0, level: 1, sessionsPlayed: 0 }; }
}

function saveGameLocal(game) {
  localStorage.setItem(LS_GAME, JSON.stringify(game));
}

async function syncGameToBackend(xpEarned) {
  try {
    const token = await getIdToken();
    if (!token) return null;
    const apiBase = window.BLOOM_API_BASE ?? "";
    const r = await fetch(`${apiBase}/api/user/game`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ xpEarned }),
    });
    if (r.ok) {
      const { game } = await r.json();
      saveGameLocal(game);
      console.log("[Bloom] game XP synced to backend ✓", game);
      return game;
    } else {
      console.error("[Bloom] game sync failed:", r.status, await r.json().catch(() => ({})));
    }
  } catch (e) { console.error("[Bloom] game sync error:", e); }
  return null;
}

// Returns game data once auth state is known - waits for Firebase to resolve
function fetchGameWhenReady() {
  return new Promise(resolve => {
    onAuthChange(async (user) => {
      if (!user) { resolve(null); return; }
      try {
        const token = await getIdToken();
        if (!token) { resolve(null); return; }
        const apiBase = window.BLOOM_API_BASE ?? "";
        const r = await fetch(`${apiBase}/api/user/game`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (r.ok) {
          const { game } = await r.json();
          saveGameLocal(game);
          resolve(game);
          return;
        }
      } catch (e) { console.error("[Bloom] fetch game error:", e); }
      resolve(null);
    });
  });
}

// ─── Question bank ────────────────────────────────────────────────────────────
const MYTH_BANK = [
  { statement: "You cannot get pregnant during your period.", answer: "myth", explanation: "Pregnancy is less likely during menstruation but still possible. Sperm can survive up to 5 days inside the body, and people with shorter cycles may ovulate shortly after bleeding ends.", tags: ["cycle", "fertility"] },
  { statement: "A healthy menstrual cycle is always 28 days long.", answer: "myth", explanation: "Cycles between 21 and 35 days are all within the healthy range. Only about 10–15% of people have exactly a 28-day cycle. Consistency matters more than hitting a specific number.", tags: ["cycle"] },
  { statement: "Period blood contains toxins that need to be 'cleansed' from the body.", answer: "myth", explanation: "Period blood is simply the uterine lining shedding - it contains blood, mucus, and tissue. There are no toxins being expelled.", tags: ["cycle", "period"] },
  { statement: "Brown period blood can be a normal part of your cycle.", answer: "fact", explanation: "Brown blood is simply older blood that has oxidised. It commonly appears at the beginning or end of a period and is usually nothing to worry about.", tags: ["period", "blood"] },
  { statement: "The average person loses over 500 ml of blood during a period.", answer: "myth", explanation: "The typical amount is 30–80 ml - roughly 2–6 tablespoons. Losing more than 80 ml is considered heavy bleeding.", tags: ["period", "flow"] },
  { statement: "Periods always last exactly 7 days.", answer: "myth", explanation: "Anywhere from 2 to 7 days is considered normal. What matters is that your own pattern stays relatively consistent.", tags: ["cycle", "period"] },
  { statement: "You can have a period without actually ovulating.", answer: "fact", explanation: "This is called an anovulatory cycle. Your uterine lining still sheds, so bleeding occurs, but no egg was released.", tags: ["cycle", "ovulation"] },
  { statement: "Period syncing between people who live together is scientifically proven.", answer: "myth", explanation: "Studies have not found reliable evidence that cycles sync up between housemates. Perceived synchrony is more likely coincidence.", tags: ["cycle"] },
  { statement: "PMS is just being emotional - it is not a real medical condition.", answer: "myth", explanation: "Premenstrual syndrome is a recognised medical condition driven by hormonal fluctuations with documented physiological causes.", tags: ["pms", "symptoms"] },
  { statement: "Severe period pain that disrupts daily life is always normal.", answer: "myth", explanation: "Pain severe enough to miss school or work may be a sign of endometriosis, fibroids, or adenomyosis. It is worth speaking to a healthcare provider.", tags: ["pain", "cramps", "endometriosis"] },
  { statement: "Exercise can help relieve period cramps.", answer: "fact", explanation: "Gentle movement encourages blood flow and triggers endorphin release, which are natural pain relievers.", tags: ["cramps", "pain", "exercise"] },
  { statement: "Hormonal shifts before your period can cause real physical headaches.", answer: "fact", explanation: "Oestrogen drops before menstruation are a well-documented trigger for migraines and tension headaches.", tags: ["headache", "pms", "symptoms"] },
  { statement: "Bloating during your period means you are gaining permanent weight.", answer: "myth", explanation: "Period bloating is caused by temporary water retention due to hormonal changes. It resolves within a few days.", tags: ["bloating", "symptoms", "pms"] },
  { statement: "Cravings for chocolate or carbs before your period can have a physiological basis.", answer: "fact", explanation: "Drops in serotonin and magnesium before menstruation are linked to carbohydrate and chocolate cravings.", tags: ["pms", "cravings", "nutrition"] },
  { statement: "Caffeine makes period cramps worse for many people.", answer: "fact", explanation: "Caffeine can cause blood vessels to constrict and may increase oestrogen levels, worsening cramping.", tags: ["cramps", "caffeine", "nutrition"] },
  { statement: "Having no PMS symptoms means your hormones are unhealthy.", answer: "myth", explanation: "Some people experience little to no PMS and that is completely normal.", tags: ["pms", "symptoms"] },
  { statement: "You can only get pregnant on one single day per cycle.", answer: "myth", explanation: "The fertile window spans approximately 6 days - the 5 days before ovulation and the day of ovulation itself.", tags: ["fertility", "ovulation", "ttc"] },
  { statement: "Stress can delay or prevent ovulation.", answer: "fact", explanation: "High cortisol from stress interferes with the hormonal signals that trigger ovulation.", tags: ["stress", "ovulation", "fertility"] },
  { statement: "Fertility drops sharply the moment you turn 30.", answer: "myth", explanation: "The significant decline typically begins after 35, not 30. Many people conceive without difficulty in their early-to-mid 30s.", tags: ["fertility", "age"] },
  { statement: "Pre-ejaculate can contain sperm and cause pregnancy.", answer: "fact", explanation: "Pre-ejaculate can contain sperm, particularly if a previous ejaculation occurred without urination in between.", tags: ["fertility", "contraception"] },
  { statement: "Morning sickness only happens in the morning.", answer: "myth", explanation: "Nausea during early pregnancy can occur at any time of day or night.", tags: ["pregnancy", "symptoms"] },
  { statement: "Irregular periods always indicate a serious health problem.", answer: "myth", explanation: "Irregular cycles are common and can result from stress, weight changes, travel, or intense exercise - not necessarily disease.", tags: ["cycle", "health"] },
  { statement: "Ovarian cysts are always dangerous and require surgery.", answer: "myth", explanation: "Many ovarian cysts are functional and resolve on their own within one to three cycles without any treatment.", tags: ["health", "ovaries"] },
  { statement: "Endometriosis can only affect the uterus.", answer: "myth", explanation: "Endometriosis tissue can grow on the ovaries, fallopian tubes, bowel, bladder, and even in rare cases beyond the pelvis.", tags: ["endometriosis", "health"] },
  { statement: "Taking hormonal birth control for years can affect future fertility.", answer: "myth", explanation: "Research consistently shows that hormonal contraception does not reduce long-term fertility. Cycles and fertility typically return within months of stopping.", tags: ["contraception", "fertility"] },

  // ── Caribbean / Jamaican cultural myths ───────────────────────────────────
  { statement: "Bathing in cold water during your period will cause serious illness.", answer: "myth", explanation: "Bathing during your period - in water of any temperature - is completely safe. In fact, warm baths can actually help ease cramps. There is no medical basis for avoiding bathing while menstruating.", tags: ["period", "culture", "jamaica"] },
  { statement: "You should not eat certain 'cold' foods like cucumbers or watermelon during your period.", answer: "myth", explanation: "The idea that 'cold' foods worsen periods comes from folk medicine, not science. There is no evidence that cucumbers, watermelon, or similar foods affect your cycle or cramps. Staying hydrated with water-rich foods is actually beneficial.", tags: ["period", "nutrition", "culture", "jamaica"] },
  { statement: "A woman's period makes her spiritually or physically 'unclean'.", answer: "myth", explanation: "Menstruation is a normal biological process. It does not make a person unclean, impure, or spiritually compromised. This belief, common in many cultures including parts of the Caribbean, has no medical or scientific foundation.", tags: ["period", "culture", "jamaica"] },
  { statement: "Drinking 'roots' tonic can regulate an irregular menstrual cycle.", answer: "myth", explanation: "While some herbal teas may offer mild comfort, there is no scientific evidence that Jamaican roots tonics regulate hormones or fix irregular cycles. Persistent irregularity should be discussed with a healthcare provider.", tags: ["cycle", "culture", "jamaica", "nutrition"] },
  { statement: "You should not exercise or do strenuous activity during your period.", answer: "myth", explanation: "Exercise during your period is not only safe but beneficial. Physical activity releases endorphins that help reduce cramping and improve mood. Light to moderate exercise is recommended unless you feel unwell.", tags: ["period", "exercise", "culture", "jamaica"] },
  { statement: "Sour foods like citrus can 'cut off' or stop your period early.", answer: "myth", explanation: "No food can stop or shorten your period. The flow is determined by your uterus shedding its lining - a hormonal process that citrus and sour foods have no ability to interrupt.", tags: ["period", "nutrition", "culture", "jamaica"] },
  { statement: "Having sex during your period can stop the bleeding.", answer: "myth", explanation: "Sex does not stop menstruation. Orgasm can cause temporary uterine contractions that may slightly alter flow briefly, but your period will continue normally. Sex during menstruation can also still result in pregnancy.", tags: ["period", "fertility", "culture"] },
  { statement: "Girls who start their period early (before 12) will have more health problems.", answer: "myth", explanation: "Early puberty, while worth monitoring, does not automatically lead to health problems. The age of first period varies widely and is influenced by genetics, body composition, and environment - not character or health destiny.", tags: ["cycle", "culture", "jamaica", "health"] },
  { statement: "Missed periods are always a sign of pregnancy.", answer: "myth", explanation: "While pregnancy is one cause, periods can also be missed due to stress, significant weight changes, overexercise, thyroid issues, PCOS, or hormonal imbalances. A pregnancy test and doctor visit can clarify the cause.", tags: ["cycle", "pregnancy", "culture"] },
  { statement: "Period pain is something women just have to 'bear' - it cannot be treated.", answer: "myth", explanation: "Period pain is real and treatable. Options include over-the-counter pain relief, heat therapy, hormonal treatments, and for underlying conditions like endometriosis, medical or surgical care. You do not have to simply endure it.", tags: ["pain", "cramps", "culture", "jamaica"] },
];

const LS_SEEN = "bloom_myth_seen"; // stores array of seen statement hashes

function getSeenSet() {
  try { return new Set(JSON.parse(localStorage.getItem(LS_SEEN)) || []); }
  catch { return new Set(); }
}

function markSeen(items) {
  const seen = getSeenSet();
  items.forEach(item => seen.add(item.statement));
  // If all questions have been seen, reset so the cycle starts fresh
  if (seen.size >= MYTH_BANK.length) {
    localStorage.removeItem(LS_SEEN);
  } else {
    localStorage.setItem(LS_SEEN, JSON.stringify([...seen]));
  }
}

function buildSession() {
  const seen = getSeenSet();
  const goal = localStorage.getItem("bloom_goal") || "period";
  const recentTags = new Set(["period"]);
  if (goal === "ttc")           { recentTags.add("fertility"); recentTags.add("ttc"); }
  if (goal === "pregnancy")     { recentTags.add("pregnancy"); }
  if (goal === "perimenopause") { recentTags.add("menopause"); recentTags.add("perimenopause"); }

  // Separate unseen from seen questions
  const unseen = MYTH_BANK.filter(item => !seen.has(item.statement));
  const seenItems = MYTH_BANK.filter(item => seen.has(item.statement));

  function score(item) {
    const overlap = (item.tags || []).filter(t => recentTags.has(t)).length;
    return overlap + Math.random() * 0.5;
  }

  // Always prefer unseen; pad with seen only if not enough unseen left
  const sortedUnseen = unseen.sort((a, b) => score(b) - score(a));
  const sortedSeen   = seenItems.sort(() => Math.random() - 0.5);
  return [...sortedUnseen, ...sortedSeen].slice(0, SESSION_SIZE);
}

// ─── FAB + Modal ──────────────────────────────────────────────────────────────
export function renderMythFab() {
  if (document.getElementById("myth-fab")) return;

  // Inject styles
  const style = document.createElement("style");
  style.textContent = `
    .myth-fab {
      position: fixed; bottom: 1.5rem; left: 1.5rem; z-index: 1200;
      width: 56px; height: 56px; border-radius: 50%;
      background: var(--color-primary); color: #fff;
      border: none; cursor: pointer; font-size: 26px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      display: grid; place-items: center;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .myth-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.22); }
    .myth-fab-badge {
      position: absolute; top: -4px; right: -4px;
      background: #f59e0b; color: #fff;
      border-radius: 50%; width: 20px; height: 20px;
      font-size: 10px; font-weight: 800;
      display: grid; place-items: center;
      border: 2px solid #fff;
    }
    .myth-modal-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 1300; display: none; align-items: center; justify-content: center;
      padding: 1rem;
    }
    .myth-modal-backdrop.open { display: flex; }
    .myth-modal-panel {
      background: var(--color-bg-card, #fff);
      border-radius: 1.25rem;
      width: 100%; max-width: 480px;
      max-height: 82vh; overflow-y: auto;
      padding: 1.5rem 1.5rem 2rem;
      box-shadow: 0 8px 40px rgba(0,0,0,0.2);
      animation: popIn 0.22s ease;
    }
    @keyframes popIn {
      from { transform: scale(0.94); opacity: 0; }
      to   { transform: scale(1);    opacity: 1; }
    }
    .myth-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 1rem;
    }
    .myth-modal-header strong { font-size: 1.1rem; }
    .myth-close-btn {
      background: none; border: none; font-size: 1.2rem;
      cursor: pointer; color: var(--color-text-muted); padding: 0.25rem;
    }

    /* Level bar */
    .myth-level-row {
      display: flex; align-items: center; gap: 0.75rem;
      background: var(--color-primary-lightest, #fce4ec);
      border-radius: var(--radius, 0.75rem);
      padding: 0.65rem 0.9rem; margin-bottom: 1.25rem;
    }
    .myth-level-emoji { font-size: 1.5rem; }
    .myth-level-info { flex: 1; }
    .myth-level-label { font-size: 0.78rem; font-weight: 800; color: var(--color-primary-dark); }
    .myth-xp-bar-wrap { height: 6px; background: rgba(0,0,0,0.1); border-radius: 4px; margin-top: 0.3rem; }
    .myth-xp-bar-fill { height: 100%; border-radius: 4px; background: var(--color-primary); transition: width 0.4s; }
    .myth-xp-label { font-size: 0.72rem; color: var(--color-text-muted); margin-top: 0.2rem; }

    /* Quiz */
    .myth-q-meta {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.78rem; color: var(--color-text-muted); margin-bottom: 0.5rem;
    }
    .myth-score-chip {
      background: var(--color-primary-lightest, #fce4ec);
      color: var(--color-primary-dark); font-weight: 800;
      padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.75rem;
    }
    .myth-q-bar { height: 4px; background: var(--color-border); border-radius: 4px; margin-bottom: 1rem; overflow: hidden; }
    .myth-q-bar-fill { height: 100%; background: var(--color-primary); transition: width 0.3s; }
    .myth-statement {
      font-size: 1rem; font-weight: 700; line-height: 1.5;
      margin-bottom: 1rem; color: var(--color-text);
    }
    .myth-btn-row { display: flex; gap: 0.75rem; margin-bottom: 0.85rem; }
    .myth-q-btn {
      flex: 1; padding: 0.75rem; border-radius: var(--radius, 0.75rem);
      border: 2px solid var(--color-border); background: var(--color-bg);
      font-size: 0.95rem; font-weight: 700; cursor: pointer;
      transition: border-color 0.15s, background 0.15s, transform 0.1s;
    }
    .myth-q-btn:hover:not(:disabled) { border-color: var(--color-primary); transform: translateY(-1px); }
    .myth-q-btn:disabled { cursor: default; }
    .myth-q-btn.correct  { background: #d4f7e7; border-color: #27ae60; color: #1a6b40; }
    .myth-q-btn.wrong    { background: #ffe0e9; border-color: #c0003c; color: #8b0028; }
    .myth-q-btn.reveal   { background: #d4f7e7; border-color: #27ae60; color: #1a6b40; opacity: 0.7; }
    .myth-feedback { font-size: 0.9rem; font-weight: 700; margin-bottom: 0.5rem; min-height: 1.4rem; }
    .myth-feedback.correct { color: #1a6b40; }
    .myth-feedback.wrong   { color: #8b0028; }
    .myth-explanation {
      font-size: 0.85rem; color: var(--color-text-muted); line-height: 1.55;
      background: var(--color-bg-subtle, #f8f4f7);
      border-radius: var(--radius-sm, 0.5rem);
      padding: 0.65rem 0.85rem; margin-bottom: 0.85rem;
      display: none;
    }
    .myth-explanation.visible { display: block; }
    .myth-next-btn {
      width: 100%; padding: 0.7rem; border-radius: var(--radius, 0.75rem);
      background: var(--color-primary); color: #fff;
      border: none; font-weight: 800; font-size: 0.95rem; cursor: pointer;
      display: none; transition: opacity 0.15s;
    }
    .myth-next-btn.visible { display: block; }
    .myth-next-btn:hover { opacity: 0.88; }

    /* Results */
    .myth-results {
      text-align: center; padding: 0.5rem 0;
    }
    .myth-results-score { font-size: 2.5rem; font-weight: 800; color: var(--color-primary-dark); }
    .myth-results-label { font-size: 0.95rem; color: var(--color-text-muted); margin: 0.4rem 0 1rem; }
    .myth-xp-earned {
      font-size: 1.1rem; font-weight: 800; color: #f59e0b;
      margin-bottom: 0.75rem;
    }
    .myth-levelup {
      background: linear-gradient(135deg, var(--color-primary-lightest), #fff8e1);
      border: 2px solid #f59e0b; border-radius: var(--radius, 0.75rem);
      padding: 0.85rem; margin-bottom: 1rem; font-weight: 700;
      color: var(--color-primary-dark); font-size: 0.95rem;
    }
    .myth-replay-btn {
      width: 100%; padding: 0.75rem; border-radius: var(--radius, 0.75rem);
      background: var(--color-primary); color: #fff;
      border: none; font-weight: 800; font-size: 1rem; cursor: pointer;
    }
    .myth-replay-btn:hover { opacity: 0.88; }
  `;
  document.head.appendChild(style);

  // FAB button
  const fab = document.createElement("button");
  fab.id = "myth-fab";
  fab.className = "myth-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "Myth or Fact game");
  fab.innerHTML = `🎮<span class="myth-fab-badge" id="myth-fab-badge">1</span>`;

  // Modal backdrop
  const backdrop = document.createElement("div");
  backdrop.id = "myth-modal-backdrop";
  backdrop.className = "myth-modal-backdrop";
  backdrop.innerHTML = `
    <div class="myth-modal-panel" role="dialog" aria-modal="true" aria-label="Myth or Fact game">
      <div class="myth-modal-header">
        <strong>🎮 Myth or Fact</strong>
        <button class="myth-close-btn" id="myth-close-btn" aria-label="Close">✕</button>
      </div>
      <div id="myth-level-row" class="myth-level-row">
        <div class="myth-level-emoji" id="myth-level-emoji">🌱</div>
        <div class="myth-level-info">
          <div class="myth-level-label" id="myth-level-label">Level 1 · Bloom Beginner</div>
          <div class="myth-xp-bar-wrap"><div class="myth-xp-bar-fill" id="myth-xp-bar" style="width:0%"></div></div>
          <div class="myth-xp-label" id="myth-xp-label">0 / 50 XP to next level</div>
        </div>
      </div>
      <div id="myth-game-area"></div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(fab);

  // Close
  backdrop.querySelector("#myth-close-btn").addEventListener("click", closeModal);
  backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });
  fab.addEventListener("click", openModal);

  function openModal() { backdrop.classList.add("open"); }
  function closeModal() { backdrop.classList.remove("open"); }

  // Load game state - waits for Firebase auth to resolve before hitting backend
  fetchGameWhenReady().then(server => {
    const game = server || loadGame();
    refreshLevelUI(game.xp);
    updateFabBadge(game.level);
    startGame();
  });

  function refreshLevelUI(xp) {
    const { current, next, xpInLevel, xpNeeded, pct } = getLevelInfo(xp);
    document.getElementById("myth-level-emoji").textContent = current.emoji;
    document.getElementById("myth-level-label").textContent = `Level ${current.level} · ${current.label}`;
    document.getElementById("myth-xp-bar").style.width = pct + "%";
    document.getElementById("myth-xp-label").textContent = next
      ? `${xpInLevel} / ${xpNeeded} XP to next level`
      : `${xp} XP · Max level reached 👑`;
  }

  function updateFabBadge(level) {
    const badge = document.getElementById("myth-fab-badge");
    if (badge) badge.textContent = level;
  }

  function startGame() {
    const area = document.getElementById("myth-game-area");
    const queue = buildSession();
    let qIndex = 0;
    let score = 0;
    let answered = false;

    function render() {
      answered = false;
      const item = queue[qIndex];
      const total = queue.length;
      const pct = Math.round((qIndex / total) * 100);

      const buttons = Math.random() < 0.5
        ? [{ label: "Fact ✨", value: "fact" }, { label: "Myth 🌷", value: "myth" }]
        : [{ label: "Myth 🌷", value: "myth" }, { label: "Fact ✨", value: "fact" }];

      area.innerHTML = `
        <div class="myth-q-meta">
          <span>${qIndex + 1} of ${total}</span>
          <span class="myth-score-chip">Score: ${score}</span>
        </div>
        <div class="myth-q-bar"><div class="myth-q-bar-fill" style="width:${pct}%"></div></div>
        <p class="myth-statement">${item.statement}</p>
        <div class="myth-btn-row">
          ${buttons.map(b => `<button class="myth-q-btn" data-val="${b.value}">${b.label}</button>`).join("")}
        </div>
        <div class="myth-feedback" id="myth-fb"></div>
        <div class="myth-explanation" id="myth-exp"></div>
        <button class="myth-next-btn" id="myth-next">${qIndex >= total - 1 ? "See results →" : "Next →"}</button>
      `;

      area.querySelectorAll(".myth-q-btn").forEach(btn => {
        btn.addEventListener("click", () => handleAnswer(btn.dataset.val, item));
      });
      document.getElementById("myth-next").addEventListener("click", advance);
    }

    function handleAnswer(chosen, item) {
      if (answered) return;
      answered = true;
      const correct = chosen === item.answer;
      if (correct) score++;

      area.querySelectorAll(".myth-q-btn").forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.val === chosen) {
          btn.classList.add(correct ? "correct" : "wrong");
        } else if (btn.dataset.val === item.answer) {
          btn.classList.add("reveal");
        }
      });

      const fb = document.getElementById("myth-fb");
      fb.className = "myth-feedback " + (correct ? "correct" : "wrong");
      fb.textContent = correct ? "Correct! 🌸" : "Not quite 🌷";

      const exp = document.getElementById("myth-exp");
      exp.textContent = item.explanation;
      exp.classList.add("visible");

      document.getElementById("myth-next").classList.add("visible");
    }

    function advance() {
      qIndex++;
      if (qIndex >= queue.length) {
        showResults();
      } else {
        render();
      }
    }

    async function showResults() {
      markSeen(queue);
      const total = queue.length;
      const pct = Math.round((score / total) * 100);
      const isPerfect = score === total;
      const xpEarned = score * XP_PER_CORRECT + (isPerfect ? XP_PERFECT_BONUS : 0);

      // Update XP locally
      const local = loadGame();
      const oldLevel = local.level;
      const newXP = local.xp + xpEarned;
      const newLevel = getLevelInfo(newXP).current.level;
      const updatedGame = { xp: newXP, level: newLevel, sessionsPlayed: (local.sessionsPlayed || 0) + 1 };
      saveGameLocal(updatedGame);

      // Sync to backend
      const serverGame = await syncGameToBackend(xpEarned);
      const finalGame = serverGame || updatedGame;

      refreshLevelUI(finalGame.xp);
      updateFabBadge(finalGame.level);

      const leveledUp = finalGame.level > oldLevel;
      const newLevelInfo = getLevelInfo(finalGame.xp).current;

      let msg;
      if (pct === 100) msg = "Perfect score! 🌸 You really know your body.";
      else if (pct >= 70) msg = "Great work! 🌷 Keep exploring.";
      else if (pct >= 40) msg = "Nice effort! 💡 Every question teaches something new.";
      else msg = "Good start! 🌱 Learning about your body takes time.";

      area.innerHTML = `
        <div class="myth-results">
          <div class="myth-results-score">${score} / ${total}</div>
          <div class="myth-results-label">${msg}</div>
          <div class="myth-xp-earned">+${xpEarned} XP earned${isPerfect ? " (perfect bonus!)" : ""}</div>
          ${leveledUp ? `<div class="myth-levelup">🎉 Level Up! You're now a <strong>${newLevelInfo.emoji} ${newLevelInfo.label}</strong>!</div>` : ""}
          <button class="myth-replay-btn" id="myth-replay">Play again</button>
        </div>
      `;

      document.getElementById("myth-replay").addEventListener("click", () => startGame());
    }

    render();
  }
}
