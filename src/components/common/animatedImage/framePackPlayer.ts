import type { AnimatedImagePack, AnimatedImageFrame } from "../../../themes/animatedImage/contracts";
import { PlaybackCadenceMonitor } from "./cadenceMonitor";

export interface DecodedFrame {
  close?: () => void;
}

export interface FramePackPlayerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(id: number): void;
}

export interface FramePackPlayerOptions<T extends DecodedFrame> {
  readonly pack: AnimatedImagePack;
  readonly maxFps: number;
  readonly decode: (blob: Blob) => Promise<T>;
  readonly present: (frame: T, metadata: AnimatedImageFrame) => void;
  readonly onFallback: (reason: "decode-failed" | "decode-timeout" | "present-failed" | "cadence-overload") => void;
  readonly clock?: FramePackPlayerClock;
  readonly decodeTimeoutMs?: number;
  readonly fallbackFps?: number;
  readonly onCadenceStepDown?: () => void;
}

const defaultClock: FramePackPlayerClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (id) => window.clearTimeout(id),
};

/** Serial still-frame playback. It owns at most one decode and never paints stale work. */
export class FramePackPlayer<T extends DecodedFrame = ImageBitmap> {
  private readonly clock: FramePackPlayerClock;
  private intervalMs: number;
  private readonly fallbackFps: number;
  private readonly cadenceMonitor: PlaybackCadenceMonitor;
  private readonly decodeTimeoutMs: number;
  private timer: number | null = null;
  private generation = 0;
  private active = false;
  private paused = false;
  private decoding = false;
  private elapsedBeforePause = 0;
  private startedAt = 0;
  private lastPresentedIndex = -1;
  private lastRequestedIndex = -1;

  constructor(private readonly options: FramePackPlayerOptions<T>) {
    this.clock = options.clock ?? defaultClock;
    this.intervalMs = 1000 / Math.max(1, options.maxFps);
    this.fallbackFps = options.fallbackFps ?? Math.max(1, options.maxFps / 2);
    this.cadenceMonitor = new PlaybackCadenceMonitor(options.maxFps, this.fallbackFps);
    this.decodeTimeoutMs = options.decodeTimeoutMs ?? 2_000;
  }

  start(paused = false): void {
    if (this.active) return;
    this.active = true;
    this.paused = paused;
    this.elapsedBeforePause = 0;
    this.startedAt = this.clock.now();
    if (!paused) this.tick();
  }

  pause(): void {
    if (!this.active || this.paused) return;
    this.elapsedBeforePause += Math.max(0, this.clock.now() - this.startedAt);
    this.paused = true;
    this.generation += 1;
    this.lastRequestedIndex = this.lastPresentedIndex;
    this.clearScheduledTick();
  }

  resume(): void {
    if (!this.active || !this.paused) return;
    this.paused = false;
    this.startedAt = this.clock.now();
    this.generation += 1;
    this.tick();
  }

  stop(): void {
    this.active = false;
    this.paused = false;
    this.generation += 1;
    this.clearScheduledTick();
  }

  private tick(): void {
    if (!this.active || this.paused || this.decoding) return;
    const elapsed = this.elapsedBeforePause + Math.max(0, this.clock.now() - this.startedAt);
    if (!this.applyCadenceOutcome(this.cadenceMonitor.record(elapsed, 0, 0))) return;
    const totalDuration = this.options.pack.plays === "infinite"
      ? Number.POSITIVE_INFINITY
      : this.options.pack.durationMs * this.options.pack.plays;
    const finished = this.options.pack.plays !== "infinite" && elapsed >= totalDuration;
    const frameIndex = finished
      ? this.options.pack.frames.length - 1
      : frameIndexAt(this.options.pack.frames, elapsed % this.options.pack.durationMs);

    if (frameIndex === this.lastRequestedIndex) {
      if (finished) {
        this.active = false;
        return;
      }
      this.scheduleTick();
      return;
    }

    if (this.lastRequestedIndex >= 0) {
      if (!this.applyCadenceOutcome(this.cadenceMonitor.record(elapsed, 1, 0))) return;
    }
    this.lastRequestedIndex = frameIndex;
    this.decodeFrame(frameIndex);
  }

