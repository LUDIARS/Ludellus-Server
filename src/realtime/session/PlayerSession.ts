// 1 接続 = 1 プレイヤーセッション。 transport と world を繋ぐ。
// reliable stream の行バッファ処理、 datagram の dispatch、 認証、 各ハンドラへの委譲。

import type { TransportConnection } from "../transport/ITransport.js";
import type { PlayerSink } from "../world/PlayerSink.js";
import type { PlayerEntity } from "../world/entities.js";
import type { Channel } from "../world/Channel.js";
import type { World } from "../world/World.js";
import type { Authenticator } from "./Auth.js";
import { AuthError } from "./Auth.js";
import {
  encodeControl, decodeControl, PROTOCOL_VERSION,
  type ClientMessage, type ServerMessage,
} from "../protocol/messages.js";
import { DatagramKind, decodeMoveIntent, peekDatagramKind } from "../protocol/datagram.js";

export interface SessionHost {
  readonly world: World;
  readonly auth: Authenticator;
  readonly tickRateHz: number;
  registerSession(session: PlayerSession): void;
  unregisterSession(session: PlayerSession): void;
  // partyWith の相手が今いるチャンネル index を返す (同一 zone)。
  resolvePartyChannel(zoneId: string, partyChildId: string): number | undefined;
}

type State = "connected" | "authed" | "in_world" | "closed";

export class PlayerSession implements PlayerSink {
  private state: State = "connected";
  private reliableBuf = "";
  private _entityId = 0;
  private _childId = "";
  private entity: PlayerEntity | null = null;
  private zoneId: string | null = null;
  private channelIndex = -1;
  private channel: Channel | null = null;

  constructor(
    private readonly conn: TransportConnection,
    private readonly host: SessionHost,
  ) {
    conn.onReliable((line) => this.onReliable(line));
    conn.onDatagram((buf) => this.onDatagram(buf));
    conn.onClose(() => this.cleanup("transport_closed"));
  }

  get entityId(): number { return this._entityId; }
  get childId(): string { return this._childId; }
  get currentZone(): string | null { return this.zoneId; }
  get currentChannelIndex(): number { return this.channelIndex; }

  // ===== PlayerSink =====
  sendControl(msg: ServerMessage): void {
    if (this.state === "closed") return;
    this.conn.sendReliable(encodeControl(msg));
  }
  sendDatagram(buf: Uint8Array): void {
    if (this.state === "closed") return;
    this.conn.sendDatagram(buf);
  }

  // ===== reliable 受信 (改行フレーミング) =====
  private onReliable(chunk: string): void {
    this.reliableBuf += chunk;
    let idx: number;
    while ((idx = this.reliableBuf.indexOf("\n")) >= 0) {
      const line = this.reliableBuf.slice(0, idx).trim();
      this.reliableBuf = this.reliableBuf.slice(idx + 1);
      if (line.length === 0) continue;
      let msg: ClientMessage;
      try { msg = decodeControl<ClientMessage>(line); }
      catch { this.error("bad_json", "malformed control message"); continue; }
      this.handleControl(msg).catch((e) => this.error("handler_error", String(e?.message ?? e)));
    }
  }

  private onDatagram(buf: Uint8Array): void {
    if (peekDatagramKind(buf) !== DatagramKind.MoveIntent) return;
    if (this.state !== "in_world" || !this.channel) return;
    try {
      const intent = decodeMoveIntent(buf);
      this.channel.applyMove(this._entityId, intent);
    } catch { /* 壊れた datagram は無視 */ }
  }

  // ===== 制御ハンドラ =====
  private async handleControl(msg: ClientMessage): Promise<void> {
    switch (msg.t) {
      case "hello": return this.onHello(msg);
      case "zoneEnter": return this.onZoneEnter(msg.zoneId);
      case "channelSwitch": return this.onChannelSwitch(msg.target, msg.partyWith);
      case "attack":
        this.channel?.handleAttack(this._entityId, msg.targetEntityId, msg.skillId); return;
      case "lootPickup":
        this.channel?.handleLootPickup(this._entityId, msg.dropId); return;
      case "chat":
        this.channel?.handleChat(this._entityId, msg.scope, msg.text); return;
      case "poiInteract":
        this.channel?.handlePoiInteract(this._entityId, msg.poiId, msg.action, msg.result); return;
      case "ping":
        this.sendControl({ t: "pong", clientTime: msg.clientTime, serverTime: this.serverTime() }); return;
    }
  }

