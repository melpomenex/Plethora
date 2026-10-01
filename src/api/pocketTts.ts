/**
 * Pocket TTS API - Local text-to-speech via a provisioned, bundled, or
 * system runtime.
 *
 * This module provides integration with Pocket TTS (https://github.com/kyutai-labs/pocket-tts)
 * for offline, low-latency text-to-speech on CPU.
 *
 * Mirrors the Rust types in `src-tauri/src/pocket_tts.rs`. The install is a
 * detached job, so the command returns an install id immediately and the
 * outcome arrives on the `pocket-tts://install-progress` /
 * `pocket-tts://install-finished` events rather than on the invoke's promise.
 */

import { invokeCommand, isTauri, listen } from "../lib/tauri";

export interface PocketTTSOptions {
  text: string;
  voice: string;
  speed?: number; // 0.5 - 2.0 (currently unused - pocket-tts doesn't support speed adjustment)
}

export interface PocketTTSResult {
  audio_data: string; // Base64 data URL
  sample_rate: number;
  duration_sec: number;
}

/**
 * Structural install state, so callers branch on a code rather than on a
 * substring of `error`.
 *
 * - `notInstalled` — no runtime anywhere
 * - `installing`   — an install is in flight right now
 * - `installed`    — a working runtime was found
 * - `broken`       — a runtime exists but does not load; see `detail`
 * - `failed`       — an install ran and failed; see `error`
 */
export type PocketTTSState =
  | "notInstalled"
  | "installing"
  | "installed"
  | "broken"
  | "failed";

/** Which tier the resolved executable came from. */
export type PocketTTSSource = "provisioned" | "bundled" | "system";

/** Phase an install is currently in. `percent` is relative to that phase. */
export type PocketTTSInstallPhase =
  | "environment-prep"
  | "runtime-fetch"
  | "weight-preload"
  | "complete";

export interface PocketTTSStatus {
  state: PocketTTSState;
  source?: PocketTTSSource | null;
  /** Absolute path actually used. */
  executable?: string | null;
  /** The executable's own stderr when the state is `broken`. */
  detail?: string | null;
  /** Actionable, human-readable reason when the state is not `installed`. */
  error?: string | null;
}

/**
 * Share of the whole install each phase accounts for, as
 * `[lowPercent, highPercent]`. Mirrors `PocketTTSInstallPhase::share()` on the
 * Rust side: the backend reports a phase-relative `percent` (and `0` when the
 * total size is unknown), so the panel composes the single bar from these.
 */
export const POCKET_TTS_PHASE_SHARE: Record<PocketTTSInstallPhase, [number, number]> = {
  "environment-prep": [0, 5],
  "runtime-fetch": [5, 90],
  "weight-preload": [90, 99],
  complete: [100, 100],
};

export interface PocketTTSInstallProgress {
  id: string;
  phase: PocketTTSInstallPhase;
  received: number;
  /** 0 when the total size is not known — show an indeterminate bar. */
  total: number;
  percent: number;
}

export interface PocketTTSInstallFinished {
  id: string;
  ok: boolean;
  cancelled: boolean;
  message: string;
}

/**
 * Why an install request was refused before it started. The backend sends a
 * `reason` *code* alongside the human-readable `message` so the panel can pick
 * localized recovery text without matching on substrings.
 */
export interface PocketTTSInstallRefusal {
  reason: "diskSpace" | "pythonMissing" | "alreadyInstalling" | "internal";
  message: string;
}

/** Thrown by {@link installPocketTTS} when the request is refused. */
export class PocketTTSInstallRefusedError extends Error {
  readonly reason: PocketTTSInstallRefusal["reason"];

  constructor(refusal: PocketTTSInstallRefusal) {
    super(refusal.message);
    this.name = "PocketTTSInstallRefusedError";
    this.reason = refusal.reason;
  }
}

function toRefusal(error: unknown): PocketTTSInstallRefusal | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<PocketTTSInstallRefusal>;
  if (typeof candidate.reason !== "string" || typeof candidate.message !== "string") {
    return null;
  }
  return {
    reason: candidate.reason as PocketTTSInstallRefusal["reason"],
    message: candidate.message,
  };
}

