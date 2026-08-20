import type { PdfCanonicalWord } from "../../../types/pdfCanonical";
import type { LanguageHighlightReaderAdapter } from "./types";
import { anchorConfidence } from "./tokenizer";
import type { ReaderTokenAnchor, VisibleRange } from "../types";

export interface PdfReflowLanguageToken {
  id?: string;
  text: string;
  pageNumber: number;
  blockId: string;
  confidence: number;
  /** Optional global source offsets. Missing offsets are assigned in input order. */
  start?: number;
  end?: number;
}

export class PdfReflowLanguageHighlightAdapter implements LanguageHighlightReaderAdapter {
  readonly surface = "pdf-reflow" as const;
  private readonly anchors: ReaderTokenAnchor[];
  private readonly documentLength: number;

  constructor(readonly sourceId: string, tokens: readonly PdfReflowLanguageToken[]) {
    let cursor = 0;
    this.anchors = tokens.map((token, index) => {
      const start = token.start ?? cursor;
      const end = token.end ?? start + token.text.length;
      cursor = end;
      return {
        id: token.id ?? `${sourceId}:reflow:${index}`,
        sourceId,
        surface: token.text,
        range: { start, end },
        anchor: {
          kind: "pdf-reflow-range",
          sourceId,
          pageNumber: token.pageNumber,
          blockId: token.blockId,
          start,
          end,
          confidence: anchorConfidence(token.confidence),
          confidenceScore: token.confidence,
        },
      };
    });
    this.documentLength = cursor;
  }

  getTokenAnchors(): readonly ReaderTokenAnchor[] {
    return this.anchors;
  }

  getVisibleRange(): VisibleRange {
    return { start: 0, end: this.documentLength };
  }

  dispose(): void {
    // Canonical/reflow data is owned by the PDF reader host.
  }
}

export class PdfFixedLanguageHighlightAdapter implements LanguageHighlightReaderAdapter {
  readonly surface = "pdf-fixed" as const;
  private readonly anchors: ReaderTokenAnchor[];
  private readonly documentLength: number;

  constructor(readonly sourceId: string, words: readonly PdfCanonicalWord[]) {
    let cursor = 0;
    this.anchors = words.map((word, index) => {
      const start = cursor;
      const end = start + word.text.length;
      cursor = end;
      return {
        id: `${sourceId}:fixed:${word.id || index}`,
        sourceId,
        surface: word.text,
        range: { start, end },
        anchor: {
          kind: "pdf-canonical-word",
          sourceId,
          pageNumber: word.pageNumber,
          wordId: word.id,
          source: word.source,
          bboxExact: word.bboxExact,
          confidence: anchorConfidence(word.confidence),
          confidenceScore: word.confidence,
        },
      };
    });
    this.documentLength = cursor;
  }

  getTokenAnchors(): readonly ReaderTokenAnchor[] {
    return this.anchors;
  }

  getVisibleRange(): VisibleRange {
    return { start: 0, end: this.documentLength };
  }

  dispose(): void {
    // PDF page/viewport lifecycle remains with the PDF reader host.
  }
}
