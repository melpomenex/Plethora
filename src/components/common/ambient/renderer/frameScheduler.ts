/**
 * Timestamp-paced requestAnimationFrame scheduler.
 *
 * One pending handle at all times, idempotent stop, restart-safe, and cheap
 * per-frame cost measurement (performance.now delta around the draw call).
 * The pacing gate is the accumulator-free pattern proven by the original
 * ThemeBackdrop loop: `elapsed >= interval` with remainder carry.
 */

export interface FrameSchedulerHooks {
  /** Draw one frame. Receives the rAF timestamp (ms). */
  draw: (timestampMs: number) => void;
  /** Measured cost of the draw (ms), when the scheduler did the timing. */
  onFrameCost?: (costMs: number) => void;
}

export interface FrameScheduler {
  /** (Re)start scheduling at `fps`. No-op if already running at the same fps. */
  start(fps: number): void;
  /** Change fps while running (applies from the next gate check). */
  setFps(fps: number): void;
  /** Cancel the pending rAF. Safe to call repeatedly. */
  stop(): void;
  readonly running: boolean;
  /** Number of gate rejections (rAF ticks that drew nothing) since start. */
  readonly skipped: number;
}

export function createFrameScheduler(hooks: FrameSchedulerHooks): FrameScheduler {
  let rafId: number | null = null;
  let intervalMs = 0;
  let lastTime = 0;
  let skipped = 0;
  let isRunning = false;

  const tick = (timestamp: number) => {
    rafId = null;
    if (!isRunning) return;
    const elapsed = timestamp - lastTime;
    if (intervalMs > 0 && elapsed < intervalMs) {
      skipped++;
      schedule();
      return;
    }
    if (intervalMs > 0) {
      lastTime = timestamp - (elapsed % intervalMs);
    } else {
      lastTime = timestamp;
    }
    const startedAt = now();
    hooks.draw(timestamp);
    hooks.onFrameCost?.(Math.max(0, now() - startedAt));
    if (isRunning) schedule();
  };

  const schedule = () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  };

  return {
    start(fps: number) {
      const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 0;
      intervalMs = safeFps > 0 ? 1000 / safeFps : 0;
      if (isRunning) return;
      isRunning = true;
      lastTime = 0;
      skipped = 0;
      schedule();
    },
    setFps(fps: number) {
      const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 0;
      intervalMs = safeFps > 0 ? 1000 / safeFps : 0;
    },
    stop() {
      isRunning = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
    get running() {
      return isRunning;
    },
    get skipped() {
      return skipped;
    },
  };
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
