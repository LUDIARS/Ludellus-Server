// 学習 POI 完了 (realtime ワールド) → Memoria 通知の写像。
//
// realtime 層は childId しか持たないので、 親 userId を profiles から解決してから
// Memoria の集計値 payload に組み立てて notifyMemoria に渡す。 失敗してもサーバは落とさない。
// (構想だった onPoiResult→memoria.ts の配線本体。 #315)

import { getParentUserId } from "../db/profiles.js";
import { notifyMemoria, type MemoriaActivityPayload } from "../db/memoria.js";

export interface PoiResultArgs {
  childId: string;
  poiId: string;
  subject: string; // 教科 (math / kokugo …)
  result: { score: number; total: number; durationMs: number };
}

// 勝敗判定: 目標 (total) に達したら win。 total<=0 の異常時は lose 扱いにしない (win)。
export function outcomeOf(result: { score: number; total: number }): "win" | "lose" {
  if (result.total <= 0) return "win";
  return result.score >= result.total ? "win" : "lose";
}

// childId/poiId/subject/result → Memoria payload。 userId は呼び出し側で解決して渡す。
export function buildMemoriaPayload(args: PoiResultArgs, userId: string): MemoriaActivityPayload {
  return {
    userId,
    childId: args.childId,
    kind: "ludellus.session",
    gameId: args.poiId,
    mode: "world", // MMO ワールドの学習 POI 由来
    score: args.result.score,
    total: args.result.total,
    unitTags: args.subject ? [args.subject] : undefined,
    durationMs: args.result.durationMs,
    result: outcomeOf(args.result),
  };
}

// 配線本体: userId を解決 → payload → Memoria 通知。 親が引けない/通知失敗は log で済ます。
export async function notifyPoiResult(args: PoiResultArgs): Promise<void> {
  const userId = await getParentUserId(args.childId);
  if (!userId) {
    console.warn(`[ludellus-realtime] poi result: child=${args.childId} に親 userId が無く Memoria 通知を skip`);
    return;
  }
  await notifyMemoria(buildMemoriaPayload(args, userId));
}
