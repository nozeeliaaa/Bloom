import { mkdir, readdir, stat, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const srcDir = path.join(projectRoot, "frontend", "assets");
const destDir = path.join(projectRoot, "dist", "assets");

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".ico",
]);

async function copyAllowedAssets(srcRoot, destRoot) {
  await mkdir(destRoot, { recursive: true });
  const entries = await readdir(srcRoot, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcRoot, entry.name);
    const destPath = path.join(destRoot, entry.name);

    if (entry.isDirectory()) {
      await copyAllowedAssets(srcPath, destPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    await copyFile(srcPath, destPath);
  }
}

async function main() {
  const srcExists = await stat(srcDir).then(() => true).catch(() => false);
  if (!srcExists) {
    console.warn(`[copy-static-assets] source not found: ${srcDir}`);
    return;
  }

  await copyAllowedAssets(srcDir, destDir);
  console.log("[copy-static-assets] copied frontend/assets -> dist/assets");
}

main().catch((err) => {
  console.error("[copy-static-assets] failed:", err);
  process.exitCode = 1;
});

