/**
 * admin-safety.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Safety log review page for Bloom admins.
 *
 * Queries the `bloomieSafetyLogs` Firestore collection for documents where
 * reviewed === false, ordered by ts descending, limited to 50.
 *
 * Access control: redirects anyone who is not authenticated + admin to the
 * dashboard - same gate pattern as admin.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { renderNav, renderFooter, renderModeBanner } from "./utils.js";
import { onAuthChange, isAdminCached, getIdToken } from "./auth.js";
import { isAccountMode } from "./mode.js";

const API = window.BLOOM_API_BASE + "/api/admin";

async function api(method, path) {
  const token = await getIdToken();
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Feedback state ───────────────────────────────────────────────────────────
let allFeedbackDocs = [];

renderNav("admin");
renderFooter();
renderModeBanner(document.getElementById("banner-area"));

// ─── Auth gate ────────────────────────────────────────────────────────────────
// Mirrors the exact pattern in admin.js: wait 300 ms for role cache to settle,
// then redirect anyone who isn't a confirmed admin.
onAuthChange(async (user) => {
  if (!isAccountMode() || !user) {
    window.location.href = "/pages/dashboard.html";
    return;
  }

  await new Promise((r) => setTimeout(r, 300));
  if (!isAdminCached()) {
    window.location.href = "/pages/dashboard.html";
    return;
  }

  const subtitleEl = document.getElementById("admin-subtitle");
  if (subtitleEl) subtitleEl.textContent = `Signed in as ${user.email}`;

  await Promise.all([loadLogs(), loadFeedback()]);

  document.getElementById("refresh-btn")?.addEventListener("click", () => {
    loadLogs();
    loadFeedback();
  });
});

// ─── State ────────────────────────────────────────────────────────────────────
/** All fetched (unreviewed) documents for the current load. */
let allDocs = [];

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadLogs() {
  const errorEl   = document.getElementById("safety-error");
  const loadingEl = document.getElementById("safety-loading");
  const tableEl   = document.getElementById("safety-table");
  const emptyEl   = document.getElementById("safety-empty");

  errorEl.style.display   = "none";
  loadingEl.style.display = "block";
  tableEl.style.display   = "none";
  emptyEl.style.display   = "none";

  try {
    const { logs } = await api("GET", "/safety-logs");
    allDocs = logs;
  } catch (err) {
    loadingEl.style.display = "none";
    showError(`Failed to load safety logs: ${err.message}`);
    return;
  }

  loadingEl.style.display = "none";
  renderTable(allDocs);
}


// ─── Rendering ────────────────────────────────────────────────────────────────
function renderTable(docs) {
  const tableEl  = document.getElementById("safety-table");
  const emptyEl  = document.getElementById("safety-empty");
  const tbody    = document.getElementById("safety-tbody");
  const countEl  = document.getElementById("count-label");

  if (!docs.length) {
    tableEl.style.display = "none";
    emptyEl.style.display = "block";
    countEl.textContent   = "0 results";
    return;
  }

  countEl.textContent   = `${docs.length} result${docs.length !== 1 ? "s" : ""}`;
  emptyEl.style.display = "none";
  tableEl.style.display = "table";

  tbody.innerHTML = docs.map((d) => {
    const ts        = formatTs(d.ts);
    const typeBadge = typeBadgeClass(d.type);
    const riskBadge = riskBadgeClass(d.riskLevel);

    // Route column: prefer explicit route, then fromNode; for oos_fallback fall
    // back to the OOS category so the column is never just "-".
    const routeText = d.route || d.fromNode
      || (d.type === "oos_fallback" ? d.category || "oos" : "-");

    // Topic column: use stored topic; for oos_fallback derive a hint from category.
    const topicText = d.topic
      || (d.type === "oos_fallback" && d.category ? `[${d.category}]` : "-");

    return `
      <tr data-id="${esc(d.id)}">
        <td class="col-ts">${esc(ts)}</td>
        <td>
          <span class="admin-badge ${esc(typeBadge)}">${esc(friendlyType(d.type))}</span>
        </td>
        <td class="col-input" title="${esc(d.input || "")}">${esc(truncate(d.input, 90))}</td>
        <td class="col-route"><code>${esc(routeText)}</code></td>
        <td>${esc(topicText)}</td>
        <td>
          ${d.riskLevel
            ? `<span class="admin-badge ${esc(riskBadge)}">${esc(d.riskLevel)}</span>`
            : `<span class="text-muted">-</span>`}
        </td>
        <td style="white-space:nowrap;">
          <button
            class="btn btn-sm mark-btn"
            data-id="${esc(d.id)}"
            type="button"
          >Mark reviewed</button>
        </td>
      </tr>`;
  }).join("");

  // Attach mark-reviewed handlers after innerHTML is set
  tbody.querySelectorAll(".mark-btn").forEach((btn) => {
    btn.addEventListener("click", () => markReviewed(btn));
  });
}

