// 自動ログイン認証。 端末ひも付けの child profile + Cernere トークンを受けて
// プレイヤー identity を解決する。 実際の PASETO 検証は注入式 (REST 層の cernereAuth と共有可能)。

import type { HelloMsg } from "../protocol/messages.js";

export interface PlayerIdentity {
  childId: string;
  name: string;
  color: string;
}

export interface Authenticator {
  authenticate(hello: HelloMsg): Promise<PlayerIdentity>;
}

export class AuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// トークン検証の差し込み口。 本番は Cernere PASETO 公開鍵で検証する実装を渡す。
export type TokenVerifier = (token: string, childId: string) => Promise<boolean>;

// 子供向けプロファイルの既定表示色 (うに)。
const UNI_COLORS = ["#ff7a3a", "#ffb13a", "#3ab0ff", "#7a5cff", "#39c977"];

function colorForChild(childId: string): string {
  let h = 0;
  for (let i = 0; i < childId.length; i++) h = (h * 31 + childId.charCodeAt(i)) >>> 0;
  return UNI_COLORS[h % UNI_COLORS.length];
}

// 自動ログイン: トークンを verifier で検証 (省略時は dev で素通し)、 child 表示はプロファイルから。
export class AutoLoginAuth implements Authenticator {
  constructor(
    private readonly opts: {
      verifyToken?: TokenVerifier;
      // childId → 表示名。 省略時は「うに」 固定。
      resolveDisplayName?: (childId: string) => Promise<string | undefined>;
      protocolVersion: number;
    },
  ) {}

  async authenticate(hello: HelloMsg): Promise<PlayerIdentity> {
    if (hello.protocolVersion !== this.opts.protocolVersion) {
      throw new AuthError("protocol_mismatch", `protocol ${hello.protocolVersion} != ${this.opts.protocolVersion}`);
    }
    if (!hello.childId || !hello.deviceId) {
      throw new AuthError("bad_hello", "childId and deviceId required");
    }
    if (this.opts.verifyToken) {
      const ok = await this.opts.verifyToken(hello.sessionToken, hello.childId);
      if (!ok) throw new AuthError("auth_failed", "token rejected");
    }
    const name = (await this.opts.resolveDisplayName?.(hello.childId)) ?? "うに";
    return { childId: hello.childId, name, color: colorForChild(hello.childId) };
  }
}