export const POCKET_TTS_PROGRESS_EVENT = "pocket-tts://install-progress";
export const POCKET_TTS_FINISHED_EVENT = "pocket-tts://install-finished";

/**
 * Check if a Pocket TTS runtime is available.
 *
 * Never rejects: a machine with no runtime is a status, not a failure.
 */
export async function checkPocketTTSAvailable(): Promise<PocketTTSStatus> {
  if (!isTauri()) {
    return {
      state: "notInstalled",
      error: "Pocket TTS requires the Tauri desktop app",
    };
  }

  try {
    return await invokeCommand<PocketTTSStatus>("pocket_tts_status");
  } catch (error) {
    return {
      state: "notInstalled",
      error: error instanceof Error ? error.message : "Failed to check Pocket TTS status",
    };
  }
}

/**
 * Start installing the Pocket TTS runtime.
 *
 * Resolves with the install id as soon as the job is accepted — the download
 * can run for minutes, so progress and the outcome arrive on the install
 * events. Rejects with a {@link PocketTTSInstallRefusedError} when a
 * preflight fails or an install is already running.
 */
export async function installPocketTTS(): Promise<string> {
  if (!isTauri()) {
    throw new Error("Pocket TTS requires the Tauri desktop app");
  }
  try {
    return await invokeCommand<string>("pocket_tts_install");
  } catch (error) {
    const refusal = toRefusal(error);
    if (refusal) throw new PocketTTSInstallRefusedError(refusal);
    throw error;
  }
}

/**
 * Cancel an in-flight install. A no-op when nothing is running; the terminal
 * event carries `cancelled: true` when an install was actually stopped.
 */
export async function cancelPocketTTSInstall(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invokeCommand<void>("pocket_tts_cancel_install");
}

/**
 * Remove the runtime this app provisioned. A `pocket-tts` the user installed
 * themselves is never touched.
 */
export async function uninstallPocketTTS(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  await invokeCommand<void>("pocket_tts_uninstall");
}

/**
 * Generate speech using Pocket TTS
 *
 * @param options - Text and voice settings
 * @returns Audio data URL and duration
 */
export async function generatePocketSpeech(options: PocketTTSOptions): Promise<{ audioUrl: string; durationSec: number }> {
  if (!isTauri()) {
    throw new Error("Pocket TTS requires the Tauri desktop app");
  }

  const result = await invokeCommand<PocketTTSResult>("pocket_tts_generate", {
    text: options.text,
    voice: options.voice,
    speed: options.speed ?? 1.0,
  });

  return {
    audioUrl: result.audio_data,
    durationSec: result.duration_sec,
  };
}

/**
 * Stop any ongoing Pocket TTS synthesis
 */
export async function stopPocketTTS(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    await invokeCommand<void>("pocket_tts_stop");
  } catch (error) {
    console.error("Failed to stop Pocket TTS:", error);
  }
}

/**
 * Clean up Pocket TTS resources
 */
export async function cleanupPocketTTS(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    await invokeCommand<void>("pocket_tts_cleanup");
  } catch (error) {
    console.error("Failed to cleanup Pocket TTS:", error);
  }
}

/**
 * Subscribe to install progress.
 *
 * Degrades to a no-op unsubscribe outside Tauri (browser dev/PWA), matching
 * `listen`'s own fallback, so callers never have to branch on the runtime.
 */
export async function onPocketTTSInstallProgress(
  handler: (progress: PocketTTSInstallProgress) => void
): Promise<() => void> {
  return listen<PocketTTSInstallProgress>(POCKET_TTS_PROGRESS_EVENT, (event) =>
    handler(event.payload)
  );
}

/** Subscribe to the single terminal install event. */
export async function onPocketTTSInstallFinished(
  handler: (finished: PocketTTSInstallFinished) => void
): Promise<() => void> {
  return listen<PocketTTSInstallFinished>(POCKET_TTS_FINISHED_EVENT, (event) =>
    handler(event.payload)
  );
}
