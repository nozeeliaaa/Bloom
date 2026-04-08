/**
 * backend/src/__tests__/security.test.js
 *
 * Security integration tests for the Bloom backend.
 *
 * Covers:
 *   1. Unauthenticated requests → 401
 *   2. Invalid / expired tokens → 401
 *   3. Cross-user data isolation (route always uses req.user.uid)
 *   4. Input sanitization (validator unit tests + nickname HTML stripping)
 *   5. Rate limiting → 429
 *
 * Stack : Vitest + supertest
 * Run   : cd backend && npx vitest run src/__tests__/security.test.js
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";

// ─────────────────────────────────────────────────────────────────────────────
// Hoist mock primitives
// vi.hoisted() runs before vi.mock() factories, so these refs are available
// inside the factory closures below.
// ─────────────────────────────────────────────────────────────────────────────

const mockVerifyIdToken = vi.hoisted(() => vi.fn());
const mockDbDocGet      = vi.hoisted(() => vi.fn());
const mockDbDocSet      = vi.hoisted(() => vi.fn());
const mockDbDocDelete   = vi.hoisted(() => vi.fn());
const mockSubDocGet     = vi.hoisted(() => vi.fn());
const mockQueryGet      = vi.hoisted(() => vi.fn());

// Spy that records every uid passed to db.collection().doc(uid) — used to
// verify cross-user isolation (no other user's uid should ever be queried).
const mockTopLevelDocSpy = vi.hoisted(() => vi.fn());

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — declared before any import; Vitest hoists these automatically
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../firebaseAdmin.js", () => {
  // Sub-collection document (e.g. cycleLogs/{uid}/entries/{dateKey})
  function subDoc() {
    return {
      get:    mockSubDocGet,
      set:    mockDbDocSet,
      delete: mockDbDocDelete,
    };
  }

  // Top-level document (e.g. users/{uid}, cycleLogs/{uid})
  // Records the uid so tests can assert which namespace was accessed.
  function topDoc(uid) {
    mockTopLevelDocSpy(uid);
    return {
      get:    mockDbDocGet,
      set:    mockDbDocSet,
      delete: mockDbDocDelete,
      collection: () => ({
        doc: subDoc,
        add: vi.fn().mockResolvedValue(undefined),
        where: () => ({
          where: () => ({ limit: () => ({ get: mockQueryGet }) }),
          limit: () => ({ get: mockQueryGet }),
        }),
        orderBy: () => ({
          limit: () => ({
            get: mockQueryGet,
            where: () => ({ get: mockQueryGet }),
          }),
        }),
      }),
    };
  }

  return {
    auth:  { verifyIdToken: mockVerifyIdToken },
    db:    {
      collection: () => ({
        doc: topDoc,
        add: vi.fn().mockResolvedValue(undefined),
        where: () => ({
          where: () => ({ limit: () => ({ get: mockQueryGet }) }),
          limit: () => ({ get: mockQueryGet }),
        }),
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

// Prevent audit writes from touching Firestore in tests
vi.mock("../utils/auditLog.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {
    YOB_SET:          "YOB_SET",
    PROFILE_UPDATED:  "PROFILE_UPDATED",
    PREFERENCES_UPDATED: "PREFERENCES_UPDATED",
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Route + validator imports (after mocks are registered)
// ─────────────────────────────────────────────────────────────────────────────

import { validateUserProfile } from "../validators/validateUser.js";
import userRoutes        from "../routes/user.js";
import cycleLogRoutes    from "../routes/cycleLogs.js";
import userProfileRouter from "../routes/userProfile.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test app factory
// Creates a fresh Express app per suite — no rate limiters on these routes
// (rate limit behaviour is tested separately with dedicated minimal apps).
// ─────────────────────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/user",             userRoutes);
  app.use("/cycle-logs",       cycleLogRoutes);
  app.use("/api/user/profile", userProfileRouter);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const USER_A_UID   = "uid-alice-001";
const USER_B_UID   = "uid-bob-002";
const USER_A_TOKEN = "valid-token-alice";
const USER_B_TOKEN = "valid-token-bob";

const USER_A_DOC = {
  exists: true,
  data: () => ({ role: "user", profile: { role: "user", yearOfBirth: 1995 } }),
};
const USER_B_DOC = {
  exists: true,
  data: () => ({ role: "user", profile: { role: "user", yearOfBirth: 1990 } }),
};
const EMPTY_DOC = { exists: false, data: () => null };

// Convenience helpers that queue the two sequential mocks needed for each
// authenticated request: verifyIdToken + the auth-middleware user-doc lookup.
function seedAuthA() {
  mockVerifyIdToken.mockResolvedValueOnce({
    uid: USER_A_UID, email: "alice@bloom.test", email_verified: true,
  });
  mockDbDocGet.mockResolvedValueOnce(USER_A_DOC);
}

function seedAuthB() {
  mockVerifyIdToken.mockResolvedValueOnce({
    uid: USER_B_UID, email: "bob@bloom.test", email_verified: true,
  });
  mockDbDocGet.mockResolvedValueOnce(USER_B_DOC);
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let app;

beforeEach(() => {
  // Reset both call history and queued one-time return values
  vi.resetAllMocks();
  app = makeApp();
  mockQueryGet.mockResolvedValue({ empty: true, docs: [] });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Unauthenticated request → 401
// ═════════════════════════════════════════════════════════════════════════════

describe("unauthenticated request → 401", () => {
  it("GET /user/profile without Authorization header returns 401", async () => {
    const res = await request(app).get("/user/profile");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });

  it("GET /cycle-logs/:dateKey without token returns 401", async () => {
    const res = await request(app).get("/cycle-logs/2024-06-01");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });

  it("PUT /cycle-logs/:dateKey without token returns 401", async () => {
    const res = await request(app)
      .put("/cycle-logs/2024-06-01")
      .send({ periodDay: 1, flowLevel: 2 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });

  it("DELETE /cycle-logs/:dateKey without token returns 401", async () => {
    const res = await request(app).delete("/cycle-logs/2024-06-01");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });

  it("POST /user/profile without token returns 401", async () => {
    const res = await request(app)
      .post("/user/profile")
      .send({ goal: "track_cycle" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });

  it("GET /api/user/profile without token returns 401", async () => {
    const res = await request(app).get("/api/user/profile");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Invalid / expired token → 401
// ═════════════════════════════════════════════════════════════════════════════

describe("invalid token → 401", () => {
  it("rejects a malformed token string", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error("Decoding Firebase ID token failed"), {
        code: "auth/argument-error",
      })
    );
    const res = await request(app)
      .get("/user/profile")
      .set("Authorization", "Bearer not.a.real.jwt");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid token");
  });

  it("rejects an expired token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error("Firebase ID token has expired"), {
        code: "auth/id-token-expired",
      })
    );
    const res = await request(app)
      .get("/user/profile")
      .set("Authorization", "Bearer eyJhbGciOiJSUzI1NiJ9.expired.signature");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid token");
  });

  it("rejects a revoked token", async () => {
    mockVerifyIdToken.mockRejectedValueOnce(
      Object.assign(new Error("Firebase ID token has been revoked"), {
        code: "auth/id-token-revoked",
      })
    );
    const res = await request(app)
      .get("/user/profile")
      .set("Authorization", "Bearer eyJhbGciOiJSUzI1NiJ9.revoked.signature");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid token");
  });

  it("rejects a request using Basic auth instead of Bearer", async () => {
    // Authorization header is present but wrong scheme — token extraction fails
    const res = await request(app)
      .get("/user/profile")
      .set("Authorization", "Basic dXNlcjpwYXNz");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing token");
  });

  it("rejects a request with an empty Bearer value", async () => {
    const res = await request(app)
      .get("/user/profile")
      .set("Authorization", "Bearer ");
    // Empty string after split — verifyIdToken should throw or middleware rejects
    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Cross-user data isolation
// Routes derive the Firestore namespace from req.user.uid (set by the auth
// middleware after token verification). No request parameter can override it.
// ═════════════════════════════════════════════════════════════════════════════

describe("cross-user data isolation", () => {
  it("GET /user/profile queries only the authenticated user's Firestore doc", async () => {
    seedAuthA();
    mockDbDocGet.mockResolvedValueOnce(USER_A_DOC); // route's own doc fetch

    await request(app)
      .get("/user/profile")
      .set("Authorization", `Bearer ${USER_A_TOKEN}`);

    const queriedUids = mockTopLevelDocSpy.mock.calls.map(([uid]) => uid);
    expect(queriedUids.every((uid) => uid === USER_A_UID)).toBe(true);
    expect(queriedUids).not.toContain(USER_B_UID);
  });

  it("user B's token never touches user A's cycle-log namespace", async () => {
    seedAuthB();
    mockSubDocGet.mockResolvedValueOnce(EMPTY_DOC); // no log for B at this date

    const res = await request(app)
      .get("/cycle-logs/2024-06-01")
      .set("Authorization", `Bearer ${USER_B_TOKEN}`);

    expect(res.status).toBe(200);

    const queriedUids = mockTopLevelDocSpy.mock.calls.map(([uid]) => uid);
    expect(queriedUids).toContain(USER_B_UID);
    expect(queriedUids).not.toContain(USER_A_UID);
  });

  it("a uid field in the request body is ignored — route uses token uid", async () => {
    // User B sends their valid token but includes user A's uid in the body.
    // The route must ignore req.body.uid and use req.user.uid (B's uid).
    seedAuthB();
    mockDbDocGet.mockResolvedValueOnce(USER_B_DOC); // route's profile snap
    mockDbDocSet.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post("/user/profile")
      .set("Authorization", `Bearer ${USER_B_TOKEN}`)
      .send({ uid: USER_A_UID, goal: "track_cycle" });

    expect(res.status).toBe(200);

    const queriedUids = mockTopLevelDocSpy.mock.calls.map(([uid]) => uid);
    expect(queriedUids).toContain(USER_B_UID);
    expect(queriedUids).not.toContain(USER_A_UID);
  });

  it("two users in sequence each access only their own namespace", async () => {
    // Request 1: user A
    seedAuthA();
    mockDbDocGet.mockResolvedValueOnce(USER_A_DOC);
    await request(app)
      .get("/user/profile")
      .set("Authorization", `Bearer ${USER_A_TOKEN}`);

    const afterA = mockTopLevelDocSpy.mock.calls.map(([uid]) => uid);
    expect(afterA).not.toContain(USER_B_UID);

    // Request 2: user B — fresh mock spy call list continues from here
    seedAuthB();
    mockDbDocGet.mockResolvedValueOnce(USER_B_DOC);
    await request(app)
      .get("/user/profile")
      .set("Authorization", `Bearer ${USER_B_TOKEN}`);

    const allUids = mockTopLevelDocSpy.mock.calls.map(([uid]) => uid);
    // A's calls are in the first half, B's in the second — never crossed
    const bCalls = allUids.slice(afterA.length);
    expect(bCalls).not.toContain(USER_A_UID);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Input sanitization
// ═════════════════════════════════════════════════════════════════════════════

describe("input sanitization", () => {
  // ── 4a. validateUserProfile — pure function (no HTTP overhead) ─────────────
  describe("validateUserProfile", () => {
    const currentYear = new Date().getFullYear();

    it("rejects a goal containing a script payload", () => {
      const result = validateUserProfile({ goal: "<script>alert(1)</script>" });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/goal must be one of/);
    });

    it("rejects a yearOfBirth in the future", () => {
      const result = validateUserProfile({ yearOfBirth: currentYear + 1 });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/yearOfBirth/);
    });

    it("rejects a yearOfBirth that makes the user under 13", () => {
      const tooYoung = currentYear - 10;
      const result = validateUserProfile({ yearOfBirth: tooYoung });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/at least 13/);
    });

    it("blocks changing a yearOfBirth that is already set (edit-once lock)", () => {
      const result = validateUserProfile(
        { yearOfBirth: 1990 },
        { yearOfBirth: 1985 } // already locked at 1985
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/locked/);
    });

    it("rejects a non-enum mode value", () => {
      const result = validateUserProfile({ mode: "'; DROP TABLE users; --" });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/mode must be one of/);
    });

    it("rejects a non-boolean consentSensitive", () => {
      const result = validateUserProfile({ consentSensitive: "yes" });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/boolean/);
    });

    it("rejects a non-boolean remindersEnabled", () => {
      const result = validateUserProfile({ remindersEnabled: 1 });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/boolean/);
    });

    it("rejects a reminderTime that is not HH:MM", () => {
      const result = validateUserProfile({ reminderTime: "9am" });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/HH:MM/);
    });

    it("rejects hour 25 in reminderTime", () => {
      const result = validateUserProfile({ reminderTime: "25:00" });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/HH:MM/);
    });

    it("accepts a fully valid payload", () => {
      const result = validateUserProfile({
        goal:             "track_cycle",
        mode:             "account",
        yearOfBirth:      1995,
        remindersEnabled: true,
        reminderTime:     "08:30",
        consentSensitive: false,
      });
      expect(result.valid).toBe(true);
    });
  });

  // ── 4b. Nickname HTML stripping — end-to-end through GET /api/user/profile ─
  describe("nickname sanitization", () => {
    // Seeds the two sequential mockDbDocGet calls needed:
    // 1st — requireAuth user-doc lookup
    // 2nd — subDoc call is mockSubDocGet (different fn)
    function seedNicknameRequest(rawNickname) {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: USER_A_UID, email: "alice@bloom.test", email_verified: true,
      });
      mockDbDocGet.mockResolvedValueOnce(USER_A_DOC);     // auth middleware
      mockSubDocGet.mockResolvedValueOnce({               // userProfile route
        exists: true,
        data:   () => ({ nickname: rawNickname }),
      });
    }

    it("strips <script> tags and returns only the safe text", async () => {
      seedNicknameRequest("<script>alert('xss')</script>Alice");

      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.nickname).toBe("Alice");
    });

    it("strips inline event-handler injection attempts", async () => {
      seedNicknameRequest('<img src=x onerror="fetch(evil.com)">Bloom');

      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`);

      expect(res.body.nickname).toBe("Bloom");
    });

    it("returns null when the entire nickname is script content", async () => {
      seedNicknameRequest("<script>document.cookie</script>");

      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`);

      expect(res.body.nickname).toBeNull();
    });

    it("truncates nickname to 30 characters", async () => {
      seedNicknameRequest("A".repeat(50));

      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`);

      expect(res.body.nickname).toHaveLength(30);
    });

    it("returns null when no profile doc exists", async () => {
      mockVerifyIdToken.mockResolvedValueOnce({
        uid: USER_A_UID, email: "alice@bloom.test", email_verified: true,
      });
      mockDbDocGet.mockResolvedValueOnce(USER_A_DOC);
      mockSubDocGet.mockResolvedValueOnce(EMPTY_DOC);

      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`);

      expect(res.body.nickname).toBeNull();
    });
  });

  // ── 4c. Route-level rejection via HTTP ─────────────────────────────────────
  describe("POST /user/profile — bad input → 400", () => {
    it("rejects a goal containing arbitrary text", async () => {
      seedAuthA();
      mockDbDocGet.mockResolvedValueOnce(EMPTY_DOC);

      const res = await request(app)
        .post("/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`)
        .send({ goal: "'; DROP TABLE users; --" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/goal must be one of/);
    });

    it("rejects an invalid mode", async () => {
      seedAuthA();
      mockDbDocGet.mockResolvedValueOnce(EMPTY_DOC);

      const res = await request(app)
        .post("/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`)
        .send({ mode: "superuser" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/mode must be one of/);
    });

    it("rejects a yearOfBirth that is too recent (under-13)", async () => {
      seedAuthA();
      mockDbDocGet.mockResolvedValueOnce(EMPTY_DOC);

      const res = await request(app)
        .post("/user/profile")
        .set("Authorization", `Bearer ${USER_A_TOKEN}`)
        .send({ yearOfBirth: new Date().getFullYear() - 5 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/at least 13/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Rate limiting → 429
// These tests build self-contained minimal Express apps with tight limits so
// the test runs in milliseconds without depending on real timer windows.
// ═════════════════════════════════════════════════════════════════════════════

describe("rate limiting → 429", () => {
  function makeLimitedApp(max) {
    const app = express();
    app.use(express.json());

    const limiter = rateLimit({
      windowMs: 60_000,
      max,
      standardHeaders: true,
      legacyHeaders:   false,
      handler: (req, res) =>
        res.status(429).json({
          error:       "Too many requests. Please wait a moment and try again.",
          retryAfter:  Math.ceil(
            req.rateLimit?.resetTime
              ? (req.rateLimit.resetTime - Date.now()) / 1000
              : 60
          ),
        }),
    });

    app.use("/auth", limiter);
    app.post("/auth/verify", (_req, res) => res.json({ ok: true }));
    return app;
  }

  it("requests within the limit all succeed (200)", async () => {
    const limited = makeLimitedApp(5);
    for (let i = 0; i < 5; i++) {
      const res = await request(limited).post("/auth/verify").send({});
      expect(res.status).toBe(200);
    }
  });

  it("the request immediately after the limit returns 429", async () => {
    const limited = makeLimitedApp(3);

    for (let i = 0; i < 3; i++) {
      await request(limited).post("/auth/verify").send({});
    }

    const blocked = await request(limited).post("/auth/verify").send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many requests/);
  });

  it("blocked response includes a positive retryAfter value", async () => {
    const limited = makeLimitedApp(1);

    await request(limited).post("/auth/verify").send({});
    const blocked = await request(limited).post("/auth/verify").send({});

    expect(blocked.status).toBe(429);
    expect(typeof blocked.body.retryAfter).toBe("number");
    expect(blocked.body.retryAfter).toBeGreaterThan(0);
  });

  it("blocked response sets RateLimit standard headers", async () => {
    const limited = makeLimitedApp(1);

    await request(limited).post("/auth/verify").send({});
    const blocked = await request(limited).post("/auth/verify").send({});

    expect(blocked.status).toBe(429);
    // express-rate-limit with standardHeaders: true sets RateLimit-* headers
    expect(blocked.headers).toHaveProperty("ratelimit-limit");
    expect(blocked.headers).toHaveProperty("ratelimit-remaining");
  });

  it("an unrelated route is not affected by another route's limiter", async () => {
    const app = express();
    app.use(express.json());

    const authLimiter = rateLimit({ windowMs: 60_000, max: 1 });
    app.use("/auth",   authLimiter);
    app.post("/auth/verify",  (_req, res) => res.json({ ok: true }));
    app.get("/health",         (_req, res) => res.json({ ok: true })); // no limiter

    // Exhaust the auth limiter
    await request(app).post("/auth/verify").send({});
    const blocked = await request(app).post("/auth/verify").send({});
    expect(blocked.status).toBe(429);

    // Health check is not behind the auth limiter — should still pass
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
  });
});
