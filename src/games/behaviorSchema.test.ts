import { describe, it, expect } from "vitest";
import { validateBehaviorSpec, isValidBehaviorSpec } from "./behaviorSchema.js";

// クライアント native の wire 形式と同じ JSON を検証する。
const goodSpec = {
  initial_state: "playing",
  states: [
    {
      name: "playing",
      rules: [
        { event: "caught_correct", actions: [
          { kind: "add_var", key: "score", value: { a: { lit: 1 } } },
          { kind: "emit", key: "check_win" },
        ] },
        { event: "check_win", conditions: [{ var: "score", op: "ge", rhs: { var: "target" } }],
          actions: [{ kind: "end_game", key: "win" }, { kind: "goto", key: "won" }] },
      ],
    },
    { name: "won", rules: [] },
  ],
};

describe("validateBehaviorSpec", () => {
  it("妥当な spec を正規化して通す", () => {
    const r = validateBehaviorSpec(goodSpec);
    expect(r.errors).toEqual([]);
    expect(r.spec?.initial_state).toBe("playing");
    expect(r.spec?.states.length).toBe(2);
  });

  it("initial_state が無い state を指すと弾く", () => {
    const r = validateBehaviorSpec({ ...goodSpec, initial_state: "nope" });
    expect(r.spec).toBeNull();
    expect(r.errors.some((e) => e.includes("initial_state"))).toBe(true);
  });

  it("未知の action.kind を弾く", () => {
    const bad = { initial_state: "s", states: [{ name: "s", rules: [{ event: "e", actions: [{ kind: "explode", key: "x" }] }] }] };
    expect(isValidBehaviorSpec(bad)).toBe(false);
  });

  it("未知の cmp op を弾く", () => {
    const bad = { initial_state: "s", states: [{ name: "s", rules: [
      { event: "e", conditions: [{ var: "x", op: "approx", rhs: { lit: 1 } }], actions: [] }] }] };
    expect(isValidBehaviorSpec(bad)).toBe(false);
  });

  it("Goto 先が存在しないと弾く", () => {
    const bad = { initial_state: "s", states: [{ name: "s", rules: [{ event: "e", actions: [{ kind: "goto", key: "ghost" }] }] }] };
    const r = validateBehaviorSpec(bad);
    expect(r.spec).toBeNull();
    expect(r.errors.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("binop に b が無いと弾く", () => {
    const bad = { initial_state: "s", states: [{ name: "s", rules: [
      { event: "e", actions: [{ kind: "set_var", key: "x", value: { a: { lit: 1 }, op: "add" } }] }] }] };
    expect(isValidBehaviorSpec(bad)).toBe(false);
  });

  it("operand が var/lit いずれも無いと弾く", () => {
    const bad = { initial_state: "s", states: [{ name: "s", rules: [
      { event: "e", actions: [{ kind: "set_var", key: "x", value: { a: {} } }] }] }] };
    expect(isValidBehaviorSpec(bad)).toBe(false);
  });

  it("重複 state 名を検出する", () => {
    const bad = { initial_state: "s", states: [{ name: "s", rules: [] }, { name: "s", rules: [] }] };
    expect(validateBehaviorSpec(bad).errors.some((e) => e.includes("duplicate"))).toBe(true);
  });
});
