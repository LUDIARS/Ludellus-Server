// ワールド全体。 Zone レジストリ + 全チャンネルのティック駆動 + 学習フィールド生成。

import { Zone, type ChannelAssignment } from "./Zone.js";
import { Channel, type ChannelDeps } from "./Channel.js";
import { EntityIdAllocator, type PlayerEntity } from "./entities.js";
import { LootSystem, type Rng } from "./LootSystem.js";
import { LearningField, type LearningProgressSource } from "./LearningField.js";
import { ZONE_DEFS, type ZoneDef } from "./zoneDefs.js";
import type { AoiConfig } from "./AoiGrid.js";
import type { PlayerSink } from "./PlayerSink.js";

export interface WorldDeps {
  tickRateHz?: number;
  rng?: Rng;
  loot?: LootSystem;
  progress: LearningProgressSource;
  zones?: ZoneDef[];
  aoi?: AoiConfig;
  onPoiResult?: ChannelDeps["onPoiResult"];
  onInventoryChange?: ChannelDeps["onInventoryChange"];
}

export class World {
  readonly tickRateHz: number;
  private readonly ids = new EntityIdAllocator();
  private readonly loot: LootSystem;
  private readonly rng: Rng;
  private readonly zones = new Map<string, Zone>();
  private readonly field: LearningField;

  constructor(private readonly deps: WorldDeps) {
    this.tickRateHz = deps.tickRateHz ?? 20;
    this.loot = deps.loot ?? new LootSystem();
    this.rng = deps.rng ?? Math.random;
    this.field = new LearningField(deps.progress);
    for (const def of deps.zones ?? ZONE_DEFS) this.registerZone(def);
  }

  hasZone(zoneId: string): boolean { return this.zones.has(zoneId); }
  getZone(zoneId: string): Zone | undefined { return this.zones.get(zoneId); }
  // この World に登録された zone の def を返す (グローバル ZONE_DEFS ではなく)。
  zoneDef(zoneId: string): ZoneDef | undefined { return this.zones.get(zoneId)?.def; }

  newEntityId(): number { return this.ids.alloc(); }

  // プレイヤーを Zone のチャンネルへ配置 (容量に応じてシャード)。
  placePlayer(
    zoneId: string, entity: PlayerEntity, sink: PlayerSink,
    target: "auto" | number = "auto", preferChannelIndex?: number,
  ): ChannelAssignment | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;
    return zone.place(entity, sink, target, preferChannelIndex);
  }

  removePlayer(zoneId: string, channelIndex: number, entityId: number): void {
    this.zones.get(zoneId)?.remove(channelIndex, entityId);
  }

  // 個人別の学習フィールド POI をそのプレイヤーのチャンネルへ設置する。
  async installLearningField(zoneId: string, channel: Channel, childId: string): Promise<void> {
    const def = this.zoneDef(zoneId);
    if (!def) return;
    const manifest = await this.field.generate(childId, def);
    channel.installFieldPois(childId, manifest.pois);
  }

  async fieldManifest(zoneId: string, childId: string) {
    const def = this.zoneDef(zoneId);
    if (!def) return { pois: [] };
    return this.field.generate(childId, def);
  }

  // 全 Zone / Channel を 1 tick 進める。
  tick(): void {
    for (const zone of this.zones.values()) zone.tick();
  }

  private registerZone(def: ZoneDef): void {
    const zone = new Zone({
      zone: def,
      makeChannelDeps: (channelIndex): ChannelDeps => ({
        zone: def,
        channelIndex,
        ids: this.ids,
        loot: this.loot,
        rng: this.rng,
        tickRateHz: this.tickRateHz,
        aoi: this.deps.aoi,
        onPoiResult: this.deps.onPoiResult,
        onInventoryChange: this.deps.onInventoryChange,
      }),
    });
    this.zones.set(def.id, zone);
  }
}
