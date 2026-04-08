/**
 * backend/src/__tests__/bloomieContext.test.js
 *
 * Unit tests for buildSafeBloomieContext and its helpers.
 * Tests: shape contract, null-safety, sanitization, cycle math, auth enforcement.
 *
 * Run: cd backend && npx vitest run src/__tests__/bloomieContext.test.js
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ─── Hoist mock primitives ────────────────────────────────────────────────────

const mockUserDocGet       = vi.hoisted(() => vi.fn());
const mockNicknameDocGet   = vi.hoisted(() => vi.fn());
const mockCycleQueryGet    = vi.hoisted(() => vi.fn());
const mockSymptomQueryGet  = vi.hoisted(() => vi.fn());
const mockMemoryDocGet     = vi.hoisted(() => vi.fn());
const mockVerifyIdToken    = vi.hoisted(() => vi.fn());
const mockAuthUserDocGet   = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../firebaseAdmin.js", () => {
  // Ordered query chain used for sub-collections (cycle + symptom logs)
  function queryChain(mockGet) {
    const q = {
      where:   () => q,
      orderBy: () => q,
      limit:   () => q,
      get:     mockGet,
    };
    return q;
  }

  function makeSubCollection(mockGet) {
    return {
      where:   () => queryChain(mockGet),
      orderBy: () => queryChain(mockGet),
      limit:   () => queryChain(mockGet),
    };
  }

  return {
    auth: { verifyIdToken: mockVerifyIdToken },
    db: {
      collection: (name) => ({
        doc: (uid) => {
          if (name === "users") {
            return {
              get:        mockAuthUserDocGet,
              collection: (sub) => ({
                doc: () => ({ get: mockNicknameDocGet }),
              }),
            };
          }
          if (name === "bloomieMemory") return { get: mockMemoryDocGet };
          if (name === "cycleLogs")     return { collection: () => makeSubCollection(mockCycleQueryGet) };
          if (name === "symptomLogs")   return { collection: () => makeSubCollection(mockSymptomQueryGet) };
          return { get: vi.fn().mockResolvedValue({ exists: false }) };
        },
      }),
    },
    admin: {
      firestore: { FieldValue: { serverTimestamp: vi.fn(() => "SERVER_TS") } },
    },
    default: {
      firestore: { FieldValue: { serverTimestamp: vi.fn(() => "SERVER_TS") } },
      apps: [{}],
    },
  };
});

vi.mock("firebase-admin", () => ({
  default: {
    firestore: { FieldValue: { serverTimestamp: vi.fn(() => "SERVER_TS") } },
    apps: [{}],
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { buildSafeBloomieContext, buildEmptyContext } from "../utils/buildSafeBloomieContext.js";
import bloomieContextRoute from "../routes/bloomieContext.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UID = "uid-test-user-01";

/** Firestore doc that exists */
const doc = (data) => ({ exists: true, data: () => data });
/** Firestore doc that does not exist */
const missingDoc = () => ({ exists: false, data: () => null });
/** Firestore query snapshot */
const snap = (rows) => ({ empty: rows.length === 0, docs: rows.map(r => ({ data: () => r })) });

function seedAllMissing() {
  mockAuthUserDocGet.mockResolvedValue(missingDoc());
  mockNicknameDocGet.mockResolvedValue(missingDoc());
  mockCycleQueryGet.mockResolvedValue(snap([]));
  mockSymptomQueryGet.mockResolvedValue(snap([]));
  mockMemoryDocGet.mockResolvedValue(missingDoc());
}

beforeEach(() => {
  vi.resetAllMocks();
  seedAllMissing();
});

// ═════════════════════════════════════════════════════════════════════════════
// Return-shape contract
// ═════════════════════════════════════════════════════════════════════════════

