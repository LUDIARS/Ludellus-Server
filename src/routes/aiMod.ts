import { Hono } from "hono";
import { z } from "zod";

export const aiModRoutes = new Hono<{ Variables: { userId: string } }>();

// Phase 1: ルールベース (クライアント renderer/lib/branches.js が直接行う)。
// Phase 3: free モードのみ Claude API proxy。 ANTHROPIC_API_KEY 未設定なら 501。
//
// API キーは sever 側 env のみで保持する。 クライアントには絶対渡さない (子供向けアプリのため
// rate limit 攻撃や悪意ある利用を最小化する)。
// 関連: [[project-personal-data-rule]]、 [[feedback_secret_per_user_memory_only]]

const reqSchema = z.object({
  baseGameId: z.string(),
  mode: z.string(),
  currentPayload: z.record(z.any()).optional(),
  intent: z.enum(["easier", "harder", "kanji-mix", "free"]).optional(),
  freePrompt: z.string().max(280).optional(),
});

aiModRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = reqSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "bad_request", details: parsed.error.flatten() }, 400);

  const { intent, baseGameId, mode, currentPayload, freePrompt } = parsed.data;

  if (intent !== "free") {
    return c.json({
      kind: "rule",
      intent: intent ?? "easier",
      message: "クライアント側 renderer/lib/branches.js の applyRule() を使ってください。",
    });
  }

  // free モード: Claude API へ proxy
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({
      error: "not_configured",
      message: "ANTHROPIC_API_KEY が未設定です。 admin に確認してください。",
    }, 501);
  }

  if (!freePrompt || freePrompt.trim().length === 0) {
    return c.json({ error: "bad_request", reason: "freePrompt_required" }, 400);
  }

  try {
    const result = await callClaude(apiKey, {
      baseGameId, mode, currentPayload: currentPayload ?? {}, freePrompt,
    });
    return c.json({ kind: "api", payload: result.payload, explanation: result.explanation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return c.json({ error: "claude_failed", message }, 502);
  }
});

interface ClaudeRequest {
  baseGameId: string;
  mode: string;
  currentPayload: Record<string, unknown>;
  freePrompt: string;
}

interface ClaudeResult {
  payload: Record<string, unknown>;
  explanation: string;
}

async function callClaude(apiKey: string, req: ClaudeRequest): Promise<ClaudeResult> {
  // Claude API 直 fetch。 公式 SDK は使わず、 軽量 fetch で 1 ターンだけ。
  // System prompt は学習指導要領 + 子供向け制約を明示する。
  const systemPrompt = `あなたは子供向け教育ゲーム Ludellus の AI 改修担当です。
ベースゲーム: ${req.baseGameId} (モード: ${req.mode})。
現在のパラメータ: ${JSON.stringify(req.currentPayload)}。

子供のリクエスト「${req.freePrompt}」 を解釈し、 新しい payload を JSON で返してください。
制約:
- 小学 3 年生までの常用漢字・知識のみ
- 個人情報を含めない
- 出力は { "payload": <object>, "explanation": "<日本語>" } のみ`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: req.freePrompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const text = data.content.find(c => c.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Claude 応答のパース失敗");
  }
}
