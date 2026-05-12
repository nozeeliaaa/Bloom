import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyIdToken = vi.hoisted(() => vi.fn());
const mockAdminVerifyIdToken = vi.hoisted(() => vi.fn());
const mockCollection = vi.hoisted(() => vi.fn());
const mockSet = vi.hoisted(() => vi.fn(async () => undefined));
const mockGet = vi.hoisted(() => vi.fn());
const mockAdd = vi.hoisted(() => vi.fn(async () => ({ id: "added-doc" })));
const mockSendToHelpdesk = vi.hoisted(() => vi.fn(async () => true));
const mockLogAudit = vi.hoisted(() => vi.fn(async () => undefined));

const serverTimestamp = vi.hoisted(() => vi.fn(() => "SERVER_TIMESTAMP"));
const arrayUnion = vi.hoisted(() => vi.fn((value) => ({ op: "arrayUnion", value })));
const arrayRemove = vi.hoisted(() => vi.fn((value) => ({ op: "arrayRemove", value })));
const deleteField = vi.hoisted(() => vi.fn(() => "DELETE_FIELD"));

vi.mock("../firebaseAdmin.js", () => ({
  auth: { verifyIdToken: mockVerifyIdToken },
  db: { collection: mockCollection },
  admin: {
    auth: () => ({ verifyIdToken: mockAdminVerifyIdToken }),
    firestore: {
      FieldValue: { serverTimestamp, arrayUnion, arrayRemove, delete: deleteField },
    },
  },
}));

vi.mock("firebase-admin", () => ({
  default: {
    auth: () => ({ verifyIdToken: mockAdminVerifyIdToken }),
    firestore: {
      FieldValue: { serverTimestamp, arrayUnion, arrayRemove, delete: deleteField },
    },
    apps: [{}],
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
  },
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ updateUser: vi.fn(async () => undefined) }),
}));

vi.mock("../mailer.js", () => ({
  sendToHelpdesk: mockSendToHelpdesk,
}));

vi.mock("../utils/auditLog.js", () => ({
  logAudit: mockLogAudit,
  AUDIT_ACTIONS: {
    PREFERENCES_UPDATED: "PREFERENCES_UPDATED",
  },
}));

import { requireAuth, requireRole } from "../middleware/auth.js";
import notificationsRouter from "../routes/notifications.js";
import feedbackRouter from "../routes/feedback.js";

function makeUserDoc(uid, overrides = {}) {
  const role = overrides.role || (uid.includes("admin") ? "admin" : "user");
  return {
    role,
    email: `${uid}@example.com`,
    profile: {
      nickname: "Test",
      avatar: "user",
      yearOfBirth: 2000,
      goal: "period",
      mode: "account",
      consentSensitive: false,
      remindersEnabled: false,
      reminderTime: "09:00",
      ...(overrides.profile || {}),
    },
    healthProfile: {
      avgCycleLength: null,
      periodDuration: null,
      weightKg: null,
      heightCm: null,
      lmpDate: null,
    },
    biometricProfile: {
      activityLevel: null,
      sleepScore: null,
      stressLevel: null,
    },
    game: { xp: 0, level: 1, sessionsPlayed: 0 },
    ...(overrides.data || {}),
  };
}

function querySnap({ empty = true, docs = [] } = {}) {
  return { empty, docs };
}

function docSnap(exists, data = {}) {
  return { exists, data: () => data };
}

function collectionRef(name, parentId = null) {
  const ref = {
    add: mockAdd,
    doc: (id) => docRef(name, id),
    where: () => queryBuilder(),
    orderBy: () => queryBuilder(),
    get: async () => querySnap({ docs: [] }),
  };
  return ref;
}

function queryBuilder() {
  return {
    where: () => queryBuilder(),
    limit: () => queryBuilder(),
    orderBy: () => queryBuilder(),
    get: async () => querySnap({ docs: [] }),
  };
}

function docRef(collectionName, id) {
  return {
    id,
    get: async () => {
      if (collectionName === "users") {
        return docSnap(true, makeUserDoc(id));
      }
      if (collectionName === "adminUsers") {
        return docSnap(id.includes("admin"), { uid: id });
      }
      return mockGet();
    },
    set: mockSet,
    delete: vi.fn(async () => undefined),
    collection: (subName) => collectionRef(subName, id),
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", requireAuth, (req, res) => {
    res.json({ ok: true, uid: req.user.uid, role: req.user.role });
  });
  app.get("/admin-only", requireAuth, requireRole("admin"), (_req, res) => {
    res.json({ ok: true, admin: true });
  });
  app.use("/notifications", notificationsRouter);
  app.use("/feedback", feedbackRouter);
  return app;
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(docSnap(false));
  mockCollection.mockImplementation((name) => collectionRef(name));
  mockVerifyIdToken.mockImplementation(async (token) => {
    if (token.startsWith("valid-admin")) {
      return { uid: "admin-user", email: "admin@example.com", email_verified: true };
    }
    if (token.startsWith("valid-user")) {
      return { uid: "normal-user", email: "user@example.com", email_verified: true };
    }
    if (token.startsWith("valid-teen")) {
      return { uid: "teen-user", email: "teen@example.com", email_verified: true };
    }
    const err = new Error("auth/invalid-token");
    err.code = "auth/invalid-token";
    throw err;
  });
  mockAdminVerifyIdToken.mockImplementation(async (token) => {
    if (token.startsWith("valid")) return { uid: "feedback-user" };
    const err = new Error("auth/invalid-token");
    err.code = "auth/invalid-token";
    throw err;
  });
});

