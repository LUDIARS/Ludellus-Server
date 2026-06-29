// サーバ側 GameModule 定義レジストリ。 各ゲームは tuningSchema と ルール改修(intent→差分) を宣言する。
// クライアントの native GameModule と id で対応する (id がワールド POI の contentRef になる)。

import type { TuningSchema, TuningValues } from "./tuningSchema.js";
import { validateBehaviorSpec, type BehaviorSpec } from "./behaviorSchema.js";

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
  // Tier2 の既定挙動。 クライアント native の build_*_spec と対の wire 形式。 サーバ配布の正本で、
  // LLM/エディタが編集した候補は validateBehaviorSpec を通してからこれを差し替える。
  behaviorSpec?: BehaviorSpec;
}

// number_catch の既定 BehaviorSpec (native build_number_catch_spec と同じ有界文法・同じ wire 形式)。
// 勝敗とスポーンの挙動をデータで宣言する。 サーバはこれを配布し、 LLM/ライブ編集はこれを差し替える。
const NUMBER_CATCH_BEHAVIOR: BehaviorSpec = {
  initial_state: "playing",
  states: [
    {
      name: "playing",
      rules: [
        // 入室でスポーンタイマー開始 (spawn_interval 秒ごとに timer:spawn)。
        { event: "on_enter", actions: [
          { kind: "start_timer", key: "spawn", value: { a: { var: "spawn_interval" } } },
        ] },
        // スポーンタイマー満了: 数を 1 体 spawn して再スケジュール。
        { event: "timer:spawn", actions: [
          { kind: "spawn", key: "number", value: { a: { lit: 1 } } },
          { kind: "start_timer", key: "spawn", value: { a: { var: "spawn_interval" } } },
        ] },
        // 正解を掴んだ: score+1 → 勝利判定。
        { event: "caught_correct", actions: [
          { kind: "add_var", key: "score", value: { a: { lit: 1 } } },
          { kind: "play_sfx", key: "correct" },
          { kind: "emit", key: "check_win" },
        ] },
        // 間違いを掴んだ: life-1 → 敗北判定。
        { event: "caught_wrong", actions: [
          { kind: "add_var", key: "life", value: { a: { lit: -1 } } },
          { kind: "play_sfx", key: "wrong" },
          { kind: "emit", key: "check_lose" },
        ] },
        // 勝利判定: score >= target。
        { event: "check_win", conditions: [{ var: "score", op: "ge", rhs: { var: "target" } }],
          actions: [
            { kind: "play_sfx", key: "win" },
            { kind: "end_game", key: "win" },
            { kind: "goto", key: "won" },
          ] },
        // 敗北判定: life <= 0。
        { event: "check_lose", conditions: [{ var: "life", op: "le", rhs: { lit: 0 } }],
          actions: [
            { kind: "play_sfx", key: "lose" },
            { kind: "end_game", key: "lose" },
            { kind: "goto", key: "lost" },
          ] },
      ],
    },
    { name: "won", rules: [] },
    { name: "lost", rules: [] },
  ],
  // どの state でも入室時にスポーンを止める (終了 state でスポーン継続させない)。
  global_rules: [
    { event: "on_enter", actions: [{ kind: "cancel_timer", key: "spawn" }] },
  ],
};

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
  behaviorSpec: NUMBER_CATCH_BEHAVIOR,
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

// 配布用の既定 BehaviorSpec を、 配布前に必ず有界文法で検証して返す (validateTuning と同じ防御)。
// 正規化済み spec を返す。 spec 未定義/不正なら null + errors。 これがエディタ/LLM 編集の基準にもなる。
export function getGameBehaviorSpec(id: string): { spec: BehaviorSpec | null; errors: string[] } {
  const game = REGISTRY.get(id);
  if (!game) return { spec: null, errors: [`unknown game: ${id}`] };
  if (!game.behaviorSpec) return { spec: null, errors: [`no behaviorSpec for game: ${id}`] };
  return validateBehaviorSpec(game.behaviorSpec);
}
