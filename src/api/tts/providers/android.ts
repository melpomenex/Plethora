/**
 * Native Android TTS provider adapter.
 *
 * Unlike the cloud/local adapters that return an audio URL, the native Android
 * provider plays audio natively through the plugin (sherpa-onnx → AudioTrack).
 * There is no audio URL to return: `synthesize` queues the text for native
 * playback and the React hook drives the UI from the plugin's events
 * (playback-state, sentence-position, utterance-complete).
 *
 * Therefore `synthesize` here is a thin shim: it forwards the text to the
 * plugin via the bridge and returns a placeholder result. The real playback
 * lifecycle is owned by `useNativeAndroidTts` (see hooks), which the TTS hook
 * routes to when the active provider is `android`.
 *
 * Availability is gated on `isNativeMobile()` only — never offered on desktop,
 * where Pocket TTS remains the local option untouched.
 */

import { isNativeMobile } from "../../../lib/tauri";
import { TTSServiceError } from "../errors";
import { pluginListModels, pluginListVoices, pluginSpeak } from "../android/bridge";
import { ANDROID_TTS_DEFAULT_MODEL_ID } from "../android/models";
import type { TTSModelInfo, TTSProviderAdapter, TTSVoiceInfo } from "../types";

export const androidAdapter: TTSProviderAdapter = {
  id: "android",
  label: "On-device voice (Android)",
  kind: "local",
  auth: { mode: "none" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    supportsWordTimings: false,
    audioFormats: [], // native playback; no downloadable audio format
    maxInputChars: 5000,
  },

  async listModels(): Promise<TTSModelInfo[]> {
    if (!isNativeMobile()) return [];
    try {
      const models = await pluginListModels();
      return models.map((m) => ({
        id: m.id,
        name: m.name,
        vendor: "On-device",
        supportedVoices: null,
        supportedParameters: ["speed"],
        contextLength: 0,
        description: m.installed
          ? m.description
          : `${m.description} (not downloaded — tap to install, ~${Math.round(
              m.downloadBytes / (1024 * 1024)
            )} MB)`,
      }));
    } catch {
      // Plugin unreachable: return the default catalog so the UI still renders.
      return [
        {
          id: ANDROID_TTS_DEFAULT_MODEL_ID,
          name: "KittenTTS Micro",
          vendor: "On-device",
          supportedVoices: null,
          supportedParameters: ["speed"],
          contextLength: 0,
        },
      ];
    }
  },

  async listVoices(ctx, modelId): Promise<TTSVoiceInfo[]> {
    if (!isNativeMobile()) return [];
    try {
      const voices = await pluginListVoices(modelId);
      return voices.map((v) => ({
        id: v.id,
        name: v.name,
        provider: "android",
        modelId,
        vendor: "On-device",
        language: v.language ?? undefined,
        gender: v.gender ?? undefined,
      }));
    } catch {
      return [];
    }
  },

  async synthesize(ctx, request) {
    // The native provider does NOT return a playable audio URL — playback is
    // event-driven and owned natively. If we reach here it means the caller
    // used the generic <audio> path; queue the text for native playback and
    // return a placeholder so the contract is satisfied. The hook normally
    // routes the `android` provider through useNativeAndroidTts instead.
    const text = request.text;
    if (!text || !text.trim()) {
      throw new TTSServiceError("Text is required.", "validation");
    }
    try {
      await pluginSpeak({
        sentences: [text],
        modelId: request.model,
        voiceId: request.voice,
        speed: request.speed,
      });
    } catch (error) {
      throw new TTSServiceError(
        error instanceof Error ? error.message : "Native TTS failed to start.",
        "provider",
        true
      );
    }
    return {
      // No real URL — playback is native. audioUrl is a marker the hook
      // recognizes as "native playback in progress".
      audioUrl: "android-native://playback",
      rawOutput: { provider: "android", native: true },
    };
  },
};

// Re-export the availability helper so settings UI code can import everything
// from the adapter module.
export { isAndroidTtsAvailable } from "../android/bridge";
