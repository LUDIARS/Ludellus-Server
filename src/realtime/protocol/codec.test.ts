import { describe, it, expect } from "vitest";
import { encodeMoveIntent, decodeMoveIntent, encodeEntityStateBatch, decodeEntityStateBatch } from "./datagram.js";
import { packAngle, unpackAngle } from "./bytes.js";
import { encodeControl, decodeControl, type HelloMsg } from "./messages.js";

describe("datagram codec", () => {
  it("MoveIntent round-trips", () => {
    const m = { seq: 42, x: 123.5, y: -88.25, vx: 12.5, vy: -3.5, facing: 1.2 };
    const out = decodeMoveIntent(encodeMoveIntent(m));
    expect(out.seq).toBe(42);
    expect(out.x).toBeCloseTo(123.5, 3);
    expect(out.y).toBeCloseTo(-88.25, 3);
    expect(out.vx).toBeCloseTo(12.5, 3);
    expect(out.vy).toBeCloseTo(-3.5, 3);
    expect(out.facing).toBeCloseTo(1.2, 2);
  });

  it("MoveIntent is exactly 23 bytes", () => {
    expect(encodeMoveIntent({ seq: 1, x: 0, y: 0, vx: 0, vy: 0, facing: 0 }).length).toBe(23);
  });

  it("EntityStateBatch round-trips many rows", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      entityId: i + 1, x: i * 2, y: i * -3, vx: 1, vy: -1, facing: (i % 6) * 1.0, hp: i,
    }));
    const out = decodeEntityStateBatch(encodeEntityStateBatch(rows));
    expect(out.length).toBe(50);
    expect(out[10].entityId).toBe(11);
    expect(out[10].x).toBeCloseTo(20, 3);
    expect(out[10].hp).toBe(10);
  });

  it("EntityStateBatch handles empty", () => {
    expect(decodeEntityStateBatch(encodeEntityStateBatch([])).length).toBe(0);
  });

  it("decode rejects wrong kind", () => {
    expect(() => decodeEntityStateBatch(encodeMoveIntent({ seq: 1, x: 0, y: 0, vx: 0, vy: 0, facing: 0 }))).toThrow();
  });

  it("angle quantization is stable across 2π", () => {
    for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI, 2 * Math.PI - 0.01]) {
      expect(unpackAngle(packAngle(a))).toBeCloseTo(a % (2 * Math.PI), 2);
    }
  });
});

describe("control codec", () => {
  it("hello round-trips with newline framing", () => {
    const hello: HelloMsg = {
      t: "hello", protocolVersion: 1, sessionToken: "tok", childId: "c1", deviceId: "d1", clientVersion: "x",
    };
    const line = encodeControl(hello);
    expect(line.endsWith("\n")).toBe(true);
    const back = decodeControl<HelloMsg>(line.trim());
    expect(back).toEqual(hello);
  });
});
