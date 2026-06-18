// インメモリのループバック・トランスポート。 テスト + ヘッドレス統合用。
// socket も GPU も使わず、 サーバ側 conn とクライアント側 endpoint をメモリで繋ぐ。
//
// datagram は「unreliable」 を模すため任意で drop/遅延を注入できる (AOI/補間の堅牢性テスト用)。

import type { ITransport, TransportConnection } from "./ITransport.js";

type Cb<T> = (arg: T) => void;

// クライアントが掴むエンドポイント。 サーバ conn と背中合わせ。
export interface LoopbackClientEndpoint {
  readonly id: string;
  sendReliable(line: string): void;
  sendDatagram(buf: Uint8Array): void;
  onReliable(cb: Cb<string>): void;
  onDatagram(cb: Cb<Uint8Array>): void;
  onClose(cb: Cb<string>): void;
  close(reason?: string): void;
}

interface Channel {
  reliableTo: Cb<string>[];
  datagramTo: Cb<Uint8Array>[];
  closeTo: Cb<string>[];
}

export interface LoopbackOptions {
  // 0..1。 datagram をこの確率で捨てる (unreliable 模擬)。
  datagramDropRate?: number;
  // datagram drop 判定の決定的乱数 (テスト再現用)。 省略時は捨てない。
  rng?: () => number;
}

class LoopbackConn implements TransportConnection {
  readonly remoteInfo = { address: "loopback" };
  constructor(
    readonly id: string,
    private readonly serverInbox: Channel,
    private readonly clientInbox: Channel,
    private readonly opts: LoopbackOptions,
    private readonly onClosed: () => void,
  ) {}

  sendReliable(line: string): void { for (const cb of this.clientInbox.reliableTo) cb(line); }
  sendDatagram(buf: Uint8Array): void {
    if (this.shouldDrop()) return;
    for (const cb of this.clientInbox.datagramTo) cb(buf);
  }
  onReliable(cb: Cb<string>): void { this.serverInbox.reliableTo.push(cb); }
  onDatagram(cb: Cb<Uint8Array>): void { this.serverInbox.datagramTo.push(cb); }
  onClose(cb: Cb<string>): void { this.serverInbox.closeTo.push(cb); }
  close(reason = "server_close"): void {
    for (const cb of this.clientInbox.closeTo) cb(reason);
    this.onClosed();
  }
  private shouldDrop(): boolean {
    const rate = this.opts.datagramDropRate ?? 0;
    if (rate <= 0) return false;
    const r = this.opts.rng ? this.opts.rng() : 1;
    return r < rate;
  }
}

export class LoopbackTransport implements ITransport {
  private connCb: Cb<TransportConnection> | null = null;
  private seq = 0;
  private readonly active = new Set<string>();

  constructor(private readonly opts: LoopbackOptions = {}) {}

  onConnection(cb: Cb<TransportConnection>): void { this.connCb = cb; }
  async start(): Promise<void> { /* no-op */ }
  async stop(): Promise<void> { this.active.clear(); }

  // テスト/ヘッドレスクライアントが新しい接続を張る。
  connect(): LoopbackClientEndpoint {
    const id = `lb-${++this.seq}`;
    this.active.add(id);
    const serverInbox: Channel = { reliableTo: [], datagramTo: [], closeTo: [] };
    const clientInbox: Channel = { reliableTo: [], datagramTo: [], closeTo: [] };

    const conn = new LoopbackConn(id, serverInbox, clientInbox, this.opts, () => this.active.delete(id));
    // サーバ側へ接続を通知 (gateway がセッションを作る)。
    if (this.connCb) this.connCb(conn);

    // クライアント側エンドポイント (server inbox へ送り、 client inbox から受ける)。
    const endpoint: LoopbackClientEndpoint = {
      id,
      sendReliable: (line) => { for (const cb of serverInbox.reliableTo) cb(line); },
      sendDatagram: (buf) => {
        const rate = this.opts.datagramDropRate ?? 0;
        if (rate > 0 && (this.opts.rng ? this.opts.rng() : 1) < rate) return;
        for (const cb of serverInbox.datagramTo) cb(buf);
      },
      onReliable: (cb) => { clientInbox.reliableTo.push(cb); },
      onDatagram: (cb) => { clientInbox.datagramTo.push(cb); },
      onClose: (cb) => { clientInbox.closeTo.push(cb); },
      close: (reason = "client_close") => {
        for (const cb of serverInbox.closeTo) cb(reason);
        this.active.delete(id);
      },
    };
    return endpoint;
  }
}
