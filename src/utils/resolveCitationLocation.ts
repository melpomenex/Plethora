/**
 * Chunk-to-location resolver for Document Q&A retrieval citations.
 *
 * Retrieval citations carry `chunkText` but no page/CFI/timestamp metadata
 * (see `index_document_inner` in `src-tauri/src/commands/rag.rs`). This module
 * resolves a citation's location from the chunk text at click/render time by
 * locating the quote in the document's existing content — no re-indexing and
 * no schema migration.
 *
 * Resolution is best-effort by design (see `design.md`): a missing document,
 * missing content, or an unmatched quote yields `null` — never a guessed
 * location. The UI renders `null` as an inert entry with a stated reason.
 *
 * Matching strategy: whitespace-collapsed, case-folded quote prefix (~120
 * chars), with a shorter-prefix retry on miss. Transcript-backed documents
 * resolve by finding the segment whose text the quote belongs to.
 */

import type { Document } from "../types/document";
import type { ExactSearchHitLocation } from "../types/searchHit";
import { fetchYouTubeTranscript } from "../api/youtube";
import { getTranscript } from "../api/transcription";
import { getVideoTranscript } from "../api/video-extracts";

const QUOTE_PREFIX_CHARS = 120;
const QUOTE_PREFIX_RETRY_CHARS = 60;

/**
 * Fold typographic punctuation to its plain ASCII equivalent before matching.
 * Real libraries contain e.g. curly quotes (‘ ’ “ ”) in stored/extracted text
 * while indexed chunk text carries straight quotes (the extractors have
 * changed over time), so quote matching must not fail on punctuation alone.
 */
const TYPOGRAPHY_FOLDS: Array<[RegExp, string]> = [
  [/[\u2018\u2019\u02bc]/g, "'"], // ‘ ’ ʼ
  [/[\u201c\u201d]/g, '"'], // “ ”
  [/[\u2013\u2014\u2212]/g, "-"], // – — −
  [/\u2026/g, "..."], // …
  [/\u00a0/g, " "], // non-breaking space (also matched by \s, explicit for clarity)
];

/** Apply the typography folds to a string. */
function foldTypography(text: string): string {
  let folded = text;
  for (const [pattern, replacement] of TYPOGRAPHY_FOLDS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded;
}

/** Whitespace-collapse (including non-breaking spaces) and case-fold. */
export function normalizeSearchText(text: string): string {
  return foldTypography(text).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Case-preserved, whitespace-collapsed prefix of the chunk, for `textQuote`. */
function quoteText(chunkText: string, length: number): string {
  return chunkText.replace(/\s+/g, " ").trim().slice(0, length).trim();
}

interface AudioTranscriptSegment {
  id: string;
  startSeconds: number;
  text: string;
}

interface VideoTranscriptLike {
  segments: Array<{ time: number; text: string }>;
}

/** Injectable I/O so unit tests can resolve transcripts without the network. */
export interface CitationLocationDeps {
  fetchYouTubeSegments?: (videoId: string) => Promise<Array<{ start: number; text: string }>>;
  loadStoredAudioSegments?: (documentId: string) => AudioTranscriptSegment[];
  loadWhisperSegments?: (documentId: string) => Promise<AudioTranscriptSegment[]>;
  loadVideoTranscript?: (documentId: string) => Promise<VideoTranscriptLike | null>;
}

/** Mirror of `CommandCenter`'s `extractYouTubeId` (kept local to avoid coupling). */
function extractYouTubeId(urlOrId: string): string {
  if (!urlOrId) return "";
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) return match[1];
  }
  return urlOrId;
}

/**
 * Find the first occurrence of the normalized quote in the given (already
 * normalized) content, retrying with a shorter prefix. Returns the match
 * index, or -1.
 */
function findQuoteIndexIn(normalizedContent: string, chunkText: string): number {
  if (!normalizedContent) return -1;
  for (const length of [QUOTE_PREFIX_CHARS, QUOTE_PREFIX_RETRY_CHARS]) {
    const prefix = normalizeSearchText(chunkText).slice(0, length);
    if (!prefix) return -1;
    const index = normalizedContent.indexOf(prefix);
    if (index !== -1) return index;
  }
  return -1;
}

/**
 * Build a whitespace-collapsed, case-folded copy of PDF content that keeps
 * page boundaries identifiable.
 *
 * The Rust PDF processor (`src-tauri/src/processor/pdf.rs`) stores the raw
 * pdf-extract output as the document content; pages are separated by form-feed
 * (`\u000c`) characters. (The `id="page-N"` HTML markers the design doc assumed
 * only exist in the on-demand viewer HTML, not in the stored content.)
 * `matchable` collapses every whitespace run to a single space and folds case,
 * while `boundaryIndexes` records which positions in `matchable` are page
 * boundaries, so a match index can be mapped back to a page number.
 */
