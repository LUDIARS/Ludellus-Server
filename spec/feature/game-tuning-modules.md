# ゲームチューニング・モジュール仕様 (server registry)

サーバ側 `src/games/registry.ts` が宣言する `GameModuleDef` の追加方針を定義する。
本書は **action / music**（および後続 shooting / defense）の `tuningSchema` ・
`subject` ・ `unitTags` の設計を仕様として確定するもの。**registry.ts への実装追加は
本書に従う別作業**であり、本書自体はコードを含まない (spec のみ)。

## 1. 位置づけ・アーキテクチャ (既存)

- **registry** (`src/games/registry.ts`): 各ゲームを `GameModuleDef` として宣言。
  client の native GameModule と `id` で対応 (`id` がワールド POI の `contentRef`)。
- **Tuner** (`src/games/Tuner.ts`): (子の進捗シグネチャ + intent + `tuningSchema`) から
  LLM またはルールでチューニング値を生成し、**必ず `validateTuning` でスキーマ検証して
  から採用**する。LLM 不可/不正時は rule → default に縮退する。
- **tuningSchema** (`src/games/tuningSchema.ts`): `ParamDef` は `int` / `number` /
  `bool` / `enum` の 4 種。`validateTuning` が未知 key 破棄・欠落 default・範囲外
  クランプ・型違反 default で「壊れた値でもゲームが必ず成立」を保証する。
- 個人データは持たない (`ProgressSignature` は単元到達度の集計値のみ)。LLM は
  `claude` (**API 不使用**)・opt-in。

現状 registry は `number_catch` (算数) のみ。Tier1 サーバ Tuner が各ゲームの
チューニング値を検証付きで返せるよう、ゲームを追加していく。

## 2. `GameModuleDef` の構造 (recap)

| フィールド | 意味 |
|---|---|
| `id` | client native module と対応する安定 id |
| `title` | 表示名 |
| `subject` | 教科。`gameModulesForSubject()` の絞り込みキー |
| `unitTags` | 学習指導要領の単元タグ。`gameModulesForUnit()` で POI → ゲーム選択に使う |
| `modes` / `players` | 対応モードと人数 |
| `tuningSchema` | LLM/ルールが埋めてよいパラメータの型契約 |
| `rules` | `TuneIntent` (easier/harder/kanji-mix/review/challenge) → 差分。LLM 不在/不正時のフォールバック兼、典型改修の確定処理 |

## 3. `subject` / `unitTags` の設計原則

ゲームは「教科の単元に紐づくもの」と「単元を持たないプリミティブ」に分かれる。

- **教科ゲーム** (例 `number_catch`): `subject="math"`、`unitTags` は学習指導要領の
  単元 (`math.g1.unit1.add` 等)。**学年 × 教科 × 単元**に紐づき、AI 改修は
  「学年範囲を逸脱しない / 未習単元を持ち込まない」制約を受ける。
- **action — 基本操作プリミティブ**: 基本操作 (狙う・押す・なぞる) の習熟が目的で、
  教科の単元に紐づかない。→ **`subject="operation"`、`unitTags=[]` (空)**。
  単元をそもそも持たないため「未習単元を持ち込まない」制約の対象外。
- **music — 学年非依存のリズムプリミティブ**: **リズムを取る行為そのものは
  学年非依存のプリミティブ**。よって base モジュールの `tuningSchema` ・ `unitTags`
  は**学年要素を持たない** (`subject="music"`、`unitTags=[]`)。拍子・音価・読譜などの
  **学年差は base の上に重ねるルール / ブランチ層で表現**し、base モジュールには
  載せない (base = リズム原器、graded variant は別レイヤ)。

## 4. action モジュール仕様

```
id:       "action"
title:    "きほんそうさ"
subject:  "operation"      // 教科ではない。基本操作プリミティブ
unitTags: []               // 単元なし
modes:    ["solo", "coop"]
players:  { min: 1, max: 4 }
```

### tuningSchema (params)

