import { updateDocumentContent } from "../../api/documents";
import { setVideoTranscript, type VideoTranscriptSegment } from "../../api/video-extracts";
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
