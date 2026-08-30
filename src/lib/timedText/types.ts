/**
 * Shared timed-text synchronization model.
 *
 * Both document TTS and ebook+audiobook alignment produce the same shape:
 * "at audio time T, this semantic text location is active."
 */

/** Stable semantic location in a document — never a DOM node reference. */
export type TextLocator =
  | { kind: "epub-spine"; spineIndex: number; sectionOffset: number }
  | { kind: "epub-href"; chapterHref: string; charOffset: number }
  | { kind: "pdf-word"; wordId: string }
  | { kind: "pdf-token"; tokenId: string }
  | { kind: "text"; surface: string; startOffset: number }
  | { kind: "page"; pageNumber: number; pageOffset: number }
  | { kind: "html"; documentId: string; blockId: string; charOffset: number };

export type TimedTextGranularity = "word" | "sentence" | "block" | "page";

export type TimedTextSource =
  | "generated_tts"
  | "audiobook_alignment"
  | "epub_media_overlay"
  | "transcript"
  | "future_import";

export type TimedTextTimingSource = "measured" | "synthesized";

export interface TimedTextEntry {
  startMs: number;
  endMs: number;
  text: string;
  locator: TextLocator | null;
  granularity: TimedTextGranularity;
  confidence?: number;
  interpolated?: boolean;
  timingSource?: TimedTextTimingSource;
  sentenceId?: number;
  /** Chunk index when map represents a single TTS utterance slice. */
  chunkIndex?: number;
  /** Word index within chunk when applicable. */
  wordIndex?: number;
}

export const TIMED_TEXT_MAP_VERSION = 1 as const;

export interface TimedTextMap {
  version: typeof TIMED_TEXT_MAP_VERSION;
  documentId: string;
  sourceType: TimedTextSource;
  fingerprint?: string;
  entries: TimedTextEntry[];
}

export interface TimedTextLookupResult {
  entry: TimedTextEntry;
  index: number;
}
