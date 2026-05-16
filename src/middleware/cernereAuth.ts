import type { MiddlewareHandler } from "hono";

// Cernere PASETO 検証 middleware。
// Phase 2: paseto-ts ライブラリで PASETO v4.public を実検証する。 公開鍵は CERNERE_PUBLIC_KEY (hex) か
// 起動時に CERNERE_BASE_URL/.well-known/paseto.pub から fetch する (どちらか一方)。
// 関連: [[feedback_cernere_auth_only_endpoints]]、 [[feedback_secret_per_user_memory_only]]

import { V4 } from "paseto-ts";

let cachedPublicKey: string | null = null;
let publicKeyFetchedAt = 0;
const KEY_TTL_MS = 60 * 60 * 1000; // 1 時間で再 fetch

async function getPublicKey(): Promise<string | null> {
  const fromEnv = process.env.CERNERE_PUBLIC_KEY;
  if (fromEnv) return fromEnv;

  const base = process.env.CERNERE_BASE_URL;
  if (!base) return null;

  const now = Date.now();
  if (cachedPublicKey && now - publicKeyFetchedAt < KEY_TTL_MS) return cachedPublicKey;

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/.well-known/paseto.pub`);
    if (!res.ok) return null;
    cachedPublicKey = (await res.text()).trim();
    publicKeyFetchedAt = now;
    return cachedPublicKey;
  } catch {
    return null;
  }
}

export function cernereAuth(): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) return c.json({ error: "unauthorized", reason: "missing_bearer" }, 401);

    const token = m[1];
    const publicKey = await getPublicKey();
    const expectedAudience = process.env.CERNERE_PASETO_AUDIENCE ?? "ludellus";

    if (!publicKey) {
      // 公開鍵が無い場合は **dev モード** とみなして payload を unsafe decode する。
      // 本番では必ず env に key を設定すること。 console に警告を出す。
      console.warn("[cernereAuth] WARNING: no public key set, running in unsafe decode mode");
      return unsafeDecodeFallback(c, token, expectedAudience, next);
    }

    try {
      const result = await V4.verify(token, publicKey, { audience: expectedAudience });
      const payload = result.payload as { sub?: string; exp?: string };
      if (!payload.sub) return c.json({ error: "unauthorized", reason: "no_sub" }, 401);
      c.set("userId", payload.sub);
      c.set("paseto", payload);
      await next();
    } catch (err) {
      const reason = err instanceof Error ? err.message : "verify_failed";
      return c.json({ error: "unauthorized", reason }, 401);
    }
  };
}

async function unsafeDecodeFallback(
  c: Parameters<MiddlewareHandler>[0],
  token: string,
  expectedAudience: string,
  next: Parameters<MiddlewareHandler>[1],
) {
  const parts = token.split(".");
  if (parts.length < 3) return c.json({ error: "unauthorized", reason: "bad_token" }, 401);
  try {
    const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "==".slice(0, (4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf-8")) as {
      sub?: string; aud?: string;
    };
    if (!payload.sub) return c.json({ error: "unauthorized", reason: "no_sub" }, 401);
    if (payload.aud && payload.aud !== expectedAudience) {
      return c.json({ error: "unauthorized", reason: "wrong_aud" }, 401);
    }
    c.set("userId", payload.sub);
    c.set("paseto", payload);
    await next();
  } catch {
    return c.json({ error: "unauthorized", reason: "decode_failed" }, 401);
  }
}
