import { defineConfig } from "vite";
import { resolve } from "path";
import { readdirSync, copyFileSync, mkdirSync, existsSync } from "fs";

const LOCAL_API_TARGET = "http://127.0.0.1:4000";
const PAGES_DIR = resolve(__dirname, "frontend/pages");

const pageInputs = Object.fromEntries(
  readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => [
      entry.name.replace(/\.html$/i, ""),
      resolve(PAGES_DIR, entry.name),
    ])
);

function copyDataDir() {
  return {
    name: "copy-data-dir",
    closeBundle() {
      const src = resolve(__dirname, "frontend/data");
      const dest = resolve(__dirname, "dist/data");
      if (!existsSync(src)) return;
      mkdirSync(dest, { recursive: true });
      for (const file of readdirSync(src)) {
        copyFileSync(resolve(src, file), resolve(dest, file));
      }
    },
  };
}

export default defineConfig({
  root: "frontend",
  publicDir: false,
  base: "./",
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
  plugins: [copyDataDir()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
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
        // or -general here - those are statically imported and must be present
        // before the first user interaction.
        manualChunks(id) {
          if (id.includes("bloomie-nodes-education")) return "bloomie-educ";
          if (id.includes("bloomie-nodes-perimenopause")) return "bloomie-peri";
        },
      },
      input: {
        index: resolve(__dirname, "frontend/index.html"),
        notFound: resolve(__dirname, "frontend/404.html"),
        ...pageInputs,
      },
    },
  },
});