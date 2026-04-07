/**
 * Shared utility functions: nav, footer, date helpers
 */
import { isAccountMode, isAnonMode } from "./mode.js";
import { getUser } from "./auth.js";
import { initTheme } from "./theme-manager.js";

// ✅ Single source of truth for this key
export const MODE_BANNER_ONCE_KEY = "bloom_show_mode_banner_once";

// Initialize theme on every page load (prevents flash of wrong theme)
initTheme();

/* ===== ICONS (inline SVG) ===== */
export const ICONS = {
  flower: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2a4 4 0 0 1 0 8 4 4 0 0 1 0-8z" fill="currentColor" opacity="0.2"/><path d="M12 2c1.5 0 3 1.5 3 4s-1.5 4-3 4-3-1.5-3-4 1.5-4 3-4z"/><path d="M19.1 4.9c1.1 1.1.7 3.1-1 4.8s-3.7 2.1-4.8 1-0.7-3.1 1-4.8 3.7-2.1 4.8-1z"/><path d="M22 12c0 1.5-1.5 3-4 3s-4-1.5-4-3 1.5-3 4-3 4 1.5 4 3z"/><path d="M19.1 19.1c-1.1 1.1-3.1.7-4.8-1s-2.1-3.7-1-4.8 3.1-.7 4.8 1 2.1 3.7 1 4.8z"/><path d="M12 22c-1.5 0-3-1.5-3-4s1.5-4 3-4 3 1.5 3 4-1.5 4-3 4z"/><path d="M4.9 19.1c-1.1-1.1-.7-3.1 1-4.8s3.7-2.1 4.8-1 .7 3.1-1 4.8-3.7 2.1-4.8 1z"/><path d="M2 12c0-1.5 1.5-3 4-3s4 1.5 4 3-1.5 3-4 3-4-1.5-4-3z"/><path d="M4.9 4.9c1.1-1.1 3.1-.7 4.8 1s2.1 3.7 1 4.8-3.1.7-4.8-1-2.1-3.7-1-4.8z"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M9 21V12h6v9"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  mapPin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6l7-4z"/><path d="M9 12l2 2 4-4"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

export function icon(name, size = 18) {
  const html = ICONS[name] || "";
  return `<span style="display:inline-flex;width:${size}px;height:${size}px;" aria-hidden="true">${html}</span>`;
}

/* ===== NAVIGATION ===== */
export function renderNav(activePage = "") {
  const nav = document.createElement("nav");
  nav.className = "navbar";
  nav.setAttribute("role", "navigation");
  nav.setAttribute("aria-label", "Main navigation");

  const anon = isAnonMode();

  const allLinks = [
    { href: "/pages/dashboard.html", label: "Dashboard", icon: "home", page: "dashboard" },
    { href: "/pages/calendar.html",  label: "Calendar",  icon: "calendar", page: "calendar" },
    { href: "/pages/assistant.html", label: "Bloomie",   icon: "chat", page: "assistant", accountOnly: true },
    { href: "/pages/pamphlets.html", label: "Learn",     icon: "book", page: "pamphlets" },
    { href: "/pages/clinics.html",   label: "Clinics",   icon: "mapPin", page: "clinics" },
  ];

  const links = allLinks.filter(l => !l.accountOnly || !anon);

  // ✅ Admin link: account-only + cached flag set by auth.js
  const showAdmin = isAccountMode() && localStorage.getItem("bloom_is_admin") === "1";
  if (showAdmin) links.push({ href: "/pages/admin.html", label: "Admin", icon: "admin", page: "admin" });

  const avatar = localStorage.getItem("bloom_avatar") || "👤";

  // Account mode: avatar + logout button
  // Anon mode: "Create an account" outline button
  const profileSection = anon
    ? `<a href="/pages/register.html" class="btn btn-outline btn-sm nav-login-btn">Create an account</a>`
    : `<a href="/pages/profile.html" class="nav-avatar ${activePage === 'profile' ? 'active' : ''}" aria-label="Open profile">
        <span class="nav-avatar-circle">${avatar}</span>
      </a>`;

  nav.innerHTML = `
    <div class="navbar-inner">
      <a href="/index.html" class="navbar-brand" aria-label="Bloom home">
        <img src="/assets/bloom-logo.png" alt="Bloom" class="navbar-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';" />
        <span class="navbar-brand-text" style="display:none;">${icon("flower", 28)} Bloom</span>
      </a>
      <button class="nav-toggle" aria-label="Toggle navigation menu" aria-expanded="false">
        ${icon("menu", 24)}
      </button>
      <div class="navbar-links" role="menubar">
        ${links
          .map(
            (l) =>
              `<a href="${l.href}" role="menuitem" class="${activePage === l.page ? "active" : ""}">
                ${icon(l.icon, 16)} ${l.label}
              </a>`
          )
          .join("")}
        <span class="nav-spacer" aria-hidden="true"></span>
        <div class="nav-bell-wrap" id="nav-bell-wrap">
          <button class="nav-bell" id="nav-bell-btn" aria-label="Notifications" aria-expanded="false" type="button">
            ${icon("bell", 18)}
            <span class="nav-bell-badge" id="nav-bell-badge" hidden>0</span>
          </button>
          <div class="notif-dropdown" id="notif-dropdown" hidden>
            <div class="notif-dropdown-header">
              <span class="notif-dropdown-title">Notifications</span>
              <button class="notif-clear-btn" id="notif-clear-btn" type="button">Clear all</button>
            </div>
            <div id="notif-list" class="notif-list"></div>
          </div>
        </div>
        ${profileSection}
      </div>
    </div>
  `;

  document.body.prepend(nav);

  const toggle = nav.querySelector(".nav-toggle");
  const linkContainer = nav.querySelector(".navbar-links");

  toggle.addEventListener("click", () => {
    const open = linkContainer.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  linkContainer.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => linkContainer.classList.remove("open"));
  });

  // ── Back button (inject for non-primary pages) ───────────────────────────
  const PRIMARY_PAGES = new Set(["dashboard", "calendar", "assistant", "pamphlets", "clinics", ""]);
  if (!PRIMARY_PAGES.has(activePage)) {
    const back = document.createElement("div");
    back.className = "back-btn-wrap";
    back.innerHTML = `
      <button class="back-btn" type="button" aria-label="Go back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>`;
    back.querySelector(".back-btn").addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.href = "/pages/dashboard.html";
      }
    });
    // Insert at top of <main> if present, else after <nav>
    const main = document.querySelector("main");
    if (main) main.prepend(back);
    else nav.insertAdjacentElement("afterend", back);
  }

  // ── Notification bell logic ──────────────────────────────────────────────
  const INBOX_KEY = "bloom_notification_inbox";

  function readInbox() {
    try { return JSON.parse(localStorage.getItem(INBOX_KEY)) || []; }
    catch { return []; }
  }

  function saveInbox(inbox) {
    localStorage.setItem(INBOX_KEY, JSON.stringify(inbox));
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)  return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function refreshBell() {
    const inbox = readInbox();
    const badge = document.getElementById("nav-bell-badge");
    const unread = inbox.filter((n) => !n.read).length;
    if (badge) {
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.hidden = unread === 0;
    }
  }

  function renderNotifList() {
    const list = document.getElementById("notif-list");
    if (!list) return;
    const inbox = readInbox();
    if (!inbox.length) {
      list.innerHTML = `<div class="notif-empty">No notifications yet</div>`;
      return;
    }
    list.innerHTML = inbox.map((n) => `
      <div class="notif-item${n.read ? "" : " notif-unread"}">
        <div class="notif-item-title">${n.title}</div>
        <div class="notif-item-body">${n.body}</div>
        <div class="notif-item-time">${timeAgo(n.ts)}</div>
      </div>
    `).join("");
  }

  function openDropdown() {
    const dropdown = document.getElementById("notif-dropdown");
    const bellBtn  = document.getElementById("nav-bell-btn");
    if (!dropdown) return;
    dropdown.hidden = false;
    bellBtn?.setAttribute("aria-expanded", "true");
    // Mark all read
    const inbox = readInbox().map((n) => ({ ...n, read: true }));
    saveInbox(inbox);
    refreshBell();
    renderNotifList();
  }

  function closeDropdown() {
    const dropdown = document.getElementById("notif-dropdown");
    const bellBtn  = document.getElementById("nav-bell-btn");
    if (dropdown) dropdown.hidden = true;
    bellBtn?.setAttribute("aria-expanded", "false");
  }

  refreshBell();

  document.getElementById("nav-bell-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById("notif-dropdown");
    if (dropdown?.hidden) {
      openDropdown();
    } else {
      closeDropdown();
    }
  });

  document.getElementById("notif-clear-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    saveInbox([]);
    refreshBell();
    renderNotifList();
  });

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("nav-bell-wrap");
    if (wrap && !wrap.contains(e.target)) closeDropdown();
  });
}

