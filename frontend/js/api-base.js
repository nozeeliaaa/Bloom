import "./firebaseConfig.js";

const DEFAULT_API_BASE = "https://bloom-backend-538005116995.us-central1.run.app";
const LOCAL_API_BASE = "http://127.0.0.1:4000";

function cleanBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getApiBase() {
  const override = cleanBase(localStorage.getItem("bloom_api_base"));
  if (override) return override;

  const viteConfigured = cleanBase(import.meta.env?.VITE_BLOOM_API_BASE);
  if (viteConfigured) return viteConfigured;

  const host = window.location.hostname || "";
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return LOCAL_API_BASE;
  }

  const configured = cleanBase(window.BLOOM_API_BASE);
  if (configured) return configured;

  return DEFAULT_API_BASE;
}