| key | type | 範囲 / 選択肢 | default | 意味 |
|---|---|---|---|---|
| `targetSize` | number | 0.5 .. 2.0 | 1.0 | 的の大きさ (大きいほど易) |
| `targetSpeed` | number | 0.3 .. 3.0 | 1.0 | 的の移動速度 (速いほど難) |
| `spawnInterval` | number | 0.4 .. 3.0 | 1.2 | 的の出現間隔(秒)。短いほど難 |
| `targetCount` | int | 5 .. 40 | 12 | クリアに必要な成功操作数 |
| `inputMode` | enum | `tap` / `drag` / `hold` | `tap` | 操作種別 |
| `distractors` | bool | — | false | 押してはいけない妨害的を混ぜるか |

### rules (TuneIntent → 差分)

- `easier`: `targetSize +0.3` / `targetSpeed -0.3` / `spawnInterval +0.4`
- `harder`: `targetSpeed +0.4` / `spawnInterval -0.3` / `targetSize -0.2`
- `review`: `spawnInterval +0.3` / `targetCount -3`
- `challenge`: `targetSpeed +0.6` / `distractors true`
- (`kanji-mix` は該当なし → 無指定)

## 5. music モジュール仕様

```
id:       "music"
title:    "リズム"
subject:  "music"
unitTags: []               // base は学年非依存。 学年差はルール層へ
modes:    ["solo", "coop", "versus"]
players:  { min: 1, max: 4 }
```

### tuningSchema (params) — リズムプリミティブ (学年非依存)

| key | type | 範囲 / 選択肢 | default | 意味 |
|---|---|---|---|---|
| `bpm` | int | 60 .. 180 | 100 | テンポ。速いほど難 |
| `noteDensity` | number | 0.5 .. 3.0 | 1.0 | 1 拍あたりのノーツ数 |
| `timingToleranceMs` | int | 60 .. 300 | 150 | 判定猶予(ms)。大きいほど易 |
| `laneCount` | int | 1 .. 4 | 2 | レーン数 |
| `targetCombo` | int | 4 .. 32 | 12 | 目標コンボ(連続成功数) |
| `assistMetronome` | bool | — | true | メトロノーム補助音 |

### rules (TuneIntent → 差分)

- `easier`: `bpm -10` / `timingToleranceMs +40` / `noteDensity -0.3`
- `harder`: `bpm +12` / `timingToleranceMs -30` / `noteDensity +0.4`
- `review`: `noteDensity -0.3` / `assistMetronome true`
- `challenge`: `bpm +16` / `laneCount +1` / `assistMetronome false`

### 学年要素のレイヤリング (base に載せない)

拍子 (2/4・3/4・4/4)・音価 (4 分・8 分・付点)・読譜・移調などの**学年依存の音楽要素**は、
base `music` モジュールの tuningSchema に持たせず、**base の上に重ねるルール / ブランチ**
として表現する (AI-MOD ボタンの段階生成や別 `GameModuleDef` 派生で対応)。これにより
リズム原器は全学年共通のまま、学年差を上位レイヤで差し込める。

## 6. 後続 — shooting / defense

「ゲームチェンジャー」(Ludellus #425-430) の shooting (キャラ2) / defense (キャラ4) も
同じ `GameModuleDef` パターンで後日追加する。本書の subject/unitTags 設計原則
(教科ゲーム vs プリミティブ) を踏襲し、ゲーム性が固まった時点で別途仕様化する。

## 7. 不変条件 (実装時に守る)

- 全 param は `validateTuning` でクランプ / 型検証してから採用 (壊れた値でもゲーム成立)。
- `tuningSchema.version` を変更したら Tuner の cache キーが変わる (`Tuner.cacheKey`)。
- LLM は opt-in、不可/不正時は rule → default に縮退。値を捏造しない (無言フォールバック禁止)。
- 個人データを持ち込まない (`ProgressSignature` は集計シグナルのみ)。

## 参照

- `src/games/registry.ts` (`GameModuleDef` / `number_catch` 既存例)
- `src/games/tuningSchema.ts` (`ParamDef` / `validateTuning` / `defaultValues`)
- `src/games/Tuner.ts` (LLM/ルール生成 + スキーマ検証 + キャッシュ)
- 学習指導要領 × 単元マップ正本: Ludellus `spec/manabi-no-tabibito.md` (教科ゲームの unitTags 源)
