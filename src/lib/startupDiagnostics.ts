/** Safe Android startup diagnostics. This deliberately accepts only counts,
 * timings, and state labels; document titles, ids, and content have no place in
 * the diagnostic payload. */
export type AndroidStartupPhase =
  | "bootstrap-entry"
  | "main-import-start"
  | "main-import-complete"
  | "main-import-failed"
  | "command-dispatch"
  | "command-response"
  | "backend-ready-start"
  | "backend-ready-complete"
  | "backend-ready-failed"
  | "snapshot-request-start"
  | "snapshot-request-complete"
  | "snapshot-request-failed"
  | "snapshot-retry"
  | "snapshot-hydrated"
  | "surface-ready"
  | "interaction-ready"
  | "recovery-visible";

export interface AndroidStartupDiagnosticDetails {
  surface?: "startup" | "dashboard" | "documents" | "queue" | "continue-reading";
  command?: "wait_for_backend_ready" | "get_startup_snapshot";
  request?: number;
  attempt?: number;
  durationMs?: number;
  outcome?: "success" | "empty" | "populated" | "timeout" | "error" | "retrying";
  documents?: number;
  queueItems?: number;
  dueCount?: number;
  failureKind?: "timeout" | "transport" | "database" | "other";
}

declare const __PLETHORA_BUILD_ID__: string | undefined;

export const ANDROID_STARTUP_TRACE_PREFIX = "[startup:android] ";
const MAX_RECORDS = 128;
const MAX_PHASE_RECORDS = 16;
// Capture before console forwarding installs. Never invoke native transport to
// report a transport failure; MainActivity observes these WebView messages.
const originalInfo = typeof console === "undefined" ? undefined : console.info.bind(console);
const startedAt = performance.now();
const records: Readonly<AndroidStartupTraceRecord>[] = [];
const phaseCounts = new Map<AndroidStartupPhase, number>();
let sequence = 0;

export interface AndroidStartupTraceRecord extends AndroidStartupDiagnosticDetails {
  phase: AndroidStartupPhase;
  sequence: number;
  elapsedMs: number;
  build: string;
}

const LABELS: Partial<Record<keyof AndroidStartupDiagnosticDetails, readonly string[]>> = {
  surface: ["startup", "dashboard", "documents", "queue", "continue-reading"],
  command: ["wait_for_backend_ready", "get_startup_snapshot"],
  outcome: ["success", "empty", "populated", "timeout", "error", "retrying"],
  failureKind: ["timeout", "transport", "database", "other"],
};

const SAFE_DETAIL_KEYS: readonly (keyof AndroidStartupDiagnosticDetails)[] = [
  "surface",
  "command",
  "request",
  "attempt",
  "durationMs",
  "outcome",
  "documents",
  "queueItems",
  "dueCount",
  "failureKind",
];

/** Copies only bounded, content-free records. No IPC or persistent user data. */
export function getAndroidStartupTrace(): Readonly<AndroidStartupTraceRecord>[] {
  return records.map((record) => ({ ...record }));
}

/** Called from a confirmed local surface's commit effect. Observe presentation
 * removal, then cross a painted frame and an event-loop turn before reporting
 * the usable endpoint. The caller invalidates it on collection/surface change. */
export function observeAndroidStartupSurface(details: AndroidStartupDiagnosticDetails): () => void {
  let cancelled = false;
  let frame = 0;
  let inputTurn: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => schedule());
  const finish = () => {
    if (cancelled || document.querySelector(".kp-overlay")) return;
    recordAndroidStartupDiagnostic("interaction-ready", details);
    cancelled = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    clearTimeout(expiry);
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (cancelled || document.querySelector(".kp-overlay")) return;
      frame = requestAnimationFrame(() => {
        if (inputTurn !== undefined) clearTimeout(inputTurn);
        inputTurn = setTimeout(finish, 0);
      });
    });
  };
  observer.observe(document.body, { childList: true, subtree: true });
  recordAndroidStartupDiagnostic("surface-ready", details);
  schedule();
  const expiry = setTimeout(() => observer.disconnect(), 180_000);
  return () => {
    cancelled = true;
    observer.disconnect();
    clearTimeout(expiry);
    if (inputTurn !== undefined) clearTimeout(inputTurn);
    cancelAnimationFrame(frame);
  };
}

export function classifyAndroidStartupFailure(error: unknown): NonNullable<AndroidStartupDiagnosticDetails["failureKind"]> {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("sqlite") || message.includes("database") || message.includes("sqlx")) return "database";
  if (message.includes("invoke") || message.includes("bridge") || message.includes("callback") || message.includes("ipc")) return "transport";
  return "other";
}

export function recordAndroidStartupDiagnostic(
  phase: AndroidStartupPhase,
  details: AndroidStartupDiagnosticDetails = {},
): void {
  const count = phaseCounts.get(phase) ?? 0;
  if (count >= (phase.startsWith("command-") ? 64 : MAX_PHASE_RECORDS)) return;
  phaseCounts.set(phase, count + 1);
  const safeDetails: Record<string, string | number> = {};
  for (const key of SAFE_DETAIL_KEYS) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      safeDetails[key] = Math.round(value);
    } else if (typeof value === "string" && LABELS[key]?.includes(value)) {
      safeDetails[key] = value;
    }
  }
  const record: AndroidStartupTraceRecord = Object.freeze({
    phase,
    sequence: ++sequence,
    elapsedMs: Math.round(performance.now() - startedAt),
    build: typeof __PLETHORA_BUILD_ID__ === "string" ? __PLETHORA_BUILD_ID__ : "test",
    ...safeDetails,
  });
  if (records.length === MAX_RECORDS) records.shift();
  records.push(record);
  originalInfo?.(ANDROID_STARTUP_TRACE_PREFIX + JSON.stringify(record));
}
