import { updateDocumentContent } from "../../api/documents";
import { setVideoTranscript, type VideoTranscriptSegment } from "../../api/video-extracts";
import { commitSessionUnit, type SessionTranscriptSegmentInput } from "../../api/recordingSessions";
import type { TranscriptionResult } from "./types";

export function transcriptionResultToVideoSegments(
  result: TranscriptionResult,
): VideoTranscriptSegment[] {
  return result.segments.map((segment) => ({
    time: segment.startMs / 1000,
    end: segment.endMs / 1000,
    text: segment.text,
    wordTimings: segment.words?.map((word) => ({
      word: word.word,
      start_ms: word.startMs,
      end_ms: word.endMs,
    })),
  }));
}

export interface CommitSessionUnitOptions {
  jobId: string;
  sessionId: string;
  unitKey: string;
  expectedCancelEpoch: number;
  leaseOwner: string;
  processedDurationMs: number;
  totalDurationMs?: number | null;
  timeOffsetMs?: number;
  startOrdinal?: number;
  revision?: number;
  timingKind?: "measured" | "imported" | "none";
}

export function transcriptionResultToSessionSegments(
  result: TranscriptionResult,
  options: {
    unitKey: string;
    timeOffsetMs?: number;
    startOrdinal?: number;
    revision?: number;
    timingKind?: "measured" | "imported" | "none";
  },
): SessionTranscriptSegmentInput[] {
  const timeOffset = options.timeOffsetMs ?? 0;
  const startOrdinal = options.startOrdinal ?? 0;
  const revision = options.revision ?? 0;
  const timingKind = options.timingKind ?? "measured";

  if (timingKind === "none" || result.segments.length === 0) {
    if (!result.text.trim()) return [];
    return [
      {
        segmentKey: `${options.unitKey}:0`,
        ordinal: startOrdinal,
        startMs: null,
        endMs: null,
        text: result.text.trim(),
        confidence: result.segments[0]?.confidence ?? null,
        wordsJson: null,
        speakerId: result.segments[0]?.speakerId ?? null,
        timingKind: "none",
        revision,
        metadataJson: null,
      },
    ];
  }

  return result.segments.map((segment, idx) => {
    const startMs = segment.startMs + timeOffset;
    const endMs = segment.endMs + timeOffset;
    const words = segment.words?.map((w) => ({
      text: w.word,
      startMs: w.startMs + timeOffset,
      endMs: w.endMs + timeOffset,
      source: timingKind,
    }));

    return {
      segmentKey: `${options.unitKey}:${idx}`,
      ordinal: startOrdinal + idx,
      startMs,
      endMs,
      text: segment.text,
      confidence: segment.confidence ?? null,
      wordsJson: words && words.length > 0 ? JSON.stringify(words) : null,
      speakerId: segment.speakerId ?? null,
      timingKind,
      revision,
      metadataJson: null,
    };
  });
}

export async function persistSessionTranscriptionUnit(
  result: TranscriptionResult,
  options: CommitSessionUnitOptions,
): Promise<number> {
  const segments = transcriptionResultToSessionSegments(result, {
    unitKey: options.unitKey,
    timeOffsetMs: options.timeOffsetMs,
    startOrdinal: options.startOrdinal,
    revision: options.revision,
    timingKind: options.timingKind,
  });

  return commitSessionUnit(
    options.jobId,
    options.sessionId,
    options.expectedCancelEpoch,
    options.leaseOwner,
    options.processedDurationMs,
    options.totalDurationMs ?? null,
    segments,
  );
}

export async function persistTranscriptionResult(
  documentId: string,
  result: TranscriptionResult,
): Promise<void> {
  const segments = transcriptionResultToVideoSegments(result);
  await setVideoTranscript(documentId, result.text, segments);
  try {
    await updateDocumentContent(documentId, result.text);
  } catch {
    // Non-critical: transcript is still saved for playback/search.
  }
}
