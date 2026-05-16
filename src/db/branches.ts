// 分岐ストア DB スタブ。 クライアント側 renderer/lib/branches.js と同じデータ形を扱う。
// Phase 1 は in-memory、 Phase 2 で Drizzle + Postgres + 親子 (parentBranchId) ツリーを RDB に。

import { randomUUID } from "node:crypto";

export interface ServerBranch {
  id: string;
  childId: string;
  baseGameId: string;
  parentBranchId: string | null;
  mode: string;
  generationParams: { kind: "rule" | "main" | "api"; appliedDeltas: string[] };
  curriculumUnits: string[];
  createdAt: string;
  payload: Record<string, unknown>;
}

// childId → ServerBranch[]
const store = new Map<string, ServerBranch[]>();

export async function listBranches(childId: string): Promise<ServerBranch[]> {
  return store.get(childId) ?? [];
}

// クライアント side の rule と同じセット。 サーバでも整合性確認のため重複定義する。
const RULES: Record<string, (parent: ServerBranch | null) => Record<string, unknown>> = {
  "easier": (parent) => {
    const range = (parent?.payload.numericRange as { min: number; max: number }) ?? { min: 1, max: 9 };
    return {
      ...(parent?.payload ?? {}),
      numericRange: { min: range.min, max: Math.max(range.min + 1, range.max - 2) },
      questionCount: Math.max(5, ((parent?.payload.questionCount as number) ?? 10) - 2),
    };
  },
  "harder": (parent) => {
    const range = (parent?.payload.numericRange as { min: number; max: number }) ?? { min: 1, max: 9 };
    return {
      ...(parent?.payload ?? {}),
      numericRange: { min: range.min, max: range.max + 3 },
      questionCount: ((parent?.payload.questionCount as number) ?? 10) + 2,
    };
  },
  "kanji-mix": (parent) => ({
    ...(parent?.payload ?? {}),
    includeKanji: true,
    kanjiRatio: ((parent?.payload.kanjiRatio as number) ?? 0) + 0.3,
  }),
};

export async function createBranch(
  childId: string,
  input: Omit<ServerBranch, "id" | "createdAt" | "childId">,
): Promise<ServerBranch> {
  const branch: ServerBranch = {
    id: `${input.baseGameId}#${input.mode}.${randomUUID().slice(0, 8)}`,
    childId,
    createdAt: new Date().toISOString(),
    ...input,
  };
  if (!store.has(childId)) store.set(childId, []);
  store.get(childId)!.push(branch);
  return branch;
}

export async function applyRuleServer(childId: string, input: {
  parentBranchId: string | null;
  baseGameId: string;
  mode: string;
  ruleKey: string;
  payload?: Record<string, unknown>;
}): Promise<ServerBranch | null> {
  const rule = RULES[input.ruleKey];
  if (!rule) return null;

  const branches = store.get(childId) ?? [];
  const parent = input.parentBranchId ? branches.find(b => b.id === input.parentBranchId) ?? null : null;
  if (input.parentBranchId && !parent) return null;

  return createBranch(childId, {
    baseGameId: input.baseGameId,
    parentBranchId: input.parentBranchId,
    mode: input.mode,
    generationParams: {
      kind: "rule",
      appliedDeltas: [...(parent?.generationParams.appliedDeltas ?? []), input.ruleKey],
    },
    curriculumUnits: parent?.curriculumUnits ?? [],
    payload: rule(parent),
  });
}
