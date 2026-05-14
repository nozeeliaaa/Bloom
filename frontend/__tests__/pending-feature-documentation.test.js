import { describe, it } from "vitest";

describe("documented pending or manual frontend tests", () => {
  // Bloom does not currently expose a separate standalone game page. The myth/fact
  // experience is embedded in the dashboard/FAB, so a full page-level game test is pending.
  it.skip("FACTS / MYTHS GAME: standalone page renders and completes a full quiz flow", () => {});

  // There is no dedicated unknown-route client router; Vite/static hosting serves 404.html.
  it.skip("NAVIGATION / ROUTING: unknown client route renders an in-app broken-route state", () => {});

  // Mood is not present as a first-class field in the current calendar modal.
  it.skip("HEALTH LOGGING: mood field saves when a mood control is added to the log modal", () => {});

  // Support form is in Help; there is no separate user support inbox page yet.
  it.skip("SUPPORT REQUESTS: user sees submitted support ticket history in a dedicated support page", () => {});

  // The clinic finder currently shows clinic details inline in cards, not a separate detail page.
  it.skip("CLINIC FINDER: separate clinic detail route opens when that route exists", () => {});
});
