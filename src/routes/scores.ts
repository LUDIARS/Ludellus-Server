import { Hono } from "hono";
import { z } from "zod";
import { ensureChildOwnership } from "../db/profiles.js";
import { listScores, recordScore } from "../db/scores.js";
import { notifyMemoria } from "../db/memoria.js";

export const scoreRoutes = new Hono<{ Variables: { userId: string } }>();

scoreRoutes.get("/:childId", async (c) => {
  const userId = c.var.userId;
  const childId = c.req.param("childId");
  const owns = await ensureChildOwnership(userId, childId);
  if (!owns) return c.json({ error: "forbidden" }, 403);
  const scores = await listScores(childId);
  return c.json({ scores });
});

const recordSchema = z.object({
  gameId: z.string().min(1).max(60),
  mode: z.string().min(1).max(30),
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  unitTags: z.array(z.string()).optional(),
  durationMs: z.number().int().min(0).optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

scoreRoutes.post("/:childId", async (c) => {
  const userId = c.var.userId;
  const childId = c.req.param("childId");
  const owns = await ensureChildOwnership(userId, childId);
  if (!owns) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "bad_request", details: parsed.error.flatten() }, 400);

  const entry = await recordScore(childId, parsed.data);

  // Memoria に集計値だけ通知 (失敗は静かに log)
  notifyMemoria({
    userId,
    childId,
    kind: "ludellus.session",
    ...parsed.data,
  }).catch((err) => console.warn("[ludellus-server] memoria notify failed:", err.message));

  return c.json({ entry }, 201);
});
