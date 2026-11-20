export type CadenceMonitorOutcome = "continue" | "step-down" | "fallback";

const WINDOW_MS = 5_000;
const MIN_DUE_CHANGES = 12;
const MISSED_THRESHOLD = 0.2;

/** Uses foreground playback time so hidden and paused time never counts as load. */
export class PlaybackCadenceMonitor {
  private windowStartMs = 0;
  private dueChanges = 0;
  private missedChanges = 0;
  private consecutiveOverloadedWindows = 0;
  private steppedDown = false;

  constructor(
    private readonly requestedFps: number,
    private readonly fallbackFps: number
  ) {}

  record(elapsedMs: number, dueChanges: number, missedChanges: number): CadenceMonitorOutcome {
    this.dueChanges += Math.max(0, dueChanges);
    this.missedChanges += Math.max(0, missedChanges);
    if (elapsedMs - this.windowStartMs < WINDOW_MS) return "continue";

    const overloaded =
      this.dueChanges >= MIN_DUE_CHANGES &&
      this.missedChanges / this.dueChanges > MISSED_THRESHOLD;
    this.windowStartMs = elapsedMs;
    this.dueChanges = 0;
    this.missedChanges = 0;
    this.consecutiveOverloadedWindows = overloaded ? this.consecutiveOverloadedWindows + 1 : 0;

    if (this.consecutiveOverloadedWindows < 2) return "continue";
    if (!this.steppedDown && this.fallbackFps < this.requestedFps) {
      this.steppedDown = true;
      this.consecutiveOverloadedWindows = 0;
      return "step-down";
    }
    return "fallback";
  }
}
