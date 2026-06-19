// BehaviorSpec の wire スキーマ + 検証。 LLM / ライブ編集器が生成した「挙動」 を、
// クライアント native (native/src/world/game/behavior/spec_json) と同じ有界文法に収める安全装置。
// tuningSchema の validateTuning と対の「挙動側の検証」。 不正な spec は配布前に弾く。

export type CmpOp = "lt" | "le" | "eq" | "ne" | "ge" | "gt";
export type BinOp = "none" | "add" | "sub" | "mul" | "div" | "min" | "max";
export type ActionKind =
  | "set_var" | "add_var" | "emit" | "goto" | "spawn"
  | "play_sfx" | "end_game" | "start_timer" | "cancel_timer";

export type Operand = { lit: number | boolean | string } | { var: string };
export interface Expr { a: Operand; op?: BinOp; b?: Operand; }
export interface Condition { var: string; op: CmpOp; rhs: Operand; }
export interface Action { kind: ActionKind; key: string; value?: Expr; }
export interface Rule { event: string; any?: boolean; conditions?: Condition[]; actions: Action[]; }
export interface State { name: string; rules: Rule[]; }
export interface BehaviorSpec { initial_state: string; states: State[]; global_rules?: Rule[]; }

const CMP_OPS = new Set<string>(["lt", "le", "eq", "ne", "ge", "gt"]);
const BIN_OPS = new Set<string>(["none", "add", "sub", "mul", "div", "min", "max"]);
const ACTION_KINDS = new Set<string>([
  "set_var", "add_var", "emit", "goto", "spawn", "play_sfx", "end_game", "start_timer", "cancel_timer",
]);
const VALUE_ACTIONS = new Set<string>(["set_var", "add_var", "spawn", "start_timer"]);

export interface BehaviorValidationResult {
  spec: BehaviorSpec | null; // 正規化済み (検証 OK の時のみ)
  errors: string[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateOperand(v: unknown, where: string, errors: string[]): Operand | null {
  if (!isObj(v)) { errors.push(`operand not object in ${where}`); return null; }
  if ("var" in v) {
    if (typeof v.var !== "string") { errors.push(`operand.var not string in ${where}`); return null; }
    return { var: v.var };
  }
  if ("lit" in v) {
    const lit = v.lit;
    if (typeof lit !== "number" && typeof lit !== "boolean" && typeof lit !== "string") {
      errors.push(`operand.lit bad type in ${where}`); return null;
    }
    return { lit };
  }
  errors.push(`operand missing var/lit in ${where}`);
  return null;
}

function validateExpr(v: unknown, where: string, errors: string[]): Expr | null {
  if (!isObj(v)) { errors.push(`expr not object in ${where}`); return null; }
  const a = validateOperand(v.a, where, errors);
  if (!a) return null;
  const expr: Expr = { a };
  if (v.op !== undefined) {
    if (typeof v.op !== "string" || !BIN_OPS.has(v.op)) { errors.push(`bad binop in ${where}`); return null; }
    expr.op = v.op as BinOp;
    if (expr.op !== "none") {
      const b = validateOperand(v.b, where, errors);
      if (!b) { errors.push(`expr missing 'b' for binop in ${where}`); return null; }
      expr.b = b;
    }
  }
  return expr;
}

function validateRule(v: unknown, where: string, errors: string[]): Rule | null {
  if (!isObj(v)) { errors.push(`rule not object in ${where}`); return null; }
  if (typeof v.event !== "string" || v.event.length === 0) { errors.push(`rule.event missing in ${where}`); return null; }
  const rule: Rule = { event: v.event, actions: [] };
  if (v.any !== undefined) rule.any = Boolean(v.any);

  if (v.conditions !== undefined) {
    if (!Array.isArray(v.conditions)) { errors.push(`conditions not array in ${where}`); return null; }
    rule.conditions = [];
    for (const c of v.conditions) {
      if (!isObj(c)) { errors.push(`condition not object in ${where}`); return null; }
      if (typeof c.var !== "string") { errors.push(`condition.var missing in ${where}`); return null; }
      if (typeof c.op !== "string" || !CMP_OPS.has(c.op)) { errors.push(`bad condition.op in ${where}`); return null; }
      const rhs = validateOperand(c.rhs, where, errors);
      if (!rhs) return null;
      rule.conditions.push({ var: c.var, op: c.op as CmpOp, rhs });
    }
  }

  if (!Array.isArray(v.actions)) { errors.push(`rule.actions missing in ${where}`); return null; }
  for (const a of v.actions) {
    if (!isObj(a)) { errors.push(`action not object in ${where}`); return null; }
    if (typeof a.kind !== "string" || !ACTION_KINDS.has(a.kind)) { errors.push(`bad action.kind in ${where}`); return null; }
    const act: Action = { kind: a.kind as ActionKind, key: typeof a.key === "string" ? a.key : "" };
    if (VALUE_ACTIONS.has(a.kind) && a.value !== undefined) {
      const expr = validateExpr(a.value, where, errors);
      if (!expr) return null;
      act.value = expr;
    }
    rule.actions.push(act);
  }
  return rule;
}

export function validateBehaviorSpec(candidate: unknown): BehaviorValidationResult {
  const errors: string[] = [];
  if (!isObj(candidate)) return { spec: null, errors: ["root not object"] };

  const initial = typeof candidate.initial_state === "string" ? candidate.initial_state : "";
  if (!initial) errors.push("missing initial_state");

  if (!Array.isArray(candidate.states)) {
    errors.push("missing states");
    return { spec: null, errors };
  }

  const states: State[] = [];
  const names = new Set<string>();
  for (const s of candidate.states) {
    if (!isObj(s) || typeof s.name !== "string") { errors.push("state missing name"); continue; }
    if (names.has(s.name)) errors.push(`duplicate state: ${s.name}`);
    names.add(s.name);
    const rules: Rule[] = [];
    if (Array.isArray(s.rules)) {
      for (const r of s.rules) {
        const rule = validateRule(r, `state:${s.name}`, errors);
        if (rule) rules.push(rule);
      }
    }
    states.push({ name: s.name, rules });
  }

  const globalRules: Rule[] = [];
  if (candidate.global_rules !== undefined) {
    if (!Array.isArray(candidate.global_rules)) errors.push("global_rules not array");
    else for (const r of candidate.global_rules) {
      const rule = validateRule(r, "global", errors);
      if (rule) globalRules.push(rule);
    }
  }

  // 構造検証 (native validate_spec と同じ): initial_state 存在 / Goto 先存在。
  if (initial && !names.has(initial)) errors.push(`initial_state not found: ${initial}`);
  const checkGoto = (rules: Rule[], where: string) => {
    for (const r of rules) for (const a of r.actions) {
      if (a.kind === "goto" && !names.has(a.key)) errors.push(`Goto to unknown state '${a.key}' in ${where}`);
    }
  };
  checkGoto(globalRules, "global");
  for (const st of states) checkGoto(st.rules, `state:${st.name}`);

  if (errors.length > 0) return { spec: null, errors };
  const spec: BehaviorSpec = { initial_state: initial, states };
  if (globalRules.length > 0) spec.global_rules = globalRules;
  return { spec, errors: [] };
}

export function isValidBehaviorSpec(candidate: unknown): boolean {
  return validateBehaviorSpec(candidate).errors.length === 0;
}
