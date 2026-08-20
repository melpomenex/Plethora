import { contentFingerprint } from "../languageProcessing/fingerprints";
import type { SentenceIdentity, SentenceSegment } from "./types";

export function sentenceId(sourceId: string, startOffset: number, endOffset: number, text: string): string {
  return `${sourceId}:${startOffset}:${endOffset}:${contentFingerprint(text).slice(0, 16)}`;
}

export function createTextSentenceSegments(sourceId: string, text: string, contentHash = contentFingerprint(text)): SentenceSegment[] {
  const segments: SentenceSegment[] = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    const value = match[0].trim();
    if (!value) continue;
    const startOffset = match.index + match[0].indexOf(value);
    const endOffset = startOffset + value.length;
    const identity: SentenceIdentity = {
      sentenceId: sentenceId(sourceId, startOffset, endOffset, value),
      sourceId,
      contentFingerprint: contentHash,
      sourceAnchor: {
        sourceType: "text",
        sourceId,
        contentFingerprint: contentHash,
        locator: { startOffset, endOffset },
      },
    };
    segments.push({ identity, index, text: value, startOffset, endOffset, freshness: "ready" });
    index += 1;
  }
  return segments;
}

export function isSentenceIdentityFresh(segment: SentenceSegment, contentHash: string, analysisVersion?: string): boolean {
  return segment.identity.contentFingerprint === contentHash &&
    (analysisVersion === undefined || segment.identity.analysisVersion === undefined || segment.identity.analysisVersion === analysisVersion);
}
