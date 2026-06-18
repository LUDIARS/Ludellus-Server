// ワールド内エンティティ。 すべて数値 entityId で識別。
// player / enemy / drop / poi の 4 種 (npc は将来)。

import type { EntityKind, PoiVisibility } from "../protocol/messages.js";

export interface BaseEntity {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
}

export interface PlayerEntity extends BaseEntity {
  kind: "player";
  childId: string;
  name: string;
  color: string;
  hp: number;
  maxHp: number;
  lastMoveSeq: number;
  // この player のセッション (送信先) は Channel が別管理。
}

export interface EnemyEntity extends BaseEntity {
  kind: "enemy";
  enemyType: string;
  hp: number;
  maxHp: number;
  damage: number;
  attackRange: number;
  aggroRange: number;
  speed: number;
  lootTableId: string;
  spawnX: number;
  spawnY: number;
  // 簡易 AI 状態
  targetPlayerId: number | null;
  // 撃破後の再湧き予定 (tick 数)。 0 = 生存。
  respawnInTicks: number;
}

export interface DropEntity extends BaseEntity {
  kind: "drop";
  dropId: number;
  itemId: string;
  qty: number;
  // 拾得されず放置されたら消える (tick 数)。
  ttlTicks: number;
}

export interface PoiEntity extends BaseEntity {
  kind: "poi";
  poiId: string;
  visibility: PoiVisibility;
  subject: string;
  contentRef: string;
  // solo POI の場合、 これに属する childId (その子だけに見える)。
  ownerChildId: string | null;
  state: "available" | "in_progress" | "completed";
  participants: Set<number>; // shared POI のマルチプレイ参加者 (entityId)
}

export type AnyEntity = PlayerEntity | EnemyEntity | DropEntity | PoiEntity;

// プロセス内で一意な entityId を払い出す。
export class EntityIdAllocator {
  private next = 1;
  alloc(): number { return this.next++; }
}
