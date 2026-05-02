import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";

import { db } from "./firebaseAdmin.js";
import cycleLogRoutes from "./routes/cycleLogs.js";
import notificationRoutes from "./routes/notifications.js";
import biometricLogRoutes from "./routes/biometricLogs.js";
import symptomLogRoutes from "./routes/symptomLogs.js";
import phaseFeedbackRoutes from "./routes/phaseFeedback.js";
import consentRoutes from "./routes/consent.js";
import catalogRoutes from "./routes/catalog.js";
import clinicRoutes from "./routes/clinics.js";
import userRoutes from "./routes/user.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import bloomieMemoryRoutes from "./routes/bloomieMemory.js";
import bloomieSafetyLogRoutes from "./routes/bloomieSafetyLog.js";
import bloomieAnalyticsRoutes from "./routes/bloomieAnalytics.js";
import feedbackRoutes from "./routes/feedback.js";
import preferencesRoutes from "./routes/preferences.js";
import cyclesMLRoutes from "./routes/cyclesML.js";
import contactRoutes from "./routes/contact.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WARN_ENV_VARS = [
  "HELPDESK_EMAIL",
  "HELPDESK_EMAIL_PASS",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ORS_API_KEY",
];

let warnedOptionalEnv = false;
let warnedOpenCors = false;

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function logOptionalEnvWarnings() {
  if (warnedOptionalEnv) return;
  warnedOptionalEnv = true;
  const missingWarn = WARN_ENV_VARS.filter((key) => !process.env[key]);
  if (!missingWarn.length) return;
  console.warn(
    `WARNING: Missing optional env vars (some features may not work): ${missingWarn.join(", ")}`
  );
}

function buildCorsOptions() {
  const allowedOrigins = parseAllowedOrigins();
  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (!allowedOrigins.length) {
        if (!warnedOpenCors) {
          warnedOpenCors = true;
          console.warn(
            "[CORS] ALLOWED_ORIGINS not set; allowing all origins. Set ALLOWED_ORIGINS in production."
          );
        }
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  };
}

function buildRateLimiters() {
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many auth requests. Please try again later." },
  });

  return { generalLimiter, authLimiter };
}

export function createApp({ serveFrontend = false } = {}) {
  logOptionalEnvWarnings();

  const app = express();
  const corsOptions = buildCorsOptions();
  const { generalLimiter, authLimiter } = buildRateLimiters();

  app.use(cors(corsOptions));
  app.use(express.json({ limit: "10mb" }));

  app.use((req, _res, next) => {
    if (req.method !== "GET") {
      console.log(`>>> ${req.method} ${req.path}`);
    }
    next();
  });

  if (serveFrontend) {
    app.use(express.static(path.join(__dirname, "../../frontend")));
  }

  app.use("/api", generalLimiter);
  app.use("/api/auth", authLimiter);

  app.use("/api/logs", cycleLogRoutes);
  app.use("/api/cycle", cycleLogRoutes);
  app.use("/api/symptom-logs", symptomLogRoutes);
  app.use("/api/symptoms", symptomLogRoutes);
  app.use("/api/consent", consentRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/clinics", clinicRoutes);
  app.use("/catalog", catalogRoutes);
  app.use("/api/user", userRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/bloomie-memory", bloomieMemoryRoutes);
  app.use("/api/bloomie-safety-log", bloomieSafetyLogRoutes);
  app.use("/api/bloomie/analytics", bloomieAnalyticsRoutes);
  app.use("/api/biometric-logs", biometricLogRoutes);
  app.use("/api/phase-feedback", phaseFeedbackRoutes);
  app.use("/api/feedback", feedbackRoutes);
  app.use("/api/cycle-logs", cycleLogRoutes);
  app.use("/api/preferences", preferencesRoutes);
  app.use("/api/cycles", cyclesMLRoutes);
  app.use("/api/contact", contactRoutes);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, message: "Backend is running" });
  });

  return app;
}

export async function runStartupChecks() {
  try {
    const snap = await db.collection("symptomCatalog").limit(1).get();
    if (snap.empty) {
      console.warn(
        "WARNING: symptomCatalog is empty. Run scripts/seedSymptoms.js or symptom logging will fail."
      );
    }
  } catch (_) {
    // Ignore startup checks when Firestore is temporarily unavailable.
  }

  try {
    const snap = await db.collection("clinicDirectory").limit(1).get();
    if (snap.empty) {
      console.warn(
        "WARNING: clinicDirectory is empty. Run scripts/seedClinics.js or the clinic finder will fall back to local data."
      );
    }
  } catch (_) {
    // Ignore startup checks when Firestore is temporarily unavailable.
  }
}
