import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import userRoutes          from "./src/routes/user.js";
import preferencesRoutes   from "./src/routes/preferences.js";
import cycleLogRoutes      from "./src/routes/cycleLogs.js";
import bloomieSafetyLogRoutes from "./src/routes/bloomieSafetyLog.js";
import symptomLogRoutes    from "./src/routes/symptomLogs.js";
import notificationRoutes from "./src/routes/notifications.js";
import consentRoutes       from "./src/routes/consent.js";
import catalogRoutes       from "./src/routes/catalog.js";
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

app.use(cors());
app.use(express.json());
app.use(globalLimiter);

app.use("/user",                            userRoutes);
app.use("/cycle-logs",                      cycleLogRoutes);
app.use("/symptom-logs",                    symptomLogRoutes);
app.use("/consent/request", consentLimiter, consentRoutes);
app.use("/notifications", notificationRoutes);
app.use("/consent",                         consentRoutes);
app.use("/bloomie-safety-log", bloomieSafetyLogRoutes);
app.use("/preferences",                     preferencesRoutes);
app.use("/admin",           adminLimiter,   adminRoutes);
app.use("/catalog",                         catalogRoutes);
app.use("/auth",            authLimiter,    authRoutes);
app.use("/bloomie-memory",                  bloomieMemoryRoutes);
app.use("/feedback",                        feedbackRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Bloom backend is running" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});