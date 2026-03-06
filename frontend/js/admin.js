/**
 * admin.js — Full admin dashboard logic
 * Tabs: Overview | Users | Pamphlets | Clinics
 */

import { renderNav, renderFooter, renderModeBanner } from "./utils.js";
import { onAuthChange, getIdToken, isAdminCached } from "./auth.js";
import { isAccountMode } from "./mode.js";

const API = "/api/admin";

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
    });
  });

  document.getElementById("admin-refresh-btn").addEventListener("click", () => {
    const active = document.querySelector(".admin-tab.active")?.dataset.tab;
    if (active === "overview") loadOverview();
    if (active === "users") loadUsers();
    if (active === "pamphlets") loadPamphlets();
    if (active === "clinics") loadClinics();
  });

  document.getElementById("users-refresh")?.addEventListener("click", loadUsers);
}

// ─────────────────────────────────────────
// Overview
// ─────────────────────────────────────────
async function loadOverview() {
  try {
    const { stats } = await api("GET", "/stats");

    setText("stat-users", stats.totalUsers ?? "—");
    setText("stat-new-users", stats.newUsersThisWeek ?? "—");
    setText("stat-cycle-logs", stats.totalCycleLogs ?? "—");
    setText("stat-symptom-logs", stats.totalSymptomLogs ?? "—");

    // Pamphlet + clinic counts come from their own endpoints
    api("GET", "/pamphlets")
      .then((d) => setText("stat-pamphlets", d.pamphlets?.length ?? "—"))
      .catch(() => setText("stat-pamphlets", "—"));

    api("GET", "/clinics")
      .then((d) => setText("stat-clinics", d.clinics?.length ?? "—"))
      .catch(() => setText("stat-clinics", "—"));

    const distEl = document.getElementById("goal-distribution");
    const dist = stats.goalDistribution || {};
    const entries = Object.entries(dist);
    if (entries.length) {
      distEl.innerHTML = entries
        .sort((a, b) => b[1] - a[1])
        .map(([goal, count]) => `
          <div class="admin-item">
            <div class="admin-item-top">
              <strong>${goalName(goal)}</strong>
              <span class="admin-badge">${count}</span>
            </div>
          </div>
        `).join("");
    } else {
      distEl.innerHTML = `<p class="text-muted">No goal data yet.</p>`;
    }
  } catch (err) {
    showError("goal-distribution", err.message);
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
          Joined: ${u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"} &bull;
          Last sign-in: ${u.lastSignIn ? new Date(u.lastSignIn).toLocaleDateString() : "—"}
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
        <div class="admin-item-meta">${p.readTime ? p.readTime + " read" : ""} ${p.summary ? "— " + escHtml(p.summary.slice(0, 80)) + "…" : ""}</div>
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
  setModalError("pamphlet-modal-error", "");
  openModal(modal);
}

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
  document.getElementById("clinic-country").value = clinic?.country || "";
  document.getElementById("clinic-parish").value = clinic?.parish || "";
  document.getElementById("clinic-address").value = clinic?.address || "";
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

function goalName(id) {
  const map = {
    period: "Track my period",
    ttc: "Get pregnant",
    no_period: "No period / skip predictions",
    pregnancy: "Track pregnancy",
    perimenopause: "Perimenopause / menopause",
    symptoms: "Track symptoms only",
    unknown: "Unknown / not set",
  };
  return map[id] || id;
}
