# Ludellus Realtime World Gateway

Ludellus 教育プラットフォームの **MMO チャンネル型ワールド** のサーバ権威レイヤー。
既存の Hono REST (`src/index.ts`, port 5380) はステートレスのまま残し、
このゲートウェイは **別プロセスの長時間接続サーバ** として動く (既定 port 5381)。

## 役割

- 接続認証 (**自動ログイン**: 端末ひも付け child profile + Cernere トークン)
- World → Zone → Channel の階層管理 (容量シャーディング)
- AOI (Area of Interest) グリッドによる興味管理 = ゾーニング考慮の差分配信
- サーバ権威のゲームシミュレーション (移動検証 / 敵 AI / 戦闘 / ルートドロップ)
- チャット中継 (zone / proximity / party)
- **ユーザごとに変わる学習フィールド** (curriculum + branch から個人別 POI manifest を生成)

## 階層モデル

```
World
 └─ Zone (教科テーマ空間: 算数の島 / ことばの森 …)        ← 静的ゾーニング
     └─ Channel (Zone の容量シャード: ch1, ch2, …)        ← MMO チャンネル
         └─ AOI Grid (近傍セルのみ差分配信)               ← 興味管理
             └─ Entity (player / enemy / drop / poi / npc)
```

- **Zone**: 空間として固定の領域。教科・テーマで分かれる。
- **Channel**: 1 つの Zone の独立インスタンス。同時接続が `channelCapacity` を超えると新チャンネルを生成。
  フレンド/パーティは同チャンネルへ寄せる (`ChannelSwitchReq { partyWith }`)。
- **AOI Grid**: チャンネル内をセル分割し、観測者の近傍セルにいるエンティティの状態だけ送る。

## トランスポート (QUIC)

クライアントはネイティブアプリ (Ergo + Pictor) なのでブラウザ制約がなく、**QUIC を直接採用**。

- **データグラム (unreliable)**: 位置更新 (`MoveIntent` / `EntityStateBatch`) — コンパクト binary
- **信頼ストリーム (reliable, ordered)**: 制御 + イベント — 改行区切り JSON

`ITransport` 抽象でワールド・シミュレーションを transport 非依存にしている:

| 実装 | 用途 |
|---|---|
| `QuicTransport` | 本番 (Node QUIC / WebTransport over HTTP/3) |
| `LoopbackTransport` | テスト + ヘッドレス統合 (インメモリ、GPU/socket 不要) |

これによりワールドロジックと AOI/戦闘/ドロップは `vitest` で完全に end-to-end 検証できる
(`src/realtime/world/integration.test.ts`)。

## メッセージ (プロトコル)

正本は [`protocol/messages.ts`](./protocol/messages.ts) (制御 JSON) と
[`protocol/datagram.ts`](./protocol/datagram.ts) (binary)。

| 方向 | 種別 | ch | 概要 |
|---|---|---|---|
| C→S | `hello` | stream | 自動ログイン (token + childId + deviceId) |
| C→S | `MoveIntent` | datagram | seq + 位置 + 速度 + facing |
| C→S | `zoneEnter` | stream | Zone 入場要求 |
| C→S | `channelSwitch` | stream | チャンネル切替 (auto / index / partyWith) |
| C→S | `attack` | stream | 攻撃要求 (target + skill) |
| C→S | `lootPickup` | stream | ドロップ拾得 |
| C→S | `chat` | stream | 発言 (zone / proximity / party) |
| C→S | `poiInteract` | stream | 学習 POI の開始/完了 |
| S→C | `welcome` | stream | 自分の entityId + サーバ時刻 + world 設定 |
| S→C | `channelAssign` | stream | zone/channel 割当 + spawn 座標 |
| S→C | `spawn` / `despawn` | stream | AOI に入った/出たエンティティ |
| S→C | `EntityStateBatch` | datagram | AOI 内エンティティの位置/HP 差分 |
| S→C | `combat` | stream | ダメージイベント |
| S→C | `death` | stream | 撃破 |
| S→C | `lootDrop` | stream | ドロップ発生 |
| S→C | `inventory` | stream | インベントリ更新 |
| S→C | `chat` | stream | チャット配信 |
| S→C | `fieldManifest` | stream | 個人別学習 POI レイアウト |
| S→C | `poiState` | stream | POI の状態 (参加者 / 進捗) |

## ティック

ワールドは固定ステップ (既定 20Hz) で進む。各チャンネルが自分のエンティティを step し、
AOI でフィルタした `EntityStateBatch` を観測者ごとに送る。移動はサーバが速度上限で検証 (anti-cheat 最低限)。

## 学習フィールド (ユーザごとに変わる)

Zone 入場時、その子の進捗を REST 層 (curriculum + branches) から引き、
[`world/LearningField.ts`](./world/LearningField.ts) が **個人別 POI manifest** を生成する:

- `solo` POI … その子だけに見える/触れる単元コンテンツ (私的インスタンス)
- `shared` POI … チャンネル全員に同期される協力型コンテンツ (マルチプレイ可)

`shared` POI はチャンネルのエンティティとして全員に複製され、`solo` POI は対象プレイヤーにのみ送る。

## 個人データ方針

[[project_personal_data_rule]] 準拠。ゲートウェイは raw 入力を永続化しない。
永続が要る項目 (インベントリ / POI 進捗集計) は REST 層経由で Ludellus DB / Memoria に送る。

## 起動

```
npm run realtime        # tsx watch src/realtime/realtimeServer.ts (port 5381)
```
