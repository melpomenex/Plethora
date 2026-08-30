import type { TTSChunk } from "../../utils/readerSpeechIndex";
import type { WordTiming } from "../../utils/wordTimings";
import { wordTimingsAlignWith } from "../../utils/wordTimings";
import { sourceAnchorToLocator } from "./locators";
import type { TimedTextEntry, TimedTextMap } from "./types";
import { TIMED_TEXT_MAP_VERSION } from "./types";

export interface BuildChunkTimedTextOptions {
  documentId: string;
  chunk: TTSChunk;
  timings: WordTiming[];
  fingerprint?: string;
  /** Base offset (ms) when this chunk is part of a longer timeline. */
  timeOffsetMs?: number;
}

/**
 * Build a TimedTextMap slice for one TTS chunk from measured or synthesized
 * word timings aligned positionally with chunk words.
 */
export function buildTimedTextMapFromTtsChunk(options: BuildChunkTimedTextOptions): TimedTextMap | null {
  const { documentId, chunk, timings, fingerprint, timeOffsetMs = 0 } = options;
  if (!wordTimingsAlignWith(chunk.text, timings)) return null;

  const entries: TimedTextEntry[] = timings.map((timing, wordIndex) => {
    const word = chunk.words[wordIndex];
    return {
      startMs: timing.start_ms + timeOffsetMs,
      endMs: timing.end_ms + timeOffsetMs,
      text: word?.text ?? timing.word,
      locator: sourceAnchorToLocator(word?.anchor ?? null),
      granularity: "word" as const,
      timingSource: timing.source ?? "measured",
      chunkIndex: chunk.index,
      wordIndex,
    };
  });

  return {
    version: TIMED_TEXT_MAP_VERSION,
    documentId,
    sourceType: "generated_tts",
    fingerprint,
    entries,
  };
}

/** Build timed-text entries for playback lookup (with optional chunk locators). */
export function buildTimedTextEntriesFromChunkTimings(
  timings: WordTiming[],
  chunk?: TTSChunk,
  timeOffsetMs = 0,
): TimedTextEntry[] | null {
  if (chunk && !wordTimingsAlignWith(chunk.text, timings)) return null;
  return timings.map((timing, wordIndex) => {
    const word = chunk?.words[wordIndex];
    return {
      startMs: timing.start_ms + timeOffsetMs,
      endMs: timing.end_ms + timeOffsetMs,
      text: word?.text ?? timing.word,
      locator: sourceAnchorToLocator(word?.anchor ?? null),
      granularity: "word" as const,
      timingSource: timing.source ?? "measured",
      chunkIndex: chunk?.index,
      wordIndex,
    };
  });
}
