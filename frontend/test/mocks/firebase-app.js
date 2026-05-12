import { vi } from "vitest";

export const initializeApp = vi.fn((config) => ({ config, name: "[DEFAULT]" }));
export const getApps = vi.fn(() => []);
