// 本番の学習進捗ソース。 REST 層の curriculumMap (単元定義) と branches (その子の学習履歴) から
// 「その子に出す単元 + 到達度」 を組み立てる。 これが学習フィールドが個人ごとに変わる根拠。
//
// realtime ゲートウェイが REST と同一プロセスなら branches の in-memory store を直接読める。
// 別プロセス運用時は listBranches を REST 越し fetch に差し替える (コンストラクタ注入)。

import type { LearningProgressSource, ChildUnitProgress } from "./LearningField.js";
import { curriculumMap } from "../../db/curriculum.js";
import { listBranches, type ServerBranch } from "../../db/branches.js";

export type BranchLister = (childId: string) => Promise<ServerBranch[]>;

export class CurriculumProgressSource implements LearningProgressSource {
  constructor(private readonly branchLister: BranchLister = listBranches) {}

  async getUnitsForChild(childId: string, subject: string): Promise<ChildUnitProgress[]> {
    const units = curriculumMap.filter((u) => u.subject === subject);
    const branches = await this.branchLister(childId);
    // 単元 id → その子が踏んだ branch 数 (到達度の代理指標)。
    const touchCount = new Map<string, number>();
    for (const b of branches) {
      for (const unitId of b.curriculumUnits) {
        touchCount.set(unitId, (touchCount.get(unitId) ?? 0) + 1);
      }
    }
    return units.map((u) => {
      const touches = touchCount.get(u.id) ?? 0;
      const mastery = Math.min(1, touches * 0.3);
      return {
        unitId: u.id,
        subject: u.subject,
        label: u.label,
        mastery,
        recommended: mastery < 0.9, // まだ伸ばせる単元を出す
      };
    });
  }
}
