import { describe, it, expect, vi } from "vitest";
import { validateTuning, defaultValues } from "./tuningSchema.js";
import { getGameModule } from "./registry.js";
import { Tuner, MemoryTuneCache, type LlmTuningClient, type ProgressSignature } from "./Tuner.js";

const game = getGameModule("number_catch")!;
const progress: ProgressSignature = { childId: "child_a", mastery: { "math.g1.unit1.add": 0.4 } };

describe("validateTuning", () => {
  it("欠落は default、 範囲外はクランプ、 未知は捨てる", () => {
    const r = validateTuning(game.tuningSchema, { numberMax: 999, unknownKey: 1 });
    expect(r.values.numberMax).toBe(99); // 99 にクランプ
    expect(r.clamped).toContain("numberMax");
    expect(r.values.numberMin).toBe(1); // default
    expect("unknownKey" in r.values).toBe(false);
  });

  it("型違反は default に落とし rejected に載る", () => {
    const r = validateTuning(game.tuningSchema, { spawnRate: "fast", useKanjiNumerals: "yes", operation: "divide" });
    expect(r.values.spawnRate).toBe(1.0);
    expect(r.values.useKanjiNumerals).toBe(false);
    expect(r.values.operation).toBe("count"); // enum 外 → default
    expect(r.rejected).toEqual(expect.arrayContaining(["spawnRate", "useKanjiNumerals", "operation"]));
  });

  it("enum 正常値は通る", () => {
    const r = validateTuning(game.tuningSchema, { operation: "add" });
    expect(r.values.operation).toBe("add");
  });
});

describe("Tuner", () => {
  it("ルール intent=easier は default より易しくなり source=rule", async () => {
    const t = new Tuner();
    const r = await t.tune({ game, progress, intent: "easier" });
    expect(r.source).toBe("rule");
    const def = defaultValues(game.tuningSchema);
    expect(r.values.spawnRate as number).toBeLessThan(def.spawnRate as number);
  });

  it("intent 無しは default", async () => {
    const t = new Tuner();
    const r = await t.tune({ game, progress });
    expect(r.source).toBe("default");
    expect(r.values).toEqual(defaultValues(game.tuningSchema));
  });

  it("LLM の壊れた出力はスキーマでクランプ/却下される", async () => {
    const llm: LlmTuningClient = {
      propose: async () => ({ numberMax: 9999, spawnRate: 2.0, operation: "add", bogus: true }),
    };
    const t = new Tuner();
    const r = await t.tune({ game, progress, llm });
    expect(r.source).toBe("llm");
    expect(r.values.numberMax).toBe(99); // クランプ
    expect(r.values.spawnRate).toBe(2.0); // 範囲内
    expect(r.values.operation).toBe("add");
    expect("bogus" in r.values).toBe(false);
  });

  it("LLM が大半をスキーマ外で返したらルールへフォールバック", async () => {
    const llm: LlmTuningClient = {
      // 6 個中ほぼ全部が型違反 → reject 比率が高い
      propose: async () => ({ numberMin: "x", numberMax: "x", spawnRate: "x", targetCount: "x", useKanjiNumerals: "x", operation: "zzz" }),
    };
    const t = new Tuner();
    const r = await t.tune({ game, progress, intent: "harder", llm });
    expect(r.source).toBe("rule"); // 信用できず rule へ
    expect(r.values.spawnRate as number).toBeGreaterThan(defaultValues(game.tuningSchema).spawnRate as number);
  });

  it("LLM が例外を投げてもルール/ default にフォールバック", async () => {
    const llm: LlmTuningClient = { propose: async () => { throw new Error("api down"); } };
    const t = new Tuner();
    const r = await t.tune({ game, progress, llm });
    expect(r.source).toBe("default");
  });

  it("同一入力はキャッシュされ LLM は 1 回しか呼ばれない", async () => {
    const propose = vi.fn(async () => ({ spawnRate: 1.5 }));
    const llm: LlmTuningClient = { propose };
    const cache = new MemoryTuneCache();
    const t = new Tuner(cache);
    await t.tune({ game, progress, llm });
    await t.tune({ game, progress, llm });
    expect(propose).toHaveBeenCalledTimes(1);
  });
});
