// リアルタイムゲートウェイ。 transport の接続を受けてセッションを作り、
// 固定ステップでワールドを駆動する。 SessionHost を実装してセッションに world/party を供給。

import type { ITransport } from "../transport/ITransport.js";
import type { World } from "../world/World.js";
import type { Authenticator } from "../session/Auth.js";
import { PlayerSession, type SessionHost } from "../session/PlayerSession.js";

export interface GatewayOptions {
  world: World;
  transport: ITransport;
  auth: Authenticator;
}

export class RealtimeGateway implements SessionHost {
  readonly world: World;
  readonly auth: Authenticator;
  readonly tickRateHz: number;
  private readonly transport: ITransport;
  private readonly sessions = new Set<PlayerSession>();
  private readonly byChild = new Map<string, PlayerSession>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: GatewayOptions) {
    this.world = opts.world;
    this.auth = opts.auth;
    this.transport = opts.transport;
    this.tickRateHz = opts.world.tickRateHz;
    this.transport.onConnection((conn) => {
      // セッションは自分で onClose を購読し cleanup する。
      this.sessions.add(new PlayerSession(conn, this));
    });
  }

  registerSession(session: PlayerSession): void {
    this.sessions.add(session);
    if (session.childId) this.byChild.set(session.childId, session);
  }

  unregisterSession(session: PlayerSession): void {
    this.sessions.delete(session);
    if (session.childId && this.byChild.get(session.childId) === session) {
      this.byChild.delete(session.childId);
    }
  }

  resolvePartyChannel(zoneId: string, partyChildId: string): number | undefined {
    const other = this.byChild.get(partyChildId);
    if (other && other.currentZone === zoneId && other.currentChannelIndex >= 0) {
      return other.currentChannelIndex;
    }
    return undefined;
  }

  get sessionCount(): number { return this.sessions.size; }

  // ===== 駆動 =====

  async start(): Promise<void> {
    await this.transport.start();
    this.startTicking();
  }

  async stop(): Promise<void> {
    this.stopTicking();
    await this.transport.stop();
  }

  startTicking(): void {
    if (this.tickTimer) return;
    const intervalMs = 1000 / this.tickRateHz;
    this.tickTimer = setInterval(() => this.world.tick(), intervalMs);
  }

  stopTicking(): void {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  // テスト用: タイマーを使わず手動で 1 tick 進める。
  tickOnce(): void { this.world.tick(); }
}
