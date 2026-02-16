/**
 * Shared utility functions: nav, footer, date helpers
 */
import { getMode, isAccountMode } from "./mode.js";
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
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  login: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  chevLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
};

export function icon(name, size = 18) {
  const html = ICONS[name] || "";
  return `<span style="display:inline-flex;width:${size}px;height:${size}px;" aria-hidden="true">${html}</span>`;
}

/* ===== NAVIGATION ===== */
export function renderNav(activePage = "") {
  const mode = getMode();
  const nav = document.createElement("nav");
  nav.className = "navbar";
  nav.setAttribute("role", "navigation");
  nav.setAttribute("aria-label", "Main navigation");

  const links = [
  { href: "/pages/dashboard.html", label: "Dashboard", icon: "home", page: "dashboard" },
  { href: "/pages/calendar.html", label: "Calendar", icon: "calendar", page: "calendar" },
  { href: "/pages/assistant.html", label: "Bloomie", icon: "chat", page: "assistant" },
  { href: "/pages/pamphlets.html", label: "Learn", icon: "book", page: "pamphlets" },
  { href: "/pages/clinics.html", label: "Clinics", icon: "mapPin", page: "clinics" },
];

const avatar = localStorage.getItem("bloom_avatar") || "👤"; // emoji avatar fallback
const profileBtn = `
  <a href="/pages/profile.html" class="nav-avatar ${activePage === "profile" ? "active" : ""}" aria-label="Open profile">
    <span class="nav-avatar-circle">${avatar}</span>
  </a>
`;


  nav.innerHTML = `
    <div class="navbar-inner">
      <a href="/frontend/index.html" class="navbar-brand" aria-label="Bloom home">
        ${icon("flower", 28)} Bloom
      </a>
      <button class="nav-toggle" aria-label="Toggle navigation menu" aria-expanded="false">
        ${icon("menu", 24)}
      </button>
      <div class="navbar-links" role="menubar">
        ${links
          .map(
            (l) =>
              `<a href="${l.href}" role="menuitem" class="${
                activePage === l.page ? "active" : ""
              }">${icon(l.icon, 16)} ${l.label}</a>`
          )
          .join("")}
        <span class="nav-spacer" aria-hidden="true"></span>
        ${profileBtn}
      </div>
    </div>
  `;

  document.body.prepend(nav);

  // Mobile toggle
  const toggle = nav.querySelector(".nav-toggle");
  const linkContainer = nav.querySelector(".navbar-links");

  toggle.addEventListener("click", () => {
    const open = linkContainer.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Close on click (mobile)
  linkContainer.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => linkContainer.classList.remove("open"));
  });
}

/* ===== FOOTER ===== */
export function renderFooter() {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.setAttribute("role", "contentinfo");
  footer.innerHTML = `
    <p class="footer-disclaimer">${icon(
      "shield",
      14
    )} Bloom is an educational tool and does not provide medical diagnoses. Always consult a qualified healthcare provider for medical advice.</p>
    <p>&copy; ${new Date().getFullYear()} Bloom &mdash; Caribbean Reproductive Health Support</p>
  `;
  document.body.appendChild(footer);
}

/* ===== MODE BANNER ===== */
export function renderModeBanner(container) {
  if (!container) return;

  // Only show if flag is set
  if (localStorage.getItem(MODE_BANNER_ONCE_KEY) !== "1") {
    container.innerHTML = "";
    return;
  }

  // clear it so it won't show again
  localStorage.removeItem(MODE_BANNER_ONCE_KEY);

  // show only for account mode
  if (!isAccountMode()) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <div class="banner banner-success">
      ✅ Synced to cloud. Your data is backed up securely.
    </div>
  `;
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
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][monthIndex];
}

export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

/* ===== SYMPTOM LIST ===== */
export const SYMPTOMS = [
  "Cramps",
  "Bloating",
  "Headache",
  "Fatigue",
  "Mood swings",
  "Breast tenderness",
  "Back pain",
  "Nausea",
  "Acne",
  "Insomnia",
  "Hot flashes",
  "Night sweats",
  "Dizziness",
  "Food cravings",
  "Joint pain",
  "Anxiety",
  "Irritability",
  "Brain fog",
];

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

// Add toast animation
const style = document.createElement("style");
style.textContent = `@keyframes slideIn { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
document.head.appendChild(style);


export function renderBloomieFab() {
  // Avoid duplicates if multiple scripts call it
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

