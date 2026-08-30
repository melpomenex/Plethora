/** Provider-agnostic transcript input for the alignment engine. */
export interface TranscriptionWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TranscriptionSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TranscriptionTimeline {
  providerId: string;
  providerVersion?: string;
  language?: string;
  words: TranscriptionWord[];
  segments?: TranscriptionSegment[];
  fingerprint: string;
}

export type EbookWordLocator =
  | { kind: "epub"; chapterHref: string; charOffset: number }
  | { kind: "html"; documentId: string; blockId: string; charOffset: number };

export type AlignmentOp = "match" | "substitute" | "insert" | "delete";

export interface AlignedWord {
  text: string;
  locator: EbookWordLocator;
  startMs: number;
  endMs: number;
  confidence: number;
  interpolated: boolean;
  op: AlignmentOp;
  sentenceId?: number;
}

export interface AlignedChapter {
  ebookChapterHref: string;
  audioChapterIndex: number;
  audioStartMs: number;
  audioEndMs: number;
  chapterConfidence: number;
  status: "complete" | "failed" | "partial";
  words: AlignedWord[];
  error?: string;
}

export const ALIGNMENT_MAP_VERSION = 2 as const;

export interface PlethoraAlignmentMap {
  version: typeof ALIGNMENT_MAP_VERSION;
  pairId: string;
  ebookDocId: string;
  audioDocId: string;
  ebookContentHash: string;
  audioContentHash: string;
  transcriptFingerprint: string;
  granularity: "word";
  createdAt: string;
  updatedAt: string;
  chapters: AlignedChapter[];
  overallConfidence: number;
}

export interface EbookChapterInput {
  href: string;
  label: string;
  plainText: string;
}

export interface AudioChapterInput {
  index: number;
  title: string;
  startMs: number;
  endMs: number;
}

export interface AlignChapterInput {
  chapter: EbookChapterInput;
  audioChapter: AudioChapterInput;
  timeline: TranscriptionTimeline;
}

export interface AlignBookInput {
  ebookDocId: string;
  audioDocId: string;
  ebookContentHash: string;
  audioContentHash: string;
  chapters: EbookChapterInput[];
  audioChapters: AudioChapterInput[];
  timeline: TranscriptionTimeline;
}

export interface AlignProgress {
  phase: "preparing" | "aligning" | "validating" | "complete";
  chapterIndex: number;
  chapterTotal: number;
  chapterHref?: string;
  message: string;
}
