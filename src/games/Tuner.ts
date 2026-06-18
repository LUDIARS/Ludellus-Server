// ゲームチューナー。 (子の進捗 + テレメトリ + tuningSchema) から、 LLM またはルールで
// チューニング値を生成し、 **必ずスキーマ検証してから** 採用する。 LLM 不可/不正時はルール → default に縮退。
// content-addressed キャッシュ + バックグラウンド事前計算前提 (プレイ開始をブロックしない)。

import type { GameModuleDef, TuneIntent } from "./registry.js";
import {
  validateTuning, defaultValues, describeSchemaForPrompt,
  type TuningValues,
} from "./tuningSchema.js";

// その子の単元到達度シグネチャ (集計値のみ。 個人データは持たない)。
export interface ProgressSignature {
  childId: string;
  // 単元 → 到達度 0..1。 キャッシュキーと LLM プロンプトに使う。
  mastery: Record<string, number>;
  // 直近のつまずき (単元タグ等)。 集計シグナルのみ。
  struggles?: string[];
}

export interface TuningResult {
  gameId: string;
  schemaVersion: number;
  values: TuningValues;
  source: "llm" | "rule" | "default";
  clamped: string[];
  rejected: string[];
}

// LLM 呼び出し境界。 本番は Claude、 テストは fake。 返値は「生の候補オブジェクト」 (未検証)。
export interface LlmTuningClient {
  propose(input: { systemPrompt: string; userPrompt: string }): Promise<Record<string, unknown>>;
}

export interface TuneCache {
  get(key: string): TuningResult | undefined;
  set(key: string, value: TuningResult): void;
}

export class MemoryTuneCache implements TuneCache {
  private readonly map = new Map<string, TuningResult>();
  get(key: string): TuningResult | undefined { return this.map.get(key); }
  set(key: string, value: TuningResult): void { this.map.set(key, value); }
}

const PROMPT_VERSION = 1;

export interface TuneOptions {
  game: GameModuleDef;
  progress: ProgressSignature;
  intent?: TuneIntent;
  // LLM を使うか。 未指定 (undefined) ならルール/ default のみ。
  llm?: LlmTuningClient;
  // LLM 候補のうち rejected がこの比率を超えたら信用せずフォールバック。
  maxRejectRatio?: number;
}

export class Tuner {
  constructor(private readonly cache: TuneCache = new MemoryTuneCache()) {}

  cacheKey(opts: TuneOptions): string {
    const sig = stableSignature(opts.progress.mastery);
    return `${opts.game.id}|v${opts.game.tuningSchema.version}|${sig}|${opts.intent ?? ""}|${opts.llm ? "llm" : "rule"}|p${PROMPT_VERSION}`;
  }

  async tune(opts: TuneOptions): Promise<TuningResult> {
    const key = this.cacheKey(opts);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const result = await this.compute(opts);
    this.cache.set(key, result);
    return result;
  }

  private async compute(opts: TuneOptions): Promise<TuningResult> {
    const schema = opts.game.tuningSchema;

    // ルール適用後の基準値 (LLM フォールバック先 + LLM への提示文脈)。
    const ruleBase = this.applyRule(opts);

    if (opts.llm) {
      try {
        const raw = await opts.llm.propose({
          systemPrompt: this.systemPrompt(opts.game),
          userPrompt: this.userPrompt(opts, ruleBase),
        });
        const v = validateTuning(schema, raw);
        const rejectRatio = v.rejected.length / Math.max(1, schema.params.length);
        if (rejectRatio <= (opts.maxRejectRatio ?? 0.5)) {
          return { gameId: opts.game.id, schemaVersion: schema.version, values: v.values, source: "llm", clamped: v.clamped, rejected: v.rejected };
        }
        // 信用できない → ルールへフォールバック。
      } catch {
        // LLM 失敗 → ルールへフォールバック。
      }
    }

    // ルール/ default 経路 (検証して返す)。
    const v = validateTuning(schema, ruleBase);
    const source = opts.intent && opts.game.rules[opts.intent] ? "rule" : "default";
    return { gameId: opts.game.id, schemaVersion: schema.version, values: v.values, source, clamped: v.clamped, rejected: v.rejected };
  }

  // default にルール差分を重ねた候補。
  private applyRule(opts: TuneOptions): TuningValues {
    const base = defaultValues(opts.game.tuningSchema);
    if (opts.intent) {
      const rule = opts.game.rules[opts.intent];
      if (rule) Object.assign(base, rule(base));
    }
    return base;
  }

  private systemPrompt(game: GameModuleDef): string {
    return [
      `あなたは子供向け教育ゲーム「${game.title}」(${game.subject}) のチューニング担当です。`,
      `次のパラメータを、 子の到達度に合わせて調整し JSON で返してください。 スキーマ外の値は採用されません。`,
      describeSchemaForPrompt(game.tuningSchema),
      `制約: 小学校相当の範囲、 個人情報を含めない。 出力は {"<key>": <value>, ...} のみ。`,
    ].join("\n");
  }

  private userPrompt(opts: TuneOptions, ruleBase: TuningValues): string {
    const m = opts.progress.mastery;
    const masteryLines = Object.entries(m).map(([u, v]) => `  ${u}: ${(v * 100).toFixed(0)}%`).join("\n");
    return [
      `子の到達度:`,
      masteryLines || "  (データなし)",
      opts.progress.struggles?.length ? `つまずき: ${opts.progress.struggles.join(", ")}` : "",
      opts.intent ? `意図: ${opts.intent}` : "",
      `参考 (ルール案): ${JSON.stringify(ruleBase)}`,
    ].filter(Boolean).join("\n");
  }
}

// mastery を決定的な文字列へ (キャッシュキー用)。 0.01 刻みに量子化して安定化。
function stableSignature(mastery: Record<string, number>): string {
  return Object.keys(mastery)
    .sort()
    .map((k) => `${k}:${Math.round(mastery[k] * 100)}`)
    .join(",");
}