function pageifyPdfContent(content: string): { matchable: string; boundaryIndexes: number[] } {
  let matchable = "";
  const boundaryIndexes: number[] = [];
  const source = foldTypography(content);
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\u000c") {
      matchable += " ";
      boundaryIndexes.push(matchable.length - 1);
      i += 1;
    } else if (/\s/.test(ch)) {
      // Collapse the whole whitespace run; if it contained a form feed, the
      // emitted single space is a page boundary.
      let runHasBoundary = false;
      let j = i;
      while (j < source.length && /\s/.test(source[j])) {
        if (source[j] === "\u000c") runHasBoundary = true;
        j += 1;
      }
      matchable += " ";
      if (runHasBoundary) boundaryIndexes.push(matchable.length - 1);
      i = j;
    } else {
      matchable += ch.toLowerCase();
      i += 1;
    }
  }
  return { matchable, boundaryIndexes };
}

/**
 * Resolve the page containing `matchIndex` in `matchable` PDF content.
 *
 * 1. Form-feed boundaries (the real separators in stored pdf-extract text):
 *    page = number of boundaries before the match + 1.
 * 2. No boundaries at all: page 1 only when the document is known to be
 *    single-page; otherwise refuse rather than guess.
 * 3. Fallback to the nearest `id="page-N"` marker (content that is the
 *    converted viewer HTML, e.g. from an alternate import path).
 *
 * Returns `null` when the page cannot be determined.
 */
function resolvePdfPage(
  matchable: string,
  matchIndex: number,
  boundaryIndexes: number[],
  document: Document
): number | null {
  let boundaryCount = 0;
  for (const boundary of boundaryIndexes) {
    if (boundary < matchIndex) boundaryCount += 1;
    else break;
  }
  if (boundaryCount > 0) return boundaryCount + 1;

  const pageCount = document.totalPages ?? document.metadata?.pageCount;
  if (typeof pageCount === "number" && pageCount <= 1) return 1;

  const marker = 'id="page-';
  const markerIndex = matchable.lastIndexOf(marker, matchIndex);
  if (markerIndex !== -1) {
    const digits = /^(\d+)/.exec(matchable.slice(markerIndex + marker.length));
    if (digits) {
      const page = parseInt(digits[1], 10);
      if (Number.isFinite(page) && page > 0) return page;
    }
  }
  return null;
}

/** Index of the first segment whose text the cited chunk spans, or -1. */
function findTranscriptSegmentIndex(
  segments: Array<{ text: string }>,
  chunkText: string
): number {
  const normalizedChunk = normalizeSearchText(chunkText);
  if (!normalizedChunk) return -1;
  const fullPrefix = normalizedChunk.slice(0, QUOTE_PREFIX_CHARS);
  const shortPrefix = normalizedChunk.slice(0, QUOTE_PREFIX_RETRY_CHARS);
  for (let i = 0; i < segments.length; i++) {
    const segmentText = normalizeSearchText(segments[i].text);
    if (!segmentText) continue;
    // Transcripts are built from consecutive segments, so a chunk contains the
    // full text of the segments it spans; also accept the quote (or a shorter
    // prefix of it) appearing inside a segment.
    if (
      normalizedChunk.includes(segmentText) ||
      segmentText.includes(fullPrefix) ||
      segmentText.includes(shortPrefix)
    ) {
      return i;
    }
  }
  return -1;
}

function normalizeAudioSegments(segments: unknown[]): AudioTranscriptSegment[] {
  return segments
    .map((segment, index) => {
      const value = segment as {
        id?: string | number;
        text?: string;
        startTime?: number;
        start_ms?: number;
      };
      const text = typeof value.text === "string" ? value.text.trim() : "";
      const startSeconds =
        typeof value.startTime === "number"
          ? value.startTime
          : typeof value.start_ms === "number"
            ? value.start_ms / 1000
            : 0;
      if (!text || !Number.isFinite(startSeconds)) return null;
      return {
        id: value.id != null ? String(value.id) : `seg-${index}`,
        startSeconds: Math.max(0, startSeconds),
        text,
      };
    })
    .filter((segment): segment is AudioTranscriptSegment => segment != null);
}

/** Stored whisper transcript for an audio document (localStorage mirror of `CommandCenter`). */
function readStoredAudioSegments(documentId: string): AudioTranscriptSegment[] {
  try {
    const data = window.localStorage.getItem(`audiobook-${documentId}`);
    if (!data) return [];
    const parsed = JSON.parse(data) as { transcript?: { segments?: unknown[] } };
    const segments = parsed.transcript?.segments;
    return Array.isArray(segments) ? normalizeAudioSegments(segments) : [];
  } catch {
    return [];
  }
}