async function markReviewed(btn) {
  const id = btn.dataset.id;
  const row = btn.closest("tr");

  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    await api("PATCH", `/safety-logs/${id}/reviewed`);
    if (row) row.classList.add("row-reviewed");
    allDocs = allDocs.filter((d) => d.id !== id);
    setTimeout(() => renderTable(allDocs), 400);
  } catch (err) {
    btn.disabled    = false;
    btn.textContent = "Mark reviewed";
    showError(`Failed to update document ${id}: ${err.message}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById("safety-error");
  if (!el) return;
  el.textContent   = msg;
  el.style.display = "block";
}

/** Safely escape a value for HTML output. */
function esc(val) {
  return String(val ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function truncate(str, max) {
  if (!str) return "-";
  return str.length > max ? str.slice(0, max) + "…" : str;
}

/** Format a Firestore Timestamp or ISO string for display. */
function formatTs(ts) {
  if (!ts) return "-";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function typeBadgeClass(type) {
  if (type === "urgent_trigger") return "admin-badge--danger";
  if (type === "escalation")     return "admin-badge--warning";
  return "admin-badge--neutral";
}

function friendlyType(type) {
  if (type === "urgent_trigger") return "Urgent Trigger";
  if (type === "escalation")     return "Escalation";
  if (type === "oos_fallback")   return "OOS Fallback";
  return type || "-";
}

function riskBadgeClass(level) {
  if (level === "high")     return "admin-badge--danger";
  if (level === "moderate") return "admin-badge--warning";
  return "admin-badge--neutral";
}

// ─── Feedback Review ──────────────────────────────────────────────────────────

async function loadFeedback() {
  const errorEl   = document.getElementById("feedback-error");
  const loadingEl = document.getElementById("feedback-loading");
  const tableEl   = document.getElementById("feedback-table");
  const emptyEl   = document.getElementById("feedback-empty");

  if (!errorEl) return; // section not present in DOM

  errorEl.style.display   = "none";
  loadingEl.style.display = "block";
  tableEl.style.display   = "none";
  emptyEl.style.display   = "none";

  try {
    const { feedback } = await api("GET", "/feedback-review");
    allFeedbackDocs = feedback;
  } catch (err) {
    loadingEl.style.display = "none";
    errorEl.textContent   = `Failed to load feedback: ${err.message}`;
    errorEl.style.display = "block";
    return;
  }

  loadingEl.style.display = "none";
  renderFeedbackTable(allFeedbackDocs);
}

function renderFeedbackTable(docs) {
  const tableEl  = document.getElementById("feedback-table");
  const emptyEl  = document.getElementById("feedback-empty");
  const tbody    = document.getElementById("feedback-tbody");
  const countEl  = document.getElementById("feedback-count-label");

  if (!tableEl) return;

  if (!docs.length) {
    tableEl.style.display = "none";
    emptyEl.style.display = "block";
    if (countEl) countEl.textContent = "0 results";
    return;
  }

  if (countEl) countEl.textContent = `${docs.length} result${docs.length !== 1 ? "s" : ""}`;
  emptyEl.style.display = "none";
  tableEl.style.display = "table";

  tbody.innerHTML = docs.map((d) => {
    const ts      = formatTs(d.createdAt);
    const nodeId  = esc(d.nodeId  || "-");
    const flow    = esc(d.flowName || "-");
    const msgText = esc(truncate(d.messageText, 120));
    const comment = esc(d.comment || "-");
    const isThumbsUp = d.feedbackType === "thumbs_up";
    const ratingBadge = d.feedbackType
      ? `<span class="admin-badge ${isThumbsUp ? "admin-badge--primary" : "admin-badge--danger"}">${isThumbsUp ? "👍 Up" : "👎 Down"}</span>`
      : "-";

    // Render conversation slice as compact turn list
    const slice = Array.isArray(d.conversationSlice)
      ? d.conversationSlice
          .map((m) => `<span class="feedback-turn feedback-turn--${esc(m.from)}">${esc(m.from)}: ${esc(truncate(m.text, 80))}</span>`)
          .join("")
      : "-";

    return `
      <tr>
        <td class="col-ts">${esc(ts)}</td>
        <td>${ratingBadge}</td>
        <td><code>${nodeId}</code></td>
        <td>${flow}</td>
        <td class="col-input" title="${esc(d.messageText || "")}">${msgText}</td>
        <td>${comment}</td>
        <td class="col-slice">${slice}</td>
      </tr>`;
  }).join("");
}
