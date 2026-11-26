import { comparePracticeResponse } from "../languagePractice/compare";
import type {
  PitchContourAnalysis,
  SpeechTimingAnalysis,
} from "./acousticAnalysis";
import { resolvePronunciationCapabilities } from "./capability";
import type {
  PronunciationFeedbackResult,
  PronunciationIssue,
  PronunciationProviderManifest,
} from "./types";
import { advertisedPronunciationDimensions } from "./types";

export interface PronunciationWordTiming {
  expected?: string;
  actual?: string;
  startMs: number;
  endMs: number;
}

export interface PronunciationAcousticMetricsInput {
  timing?: SpeechTimingAnalysis;
  pitch?: PitchContourAnalysis;
}

export interface PronunciationAcousticFeedback {
  timing?: SpeechTimingAnalysis;
  pitch?: PitchContourAnalysis;
}

export interface EvaluatedPronunciationFeedbackResult extends PronunciationFeedbackResult {
  acoustic?: PronunciationAcousticFeedback;
}

export interface PronunciationFeedbackInput {
  attemptId: string;
  languageTag: string;
  expectedText: string;
  recognizedText?: string;
  confidence?: number;
  wordTimings?: readonly PronunciationWordTiming[];
  phonemeIssues?: readonly PronunciationIssue[];
  acousticMetrics?: PronunciationAcousticMetricsInput;
  provider: PronunciationProviderManifest;
  now?: number;
}

function collectAcousticTimingIssues(timing: SpeechTimingAnalysis): PronunciationIssue[] {
  if (timing.status !== "ready") return [];
  const issues: PronunciationIssue[] = [];
  if (timing.pauseCount >= 2 && timing.pauseRatio > 0.45) {
    issues.push({
      kind: "timing",
      expected: "steady speech flow",
      actual: `${timing.pauseCount} pauses (${Math.round(timing.pauseRatio * 100)}% non-speech)`,
    });
  }
  if (typeof timing.durationRatio === "number" && (timing.durationRatio < 0.55 || timing.durationRatio > 1.85)) {
    issues.push({
      kind: "timing",
      expected: "duration close to reference",
      actual: `${timing.durationRatio.toFixed(2)}x reference speech duration`,
    });
  }
  return issues;
}

/**
 * Evaluates pronunciation feedback strictly gated by `provider.capabilities`.
 * Integrates genuine WebAudio acoustic timing/prosody metrics when `"timing"` is supported,
 * and never fabricates `"phoneme"` or `"timing"` dimensions without capability support.
 */
export function evaluatePronunciationFeedback(input: PronunciationFeedbackInput): EvaluatedPronunciationFeedbackResult {
  const dimensions = resolvePronunciationCapabilities(input.provider, input.languageTag);
  const supportsTranscription = dimensions.includes("transcription");
  const supportsTiming = dimensions.includes("timing");
  const supportsPhoneme = dimensions.includes("phoneme");
  const base = {
    attemptId: input.attemptId,
    providerId: input.provider.providerId,
    providerVersion: input.provider.providerVersion,
    availableDimensions: dimensions,
    issues: [] as PronunciationIssue[],
    createdAt: input.now ?? Date.now(),
  };

  if (!supportsTranscription && !supportsTiming) {
    return { ...base, status: "unsupported" };
  }

  const issues: PronunciationIssue[] = [];
  let acoustic: PronunciationAcousticFeedback | undefined;
  if (supportsTiming && input.acousticMetrics) {
    acoustic = {
      timing: input.acousticMetrics.timing,
      pitch: input.acousticMetrics.pitch,
    };
    if (input.acousticMetrics.timing) {
      issues.push(...collectAcousticTimingIssues(input.acousticMetrics.timing));
    }
  }

  if (!supportsTranscription) {
    const timingReady = acoustic?.timing?.status === "ready";
    const pitchReady = acoustic?.pitch?.status === "ready";
    if (!timingReady && !pitchReady) {
      return { ...base, status: "uncertain", issues, acoustic };
    }
    return { ...base, status: "ready", issues, acoustic };
  }

  if (!input.recognizedText?.trim()) {
    return { ...base, status: "uncertain", issues, acoustic };
  }

  const comparison = comparePracticeResponse(input.expectedText, input.recognizedText);
  const wordIssues: PronunciationIssue[] = comparison.errors
    .filter((error) => error.kind !== "punctuation" && error.kind !== "diacritic")
    .map((error) => ({ kind: "word", expected: error.expected, actual: error.actual }));
  issues.unshift(...wordIssues);

  if (supportsTiming) {
    for (const timing of input.wordTimings ?? []) {
      if (timing.endMs <= timing.startMs) {
        issues.push({ kind: "timing", expected: timing.expected, actual: timing.actual, startMs: timing.startMs, endMs: timing.endMs });
      }
    }
  }

  // Only forward phoneme issues supplied by a real phoneme-capable provider; never fabricate them.
  if (supportsPhoneme && input.phonemeIssues?.length) {
    for (const issue of input.phonemeIssues) {
      if (issue.kind === "phoneme") {
        issues.push(issue);
      }
    }
  }

  const confidence = typeof input.confidence === "number" ? Math.max(0, Math.min(1, input.confidence)) : undefined;
  const acousticInsufficient = supportsTiming && acoustic?.timing?.status === "insufficient-signal";
  const status = (confidence !== undefined && confidence < 0.7) || acousticInsufficient ? "uncertain" : "ready";

  return {
    ...base,
    status,
    score: comparison.score,
    confidence,
    issues,
    acoustic,
  };
}

export function pronunciationDimensionLabels(provider: PronunciationProviderManifest, languageTag: string): readonly string[] {
  return advertisedPronunciationDimensions(provider, languageTag);
}