describe("expanded API auth header security", () => {
  const malformedHeaders = [
    {},
    { Authorization: "" },
    { Authorization: "Basic abc" },
    { Authorization: "Bearer" },
    { Authorization: "Token abc" },
    { authorization: "Basic abc" },
  ];

  Array.from({ length: 24 }, (_, index) => malformedHeaders[index % malformedHeaders.length])
    .forEach((headers, index) => {
      it(`rejects missing or malformed auth header case ${index + 1}`, async () => {
        const res = await request(createApp()).get("/protected").set(headers);

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/missing token|invalid token/i);
      });
    });

  Array.from({ length: 20 }, (_, index) => `bad-token-${index + 1}`).forEach((token, index) => {
    it(`rejects invalid bearer token case ${index + 1}`, async () => {
      const res = await request(createApp()).get("/protected").set(authHeader(token));

      expect(res.status).toBe(401);
      expect(res.body.code).toMatch(/auth\/invalid-token/);
    });
  });
});

describe("expanded protected API access", () => {
  Array.from({ length: 16 }, (_, index) => index).forEach((index) => {
    it(`allows valid authenticated user request case ${index + 1}`, async () => {
      const token = index % 3 === 0 ? "valid-admin" : index % 3 === 1 ? "valid-user" : "valid-teen";
      const res = await request(createApp()).get("/protected").set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.uid).toMatch(/user/);
    });
  });

  Array.from({ length: 10 }, (_, index) => index).forEach((index) => {
    it(`allows admin-only route for admin token case ${index + 1}`, async () => {
      const res = await request(createApp()).get("/admin-only").set(authHeader(`valid-admin-${index}`));

      expect(res.status).toBe(200);
      expect(res.body.admin).toBe(true);
    });
  });

  Array.from({ length: 10 }, (_, index) => index).forEach((index) => {
    it(`forbids admin-only route for non-admin token case ${index + 1}`, async () => {
      const res = await request(createApp()).get("/admin-only").set(authHeader(`valid-user-${index}`));

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });
  });
});

describe("expanded notification API functionality", () => {
  Array.from({ length: 10 }, (_, index) => `fcm-token-${index + 1}`).forEach((token, index) => {
    it(`saves an FCM token case ${index + 1}`, async () => {
      const res = await request(createApp())
        .post("/notifications/token")
        .set(authHeader("valid-user"))
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/saved/i);
      expect(arrayUnion).toHaveBeenCalledWith(token);
    });
  });

  Array.from({ length: 5 }, (_, index) => index).forEach((index) => {
    it(`rejects invalid FCM token body case ${index + 1}`, async () => {
      const body = index % 2 === 0 ? {} : { token: 12345 };
      const res = await request(createApp())
        .post("/notifications/token")
        .set(authHeader("valid-user"))
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/fcm token/i);
    });
  });

  Array.from({ length: 5 }, (_, index) => `fcm-token-${index + 1}`).forEach((token, index) => {
    it(`removes an FCM token case ${index + 1}`, async () => {
      const res = await request(createApp())
        .delete("/notifications/token")
        .set(authHeader("valid-user"))
        .send(index % 2 === 0 ? { token } : {});

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/removed/i);
    });
  });
});

describe("expanded Bloomie feedback API functionality", () => {
  const validFeedbackBodies = Array.from({ length: 10 }, (_, index) => ({
    sessionId: `session-${index}`,
    nodeId: "LATE_INTRO",
    flowName: "period",
    messageText: "Helpful answer",
    feedbackType: index % 2 === 0 ? "thumbs_up" : "thumbs_down",
    comment: "<script>alert(1)</script>Thanks",
    conversationSlice: [
      { from: "user", text: "my period is late" },
      { from: "bot", text: "let us check timing" },
    ],
  }));

  validFeedbackBodies.forEach((body, index) => {
    it(`accepts valid Bloomie feedback case ${index + 1}`, async () => {
      const res = await request(createApp())
        .post("/feedback")
        .set(index % 2 === 0 ? authHeader("valid-user") : {})
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockAdd).toHaveBeenCalled();
      expect(mockSendToHelpdesk).toHaveBeenCalled();
    });
  });

  Array.from({ length: 10 }, (_, index) => ({
    feedbackType: index % 2 === 0 ? "bad" : "",
  })).forEach((body, index) => {
    it(`rejects invalid Bloomie feedback type case ${index + 1}`, async () => {
      const res = await request(createApp()).post("/feedback").send(body);

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid feedbacktype/i);
    });
  });

});
