import { describe, it, expect, vi, beforeEach } from "vitest";

const notifyMock = vi.fn();
const parentMock = vi.fn();

vi.mock("../db/memoria.js", () => ({
  notifyMemoria: (p: unknown) => notifyMock(p),
}));
vi.mock("../db/profiles.js", () => ({
  getParentUserId: (c: string) => parentMock(c),
}));

const { outcomeOf, buildMemoriaPayload, notifyPoiResult } = await import("./poiResultNotify.js");

describe("poiResultNotify", () => {
  beforeEach(() => {
    notifyMock.mockReset();
    parentMock.mockReset();
  });

  it("outcomeOf: 目標到達で win, 未達で lose", () => {
    expect(outcomeOf({ score: 8, total: 8 })).toBe("win");
    expect(outcomeOf({ score: 9, total: 8 })).toBe("win");
    expect(outcomeOf({ score: 5, total: 8 })).toBe("lose");
    expect(outcomeOf({ score: 0, total: 0 })).toBe("win"); // 異常 total は win 扱い
  });

  it("buildMemoriaPayload: 教科・勝敗・集計値を写像する", () => {
    const p = buildMemoriaPayload(
      { childId: "child_1", poiId: "arena:math.add", subject: "math", result: { score: 8, total: 8, durationMs: 1234 } },
      "user_1",
    );
    expect(p.userId).toBe("user_1");
    expect(p.childId).toBe("child_1");
    expect(p.kind).toBe("ludellus.session");
    expect(p.gameId).toBe("arena:math.add");
    expect(p.score).toBe(8);
    expect(p.total).toBe(8);
    expect(p.unitTags).toEqual(["math"]);
    expect(p.durationMs).toBe(1234);
    expect(p.result).toBe("win");
  });

  it("notifyPoiResult: 親 userId が引ければ Memoria に通知する", async () => {
    parentMock.mockResolvedValue("user_42");
    await notifyPoiResult({
      childId: "child_9", poiId: "arena:kokugo.hira", subject: "kokugo",
      result: { score: 3, total: 6, durationMs: 500 },
    });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const payload = notifyMock.mock.calls[0][0];
    expect(payload.userId).toBe("user_42");
    expect(payload.result).toBe("lose");
    expect(payload.unitTags).toEqual(["kokugo"]);
  });

  it("notifyPoiResult: 親が引けなければ通知しない", async () => {
    parentMock.mockResolvedValue(null);
    await notifyPoiResult({
      childId: "orphan", poiId: "arena:math.add", subject: "math",
      result: { score: 8, total: 8, durationMs: 100 },
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
