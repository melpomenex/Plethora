export type SyncPhase =
  | "first-paint"
  | "local-usable"
  | "indexeddb-replay"
  | "provider-setup"
  | "migration"
  | "map-ready"
  | "projection";

export interface SyncPhaseSample {
  phase: SyncPhase;
  startedAt: number;
  durationMs?: number;
  outcome?: "ok" | "error" | "timeout";
  bytes?: number;
  records?: number;
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

export function markSyncPhaseStart(phase: SyncPhase): () => void {
  const sample: SyncPhaseSample = { phase, startedAt: now() };
  samples.push(sample);
  return () => {
    if (sample.durationMs !== undefined) return;
    sample.durationMs = Math.max(0, now() - sample.startedAt);
    sample.outcome = "ok";
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

export function clearSyncTelemetry(): void {
  samples.length = 0;
}

/** Install once; long tasks are diagnostic only and never alter sync behavior. */
export function installSyncLongTaskObserver(): () => void {
  if (longTaskObserver || typeof PerformanceObserver === "undefined") return () => {};
  try {
    longTaskObserver = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        console.warn("[progressive-sync] long task observed", {
          durationMs: entry.duration,
          startTime: entry.startTime,
        });
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
