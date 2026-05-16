import { Hono } from "hono";
import { z } from "zod";
import { ensureChildOwnership } from "../db/profiles.js";
import { listBranches, createBranch, applyRuleServer } from "../db/branches.js";

export const branchRoutes = new Hono<{ Variables: { userId: string } }>();

branchRoutes.get("/:childId", async (c) => {
  const userId = c.var.userId;
  const childId = c.req.param("childId");
  const owns = await ensureChildOwnership(userId, childId);
  if (!owns) return c.json({ error: "forbidden" }, 403);
  return c.json({ branches: await listBranches(childId) });
});

const createSchema = z.object({
  parentBranchId: z.string().nullable(),
  baseGameId: z.string().min(1).max(60),
  mode: z.string().min(1).max(30),
  ruleKey: z.string().min(1).max(60),
  payload: z.record(z.any()).optional(),
});

branchRoutes.post("/:childId", async (c) => {
  const userId = c.var.userId;
  const childId = c.req.param("childId");
  const owns = await ensureChildOwnership(userId, childId);
  if (!owns) return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "bad_request", details: parsed.error.flatten() }, 400);

  const branch = await applyRuleServer(childId, parsed.data);
  if (!branch) return c.json({ error: "bad_request", reason: "rule_or_parent_invalid" }, 400);
  return c.json({ branch }, 201);
});
