import { vi } from "vitest";

export const getFirestore = vi.fn(() => ({ type: "mock-firestore" }));
