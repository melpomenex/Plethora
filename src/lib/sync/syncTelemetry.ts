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

export const MAX_SYNC_TELEMETRY_SAMPLES = 1000;
const samples: SyncPhaseSample[] = [];

function appendSample(sample: SyncPhaseSample): void {
  samples.push(sample);
  if (samples.length > MAX_SYNC_TELEMETRY_SAMPLES) {
    samples.splice(0, samples.length - MAX_SYNC_TELEMETRY_SAMPLES);
  }
}

export function recordSyncWorkSize(bytes: number, records = 1): void {
  if (!Number.isFinite(bytes) || !Number.isFinite(records)) return;
  // Keep this diagnostic-only and bounded; it must never retain payloads.
  appendSample({
    phase: "projection",
    startedAt: now(),
    durationMs: 0,
    outcome: "ok",
    bytes: Math.max(0, Math.round(bytes)),
    records: Math.max(0, Math.round(records)),
  });
}

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
  outcome?: "ok" | "error" | "timeout";
  bytes?: number;
  records?: number;
  hasMore?: boolean;
  request?: string;
  surface?: string;
}

export function markSyncPhaseStart(phase: SyncPhase): (details?: SyncPhaseDetails) => void {
  const sample: SyncPhaseSample = { phase, startedAt: now() };
  appendSample(sample);
  return (details) => {
    if (sample.durationMs !== undefined) return;
    sample.durationMs = Math.max(0, now() - sample.startedAt);
    sample.outcome = "ok";
    if (details) Object.assign(sample, details);
    sample.memoryBytes = usedMemoryBytes();
    writeNativeSyncPhaseLog(sample);
  };
}

export async function measureSyncPhase<T>(phase: SyncPhase, work: () => Promise<T>): Promise<T> {
  const end = markSyncPhaseStart(phase);
  try {
    return await work();
  } catch (error) {
    end({ outcome: "error" });
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

let lastNativeLogAt = 0;
let nativeLogPromise: Promise<((message: string) => Promise<void>) | null> | null = null;

/** Mirror compact phase summaries to the native sink without blocking boot. */
function writeNativeSyncPhaseLog(sample: SyncPhaseSample): void {
  const timestamp = Date.now();
  if (timestamp - lastNativeLogAt < 250) return;
  lastNativeLogAt = timestamp;
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return;
  if (!nativeLogPromise) {
    nativeLogPromise = import("@tauri-apps/plugin-log")
      .then((log) => (log.info ? (message: string) => log.info(message) : null))
      .catch(() => null);
  }
  const summary = `[sync-telemetry] phase=${sample.phase} durationMs=${Math.round(sample.durationMs ?? 0)} records=${sample.records ?? 0} bytes=${sample.bytes ?? 0} outcome=${sample.outcome ?? "unknown"}`;
  void nativeLogPromise.then((write) => write?.(summary)).catch(() => {});
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
