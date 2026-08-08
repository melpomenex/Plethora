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
  | "indexeddb-compact"
  | "provider-setup"
  | "migration"
  | "map-ready"
  | "projection"
  | "clock-cache-init"
  | "startup-subsystem"
  | "projection-batch"
  | "tab-switch"
  // migrate-sync-to-delta-log (task 7.6): the delta-log transport's phases,
  // additive alongside the Yjs-era ones above (indexeddb-replay,
  // indexeddb-compact, provider-setup) — those are removed from this union
  // only at Phase 9 retirement, once the code that emits them is deleted.
  | "delta-log-pull-page"
  | "delta-log-projection"
  | "delta-log-cursor-advance"
  | "delta-log-push-drain";

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
  queued?: number;
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
  queued?: number;
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

/** Measure one named phase of the sync boot chain for the diagnostics panel. */
export async function measureStartupPhase<T>(name: string, work: () => Promise<T>): Promise<T> {
  const end = markSyncPhaseStart("startup-subsystem");
  try {
    const result = await work();
    end({ outcome: "ok", surface: name });
    return result;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "StartupTimeoutError";
    end({ outcome: timedOut ? "timeout" : "error", surface: name });
    throw error;
  }
}

function shouldMeasureTabSwitches(): boolean {
  try {
    if (import.meta.env?.DEV) return true;
  } catch {
    // Some test runtimes do not expose Vite's import.meta env object.
  }
  try {
    return Boolean((globalThis as { process?: { env?: { VITEST?: string } } }).process?.env?.VITEST);
  } catch {
    return false;
  }
}

/**
 * Measure the synchronous tab activation work through the next paint in dev
 * and test builds. This is intentionally opt-in so production navigation does
 * not allocate telemetry samples or add a native logging hop. The queued count
 * is captured at completion to correlate slow switches with sync pressure.
 */
export function measureTabSwitch<T>(work: () => T, getQueued?: () => number): T {
  if (!shouldMeasureTabSwitches()) return work();

  const end = markSyncPhaseStart("tab-switch");
  let result: T;
  try {
    result = work();
  } catch (error) {
    end({ outcome: "error", surface: "tab-bar", queued: getQueued?.() });
    throw error;
  }

  const finish = () => end({ surface: "tab-bar", queued: getQueued?.() });
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(finish);
  } else if (typeof queueMicrotask === "function") {
    queueMicrotask(finish);
  } else {
    setTimeout(finish, 0);
  }
  return result;
}

export function getSyncTelemetry(): readonly SyncPhaseSample[] {
  return samples.slice();
}

export interface TabSwitchLatencySummary {
  /** Number of completed tab switches with a measured duration. */
  count: number;
  /** Milliseconds. Zero only when `count` is zero. */
  p50: number;
  p95: number;
  max: number;
}

/**
 * Percentiles over the tab switches recorded so far.
 *
 * CI benchmarks bound the JavaScript a tab switch performs; they cannot see the
 * WebView actually paint. This is the one number measured on the machine that
 * feels the lag, which makes it the place to check a claim like "switching is
 * faster now" against real hardware.
 *
 * Reports zero samples rather than zero milliseconds when nothing has been
 * measured — a p95 of 0 would read as "instant" when it means "unknown".
 * Measurement itself stays opt-in (see `measureTabSwitch`), so a release build
 * with it disabled simply has no samples.
 */
export function getTabSwitchLatency(): TabSwitchLatencySummary {
  const durations: number[] = [];
  for (const sample of samples) {
    if (sample.phase !== "tab-switch") continue;
    if (typeof sample.durationMs !== "number" || !Number.isFinite(sample.durationMs)) continue;
    durations.push(sample.durationMs);
  }

  if (durations.length === 0) {
    return { count: 0, p50: 0, p95: 0, max: 0 };
  }

  durations.sort((a, b) => a - b);
  // Nearest-rank: the p-th percentile is the ceil(p × n)-th smallest sample,
  // so p95 of a single sample is that sample rather than an interpolation.
  const percentile = (fraction: number) => {
    const rank = Math.ceil(fraction * durations.length);
    return durations[Math.min(durations.length, Math.max(1, rank)) - 1];
  };

  return {
    count: durations.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: durations[durations.length - 1],
  };
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
