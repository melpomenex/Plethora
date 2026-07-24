export type SyncLane = "P0" | "P1" | "P2" | "P3";

export interface SyncWorkContext {
  lane: SyncLane;
  deadline: number;
  signal: AbortSignal;
  shouldYield: () => boolean;
  yield: () => Promise<void>;
  checkpoint: (value: unknown) => Promise<void>;
}

export interface SyncWorkItem {
  id: string;
  lane: SyncLane;
  run: (context: SyncWorkContext) => void | Promise<void>;
  /** `sliceable` work must consult the cooperative context before continuing. */
  kind?: "atomic" | "sliceable";
  /** Approximate bytes retained while this item is running. */
  estimatedBytes?: number;
  checkpoint?: (value: unknown) => void | Promise<void>;
  /** A lower number is older/higher priority inside the same lane. */
  enqueuedAt?: number;
  attempts?: number;
  maxRetries?: number;
}

export interface ProgressiveSchedulerOptions {
  sliceMs?: number;
  maxItemsPerSlice?: number;
  byteBudget?: number;
  now?: () => number;
  inputPending?: () => boolean;
  visible?: () => boolean;
  onQuarantine?: (domain: string, item: SyncWorkItem, error: unknown) => void | Promise<void>;
}

type SchedulerWindow = Window & {
  scheduler?: {
    postTask?: (callback: () => void, options?: { priority?: string; delay?: number }) => Promise<unknown>;
  };
};

const LANES: SyncLane[] = ["P0", "P1", "P2", "P3"];
const LANE_WEIGHT: Record<SyncLane, number> = { P0: 8, P1: 4, P2: 2, P3: 1 };

/**
 * Small cooperative queue used to keep the existing sync adapters off the
 * critical render path. It deliberately has no dependency on Yjs or Tauri so
 * it can be tested in isolation and reused by migration/audit workers.
 */
export class ProgressiveSyncScheduler {
  private readonly queues: Record<SyncLane, SyncWorkItem[]> = {
    P0: [], P1: [], P2: [], P3: [],
  };
  private readonly sliceMs: number;
  private readonly maxItemsPerSlice: number;
  private readonly byteBudget: number;
  private readonly now: () => number;
  private readonly inputPending: () => boolean;
  private readonly visible: () => boolean;
  private readonly onQuarantine?: ProgressiveSchedulerOptions["onQuarantine"];
  private currentSliceMs: number;
  private scheduled = false;
  private running = false;
  private disposed = false;
  private wake: (() => void) | null = null;
  private controller = new AbortController();
  private completed = 0;
  private failed = 0;
  private lastHeartbeatAt = 0;
  private readonly quarantinedDomains = new Set<string>();
  private bytesInFlight = 0;

