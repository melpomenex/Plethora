/**
 * Development-only first-view latency diagnostics (#11).
 *
 * Every lazy tab/view is fetched through `importWithRetry` (the chunk phase)
 * and its content first rendered through `TabContent` (the mount phase). This
 * module records, per view, how long the lazy chunk took to load and whether
 * the view is a COLD first load (chunk had to be fetched) or a WARM repeat
 * (chunk already in the module registry), so a regression that makes first
 * navigation stall — or silently require navigate-away-and-back — shows up in
 * dev tooling and is caught by tests.
 *
 * Gating: enabled by default in development builds (Vite `MODE ===
 * "development"`); production and test builds stay silent unless opted in via
 * `localStorage["plethora.firstViewDiag"] === "1"` (QA instrumentation). All
 * output goes through `console.debug` — never a production log line.
 *
 * Tests force the enabled state through `__setFirstViewDiagnosticsEnabled`.
 */

export interface FirstViewSample {
  view: string;
  phase: "chunk" | "chunk-fail" | "mount";
  /** True when this sample is the first occurrence of the view in the session. */
  cold: boolean;
  durationMs: number;
  at: number;
}

const OPT_IN_KEY = "plethora.firstViewDiag";
const PREFIX = "[firstView]";

const samples: FirstViewSample[] = [];
const chunkStarts = new Map<string, number>();
const seenChunks = new Set<string>();
const seenViews = new Set<string>();

let forcedEnabled: boolean | null = null;
// Cached so the (disabled) hot path — every tab activation — is a single
// boolean read, not an import.meta/localStorage probe on each call.
let enabledCache: boolean | null = null;

function envMode(): string {
  try {
    return (import.meta as { env?: { MODE?: string } } | undefined)?.env?.MODE ?? "production";
  } catch {
    return "production";
  }
}

function isEnabled(): boolean {
  if (forcedEnabled !== null) return forcedEnabled;
  if (enabledCache !== null) return enabledCache;
  let enabled = false;
  if (envMode() === "development") {
    enabled = true;
  } else {
    try {
      enabled = typeof localStorage !== "undefined" && localStorage.getItem(OPT_IN_KEY) === "1";
    } catch {
      enabled = false;
    }
  }
  enabledCache = enabled;
  return enabled;
}

function debug(message: string): void {
  console.debug(PREFIX, message);
}

function record(view: string, phase: FirstViewSample["phase"], cold: boolean, durationMs: number): void {
  if (!isEnabled()) return;
  samples.push({ view, phase, cold, durationMs, at: Date.now() });
  debug(`${cold ? "cold" : "warm"} ${phase} "${view}" ${Math.round(durationMs)}ms`);
}

/** Called when a lazy chunk fetch begins (from `importWithRetry`). */
export function firstViewChunkStart(view: string): void {
  if (!isEnabled()) return;
  if (!chunkStarts.has(view)) {
    chunkStarts.set(view, performance.now());
  }
}

/** Called when a lazy chunk fetch resolves successfully. */
export function firstViewChunkEnd(view: string): void {
  if (!isEnabled()) return;
  const start = chunkStarts.get(view);
  if (start === undefined) return;
  chunkStarts.delete(view);
  const cold = !seenChunks.has(view);
  seenChunks.add(view);
  record(view, "chunk", cold, performance.now() - start);
}

/** Called when a lazy chunk fetch exhausts its retries (failure). */
export function firstViewChunkFailed(view: string): void {
  if (!isEnabled()) return;
  const start = chunkStarts.get(view);
  chunkStarts.delete(view);
  const cold = !seenChunks.has(view);
  seenChunks.add(view);
  record(view, "chunk-fail", cold, start === undefined ? 0 : performance.now() - start);
}

/**
 * Called the first time a view's content actually renders (from `TabContent`).
 * Repeated calls for the same view (warm repeat navigation) are recorded so
 * warm-state latency regressions stay visible.
 */
export function firstViewMounted(view: string): void {
  if (!isEnabled()) return;
  const cold = !seenViews.has(view);
  seenViews.add(view);
  record(view, "mount", cold, 0);
}

/** @internal test hook: read recorded samples. */
export function __getFirstViewSamples(): readonly FirstViewSample[] {
  return samples;
}

/** @internal test hook: clear all recorded state. */
export function __resetFirstViewDiagnostics(): void {
  samples.length = 0;
  chunkStarts.clear();
  seenChunks.clear();
  seenViews.clear();
  enabledCache = null;
}

/**
 * @internal test hook: force the enabled state (`null` restores the default
 * environment gating).
 */
export function __setFirstViewDiagnosticsEnabled(enabled: boolean | null): void {
  forcedEnabled = enabled;
  enabledCache = null;
}
