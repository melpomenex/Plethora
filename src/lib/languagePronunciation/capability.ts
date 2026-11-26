import type {
  PronunciationCapability,
  PronunciationProviderManifest,
} from "./types";
import { canProvidePronunciation } from "./types";

/**
 * Returns the deduplicated list of capabilities that the provider manifest
 * actively supports for the requested language tag.
 */
export function resolvePronunciationCapabilities(
  provider: PronunciationProviderManifest,
  languageTag: string,
): PronunciationCapability[] {
  const seen = new Set<PronunciationCapability>();
  const resolved: PronunciationCapability[] = [];
  for (const capability of provider.capabilities) {
    if (!seen.has(capability) && canProvidePronunciation(provider, capability, languageTag)) {
      seen.add(capability);
      resolved.push(capability);
    }
  }
  return resolved;
}

/**
 * Checks whether a provider is permitted to supply acoustic timing/rhythm dimensions.
 */
export function canEvaluateAcousticTiming(
  provider: PronunciationProviderManifest,
  languageTag: string,
): boolean {
  return canProvidePronunciation(provider, "timing", languageTag);
}

/**
 * Checks whether a provider explicitly declares genuine phoneme-level alignment.
 * Acoustic timing/pitch analyzers never satisfy `"phoneme"`.
 */
export function canEvaluatePhonemes(
  provider: PronunciationProviderManifest,
  languageTag: string,
): boolean {
  return canProvidePronunciation(provider, "phoneme", languageTag);
}

/**
 * Augments an existing configured provider manifest with on-device WebAudio `"timing"`
 * capability while preserving its original transcription/word-confidence/phoneme flags.
 */
export function withOnDeviceTimingCapability(
  manifest: PronunciationProviderManifest,
): PronunciationProviderManifest {
  if (!manifest.configured || manifest.capabilities.includes("timing")) {
    return manifest;
  }
  return {
    ...manifest,
    capabilities: [...manifest.capabilities, "timing"],
  };
}
