import { readFileSync } from "fs";
import { resolve } from "path";
import { JSDOM } from "jsdom";
import { expect } from "vitest";

export const rootDir = resolve(process.cwd());
export const frontendDir = resolve(rootDir, "frontend");

export function readFrontendFile(relativePath) {
  return readFileSync(resolve(frontendDir, relativePath), "utf8");
}

export function loadHtml(relativePath, { url = `http://localhost/pages/${relativePath.split("/").pop()}` } = {}) {
  const html = readFrontendFile(relativePath);
  const dom = new JSDOM(html, { url });
  document.documentElement.innerHTML = dom.window.document.documentElement.innerHTML;
  document.querySelectorAll("script").forEach((script) => script.remove());
  return document;
}

export function text() {
  return document.body.textContent.replace(/\s+/g, " ").trim();
}

export function expectNoBadPlaceholders(container = document.body) {
  expect(container.textContent).not.toMatch(/\b(undefined|null|NaN)\b/);
}

export function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

export function setInputValue(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing input ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return el;
}

export function click(selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Missing clickable ${selector}`);
  el.click();
  return el;
}
