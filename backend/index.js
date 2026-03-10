// backend/index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import userRoutes        from "./src/routes/user.js";
import preferencesRoutes from "./src/routes/preferences.js";
import cycleLogRoutes    from "./src/routes/cycleLogs.js";
import symptomLogRoutes  from "./src/routes/symptomLogs.js";
import consentRoutes     from "./src/routes/consent.js";
import catalogRoutes     from "./src/routes/catalog.js";
import adminRoutes       from "./src/routes/admin.js";
import authRoutes        from "./src/routes/auth.js";

import {
  globalLimiter,
  authLimiter,
  consentLimiter,
  adminLimiter,
} from "./src/middleware/rateLimiter.js";

const app  = express();
const PORT = process.env.PORT || 4000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Global rate limit ────────────────────────────────────────────────────────
app.use(globalLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/user",                            userRoutes);
app.use("/cycle-logs",                      cycleLogRoutes);
app.use("/symptom-logs",                    symptomLogRoutes);
app.use("/consent/request", consentLimiter, consentRoutes);
app.use("/consent",                         consentRoutes);
app.use("/preferences",                     preferencesRoutes);
app.use("/admin",           adminLimiter,   adminRoutes);
app.use("/catalog",                         catalogRoutes);
app.use("/auth",            authLimiter,    authRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ ok: true, message: "Bloom backend is running" });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});