describe("return shape contract", () => {
  it("always returns all top-level keys even when all sources are missing", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx).toHaveProperty("nickname");
    expect(ctx).toHaveProperty("accountMode");
    expect(ctx).toHaveProperty("cycle");
    expect(ctx).toHaveProperty("symptoms");
    expect(ctx).toHaveProperty("recentActivity");
  });

  it("cycle sub-object always has all five keys", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.cycle).toHaveProperty("lastPeriodDate");
    expect(ctx.cycle).toHaveProperty("avgCycleLength");
    expect(ctx.cycle).toHaveProperty("predictedNextPeriod");
    expect(ctx.cycle).toHaveProperty("predictedOvulation");
    expect(ctx.cycle).toHaveProperty("phase");
  });

  it("recentActivity always has lastSessionDate and lastIntent", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.recentActivity).toHaveProperty("lastSessionDate");
    expect(ctx.recentActivity).toHaveProperty("lastIntent");
  });

  it("symptoms is always an array", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(Array.isArray(ctx.symptoms)).toBe(true);
  });

  it("buildEmptyContext returns identical shape with all nulls/empty", () => {
    const empty = buildEmptyContext();
    expect(empty.nickname).toBeNull();
    expect(empty.accountMode).toBeNull();
    expect(empty.cycle.lastPeriodDate).toBeNull();
    expect(empty.cycle.avgCycleLength).toBeNull();
    expect(empty.cycle.predictedNextPeriod).toBeNull();
    expect(empty.cycle.predictedOvulation).toBeNull();
    expect(empty.cycle.phase).toBeNull();
    expect(empty.symptoms).toEqual([]);
    expect(empty.recentActivity.lastSessionDate).toBeNull();
    expect(empty.recentActivity.lastIntent).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Null safety — invalid / missing userId
// ═════════════════════════════════════════════════════════════════════════════

describe("null safety — invalid userId", () => {
  it("returns empty context for empty string uid", async () => {
    const ctx = await buildSafeBloomieContext("");
    expect(ctx).toEqual(buildEmptyContext());
  });

  it("returns empty context for undefined uid", async () => {
    const ctx = await buildSafeBloomieContext(undefined);
    expect(ctx).toEqual(buildEmptyContext());
  });

  it("returns empty context for null uid", async () => {
    const ctx = await buildSafeBloomieContext(null);
    expect(ctx).toEqual(buildEmptyContext());
  });

  it("returns empty context for numeric uid", async () => {
    const ctx = await buildSafeBloomieContext(12345);
    expect(ctx).toEqual(buildEmptyContext());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Profile — nickname + accountMode
// ═════════════════════════════════════════════════════════════════════════════

describe("user profile", () => {
  it("returns nickname and accountMode from Firestore", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: { mode: "account" } }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "Bloom" }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBe("Bloom");
    expect(ctx.accountMode).toBe("account");
  });

  it("truncates nickname to 30 characters", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: { mode: "account" } }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "A".repeat(50) }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toHaveLength(30);
  });

  it("returns null when user doc does not exist", async () => {
    // mocks already seeded to missing
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBeNull();
    expect(ctx.accountMode).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Sanitization — no HTML, no scripts
// ═════════════════════════════════════════════════════════════════════════════

describe("input sanitization", () => {
  it("strips script tags from nickname", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: {} }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "<script>alert(1)</script>Alice" }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBe("Alice");
    expect(ctx.nickname).not.toContain("<script>");
  });

  it("strips HTML tags from lastIntent", async () => {
    mockMemoryDocGet.mockResolvedValue(doc({
      lastSessionDate: "2025-01-01T00:00:00.000Z",
      lastIntent:      "<b>mood</b>",
    }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.recentActivity.lastIntent).toBe("mood");
    expect(ctx.recentActivity.lastIntent).not.toContain("<b>");
  });

  it("returns null nickname when only script content remains after stripping", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: {} }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "<script>document.cookie</script>" }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBeNull();
  });

  it("sanitizes control characters from strings", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: {} }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "Alice\x00\x07" }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBe("Alice");
  });

  it("symptom codes are uppercased and length-capped", async () => {
    mockSymptomQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-06-01", items: [{ code: "mood", severity: 2 }] },
      { dateKey: "2025-06-02", items: [{ code: "A".repeat(100), severity: 1 }] },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    // "mood" should be uppercased to "MOOD"
    expect(ctx.symptoms).toContain("MOOD");
    // Overlong code should be excluded (> 60 chars)
    expect(ctx.symptoms.every(s => s.length <= 60)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cycle data — LMP, average cycle length, predictions, phase
// ═════════════════════════════════════════════════════════════════════════════

describe("cycle data", () => {
  it("returns null cycle fields when no logs exist", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.cycle.lastPeriodDate).toBeNull();
    expect(ctx.cycle.avgCycleLength).toBeNull();
    expect(ctx.cycle.predictedNextPeriod).toBeNull();
    expect(ctx.cycle.predictedOvulation).toBeNull();
    expect(ctx.cycle.phase).toBeNull();
  });

  it("returns LMP from most recent periodDay === 1 entry", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-01", periodDay: 1, flowLevel: 2 },
      { dateKey: "2025-05-02", periodDay: 2, flowLevel: 3 },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.cycle.lastPeriodDate).toBe("2025-05-01");
  });

  it("computes avgCycleLength from two period starts", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-03", periodDay: 1 },
      { dateKey: "2025-04-05", periodDay: 1 },
    ]));
    // Gap = 28 days
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.cycle.avgCycleLength).toBe(28);
  });

  it("returns null avgCycleLength when only one period start exists", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-01", periodDay: 1 },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.cycle.lastPeriodDate).toBe("2025-05-01");
    expect(ctx.cycle.avgCycleLength).toBeNull();
  });

  it("predictedNextPeriod is avgCycleLength days after LMP", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-03", periodDay: 1 },
      { dateKey: "2025-04-05", periodDay: 1 },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    // LMP = 2025-05-03, avgCycleLength = 28 → next = 2025-05-31
    expect(ctx.cycle.predictedNextPeriod).toBe("2025-05-31");
  });

  it("predictedOvulation is ~14 days before predictedNextPeriod", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-03", periodDay: 1 },
      { dateKey: "2025-04-05", periodDay: 1 },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    // predictedNextPeriod = 2025-05-31, ovulation = 14d before = 2025-05-17
    expect(ctx.cycle.predictedOvulation).toBe("2025-05-17");
  });

  it("ignores implausible cycle gaps (< 18 or > 45 days)", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-01", periodDay: 1 },
      { dateKey: "2025-04-30", periodDay: 1 }, // 1-day gap — implausible
      { dateKey: "2025-04-01", periodDay: 1 }, // 29-day gap from 2025-04-30 — wait, test the real logic
    ]));

    // Gap from 2025-04-30 to 2025-05-01 is 1 day (< 18 → ignored)
    // Gap from 2025-04-01 to 2025-04-30 is 29 days (valid)
    const ctx = await buildSafeBloomieContext(UID);
    // Only the valid gap is used
    expect(ctx.cycle.avgCycleLength).toBe(29);
  });

  it("all cycle fields are YYYY-MM-DD strings when populated", async () => {
    mockCycleQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-05-03", periodDay: 1 },
      { dateKey: "2025-04-05", periodDay: 1 },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    expect(dateRe.test(ctx.cycle.lastPeriodDate)).toBe(true);
    expect(dateRe.test(ctx.cycle.predictedNextPeriod)).toBe(true);
    expect(dateRe.test(ctx.cycle.predictedOvulation)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Symptoms
// ═════════════════════════════════════════════════════════════════════════════

describe("recent symptoms", () => {
  it("returns deduplicated codes from the last 7 days", async () => {
    mockSymptomQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-06-01", items: [{ code: "MOOD", severity: 2 }, { code: "MOOD", severity: 2 }] },
      { dateKey: "2025-06-02", items: [{ code: "PAIN", severity: 1 }] },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    // "MOOD" should appear once despite being logged twice
    expect(ctx.symptoms.filter(s => s === "MOOD")).toHaveLength(1);
    expect(ctx.symptoms).toContain("PAIN");
  });

  it("caps symptoms at 15 codes", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ code: `SYM_${i}`, severity: 1 }));
    mockSymptomQueryGet.mockResolvedValue(snap([
      { dateKey: "2025-06-01", items },
    ]));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.symptoms.length).toBeLessThanOrEqual(15);
  });

  it("returns empty array when no symptom logs exist", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.symptoms).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Bloomie memory — recentActivity only, NOT cycle/profile data
