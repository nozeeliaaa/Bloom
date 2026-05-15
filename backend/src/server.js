
// ── Startup env var checks ──────────────────────────────────
// Firebase credentials are handled by firebaseAdmin.js (uses serviceAccountKey.json as local fallback)
const WARN_ENV_VARS = [
  "HELPDESK_EMAIL",
  "HELPDESK_EMAIL_PASS",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ORS_API_KEY",
];

const missingWarn = WARN_ENV_VARS.filter(v => !process.env[v]);
if (missingWarn.length > 0) {
  console.warn(`⚠️  WARNING: Missing optional env vars (some features will not work): ${missingWarn.join(", ")}`);
}

import cron from "node-cron";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { db } from "./firebaseAdmin.js";
import { runDailyRemindersJob } from "./jobs/sendDailyReminders.js";
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
import bloomieAIRoutes from "./routes/bloomieAI.js";
import bloomieContentMatchRoutes from "./routes/bloomieContentMatch.js";
import bloomieContextRoutes from "./routes/bloomieContext.js";
import feedbackRoutes from "./routes/feedback.js";
import preferencesRoutes from "./routes/preferences.js";
import cyclesMLRoutes from "./routes/cyclesML.js";
import contactRoutes  from "./routes/contact.js";

import { runAgeUpgradeJob } from "./jobs/ageUpgrade.js";
import { runTokenExpiryJob } from "./jobs/tokenExpiry.js";
import rateLimit from "express-rate-limit";

const app = express();
console.log(">>> SERVER.JS LOADED - version check OK <<<");
// Cloud Run/Firebase Hosting sit behind proxies; without this, req.ip can collapse
// to proxy IPs and make rate-limiting behave like a global throttle.
app.set("trust proxy", 1);

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
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
};

app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "10mb" }));

// Global request logger - remove after debugging
app.use((req, _res, next) => {
  if (req.method !== 'GET') {
    console.log(`>>> ${req.method} ${req.path}`);
  }
  next();
});

// Serve the frontend folder at the root so localhost:4000/pages/clinics.html works
app.use(express.static(path.join(__dirname, "../../frontend")));

// --- Rate limiting ---
// General limiter for all API routes.
// Tuned for SPA usage where one page load can fan out to multiple API calls.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.API_RATE_LIMIT_MAX || 1200),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.method === "OPTIONS" ||
    req.path.startsWith("/bloomie/analytics"),
  message: { error: "Too many requests. Please try again later." },
});

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  message: { error: "Too many auth requests. Please try again later." },
});

app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);

// /api/logs - used by db.js (frontend) for daily log sync
app.use("/api/logs", cycleLogRoutes);

// /api/cycle - legacy alias kept for backwards compat
app.use("/api/cycle", cycleLogRoutes);

app.use("/api/symptom-logs", symptomLogRoutes);
app.use("/api/symptoms", symptomLogRoutes);
app.use("/api/consent", consentRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/clinics", clinicRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/catalog", catalogRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/bloomie-memory",    bloomieMemoryRoutes);
app.use("/api/bloomie-safety-log", bloomieSafetyLogRoutes);
app.use("/api/bloomie/analytics", bloomieAnalyticsRoutes);
app.use("/api/bloomie/ai", bloomieAIRoutes);
app.use("/api/bloomie-content-match", bloomieContentMatchRoutes);
app.use("/api/bloomie-context", bloomieContextRoutes);
app.use("/api/biometric-logs", biometricLogRoutes);
app.use("/api/phase-feedback", phaseFeedbackRoutes);
app.use("/api/feedback",           feedbackRoutes);
app.use("/api/cycle-logs", cycleLogRoutes);
app.use("/api/preferences",        preferencesRoutes);
app.use("/api/cycles",             cyclesMLRoutes);
app.use("/api/contact",            contactRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend is running 🚀" });
});

// Age upgrade: runs daily at midnight
cron.schedule("0 0 * * *", () => {
  runAgeUpgradeJob();
});

// Daily reminders: runs every day at 9am
cron.schedule("0 9 * * *", () => {
  runDailyRemindersJob();
});

// Token expiry: runs every hour
cron.schedule("0 * * * *", () => {
  runTokenExpiryJob();
});

const PORT = process.env.PORT || 4000;

// Startup check: warn if symptomCatalog is empty
db.collection("symptomCatalog").limit(1).get().then(snap => {
  if (snap.empty) {
    console.warn("⚠️  WARNING: symptomCatalog is empty. Run scripts/seedSymptoms.js or symptom logging will fail for all users.");
  }
}).catch(() => {});

db.collection("clinicDirectory").limit(1).get().then(snap => {
  if (snap.empty) {
    console.warn("WARNING: clinicDirectory is empty. Run scripts/seedClinics.js or the clinic finder will fall back to local data.");
  }
}).catch(() => {});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
