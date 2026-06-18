// 本番トランスポート: WebTransport (HTTP/3 = QUIC) サーバ。
// 1 WebTransport セッション = 1 接続。
//   - reliable stream: サーバ起点の双方向ストリーム 1 本を制御 JSON (改行区切り) に使う
//   - datagram: session.datagrams を位置ホットパス (binary) に使う
//
// ネイティブクライアント (Ergo+Pictor / C++) は WebTransport 対応 QUIC クライアント
// (msquic + HTTP/3、 または quiche) で同じ ALPN に接続する。
//
// 依存 (`@fails-components/webtransport`) は **動的 import**。 未導入でも build / test (loopback) は通る。
// 実起動には: npm i @fails-components/webtransport と TLS 証明書が要る。

import type { ITransport, TransportConnection } from "./ITransport.js";

export interface QuicOptions {
  port: number;
  host?: string;
  // TLS。 開発は自己署名でよい (ネイティブクライアントは pin で受ける)。
  cert: Buffer | string;
  privKey: Buffer | string;
}

type Cb<T> = (arg: T) => void;
const NL = 0x0a;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

// WebTransport セッションを TransportConnection へ適合させる。
class QuicConnection implements TransportConnection {
  readonly remoteInfo: { address?: string };
  private reliableCbs: Cb<string>[] = [];
  private datagramCbs: Cb<Uint8Array>[] = [];
  private closeCbs: Cb<string>[] = [];
  private reliableWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private datagramWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private recvBuf: Uint8Array = new Uint8Array(0);

  constructor(readonly id: string, private readonly session: any, address?: string) {
    this.remoteInfo = { address };
    this.pump().catch(() => this.fireClose("pump_error"));
  }

  sendReliable(line: string): void {
    this.reliableWriter?.write(encoder.encode(line.endsWith("\n") ? line : line + "\n")).catch(() => {});
  }
  sendDatagram(buf: Uint8Array): void {
    this.datagramWriter?.write(buf).catch(() => {});
  }
  onReliable(cb: Cb<string>): void { this.reliableCbs.push(cb); }
  onDatagram(cb: Cb<Uint8Array>): void { this.datagramCbs.push(cb); }
  onClose(cb: Cb<string>): void { this.closeCbs.push(cb); }
  close(reason = "server_close"): void {
    try { this.session.close({ closeCode: 0, reason }); } catch { /* already closed */ }
    this.fireClose(reason);
  }

  // セッションの制御ストリーム + datagram を読み続ける。
  private async pump(): Promise<void> {
    await this.session.ready;
    this.datagramWriter = this.session.datagrams.writable.getWriter();
    this.readDatagrams().catch(() => {});

    // サーバ起点の双方向ストリームを 1 本開いて reliable チャネルにする。
    const stream = await this.session.createBidirectionalStream();
    this.reliableWriter = stream.writable.getWriter();
    this.readReliable(stream.readable.getReader()).catch(() => {});

    this.session.closed.then(() => this.fireClose("session_closed")).catch(() => this.fireClose("session_closed"));
  }

  private async readDatagrams(): Promise<void> {
    const reader = this.session.datagrams.readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) for (const cb of this.datagramCbs) cb(value as Uint8Array);
    }
  }

  private async readReliable(reader: any): Promise<void> {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      this.recvBuf = concat(this.recvBuf, value);
      let nl: number;
      while ((nl = this.recvBuf.indexOf(NL)) >= 0) {
        const line = decoder.decode(this.recvBuf.slice(0, nl));
        this.recvBuf = this.recvBuf.slice(nl + 1);
        for (const cb of this.reliableCbs) cb(line);
      }
    }
  }

  private fireClose(reason: string): void {
    const cbs = this.closeCbs;
    this.closeCbs = [];
    for (const cb of cbs) cb(reason);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
}

export class QuicTransport implements ITransport {
  private connCb: Cb<TransportConnection> | null = null;
  private server: any = null;
  private seq = 0;

  constructor(private readonly opts: QuicOptions) {}

  onConnection(cb: Cb<TransportConnection>): void { this.connCb = cb; }

  async start(): Promise<void> {
    let mod: any;
    // 非リテラル指定子にして tsc の静的解決を回避 (未導入でも build を通す)。
    const moduleSpec = "@fails-components/webtransport";
    try {
      mod = await import(/* @vite-ignore */ moduleSpec);
    } catch {
      throw new Error(
        "QuicTransport は @fails-components/webtransport が必要です。 `npm i @fails-components/webtransport` を実行するか、 開発では LoopbackTransport を使ってください。",
      );
    }
    const { Http3Server } = mod;
    this.server = new Http3Server({
      port: this.opts.port,
      host: this.opts.host ?? "0.0.0.0",
      secret: "ludellus-realtime",
      cert: this.opts.cert,
      privKey: this.opts.privKey,
    });
    this.server.startServer();
    this.acceptLoop().catch((e) => { throw e; });
  }

  async stop(): Promise<void> {
    try { await this.server?.stopServer(); } catch { /* noop */ }
  }

  private async acceptLoop(): Promise<void> {
    // "/ludellus" パスの WebTransport セッションを受ける。
    const sessionStream = this.server.sessionStream("/ludellus");
    const reader = sessionStream.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const session = value;
      const conn = new QuicConnection(`quic-${++this.seq}`, session);
      if (this.connCb) this.connCb(conn);
    }
  }
}
