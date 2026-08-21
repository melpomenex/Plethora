export type PronunciationCapability = "transcription" | "word-confidence" | "timing" | "phoneme";
export type PronunciationStatus = "ready" | "unsupported" | "uncertain" | "stale" | "failed";

export interface PronunciationProviderManifest { providerId: string; providerVersion: string; capabilities: readonly PronunciationCapability[]; languages: readonly string[]; sendsAudioOffDevice: boolean; maxAudioMs: number; configured: boolean; }
export interface PronunciationIssue { kind: "word" | "timing" | "phoneme"; expected?: string; actual?: string; startMs?: number; endMs?: number; confidence?: number; }
export interface PronunciationFeedbackResult { attemptId: string; providerId: string; providerVersion: string; status: PronunciationStatus; score?: number; confidence?: number; availableDimensions?: readonly PronunciationCapability[]; issues: readonly PronunciationIssue[]; createdAt: number; }

export const PRONUNCIATION_DIMENSIONS: readonly { capability: PronunciationCapability; label: string }[] = [
  { capability: "transcription", label: "Transcription match" },
  { capability: "word-confidence", label: "Word confidence" },
  { capability: "timing", label: "Timing / rhythm" },
  { capability: "phoneme", label: "Phoneme alignment" },
];

export function canProvidePronunciation(manifest: PronunciationProviderManifest, capability: PronunciationCapability, languageTag: string): boolean {
  return manifest.configured && manifest.capabilities.includes(capability) && manifest.languages.some((language) => languageTag.toLocaleLowerCase().startsWith(language.toLocaleLowerCase())) && manifest.maxAudioMs > 0;
}

/** Return only dimensions that the configured provider explicitly advertises. */
export function advertisedPronunciationDimensions(manifest: PronunciationProviderManifest, languageTag: string): readonly string[] {
  return PRONUNCIATION_DIMENSIONS
    .filter(({ capability }) => canProvidePronunciation(manifest, capability, languageTag))
    .map(({ label }) => label);
}

export function isPronunciationFeedbackCurrent(
  result: Pick<PronunciationFeedbackResult, "attemptId" | "providerId" | "providerVersion">,
  current: { attemptId: string; providerId: string; providerVersion: string },
): boolean {
  return result.attemptId === current.attemptId
    && result.providerId === current.providerId
    && result.providerVersion === current.providerVersion;
}
