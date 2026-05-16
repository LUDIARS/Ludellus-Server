import type { MiddlewareHandler } from "hono";

// Cernere PASETO 検証 middleware。 Phase 1 は skeleton:
// - Authorization: Bearer <paseto> から token を取り出す
// - 起動時に Cernere /.well-known/paseto.jwk から公開鍵 fetch (将来)
// - 現状は payload 簡易デコードだけして sub を c.set("userId", sub) に置く
//
// 本番は paseto-ts などで PASETO v4.public 検証を行い、
// aud (= LUDELLUS_PASETO_AUDIENCE) / exp / iss も検査する。
// 関連: [[feedback_cernere_auth_only_endpoints]]

export function cernereAuth(): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return c.json({ error: "unauthorized", reason: "missing_bearer" }, 401);

    const token = m[1];

    // Phase 1 skeleton: トークンを 「.」 で 3 つに分割し、 真ん中 (payload) を Base64URL デコード
    // して JSON にする (PASETO v4.public は header.payload.footer)。
    // 公開鍵検証は未実装 (Cernere 側エンドポイント整備後に追加)。
    const parts = token.split(".");
    if (parts.length < 3) return c.json({ error: "unauthorized", reason: "bad_token" }, 401);

    let payload: { sub?: string; aud?: string; exp?: string };
    try {
      const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
      const decoded = Buffer.from(padded, "base64").toString("utf-8");
      payload = JSON.parse(decoded);
    } catch {
      return c.json({ error: "unauthorized", reason: "decode_failed" }, 401);
    }

    if (!payload.sub) return c.json({ error: "unauthorized", reason: "no_sub" }, 401);

    const expectedAudience = process.env.CERNERE_PASETO_AUDIENCE ?? "ludellus";
    if (payload.aud && payload.aud !== expectedAudience) {
      return c.json({ error: "unauthorized", reason: "wrong_aud" }, 401);
    }

    c.set("userId", payload.sub);
    c.set("paseto", payload);
    await next();
  };
}