  constructor(options: ProgressiveSchedulerOptions = {}) {
    this.sliceMs = options.sliceMs ?? 4;
    this.currentSliceMs = this.sliceMs;
    this.maxItemsPerSlice = options.maxItemsPerSlice ?? 8;
    this.byteBudget = options.byteBudget ?? this.defaultByteBudget();
    this.now = options.now ?? (() => performance.now());
    this.inputPending = options.inputPending ?? (() => {
      try {
        return Boolean((navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }).scheduling?.isInputPending?.());
      } catch {
        return false;
      }
    });
    this.visible = options.visible ?? (() => typeof document === "undefined" || !document.hidden);
    this.onQuarantine = options.onQuarantine;
  }

  enqueue(item: SyncWorkItem): void {
    if (this.disposed) return;
    if (this.quarantinedDomains.has(this.domainOf(item.id))) return;
    const queue = this.queues[item.lane];
    // Idempotent task IDs prevent repeated boot triggers from multiplying work.
    if (queue.some((existing) => existing.id === item.id)) return;
    queue.push({ ...item, enqueuedAt: item.enqueuedAt ?? this.now() });
    this.schedule();
  }

  enqueueMany(items: SyncWorkItem[]): void {
    for (const item of items) this.enqueue(item);
  }

  cancel(id: string): boolean {
    for (const lane of LANES) {
      const index = this.queues[lane].findIndex((item) => item.id === id);
      if (index >= 0) {
        this.queues[lane].splice(index, 1);
        return true;
      }
    }
    return false;
  }

  stats(): { queued: number; completed: number; failed: number; running: boolean; bytesInFlight: number; byteBudget: number } {
    return {
      queued: LANES.reduce((total, lane) => total + this.queues[lane].length, 0),
      completed: this.completed,
      failed: this.failed,
      running: this.running,
      bytesInFlight: this.bytesInFlight,
      byteBudget: this.byteBudget,
    };
  }

  health(): { lastHeartbeatAt: number; quarantinedDomains: string[] } {
    return { lastHeartbeatAt: this.lastHeartbeatAt, quarantinedDomains: Array.from(this.quarantinedDomains) };
  }

  resetCircuit(domain: string): void {
    this.quarantinedDomains.delete(domain);
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.controller.abort();
    for (const lane of LANES) this.queues[lane].length = 0;
    this.wake?.();
    this.wake = null;
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    const callback = () => {
      this.scheduled = false;
      void this.drain();
    };
    const schedulerWindow = typeof window !== "undefined" ? window as SchedulerWindow : null;
    if (schedulerWindow?.scheduler?.postTask) {
      void schedulerWindow.scheduler.postTask(callback, { priority: "background" });
    } else if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(callback, { timeout: 1000 });
    } else if (typeof MessageChannel !== "undefined" && !isTestRuntime()) {
      const channel = new MessageChannel();
      channel.port1.onmessage = callback;
      channel.port2.postMessage(undefined);
    } else {
      setTimeout(callback, 0);
    }
  }

  private pickNext(): SyncWorkItem | undefined {
    const now = this.now();
    let selected: SyncWorkItem | undefined;
    let selectedScore = -Infinity;
    for (const lane of LANES) {
      const candidate = this.queues[lane][0];
      if (!candidate) continue;
      const estimate = this.estimateBytes(candidate);
      // Keep a single oversized transfer schedulable, but do not start an
      // additional estimated item while the current working set is over budget.
      if (this.bytesInFlight > 0 && this.bytesInFlight + estimate > this.byteBudget) continue;
      // Aging prevents P2/P3 starvation during a busy interactive session.
      const ageBonus = Math.min(4, Math.floor(Math.max(0, now - (candidate.enqueuedAt ?? now)) / 1000));
      const score = LANE_WEIGHT[lane] + ageBonus;
      if (score > selectedScore) {
        selected = candidate;
        selectedScore = score;
      }
    }
    if (!selected) return undefined;
    this.queues[selected.lane].shift();
    return selected;
  }

  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    const started = this.now();
    const sliceBudget = this.effectiveSliceMs();
    let processed = 0;
    try {
      this.lastHeartbeatAt = this.now();
      while (!this.disposed && processed < this.maxItemsPerSlice) {
        const item = this.pickNext();
        if (!item) break;
        if (item.lane !== "P0" && (!this.visible() || this.inputPending())) {
          this.queues[item.lane].unshift(item);
          break;
        }
        const deadline = this.now() + sliceBudget;
        const estimatedBytes = this.estimateBytes(item);
        this.bytesInFlight += estimatedBytes;
        let yielded = false;
        const context: SyncWorkContext = {
          lane: item.lane,
          deadline,
          signal: this.controller.signal,
          shouldYield: () => this.controller.signal.aborted || this.now() >= deadline || (item.lane !== "P0" && this.inputPending()),
          yield: () => {
            yielded = true;
            return this.yieldToHost();
          },
          checkpoint: async (value) => {
            if (item.checkpoint) await item.checkpoint(value);
          },
        };
        try {
          await item.run(context);
          if (item.kind === "sliceable" && isDevRuntime() && !yielded && this.now() - (deadline - sliceBudget) > sliceBudget * 4) {
            console.warn(`[progressive-sync] sliceable item ${item.id} ran past ${sliceBudget * 4}ms without calling yield()`);
          }
          this.completed += 1;
        } catch (error) {
          this.failed += 1;
          console.warn(`[progressive-sync] work item failed: ${item.id}`, error);
          const attempts = (item.attempts ?? 0) + 1;
          const maxRetries = item.maxRetries ?? 3;
          if (attempts <= maxRetries) {
            const retryDelay = Math.min(30_000, 250 * 2 ** (attempts - 1));
            setTimeout(() => this.enqueue({ ...item, attempts }), retryDelay);
          } else {
            const domain = this.domainOf(item.id);
            this.quarantinedDomains.add(domain);
            void this.onQuarantine?.(domain, item, error);
          }
        } finally {
          this.bytesInFlight = Math.max(0, this.bytesInFlight - estimatedBytes);
        }
        processed += 1;
        if (this.now() - started >= sliceBudget || this.inputPending()) break;
      }
    } finally {
      const observed = this.now() - started;
      if (observed > sliceBudget * 1.5) {
        this.currentSliceMs = Math.max(1, this.currentSliceMs - 1);
      } else if (observed < sliceBudget * 0.5 && this.currentSliceMs < this.sliceMs * 2) {
        this.currentSliceMs += 1;
      }
      this.running = false;
      if (!this.disposed && this.stats().queued > 0) this.schedule();
    }
  }

  private domainOf(id: string): string {
    return id.split(":", 1)[0] || id;
  }

  private estimateBytes(item: SyncWorkItem): number {
    const value = item.estimatedBytes;
    return Number.isFinite(value) && value && value > 0 ? Math.round(value) : 0;
  }

  private defaultByteBudget(): number {
    try {
      const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      if (memory !== undefined && memory <= 2) return 64 * 1024 * 1024;
    } catch {
      // WKWebView does not expose deviceMemory; retain the portable default.
    }
    return 256 * 1024 * 1024;
  }

  private effectiveSliceMs(): number {
    let budget = this.currentSliceMs;
    try {
      const nav = navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean; effectiveType?: string };
      };
      if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) budget = Math.min(budget, 2);
      if (nav.connection?.saveData || nav.connection?.effectiveType === "slow-2g") budget = Math.min(budget, 2);
    } catch {
      // Conservative base budget when resource hints are unavailable.
    }
    if (!this.visible()) budget = Math.min(budget, 1);
    return Math.max(1, budget);
  }

  private yieldToHost(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          this.wake = null;
          resolve();
        });
      } else {
        setTimeout(() => {
          this.wake = null;
          resolve();
        }, 0);
      }
    });
  }
}

