// Zone (教科テーマ空間) の静的定義。 ワールドの「地図」。
// 各 Zone は教科に紐付き、 敵スポーン地点と学習コンテンツの候補を持つ。

export interface EnemySpawnDef {
  enemyType: string;
  count: number; // この Zone/Channel に常時いる目標数
  hp: number;
  damage: number;
  speed: number;
  attackRange: number;
  aggroRange: number;
  lootTableId: string;
}

export interface ZoneDef {
  id: string;
  label: string;
  subject: string; // curriculum の教科キー (math / kokugo ...)
  size: { w: number; h: number };
  spawn: { x: number; y: number }; // プレイヤーの初期スポーン
  channelCapacity: number; // 1 チャンネルの最大同時接続。 超えたら新チャンネル
  enemies: EnemySpawnDef[];
}

export const ZONE_DEFS: ZoneDef[] = [
  {
    id: "math_island",
    label: "算数の島",
    subject: "math",
    size: { w: 2000, h: 2000 },
    spawn: { x: 1000, y: 1000 },
    channelCapacity: 30,
    enemies: [
      {
        enemyType: "number_slime",
        count: 8,
        hp: 30,
        damage: 4,
        speed: 40,
        attackRange: 40,
        aggroRange: 220,
        lootTableId: "slime_basic",
      },
    ],
  },
  {
    id: "kotoba_forest",
    label: "ことばの森",
    subject: "japanese",
    size: { w: 2000, h: 2000 },
    spawn: { x: 1000, y: 1000 },
    channelCapacity: 30,
    enemies: [
      {
        enemyType: "letter_bird",
        count: 6,
        hp: 24,
        damage: 3,
        speed: 55,
        attackRange: 36,
        aggroRange: 260,
        lootTableId: "kotoba_bird",
      },
    ],
  },
];

export function getZoneDef(zoneId: string): ZoneDef | undefined {
  return ZONE_DEFS.find((z) => z.id === zoneId);
}
