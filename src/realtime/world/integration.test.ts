// MMO 基本システムの end-to-end 統合テスト。
// LoopbackTransport で複数のヘッドレスクライアントを繋ぎ、 自動ログイン / チャンネル分け /
// AOI / 戦闘 + ドロップ / チャット / ユーザ別学習フィールド を実際に走らせて検証する。

import { describe, it, expect, beforeEach } from "vitest";
import { World } from "./World.js";
import { LoopbackTransport } from "../transport/LoopbackTransport.js";
import { RealtimeGateway } from "../gateway/RealtimeGateway.js";
import { AutoLoginAuth } from "../session/Auth.js";
import { StaticProgressSource, type ChildUnitProgress } from "./LearningField.js";
import { HeadlessClient, flush } from "../client/HeadlessClient.js";
import { PROTOCOL_VERSION } from "../protocol/messages.js";
import type { ZoneDef } from "./zoneDefs.js";

const TEST_ZONE: ZoneDef = {
  id: "test_arena",
  label: "テストアリーナ",
  subject: "math",
  size: { w: 800, h: 800 },
  spawn: { x: 400, y: 400 },
  channelCapacity: 2,
  enemies: [{
    enemyType: "dummy", count: 1, hp: 20, damage: 5, speed: 30,
    attackRange: 30, aggroRange: 300, lootTableId: "slime_basic",
  }],
};

const PROGRESS: Record<string, ChildUnitProgress[]> = {
  child_a: [
    { unitId: "math.add", subject: "math", label: "たしざん", mastery: 0.7, recommended: true },
    { unitId: "math.sub", subject: "math", label: "ひきざん", mastery: 0.3, recommended: true },
  ],
  child_b: [
    { unitId: "math.mul", subject: "math", label: "かけざん", mastery: 0.9, recommended: true },
  ],
};

function setup() {
  const transport = new LoopbackTransport();
  const world = new World({
    tickRateHz: 20,
    rng: () => 0.5, // 決定的: 敵は中央スポーン、 ルートは star_shard のみ
    progress: new StaticProgressSource(PROGRESS),
    zones: [TEST_ZONE],
    aoi: { cellSize: 64, viewRadiusCells: 1 }, // 小さめにして AOI 除外を検証可能に
  });
  const auth = new AutoLoginAuth({ protocolVersion: PROTOCOL_VERSION });
  const gw = new RealtimeGateway({ world, transport, auth });
  return { transport, world, gw };
}

function connect(transport: LoopbackTransport, childId: string): HeadlessClient {
  return new HeadlessClient(transport.connect(), { childId, deviceId: `dev_${childId}`, token: "t" });
}

async function joinZone(c: HeadlessClient, zoneId = "test_arena") {
  c.hello();
  await flush();
  c.zoneEnter(zoneId);
  await flush();
}

