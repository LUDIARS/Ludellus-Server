import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { profileRoutes } from "./routes/profiles.js";
import { scoreRoutes } from "./routes/scores.js";
import { branchRoutes } from "./routes/branches.js";
import { curriculumRoutes } from "./routes/curriculum.js";
import { aiModRoutes } from "./routes/aiMod.js";
import { healthRoutes } from "./routes/health.js";
import { cernereAuth } from "./middleware/cernereAuth.js";

const PORT = Number(process.env.LUDELLUS_PORT ?? 5380);
const ALLOWED_ORIGINS = (process.env.LUDELLUS_ALLOWED_ORIGINS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*",
  credentials: true,
}));

// /health は auth 不要
app.route("/health", healthRoutes);

// 以下は Cernere PASETO 認証必須
app.use("/api/v1/*", cernereAuth());
app.route("/api/v1/profiles", profileRoutes);
app.route("/api/v1/scores", scoreRoutes);
app.route("/api/v1/branches", branchRoutes);
app.route("/api/v1/curriculum", curriculumRoutes);
app.route("/api/v1/ai-mod", aiModRoutes);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  // eslint-disable-next-line no-console
  console.error("[ludellus-server]", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`[ludellus-server] listening on http://localhost:${info.port}`);
});
