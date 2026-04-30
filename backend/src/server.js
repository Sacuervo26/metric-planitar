require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { sequelize } = require("./models");
const cloudStateRouter = require("./routes/cloudState");
const snapshotsRouter = require("./routes/snapshots");
const adjustmentsRouter = require("./routes/adjustments");
const scheduleRouter = require("./routes/schedule");
const personConfigRouter = require("./routes/personConfig");
const authRouter = require("./routes/auth");
const adminRouter = require("./routes/admin");
const { requireApiKey } = require("./middleware/auth");

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";
const IS_PROD = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(
  cors({
    origin: CORS_ORIGIN,
    // Authorization is needed for the JWT-based /auth/me and
    // /auth/change-password endpoints — without it the browser's CORS
    // preflight rejects the header and the fetch fails with
    // "Failed to fetch".
    allowedHeaders: ["Content-Type", "X-API-Key", "Authorization"],
  })
);
// 200mb covers the cumulative-CSV payload that builds up after the team
// uploads several weeks of metrics (each weekly Standard CSV is around
// 4–5 MB once parsed into JSON; 17 weeks * 5 MB ≈ 85 MB). Express's default
// is 100kb, which silently 413s without a clear message in the browser.
app.use(express.json({ limit: "200mb" }));

const cloudStateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

if (!process.env.API_KEY) {
  console.warn(
    "[backend] WARNING: API_KEY not set — all requests accepted. Set API_KEY in .env before deploying."
  );
}

// Auth routes use a stricter rate limit so brute-force login attempts are
// throttled. /auth/login itself is intentionally PUBLIC (no API key) so the
// frontend can request a session token. The login handler enforces the
// password check.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/auth", authLimiter, authRouter);

app.use("/cloud-state", cloudStateLimiter, requireApiKey, cloudStateRouter);
app.use("/snapshots", cloudStateLimiter, requireApiKey, snapshotsRouter);
app.use("/adjustments", cloudStateLimiter, requireApiKey, adjustmentsRouter);
app.use("/schedule", cloudStateLimiter, requireApiKey, scheduleRouter);
app.use("/person-config", cloudStateLimiter, requireApiKey, personConfigRouter);
// /admin has mixed auth: bootstrap uses the legacy API_KEY (no JWT exists
// yet at first install), while user CRUD uses requireLeader (JWT) so
// only signed-in leaders can manage accounts. Each handler in admin.js
// declares its own middleware.
app.use("/admin", cloudStateLimiter, adminRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: IS_PROD ? "Internal error" : err.message || "Internal error",
  });
});

async function start() {
  await sequelize.authenticate();

  // Best-effort schema upgrades for hosts where shell migrations can't run
  // (e.g. Render free tier). Each statement is idempotent — Postgres treats
  // "ADD COLUMN IF NOT EXISTS" as a no-op when the column already exists.
  try {
    await sequelize.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS "coverDataUrl" TEXT'
    );
  } catch (err) {
    console.warn(
      "[backend] schema-upgrade ensure(coverDataUrl) failed:",
      err.message
    );
  }

  app.listen(PORT, () => {
    console.log(`[backend] listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("[backend] failed to start", err);
  process.exit(1);
});
