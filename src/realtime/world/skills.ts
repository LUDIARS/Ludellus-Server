// プレイヤーの攻撃スキル定義 (知育ゲーム向けに最小)。
// うにの触手アタック等。 damage と射程だけ持つ。

export interface SkillDef {
  id: string;
  damage: number;
  range: number;
  cooldownTicks: number;
}

export const SKILLS: Record<string, SkillDef> = {
  tentacle: { id: "tentacle", damage: 10, range: 70, cooldownTicks: 8 },
  splash: { id: "splash", damage: 6, range: 120, cooldownTicks: 16 },
};

export function getSkill(id: string): SkillDef | undefined {
  return SKILLS[id];
}
