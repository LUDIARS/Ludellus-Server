// ユーザごとに変わる学習フィールド。 Zone 入場時、 その子の進捗から
// 個人別の POI (学習コンテンツ) レイアウトを生成する。
//
// 進捗の取得は LearningProgressSource 抽象に逃がす (REST 層の curriculum/branches を後で配線)。
// solo = その子だけに見える私的コンテンツ / shared = チャンネル全員で挑む協力コンテンツ。

import type { FieldPoi, PoiVisibility } from "../protocol/messages.js";
import type { ZoneDef } from "./zoneDefs.js";

// その子の単元進捗 (集計値のみ。 個人データ保管禁止ルール準拠)。
export interface ChildUnitProgress {
  unitId: string;
  subject: string;
  label: string;
  mastery: number; // 0..1。 branch ツリーの到達度から算出
  recommended: boolean; // 次にやるべき単元か
}

export interface LearningProgressSource {
  // 指定教科で、 その子に出すべき単元 (推奨 + 復習) を返す。
  getUnitsForChild(childId: string, subject: string): Promise<ChildUnitProgress[]>;
}

// 決定的に POI を配置するための擬似ハッシュ (childId+unitId → 0..1)。
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export interface FieldManifestResult {
  // 送信用の POI 一覧。
  pois: FieldPoi[];
}

export class LearningField {
  constructor(private readonly source: LearningProgressSource) {}

  async generate(childId: string, zone: ZoneDef): Promise<FieldManifestResult> {
    const units = await this.source.getUnitsForChild(childId, zone.subject);
    const pois: FieldPoi[] = [];
    const margin = 200;
    const innerW = zone.size.w - margin * 2;
    const innerH = zone.size.h - margin * 2;

    for (const u of units) {
      // 推奨単元かつ高 mastery のものは「協力(shared)」 にして友達と挑める。
      // それ以外は「個人(solo)」 の私的コンテンツ。
      const visibility: PoiVisibility = u.recommended && u.mastery >= 0.5 ? "shared" : "solo";
      const hx = hash01(childId + ":" + u.unitId + ":x");
      const hy = hash01(childId + ":" + u.unitId + ":y");
      pois.push({
        poiId: `${zone.id}:${u.unitId}`,
        visibility,
        subject: u.subject,
        x: margin + hx * innerW,
        y: margin + hy * innerH,
        contentRef: u.unitId,
        state: u.mastery >= 1 ? "completed" : "available",
      });
    }
    return { pois };
  }
}

// テスト/フォールバック用の静的進捗ソース。
export class StaticProgressSource implements LearningProgressSource {
  constructor(private readonly byChild: Record<string, ChildUnitProgress[]> = {}) {}
  async getUnitsForChild(childId: string, subject: string): Promise<ChildUnitProgress[]> {
    const all = this.byChild[childId] ?? DEFAULT_UNITS;
    return all.filter((u) => u.subject === subject);
  }
}

const DEFAULT_UNITS: ChildUnitProgress[] = [
  { unitId: "math.g1.add", subject: "math", label: "たしざん", mastery: 0.7, recommended: true },
  { unitId: "math.g1.sub", subject: "math", label: "ひきざん", mastery: 0.3, recommended: true },
  { unitId: "math.g1.count", subject: "math", label: "かずをかぞえる", mastery: 1, recommended: false },
  { unitId: "kokugo.g1.hira", subject: "kokugo", label: "ひらがな", mastery: 0.6, recommended: true },
];
