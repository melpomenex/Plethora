/** Safe Android startup diagnostics. This deliberately accepts only counts,
 * timings, and state labels; document titles, ids, and content have no place in
 * the diagnostic payload. */
export type AndroidStartupPhase =
  | "backend-ready-start"
  | "backend-ready-complete"
  | "backend-ready-failed"
  | "snapshot-request-start"
  | "snapshot-request-complete"
  | "snapshot-request-failed"
  | "snapshot-retry"
  | "snapshot-hydrated"
  | "surface-ready";

export interface AndroidStartupDiagnosticDetails {
  surface?: string;
  attempt?: number;
  durationMs?: number;
  outcome?: "success" | "empty" | "populated" | "timeout" | "error" | "retrying";
  documents?: number;
  queueItems?: number;
  dueCount?: number;
  failureKind?: "timeout" | "transport" | "database" | "other";
}

const SAFE_DETAIL_KEYS: readonly (keyof AndroidStartupDiagnosticDetails)[] = [
  "surface",
  "attempt",
  "durationMs",
  "outcome",
  "documents",
  "queueItems",
  "dueCount",
  "failureKind",
];

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
  if (typeof console === "undefined" || typeof console.info !== "function") return;

  const safeDetails: Record<string, string | number> = {};
  for (const key of SAFE_DETAIL_KEYS) {
    const value = details[key];
    if (value !== undefined) safeDetails[key] = value;
  }
  console.info("[startup:android]", { phase, ...safeDetails });
}
