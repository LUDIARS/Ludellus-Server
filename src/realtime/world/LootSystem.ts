// ルートテーブルとドロップ抽選。 rng を注入できるので決定的にテストできる。

export interface LootEntry {
  itemId: string;
  qty: number;
  chance: number; // 0..1 で各エントリ独立判定
}

export interface LootTable {
  id: string;
  entries: LootEntry[];
}

export interface RolledDrop {
  itemId: string;
  qty: number;
}

export type Rng = () => number; // [0,1)

export class LootSystem {
  private readonly tables = new Map<string, LootTable>();

  constructor(tables: LootTable[] = DEFAULT_LOOT_TABLES) {
    for (const t of tables) this.tables.set(t.id, t);
  }

  has(tableId: string): boolean { return this.tables.has(tableId); }

  // 各エントリを chance で独立判定。 当たった分だけ返す。
  roll(tableId: string, rng: Rng): RolledDrop[] {
    const table = this.tables.get(tableId);
    if (!table) return [];
    const out: RolledDrop[] = [];
    for (const e of table.entries) {
      if (rng() < e.chance) out.push({ itemId: e.itemId, qty: e.qty });
    }
    return out;
  }
}

// 知育テーマのアイテム。 「ほし のかけら」 等を集めて図鑑/着せ替えに使う想定。
export const DEFAULT_LOOT_TABLES: LootTable[] = [
  {
    id: "slime_basic",
    entries: [
      { itemId: "star_shard", qty: 1, chance: 0.6 },
      { itemId: "ink_drop", qty: 1, chance: 0.3 },
      { itemId: "rainbow_scale", qty: 1, chance: 0.05 },
    ],
  },
  {
    id: "kotoba_bird",
    entries: [
      { itemId: "letter_feather", qty: 1, chance: 0.7 },
      { itemId: "story_page", qty: 1, chance: 0.2 },
    ],
  },
];
