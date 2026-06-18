// ゲームのチューニング・スキーマ。 各 GameModule が宣言する「LLM が埋めてよいパラメータ」の型契約。
// LLM / ルール生成の出力は必ずこのスキーマで検証してから採用する (任意 payload を排除)。

export type ParamDef =
  | { key: string; type: "int"; min: number; max: number; default: number; label: string; describe: string }
  | { key: string; type: "number"; min: number; max: number; default: number; label: string; describe: string }
  | { key: string; type: "bool"; default: boolean; label: string; describe: string }
  | { key: string; type: "enum"; options: string[]; default: string; label: string; describe: string };

export interface TuningSchema {
  version: number; // 変更したら cache キーが変わる
  params: ParamDef[];
}

export type TuningValue = number | boolean | string;
export type TuningValues = Record<string, TuningValue>;

export interface ValidationResult {
  values: TuningValues;   // スキーマに収めた最終値 (常に全 key を持つ)
  clamped: string[];      // 範囲外でクランプした key
  rejected: string[];     // 型違反/未知で default に落とした key
}

function clampNumber(v: number, min: number, max: number): { value: number; clamped: boolean } {
  if (v < min) return { value: min, clamped: true };
  if (v > max) return { value: max, clamped: true };
  return { value: v, clamped: false };
}

// 任意の候補オブジェクトをスキーマに収める。 未知 key は捨て、 欠落は default、 範囲外はクランプ、
// 型違反は default に落とす。 これで LLM が壊れた値を出してもゲームは必ず成立する。
export function validateTuning(schema: TuningSchema, candidate: Record<string, unknown> | null | undefined): ValidationResult {
  const values: TuningValues = {};
  const clamped: string[] = [];
  const rejected: string[] = [];
  const c = candidate ?? {};

  for (const p of schema.params) {
    const raw = c[p.key];
    switch (p.type) {
      case "int":
      case "number": {
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
          values[p.key] = p.default;
          if (raw !== undefined) rejected.push(p.key);
          break;
        }
        const n = p.type === "int" ? Math.round(raw) : raw;
        const r = clampNumber(n, p.min, p.max);
        values[p.key] = r.value;
        if (r.clamped) clamped.push(p.key);
        break;
      }
      case "bool": {
        if (typeof raw !== "boolean") {
          values[p.key] = p.default;
          if (raw !== undefined) rejected.push(p.key);
        } else {
          values[p.key] = raw;
        }
        break;
      }
      case "enum": {
        if (typeof raw !== "string" || !p.options.includes(raw)) {
          values[p.key] = p.default;
          if (raw !== undefined) rejected.push(p.key);
        } else {
          values[p.key] = raw;
        }
        break;
      }
    }
  }
  return { values, clamped, rejected };
}

// スキーマの default だけで構成した tuning。
export function defaultValues(schema: TuningSchema): TuningValues {
  const out: TuningValues = {};
  for (const p of schema.params) out[p.key] = p.default;
  return out;
}

// LLM へ渡すスキーマ説明 (パラメータの意味と範囲を自然言語化)。
export function describeSchemaForPrompt(schema: TuningSchema): string {
  return schema.params.map((p) => {
    if (p.type === "enum") return `- ${p.key} (enum: ${p.options.join("|")}, default ${p.default}): ${p.describe}`;
    if (p.type === "bool") return `- ${p.key} (bool, default ${p.default}): ${p.describe}`;
    return `- ${p.key} (${p.type} ${p.min}..${p.max}, default ${p.default}): ${p.describe}`;
  }).join("\n");
}
