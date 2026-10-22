/**
 * Apple Disk-First Native Recording Adapter.
 *
 * Implements Apple iOS live capture via plethora-apple-intelligence plugin:
 * - Direct AVAudioEngine input tap -> bounded off-callback worker -> rolling 5-second PCM WAV parts.
 * - Atomic .partial rename and manifest replace.
 * - Safe-stop on interruption (phone call / audio session deactivation) or backgrounding.
 * - Bounded IPC & memory with zero full-audio accumulation.
 * - Foreground-only by default (background: false) until background capability certified.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  CaptureCapabilities,
  CaptureHandle,
  RecordingHealth,
  RecordingState,
} from "../../types/recordingSession";

export const APPLE_RECORDING_COMMANDS = {
  status: "plugin:plethora-apple-intelligence|apple_recording_status",
  start: "plugin:plethora-apple-intelligence|apple_recording_start",
  pause: "plugin:plethora-apple-intelligence|apple_recording_pause",
  resume: "plugin:plethora-apple-intelligence|apple_recording_resume",
  finish: "plugin:plethora-apple-intelligence|apple_recording_finish",
} as const;

/**
 * The Rust shim declares a single `payload: Option<Value>` argument for every
 * recording command (`stub_cmd!` in
 * `src-tauri/plugins/plethora-apple-intelligence/src/lib.rs`), so the Swift
 * bridge payload MUST be nested under `payload`. Sending flat keys leaves the
 * payload unset and the native bridge rejects the missing
 * `sessionId`/`writerEpoch`.
 */
const payloadEnvelope = <T extends object>(payload: T): { payload: T } => ({ payload });

export interface AppleCaptureParams {
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

export interface ApplePluginStatusResponse {
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

export interface ApplePluginStartResponse {
  ok: boolean;
  sessionId: string;
  assetId: string;
  writerEpoch: string;
}

export interface ApplePluginFinishResponse {
  assetId: string;
  incomplete: boolean;
  acknowledgedMs: number;
  partsCount: number;
  totalBytes: number;
}

/** Check if running on iOS with Tauri native environment */
export function isAppleCaptureAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const isTauriEnv = !!(
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__
  );
  if (!isTauriEnv) return false;
  const ua = navigator.userAgent || "";
  // Check iOS devices (iPhone, iPad, iPod)
  return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Get Apple recording capabilities and active health */
export async function getAppleCaptureCapabilities(
  invokeFn: <T>(cmd: string, args?: unknown) => Promise<T> = invoke
): Promise<CaptureCapabilities> {
  try {
    const res = await invokeFn<ApplePluginStatusResponse>(
      APPLE_RECORDING_COMMANDS.status,
      {}
    );
    return {
      available: res.available,
      pause: res.pause,
      background: res.background, // false per D2 foreground requirement
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

/** Start rolling native recording on Apple iOS */
export async function startAppleCapture(
  params: AppleCaptureParams
): Promise<CaptureHandle> {
  const invokeFn = params.invokeFn || invoke;

  params.onStateChange?.("requesting-permission");

  let startRes: ApplePluginStartResponse;
  try {
    startRes = await invokeFn<ApplePluginStartResponse>(
      APPLE_RECORDING_COMMANDS.start,
      payloadEnvelope({
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
        APPLE_RECORDING_COMMANDS.pause,
        payloadEnvelope({
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
        APPLE_RECORDING_COMMANDS.resume,
        payloadEnvelope({
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

      const res = await invokeFn<ApplePluginFinishResponse>(
        APPLE_RECORDING_COMMANDS.finish,
        payloadEnvelope({
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
