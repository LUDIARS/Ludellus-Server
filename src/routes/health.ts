import { Hono } from "hono";

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) => c.json({
  ok: true,
  service: "ludellus-server",
  version: "0.0.1",
  ts: new Date().toISOString(),
}));
