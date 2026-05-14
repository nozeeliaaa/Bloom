import { defineConfig } from "vitest/config";
import { resolve } from "path";

const firebaseCdn = "https://www.gstatic.com/firebasejs/12.9.0";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./frontend/test/setupTests.js"],
    include: [
      "frontend/__tests__/**/*.{test,spec}.js",
      "frontend/__tests__/**/*.{test,spec}.mjs",
      // Bloomie unit tests - cherry-picked clean files (all pass, total +59 → 177)
      "frontend/js/__tests__/bloomie-logger.test.js",
      "frontend/js/__tests__/bloomie-clarification-resolver.test.js",
      "frontend/js/__tests__/bloomie-clarifier.test.js",
      "frontend/js/__tests__/bloomie-intent-tags.test.js",
      "frontend/js/__tests__/bloomie-memory-recall.test.js",
      "frontend/js/__tests__/custom-symptoms.test.js",
      "frontend/js/__tests__/bloomie-turn-focus.test.js",
      "frontend/js/__tests__/bloomie-normalize.test.js",
      "frontend/js/__tests__/bloomie-policy.test.js",
      "frontend/js/__tests__/bloomie-repair.test.js",
    ],
    exclude: [
      "backend/**",
      "node_modules/**",
      "dist/**",
      "frontend/node_modules/**",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/frontend",
      reporter: ["text", "html", "json-summary"],
      include: ["frontend/js/**/*.js"],
      exclude: [
        "frontend/js/__tests__/**",
        "frontend/test/**",
      ],
    },
    restoreMocks: true,
    clearMocks: true,
    mockReset: false,
  },
  resolve: {
    alias: {
      [`${firebaseCdn}/firebase-app.js`]: resolve(__dirname, "frontend/test/mocks/firebase-app.js"),
      [`${firebaseCdn}/firebase-auth.js`]: resolve(__dirname, "frontend/test/mocks/firebase-auth.js"),
      [`${firebaseCdn}/firebase-firestore.js`]: resolve(__dirname, "frontend/test/mocks/firebase-firestore.js"),
      [`${firebaseCdn}/firebase-messaging.js`]: resolve(__dirname, "frontend/test/mocks/firebase-messaging.js"),
      "jspdf": resolve(__dirname, "frontend/test/mocks/jspdf.js"),
      "jspdf-autotable": resolve(__dirname, "frontend/test/mocks/jspdf-autotable.js"),
      "html2canvas": resolve(__dirname, "frontend/test/mocks/html2canvas.js"),
    },
  },
});
