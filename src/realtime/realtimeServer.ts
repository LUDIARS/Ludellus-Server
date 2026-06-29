// リアルタイムワールドゲートウェイの起動エントリ。
// World (curriculum 連動の学習フィールド) + QUIC transport + 自動ログイン認証 + Gateway を配線する。
//
//   npm run realtime
//
// QUIC を使うには TLS 証明書が要る (LUDELLUS_TLS_CERT / LUDELLUS_TLS_KEY)。
// 証明書が無ければ起動方法を案内して終了する (LoopbackTransport は外部接続を受けられないため)。

import { readFileSync } from "node:fs";
import { World } from "./world/World.js";
import { RealtimeGateway } from "./gateway/RealtimeGateway.js";
import { AutoLoginAuth } from "./session/Auth.js";
import { QuicTransport } from "./transport/QuicTransport.js";
import { CurriculumProgressSource } from "./world/CurriculumProgressSource.js";
import { PROTOCOL_VERSION } from "./protocol/messages.js";
import { notifyPoiResult } from "./poiResultNotify.js";

async function main(): Promise<void> {
  const port = Number(process.env.LUDELLUS_REALTIME_PORT ?? 5381);
  const certPath = process.env.LUDELLUS_TLS_CERT;
  const keyPath = process.env.LUDELLUS_TLS_KEY;

  if (!certPath || !keyPath) {
    console.error(
      "[ludellus-realtime] TLS 証明書が未設定です。\n" +
      "  LUDELLUS_TLS_CERT / LUDELLUS_TLS_KEY に証明書パスを設定してください。\n" +
      "  開発用の自己署名証明書例:\n" +
      "    openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj \"/CN=localhost\"\n" +
      "  ネイティブクライアントは証明書を pin して接続します。",
    );
    process.exitCode = 1;
    return;
  }

  const world = new World({
    tickRateHz: Number(process.env.LUDELLUS_TICK_HZ ?? 20),
    progress: new CurriculumProgressSource(),
    onPoiResult: (childId, poiId, result, subject) => {
      // 学習結果は集計値のみ。 Memoria/サーバへ通知 (win/lose・教科)。 失敗してもサーバは落とさない。
      console.log(`[ludellus-realtime] poi result child=${childId} poi=${poiId} subject=${subject} score=${result.score}/${result.total}`);
      notifyPoiResult({ childId, poiId, subject, result }).catch((err) =>
        console.warn("[ludellus-realtime] memoria notify failed:", err?.message ?? err));
    },
  });

  const auth = new AutoLoginAuth({
    protocolVersion: PROTOCOL_VERSION,
    // TODO: Cernere PASETO 公開鍵での実検証を verifyToken に配線する (cernereAuth と共有)。
  });

  const transport = new QuicTransport({
    port,
    cert: readFileSync(certPath),
    privKey: readFileSync(keyPath),
  });

  const gateway = new RealtimeGateway({ world, transport, auth });
  await gateway.start();
  console.log(`[ludellus-realtime] QUIC world gateway listening on :${port} (path /ludellus, ${world.tickRateHz}Hz)`);

  const shutdown = () => { gateway.stop().finally(() => process.exit(0)); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[ludellus-realtime] fatal", e);
  process.exit(1);
});