// ═════════════════════════════════════════════════════════════════════════════

describe("bloomie memory", () => {
  it("surfaces lastSessionDate and lastIntent from memory doc", async () => {
    mockMemoryDocGet.mockResolvedValue(doc({
      lastSessionDate: "2025-06-01T10:00:00.000Z",
      lastIntent:      "mood",
    }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.recentActivity.lastSessionDate).toBe("2025-06-01T10:00:00.000Z");
    expect(ctx.recentActivity.lastIntent).toBe("mood");
  });

  it("does NOT include lastSymptoms or recentTopics in recentActivity", async () => {
    mockMemoryDocGet.mockResolvedValue(doc({
      lastSessionDate: "2025-06-01T10:00:00.000Z",
      lastIntent:      "mood",
      lastSymptoms:    ["mood", "pain"],
      recentTopics:    ["heavy_bleeding"],
    }));

    const ctx = await buildSafeBloomieContext(UID);
    // recentActivity shape should only have these two keys
    expect(Object.keys(ctx.recentActivity)).toEqual(["lastSessionDate", "lastIntent"]);
  });

  it("returns null recentActivity fields when memory doc missing", async () => {
    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.recentActivity.lastSessionDate).toBeNull();
    expect(ctx.recentActivity.lastIntent).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Graceful degradation — one source fails, others still populate
// ═════════════════════════════════════════════════════════════════════════════

describe("graceful degradation", () => {
  it("cycle failure does not break profile or memory", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: { mode: "account" } }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "Bloom" }));
    mockCycleQueryGet.mockRejectedValue(new Error("Firestore unavailable"));
    mockMemoryDocGet.mockResolvedValue(doc({ lastSessionDate: "2025-06-01T00:00:00.000Z", lastIntent: "late" }));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBe("Bloom");
    expect(ctx.accountMode).toBe("account");
    expect(ctx.cycle.lastPeriodDate).toBeNull(); // degraded
    expect(ctx.recentActivity.lastIntent).toBe("late");
  });

  it("memory failure does not break profile or cycle", async () => {
    mockAuthUserDocGet.mockResolvedValue(doc({ profile: { mode: "guest" } }));
    mockNicknameDocGet.mockResolvedValue(doc({ nickname: "Tia" }));
    mockCycleQueryGet.mockResolvedValue(snap([{ dateKey: "2025-05-01", periodDay: 1 }]));
    mockMemoryDocGet.mockRejectedValue(new Error("timeout"));

    const ctx = await buildSafeBloomieContext(UID);
    expect(ctx.nickname).toBe("Tia");
    expect(ctx.recentActivity.lastSessionDate).toBeNull(); // degraded
    expect(ctx.recentActivity.lastIntent).toBeNull();      // degraded
  });

  it("all sources failing returns full empty context without throwing", async () => {
    mockAuthUserDocGet.mockRejectedValue(new Error("network error"));
    mockNicknameDocGet.mockRejectedValue(new Error("network error"));
    mockCycleQueryGet.mockRejectedValue(new Error("network error"));
    mockSymptomQueryGet.mockRejectedValue(new Error("network error"));
    mockMemoryDocGet.mockRejectedValue(new Error("network error"));

    await expect(buildSafeBloomieContext(UID)).resolves.toEqual(buildEmptyContext());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Route — GET /api/bloomie-context authentication
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/bloomie-context route", () => {
  // Minimal test app with the bloomieContext route only
  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/bloomie-context", bloomieContextRoute);
    return app;
  }

  it("returns 401 without Authorization header", async () => {
    const res = await request(makeApp()).get("/api/bloomie-context");
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error("auth/id-token-expired"));

    const res = await request(makeApp())
      .get("/api/bloomie-context")
      .set("Authorization", "Bearer bad.token.here");

    expect(res.status).toBe(401);
  });

  it("returns context shape for authenticated user", async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: UID, email: "test@bloom.test", email_verified: true });
    // Auth middleware does a user-doc read
    mockAuthUserDocGet.mockResolvedValue(doc({ role: "user", profile: { mode: "account" } }));
    mockNicknameDocGet.mockResolvedValue(missingDoc());
    mockCycleQueryGet.mockResolvedValue(snap([]));
    mockSymptomQueryGet.mockResolvedValue(snap([]));
    mockMemoryDocGet.mockResolvedValue(missingDoc());

    const res = await request(makeApp())
      .get("/api/bloomie-context")
      .set("Authorization", "Bearer valid.token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("nickname");
    expect(res.body).toHaveProperty("cycle");
    expect(res.body).toHaveProperty("symptoms");
    expect(res.body).toHaveProperty("recentActivity");
  });
});
