import { describe, expect, it, vi } from "vitest";
import type { AnimatedImagePack } from "../../../../themes/animatedImage/contracts";
import { FramePackPlayer, type FramePackPlayerClock } from "../framePackPlayer";

class FakeClock implements FramePackPlayerClock {
  time = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();

  now = () => this.time;

  setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delayMs, callback });
    return id;
  };

  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };

  advance(ms: number): void {
    const target = this.time + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
    }
    this.time = target;
  }

  jump(ms: number): void {
    this.time += ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= this.time)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

function makePack(plays: AnimatedImagePack["plays"] = "infinite"): AnimatedImagePack {
  const still = new Blob(["frame"], { type: "image/png" });
  return {
    version: 1,
    mediaId: "anim-12345678-1234-4234-8234-123456789abc",
    sourceFormat: "gif",
    sourceWidth: 2,
    sourceHeight: 1,
    width: 2,
    height: 1,
    durationMs: 100,
    plays,
    frames: [
      { startMs: 0, durationMs: 50, still, width: 2, height: 1 },
      { startMs: 50, durationMs: 50, still, width: 2, height: 1 },
    ],
    byteLength: still.size * 2,
    droppedTransitions: false,
  };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("FramePackPlayer", () => {
  it("presents frames serially at its cadence and stops after finite plays", async () => {
    const clock = new FakeClock();
    const presented: number[] = [];
    const decode = vi.fn(async () => ({ close: vi.fn() }));
    const player = new FramePackPlayer({
      pack: makePack(1),
      maxFps: 20,
      decode,
      present: (_image, frame) => presented.push(frame.startMs),
      onFallback: vi.fn(),
      clock,
    });

    player.start();
    await flushPromises();
    expect(presented).toEqual([0]);
    expect(decode).toHaveBeenCalledTimes(1);

    clock.advance(49);
    await flushPromises();
    expect(decode).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await flushPromises();
    expect(presented).toEqual([0, 50]);

    clock.advance(50);
    await flushPromises();
    clock.advance(100);
    await flushPromises();
    expect(presented).toEqual([0, 50]);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(clock.timers.size).toBe(0);
    player.stop();
  });

  it("parks without decoding while paused and resumes from saved elapsed time", async () => {
    const clock = new FakeClock();
    const presented: number[] = [];
    const decode = vi.fn(async () => ({ close: vi.fn() }));
    const player = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      decode,
      present: (_image, frame) => presented.push(frame.startMs),
      onFallback: vi.fn(),
      clock,
    });

    player.start();
    await flushPromises();
    clock.advance(20);
    player.pause();
    clock.advance(1_000);
    await flushPromises();
    expect(decode).toHaveBeenCalledTimes(1);

    player.resume();
    clock.advance(50);
    await flushPromises();
    expect(presented).toEqual([0, 50]);
    player.stop();
  });

  it("drops a late decode whose frame is no longer due", async () => {
    const clock = new FakeClock();
    let resolveFirst!: (value: { close: () => void }) => void;
    const presented: number[] = [];
    const onFallback = vi.fn();
    const decode = vi.fn()
      .mockImplementationOnce(() => new Promise<{ close: () => void }>((resolve) => { resolveFirst = resolve; }))
      .mockImplementation(async () => ({ close: vi.fn() }));
    const player = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      decode,
      present: (_image, frame) => presented.push(frame.startMs),
      onFallback,
      clock,
    });

    player.start();
    await flushPromises();
    clock.advance(60);
    resolveFirst({ close: vi.fn() });
    await flushPromises();
    expect(decode).toHaveBeenCalledTimes(2);
    expect(presented, JSON.stringify({ time: clock.time, fallback: onFallback.mock.calls })).toEqual([50]);
    player.stop();
  });

  it("closes a late decode without painting after owner teardown", async () => {
    const clock = new FakeClock();
    let resolveDecode!: (value: { width: number; height: number; close: () => void }) => void;
    const close = vi.fn();
    const present = vi.fn();
    const player = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      decode: () => new Promise((resolve) => { resolveDecode = resolve; }),
      present,
      onFallback: vi.fn(),
      clock,
    });

    player.start();
    await flushPromises();
    player.stop();
    resolveDecode({ width: 2, height: 1, close });
    await flushPromises();
    expect(present).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not start a second owner's decode while a previous engine decode is settling", async () => {
    const clock = new FakeClock();
    let resolveFirst!: (value: { close: () => void }) => void;
    const firstDecode = vi.fn(() => new Promise<{ close: () => void }>((resolve) => { resolveFirst = resolve; }));
    const secondDecode = vi.fn(async () => ({ close: vi.fn() }));
    const first = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      decode: firstDecode,
      present: vi.fn(),
      onFallback: vi.fn(),
      clock,
    });
    const secondFallback = vi.fn();
    const second = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      decode: secondDecode,
      present: vi.fn(),
      onFallback: secondFallback,
      clock,
    });

    first.start();
    await flushPromises();
    first.stop();
    second.start();
    await flushPromises();
    expect(secondDecode).not.toHaveBeenCalled();
    expect(secondFallback).toHaveBeenCalledWith("decode-failed");

    resolveFirst({ close: vi.fn() });
    await flushPromises();
  });

  it("falls back on a stuck decoder and closes its eventual result", async () => {
    const clock = new FakeClock();
    let resolveDecode!: (value: { width: number; height: number; close: () => void }) => void;
    const close = vi.fn();
    const onFallback = vi.fn();
    const player = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      decode: () => new Promise((resolve) => { resolveDecode = resolve; }),
      present: vi.fn(),
      onFallback,
      clock,
      decodeTimeoutMs: 250,
    });

    player.start();
    await flushPromises();
    clock.advance(250);
    await flushPromises();
    expect(onFallback).toHaveBeenCalledWith("decode-timeout");

    resolveDecode({ width: 2, height: 1, close });
    await flushPromises();
    expect(close).toHaveBeenCalledOnce();
  });

  it("steps down once after repeated missed windows and falls back if overload persists", async () => {
    const clock = new FakeClock();
    const onCadenceStepDown = vi.fn();
    const onFallback = vi.fn();
    const player = new FramePackPlayer({
      pack: makePack(),
      maxFps: 20,
      fallbackFps: 10,
      decode: vi.fn(async () => ({ close: vi.fn() })),
      present: vi.fn(),
      onFallback,
      onCadenceStepDown,
      clock,
    });

    player.start();
    await flushPromises();
    clock.jump(5_000);
    await flushPromises();
    expect(onCadenceStepDown).not.toHaveBeenCalled();

    clock.jump(5_000);
    await flushPromises();
    expect(onCadenceStepDown).toHaveBeenCalledOnce();

    clock.jump(5_000);
    await flushPromises();
    expect(onFallback).not.toHaveBeenCalled();

    clock.jump(5_000);
    await flushPromises();
    expect(onFallback).toHaveBeenCalledWith("cadence-overload");
  });
});
