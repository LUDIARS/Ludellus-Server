// サーバ側 GameModule 定義レジストリ。 各ゲームは tuningSchema と ルール改修(intent→差分) を宣言する。
// クライアントの native GameModule と id で対応する (id がワールド POI の contentRef になる)。

import type { TuningSchema, TuningValues } from "./tuningSchema.js";

export type TuneIntent = "easier" | "harder" | "kanji-mix" | "review" | "challenge";

export interface GameModuleDef {
  id: string;
  title: string;
  subject: string;
  unitTags: string[];
  modes: ("solo" | "coop" | "versus")[];
  players: { min: number; max: number };
  tuningSchema: TuningSchema;
  // ルールベース改修: 現在値 → 差分。 LLM 不在/不正時のフォールバック兼、 典型改修の確定処理。
  rules: Partial<Record<TuneIntent, (v: TuningValues) => Partial<TuningValues>>>;
}

// 数つかみ (算数): 落ちてくる数字を、 指定の操作 (たす/ひく/かぞえる) に合うものだけ掴む。
const NUMBER_CATCH: GameModuleDef = {
  id: "number_catch",
  title: "かずつかみ",
  subject: "math",
  unitTags: ["math.g1.unit1.add", "math.g1.unit2.sub", "math.g1.count"],
  modes: ["solo", "coop"],
  players: { min: 1, max: 4 },
  tuningSchema: {
    version: 1,
    params: [
      { key: "numberMin", type: "int", min: 0, max: 50, default: 1, label: "最小の数", describe: "出題する数の下限" },
      { key: "numberMax", type: "int", min: 1, max: 99, default: 9, label: "最大の数", describe: "出題する数の上限。 学年が上がるほど大きく" },
      { key: "spawnRate", type: "number", min: 0.3, max: 3.0, default: 1.0, label: "出現速度", describe: "1秒あたりの数の出現数。 速いほど難しい" },
      { key: "targetCount", type: "int", min: 3, max: 20, default: 8, label: "目標数", describe: "クリアに必要な正解数" },
      { key: "useKanjiNumerals", type: "bool", default: false, label: "漢数字", describe: "数字を漢数字(一二三)で表示するか" },
      { key: "operation", type: "enum", options: ["add", "sub", "count"], default: "count", label: "操作", describe: "たし算/ひき算/かぞえる のどれを練習するか" },
    ],
  },
  rules: {
    easier: (v) => ({
      numberMax: Math.max((v.numberMin as number) + 1, (v.numberMax as number) - 3),
      spawnRate: Math.max(0.3, (v.spawnRate as number) - 0.3),
    }),
    harder: (v) => ({
      numberMax: (v.numberMax as number) + 5,
      spawnRate: (v.spawnRate as number) + 0.4,
    }),
    "kanji-mix": () => ({ useKanjiNumerals: true }),
    review: (v) => ({ spawnRate: Math.max(0.3, (v.spawnRate as number) - 0.2), targetCount: Math.max(3, (v.targetCount as number) - 2) }),
    challenge: (v) => ({ spawnRate: (v.spawnRate as number) + 0.6, numberMax: (v.numberMax as number) + 10 }),
  },
};

const REGISTRY = new Map<string, GameModuleDef>([
  [NUMBER_CATCH.id, NUMBER_CATCH],
]);

export function getGameModule(id: string): GameModuleDef | undefined {
  return REGISTRY.get(id);
}

export function gameModulesForSubject(subject: string): GameModuleDef[] {
  return [...REGISTRY.values()].filter((g) => g.subject === subject);
}

// 単元に紐づくゲームを返す (学習フィールドの POI → ゲーム選択に使う)。
export function gameModulesForUnit(unitId: string): GameModuleDef[] {
  return [...REGISTRY.values()].filter((g) => g.unitTags.includes(unitId));
}

export function allGameModules(): GameModuleDef[] {
  return [...REGISTRY.values()];
}
