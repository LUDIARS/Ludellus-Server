// 制御 + イベントメッセージ (reliable stream)。 改行区切り JSON で送る。
// 判別は `t` フィールド。 位置ホットパスだけは datagram.ts の binary を使う。

// ===== エンティティ種別 =====
export type EntityKind = "player" | "enemy" | "drop" | "poi" | "npc";

// POI (学習コンテンツ) の可視性。
export type PoiVisibility = "solo" | "shared";

// チャットの届く範囲。
export type ChatScope = "zone" | "proximity" | "party";

// ===== Client → Server =====

export interface HelloMsg {
  t: "hello";
  protocolVersion: number;
  sessionToken: string; // Cernere PASETO (自動ログインで端末が保持)
  childId: string;
  deviceId: string;
  clientVersion: string;
}

export interface ZoneEnterMsg {
  t: "zoneEnter";
  zoneId: string;
}

export interface ChannelSwitchMsg {
  t: "channelSwitch";
  // "auto" = 空きチャンネルへ / number = 指定 index / partyWith = 同じチャンネルへ寄せたい相手の childId
  target: "auto" | number;
  partyWith?: string;
}

export interface AttackMsg {
  t: "attack";
  seq: number;
  targetEntityId: number;
  skillId: string;
  x: number;
  y: number;
}

export interface LootPickupMsg {
  t: "lootPickup";
  dropId: number;
}

export interface ChatSendMsg {
  t: "chat";
  scope: ChatScope;
  text: string;
}

export interface PoiInteractMsg {
  t: "poiInteract";
  poiId: string;
  action: "start" | "complete" | "leave";
  // complete 時の結果 (集計値のみ。 raw 入力は送らない)
  result?: { score: number; total: number; durationMs: number };
}

export interface PingMsg {
  t: "ping";
  clientTime: number;
}

export type ClientMessage =
  | HelloMsg
  | ZoneEnterMsg
  | ChannelSwitchMsg
  | AttackMsg
  | LootPickupMsg
  | ChatSendMsg
  | PoiInteractMsg
  | PingMsg;

// ===== Server → Client =====

export interface WelcomeMsg {
  t: "welcome";
  yourEntityId: number;
  serverTime: number;
  tickRateHz: number;
  childDisplay: { name: string; color: string }; // うに + 色
}

export interface ChannelAssignMsg {
  t: "channelAssign";
  zoneId: string;
  channelIndex: number;
  channelCount: number;
  spawn: { x: number; y: number };
}

export interface EntitySpawnMsg {
  t: "spawn";
  entityId: number;
  kind: EntityKind;
  x: number;
  y: number;
  // 表示メタ (種別ごとに使う分だけ入る)
  display?: {
    name?: string;
    color?: string;
    enemyType?: string;
    itemId?: string;
    qty?: number;
    dropId?: number;
    poiId?: string;
    poiVisibility?: PoiVisibility;
    subject?: string;
    contentRef?: string;
  };
  hp?: number;
  maxHp?: number;
}

export interface EntityDespawnMsg {
  t: "despawn";
  entityId: number;
  reason: "aoi" | "death" | "leave" | "pickup";
}

export interface CombatEventMsg {
  t: "combat";
  attackerId: number;
  targetId: number;
  damage: number;
  targetHpAfter: number;
  crit: boolean;
}

export interface EntityDeathMsg {
  t: "death";
  entityId: number;
  killerId: number;
}

export interface LootDropMsg {
  t: "lootDrop";
  dropId: number;
  x: number;
  y: number;
  itemId: string;
  qty: number;
}

export interface LootPickupResultMsg {
  t: "lootPickupResult";
  dropId: number;
  ok: boolean;
  reason?: string;
}

export interface InventoryItem {
  itemId: string;
  qty: number;
}

export interface InventoryUpdateMsg {
  t: "inventory";
  items: InventoryItem[];
}

export interface ChatMsg {
  t: "chat";
  fromEntityId: number;
  fromName: string;
  scope: ChatScope;
  text: string;
  serverTime: number;
}

export interface FieldPoi {
  poiId: string;
  visibility: PoiVisibility;
  subject: string;
  x: number;
  y: number;
  contentRef: string; // mockup id / curriculum unit へのポインタ
  state: "available" | "in_progress" | "completed";
}

export interface FieldManifestMsg {
  t: "fieldManifest";
  zoneId: string;
  pois: FieldPoi[];
}

export interface PoiStateMsg {
  t: "poiState";
  poiId: string;
  state: "available" | "in_progress" | "completed";
  participants: number[]; // entityId (shared POI のマルチプレイ参加者)
}

export interface PongMsg {
  t: "pong";
  clientTime: number;
  serverTime: number;
}

export interface ErrorMsg {
  t: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | WelcomeMsg
  | ChannelAssignMsg
  | EntitySpawnMsg
  | EntityDespawnMsg
  | CombatEventMsg
  | EntityDeathMsg
  | LootDropMsg
  | LootPickupResultMsg
  | InventoryUpdateMsg
  | ChatMsg
  | FieldManifestMsg
  | PoiStateMsg
  | PongMsg
  | ErrorMsg;

export const PROTOCOL_VERSION = 1;

// reliable stream の framing: 1 行 = 1 JSON メッセージ (改行区切り)。
export function encodeControl(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decodeControl<T = ClientMessage | ServerMessage>(line: string): T {
  return JSON.parse(line) as T;
}
