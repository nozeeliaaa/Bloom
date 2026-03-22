// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cycleLogRoutes from "./routes/cycleLogs.js";
import symptomLogRoutes from "./routes/symptomLogs.js";
import consentRoutes from "./routes/consent.js";
import catalogRoutes from "./routes/catalog.js";
import userRoutes from "./routes/user.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import bloomieMemoryRoutes    from "./routes/bloomieMemory.js";
import bloomieSafetyLogRoutes from "./routes/bloomieSafetyLog.js";

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
app.use("/api/bloomie-memory",    bloomieMemoryRoutes);
app.use("/api/bloomie-safety-log", bloomieSafetyLogRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend is running 🚀" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});