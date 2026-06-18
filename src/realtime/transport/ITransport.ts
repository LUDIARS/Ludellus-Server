// トランスポート抽象。 ワールド・シミュレーションを QUIC/loopback から分離する。
// reliable stream (制御 JSON) と unreliable datagram (位置 binary) の 2 経路を持つ。

export interface TransportConnection {
  readonly id: string;
  // 接続元の生メタ (認証前。 hello で childId/token を受け取る)
  readonly remoteInfo: { address?: string };

  // reliable: 制御 + イベント (順序保証)
  sendReliable(line: string): void;
  // unreliable: 位置ホットパス (順序/到達保証なし)
  sendDatagram(buf: Uint8Array): void;

  onReliable(cb: (line: string) => void): void;
  onDatagram(cb: (buf: Uint8Array) => void): void;
  onClose(cb: (reason: string) => void): void;

  close(reason?: string): void;
}

export interface ITransport {
  // 新規接続を受けたら cb を呼ぶ。
  onConnection(cb: (conn: TransportConnection) => void): void;
  // listen 開始。
  start(): Promise<void>;
  // shutdown。
  stop(): Promise<void>;
}
