import { defineConfig } from "vite";
import { resolve } from "path";

const LOCAL_API_TARGET = "http://127.0.0.1:4000";

export default defineConfig({
  root: "frontend",
  publicDir: false,
  server: {
    host: true,
    port: 5173,

    // Proxy requests to the backend (avoids CORS + JSON parse errors)
    proxy: {
      "/api": {
        target: LOCAL_API_TARGET,
        changeOrigin: true,
      },
      "/catalog": {
        target: LOCAL_API_TARGET,
        changeOrigin: true,
      },
      "/health": {
        target: LOCAL_API_TARGET,
        changeOrigin: true,
      },
    },

    // Allow imports from outside /frontend
    fs: {
      allow: [
        resolve(__dirname, "frontend"),
        resolve(__dirname, "algorithms"),
        resolve(__dirname, "backend/ml/inference"),
      ],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Named chunks for the two lazy-loaded Bloomie node banks.
        //
        // bloomie-nodes.js uses dynamic import() for these modules so the
        // browser only fetches them after the initial paint. These manualChunks
        // entries give the output files stable, cache-friendly names instead of
        // Vite's default content-hash filenames.
        //
        // Do NOT add bloomie-nodes-core, -period, -mood, -pelvic, -pregnancy,
        // or -general here — those are statically imported and must be present
        // before the first user interaction.
        manualChunks(id) {
          if (id.includes("bloomie-nodes-education"))    return "bloomie-educ";
          if (id.includes("bloomie-nodes-perimenopause")) return "bloomie-peri";
        },
      },
      input: {
        index: resolve(__dirname, "frontend/index.html"),
        dashboard: resolve(__dirname, "frontend/pages/dashboard.html"),
        calendar: resolve(__dirname, "frontend/pages/calendar.html"),
        log: resolve(__dirname, "frontend/pages/log.html"),
        login: resolve(__dirname, "frontend/pages/login.html"),
        register: resolve(__dirname, "frontend/pages/register.html"),
        settings: resolve(__dirname, "frontend/pages/settings.html"),
        survey: resolve(__dirname, "frontend/pages/survey.html"),
        clinics: resolve(__dirname, "frontend/pages/clinics.html"),
        pamphlets: resolve(__dirname, "frontend/pages/pamphlets.html"),
        assistant: resolve(__dirname, "frontend/pages/assistant.html"),
        profile: resolve(__dirname, "frontend/pages/profile.html"),
      },
    },
  },
});
