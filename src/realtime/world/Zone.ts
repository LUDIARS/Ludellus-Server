// 1 つの Zone の Channel 群を束ねる。 容量を超えたら新チャンネルを生成 (MMO チャンネル分け)。

import { Channel, type ChannelDeps } from "./Channel.js";
import type { ZoneDef } from "./zoneDefs.js";
import type { PlayerEntity } from "./entities.js";
import type { PlayerSink } from "./PlayerSink.js";

export interface ZoneDeps {
  zone: ZoneDef;
  makeChannelDeps: (channelIndex: number) => ChannelDeps;
}

export interface ChannelAssignment {
  channel: Channel;
  channelIndex: number;
  channelCount: number;
}

export class Zone {
  readonly id: string;
  private readonly channels: Channel[] = [];

  constructor(private readonly deps: ZoneDeps) {
    this.id = deps.zone.id;
  }

  get def(): ZoneDef { return this.deps.zone; }
  get channelCount(): number { return this.channels.length; }
  channelAt(index: number): Channel | undefined { return this.channels[index]; }

  // プレイヤーを配置する。 target で挙動が変わる:
  //  - "auto": 空きのある最初のチャンネル (無ければ新規)
  //  - number: 指定 index (容量超過でも入れる。 パーティ合流用)
  //  - partyWith が示す相手のいるチャンネルへ寄せる (channelSwitch 経由で gateway が解決)
  place(
    entity: PlayerEntity, sink: PlayerSink,
    target: "auto" | number = "auto",
    preferChannelIndex?: number,
  ): ChannelAssignment {
    let channel: Channel;
    let index: number;

    if (typeof target === "number") {
      index = this.ensureChannel(target);
      channel = this.channels[index];
    } else if (preferChannelIndex != null && this.channels[preferChannelIndex]) {
      index = preferChannelIndex;
      channel = this.channels[index];
    } else {
      index = this.firstOpenChannel();
      channel = this.channels[index];
    }

    channel.addPlayer(entity, sink);
    return { channel, channelIndex: index, channelCount: this.channels.length };
  }

  remove(channelIndex: number, entityId: number): void {
    this.channels[channelIndex]?.removePlayer(entityId);
  }

  tick(): void {
    for (const c of this.channels) c.tick();
  }

  // 容量のあるチャンネル index を返す。 無ければ新規生成。
  private firstOpenChannel(): number {
    for (let i = 0; i < this.channels.length; i++) {
      if (this.channels[i].hasCapacity()) return i;
    }
    return this.createChannel();
  }

  private ensureChannel(index: number): number {
    while (this.channels.length <= index) this.createChannel();
    return index;
  }

  private createChannel(): number {
    const index = this.channels.length;
    this.channels.push(new Channel(this.deps.makeChannelDeps(index)));
    return index;
  }
}
