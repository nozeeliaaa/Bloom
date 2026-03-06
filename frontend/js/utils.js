/**
 * Shared utility functions: nav, footer, date helpers
 */
import { isAccountMode } from "./mode.js";
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

  const links = [
    { href: "/pages/dashboard.html", label: "Dashboard", icon: "home", page: "dashboard" },
    { href: "/pages/calendar.html", label: "Calendar", icon: "calendar", page: "calendar" },
    { href: "/pages/assistant.html", label: "Bloomie", icon: "chat", page: "assistant" },
    { href: "/pages/pamphlets.html", label: "Learn", icon: "book", page: "pamphlets" },
    { href: "/pages/clinics.html", label: "Clinics", icon: "mapPin", page: "clinics" },
  ];

  // ✅ Admin link: account-only + cached flag set by auth.js
  const showAdmin = isAccountMode() && localStorage.getItem("bloom_is_admin") === "1";
  if (showAdmin) links.push({ href: "/pages/admin.html", label: "Admin", icon: "admin", page: "admin" });

  const avatar = localStorage.getItem("bloom_avatar") || "👤";
  const profileBtn = `
    <a href="/pages/profile.html" class="nav-avatar ${activePage === "profile" ? "active" : ""}" aria-label="Open profile">
      <span class="nav-avatar-circle">${avatar}</span>
    </a>
  `;

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
        ${profileBtn}
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
}

/* ===== FOOTER ===== */
export function renderFooter() {
  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.setAttribute("role", "contentinfo");
  footer.innerHTML = `
    <p class="footer-disclaimer">${icon("shield", 14)} Bloom is an educational tool and does not provide medical diagnoses. Always consult a qualified healthcare provider for medical advice.</p>
    <p>&copy; ${new Date().getFullYear()} Bloom &mdash; Jamaican Reproductive Health Support</p>
  `;
  document.body.appendChild(footer);
}

/* ===== MODE BANNER ===== */
export function renderModeBanner(container) {
  if (!container) return;

  if (localStorage.getItem(MODE_BANNER_ONCE_KEY) !== "1") {
    container.innerHTML = "";
    return;
  }

  localStorage.removeItem(MODE_BANNER_ONCE_KEY);

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
  "Pain & Discomfort": ["Cramps", "Back pain", "Headache", "Joint pain", "Pelvic pain", "Muscle aches"],
  "Digestive": ["Bloating", "Nausea", "Food cravings", "Appetite changes", "Constipation", "Diarrhea"],
  "Energy & Sleep": ["Fatigue", "Insomnia", "Brain fog", "Dizziness", "Low energy", "Oversleeping"],
  "Mood & Mental": ["Mood swings", "Anxiety", "Irritability", "Depression", "Stress", "Low motivation"],
  "Skin & Body": ["Acne", "Breast tenderness", "Hot flashes", "Night sweats", "Swelling", "Hair changes"],
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