  private async onHello(hello: import("../protocol/messages.js").HelloMsg): Promise<void> {
    if (this.state !== "connected") return;
    let identity;
    try { identity = await this.host.auth.authenticate(hello); }
    catch (e) {
      const code = e instanceof AuthError ? e.code : "auth_failed";
      this.error(code, e instanceof Error ? e.message : "auth failed");
      this.conn.close("auth_failed");
      return;
    }
    this._childId = identity.childId;
    this._entityId = this.host.world.newEntityId();
    this.entity = {
      id: this._entityId, kind: "player", x: 0, y: 0, vx: 0, vy: 0, facing: 0,
      childId: identity.childId, name: identity.name, color: identity.color,
      hp: 50, maxHp: 50, lastMoveSeq: 0,
    };
    this.state = "authed";
    this.host.registerSession(this);
    this.sendControl({
      t: "welcome", yourEntityId: this._entityId, serverTime: this.serverTime(),
      tickRateHz: this.host.tickRateHz, childDisplay: { name: identity.name, color: identity.color },
    });
  }

  private async onZoneEnter(zoneId: string): Promise<void> {
    if (this.state === "connected" || !this.entity) { this.error("not_authed", "hello first"); return; }
    if (!this.host.world.hasZone(zoneId)) { this.error("unknown_zone", zoneId); return; }
    this.leaveCurrentChannel();

    const def = this.host.world.zoneDef(zoneId)!;
    this.entity.x = def.spawn.x; this.entity.y = def.spawn.y;
    const assign = this.host.world.placePlayer(zoneId, this.entity, this, "auto");
    if (!assign) { this.error("place_failed", zoneId); return; }
    this.zoneId = zoneId;
    this.channel = assign.channel;
    this.channelIndex = assign.channelIndex;
    this.state = "in_world";

    this.sendControl({
      t: "channelAssign", zoneId, channelIndex: assign.channelIndex,
      channelCount: assign.channelCount, spawn: { x: def.spawn.x, y: def.spawn.y },
    });
    // 個人別学習フィールドを設置 + manifest を本人へ送る。
    await this.host.world.installLearningField(zoneId, assign.channel, this._childId);
    const manifest = await this.host.world.fieldManifest(zoneId, this._childId);
    this.sendControl({ t: "fieldManifest", zoneId, pois: manifest.pois });
  }

  private async onChannelSwitch(target: "auto" | number, partyWith?: string): Promise<void> {
    if (this.state !== "in_world" || !this.entity || !this.zoneId) { this.error("not_in_world", "enter a zone first"); return; }
    const zoneId = this.zoneId;
    this.leaveCurrentChannel();
    let prefer: number | undefined;
    if (partyWith) prefer = this.host.resolvePartyChannel(zoneId, partyWith);
    const def = this.host.world.zoneDef(zoneId)!;
    this.entity.x = def.spawn.x; this.entity.y = def.spawn.y;
    const assign = this.host.world.placePlayer(zoneId, this.entity, this, prefer != null ? prefer : target, prefer);
    if (!assign) { this.error("place_failed", zoneId); return; }
    this.channel = assign.channel;
    this.channelIndex = assign.channelIndex;
    this.state = "in_world";
    this.sendControl({
      t: "channelAssign", zoneId, channelIndex: assign.channelIndex,
      channelCount: assign.channelCount, spawn: { x: def.spawn.x, y: def.spawn.y },
    });
    await this.host.world.installLearningField(zoneId, assign.channel, this._childId);
    const manifest = await this.host.world.fieldManifest(zoneId, this._childId);
    this.sendControl({ t: "fieldManifest", zoneId, pois: manifest.pois });
  }

  private leaveCurrentChannel(): void {
    if (this.zoneId && this.channelIndex >= 0) {
      this.host.world.removePlayer(this.zoneId, this.channelIndex, this._entityId);
    }
    this.channel = null;
    this.channelIndex = -1;
  }

  private cleanup(_reason: string): void {
    if (this.state === "closed") return;
    this.leaveCurrentChannel();
    this.host.unregisterSession(this);
    this.state = "closed";
  }

  private error(code: string, message: string): void {
    this.sendControl({ t: "error", code, message });
  }

  private serverTime(): number {
    return Date.now();
  }
}
