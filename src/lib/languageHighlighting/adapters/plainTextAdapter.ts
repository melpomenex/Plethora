import type { LanguageHighlightReaderAdapter } from "./types";
import { anchorConfidence, tokenizeLanguageText } from "./tokenizer";
import type { ReaderTokenAnchor, VisibleRange } from "../types";

export class PlainTextLanguageHighlightAdapter implements LanguageHighlightReaderAdapter {
  readonly surface = "plain-text" as const;
  private readonly anchors: ReaderTokenAnchor[];

  constructor(readonly sourceId: string, readonly text: string) {
    this.anchors = tokenizeLanguageText(text).map((token, index) => ({
      id: `${sourceId}:text:${index}`,
      sourceId,
      surface: token.text,
      range: { start: token.start, end: token.end },
      anchor: {
        kind: "text-range",
        sourceId,
        start: token.start,
        end: token.end,
        confidence: anchorConfidence(1),
        confidenceScore: 1,
      },
    }));
  }

  getTokenAnchors(): readonly ReaderTokenAnchor[] {
    return this.anchors;
  }

  getVisibleRange(): VisibleRange {
    return { start: 0, end: this.text.length };
  }

  dispose(): void {
    // Plain text has no listener or DOM resource to release.
  }
}
