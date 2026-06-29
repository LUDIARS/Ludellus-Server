// 1 つの Zone インスタンス (= MMO チャンネル) のサーバ権威シミュレーション。
// エンティティ保持・AOI 興味管理・敵 AI・戦闘・ドロップ・チャット・POI を 1 tick で進める。
//
// transport は知らない。 プレイヤーへの送信は PlayerSink 経由。

import type { ServerMessage, ChatScope, EntitySpawnMsg, FieldPoi } from "../protocol/messages.js";
import type { MoveIntent } from "../protocol/datagram.js";
import { encodeEntityStateBatch, type EntityStateRow } from "../protocol/datagram.js";
import { AoiGrid, type AoiConfig } from "./AoiGrid.js";
import {
  EntityIdAllocator,
  type AnyEntity, type PlayerEntity, type EnemyEntity, type DropEntity, type PoiEntity,
} from "./entities.js";
import { LootSystem, type Rng } from "./LootSystem.js";
import { getSkill } from "./skills.js";
import { dist, dist2, clampSpeed } from "./Vec2.js";
import type { ZoneDef } from "./zoneDefs.js";
import type { PlayerSink } from "./PlayerSink.js";

const PLAYER_MAX_SPEED = 220; // u/s
const PLAYER_MAX_HP = 50;
const PROXIMITY_RADIUS = 400;
const DROP_TTL_TICKS = 600; // 30s @20Hz
const ENEMY_RESPAWN_TICKS = 200; // 10s
const ENEMY_ATTACK_COOLDOWN_TICKS = 20; // 1s

const DEFAULT_AOI: AoiConfig = { cellSize: 256, viewRadiusCells: 2 };

interface PlayerSlot {
  entity: PlayerEntity;
  sink: PlayerSink;
  lastInterest: Set<number>;
  inventory: Map<string, number>;
}

export interface ChannelDeps {
  zone: ZoneDef;
  channelIndex: number;
  ids: EntityIdAllocator;
  loot: LootSystem;
  rng: Rng;
  tickRateHz: number;
  aoi?: AoiConfig;
  // 永続化フック (任意)。 REST 層 / Memoria への転送に使う。 raw 入力は渡さない。
  // subject = POI の教科 (math / kokugo …)。 Memoria 通知の教科タグに使う。
  onPoiResult?: (childId: string, poiId: string, result: { score: number; total: number; durationMs: number }, subject: string) => void;
  onInventoryChange?: (childId: string, items: { itemId: string; qty: number }[]) => void;
}

export class Channel {
  readonly zoneId: string;
  readonly channelIndex: number;
  private readonly dt: number;
  private readonly aoi: AoiGrid;
  private readonly viewRange: number;
  private readonly entities = new Map<number, AnyEntity>();
  private readonly players = new Map<number, PlayerSlot>();
  private readonly enemyAttackReady = new Map<number, number>();
  private readonly playerAttackReady = new Map<number, number>();
  private nextDropId = 1;
  private tickCount = 0;

  constructor(private readonly deps: ChannelDeps) {
    this.zoneId = deps.zone.id;
    this.channelIndex = deps.channelIndex;
    this.dt = 1 / deps.tickRateHz;
    const aoiCfg = deps.aoi ?? DEFAULT_AOI;
    this.aoi = new AoiGrid(aoiCfg);
    this.viewRange = aoiCfg.cellSize * (aoiCfg.viewRadiusCells + 0.5);
    this.spawnInitialEnemies();
  }

  get playerCount(): number { return this.players.size; }
  hasCapacity(): boolean { return this.players.size < this.deps.zone.channelCapacity; }

  // ===== プレイヤー出入り =====

  addPlayer(entity: PlayerEntity, sink: PlayerSink): void {
    this.entities.set(entity.id, entity);
    this.players.set(entity.id, { entity, sink, lastInterest: new Set(), inventory: new Map() });
    this.aoi.insert(entity.id, entity.x, entity.y);
  }

  removePlayer(entityId: number): void {
    const slot = this.players.get(entityId);
    if (!slot) return;
    // 周囲のプレイヤーに despawn を流す。
    this.broadcastInterested(entityId, { t: "despawn", entityId, reason: "leave" });
    this.aoi.remove(entityId);
    this.entities.delete(entityId);
    this.players.delete(entityId);
    this.playerAttackReady.delete(entityId);
    // 自分が観測していた相手の lastInterest は GC されるので放置で良い。
  }

