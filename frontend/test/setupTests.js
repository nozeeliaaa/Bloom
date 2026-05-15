import { afterEach, beforeEach, vi } from "vitest";

const realConsoleError = console.error;

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();

  window.BLOOM_API_BASE = "";
  window.scrollTo = vi.fn();
  window.open = vi.fn();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
    text: async () => "",
  }));

  class MockNotification {
    static permission = "default";
    static requestPermission = vi.fn(async () => "granted");
    constructor(title, options = {}) {
      MockNotification.instances.push({ title, options });
    }
  }
  MockNotification.instances = [];
  globalThis.Notification = MockNotification;
  Object.defineProperty(window, "Notification", {
    value: MockNotification,
    configurable: true,
  });

  Object.defineProperty(navigator, "serviceWorker", {
    value: { register: vi.fn(async () => ({ scope: "/" })) },
    configurable: true,
  });

  Object.defineProperty(navigator, "geolocation", {
    value: {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    },
    configurable: true,
  });

  window.L = {
    map: vi.fn(() => ({
      setView: vi.fn().mockReturnThis(),
      fitBounds: vi.fn(),
      on: vi.fn(),
      removeLayer: vi.fn(),
    })),
    tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
    layerGroup: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      clearLayers: vi.fn(),
    })),
    marker: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      bindPopup: vi.fn().mockReturnThis(),
      setLatLng: vi.fn(),
    })),
    circle: vi.fn(() => ({ addTo: vi.fn().mockReturnThis() })),
    polyline: vi.fn(() => ({
      addTo: vi.fn().mockReturnThis(),
      getBounds: vi.fn(() => [[0, 0], [1, 1]]),
    })),
    divIcon: vi.fn((options) => options),
  };

  console.error = vi.fn((...args) => {
    const msg = String(args[0] || "");
    if (msg.includes("Not implemented: navigation")) return;
    realConsoleError(...args);
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.clearAllTimers();
  vi.restoreAllMocks();
  console.error = realConsoleError;
});
