export type PronunciationCapability = "transcription" | "word-confidence" | "timing" | "phoneme";
export type PronunciationStatus = "ready" | "unsupported" | "uncertain" | "stale" | "failed";

export interface PronunciationProviderManifest { providerId: string; providerVersion: string; capabilities: readonly PronunciationCapability[]; languages: readonly string[]; sendsAudioOffDevice: boolean; maxAudioMs: number; configured: boolean; }
export interface PronunciationIssue { kind: "word" | "timing" | "phoneme"; expected?: string; actual?: string; startMs?: number; endMs?: number; confidence?: number; }
export interface PronunciationFeedbackResult { attemptId: string; providerId: string; providerVersion: string; status: PronunciationStatus; score?: number; confidence?: number; issues: readonly PronunciationIssue[]; createdAt: number; }

export function canProvidePronunciation(manifest: PronunciationProviderManifest, capability: PronunciationCapability, languageTag: string): boolean {
  return manifest.configured && manifest.capabilities.includes(capability) && manifest.languages.some((language) => languageTag.toLocaleLowerCase().startsWith(language.toLocaleLowerCase())) && manifest.maxAudioMs > 0;
}
