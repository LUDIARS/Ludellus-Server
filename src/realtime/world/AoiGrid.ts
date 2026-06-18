// AOI (Area of Interest) グリッド。 チャンネル内をセル分割し、
// 観測者の近傍セルにいるエンティティだけを「興味あり」 として返す = 差分配信のキモ。
//
// エンティティ id → セルの索引を持ち、 移動でセルをまたいだら index を更新する。

export interface AoiConfig {
  cellSize: number; // 1 セルの一辺 (ワールド単位)
  viewRadiusCells: number; // 観測半径 (セル数)。 1 なら 3x3、 2 なら 5x5
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

export class AoiGrid {
  private readonly cells = new Map<string, Set<number>>();
  private readonly entityCell = new Map<number, string>();

  constructor(private readonly cfg: AoiConfig) {}

  private coord(x: number, y: number): { cx: number; cy: number } {
    return { cx: Math.floor(x / this.cfg.cellSize), cy: Math.floor(y / this.cfg.cellSize) };
  }

  insert(entityId: number, x: number, y: number): void {
    const { cx, cy } = this.coord(x, y);
    const key = cellKey(cx, cy);
    this.addTo(key, entityId);
    this.entityCell.set(entityId, key);
  }

  remove(entityId: number): void {
    const key = this.entityCell.get(entityId);
    if (key === undefined) return;
    this.cells.get(key)?.delete(entityId);
    this.entityCell.delete(entityId);
  }

  // 位置更新。 セルをまたいだら true (interest 再計算の合図)。
  update(entityId: number, x: number, y: number): boolean {
    const { cx, cy } = this.coord(x, y);
    const newKey = cellKey(cx, cy);
    const oldKey = this.entityCell.get(entityId);
    if (oldKey === newKey) return false;
    if (oldKey !== undefined) this.cells.get(oldKey)?.delete(entityId);
    this.addTo(newKey, entityId);
    this.entityCell.set(entityId, newKey);
    return true;
  }

  // 観測者 (x,y) の興味範囲にいる全エンティティ id。 観測者自身も含む。
  queryInterest(x: number, y: number): Set<number> {
    const { cx, cy } = this.coord(x, y);
    const r = this.cfg.viewRadiusCells;
    const out = new Set<number>();
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const bucket = this.cells.get(cellKey(cx + dx, cy + dy));
        if (bucket) for (const id of bucket) out.add(id);
      }
    }
    return out;
  }

  private addTo(key: string, entityId: number): void {
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = new Set(); this.cells.set(key, bucket); }
    bucket.add(entityId);
  }
}
