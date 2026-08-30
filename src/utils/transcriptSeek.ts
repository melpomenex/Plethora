import type { TranscriptionSegment } from "../services/transcription/types";

/** Seek playback to the start of a transcript segment (seconds). */
export function seekSecondsFromSegment(segment: Pick<TranscriptionSegment, "startMs">): number {
  return Math.max(0, segment.startMs / 1000);
}

/** Find the segment active at `currentTimeSeconds` for karaoke / click-to-seek UX. */
export function findSegmentAtTime(
  segments: readonly TranscriptionSegment[],
  currentTimeSeconds: number,
): TranscriptionSegment | undefined {
  const currentMs = currentTimeSeconds * 1000;
  return segments.find(
    (segment) => currentMs >= segment.startMs && currentMs < segment.endMs,
  );
}

/** Whether segments carry enough timing for audio seek affordances. */
export function segmentsSupportSeek(segments: readonly TranscriptionSegment[]): boolean {
  return segments.some((segment) => segment.endMs > segment.startMs);
}

/** Whether word-level karaoke highlighting is available. */
export function segmentsSupportWordKaraoke(segments: readonly TranscriptionSegment[]): boolean {
  return segments.some((segment) => (segment.words?.length ?? 0) > 0);
}
