/**
 * Android Rolling Native Recording Adapter.
 *
 * Implements Android live capture via plethora-android-speech plugin:
 * - Direct AudioRecord -> bounded worker -> rolling 5-second PCM WAV parts.
 * - Foreground service with microphone type and notification controls.
 * - Bounded IPC & memory with zero full-audio accumulation.
 * - Safe-stop handling for interruptions, phone calls, and backgrounding.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  CaptureCapabilities,
  CaptureHandle,
  RecordingHealth,
  RecordingState,
} from "../../types/recordingSession";

export const ANDROID_SPEECH_COMMANDS = {
  status: "plugin:plethora-android-speech|recording_status",
  start: "plugin:plethora-android-speech|start_recording",
  pause: "plugin:plethora-android-speech|pause_recording",
  resume: "plugin:plethora-android-speech|resume_recording",
  finish: "plugin:plethora-android-speech|finish_recording",
} as const;

/**
 * The Rust shim declares a single `request: Option<Value>` argument for every
 * recording command (`src-tauri/plugins/plethora-android-speech/src/lib.rs`),
 * so the Kotlin `@InvokeArg` payload MUST be nested under `request`. Sending
 * flat keys leaves `request` unset, the Kotlin args default to empty
 * `sessionId`/`writerEpoch`, and the plugin rejects with
 * "invalid_argument: Invalid session or epoch".
 */
const requestEnvelope = <T extends object>(request: T): { request: T } => ({ request });

export interface AndroidCaptureParams {
  sessionId: string;
  assetId?: string;
  writerEpoch: string;
  sampleRate?: number;
  channels?: number;
  outputDir?: string;
  onHealthChange?: (health: RecordingHealth) => void;
  onStateChange?: (state: RecordingState) => void;
  // Test injection hook
  invokeFn?: <T>(cmd: string, args?: unknown) => Promise<T>;
}

export interface AndroidPluginStatusResponse {
  platform: string;
  available: boolean;
  pause: boolean;
  background: boolean;
  liveCaptions: boolean;
  state: RecordingState;
  sessionId?: string;
  writerEpoch?: string;
  acknowledgedMs: number;
  pendingBytes: number;
  microphonePermission?: string;
}

export interface AndroidPluginStartResponse {
  ok: boolean;
  sessionId: string;
  assetId: string;
  writerEpoch: string;
}

export interface AndroidPluginFinishResponse {
  assetId: string;
  incomplete: boolean;
  acknowledgedMs: number;
  partsCount: number;
  totalBytes: number;
}

/** Check if running on Android with Tauri native environment */
export function isAndroidCaptureAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const isTauriEnv = !!(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__
  );
  if (!isTauriEnv) return false;
  const ua = navigator.userAgent || "";
  return /android/i.test(ua);
}

/** Get Android recording capabilities and active health */
export async function getAndroidCaptureCapabilities(
  invokeFn: <T>(cmd: string, args?: unknown) => Promise<T> = invoke
): Promise<CaptureCapabilities> {
  try {
    const res = await invokeFn<AndroidPluginStatusResponse>(
      ANDROID_SPEECH_COMMANDS.status,
      {}
    );
    return {
      available: res.available,
      pause: res.pause,
      background: res.background,
      liveCaptions: res.liveCaptions,
    };
  } catch (err) {
    return {
      available: false,
      pause: false,
      background: false,
      liveCaptions: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Start rolling native recording on Android */
export async function startAndroidCapture(
  params: AndroidCaptureParams
): Promise<CaptureHandle> {
  const invokeFn = params.invokeFn || invoke;

  params.onStateChange?.("requesting-permission");

  let startRes: AndroidPluginStartResponse;
  try {
    startRes = await invokeFn<AndroidPluginStartResponse>(
      ANDROID_SPEECH_COMMANDS.start,
      requestEnvelope({
        sessionId: params.sessionId,
        assetId: params.assetId || "",
        writerEpoch: params.writerEpoch,
        sampleRate: params.sampleRate ?? 16000,
        channels: params.channels ?? 1,
        outputDir: params.outputDir,
      })
    );
  } catch (err) {
    params.onStateChange?.("failed");
    throw err;
  }

  let currentState: RecordingState = "recording";
  params.onStateChange?.(currentState);
  params.onHealthChange?.({
    state: currentState,
    acknowledgedMs: 0,
    pendingBytes: 0,
    lastCommitAt: new Date().toISOString(),
  });

  let finished = false;

  return {
    sessionId: params.sessionId,
    writerEpoch: params.writerEpoch,

    async pause(): Promise<void> {
      if (finished || currentState === "paused") return;
      await invokeFn<{ ok: boolean; state: string; acknowledgedMs: number }>(
        ANDROID_SPEECH_COMMANDS.pause,
        requestEnvelope({
          sessionId: params.sessionId,
          writerEpoch: params.writerEpoch,
        })
      );
      currentState = "paused";
      params.onStateChange?.(currentState);
    },

    async resume(): Promise<void> {
      if (finished || currentState === "recording") return;
      await invokeFn<{ ok: boolean; state: string }>(
        ANDROID_SPEECH_COMMANDS.resume,
        requestEnvelope({
          sessionId: params.sessionId,
          writerEpoch: params.writerEpoch,
          sampleRate: params.sampleRate ?? 16000,
          channels: params.channels ?? 1,
        })
      );
      currentState = "recording";
      params.onStateChange?.(currentState);
    },

    async finish(): Promise<{ assetId: string; incomplete: boolean }> {
      if (finished) {
        return { assetId: startRes.assetId, incomplete: false };
      }
      currentState = "finalizing";
      params.onStateChange?.(currentState);

      const res = await invokeFn<AndroidPluginFinishResponse>(
        ANDROID_SPEECH_COMMANDS.finish,
        requestEnvelope({
          sessionId: params.sessionId,
          writerEpoch: params.writerEpoch,
        })
      );
      finished = true;
      currentState = "saved";
      params.onStateChange?.(currentState);
      params.onHealthChange?.({
        state: currentState,
        acknowledgedMs: res.acknowledgedMs,
        pendingBytes: 0,
        lastCommitAt: new Date().toISOString(),
      });

      return {
        assetId: res.assetId,
        incomplete: res.incomplete,
      };
    },
  };
}