/* ===== FOOTER ===== */
export function renderFooter() {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.setAttribute("role", "contentinfo");
  footer.innerHTML = `
    <p class="footer-disclaimer">${icon("shield", 14)} Bloom is an educational tool and does not provide medical diagnoses. Always consult a qualified healthcare provider for medical advice.</p>
    <nav class="footer-legal" aria-label="Legal links">
      <a href="/pages/privacy.html">Privacy Policy</a>
      <span class="footer-legal-sep" aria-hidden="true">·</span>
      <a href="/pages/terms.html">Terms of Use</a>
      <span class="footer-legal-sep" aria-hidden="true">·</span>
      <a href="/pages/accessibility.html">Accessibility</a>
      <span class="footer-legal-sep" aria-hidden="true">·</span>
      <a href="/pages/cookie-policy.html">Cookie Policy</a>
      <span class="footer-legal-sep" aria-hidden="true">·</span>
      <a href="/pages/about-us.html">About Us</a>
    </nav>
  `;
  document.body.appendChild(footer);
}

/* ===== MODE BANNER ===== */
export function renderModeBanner(container) {
  if (!container) return;

  // Consent status banner - shown to teens with a pending approval request
  const _consentUser = getUser();
  const _consentKey  = _consentUser ? `bloom_consent_status_${_consentUser.uid}` : null;
  const consentStatus = _consentKey ? localStorage.getItem(_consentKey) : null;
  if (consentStatus === "pending") {
    container.innerHTML = `
      <div class="banner banner-warning" role="status">
        ⏳ Your account is waiting for guardian approval.
        <a href="/pages/consent-pending.html" style="font-weight:700;margin-left:0.5rem;">View status</a>
      </div>
    `;
    return;
  }

}

