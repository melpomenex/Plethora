import type { SentenceModeIndexAdapter, SentenceModeSource, SentenceSegment } from "./types";
import { createTextSentenceSegments } from "./identity";

/** Lazy, bounded sentence index for text-like readers. Other readers can provide the same adapter contract. */
export class TextSentenceIndexAdapter implements SentenceModeIndexAdapter {
  readonly source: SentenceModeSource = "text";
  readonly contentFingerprint: string;
  private readonly segments: readonly SentenceSegment[];

  constructor(readonly sourceId: string, text: string, contentFingerprint?: string) {
    this.segments = createTextSentenceSegments(sourceId, text, contentFingerprint);
    this.contentFingerprint = this.segments[0]?.identity.contentFingerprint ?? contentFingerprint ?? "";
  }

  async getWindow(offset: number, limit: number, signal?: AbortSignal): Promise<readonly SentenceSegment[]> {
    if (signal?.aborted) return [];
    const start = Math.max(0, Math.floor(offset));
    return this.segments.slice(start, start + Math.max(0, Math.min(100, Math.floor(limit))));
  }

  async resolve(sentenceId: string, signal?: AbortSignal): Promise<SentenceSegment | null> {
    if (signal?.aborted) return null;
    return this.segments.find((segment) => segment.identity.sentenceId === sentenceId) ?? null;
  }
}

export function createSentenceIndexAdapter(source: SentenceModeSource, sourceId: string, text: string, contentFingerprint?: string): SentenceModeIndexAdapter {
  // Text segmentation is deterministic for HTML/Markdown/Queue/transcript
  // projections too; source-specific adapters can preserve richer anchors.
  return new TextSentenceIndexAdapter(sourceId, text, contentFingerprint);
}
