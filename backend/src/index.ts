import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

import pool from "./db/pool";
import redis from "./db/redis";
import authRouter from "./routes/auth";
import usersRouter from "./routes/users";
import groupsRouter from "./routes/groups";
import expensesRouter from "./routes/expenses";
import balanceRouter from "./routes/balance";
import settlementsRouter from "./routes/settlements";
import pushRouter from "./routes/push";
import aiRouter from "./routes/ai";
import personalExpensesRouter from "./routes/personal_expenses";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true, // required so the browser sends/receives httpOnly cookies
  })
);

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Checks Postgres + Redis reachability. Returns 200 if both ok, 503 otherwise.
 */
app.get("/health", async (_req: Request, res: Response) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: { postgres: "unreachable", redis: "unreachable" },
  };

  try {
    await pool.query("SELECT 1");
    health.services.postgres = "ok";
  } catch (err) {
    console.error("Postgres health check failed:", (err as Error).message);
  }

  try {
    const pong = await redis.ping();
    if (pong === "PONG") health.services.redis = "ok";
  } catch (err) {
    console.error("Redis health check failed:", (err as Error).message);
  }

  const allOk = health.services.postgres === "ok" && health.services.redis === "ok";
  res.status(allOk ? 200 : 503).json(health);
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/groups", groupsRouter);
app.use("/expenses", expensesRouter);
app.use("/balance", balanceRouter);
app.use("/settlements", settlementsRouter);
app.use("/push", pushRouter);
app.use("/ai", aiRouter);
app.use("/personal_expenses", personalExpensesRouter);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Spenit backend running on http://localhost:${PORT}`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Auth:     POST http://localhost:${PORT}/auth/google`);
  console.log(`   Profile:  GET  http://localhost:${PORT}/users/me`);
  console.log(`   Groups:   POST http://localhost:${PORT}/groups`);
  console.log(`   Expenses: POST http://localhost:${PORT}/expenses`);
  console.log(`   Balance:  GET  http://localhost:${PORT}/balance/groups/:id`);
  console.log(`   Balance:  GET  http://localhost:${PORT}/balance/me`);
});

export default app;