/* ===== DATE HELPERS ===== */
export function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getMonthName(monthIndex) {
  return [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ][monthIndex];
}

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

/* ===== SYMPTOM LIST ===== */
export const SYMPTOM_CATEGORIES = {
  "Bleeding":       ["Vaginal bleeding", "Spotting", "Heavy flow", "Large clots"],
  "Pain":           ["Cramps", "Pelvic pain", "Ovulation pain", "Headache", "Joint or muscle pain", "Breast tenderness"],
  "Digestive":      ["Bloating", "Gassy", "Heartburn", "Nausea", "Constipation", "Diarrhea"],
  "Discharge":      ["No discharge", "Sticky discharge", "Creamy discharge", "Egg-white discharge", "Unusual discharge"],
  "Energy & Sleep": ["Fatigue", "Insomnia", "Brain fog", "Forgetfulness", "Poor concentration"],
  "Mood":           ["Mood swings", "Irritability", "Anxiety", "Low mood", "Crying spells", "Calm", "Stressed"],
  "Skin & Hair":    ["Acne", "Dry skin", "Hair thinning"],
  "Temperature":    ["Hot flashes", "Night sweats", "Cold flashes", "Basal temp shift"],
  "Cravings":       ["Sweet cravings", "Salty cravings", "Greasy food cravings", "Spicy food cravings", "Increased appetite", "Decreased appetite"],
  "Physical":       ["Fluid retention", "Frequent urination", "Smell sensitivity", "Nasal congestion", "Weight change"],
  "Social":         ["Sociable", "Withdrawn"],
  "Cycle":          ["Missed period", "Irregular period"],
  "Fertility":      ["Increased libido", "Decreased libido", "Cervical mucus change", "Vaginal dryness", "Pain during sex"],
};

