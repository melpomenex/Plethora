export type SyncPhase =
  | "first-paint"
  | "local-usable"
  | "backend-ready"
  | "startup-command"
  | "collections-ready"
  | "first-document-data"
  | "first-queue-data"
  | "background-hydration"
  | "indexeddb-replay"
  | "provider-setup"
  | "migration"
  | "map-ready"
  | "projection"
  | "clock-cache-init"
  | "projection-batch";

export interface SyncPhaseSample {
  phase: SyncPhase;
  startedAt: number;
  durationMs?: number;
  outcome?: "ok" | "error" | "timeout";
  bytes?: number;
  records?: number;
  hasMore?: boolean;
  request?: string;
  surface?: string;
  memoryBytes?: number;
}

export function recordSyncWorkSize(bytes: number, records = 1): void {
  if (!Number.isFinite(bytes) || !Number.isFinite(records)) return;
  // Keep this diagnostic-only and bounded; it must never retain payloads.
  samples.push({
    phase: "projection",
    startedAt: now(),
    durationMs: 0,
    outcome: "ok",
    bytes: Math.max(0, Math.round(bytes)),
    records: Math.max(0, Math.round(records)),
  });
}

const samples: SyncPhaseSample[] = [];
const startupRequestCounts = new Map<string, number>();
let longTaskObserver: PerformanceObserver | null = null;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function usedMemoryBytes(): number | undefined {
  try {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    return memory?.usedJSHeapSize;
  } catch {
    return undefined;
  }
}

export interface SyncPhaseDetails {
  bytes?: number;
  records?: number;
  hasMore?: boolean;
  request?: string;
  surface?: string;
}

export function markSyncPhaseStart(phase: SyncPhase): (details?: SyncPhaseDetails) => void {
  const sample: SyncPhaseSample = { phase, startedAt: now() };
  samples.push(sample);
  return (details) => {
    if (sample.durationMs !== undefined) return;
    sample.durationMs = Math.max(0, now() - sample.startedAt);
    sample.outcome = "ok";
    if (details) Object.assign(sample, details);
    sample.memoryBytes = usedMemoryBytes();
  };
}

export async function measureSyncPhase<T>(phase: SyncPhase, work: () => Promise<T>): Promise<T> {
  const end = markSyncPhaseStart(phase);
  try {
    return await work();
  } catch (error) {
    const sample = samples[samples.length - 1];
    if (sample?.phase === phase) {
      sample.durationMs = Math.max(0, now() - sample.startedAt);
      sample.outcome = "error";
    }
    throw error;
  } finally {
    end();
  }
}

export function getSyncTelemetry(): readonly SyncPhaseSample[] {
  return samples.slice();
}

/** Record a bounded startup request label without retaining its payload. */
export function recordStartupRequest(request: string): void {
  if (!request) return;
  startupRequestCounts.set(request, (startupRequestCounts.get(request) ?? 0) + 1);
}

export function getStartupRequestCounts(): Readonly<Record<string, number>> {
  return Object.fromEntries(startupRequestCounts.entries());
}

export function clearSyncTelemetry(): void {
  samples.length = 0;
  startupRequestCounts.clear();
}

let lastWarnTime = 0;

/** Install once; long tasks are diagnostic only and never alter sync behavior. */
export function installSyncLongTaskObserver(): () => void {
  if (longTaskObserver || typeof PerformanceObserver === "undefined") return () => {};
  try {
    longTaskObserver = new PerformanceObserver((entries) => {
      const nowMs = Date.now();
      if (nowMs - lastWarnTime < 2000) return; // Throttle to max once per 2 seconds
      for (const entry of entries.getEntries()) {
        console.warn("[progressive-sync] long task observed", {
          durationMs: entry.duration,
          startTime: entry.startTime,
        });
        lastWarnTime = nowMs;
        break; // Only log one warning per batch to prevent backpressure
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    longTaskObserver = null;
  }
  return () => {
    longTaskObserver?.disconnect();
    longTaskObserver = null;
  };
}

export function removeSyncLongTaskObserver(): void {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}
