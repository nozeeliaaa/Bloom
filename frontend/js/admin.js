/**
 * admin.js - Full admin dashboard logic
 * Tabs: Overview | Users | Pamphlets | Clinics
 */

import { renderNav, renderFooter, renderModeBanner } from "./utils.js";
import { onAuthChange, getIdToken, isAdminCached } from "./auth.js";
import { isAccountMode } from "./mode.js";

const API = window.BLOOM_API_BASE + "/api/admin";

renderNav("admin");
renderFooter();
renderModeBanner(document.getElementById("banner-area"));

// ─────────────────────────────────────────
// Auth gate
// ─────────────────────────────────────────
onAuthChange(async (user) => {
  if (!isAccountMode() || !user) {
    window.location.href = "/pages/dashboard.html";
    return;
  }

  // Give role cache a moment to settle, then check
  await new Promise((r) => setTimeout(r, 300));
  if (!isAdminCached()) {
    window.location.href = "/pages/dashboard.html";
    return;
  }

  const subtitleEl = document.getElementById("admin-subtitle");
  if (subtitleEl) subtitleEl.textContent = `Signed in as ${user.email}`;

  initTabs();
  loadOverview();
});

// ─────────────────────────────────────────
// API helper
// ─────────────────────────────────────────
async function api(method, path, body) {
  const token = await getIdToken();
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────
function initTabs() {
  const tabs = document.querySelectorAll(".admin-tab");
  const panels = document.querySelectorAll(".admin-tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;

      tabs.forEach((t) => {
        t.classList.toggle("active", t.dataset.tab === target);
        t.setAttribute("aria-selected", String(t.dataset.tab === target));
      });
      panels.forEach((p) => {
        p.hidden = p.id !== `tab-${target}`;
      });

      // Lazy-load tab content
      if (target === "users") loadUsers();
      if (target === "pamphlets") loadPamphlets();
      if (target === "clinics") loadClinics();
      if (target === "support") loadSupportMessages();
    });
  });

  document.getElementById("admin-refresh-btn").addEventListener("click", () => {
    const active = document.querySelector(".admin-tab.active")?.dataset.tab;
    if (active === "overview") loadOverview();
    if (active === "users") loadUsers();
    if (active === "pamphlets") loadPamphlets();
    if (active === "clinics") loadClinics();
    if (active === "support") loadSupportMessages();
  });

  document.getElementById("users-refresh")?.addEventListener("click", loadUsers);
}

// ─────────────────────────────────────────
// Overview
// ─────────────────────────────────────────
async function loadOverview() {
  try {
    const { stats } = await api("GET", "/stats");

    setText("stat-users", stats.totalUsers ?? "-");
    setText("stat-new-users", stats.newUsersThisWeek ?? "-");

    // Pamphlet + clinic counts come from their own endpoints
    api("GET", "/pamphlets")
      .then((d) => setText("stat-pamphlets", d.pamphlets?.length ?? "-"))
      .catch(() => setText("stat-pamphlets", "-"));

    api("GET", "/clinics")
      .then((d) => setText("stat-clinics", d.clinics?.length ?? "-"))
      .catch(() => setText("stat-clinics", "-"));
  } catch (err) {
    setText("stat-users", "-");
    setText("stat-new-users", "-");
    setText("stat-pamphlets", "-");
    setText("stat-clinics", "-");
    console.error("[admin] overview load failed:", err);
  }
}

