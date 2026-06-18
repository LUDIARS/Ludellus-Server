// 2D ベクトルユーティリティ (純関数)。 ワールドはトップダウン平面座標。

export interface Vec2 { x: number; y: number; }

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

export function within(a: Vec2, b: Vec2, radius: number): boolean {
  return dist2(a, b) <= radius * radius;
}

export function clampSpeed(vx: number, vy: number, maxSpeed: number): { vx: number; vy: number } {
  const sp = Math.hypot(vx, vy);
  if (sp <= maxSpeed || sp === 0) return { vx, vy };
  const k = maxSpeed / sp;
  return { vx: vx * k, vy: vy * k };
}