function isTestRuntime(): boolean {
  try {
    return Boolean((globalThis as { process?: { env?: { VITEST?: string } } }).process?.env?.VITEST);
  } catch {
    return false;
  }
}

function isDevRuntime(): boolean {
  try {
    const viteEnv = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env;
    if (viteEnv?.PROD) return false;
    const env = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env;
    return env?.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

let sharedScheduler: ProgressiveSyncScheduler | null = null;

export function getProgressiveSyncScheduler(): ProgressiveSyncScheduler {
  if (!sharedScheduler) sharedScheduler = new ProgressiveSyncScheduler();
  return sharedScheduler;
}

export function resetProgressiveSyncSchedulerForTest(): void {
  sharedScheduler?.dispose();
  sharedScheduler = null;
}

/** Enqueue one async operation and resolve when its bounded phase completes. */
export function scheduleProgressiveSyncWork<T>(
  item: Omit<SyncWorkItem, "run"> & { run: (context: SyncWorkContext) => T | Promise<T> },
): Promise<T> {
  const scheduler = getProgressiveSyncScheduler();
  return new Promise<T>((resolve, reject) => {
    scheduler.enqueue({
      ...item,
      run: async (context) => {
        try {
          resolve(await item.run(context));
        } catch (error) {
          reject(error);
          throw error;
        }
      },
    });
  });
}
