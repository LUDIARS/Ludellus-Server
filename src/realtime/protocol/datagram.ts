// データグラム (unreliable) のコンパクト binary コーデック。
// 位置ホットパスの 2 種だけ binary。 制御 + イベントは messages.ts の JSON を使う。
//
// このフォーマットはネイティブクライアント (C++) と 1 バイト単位で一致させる必要がある。
// 変更時は native/src/world/proto/datagram.cpp も同時に更新すること。

import { ByteWriter, ByteReader, packAngle, unpackAngle } from "./bytes.js";

export const DatagramKind = {
  MoveIntent: 1, // C→S
  EntityStateBatch: 2, // S→C
} as const;

// C→S: クライアントの移動意図。 サーバが速度上限で検証してから適用。
export interface MoveIntent {
  seq: number; // 単調増加。 古い datagram の破棄判定に使う
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number; // ラジアン
}

export function encodeMoveIntent(m: MoveIntent): Uint8Array {
  return new ByteWriter(24)
    .u8(DatagramKind.MoveIntent)
    .u32(m.seq)
    .f32(m.x).f32(m.y)
    .f32(m.vx).f32(m.vy)
    .u16(packAngle(m.facing))
    .bytes();
}

export function decodeMoveIntent(buf: Uint8Array): MoveIntent {
  const r = new ByteReader(buf);
  const kind = r.u8();
  if (kind !== DatagramKind.MoveIntent) {
    throw new Error(`expected MoveIntent(${DatagramKind.MoveIntent}), got ${kind}`);
  }
  return {
    seq: r.u32(),
    x: r.f32(), y: r.f32(),
    vx: r.f32(), vy: r.f32(),
    facing: unpackAngle(r.u16()),
  };
}

// S→C: AOI でフィルタした観測対象の位置/HP スナップショット。
export interface EntityStateRow {
  entityId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number; // ラジアン
  hp: number; // 0..65535 にクランプ
}

export function encodeEntityStateBatch(rows: EntityStateRow[]): Uint8Array {
  const w = new ByteWriter(2 + 1 + rows.length * 24);
  w.u8(DatagramKind.EntityStateBatch);
  w.u16(rows.length);
  for (const e of rows) {
    w.u32(e.entityId);
    w.f32(e.x).f32(e.y);
    w.f32(e.vx).f32(e.vy);
    w.u16(packAngle(e.facing));
    w.u16(Math.max(0, Math.min(0xffff, Math.round(e.hp))));
  }
  return w.bytes();
}

export function decodeEntityStateBatch(buf: Uint8Array): EntityStateRow[] {
  const r = new ByteReader(buf);
  const kind = r.u8();
  if (kind !== DatagramKind.EntityStateBatch) {
    throw new Error(`expected EntityStateBatch(${DatagramKind.EntityStateBatch}), got ${kind}`);
  }
  const count = r.u16();
  const rows: EntityStateRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      entityId: r.u32(),
      x: r.f32(), y: r.f32(),
      vx: r.f32(), vy: r.f32(),
      facing: unpackAngle(r.u16()),
      hp: r.u16(),
    });
  }
  return rows;
}

// datagram の先頭バイトで種別を覗く (dispatch 用)。
export function peekDatagramKind(buf: Uint8Array): number {
  return buf.length > 0 ? buf[0] : -1;
}
