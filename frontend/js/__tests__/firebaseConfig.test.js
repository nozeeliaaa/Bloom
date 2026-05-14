import { describe, it, expect, vi } from "vitest";

describe("firebaseConfig", () => {
  it("can be imported without a browser window", async () => {
    const previousWindow = globalThis.window;
    try {
      delete globalThis.window;
      vi.resetModules();
      const mod = await import("../firebaseConfig.js");
      expect(mod.firebaseConfig).toBeTruthy();
      expect(globalThis.window).toBeUndefined();
    } finally {
      if (previousWindow !== undefined) {
        globalThis.window = previousWindow;
      }
    }
  });
});
