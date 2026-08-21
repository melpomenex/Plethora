import { comparePracticeResponse } from "../languagePractice/compare";
import type {
  PronunciationCapability,
  PronunciationFeedbackResult,
  PronunciationIssue,
  PronunciationProviderManifest,
} from "./types";
import { advertisedPronunciationDimensions, canProvidePronunciation } from "./types";

export interface PronunciationWordTiming {
  expected?: string;
  actual?: string;
  startMs: number;
  endMs: number;
}

export interface PronunciationFeedbackInput {
  attemptId: string;
  languageTag: string;
  expectedText: string;
  recognizedText?: string;
  confidence?: number;
  wordTimings?: readonly PronunciationWordTiming[];
  phonemeIssues?: readonly PronunciationIssue[];
  provider: PronunciationProviderManifest;
  now?: number;
}

function capabilityList(provider: PronunciationProviderManifest, languageTag: string): PronunciationCapability[] {
  return provider.capabilities.filter((capability) => canProvidePronunciation(provider, capability, languageTag));
}

/** Builds only dimensions returned by a provider manifest; it never derives phoneme or rhythm scores from a transcript. */
export function evaluatePronunciationFeedback(input: PronunciationFeedbackInput): PronunciationFeedbackResult {
  const dimensions = capabilityList(input.provider, input.languageTag);
  const base = {
    attemptId: input.attemptId,
    providerId: input.provider.providerId,
    providerVersion: input.provider.providerVersion,
    availableDimensions: dimensions,
    issues: [] as PronunciationIssue[],
    createdAt: input.now ?? Date.now(),
  };
  if (!dimensions.includes("transcription")) return { ...base, status: "unsupported" };
  if (!input.recognizedText?.trim()) return { ...base, status: "uncertain" };

  const comparison = comparePracticeResponse(input.expectedText, input.recognizedText);
  const issues: PronunciationIssue[] = comparison.errors
    .filter((error) => error.kind !== "punctuation" && error.kind !== "diacritic")
    .map((error) => ({ kind: "word", expected: error.expected, actual: error.actual }));
  if (dimensions.includes("timing")) {
    for (const timing of input.wordTimings ?? []) {
      if (timing.endMs <= timing.startMs) issues.push({ kind: "timing", expected: timing.expected, actual: timing.actual, startMs: timing.startMs, endMs: timing.endMs });
    }
  }
  if (dimensions.includes("phoneme")) issues.push(...(input.phonemeIssues ?? []));
  const confidence = typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : undefined;
  return {
    ...base,
    status: confidence !== undefined && confidence < 0.7 ? "uncertain" : "ready",
    score: comparison.score,
    confidence,
    issues,
  };
}

export function pronunciationDimensionLabels(provider: PronunciationProviderManifest, languageTag: string): readonly string[] {
  return advertisedPronunciationDimensions(provider, languageTag);
}
