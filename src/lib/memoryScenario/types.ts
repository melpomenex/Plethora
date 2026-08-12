/**
 * Wire protocol types for the memory benchmark harness.
 *
 * The driver (scripts/memory-bench/driver.js) runs an HTTP control server; the
 * app (this module) long-polls it. Outbound only from the app's perspective —
 * the app connects out to the driver, so no inbound listener is added to the
 * application (design D2). The existing CSP already permits
 * `connect-src http://127.0.0.1:*`.
 */

/** Configuration returned by the Rust `get_memory_scenario_config` command. */
export interface MemoryScenarioConfig {
  scenario: string;
  controlUrl: string;
  runId: string;
  corpusDir?: string | null;
}

/** Corpus manifest served by the driver: corpusId -> file name in corpusDir. */
export interface MemoryScenarioManifest {
  items: Record<string, string>;
  corpusDir: string;
}

/** A step the driver hands the app. */
export type MemoryScenarioStep =
  | { step: number; op: "open"; corpusId: string }
  | { step: number; op: "closeTab"; tabId: string }
  | { step: number; op: "closeAll" }
  | { step: number; op: "settle" }
  | { step: number; op: "quit" };

/** Report the app POSTs after each step. */
export interface MemoryScenarioReport {
  step: number;
  status: "done" | "error";
  /** Tab id for `open` steps, so the driver can later `closeTab` it. */
  tabId?: string;
  /** Quiescence state at report time (see quiescence.ts). */
  quiescent?: boolean;
  quiescence?: {
    inFlightTask: boolean;
    storeLoading: boolean;
    storeImporting: boolean;
    pendingTabsSave: boolean;
    stabilizationElapsedMs: number;
  };
  error?: string;
}

/** Driver's /step response: a step, 204 (nothing pending), or the run is over. */
export type StepPollResult =
  | { kind: "step"; step: MemoryScenarioStep }
  | { kind: "idle" }
  | { kind: "done" }
  | { kind: "error"; message: string };