/** Health-icons path for each symptom label (resolvetosavelives/healthicons) */
const _HI = 'https://raw.githubusercontent.com/resolvetosavelives/healthicons/main/public/icons/svg/filled';
export const SYMPTOM_ICONS = {
  // Bleeding
  "Vaginal bleeding":      `${_HI}/body/blood-drop.svg`,
  "Spotting":              `${_HI}/body/blood-drop.svg`,
  "Heavy flow":            `${_HI}/body/blood-drop.svg`,
  "Large clots":           `${_HI}/body/blood-cells.svg`,
  // Pain
  "Cramps":                `${_HI}/conditions/intestinal-pain.svg`,
  "Pelvic pain":           `${_HI}/conditions/intestinal-pain.svg`,
  "Ovulation pain":        `${_HI}/body/female-reproductive_system.svg`,
  "Headache":              `${_HI}/conditions/headache.svg`,
  "Joint or muscle pain":  `${_HI}/body/joints.svg`,
  "Breast tenderness":     `${_HI}/body/breasts.svg`,
  // Digestive
  "Bloating":              `${_HI}/body/stomach.svg`,
  "Gassy":                 `${_HI}/body/intestine.svg`,
  "Heartburn":             `${_HI}/body/stomach.svg`,
  "Nausea":                `${_HI}/conditions/nausea.svg`,
  "Constipation":          `${_HI}/body/intestine.svg`,
  "Diarrhea":              `${_HI}/conditions/diarrhea.svg`,
  // Discharge
  "No discharge":          `${_HI}/body/vagina.svg`,
  "Sticky discharge":      `${_HI}/body/vagina.svg`,
  "Creamy discharge":      `${_HI}/body/vagina.svg`,
  "Egg-white discharge":   `${_HI}/body/vagina-alt.svg`,
  "Unusual discharge":     `${_HI}/conditions/sti.svg`,
  // Energy & Sleep
  "Fatigue":               `${_HI}/emotions/sleepy.svg`,
  "Insomnia":              `${_HI}/emotions/woozy.svg`,
  "Brain fog":             `${_HI}/emotions/dizzy.svg`,
  "Forgetfulness":         `${_HI}/body/neurology.svg`,
  "Poor concentration":    `${_HI}/body/neurology.svg`,
  // Mood
  "Mood swings":           `${_HI}/emotions/woozy.svg`,
  "Irritability":          `${_HI}/emotions/angry.svg`,
  "Anxiety":               `${_HI}/emotions/nervous.svg`,
  "Low mood":              `${_HI}/emotions/sad.svg`,
  "Crying spells":         `${_HI}/emotions/crying.svg`,
  "Calm":                  `${_HI}/emotions/calm.svg`,
  "Stressed":              `${_HI}/emotions/not-ok.svg`,
  // Skin & Hair
  "Acne":                  `${_HI}/conditions/allergies.svg`,
  "Dry skin":              `${_HI}/conditions/dry-eyes.svg`,
  "Hair thinning":         `${_HI}/body/head.svg`,
  // Temperature
  "Hot flashes":           `${_HI}/emotions/sweating.svg`,
  "Night sweats":          `${_HI}/emotions/sweating.svg`,
  "Cold flashes":          `${_HI}/conditions/chills.svg`,
  "Basal temp shift":      `${_HI}/emotions/fever.svg`,
  // Cravings
  "Sweet cravings":        `${_HI}/nutrition/sugar.svg`,
  "Salty cravings":        `${_HI}/nutrition/nutrition.svg`,
  "Greasy food cravings":  `${_HI}/nutrition/unhealthy-food.svg`,
  "Spicy food cravings":   `${_HI}/nutrition/hot-meal.svg`,
  "Increased appetite":    `${_HI}/nutrition/nutrition.svg`,
  "Decreased appetite":    `${_HI}/nutrition/nutrition.svg`,
  // Physical
  "Fluid retention":       `${_HI}/body/kidneys.svg`,
  "Frequent urination":    `${_HI}/body/bladder.svg`,
  "Smell sensitivity":     `${_HI}/body/nose.svg`,
  "Nasal congestion":      `${_HI}/body/nose.svg`,
  "Weight change":         `${_HI}/conditions/overweight.svg`,
  // Social
  "Sociable":              `${_HI}/emotions/happy.svg`,
  "Withdrawn":             `${_HI}/emotions/neutral.svg`,
  // Cycle
  "Missed period":         `${_HI}/body/female-reproductive_system.svg`,
  "Irregular period":      `${_HI}/body/female-reproductive_system.svg`,
  // Fertility
  "Increased libido":      `${_HI}/emotions/happy.svg`,
  "Decreased libido":      `${_HI}/emotions/sad.svg`,
  "Cervical mucus change": `${_HI}/body/vagina-alt.svg`,
  "Vaginal dryness":       `${_HI}/conditions/dry-mouth.svg`,
  "Pain during sex":       `${_HI}/conditions/pain.svg`,
};

