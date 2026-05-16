# Ludellus-Server

[Ludellus](https://github.com/LUDIARS/Ludellus) (知育系教材アプリ) の中央 Web サーバ。
docs/SERVER.md (Ludellus 側) の 3 統合構成における自前サーバ部分。

## 役割

- 子供プロファイル管理 (親 Cernere アカウント配下)
- スコア sync (オフライン優先、 サーバ側 last-write-wins)
- 分岐ツリー (`renderer/lib/branches.js` の永続化先)
- AI 改修 proxy (Phase 1: ルール返却のみ / Phase 3: Claude API)
- Memoria への学習活動通知 (集計値のみ、 raw 入力なし)

## API (v0.0.1 scaffold)

| Method | Path | 内容 |
|---|---|---|
| GET | `/health` | サーバ生存確認 (auth 不要) |
| GET | `/api/v1/profiles` | 親の子供一覧 |
| POST | `/api/v1/profiles` | 子供プロファイル作成 |
| GET | `/api/v1/profiles/:childId` | 個別取得 |
| GET | `/api/v1/scores/:childId` | スコア一覧 |
| POST | `/api/v1/scores/:childId` | セッション結果記録 + Memoria 通知 |
| GET | `/api/v1/branches/:childId` | 分岐ツリー |
| POST | `/api/v1/branches/:childId` | 分岐生成リクエスト (rule 適用) |
| GET | `/api/v1/curriculum` | 学習指導要領マップ (静的) |
| POST | `/api/v1/ai-mod` | AI 改修案 (Phase 1: ルール案返却のみ) |

`/api/v1/*` は **Cernere PASETO** 認証必須 (Authorization: Bearer)。

## 動作

```
cp .env.example .env       # PORT / Postgres URL / Cernere URL を設定
npm install
npm run dev                # tsx watch (port 5380)
```

## 実装状況 (v0.0.1)

| 項目 | 状態 |
|---|---|
| Hono ルーティング | ✅ scaffold |
| Cernere PASETO middleware | ✅ paseto-ts で実検証、 公開鍵は env or `/.well-known/paseto.pub` fetch (失敗時 dev フォールバック) |
| Postgres | ✅ Drizzle スキーマ + client (PG URL あれば PG、 無ければ in-memory) |
| 子供プロファイル CRUD | ✅ PG/in-memory 切替対応 |
| スコア記録 | ✅ in-memory + last-write-wins (PG 化は Phase 3 で同等手順で対応可) |
| 分岐ツリー | ✅ in-memory + 3 ルール (easier / harder / kanji-mix) |
| 学習指導要領マップ | ✅ 静的データ (placeholder、 spec/manabi-no-tabibito.md と同期 TODO) |
| Memoria 通知 | ✅ fetch 実装 (env 未設定なら no-op) |
| Claude API proxy | ✅ free モードのみ、 `ANTHROPIC_API_KEY` 必須、 claude-haiku-4-5 で 1 ターン |
| テスト | ❌ vitest 依存のみ追加、 spec 未記載 |

## 次の TODO

- [ ] Cernere `/.well-known/paseto.jwk` から公開鍵 fetch + 検証
- [ ] Drizzle schema 定義 + Postgres migration (`src/schemas/profiles.sql` を Drizzle 化)
- [ ] vitest で auth + scores の最低限テスト
- [ ] Cloudflare Workers / Fly.io / Railway デプロイ設定
- [ ] OpenAPI スキーマ自動生成 (zod-to-openapi)
- [ ] Memoria 側に `/api/activities` エンドポイントが整い次第、 実通信確認

## 関連

- [LUDIARS/Ludellus](https://github.com/LUDIARS/Ludellus) — クライアント (Electron / PWA / Capacitor)
- [LUDIARS/Cernere](https://github.com/LUDIARS/Cernere) — 大人 auth (PASETO 発行元)
- [LUDIARS/Memoria](https://github.com/LUDIARS/Memoria) — 学習活動の集計先
- Ludellus 側 `docs/SERVER.md` — サーバアーキの大元設計
