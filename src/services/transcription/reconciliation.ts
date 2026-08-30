import type { TranscriptionResult, TranscriptionSegment } from "./types";

/**
 * Merge overlapping transcript chunk text using suffix/prefix token matching.
 * Used by pseudo-streaming reconciliation (Phase 6) and unit-tested in isolation.
 */
export function mergeTranscriptChunks(chunks: readonly string[]): string {
  if (chunks.length === 0) return "";
  if (chunks.length === 1) return chunks[0]?.trim() ?? "";

  let merged = chunks[0]?.trim() ?? "";
  for (let index = 1; index < chunks.length; index += 1) {
    const next = chunks[index]?.trim() ?? "";
    if (!next) continue;
    merged = mergeTwoTextChunks(merged, next);
  }
  return merged;
}

function tokenize(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^\w']/g, "");
}

function tokensEqual(left: string, right: string): boolean {
  return normalizeToken(left) === normalizeToken(right);
}

function mergeTwoTextChunks(previous: string, next: string): string {
  const previousTokens = tokenize(previous);
  const nextTokens = tokenize(next);

  if (previousTokens.length === 0) return next;
  if (nextTokens.length === 0) return previous;

  const maxOverlap = Math.min(previousTokens.length, nextTokens.length);
  let overlap = 0;

  for (let length = maxOverlap; length >= 1; length -= 1) {
    const suffix = previousTokens.slice(-length);
    const prefix = nextTokens.slice(0, length);
    if (suffix.every((token, index) => tokensEqual(token, prefix[index] ?? ""))) {
      overlap = length;
      break;
    }
  }

  if (overlap > 0) {
    return [...previousTokens, ...nextTokens.slice(overlap)].join(" ");
  }

  return `${previous} ${next}`.trim();
}

/** Merge chunked batch transcription results for long-form jobs. */
export function mergeChunkedTranscriptionResults(
  results: readonly TranscriptionResult[],
): TranscriptionResult {
  if (results.length === 0) {
    return {
      text: "",
      segments: [],
      providerId: "unknown",
    };
  }

  const texts = results.map((result) => result.text);
  const mergedText = mergeTranscriptChunks(texts);
  const segments: TranscriptionSegment[] = [];
  let timeOffsetMs = 0;

  for (const result of results) {
    for (const segment of result.segments) {
      segments.push({
        ...segment,
        startMs: segment.startMs + timeOffsetMs,
        endMs: segment.endMs + timeOffsetMs,
        words: segment.words?.map((word) => ({
          ...word,
          startMs: word.startMs + timeOffsetMs,
          endMs: word.endMs + timeOffsetMs,
        })),
      });
    }
    const chunkDurationMs =
      result.durationMs ??
      (result.durationSeconds != null ? result.durationSeconds * 1000 : undefined) ??
      (result.segments.at(-1)?.endMs ?? 0);
    timeOffsetMs += chunkDurationMs;
  }

  const first = results[0]!;
  const last = results.at(-1)!;
  const durationMs =
    results.reduce(
      (total, result) =>
        total +
        (result.durationMs ??
          (result.durationSeconds != null ? result.durationSeconds * 1000 : 0)),
      0,
    ) || undefined;

  return {
    text: mergedText,
    segments,
    language: first.language ?? last.language,
    confidence: first.confidence,
    durationMs,
    durationSeconds: durationMs != null ? durationMs / 1000 : undefined,
    providerId: first.providerId,
    model: first.model ?? last.model,
    metadata: {
      chunked: true,
      chunkCount: results.length,
    },
  };
}