// ─────────────────────────────────────────
// Users
// ─────────────────────────────────────────
async function loadUsers(pageToken = null) {
  const listEl = document.getElementById("users-list");
  listEl.innerHTML = `<p class="text-muted">Loading…</p>`;

  try {
    const url = pageToken ? `/users?pageToken=${pageToken}` : "/users";
    const { users, nextPageToken } = await api("GET", url);

    if (!users.length) {
      listEl.innerHTML = `<p class="text-muted">No users found.</p>`;
      return;
    }

    listEl.innerHTML = users.map((u) => `
      <div class="admin-item">
        <div class="admin-item-top">
          <strong>${u.email || "(no email)"}</strong>
          <div style="display:flex;gap:0.4rem;align-items:center;">
            <span class="admin-badge admin-badge--${u.role === "admin" ? "primary" : "neutral"}">${u.role}</span>
            ${u.disabled ? `<span class="admin-badge admin-badge--danger">disabled</span>` : ""}
          </div>
        </div>
        <div class="admin-item-meta">
          UID: ${u.uid} &bull;
          Joined: ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"} &bull;
          Last sign-in: ${u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString() : "-"}
        </div>
        <div style="margin-top:0.5rem;">
          <button class="btn btn-outline btn-sm" data-action="manage-user"
            data-uid="${u.uid}" data-email="${u.email || ""}" data-role="${u.role}"
            data-disabled="${u.disabled}">
            Manage
          </button>
        </div>
      </div>
    `).join("");

    // Pagination
    const pagEl = document.getElementById("users-pagination");
    pagEl.innerHTML = nextPageToken
      ? `<button class="btn btn-outline" id="users-next">Load more</button>`
      : "";
    document.getElementById("users-next")?.addEventListener("click", () => loadUsers(nextPageToken));

    // Manage buttons
    listEl.querySelectorAll("[data-action='manage-user']").forEach((btn) => {
      btn.addEventListener("click", () => openUserModal({
        uid: btn.dataset.uid,
        email: btn.dataset.email,
        role: btn.dataset.role,
        disabled: btn.dataset.disabled === "true",
      }));
    });
  } catch (err) {
    showError("users-list", err.message);
  }
}

// ─────────────────────────────────────────
// Pamphlets
// ─────────────────────────────────────────
async function loadPamphlets() {
  const listEl = document.getElementById("pamphlets-list");
  listEl.innerHTML = `<p class="text-muted">Loading…</p>`;

  try {
    const { pamphlets } = await api("GET", "/pamphlets");

    if (!pamphlets.length) {
      listEl.innerHTML = `<p class="text-muted">No pamphlets yet. Click "+ Add Pamphlet" to create one.</p>`;
      return;
    }

    listEl.innerHTML = pamphlets.map((p) => `
      <div class="admin-item">
        <div class="admin-item-top">
          <strong>${escHtml(p.title)}</strong>
          <div style="display:flex;gap:0.4rem;align-items:center;">
            <span class="admin-badge admin-badge--neutral">${escHtml(p.category)}</span>
            ${p.sensitive ? `<span class="admin-badge admin-badge--warning">sensitive</span>` : ""}
          </div>
        </div>
        <div class="admin-item-meta">${p.readTime ? p.readTime + " read" : ""} ${p.summary ? "- " + escHtml(p.summary.slice(0, 80)) + "…" : ""}</div>
        <div style="margin-top:0.5rem;display:flex;gap:0.4rem;">
          <button class="btn btn-outline btn-sm" data-action="edit-pamphlet" data-id="${p.id}">Edit</button>
          <button class="btn btn-sm" style="background:#ff3b6a;color:#fff;border:none;"
            data-action="delete-pamphlet" data-id="${p.id}" data-title="${escHtml(p.title)}">Delete</button>
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll("[data-action='edit-pamphlet']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = pamphlets.find((x) => x.id === btn.dataset.id);
        if (p) openPamphletModal(p);
      });
    });

    listEl.querySelectorAll("[data-action='delete-pamphlet']").forEach((btn) => {
      btn.addEventListener("click", () => deletePamphlet(btn.dataset.id, btn.dataset.title));
    });
  } catch (err) {
    showError("pamphlets-list", err.message);
  }
}

async function deletePamphlet(id, title) {
  if (!confirm(`Delete pamphlet "${title}"? This cannot be undone.`)) return;
  try {
    await api("DELETE", `/pamphlets/${id}`);
    loadPamphlets();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// ─────────────────────────────────────────
// Clinics
// ─────────────────────────────────────────
async function loadClinics() {
  const listEl = document.getElementById("clinics-list");
  listEl.innerHTML = `<p class="text-muted">Loading…</p>`;

  try {
    const { clinics } = await api("GET", "/clinics");

    if (!clinics.length) {
      listEl.innerHTML = `<p class="text-muted">No clinics yet. Click "+ Add Clinic" to create one.</p>`;
      return;
    }

    listEl.innerHTML = clinics.map((c) => `
      <div class="admin-item">
        <div class="admin-item-top">
          <strong>${escHtml(c.name)}</strong>
          <span class="admin-badge admin-badge--neutral">${escHtml(c.country)}</span>
        </div>
        <div class="admin-item-meta">
          ${c.parish ? escHtml(c.parish) + " &bull; " : ""}
          ${c.address ? escHtml(c.address) + " &bull; " : ""}
          ${c.phone ? escHtml(c.phone) : ""}
        </div>
        ${c.services?.length ? `<div class="admin-item-meta" style="margin-top:0.25rem;">${c.services.map(escHtml).join(", ")}</div>` : ""}
        <div style="margin-top:0.5rem;display:flex;gap:0.4rem;">
          <button class="btn btn-outline btn-sm" data-action="edit-clinic" data-id="${c.id}">Edit</button>
          <button class="btn btn-sm" style="background:#ff3b6a;color:#fff;border:none;"
            data-action="delete-clinic" data-id="${c.id}" data-name="${escHtml(c.name)}">Delete</button>
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll("[data-action='edit-clinic']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = clinics.find((x) => x.id === btn.dataset.id);
        if (c) openClinicModal(c);
      });
    });

    listEl.querySelectorAll("[data-action='delete-clinic']").forEach((btn) => {
      btn.addEventListener("click", () => deleteClinic(btn.dataset.id, btn.dataset.name));
    });
  } catch (err) {
    showError("clinics-list", err.message);
  }
}