export const SYMPTOMS = Object.values(SYMPTOM_CATEGORIES).flat();

export const FLOW_OPTIONS = ["none", "spotting", "light", "medium", "heavy"];

export function getPostAuthRoute() {
  const onboarded = localStorage.getItem("bloom_onboarded") === "1";
  return onboarded ? "/pages/dashboard.html" : "/pages/survey.html";
}

/* ===== MODAL HELPERS ===== */
export function openModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.classList.add("open");
    overlay.querySelector(".modal")?.focus();
    document.body.style.overflow = "hidden";
  }
}

export function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }
}

/* ===== TOAST NOTIFICATION ===== */
export function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  const bg =
    type === "success"
      ? "var(--color-secondary)"
      : type === "error"
      ? "var(--color-danger)"
      : "var(--color-primary)";

  toast.style.cssText = `
    position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 300;
    background: ${bg}; color: #fff; padding: 0.75rem 1.25rem;
    border-radius: var(--radius); font-size: 0.9rem; font-weight: 600;
    box-shadow: var(--shadow-lg); animation: slideIn 0.3s ease;
  `;

  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
  }, 2500);

  setTimeout(() => toast.remove(), 2800);
}

const style = document.createElement("style");
style.textContent = `@keyframes slideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
document.head.appendChild(style);

export function renderBloomieFab() {
  if (document.getElementById("bloomie-fab")) return;

  const fab = document.createElement("button");
  fab.id = "bloomie-fab";
  fab.className = "bloomie-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "Open Bloomie chat");
  fab.innerHTML = ICONS.chat;

  const modal = document.createElement("div");
  modal.id = "bloomie-modal";
  modal.className = "bloomie-modal";
  modal.innerHTML = `
    <div class="bloomie-modal-backdrop" data-close="1"></div>
    <div class="bloomie-modal-panel" role="dialog" aria-modal="true">
      <div class="bloomie-modal-header">
        <strong>Bloomie</strong>
        <button class="bloomie-close" data-close="1" aria-label="Close">✕</button>
      </div>
      <iframe class="bloomie-frame" src="/pages/assistant.html" title="Bloomie chat"></iframe>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.appendChild(fab);

  function open() { modal.classList.add("open"); }
  function close() { modal.classList.remove("open"); }

  fab.addEventListener("click", open);
  modal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) close();
  });
}