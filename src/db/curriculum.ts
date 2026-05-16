// 学習指導要領 × 学年 × 教科 × 単元 の静的マップ (placeholder)。
// spec/manabi-no-tabibito.md (UniLand 側) の 3 段階 (低学年 / 中学年 / 高学年) を骨組みに、
// 具体単元は徐々に拡充する。 Phase 2 で正本を JSON 化して GitHub Pages 配信予定。

export interface CurriculumUnit {
  id: string;          // 例: "math.g1.unit3.add"
  label: string;       // 「たしざん」
  grade: 1 | 2 | 3 | 4 | 5 | 6;
  subject: string;     // "math" / "japanese" / "science" / ...
  description?: string;
}

export const curriculumMap: CurriculumUnit[] = [
  { id: "japanese.g1.hiragana", label: "ひらがな", grade: 1, subject: "japanese" },
  { id: "japanese.g1.katakana", label: "カタカナ", grade: 1, subject: "japanese" },
  { id: "japanese.g2.kanji", label: "2 年漢字", grade: 2, subject: "japanese" },
  { id: "japanese.g3.kanji", label: "3 年漢字", grade: 3, subject: "japanese" },
  { id: "math.g1.unit1.add", label: "たしざん", grade: 1, subject: "math" },
  { id: "math.g1.unit2.sub", label: "ひきざん", grade: 1, subject: "math" },
  { id: "math.g2.unit1.add", label: "2 ケタの たしざん", grade: 2, subject: "math" },
  { id: "math.g2.unit3.mul", label: "かけざん", grade: 2, subject: "math" },
  { id: "math.g3.unit1.div", label: "わりざん", grade: 3, subject: "math" },
];
