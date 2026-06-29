import { describe, it, expect } from "vitest";
import { getGameBehaviorSpec, getGameModule } from "./registry.js";
import { validateBehaviorSpec } from "./behaviorSchema.js";

describe("registry BehaviorSpec 配布", () => {
  it("number_catch の既定 BehaviorSpec は有界文法で妥当", () => {
    const r = getGameBehaviorSpec("number_catch");
    expect(r.errors).toEqual([]);
    expect(r.spec?.initial_state).toBe("playing");
    expect(r.spec?.states.map((s) => s.name).sort()).toEqual(["lost", "playing", "won"]);
  });

  it("wire JSON を round-trip しても妥当 (サーバ配布 → native ローダ互換)", () => {
    const spec = getGameModule("number_catch")?.behaviorSpec;
    expect(spec).toBeDefined();
    const wire = JSON.stringify(spec);
    const r = validateBehaviorSpec(JSON.parse(wire));
    expect(r.errors).toEqual([]);
    expect(r.spec?.states.length).toBe(3);
    // global_rules (spawn 停止) が保持される。
    expect(r.spec?.global_rules?.length).toBe(1);
  });

  it("未知ゲーム / spec 未定義は errors を返す", () => {
    expect(getGameBehaviorSpec("nope").spec).toBeNull();
    expect(getGameBehaviorSpec("nope").errors.length).toBeGreaterThan(0);
  });
});
