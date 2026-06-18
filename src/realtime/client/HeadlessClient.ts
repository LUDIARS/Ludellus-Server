// ヘッドレス参照クライアント。 LoopbackTransport 経由でゲートウェイに繋ぎ、
// サーバから来るメッセージでローカルのワールドビューを構築する。
// 統合テストの駆動役 + ネイティブクライアント (C++) の状態モデルのリファレンス。

import type { LoopbackClientEndpoint } from "../transport/LoopbackTransport.js";
import {
  encodeControl, decodeControl, PROTOCOL_VERSION,
  type ServerMessage, type ChatScope, type FieldPoi, type InventoryItem,
} from "../protocol/messages.js";
import { encodeMoveIntent, decodeEntityStateBatch, peekDatagramKind, DatagramKind } from "../protocol/datagram.js";

export interface RemoteEntity {
  entityId: number;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  display?: Record<string, unknown>;
}

export interface ClientOpts {
  childId: string;
  deviceId: string;
  token: string;
  clientVersion?: string;
}

// マイクロタスクを掃けて loopback の同期コールバックを完了させる。
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class HeadlessClient {
  myEntityId = 0;
  childDisplay: { name: string; color: string } | null = null;
  channel: { zoneId: string; channelIndex: number; channelCount: number; spawn: { x: number; y: number } } | null = null;
  readonly entities = new Map<number, RemoteEntity>();
  readonly fieldPois: FieldPoi[] = [];
  inventory: InventoryItem[] = [];
  readonly chatLog: { fromName: string; scope: ChatScope; text: string }[] = [];
  readonly combatLog: { attackerId: number; targetId: number; damage: number; targetHpAfter: number }[] = [];
  readonly deaths: { entityId: number; killerId: number }[] = [];
  readonly drops: { dropId: number; x: number; y: number; itemId: string; qty: number }[] = [];
  readonly errors: { code: string; message: string }[] = [];
  poiStates = new Map<string, { state: string; participants: number[] }>();
  private moveSeq = 0;

  constructor(private readonly ep: LoopbackClientEndpoint, private readonly opts: ClientOpts) {
    ep.onReliable((line) => this.onControl(line));
    ep.onDatagram((buf) => this.onDatagram(buf));
  }

  // ===== 送信 =====
  hello(): void {
    this.ep.sendReliable(encodeControl({
      t: "hello", protocolVersion: PROTOCOL_VERSION,
      sessionToken: this.opts.token, childId: this.opts.childId,
      deviceId: this.opts.deviceId, clientVersion: this.opts.clientVersion ?? "test",
    }));
  }
  zoneEnter(zoneId: string): void { this.ep.sendReliable(encodeControl({ t: "zoneEnter", zoneId })); }
  channelSwitch(target: "auto" | number, partyWith?: string): void {
    this.ep.sendReliable(encodeControl({ t: "channelSwitch", target, partyWith }));
  }
  move(x: number, y: number, vx = 0, vy = 0, facing = 0): void {
    this.ep.sendDatagram(encodeMoveIntent({ seq: ++this.moveSeq, x, y, vx, vy, facing }));
  }
  attack(targetEntityId: number, skillId = "tentacle", x = 0, y = 0): void {
    this.ep.sendReliable(encodeControl({ t: "attack", seq: ++this.moveSeq, targetEntityId, skillId, x, y }));
  }
  pickup(dropId: number): void { this.ep.sendReliable(encodeControl({ t: "lootPickup", dropId })); }
  chat(scope: ChatScope, text: string): void { this.ep.sendReliable(encodeControl({ t: "chat", scope, text })); }
  poiInteract(poiId: string, action: "start" | "complete" | "leave", result?: { score: number; total: number; durationMs: number }): void {
    this.ep.sendReliable(encodeControl({ t: "poiInteract", poiId, action, result }));
  }
  ping(): void { this.ep.sendReliable(encodeControl({ t: "ping", clientTime: 0 })); }
  close(): void { this.ep.close(); }

  // 自エンティティの現在位置 (サーバ確定値)。
  get me(): RemoteEntity | undefined { return this.entities.get(this.myEntityId); }
  visibleOfKind(kind: string): RemoteEntity[] {
    return [...this.entities.values()].filter((e) => e.kind === kind);
  }

  // ===== 受信 =====
  private onControl(line: string): void {
    for (const raw of line.split("\n")) {
      const s = raw.trim();
      if (!s) continue;
      const msg = decodeControl<ServerMessage>(s);
      this.apply(msg);
    }
  }

  private apply(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.myEntityId = msg.yourEntityId;
        this.childDisplay = msg.childDisplay;
        break;
      case "channelAssign":
        this.channel = { zoneId: msg.zoneId, channelIndex: msg.channelIndex, channelCount: msg.channelCount, spawn: msg.spawn };
        break;
      case "spawn":
        this.entities.set(msg.entityId, {
          entityId: msg.entityId, kind: msg.kind, x: msg.x, y: msg.y, vx: 0, vy: 0, facing: 0,
          hp: msg.hp ?? 0, maxHp: msg.maxHp ?? 0, display: msg.display,
        });
        // drop は spawn 経由で dropId を確実に拾う (lootDrop イベントは best-effort)。
        if (msg.kind === "drop" && msg.display?.dropId != null) {
          const d = msg.display;
          if (!this.drops.some((x) => x.dropId === d.dropId)) {
            this.drops.push({ dropId: d.dropId as number, x: msg.x, y: msg.y, itemId: String(d.itemId), qty: Number(d.qty ?? 1) });
          }
        }
        break;
      case "despawn":
        this.entities.delete(msg.entityId);
        break;
      case "combat":
        this.combatLog.push({ attackerId: msg.attackerId, targetId: msg.targetId, damage: msg.damage, targetHpAfter: msg.targetHpAfter });
        { const e = this.entities.get(msg.targetId); if (e) e.hp = msg.targetHpAfter; }
        break;
      case "death":
        this.deaths.push({ entityId: msg.entityId, killerId: msg.killerId });
        break;
      case "lootDrop":
        this.drops.push({ dropId: msg.dropId, x: msg.x, y: msg.y, itemId: msg.itemId, qty: msg.qty });
        break;
      case "inventory":
        this.inventory = msg.items;
        break;
      case "chat":
        this.chatLog.push({ fromName: msg.fromName, scope: msg.scope, text: msg.text });
        break;
      case "fieldManifest":
        this.fieldPois.length = 0;
        this.fieldPois.push(...msg.pois);
        break;
      case "poiState":
        this.poiStates.set(msg.poiId, { state: msg.state, participants: msg.participants });
        break;
      case "error":
        this.errors.push({ code: msg.code, message: msg.message });
        break;
      case "lootPickupResult":
      case "pong":
        break;
    }
  }

  private onDatagram(buf: Uint8Array): void {
    if (peekDatagramKind(buf) !== DatagramKind.EntityStateBatch) return;
    for (const row of decodeEntityStateBatch(buf)) {
      const e = this.entities.get(row.entityId);
      if (e) {
        e.x = row.x; e.y = row.y; e.vx = row.vx; e.vy = row.vy; e.facing = row.facing;
        if (e.kind === "player" || e.kind === "enemy") e.hp = row.hp;
      }
    }
  }
}