  getPlayer(entityId: number): PlayerEntity | undefined {
    return this.players.get(entityId)?.entity;
  }

  // ===== 学習フィールド POI =====

  installFieldPois(forChildId: string, pois: FieldPoi[]): void {
    for (const p of pois) {
      const id = this.deps.ids.alloc();
      const poi: PoiEntity = {
        id, kind: "poi", x: p.x, y: p.y, vx: 0, vy: 0, facing: 0,
        poiId: p.poiId, visibility: p.visibility, subject: p.subject,
        contentRef: p.contentRef,
        ownerChildId: p.visibility === "solo" ? forChildId : null,
        state: p.state, participants: new Set(),
      };
      this.entities.set(id, poi);
      this.aoi.insert(id, poi.x, poi.y);
    }
  }

  // ===== 入力ハンドラ =====

  applyMove(entityId: number, intent: MoveIntent): void {
    const slot = this.players.get(entityId);
    if (!slot) return;
    const e = slot.entity;
    if (intent.seq <= e.lastMoveSeq) return; // 古い datagram は破棄
    e.lastMoveSeq = intent.seq;

    // anti-cheat 最低限: テレポート防止 + 速度上限。
    const maxStep = PLAYER_MAX_SPEED * this.dt * 3;
    const moved2 = dist2({ x: e.x, y: e.y }, { x: intent.x, y: intent.y });
    if (moved2 <= maxStep * maxStep) {
      e.x = clampWorld(intent.x, this.deps.zone.size.w);
      e.y = clampWorld(intent.y, this.deps.zone.size.h);
    } // 大ジャンプは拒否 (前回位置維持)
    const v = clampSpeed(intent.vx, intent.vy, PLAYER_MAX_SPEED);
    e.vx = v.vx; e.vy = v.vy;
    e.facing = intent.facing;
    this.aoi.update(entityId, e.x, e.y);
  }

  handleAttack(entityId: number, targetEntityId: number, skillId: string): void {
    const slot = this.players.get(entityId);
    if (!slot) return;
    const skill = getSkill(skillId);
    if (!skill) return;
    const ready = this.playerAttackReady.get(entityId) ?? 0;
    if (this.tickCount < ready) return; // クールダウン中
    const target = this.entities.get(targetEntityId);
    if (!target || target.kind !== "enemy") return;
    const attacker = slot.entity;
    if (dist({ x: attacker.x, y: attacker.y }, { x: target.x, y: target.y }) > skill.range) return;

    this.playerAttackReady.set(entityId, this.tickCount + skill.cooldownTicks);
    this.damageEnemy(target, skill.damage, entityId);
  }

  handleLootPickup(entityId: number, dropId: number): void {
    const slot = this.players.get(entityId);
    if (!slot) return;
    // dropId → drop entity を探す。
    let drop: DropEntity | undefined;
    for (const e of this.entities.values()) {
      if (e.kind === "drop" && e.dropId === dropId) { drop = e; break; }
    }
    if (!drop) {
      slot.sink.sendControl({ t: "lootPickupResult", dropId, ok: false, reason: "gone" });
      return;
    }
    if (dist({ x: slot.entity.x, y: slot.entity.y }, { x: drop.x, y: drop.y }) > 80) {
      slot.sink.sendControl({ t: "lootPickupResult", dropId, ok: false, reason: "too_far" });
      return;
    }
    // インベントリに加算。
    slot.inventory.set(drop.itemId, (slot.inventory.get(drop.itemId) ?? 0) + drop.qty);
    this.removeEntity(drop.id, "pickup");
    slot.sink.sendControl({ t: "lootPickupResult", dropId, ok: true });
    this.sendInventory(slot);
  }

