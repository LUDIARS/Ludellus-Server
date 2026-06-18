// 小さなバイト列リーダ/ライタ。 datagram のコンパクト binary エンコード専用。
// 全て little-endian。 文字列は u16 長 + utf8。

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(initial = 64) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    const need = this.pos + extra;
    if (need <= this.buf.length) return;
    let next = this.buf.length * 2;
    while (next < need) next *= 2;
    const grown = new Uint8Array(next);
    grown.set(this.buf);
    this.buf = grown;
    this.view = new DataView(this.buf.buffer);
  }

  u8(v: number): this { this.ensure(1); this.view.setUint8(this.pos, v & 0xff); this.pos += 1; return this; }
  u16(v: number): this { this.ensure(2); this.view.setUint16(this.pos, v & 0xffff, true); this.pos += 2; return this; }
  u32(v: number): this { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; return this; }
  i32(v: number): this { this.ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; return this; }
  f32(v: number): this { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; return this; }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }
}

export class ByteReader {
  private view: DataView;
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number { return this.buf.byteLength - this.pos; }

  u8(): number { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
}

// facing (ラジアン 0..2π) を u16 に量子化。 位置 datagram のサイズ削減用。
const TWO_PI = Math.PI * 2;
export function packAngle(rad: number): number {
  let a = rad % TWO_PI;
  if (a < 0) a += TWO_PI;
  return Math.round((a / TWO_PI) * 0xffff) & 0xffff;
}
export function unpackAngle(packed: number): number {
  return (packed / 0xffff) * TWO_PI;
}
