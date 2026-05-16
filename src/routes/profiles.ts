import { Hono } from "hono";
import { z } from "zod";
import { listProfilesForUser, createProfile, getProfile } from "../db/profiles.js";

export const profileRoutes = new Hono<{ Variables: { userId: string } }>();

profileRoutes.get("/", async (c) => {
  const userId = c.var.userId;
  const profiles = await listProfilesForUser(userId);
  return c.json({ profiles });
});

const createSchema = z.object({
  displayName: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

profileRoutes.post("/", async (c) => {
  const userId = c.var.userId;
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "bad_request", details: parsed.error.flatten() }, 400);

  const profile = await createProfile(userId, parsed.data);
  return c.json({ profile }, 201);
});

profileRoutes.get("/:childId", async (c) => {
  const userId = c.var.userId;
  const childId = c.req.param("childId");
  const profile = await getProfile(userId, childId);
  if (!profile) return c.json({ error: "not_found" }, 404);
  return c.json({ profile });
});
