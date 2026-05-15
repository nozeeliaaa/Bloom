import { vi } from "vitest";

export const getMessaging = vi.fn(() => ({ type: "mock-messaging" }));
export const isSupported = vi.fn(async () => true);
export const getToken = vi.fn(async () => "mock-fcm-token");
export const onMessage = vi.fn(() => vi.fn());
