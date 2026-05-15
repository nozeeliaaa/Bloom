/**
 * normaliseMemoryForRead.test.js
 *
 * Unit tests for the date-gated flag-reset logic inside
 * normaliseMemoryForRead(), which runs at GET /api/bloomie-memory time.
 *
 * The function is module-private, so we drive it via supertest through the
 * real route. Firestore and Firebase Admin are fully mocked.
 *
 * Fixed reference date: 2025-06-15 (pinned via vi.setSystemTime).
 *
 * Run: cd backend && npx vitest run src/__tests__/normaliseMemoryForRead.test.js
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ─── Fixed reference date ─────────────────────────────────────────────────────
const TODAY     = "2025-06-15";
const YESTERDAY = "2025-06-14";
const TOMORROW  = "2025-06-16";

// ─── Hoist mock primitives ────────────────────────────────────────────────────
// Must be hoisted so vi.mock factories can reference them.
const mockVerifyIdToken = vi.hoisted(() => vi.fn());
const mockUserDocGet    = vi.hoisted(() => vi.fn());
const mockMemoryDocGet  = vi.hoisted(() => vi.fn());
const mockMemoryDocSet  = vi.hoisted(() => vi.fn());
const mockServerTs      = vi.hoisted(() => vi.fn(() => "SERVER_TS"));

// ─── firebaseAdmin mock ───────────────────────────────────────────────────────
vi.mock("../firebaseAdmin.js", () => {
  return {
    auth: { verifyIdToken: mockVerifyIdToken },
    db: {
      collection: (name) => ({
        doc: () => {
          if (name === "users") {
            return {
              get:    mockUserDocGet,
              set:    vi.fn().mockResolvedValue(undefined),
              update: vi.fn().mockResolvedValue(undefined),
            };
          }
          if (name === "bloomieMemory") {
            return {
              get:    mockMemoryDocGet,
              set:    mockMemoryDocSet,
              update: vi.fn().mockResolvedValue(undefined),
            };
          }
          return {
            get:    vi.fn().mockResolvedValue({ exists: false }),
            set:    vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined),
          };
        },
      }),
    },
    admin: {
      firestore: { FieldValue: { serverTimestamp: mockServerTs } },
    },
  };
});

// firebase-admin is imported directly by auth.js for FieldValue
vi.mock("firebase-admin", () => ({
  default: {
    firestore: { FieldValue: { serverTimestamp: mockServerTs } },
    apps: [{}],
    initializeApp: vi.fn(),
  },
  firestore: { FieldValue: { serverTimestamp: mockServerTs } },
  apps: [{}],
  initializeApp: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Seed Firestore to return `memoryData` for GET /api/bloomie-memory. */
function seedMemory(memoryData) {
  mockMemoryDocGet.mockResolvedValue({
    exists: true,
    data: () => ({ ...memoryData }),
  });
}

/** Returns a user doc that passes requireAuth without backfill. */
function makeUserDoc(uid = "user-1") {
  return {
    exists: true,
    data: () => ({
      uid,
      role: "user",
      email: "test@example.com",
      profile: {
        role:             "user",
        nickname:         null,
        avatar:           null,
        goal:             "period",
        mode:             "account",
        yearOfBirth:      1995,   // → "18+" ageBand, no consent gate
        avgCycleLength:   28,
        periodDuration:   5,
        weightKg:         null,
        heightCm:         null,
        consentSensitive: false,
        remindersEnabled: false,
        reminderTime:     "09:00",
      },
    }),
  };
}

async function getMemory(app) {
  const res = await request(app)
    .get("/api/bloomie-memory")
    .set("Authorization", "Bearer fake-token");
  return { status: res.status, body: res.body };
}

// ─── App bootstrap ────────────────────────────────────────────────────────────

let app;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));

  mockVerifyIdToken.mockResolvedValue({ uid: "user-1", email: "test@example.com" });
  mockUserDocGet.mockResolvedValue(makeUserDoc("user-1"));
  mockMemoryDocSet.mockResolvedValue(undefined);

  const { default: router } = await import("../routes/bloomieMemory.js");
  app = express();
  app.use(express.json());
  app.use("/api/bloomie-memory", router);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("normaliseMemoryForRead - date comparison", () => {
  it("same-day lastSessionDate: sticky flags are preserved as-is", async () => {
    seedMemory({
      lastSessionDate:     `${TODAY}T09:00:00.000Z`,
      urgentFlag:          true,
      closeIntentDetected: true,
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    // Same day → no reset
    expect(body.urgentFlag).toBe(true);
    expect(body.closeIntentDetected).toBe(true);
  });

  it("yesterday lastSessionDate: sticky flags are reset to false", async () => {
    seedMemory({
      lastSessionDate:     `${YESTERDAY}T22:00:00.000Z`,
      urgentFlag:          true,
      closeIntentDetected: true,
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    // Prior day → stale → both flags must be cleared
    expect(body.urgentFlag).toBe(false);
    expect(body.closeIntentDetected).toBe(false);
  });

  it("future lastSessionDate (clock skew): sticky flags are reset to false", async () => {
    // Regression: the old `>= todayUTC` guard treated future dates the same as
    // same-day, keeping urgentFlag/closeIntentDetected stuck on forever.
    seedMemory({
      lastSessionDate:     `${TOMORROW}T00:00:00.000Z`,
      urgentFlag:          true,
      closeIntentDetected: true,
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    // Future date is NOT same-day → must reset, not preserve
    expect(body.urgentFlag).toBe(false);
    expect(body.closeIntentDetected).toBe(false);
  });

  it("null lastSessionDate: flags reset (treated as unknown/stale)", async () => {
    seedMemory({
      lastSessionDate:     null,
      urgentFlag:          true,
      closeIntentDetected: true,
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    expect(body.urgentFlag).toBe(false);
    expect(body.closeIntentDetected).toBe(false);
  });

  it("absent lastSessionDate field: flags reset", async () => {
    seedMemory({
      urgentFlag:          true,
      closeIntentDetected: true,
      // lastSessionDate intentionally omitted
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    expect(body.urgentFlag).toBe(false);
    expect(body.closeIntentDetected).toBe(false);
  });

  it("stale date: non-transient fields are NOT reset", async () => {
    seedMemory({
      lastSessionDate:     `${YESTERDAY}T10:00:00.000Z`,
      urgentFlag:          true,
      closeIntentDetected: true,
      // Fields intentionally preserved across sessions
      redFlagNoticeShown:  true,
      lastResolutionStatus: "resolved",
      lastIntent:          "PERIOD",
      sessionCount:        7,
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    // Transient flags reset
    expect(body.urgentFlag).toBe(false);
    expect(body.closeIntentDetected).toBe(false);
    // Persistent fields survive
    expect(body.redFlagNoticeShown).toBe(true);
    expect(body.lastResolutionStatus).toBe("resolved");
    expect(body.lastIntent).toBe("PERIOD");
    expect(body.sessionCount).toBe(7);
  });

  it("same-day: non-transient fields are preserved", async () => {
    seedMemory({
      lastSessionDate:     `${TODAY}T08:30:00.000Z`,
      urgentFlag:          false,
      closeIntentDetected: false,
      redFlagNoticeShown:  true,
      lastIntent:          "MOOD",
      sessionCount:        3,
    });

    const { status, body } = await getMemory(app);

    expect(status).toBe(200);
    expect(body.redFlagNoticeShown).toBe(true);
    expect(body.lastIntent).toBe("MOOD");
    expect(body.sessionCount).toBe(3);
  });
});
