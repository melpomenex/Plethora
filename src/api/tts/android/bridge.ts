/**
 * TypeScript bridge to the native Android TTS plugin.
 *
 * The native plugin (`plethora-android-tts`) owns the entire native
 * pipeline: sherpa-onnx inference, AudioTrack playback, audio focus,
 * lifecycle, model downloads, and the System-TTS fallback. No PCM crosses the
 * Tauri IPC — the webview only receives the small JSON events defined here.
 *
 * Commands are scoped under the plugin name:
 *   `plugin:incrementum-android-tts|<command>`
 * mirroring how every other Tauri plugin is invoked from this codebase.
 *
 * Every call is a no-op (returning a safe empty/`available:false` value) off
 * Android, so callers can use the bridge unconditionally and gate on
 * `isAvailable()` / `isNativeMobile()`.
 */

import { isNativeMobile, isTauri, invokeCommand } from "../../../lib/tauri";

/** Plugin command prefix used by `invokeCommand`. */
const PLUGIN = "plugin:incrementum-android-tts";

/** Whether the native Android TTS plugin is usable in this environment. */
export function isAndroidTtsAvailable(): boolean {
  return isTauri() && isNativeMobile();
}

// ──────────────────────────────────────────────────────────────────────────
// Response shapes (camelCase, matching the Kotlin JSObject payloads + Rust
// serde rename_all = "camelCase").
// ──────────────────────────────────────────────────────────────────────────

export interface AndroidTtsModel {
  id: string;
  name: string;
  kind: "kitten" | "kokoro";
  installed: boolean;
  installing: boolean;
  bytesOnDisk: number;
  downloadBytes: number;
  description: string;
  default: boolean;
}

export interface AndroidTtsVoice {
  id: string;
  name: string;
  modelId: string;
  language?: string | null;
  gender?: string | null;
}

export interface AndroidTtsInitializeResult {
  available: boolean;
  activeModelId: string | null;
  installedModelIds: string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Event payloads emitted by the Kotlin plugin.
// ──────────────────────────────────────────────────────────────────────────

export type AndroidTtsPlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped"
  | "error";

export interface DownloadProgressEvent {
  modelId: string;
  bytes: number;
  total: number;
}

export interface DownloadStateEvent {
  modelId: string;
  installing: boolean;
}

export interface SentencePositionEvent {
  utteranceId: number;
  index: number;
  sentence: string;
}

export interface UtteranceCompleteEvent {
  utteranceId: number;
}

export interface TtsErrorEvent {
  kind: string;
  message: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Command wrappers. Each short-circuits to a safe default off Android so the
// UI never has to branch on platform before calling.
// ──────────────────────────────────────────────────────────────────────────

export async function pluginInitialize(): Promise<AndroidTtsInitializeResult> {
  if (!isAndroidTtsAvailable()) {
    return { available: false, activeModelId: null, installedModelIds: [] };
  }
  return invokeCommand<AndroidTtsInitializeResult>(`${PLUGIN}|initialize`);
}

export async function pluginListModels(): Promise<AndroidTtsModel[]> {
  if (!isAndroidTtsAvailable()) return [];
  // Rust returns a bare Vec<NativeTtsModel> (it unwraps the Kotlin `{ models }`
  // map via a ListModelsResponse wrapper before returning to the frontend).
  const res = await invokeCommand<AndroidTtsModel[]>(`${PLUGIN}|list_models`);
  return res ?? [];
}

export async function pluginListVoices(modelId: string): Promise<AndroidTtsVoice[]> {
  if (!isAndroidTtsAvailable()) return [];
  // Rust returns a bare Vec<NativeTtsVoice> (unwrapped from the Kotlin
  // `{ voices }` map via a ListVoicesResponse wrapper).
  const res = await invokeCommand<AndroidTtsVoice[]>(`${PLUGIN}|list_voices`, {
    modelId,
  });
  return res ?? [];
}

export async function pluginDownloadModel(modelId: string): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|download_model`, { modelId });
}

export async function pluginCancelDownload(modelId: string): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|cancel_download`, { modelId });
}

