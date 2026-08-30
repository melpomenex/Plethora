import type { TranscriptionSegment, TranscriptionTimeline, TranscriptionWord } from "./types";
import { synthesizeWordTimings } from "../../utils/wordTimings";

export function fromSegments(
  segments: TranscriptionSegment[],
  providerId: string,
  providerVersion?: string,
): TranscriptionTimeline {
  const words: TranscriptionWord[] = [];
  for (const seg of segments) {
    const segWords = seg.words?.length
      ? seg.words.map((word) => ({
        word: word.text,
        start_ms: word.startMs,
        end_ms: word.endMs,
      }))
      : synthesizeWordTimings(seg.text, seg.startMs / 1000, seg.endMs / 1000);
    for (const w of segWords) {
      words.push({
        text: w.word,
        startMs: w.start_ms,
        endMs: w.end_ms,
        confidence: seg.confidence,
      });
    }
  }
  return {
    providerId,
    providerVersion,
    words,
    segments,
    fingerprint: fingerprintTimeline(segments),
  };
}

export function fromWords(
  words: TranscriptionWord[],
  providerId: string,
  providerVersion?: string,
): TranscriptionTimeline {
  return {
    providerId,
    providerVersion,
    words: [...words].sort((a, b) => a.startMs - b.startMs),
    fingerprint: fingerprintWords(words),
  };
}

export function sliceTimeline(
  timeline: TranscriptionTimeline,
  startMs: number,
  endMs: number,
): TranscriptionTimeline {
  const words = timeline.words.filter(
    (w) => w.endMs > startMs && w.startMs < endMs,
  );
  return {
    ...timeline,
    words,
    fingerprint: `${timeline.fingerprint}:${startMs}-${endMs}`,
  };
}

function fingerprintTimeline(segments: TranscriptionSegment[]): string {
  let h = 5381;
  for (const s of segments) {
    h = ((h << 5) + h) ^ s.startMs;
    h = ((h << 5) + h) ^ s.endMs;
    for (let i = 0; i < Math.min(s.text.length, 80); i++) {
      h = ((h << 5) + h) ^ s.text.charCodeAt(i);
    }
    for (const word of s.words ?? []) {
      h = ((h << 5) + h) ^ word.startMs;
      h = ((h << 5) + h) ^ word.endMs;
    }
  }
  return (h >>> 0).toString(16);
}

function fingerprintWords(words: TranscriptionWord[]): string {
  let h = 5381;
  for (const w of words) {
    h = ((h << 5) + h) ^ w.startMs;
    h = ((h << 5) + h) ^ w.endMs;
    for (let i = 0; i < Math.min(w.text.length, 40); i++) {
      h = ((h << 5) + h) ^ w.text.charCodeAt(i);
    }
  }
  return (h >>> 0).toString(16);
}
