/**
 * External entry payloads emitted by the Rust `external_open` module.
 * Keep in sync with `src-tauri/src/external_open.rs`.
 */
export type ExternalOpenPayload =
  | { kind: "files"; paths: string[] }
  | { kind: "deepLink"; url: string };

export type AppLifecyclePhase = "suspended" | "resumed";

export interface AppLifecyclePayload {
  phase: AppLifecyclePhase;
}

export interface WebviewRecoveryPayload {
  label: string;
  recoveryCount: number;
}
