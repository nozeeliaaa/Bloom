import { describe, expect, it, vi } from "vitest";

const OLD_BROKEN_URL = "https://bloom-backend-538005116995-538005116995.us-east1.run.app";
const PROD_URL = "https://bloom-backend-538005116995.us-central1.run.app";
const LOCAL_URL = "http://127.0.0.1:4000";

async function getApiBaseFor(url, setup = () => {}) {
  vi.resetModules();
  const parsed = new URL(url);
  const originalLocation = window.location;
  Object.defineProperty(window, "location", {
    value: { ...originalLocation, hostname: parsed.hostname },
    configurable: true,
  });
  setup();
  const { getApiBase } = await import("../js/api-base.js");
  const result = getApiBase();
  Object.defineProperty(window, "location", {
    value: originalLocation,
    configurable: true,
  });
  return result;
}

describe("API BASE / CONFIG", () => {
  it("production uses the correct Cloud Run URL", async () => {
    const base = await getApiBaseFor("https://bloom.example/pages/dashboard.html");
    expect(base).toBe(PROD_URL);
  });

  it("localhost uses the local API", async () => {
    const base = await getApiBaseFor("http://localhost:5173/pages/dashboard.html");
    expect(base).toBe(LOCAL_URL);
  });

  it("localStorage bloom_api_base override works, trims, and removes trailing slashes", async () => {
    const base = await getApiBaseFor("https://bloom.example/pages/dashboard.html", () => {
      localStorage.setItem("bloom_api_base", "  https://api.example.test/// ");
    });
    expect(base).toBe("https://api.example.test");
  });

  it("VITE_BLOOM_API_BASE override works", async () => {
    vi.stubEnv("VITE_BLOOM_API_BASE", "https://vite.example.test/");
    const base = await getApiBaseFor("https://bloom.example/pages/dashboard.html");
    expect(base).toBe("https://vite.example.test");
    vi.unstubAllEnvs();
  });

  it("window.BLOOM_API_BASE is set by firebaseConfig and old broken URL is not used", async () => {
    vi.resetModules();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, hostname: "bloom.example" },
      configurable: true,
    });
    await import("../js/firebaseConfig.js");
    expect(window.BLOOM_API_BASE).toBe(PROD_URL);
    expect(window.BLOOM_API_BASE).not.toBe(OLD_BROKEN_URL);
    expect(JSON.stringify(await import("../js/api-base.js"))).not.toContain(OLD_BROKEN_URL);
    Object.defineProperty(window, "location", {
      value: originalLocation,
      configurable: true,
    });
  });
});