  handleChat(entityId: number, scope: ChatScope, text: string): void {
    const slot = this.players.get(entityId);
    if (!slot) return;
    const clean = text.slice(0, 200);
    const msg: ServerMessage = {
      t: "chat", fromEntityId: entityId, fromName: slot.entity.name,
      scope, text: clean, serverTime: this.serverTime(),
    };
    if (scope === "proximity") {
      for (const p of this.players.values()) {
        if (dist2({ x: slot.entity.x, y: slot.entity.y }, { x: p.entity.x, y: p.entity.y }) <= PROXIMITY_RADIUS * PROXIMITY_RADIUS) {
          p.sink.sendControl(msg);
        }
      }
    } else {
      // zone / party (party はチャンネル単位にフォールバック)
      for (const p of this.players.values()) p.sink.sendControl(msg);
    }
  }

  handlePoiInteract(
    entityId: number, poiId: string, action: "start" | "complete" | "leave",
    result?: { score: number; total: number; durationMs: number },
  ): void {
    const slot = this.players.get(entityId);
    if (!slot) return;
    const poi = this.findPoi(poiId, slot.entity.childId);
    if (!poi) return;

    if (action === "start") {
      poi.participants.add(entityId);
      if (poi.state === "available") poi.state = "in_progress";
    } else if (action === "leave") {
      poi.participants.delete(entityId);
    } else if (action === "complete") {
      poi.participants.delete(entityId);
      if (poi.visibility === "solo") poi.state = "completed";
      if (result) this.deps.onPoiResult?.(slot.entity.childId, poiId, result, poi.subject);
    }
    const st: ServerMessage = { t: "poiState", poiId, state: poi.state, participants: [...poi.participants] };
    // 操作した本人には POI が遠くても必ず返す。 周囲の他プレイヤーには (shared の) 状態を配信。
    slot.sink.sendControl(st);
    this.broadcastInterested(poi.id, st, false, entityId);
  }

  // ===== tick =====

  tick(): void {
    this.tickCount++;
    this.stepEnemies();
    this.stepDrops();
    this.replicate();
  }

  private stepEnemies(): void {
    for (const e of this.entities.values()) {
      if (e.kind !== "enemy") continue;
      if (e.respawnInTicks > 0) {
        e.respawnInTicks--;
        if (e.respawnInTicks === 0) this.reviveEnemy(e);
        continue;
      }
      this.stepEnemyAi(e);
    }
  }

  private stepEnemyAi(e: EnemyEntity): void {
    // ターゲット維持/再取得。
    let target = e.targetPlayerId != null ? this.players.get(e.targetPlayerId)?.entity : undefined;
    if (!target || dist({ x: e.x, y: e.y }, { x: target.x, y: target.y }) > e.aggroRange * 1.5) {
      target = this.nearestPlayerWithin(e.x, e.y, e.aggroRange);
      e.targetPlayerId = target ? target.id : null;
    }
    if (!target) { e.vx = 0; e.vy = 0; return; }

    const d = dist({ x: e.x, y: e.y }, { x: target.x, y: target.y });
    if (d > e.attackRange) {
      // 接近。
      const k = e.speed / Math.max(d, 0.001);
      e.vx = (target.x - e.x) * k;
      e.vy = (target.y - e.y) * k;
      e.x += e.vx * this.dt;
      e.y += e.vy * this.dt;
      e.facing = Math.atan2(target.y - e.y, target.x - e.x);
      this.aoi.update(e.id, e.x, e.y);
    } else {
      e.vx = 0; e.vy = 0;
      const ready = this.enemyAttackReady.get(e.id) ?? 0;
      if (this.tickCount >= ready) {
        this.enemyAttackReady.set(e.id, this.tickCount + ENEMY_ATTACK_COOLDOWN_TICKS);
        this.damagePlayer(target.id, e.damage, e.id);
      }
    }
  }

  private stepDrops(): void {
    for (const e of this.entities.values()) {
      if (e.kind !== "drop") continue;
      e.ttlTicks--;
      if (e.ttlTicks <= 0) this.removeEntity(e.id, "pickup");
    }
  }

  // ===== 戦闘 =====

  private damageEnemy(enemy: EnemyEntity, amount: number, attackerId: number): void {
    enemy.hp = Math.max(0, enemy.hp - amount);
    this.broadcastInterested(enemy.id, {
      t: "combat", attackerId, targetId: enemy.id, damage: amount, targetHpAfter: enemy.hp, crit: false,
    });
    if (enemy.hp <= 0) this.killEnemy(enemy, attackerId);
  }

