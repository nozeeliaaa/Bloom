// server.js
import dotenv from "dotenv";
dotenv.config();
// ── Startup env var checks ──────────────────────────────────
const REQUIRED_ENV_VARS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL", 
  "FIREBASE_PRIVATE_KEY",
  "APP_BASE_URL",
];

const WARN_ENV_VARS = [
  "HELPDESK_EMAIL",
  "HELPDESK_EMAIL_PASS",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "ORS_API_KEY",
];

const missingRequired = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingRequired.length > 0) {
  console.error(`❌ FATAL: Missing required env vars: ${missingRequired.join(", ")}`);
  process.exit(1);
}

const missingWarn = WARN_ENV_VARS.filter(v => !process.env[v]);
if (missingWarn.length > 0) {
  console.warn(`⚠️  WARNING: Missing optional env vars (some features will not work): ${missingWarn.join(", ")}`);
}

import cron from "node-cron";
import express from "express";
import cors from "cors";

import { db } from "./src/firebaseAdmin.js";
import { runDailyRemindersJob } from "./src/jobs/sendDailyReminders.js";
import cycleLogRoutes from "./src/routes/cycleLogs.js";
import notificationRoutes from "./src/routes/notifications.js";
import symptomLogRoutes from "./src/routes/symptomLogs.js";
import consentRoutes from "./src/routes/consent.js";
import catalogRoutes from "./src/routes/catalog.js";
import userRoutes from "./src/routes/user.js";
import authRoutes from "./src/routes/auth.js";
import adminRoutes from "./src/routes/admin.js";
import bloomieMemoryRoutes from "./src/routes/bloomieMemory.js";
import bloomieSafetyLogRoutes from "./src/routes/bloomieSafetyLog.js";
import feedbackRoutes from "./src/routes/feedback.js";
import { runAgeUpgradeJob } from "./src/jobs/ageUpgrade.js";
import { runTokenExpiryJob } from "./src/jobs/tokenExpiry.js";
import rateLimit from "express-rate-limit";
import cyclesML from "./src/routes/cyclesML.js";

const app = express();

// Restrict CORS to known origins; reads from env in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:5173", "http://localhost:4000"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server / curl calls (no origin) in development
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());

// --- Rate limiting ---
// General limiter for all API routes: 200 requests / 15 minutes per IP
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

// Stricter limiter for auth endpoints: 20 requests / 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth requests. Please try again later." },
});

app.use("/api", generalLimiter);
app.use("/api/auth", authLimiter);

// /api/logs — used by db.js (frontend) for daily log sync
app.use("/api/logs", cycleLogRoutes);

// /api/cycle — legacy alias kept for backwards compat
app.use("/api/cycle", cycleLogRoutes);

app.use("/api/symptoms", symptomLogRoutes);
app.use("/api/consent", consentRoutes);
app.use("/api/auth", authRoutes);
app.use("/catalog", catalogRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/bloomie-memory",    bloomieMemoryRoutes);
app.use("/api/bloomie-safety-log", bloomieSafetyLogRoutes);
app.use("/api/feedback",           feedbackRoutes);
app.use('/api/cycles', cyclesML);

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

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});