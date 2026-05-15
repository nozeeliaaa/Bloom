import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/__tests__/**/*.test.js",
      "ml/inference/__tests__/**/*.test.js",
    ],
    // ESM-native - no transform needed for plain .js files
  },
});
