/**
 * Client-side model catalog for the native Android TTS provider. Mirrors the
 * Kotlin `TtsModelRegistry` for default selection and display before the
 * plugin's `listModels` resolves. The plugin is always the source of truth at
 * runtime (it reports real install state); this is a static fallback.
 */

export interface AndroidTtsModelDescriptor {
  id: string;
  name: string;
  kind: "kitten" | "kokoro";
  description: string;
  isDefault: boolean;
  approxBytes: number;
}

/**
 * KittenTTS Micro — the compact default. Maps to sherpa-onnx `kitten-nano`.
 * Small enough to be the recommended first download.
 */
export const KITTEN_NANO: AndroidTtsModelDescriptor = {
  id: "kitten-nano",
  name: "KittenTTS Micro",
  kind: "kitten",
  description: "Compact default English voice. Smallest download, good for first run.",
  isDefault: true,
  approxBytes: 27 * 1024 * 1024,
};

/**
 * Kokoro-82M — the optional higher-quality model. Larger, more speakers.
 */
export const KOKORO_EN_V0_19: AndroidTtsModelDescriptor = {
  id: "kokoro-en-v0_19",
  name: "Kokoro-82M",
  kind: "kokoro",
  description: "Higher-quality English voice with more speakers. Larger download.",
  isDefault: false,
  approxBytes: 320 * 1024 * 1024,
};

export const ANDROID_TTS_MODELS: readonly AndroidTtsModelDescriptor[] = [
  KITTEN_NANO,
  KOKORO_EN_V0_19,
];

export const ANDROID_TTS_DEFAULT_MODEL_ID = KITTEN_NANO.id;

export function describeAndroidModel(id: string): AndroidTtsModelDescriptor | undefined {
  return ANDROID_TTS_MODELS.find((m) => m.id === id);
}
