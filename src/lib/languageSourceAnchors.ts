import type { SourceAnchor } from "../types/languageLexicon";

export function epubSourceAnchor(documentId: string, cfi: string, range?: unknown): SourceAnchor {
  return { sourceType: "epub", documentId, locator: { cfi, range } };
}
export function pdfSourceAnchor(
  documentId: string,
  page: number,
  locator: { kind: "fixed" | "reflow"; x?: number; y?: number; start?: number; end?: number },
): SourceAnchor {
  return { sourceType: "pdf", documentId, locator: { page, ...locator } };
}

export function htmlSourceAnchor(documentId: string, selector: string, start?: number, end?: number): SourceAnchor {
  return { sourceType: "html", documentId, locator: { selector, start, end } };
}

export function markdownSourceAnchor(documentId: string, heading: string, start?: number, end?: number): SourceAnchor {
  return { sourceType: "markdown", documentId, locator: { heading, start, end } };
}

export function transcriptSourceAnchor(mediaId: string, segmentId: string, startMs?: number, endMs?: number): SourceAnchor {
  return { sourceType: "transcript", mediaId, locator: { segmentId, startMs, endMs } };
}

export function audioSourceAnchor(mediaId: string, startMs: number, endMs?: number): SourceAnchor {
  return { sourceType: "audio", mediaId, locator: { startMs, endMs } };
}

export function videoSourceAnchor(mediaId: string, startMs: number, endMs?: number): SourceAnchor {
  return { sourceType: "video", mediaId, locator: { startMs, endMs } };
}