describe("realtime MMO core — integration", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it("自動ログインで welcome + entityId を受け取る", async () => {
    const c = connect(ctx.transport, "child_a");
    c.hello();
    await flush();
    expect(c.myEntityId).toBeGreaterThan(0);
    expect(c.childDisplay?.name).toBe("うに");
  });

  it("zoneEnter で channelAssign + ユーザ別 fieldManifest を受け取る", async () => {
    const c = connect(ctx.transport, "child_a");
    await joinZone(c);
    expect(c.channel?.zoneId).toBe("test_arena");
    expect(c.channel?.channelIndex).toBe(0);
    // child_a の進捗 (add: rec+mastery0.7 → shared / sub: rec+mastery0.3 → solo)
    const ids = c.fieldPois.map((p) => p.poiId).sort();
    expect(ids).toEqual(["test_arena:math.add", "test_arena:math.sub"]);
    const add = c.fieldPois.find((p) => p.poiId === "test_arena:math.add")!;
    const sub = c.fieldPois.find((p) => p.poiId === "test_arena:math.sub")!;
    expect(add.visibility).toBe("shared");
    expect(sub.visibility).toBe("solo");
  });

  it("学習フィールドはユーザごとに変わる", async () => {
    const a = connect(ctx.transport, "child_a");
    const b = connect(ctx.transport, "child_b");
    await joinZone(a);
    await joinZone(b);
    expect(a.fieldPois.map((p) => p.poiId).sort()).toEqual(["test_arena:math.add", "test_arena:math.sub"]);
    expect(b.fieldPois.map((p) => p.poiId)).toEqual(["test_arena:math.mul"]);
  });

  it("同チャンネルの他プレイヤーが見え、 位置が複製される", async () => {
    const a = connect(ctx.transport, "child_a");
    const b = connect(ctx.transport, "child_b");
    await joinZone(a);
    await joinZone(b);
    ctx.gw.tickOnce();
    await flush();
    // a は b を player として観測している。
    const aSeesB = a.visibleOfKind("player").some((e) => e.entityId === b.myEntityId);
    expect(aSeesB).toBe(true);
    // b が移動 → 次 tick で a 側の座標が更新される。
    b.move(420, 410, 10, 0, 0);
    await flush();
    ctx.gw.tickOnce();
    await flush();
    const bOnA = a.entities.get(b.myEntityId)!;
    expect(bOnA.x).toBeCloseTo(420, 0);
    expect(bOnA.y).toBeCloseTo(410, 0);
  });

  it("AOI: 遠くへ離れたプレイヤーは despawn される", async () => {
    const a = connect(ctx.transport, "child_a");
    const b = connect(ctx.transport, "child_b");
    await joinZone(a);
    await joinZone(b);
    ctx.gw.tickOnce();
    await flush();
    expect(a.entities.has(b.myEntityId)).toBe(true);
    // b を視界外 (cell 距離 > 1) へ。 テレポート防止に掛からないよう速度上限内で刻んで移動。
    for (let step = 1; step <= 7; step++) {
      b.move(400 - step * 25, 400, -220, 0, 0);
      await flush();
    }
    ctx.gw.tickOnce();
    await flush();
    expect(a.entities.has(b.myEntityId)).toBe(false);
  });

  it("チャンネル分け: 容量超過で別チャンネルへシャードされる", async () => {
    const a = connect(ctx.transport, "child_a");
    const b = connect(ctx.transport, "child_b");
    const c = connect(ctx.transport, "child_c");
    await joinZone(a); // ch0
    await joinZone(b); // ch0 (満員)
    await joinZone(c); // ch1
    expect(a.channel?.channelIndex).toBe(0);
    expect(b.channel?.channelIndex).toBe(0);
    expect(c.channel?.channelIndex).toBe(1);
  });

  it("パーティ: partyWith で容量を超えても相手のチャンネルへ合流できる", async () => {
    const a = connect(ctx.transport, "child_a");
    const b = connect(ctx.transport, "child_b");
    const d = connect(ctx.transport, "child_d");
    await joinZone(a); // ch0
    await joinZone(b); // ch0 (満員)
    await joinZone(d); // ch1 (ch0 満員のため)
    expect(d.channel?.channelIndex).toBe(1);
    // child_a (ch0) に合流。 ch0 は満員だがパーティ合流は許可。
    d.channelSwitch("auto", "child_a");
    await flush();
    expect(d.channel?.channelIndex).toBe(0);
  });

  it("戦闘: 敵を攻撃 → 撃破 → ドロップ → 拾得でインベントリ加算", async () => {
    const a = connect(ctx.transport, "child_a");
    await joinZone(a);
    ctx.gw.tickOnce();
    await flush();
    const enemy = a.visibleOfKind("enemy")[0];
    expect(enemy).toBeTruthy();

    a.attack(enemy.entityId, "tentacle"); // 20 → 10
    await flush();
    expect(a.combatLog.at(-1)?.damage).toBe(10);

    for (let i = 0; i < 8; i++) ctx.gw.tickOnce(); // クールダウン消化
    await flush();
    a.attack(enemy.entityId, "tentacle"); // 10 → 0 撃破
    await flush();
    expect(a.deaths.some((d) => d.entityId === enemy.entityId)).toBe(true);

    ctx.gw.tickOnce(); // drop の spawn を配信
    await flush();
    expect(a.drops.length).toBeGreaterThanOrEqual(1);

    const dropId = a.drops[0].dropId;
    a.pickup(dropId);
    await flush();
    expect(a.inventory.find((i) => i.itemId === "star_shard")?.qty).toBe(1);
  });

  it("チャット: zone スコープは同チャンネル全員に届く", async () => {
    const a = connect(ctx.transport, "child_a");
    const b = connect(ctx.transport, "child_b");
    await joinZone(a);
    await joinZone(b);
    a.chat("zone", "こんにちは");
    await flush();
    expect(b.chatLog.at(-1)?.text).toBe("こんにちは");
    expect(a.chatLog.at(-1)?.text).toBe("こんにちは");
  });

  it("POI: shared POI を start すると参加者が同チャンネルへ通知される", async () => {
    const a = connect(ctx.transport, "child_a");
    await joinZone(a);
    ctx.gw.tickOnce();
    await flush();
    a.poiInteract("test_arena:math.add", "start");
    await flush();
    const st = a.poiStates.get("test_arena:math.add");
    expect(st?.state).toBe("in_progress");
    expect(st?.participants).toContain(a.myEntityId);
  });
});