export async function pluginDeleteModel(modelId: string): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|delete_model`, { modelId });
}

export interface SpeakOptions {
  sentences: string[];
  modelId?: string;
  voiceId?: string;
  speed?: number;
}

/**
 * Queue sentences for native playback. Returns immediately; playback drives
 * the UI through the event subscriptions below. The plugin handles
 * sentence chunking, prefetching, audio focus, and System-TTS fallback.
 */
export async function pluginSpeak(options: SpeakOptions): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|speak`, {
    sentences: options.sentences,
    modelId: options.modelId,
    voiceId: options.voiceId,
    speed: options.speed,
  });
}

export async function pluginPause(): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|pause`);
}

export async function pluginResume(): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|resume`);
}

export async function pluginStop(): Promise<void> {
  if (!isAndroidTtsAvailable()) return;
  await invokeCommand<void>(`${PLUGIN}|stop`);
}

// ──────────────────────────────────────────────────────────────────────────
// Event subscriptions. Returns an unsubscribe function.
// ──────────────────────────────────────────────────────────────────────────

/** Event names emitted by the Kotlin plugin. Must match AndroidTtsPlugin.kt. */
export const ANDROID_TTS_EVENTS = {
  playbackState: "tts://playback-state",
  sentencePosition: "tts://sentence-position",
  utteranceComplete: "tts://utterance-complete",
  error: "tts://error",
  downloadProgress: "tts://download-progress",
  downloadState: "tts://download-state",
} as const;

type Unlisten = () => void;

/**
 * Subscribe to a native TTS event.
 *
 * The Kotlin plugin dispatches these as global `CustomEvent`s on `window`
 * (via `webView.evaluateJavascript`), with the JSON payload in `event.detail`.
 * This mirrors the proven pattern in the folder-import plugin and avoids the
 * Tauri global-event (plugin:event|emit) path, which is a Rust core command
 * not reachable from a mobile plugin in Kotlin.
 */
async function subscribe<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!isAndroidTtsAvailable() || typeof window === "undefined") {
    // No-op unsubscribe off Android / non-browser.
    return () => {};
  }
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<T>).detail;
    if (detail !== undefined) handler(detail);
  };
  window.addEventListener(event, listener as EventListener);
  return () => window.removeEventListener(event, listener as EventListener);
}

export function onPlaybackState(
  handler: (state: AndroidTtsPlaybackState) => void
): Promise<Unlisten> {
  // The Kotlin payload is { state: "..." }; map to the scalar for callers.
  return subscribe<{ state: AndroidTtsPlaybackState }>(ANDROID_TTS_EVENTS.playbackState, (p) =>
    handler(p.state)
  );
}

export function onSentencePosition(handler: (e: SentencePositionEvent) => void): Promise<Unlisten> {
  return subscribe<SentencePositionEvent>(ANDROID_TTS_EVENTS.sentencePosition, handler);
}

export function onUtteranceComplete(
  handler: (e: UtteranceCompleteEvent) => void
): Promise<Unlisten> {
  return subscribe<UtteranceCompleteEvent>(ANDROID_TTS_EVENTS.utteranceComplete, handler);
}

export function onTtsError(handler: (e: TtsErrorEvent) => void): Promise<Unlisten> {
  return subscribe<TtsErrorEvent>(ANDROID_TTS_EVENTS.error, handler);
}

export function onDownloadProgress(handler: (e: DownloadProgressEvent) => void): Promise<Unlisten> {
  return subscribe<DownloadProgressEvent>(ANDROID_TTS_EVENTS.downloadProgress, handler);
}

export function onDownloadState(handler: (e: DownloadStateEvent) => void): Promise<Unlisten> {
  return subscribe<DownloadStateEvent>(ANDROID_TTS_EVENTS.downloadState, handler);
}
