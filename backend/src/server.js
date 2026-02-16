// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import userRoutes from "./routes/user.js"; // import the user routes

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Register your user routes under /api/user
app.use("/api/user", userRoutes);

// Example health route
app.get("/health", (req, res) => {
  res.json({ ok: true, message: "Backend is running 🚀" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