const defaultDeps: Required<CitationLocationDeps> = {
  fetchYouTubeSegments: (videoId) => fetchYouTubeTranscript(videoId),
  loadStoredAudioSegments: (documentId) => readStoredAudioSegments(documentId),
  loadWhisperSegments: async (documentId) => {
    try {
      const response = await getTranscript(documentId, "default");
      return normalizeAudioSegments(response?.segments ?? []);
    } catch {
      return [];
    }
  },
  loadVideoTranscript: async (documentId) => {
    try {
      return await getVideoTranscript(documentId);
    } catch {
      return null;
    }
  },
};

/**
 * Resolve where in `document` the cited `chunkText` lives.
 *
 * Returns an `ExactSearchHitLocation` the `DocumentViewer` can jump to, or
 * `null` when the document/content is missing or the quote cannot be matched —
 * never a guessed location.
 */
export async function resolveCitationLocation(
  document: Document | undefined | null,
  chunkText: string,
  deps: CitationLocationDeps = {}
): Promise<ExactSearchHitLocation | null> {
  if (!document || !chunkText || !chunkText.trim()) return null;
  const allDeps: Required<CitationLocationDeps> = { ...defaultDeps, ...deps };
  const fileType = document.fileType;

  // Transcript-backed documents: the document content is not a searchable
  // transcript, so locate the quote in the timed segments.
  if (fileType === "youtube" || fileType === "audio" || fileType === "video") {
    return resolveTranscriptLocation(document, chunkText, allDeps);
  }

  if (!document.content || !document.content.trim()) return null;

  if (fileType === "pdf") {
    // PDFs store raw pdf-extract text with \u000c page separators — normalize
    // once with boundary tracking instead of the generic whitespace collapse.
    const { matchable, boundaryIndexes } = pageifyPdfContent(document.content);
    const matchIndex = findQuoteIndexIn(matchable, chunkText);
    if (matchIndex === -1) return null;
    const pageNumber = resolvePdfPage(matchable, matchIndex, boundaryIndexes, document);
    if (pageNumber === null) return null;
    return {
      kind: "pdf",
      pageNumber,
      textQuote: quoteText(chunkText, QUOTE_PREFIX_CHARS),
    };
  }

  const normalized = normalizeSearchText(document.content);

  if (fileType === "epub") {
    const matchIndex = findQuoteIndexIn(normalized, chunkText);
    if (matchIndex === -1) return null;
    return {
      kind: "epub",
      cfi: "",
      textQuote: quoteText(chunkText, QUOTE_PREFIX_CHARS),
    };
  }

  if (fileType === "html" || fileType === "markdown") {
    const matchIndex = findQuoteIndexIn(normalized, chunkText);
    if (matchIndex === -1) return null;
    return {
      kind: fileType,
      textQuote: quoteText(chunkText, QUOTE_PREFIX_CHARS),
    };
  }

  // `other`/`image` documents have no supported navigation location.
  return null;
}

async function resolveTranscriptLocation(
  document: Document,
  chunkText: string,
  deps: Required<CitationLocationDeps>
): Promise<ExactSearchHitLocation | null> {
  if (document.fileType === "youtube") {
    const videoId = extractYouTubeId(document.filePath);
    if (!videoId) return null;
    try {
      const segments = await deps.fetchYouTubeSegments(videoId);
      const index = findTranscriptSegmentIndex(segments, chunkText);
      if (index === -1) return null;
      const segment = segments[index];
      return {
        kind: "youtube",
        timeSeconds: segment.start,
        segmentId: `seg-${index}`,
        textQuote: segment.text,
      };
    } catch {
      return null;
    }
  }

  if (document.fileType === "audio") {
    let segments = deps.loadStoredAudioSegments(document.id);
    if (segments.length === 0) {
      segments = await deps.loadWhisperSegments(document.id);
    }
    const index = findTranscriptSegmentIndex(segments, chunkText);
    if (index === -1) return null;
    const segment = segments[index];
    return {
      kind: "audio",
      timeSeconds: segment.startSeconds,
      segmentId: segment.id,
      textQuote: segment.text,
    };
  }

  if (document.fileType === "video") {
    const transcript = await deps.loadVideoTranscript(document.id);
    if (!transcript || !Array.isArray(transcript.segments)) return null;
    const index = findTranscriptSegmentIndex(transcript.segments, chunkText);
    if (index === -1) return null;
    const segment = transcript.segments[index];
    // `ExactSearchHitLocation` has no `video` kind; audio is the media kind the
    // viewer's transcript consumers expect. The viewer's video docType does not
    // consume `initialJump` today, so activation opens the document and the
    // footer still shows an accurate timestamp label.
    return {
      kind: "audio",
      timeSeconds: segment.time,
      segmentId: `seg-${index}`,
      textQuote: segment.text,
    };
  }

  return null;
}