  private killEnemy(enemy: EnemyEntity, killerId: number): void {
    this.broadcastInterested(enemy.id, { t: "death", entityId: enemy.id, killerId });
    // ルート抽選 → ドロップ生成。
    const drops = this.deps.loot.roll(enemy.lootTableId, this.deps.rng);
    for (const d of drops) this.spawnDrop(enemy.x, enemy.y, d.itemId, d.qty);
    // 死体は AOI から外し、 再湧きをスケジュール。
    this.aoi.remove(enemy.id);
    enemy.respawnInTicks = ENEMY_RESPAWN_TICKS;
    enemy.targetPlayerId = null;
    enemy.vx = 0; enemy.vy = 0;
  }

  private reviveEnemy(enemy: EnemyEntity): void {
    enemy.hp = enemy.maxHp;
    enemy.x = enemy.spawnX; enemy.y = enemy.spawnY;
    this.aoi.insert(enemy.id, enemy.x, enemy.y);
  }

  private damagePlayer(playerId: number, amount: number, attackerId: number): void {
    const slot = this.players.get(playerId);
    if (!slot) return;
    const p = slot.entity;
    p.hp = Math.max(0, p.hp - amount);
    this.broadcastInterested(playerId, {
      t: "combat", attackerId, targetId: playerId, damage: amount, targetHpAfter: p.hp, crit: false,
    });
    if (p.hp <= 0) {
      // 知育向け: 撃破ではなく「きぜつ → スポーンへ戻る」。
      this.broadcastInterested(playerId, { t: "death", entityId: playerId, killerId: attackerId });
      p.hp = p.maxHp;
      p.x = this.deps.zone.spawn.x;
      p.y = this.deps.zone.spawn.y;
      this.aoi.update(playerId, p.x, p.y);
    }
  }

  // ===== ドロップ =====

  private spawnDrop(x: number, y: number, itemId: string, qty: number): void {
    const id = this.deps.ids.alloc();
    const dropId = this.nextDropId++;
    const drop: DropEntity = {
      id, kind: "drop", x, y, vx: 0, vy: 0, facing: 0,
      dropId, itemId, qty, ttlTicks: DROP_TTL_TICKS,
    };
    this.entities.set(id, drop);
    this.aoi.insert(id, x, y);
    this.broadcastInterested(id, { t: "lootDrop", dropId, x, y, itemId, qty });
  }

  // ===== レプリケーション (AOI 差分 + 状態 batch) =====

  private replicate(): void {
    for (const slot of this.players.values()) {
      const me = slot.entity;
      const interestNow = this.aoi.queryInterest(me.x, me.y);
      // solo POI は所有者以外には見せない。
      for (const id of interestNow) {
        const ent = this.entities.get(id);
        if (ent?.kind === "poi" && ent.visibility === "solo" && ent.ownerChildId !== me.childId) {
          interestNow.delete(id);
        }
      }
      // spawn 差分。
      for (const id of interestNow) {
        if (!slot.lastInterest.has(id)) {
          const ent = this.entities.get(id);
          if (ent) slot.sink.sendControl(this.toSpawn(ent));
        }
      }
      // despawn 差分。
      for (const id of slot.lastInterest) {
        if (!interestNow.has(id)) {
          slot.sink.sendControl({ t: "despawn", entityId: id, reason: "aoi" });
        }
      }
      slot.lastInterest = interestNow;
      // 位置/HP batch (datagram)。
      const rows: EntityStateRow[] = [];
      for (const id of interestNow) {
        const ent = this.entities.get(id);
        if (!ent) continue;
        rows.push({
          entityId: ent.id, x: ent.x, y: ent.y, vx: ent.vx, vy: ent.vy, facing: ent.facing,
          hp: hpOf(ent),
        });
      }
      slot.sink.sendDatagram(encodeEntityStateBatch(rows));
    }
  }

  // ===== ヘルパ =====

