import { Hono } from "hono";
import { z } from "zod";

export const aiModRoutes = new Hono<{ Variables: { userId: string } }>();

// Phase 1 では Claude API は呼ばない。 単に「ローカルルール案を返す」 用のエンドポイント。
// Phase 3 で実際に Anthropic SDK を呼んで自由度高い改修を返す予定 (docs/AI-MOD-BUTTON.md §4)。

const reqSchema = z.object({
  baseGameId: z.string(),
  mode: z.string(),
  currentPayload: z.record(z.any()).optional(),
  intent: z.enum(["easier", "harder", "kanji-mix", "free"]).optional(),
});

aiModRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "bad_request", details: parsed.error.flatten() }, 400);

  // 現状: クライアントが renderer/lib/branches.js の rule をそのまま使えば良いので、
  // サーバ側は確認だけ返す。 free モードは Phase 3 で Claude API へ proxy する。
  if (parsed.data.intent === "free") {
    return c.json({
      kind: "rule",
      message: "free モードは Phase 3 (Claude API 連携) で実装予定。 現状は easier / harder / kanji-mix のみ。",
    }, 501);
  }

  return c.json({
    kind: "rule",
    intent: parsed.data.intent ?? "easier",
    message: "クライアント側 renderer/lib/branches.js の applyRule() を使ってください。",
  });
});