async function deleteClinic(id, name) {
  if (!confirm(`Delete clinic "${name}"? This cannot be undone.`)) return;
  try {
    await api("DELETE", `/clinics/${id}`);
    loadClinics();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// ─────────────────────────────────────────
// Pamphlet modal
// ─────────────────────────────────────────
function openPamphletModal(pamphlet = null) {
  const modal = document.getElementById("pamphlet-modal");
  document.getElementById("pamphlet-modal-title").textContent = pamphlet ? "Edit Pamphlet" : "New Pamphlet";
  document.getElementById("pamphlet-id").value = pamphlet?.id || "";
  document.getElementById("pamphlet-title").value = pamphlet?.title || "";
  document.getElementById("pamphlet-category").value = pamphlet?.category || "";
  document.getElementById("pamphlet-summary").value = pamphlet?.summary || "";
  document.getElementById("pamphlet-readtime").value = pamphlet?.readTime || "";
  document.getElementById("pamphlet-sensitive").checked = pamphlet?.sensitive === true;
  document.getElementById("pamphlet-content").value = pamphlet?.content || "";
  // PDF fields
  document.getElementById("pamphlet-pdf-url").value = pamphlet?.pdf || "";
  document.getElementById("pamphlet-pdf-file").value = "";
  const statusEl = document.getElementById("pamphlet-pdf-status");
  statusEl.textContent = pamphlet?.pdf ? "Current PDF saved. Upload a new file to replace it." : "";
  setModalError("pamphlet-modal-error", "");
  openModal(modal);
}

// PDF file → base64 → upload → fill URL field
document.getElementById("pamphlet-pdf-file")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  const statusEl = document.getElementById("pamphlet-pdf-status");
  if (!file) return;
  if (file.type !== "application/pdf") {
    statusEl.textContent = "Only PDF files are accepted.";
    e.target.value = "";
    return;
  }
  statusEl.textContent = "Uploading…";
  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const result = await api("POST", "/pamphlets/upload-pdf", {
      filename: file.name,
      mimeType: "application/pdf",
      data: base64,
    });
    document.getElementById("pamphlet-pdf-url").value = result.url;
    statusEl.textContent = "PDF uploaded successfully.";
  } catch (err) {
    statusEl.textContent = "Upload failed: " + err.message;
  }
});

document.getElementById("pamphlet-add-btn")?.addEventListener("click", () => openPamphletModal());

