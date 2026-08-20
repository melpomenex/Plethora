import type { SourceAnchor } from "../../types/languageLexicon";

export type AlignmentMethod = "caption" | "whisper" | "audiobook-pair" | "audio-edition" | "forced" | "manual";
export type AlignmentStatus = "ready" | "stale" | "ambiguous" | "failed";
export type AlignmentConfidenceTier = "exact" | "high" | "medium" | "low" | "unusable";

export interface MediaRange {
  mediaId: string;
  startMs: number;
  endMs: number;
  mediaFingerprint: string;
}

export interface SentenceAudioAlignment {
  id: string;
  profileId?: string;
  sourceType: string;
  sourceId: string;
  sentenceId: string;
  sourceAnchor?: SourceAnchor;
  sourceFingerprint: string;
  range: MediaRange;
  confidence: number;
  method: AlignmentMethod;
  status: AlignmentStatus;
  providerId?: string;
  providerVersion?: string;
  error?: string;
  updatedAt: number;
}

export interface AlignmentResolverInput {
  sourceId: string;
  sentenceId: string;
  sourceFingerprint: string;
  mediaId?: string;
  mediaFingerprint?: string;
  minConfidence?: number;
}

export type AlignmentResolveResult =
  | { kind: "original"; alignment: SentenceAudioAlignment; tier: AlignmentConfidenceTier }
  | { kind: "stale"; alignment?: SentenceAudioAlignment }
  | { kind: "ambiguous"; candidates: readonly SentenceAudioAlignment[] }
  | { kind: "fallback"; reason: "missing" | "low-confidence" | "unsupported" };

export interface ReplayResult {
  kind: "original" | "tts";
  mediaId?: string;
  startMs?: number;
  endMs?: number;
  text: string;
  reason?: string;
}
