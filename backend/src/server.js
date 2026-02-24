// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cycleLogRoutes from "./routes/cycleLogs.js";
import symptomLogRoutes from "./routes/symptomLogs.js";
import consentRoutes from "./routes/consent.js";
import catalogRoutes from "./routes/catalog.js";
import userRoutes from "./routes/user.js";
import authRoutes from "./routes/auth.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/cycle", cycleLogRoutes);
app.use("/api/symptoms", symptomLogRoutes);
app.use("/api/consent", consentRoutes);
app.use("/api/catalog", catalogRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend is running 🚀" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});