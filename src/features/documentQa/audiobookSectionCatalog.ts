import type { Document } from "../../types/document";
import {
  buildMediaTranscriptSections,
  type SectionNode,
  type TimedMediaChapter,
  type TimedTranscriptSegment,
} from "../../utils/sectionIndex";

interface StorageReader {
  getItem(key: string): string | null;
}

interface StoredAudiobookRecord {
  chapters?: unknown;
  transcript?: { segments?: unknown };
}

export interface AudiobookSectionCatalogDeps {
  storage?: StorageReader;
  parseMetadata?: (filePath: string) => Promise<{ chapters?: unknown }>;
  loadTranscript?: (bookId: string, chapterId: string) => Promise<{ segments?: unknown } | null>;
}

function normalizeChapters(value: unknown): TimedMediaChapter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const chapter = candidate as Record<string, unknown>;
    const startTime = Number(chapter.startTime);
    if (!Number.isFinite(startTime)) return [];
    const rawEnd = chapter.endTime;
    const endTime = rawEnd == null ? undefined : Number(rawEnd);
    return [{
      id: typeof chapter.id === "number" || typeof chapter.id === "string" ? chapter.id : index + 1,
      title: typeof chapter.title === "string" && chapter.title.trim()
        ? chapter.title.trim()
        : `Chapter ${index + 1}`,
      startTime,
      ...(Number.isFinite(endTime) ? { endTime } : {}),
    }];
  });
}

function normalizeSegments(value: unknown): TimedTranscriptSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const segment = candidate as Record<string, unknown>;
    if (typeof segment.text !== "string" || !segment.text.trim()) return [];
    return [{
      text: segment.text,
      ...(typeof segment.startTime === "number" ? { startTime: segment.startTime } : {}),
      ...(typeof segment.endTime === "number" ? { endTime: segment.endTime } : {}),
      ...(typeof segment.start === "number" ? { start: segment.start } : {}),
      ...(typeof segment.end === "number" ? { end: segment.end } : {}),
      ...(typeof segment.start_ms === "number" ? { start_ms: segment.start_ms } : {}),
      ...(typeof segment.end_ms === "number" ? { end_ms: segment.end_ms } : {}),
    }];
  });
}

function hasRealChapters(chapters: TimedMediaChapter[]): boolean {
  return chapters.length > 1
    || (chapters.length === 1
      && chapters[0]?.title.trim().toLowerCase() !== "chapter 1");
}

function readStoredRecord(documentId: string, storage?: StorageReader): StoredAudiobookRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`audiobook-${documentId}`);
    return raw ? JSON.parse(raw) as StoredAudiobookRecord : null;
  } catch {
    return null;
  }
}

/**
 * Rebuild the same transcript-backed chapter catalog used beside the audiobook.
 * The viewer-published catalog normally wins; this loader covers Document Q&A
 * opened directly or after an application restart.
 */
export async function loadAudiobookSectionCatalog(
  document: Pick<Document, "id" | "filePath">,
  deps: AudiobookSectionCatalogDeps = {},
): Promise<SectionNode[]> {
  const storage = deps.storage
    ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  const stored = readStoredRecord(document.id, storage);
  let chapters = normalizeChapters(stored?.chapters);
  let segments = normalizeSegments(stored?.transcript?.segments);

  if (!hasRealChapters(chapters) && document.filePath) {
    try {
      const parseMetadata = deps.parseMetadata
        ?? (async (filePath: string) => (await import("../../api/audiobooks")).parseAudiobookMetadata(filePath));
      chapters = normalizeChapters((await parseMetadata(document.filePath)).chapters);
    } catch {
      // The stored metadata may still be sufficient; transcript headings remain
      // available as a fallback in Document Q&A when no timed catalog can load.
    }
  }

  if (!hasRealChapters(chapters)) return [];

  if (segments.length === 0) {
    const loadTranscript = deps.loadTranscript
      ?? (async (bookId: string, chapterId: string) => (await import("../../api/transcription")).getTranscript(bookId, chapterId));
    const candidateIds = [...new Set([
      document.id,
      chapters[0]?.id != null ? String(chapters[0].id) : "",
      "default",
    ].filter(Boolean))];
    for (const chapterId of candidateIds) {
      try {
        const response = await loadTranscript(document.id, chapterId);
        segments = normalizeSegments(response?.segments);
        if (segments.length > 0) break;
      } catch {
        // Try the next storage convention used by the transcription paths.
      }
    }
  }

  return buildMediaTranscriptSections(document.id, chapters, segments);
}
