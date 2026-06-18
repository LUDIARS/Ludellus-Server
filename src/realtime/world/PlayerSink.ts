// Channel が個々のプレイヤーへ送るための出力口。 transport を直接知らせないための抽象。
// gateway がセッションごとに実装を渡す。

import type { ServerMessage } from "../protocol/messages.js";

export interface PlayerSink {
  readonly entityId: number;
  readonly childId: string;
  sendControl(msg: ServerMessage): void;
  sendDatagram(buf: Uint8Array): void;
}
