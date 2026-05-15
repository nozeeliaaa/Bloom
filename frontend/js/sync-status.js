const SYNC_EVENT = "bloom:sync-status";

export function notifySyncIssue({
  source = "sync",
  message = "Bloom could not reach cloud sync. Showing saved local data for now.",
  detail = "",
} = {}) {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, {
    detail: {
      ok: false,
      source,
      message,
      detail,
      ts: Date.now(),
    },
  }));
}

export function clearSyncIssue(source = "sync") {
  window.dispatchEvent(new CustomEvent(SYNC_EVENT, {
    detail: { ok: true, source, ts: Date.now() },
  }));
}

export function mountSyncStatusBanner(container, {
  id = "sync-status-banner",
  message = "Cloud sync is having trouble. Bloom is showing saved local data until it reconnects.",
} = {}) {
  if (!container || document.getElementById(id)) return;

  const styleId = `${id}-style`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .sync-status-banner {
        display: none;
        margin: 0.75rem auto 1rem;
        max-width: 1080px;
        border: 1px solid #f4b8c8;
        background: #fff3f7;
        color: #653149;
        border-radius: 12px;
        padding: 0.75rem 0.9rem;
        font-size: 0.92rem;
        line-height: 1.45;
        font-weight: 700;
      }
      .sync-status-banner.is-visible { display: block; }
      .sync-status-banner span {
        display: block;
        color: #7c5365;
        font-size: 0.82rem;
        font-weight: 600;
        margin-top: 0.15rem;
      }
    `;
    document.head.appendChild(style);
  }

  const el = document.createElement("div");
  el.id = id;
  el.className = "sync-status-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `${message}<span>Changes you make are kept on this device and will try to sync again later.</span>`;
  container.appendChild(el);

  window.addEventListener(SYNC_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.ok) {
      el.classList.remove("is-visible");
      return;
    }
    el.firstChild.textContent = detail.message || message;
    el.classList.add("is-visible");
  });
}