document.getElementById("pamphlet-save-btn")?.addEventListener("click", async () => {
  const id = document.getElementById("pamphlet-id").value;
  const body = {
    title: document.getElementById("pamphlet-title").value.trim(),
    category: document.getElementById("pamphlet-category").value.trim(),
    summary: document.getElementById("pamphlet-summary").value.trim(),
    readTime: document.getElementById("pamphlet-readtime").value.trim(),
    sensitive: document.getElementById("pamphlet-sensitive").checked,
    content: document.getElementById("pamphlet-content").value.trim(),
    pdf: document.getElementById("pamphlet-pdf-url").value.trim() || null,
  };

  if (!body.title || !body.category || !body.content) {
    setModalError("pamphlet-modal-error", "Title, category, and content are required.");
    return;
  }

  const saveBtn = document.getElementById("pamphlet-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    if (id) {
      await api("PUT", `/pamphlets/${id}`, body);
    } else {
      await api("POST", "/pamphlets", body);
    }
    closeModal(document.getElementById("pamphlet-modal"));
    loadPamphlets();
  } catch (err) {
    setModalError("pamphlet-modal-error", err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// ─────────────────────────────────────────
// Clinic modal
// ─────────────────────────────────────────
function openClinicModal(clinic = null) {
  const modal = document.getElementById("clinic-modal");
  document.getElementById("clinic-modal-title").textContent = clinic ? "Edit Clinic" : "New Clinic";
  document.getElementById("clinic-id").value = clinic?.id || "";
  document.getElementById("clinic-name").value = clinic?.name || "";
  document.getElementById("clinic-country").value = clinic?.country || "Jamaica";
  document.getElementById("clinic-parish").value = clinic?.parish || "";
  document.getElementById("clinic-address").value = clinic?.address || "";
  document.getElementById("clinic-type").value = clinic?.type || "";
  document.getElementById("clinic-phone").value = clinic?.phone || "";
  document.getElementById("clinic-hours").value = clinic?.hours || "";
  document.getElementById("clinic-services").value = Array.isArray(clinic?.services)
    ? clinic.services.join(", ")
    : "";
  setModalError("clinic-modal-error", "");
  openModal(modal);
}

document.getElementById("clinic-add-btn")?.addEventListener("click", () => openClinicModal());

document.getElementById("clinic-save-btn")?.addEventListener("click", async () => {
  const id = document.getElementById("clinic-id").value;
  const servicesRaw = document.getElementById("clinic-services").value;
  const body = {
    name: document.getElementById("clinic-name").value.trim(),
    country: document.getElementById("clinic-country").value.trim(),
    parish: document.getElementById("clinic-parish").value.trim(),
    address: document.getElementById("clinic-address").value.trim(),
    type: document.getElementById("clinic-type").value,
    phone: document.getElementById("clinic-phone").value.trim(),
    hours: document.getElementById("clinic-hours").value.trim(),
    services: servicesRaw.split(",").map((s) => s.trim()).filter(Boolean),
  };

  if (!body.name || !body.country) {
    setModalError("clinic-modal-error", "Name and country are required.");
    return;
  }

  const saveBtn = document.getElementById("clinic-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    if (id) {
      await api("PUT", `/clinics/${id}`, body);
    } else {
      await api("POST", "/clinics", body);
    }
    closeModal(document.getElementById("clinic-modal"));
    loadClinics();
  } catch (err) {
    setModalError("clinic-modal-error", err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// ─────────────────────────────────────────
// User modal
// ─────────────────────────────────────────
function openUserModal({ uid, email, role, disabled }) {
  document.getElementById("user-modal-uid").value = uid;
  document.getElementById("user-modal-email").textContent = email || uid;
  document.getElementById("user-modal-role").value = role || "user";

  const disableBtn = document.getElementById("user-disable-btn");
  const enableBtn = document.getElementById("user-enable-btn");
  disableBtn.style.display = disabled ? "none" : "";
  enableBtn.style.display = disabled ? "" : "none";

  setModalError("user-modal-error", "");
  openModal(document.getElementById("user-modal"));
}

document.getElementById("user-save-btn")?.addEventListener("click", async () => {
  const uid = document.getElementById("user-modal-uid").value;
  const role = document.getElementById("user-modal-role").value;
  const saveBtn = document.getElementById("user-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    await api("POST", `/users/${uid}/promote`, { role });
    closeModal(document.getElementById("user-modal"));
    loadUsers();
  } catch (err) {
    setModalError("user-modal-error", err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Role";
  }
});

document.getElementById("user-disable-btn")?.addEventListener("click", async () => {
  const uid = document.getElementById("user-modal-uid").value;
  if (!confirm("Disable this user's account?")) return;
  try {
    await api("POST", `/users/${uid}/disable`);
    closeModal(document.getElementById("user-modal"));
    loadUsers();
  } catch (err) {
    setModalError("user-modal-error", err.message);
  }
});

document.getElementById("user-enable-btn")?.addEventListener("click", async () => {
  const uid = document.getElementById("user-modal-uid").value;
  try {
    await api("POST", `/users/${uid}/enable`);
    closeModal(document.getElementById("user-modal"));
    loadUsers();
  } catch (err) {
    setModalError("user-modal-error", err.message);
  }
});

// ─────────────────────────────────────────
// Modal open/close helpers
// ─────────────────────────────────────────
function openModal(el) {
  el.hidden = false;
  document.body.style.overflow = "hidden";
  el.querySelector("input, select, textarea")?.focus();
}

function closeModal(el) {
  el.hidden = true;
  document.body.style.overflow = "";
}

// Close buttons via data-close attribute
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const modal = document.getElementById(btn.dataset.close);
    if (modal) closeModal(modal);
  });
});

// Click outside to close
document.querySelectorAll(".admin-modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
});

// ─────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<p class="admin-error">${escHtml(msg)}</p>`;
}

function setModalError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────
// BLOOMIE ANALYTICS
// ─────────────────────────────────────────
async function loadBloomieAnalytics() {
  const statusEl = document.getElementById("ba-status");
  if (statusEl) { statusEl.textContent = "Loading…"; statusEl.hidden = false; }

  try {
    const { summary } = await api("GET", "/bloomie-analytics/summary");

    if (statusEl) statusEl.hidden = true;

    // KPIs
    setText("ba-fallbacks", summary.fallbackCount ?? 0);
    setText("ba-no-match",  summary.noMatchCount  ?? 0);
    setText("ba-urgency",   summary.urgencyEscalationCount ?? 0);
    setText("ba-oos",       summary.oosEventCount ?? 0);
    setText("ba-avg-depth", summary.avgSessionDepth ?? 0);

    // Confidence tiers
    const tiers = summary.confidenceTierDistribution || {};
    setText("ba-confidence-high",   tiers.HIGH   ?? 0);
    setText("ba-confidence-medium", tiers.MEDIUM ?? 0);
    setText("ba-confidence-low",    tiers.LOW    ?? 0);

    // Route distribution (top 10)
    const routeEl = document.getElementById("ba-route-list");
    if (routeEl) {
      const routes = Object.entries(summary.routeDistribution || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      routeEl.innerHTML = routes.length
        ? routes.map(([route, count]) => `
            <div class="admin-item" style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;">
              <code style="font-size:.82rem;">${escHtml(route)}</code>
              <span class="admin-badge admin-badge--neutral">${count}</span>
            </div>`).join("")
        : `<p class="text-muted" style="font-size:.85rem;">No data yet.</p>`;
    }

    // Tone distribution
    const toneEl = document.getElementById("ba-tone-list");
    if (toneEl) {
      const tones = Object.entries(summary.toneDistribution || {})
        .sort((a, b) => b[1] - a[1]);
      toneEl.innerHTML = tones.length
        ? tones.map(([tone, count]) => `
            <div class="admin-item" style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;">
              <span style="font-size:.88rem;">${escHtml(tone)}</span>
              <span class="admin-badge admin-badge--neutral">${count}</span>
            </div>`).join("")
        : `<p class="text-muted" style="font-size:.85rem;">No data yet.</p>`;
    }

    // Emotion source distribution
    const sourceEl = document.getElementById("ba-source-list");
    if (sourceEl) {
      const sources = Object.entries(summary.emotionSourceDistribution || {})
        .sort((a, b) => b[1] - a[1]);
      sourceEl.innerHTML = sources.length
        ? sources.map(([src, count]) => `
            <div class="admin-item" style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;">
              <span style="font-size:.88rem;">${escHtml(src)}</span>
              <span class="admin-badge admin-badge--neutral">${count}</span>
            </div>`).join("")
        : `<p class="text-muted" style="font-size:.85rem;">No data yet.</p>`;
    }

    // Top no-match phrases
    const phraseEl = document.getElementById("ba-no-match-phrases");
    if (phraseEl) {
      const phrases = summary.topNoMatchPhrases || [];
      phraseEl.innerHTML = phrases.length
        ? phrases.map(({ phrase, count }) => `
            <div class="admin-item" style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;">
              <span style="font-size:.82rem;word-break:break-word;max-width:160px;">${escHtml(phrase)}</span>
              <span class="admin-badge admin-badge--neutral">${count}</span>
            </div>`).join("")
        : `<p class="text-muted" style="font-size:.85rem;">No data yet.</p>`;
    }

  } catch (err) {
    if (statusEl) { statusEl.textContent = `Failed to load: ${err.message}`; statusEl.hidden = false; }
  }
}

// ─────────────────────────────────────────
// Support Messages
// ─────────────────────────────────────────

const STATUS_LABELS = { new: "New", open: "Open", resolved: "Resolved" };
const STATUS_BADGE_CLASSES = {
  new: "support-card-badge--new",
  open: "support-card-badge--open",
  resolved: "support-card-badge--resolved",
};
const SUBJECT_LABELS = {
  bug: "Something is not working",
  data: "Question about my data",
  privacy: "Privacy concern",
  feedback: "General feedback",
  accessibility: "Accessibility issue",
  other: "Other",
};

async function loadSupportMessages() {
  const list   = document.getElementById("support-list");
  const filter = document.getElementById("support-status-filter").value;
  const summaryWrap = document.getElementById("support-summary");
  list.innerHTML = "<p class='text-muted'>Loading…</p>";
  if (summaryWrap) summaryWrap.hidden = true;

  try {
    const { messages } = await api("GET", "/contact-messages");

    const counts = { new: 0, open: 0, resolved: 0 };
    messages.forEach((m) => {
      if (Object.prototype.hasOwnProperty.call(counts, m.status)) counts[m.status] += 1;
    });
    setText("support-count-new", counts.new);
    setText("support-count-open", counts.open);
    setText("support-count-resolved", counts.resolved);
    if (summaryWrap) summaryWrap.hidden = false;

    const filtered = filter ? messages.filter((m) => m.status === filter) : messages;

    if (!filtered.length) {
      list.innerHTML = "<p class='text-muted'>No support requests found.</p>";
      return;
    }

    list.innerHTML = filtered.map((m) => {
      const date = m.createdAt ? new Date(m.createdAt).toLocaleString() : "-";
      const statusClass = STATUS_BADGE_CLASSES[m.status] || "support-card-badge--new";
      const statusLabel = STATUS_LABELS[m.status] || (m.status || "-");
      const subjectLabel = SUBJECT_LABELS[m.subject] || m.subject || "-";
      const hasReply = Boolean(m.replyEmail);
      const mailHref = hasReply
        ? `mailto:${escAttr(m.replyEmail)}?subject=${encodeURIComponent(`Re: Bloom support ${m.requestId || ""}`)}`
        : "";
      const options = ["new", "open", "resolved"]
        .map((s) => `<option value="${s}"${m.status === s ? " selected" : ""}>${STATUS_LABELS[s]}</option>`)
        .join("");

      return `
        <article class="support-card">
          <div class="support-card-header">
            <div>
              <div class="support-card-id">${escHtml(m.requestId || "-")}</div>
              <div class="support-card-date">${escHtml(date)}</div>
            </div>
            <span class="support-card-badge ${statusClass}">${escHtml(statusLabel)}</span>
          </div>

          <div class="support-card-meta">
            <div class="support-meta-row"><strong>Subject:</strong> ${escHtml(subjectLabel)}</div>
            ${m.name ? `<div class="support-meta-row"><strong>Name:</strong> ${escHtml(m.name)}</div>` : ""}
            ${m.replyEmail ? `<div class="support-meta-row"><strong>Reply-to:</strong> ${escHtml(m.replyEmail)}</div>` : ""}
            ${m.userId ? `<div class="support-meta-row"><strong>User ID:</strong> ${escHtml(m.userId)}</div>` : ""}
          </div>

          <div class="support-card-message">${escHtml(m.message || "-")}</div>

          <div class="support-card-footer">
            <div>
              ${
                hasReply
                  ? `<a class="btn btn-outline btn-sm" href="${mailHref}">Reply by Email</a>`
                  : `<span class="text-muted" style="font-size:0.84rem;">No reply email provided</span>`
              }
            </div>
            <label class="support-status-group">
              <span>Status</span>
              <select class="admin-select" data-id="${escAttr(m.id)}" data-action="status">
                ${options}
              </select>
            </label>
          </div>
        </article>`;
    }).join("");

    // Status change handlers
    list.querySelectorAll("select[data-action='status']").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          await api("PATCH", `/contact-messages/${sel.dataset.id}/status`, { status: sel.value });
          await loadSupportMessages();
        } catch (err) {
          alert("Could not update status: " + err.message);
        }
      });
    });

  } catch (err) {
    list.innerHTML = `<p class="text-muted">Failed to load: ${err.message}</p>`;
    if (summaryWrap) summaryWrap.hidden = true;
  }
}

document.getElementById("support-status-filter")?.addEventListener("change", loadSupportMessages);
document.getElementById("support-refresh-btn")?.addEventListener("click", loadSupportMessages);
