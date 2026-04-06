import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "frontend",
  publicDir: false,
  server: {
    host: true,
    port: 5173,

    // Proxy requests to the backend (avoids CORS + JSON parse errors)
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/catalog": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },

    // Allow imports from outside /frontend
    fs: {
      allow: [
        resolve(__dirname, "frontend"),
        resolve(__dirname, "algorithms"),
      ],
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
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