  private decodeFrame(frameIndex: number): void {
    const frame = this.options.pack.frames[frameIndex];
    if (!frame) {
      this.fail("decode-failed");
      return;
    }
    const requestGeneration = this.generation;
    this.decoding = true;
    let timedOut = false;
    let timeoutId: number | null = null;

    const decodePromise = decodeExclusive(frame.still, this.options.decode);
    // A decode engine may finish after the player has stopped. Keep a close
    // handler attached so that late bitmaps do not leak.
    void decodePromise.then((decoded) => {
      if (timedOut) closeDecoded(decoded);
    }, () => undefined);

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = this.clock.setTimeout(() => {
        timedOut = true;
        reject(new FrameDecodeTimeoutError());
      }, this.decodeTimeoutMs);
    });

    void Promise.race([decodePromise, timeoutPromise]).then((decoded) => {
      if (timeoutId !== null) this.clock.clearTimeout(timeoutId);
      this.decoding = false;
      if (!this.active || this.paused || requestGeneration !== this.generation) {
        closeDecoded(decoded);
        if (this.active && !this.paused) this.tick();
        return;
      }

      const elapsedNow = this.elapsedBeforePause + Math.max(0, this.clock.now() - this.startedAt);
      const totalDuration = this.options.pack.plays === "infinite"
        ? Number.POSITIVE_INFINITY
        : this.options.pack.durationMs * this.options.pack.plays;
      const finishedNow = this.options.pack.plays !== "infinite" && elapsedNow >= totalDuration;
      const dueIndex = finishedNow
        ? this.options.pack.frames.length - 1
        : frameIndexAt(this.options.pack.frames, elapsedNow % this.options.pack.durationMs);
      if (dueIndex !== frameIndex) {
        closeDecoded(decoded);
        if (!this.applyCadenceOutcome(this.cadenceMonitor.record(elapsedNow, 0, 1))) return;
        this.tick();
        return;
      }

      try {
        this.options.present(decoded, frame);
        this.lastPresentedIndex = frameIndex;
      } catch {
        closeDecoded(decoded);
        this.fail("present-failed");
        return;
      }
      closeDecoded(decoded);

      if (finishedNow) {
        this.active = false;
        return;
      }
      this.scheduleTick();
    }).catch((error: unknown) => {
      if (timeoutId !== null) this.clock.clearTimeout(timeoutId);
      this.decoding = false;
      if (!this.active || requestGeneration !== this.generation) return;
      this.fail(error instanceof FrameDecodeTimeoutError ? "decode-timeout" : "decode-failed");
    });
  }

  private scheduleTick(): void {
    this.clearScheduledTick();
    const expectedAt = this.clock.now() + this.intervalMs;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      const now = this.clock.now();
      const missedSlots = Math.floor(Math.max(0, now - expectedAt) / this.intervalMs);
      const elapsed = this.elapsedBeforePause + Math.max(0, now - this.startedAt);
      if (!this.applyCadenceOutcome(this.cadenceMonitor.record(elapsed, missedSlots, missedSlots))) return;
      this.tick();
    }, this.intervalMs);
  }

  private clearScheduledTick(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private applyCadenceOutcome(outcome: ReturnType<PlaybackCadenceMonitor["record"]>): boolean {
    if (outcome === "step-down") {
      this.intervalMs = 1000 / this.fallbackFps;
      this.options.onCadenceStepDown?.();
    } else if (outcome === "fallback") {
      this.fail("cadence-overload");
      return false;
    }
    return true;
  }

  private fail(reason: "decode-failed" | "decode-timeout" | "present-failed" | "cadence-overload"): void {
    this.active = false;
    this.generation += 1;
    this.clearScheduledTick();
    this.options.onFallback(reason);
  }
}

export function frameIndexAt(frames: readonly AnimatedImageFrame[], cycleOffsetMs: number): number {
  let low = 0;
  let high = frames.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const frame = frames[middle];
    if (cycleOffsetMs < frame.startMs) high = middle - 1;
    else if (cycleOffsetMs >= frame.startMs + frame.durationMs) low = middle + 1;
    else return middle;
  }
  return Math.max(0, Math.min(frames.length - 1, high));
}

function closeDecoded(decoded: DecodedFrame): void {
  try {
    decoded.close?.();
  } catch {
    // Resource cleanup remains best-effort for engine-owned decoded frames.
  }
}

let decodeSlotBusy = false;

function decodeExclusive<T extends DecodedFrame>(blob: Blob, decode: (blob: Blob) => Promise<T>): Promise<T> {
  if (decodeSlotBusy) return Promise.reject(new Error("An earlier image-frame decode is still settling."));
  decodeSlotBusy = true;
  return Promise.resolve()
    .then(() => decode(blob))
    .finally(() => { decodeSlotBusy = false; });
}

class FrameDecodeTimeoutError extends Error {}