  private spawnInitialEnemies(): void {
    const z = this.deps.zone;
    for (const def of z.enemies) {
      for (let i = 0; i < def.count; i++) {
        const id = this.deps.ids.alloc();
        // スポーン地点を擬似乱数で散らす。
        const sx = 200 + this.deps.rng() * (z.size.w - 400);
        const sy = 200 + this.deps.rng() * (z.size.h - 400);
        const enemy: EnemyEntity = {
          id, kind: "enemy", x: sx, y: sy, vx: 0, vy: 0, facing: 0,
          enemyType: def.enemyType, hp: def.hp, maxHp: def.hp, damage: def.damage,
          attackRange: def.attackRange, aggroRange: def.aggroRange, speed: def.speed,
          lootTableId: def.lootTableId, spawnX: sx, spawnY: sy,
          targetPlayerId: null, respawnInTicks: 0,
        };
        this.entities.set(id, enemy);
        this.aoi.insert(id, sx, sy);
      }
    }
  }

  private nearestPlayerWithin(x: number, y: number, radius: number): PlayerEntity | undefined {
    let best: PlayerEntity | undefined;
    let bestD2 = radius * radius;
    for (const p of this.players.values()) {
      const d2 = dist2({ x, y }, { x: p.entity.x, y: p.entity.y });
      if (d2 <= bestD2) { bestD2 = d2; best = p.entity; }
    }
    return best;
  }

  private findPoi(poiId: string, viewerChildId: string): PoiEntity | undefined {
    for (const e of this.entities.values()) {
      if (e.kind !== "poi" || e.poiId !== poiId) continue;
      if (e.visibility === "solo" && e.ownerChildId !== viewerChildId) continue;
      return e;
    }
    return undefined;
  }

  private removeEntity(id: number, reason: "death" | "leave" | "pickup"): void {
    if (!this.entities.has(id)) return;
    this.broadcastInterested(id, { t: "despawn", entityId: id, reason });
    this.aoi.remove(id);
    this.entities.delete(id);
  }

  // あるエンティティ id を観測しうる全プレイヤーへ送る。
  // 興味集合は前 tick の値なので、 新規生成エンティティ (drop 等) には位置による視界判定もフォールバックに使う。
  // includeSelf=true なら、 そのエンティティが player の時に本人へも送る。
  private broadcastInterested(entityId: number, msg: ServerMessage, includeSelf = false, skipPlayerEntityId?: number): void {
    const ent = this.entities.get(entityId);
    for (const slot of this.players.values()) {
      if (skipPlayerEntityId != null && slot.entity.id === skipPlayerEntityId) continue;
      if (slot.entity.id === entityId) {
        if (includeSelf) slot.sink.sendControl(msg);
        continue;
      }
      const visible = slot.lastInterest.has(entityId)
        || (ent != null && dist2({ x: slot.entity.x, y: slot.entity.y }, { x: ent.x, y: ent.y }) <= this.viewRange * this.viewRange);
      if (visible) slot.sink.sendControl(msg);
    }
  }

  private sendInventory(slot: PlayerSlot): void {
    const items = [...slot.inventory.entries()].map(([itemId, qty]) => ({ itemId, qty }));
    slot.sink.sendControl({ t: "inventory", items });
    this.deps.onInventoryChange?.(slot.entity.childId, items);
  }

  private toSpawn(e: AnyEntity): EntitySpawnMsg {
    const base = { t: "spawn" as const, entityId: e.id, x: e.x, y: e.y };
    switch (e.kind) {
      case "player":
        return { ...base, kind: "player", display: { name: e.name, color: e.color }, hp: e.hp, maxHp: e.maxHp };
      case "enemy":
        return { ...base, kind: "enemy", display: { enemyType: e.enemyType }, hp: e.hp, maxHp: e.maxHp };
      case "drop":
        return { ...base, kind: "drop", display: { itemId: e.itemId, qty: e.qty, dropId: e.dropId } };
      case "poi":
        return {
          ...base, kind: "poi",
          display: { poiId: e.poiId, poiVisibility: e.visibility, subject: e.subject, contentRef: e.contentRef },
        };
      default:
        return { ...base, kind: "npc" };
    }
  }

  private serverTime(): number {
    return this.tickCount * this.dt * 1000;
  }
}

function clampWorld(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

function hpOf(e: AnyEntity): number {
  return e.kind === "player" || e.kind === "enemy" ? e.hp : 0;
}
