import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import userRoutes          from "./src/routes/user.js";
import preferencesRoutes   from "./src/routes/preferences.js";
import biometricLogRoutes from "./src/routes/biometricLogs.js";
import cycleLogRoutes      from "./src/routes/cycleLogs.js";
import phaseFeedbackRoutes from "./src/routes/phaseFeedback.js";
import bloomieSafetyLogRoutes from "./src/routes/bloomieSafetyLog.js";
import symptomLogRoutes    from "./src/routes/symptomLogs.js";
import notificationRoutes from "./src/routes/notifications.js";
import consentRoutes       from "./src/routes/consent.js";
import catalogRoutes       from "./src/routes/catalog.js";
import clinicRoutes        from "./src/routes/clinics.js";
import adminRoutes         from "./src/routes/admin.js";
import authRoutes          from "./src/routes/auth.js";
import bloomieMemoryRoutes from "./src/routes/bloomieMemory.js";
import feedbackRoutes      from "./src/routes/feedback.js";

import {
  globalLimiter,
  authLimiter,
  consentLimiter,
  adminLimiter,
} from "./src/middleware/rateLimiter.js";

const app  = express();
const PORT = process.env.PORT || 4000;

const BASE_ALLOWED_ORIGINS = [
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  "http://localhost:4100",
  "http://127.0.0.1:4100",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "https://bloom-8401a.web.app",
  "https://bloom-8401a.firebaseapp.com",
];

const envAllowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

function normalizeOrigin(origin) {
  if (!origin || typeof origin !== "string") return "";
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

const normalizedAllowedOrigins = new Set(
  [...BASE_ALLOWED_ORIGINS, ...envAllowedOrigins]
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean)
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin);
  try {
    if (new URL(normalizedOrigin).hostname.endsWith(".netlify.app")) return true;
  } catch (_) {}
  return normalizedAllowedOrigins.has(normalizedOrigin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
};

app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(globalLimiter);

app.use("/api/user", userRoutes);
app.use("/cycle-logs",                      cycleLogRoutes);
app.use("/api/phase-feedback", phaseFeedbackRoutes);
app.use("/api/symptom-logs",                symptomLogRoutes);
app.use("/api/symptoms",                    symptomLogRoutes);
app.use("/api/clinics",                     clinicRoutes);
app.use("/symptom-logs",                    symptomLogRoutes);
app.use("/consent/request", consentLimiter, consentRoutes);
app.use("/notifications", notificationRoutes);
app.use("/consent",                         consentRoutes);
app.use("/bloomie-safety-log", bloomieSafetyLogRoutes);
app.use("/preferences",                     preferencesRoutes);
app.use("/admin",           adminLimiter,   adminRoutes);
app.use("/catalog",                         catalogRoutes);
app.use("/api/biometric-logs", biometricLogRoutes);
app.use("/auth",            authLimiter,    authRoutes);
app.use("/bloomie-memory",                  bloomieMemoryRoutes);
app.use("/feedback",                        feedbackRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Bloom backend is running" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
