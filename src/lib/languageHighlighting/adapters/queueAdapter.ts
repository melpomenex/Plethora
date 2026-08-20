import type { LanguageHighlightReaderAdapter } from "./types";
import { anchorConfidence, tokenizeLanguageText } from "./tokenizer";
import type { ReaderTokenAnchor, VisibleRange } from "../types";

export interface QueueLanguageItem {
  id: string;
  text: string;
}

/** Read-only Queue projection; it has no completion, advancement, or review callbacks. */
export class QueueLanguageHighlightAdapter implements LanguageHighlightReaderAdapter {
  readonly surface = "queue" as const;
  private readonly anchors: ReaderTokenAnchor[];
  private readonly documentLength: number;

  constructor(readonly sourceId: string, items: readonly QueueLanguageItem[]) {
    let cursor = 0;
    const anchors: ReaderTokenAnchor[] = [];
    items.forEach((item) => {
      for (const token of tokenizeLanguageText(item.text)) {
        const start = cursor + token.start;
        const end = cursor + token.end;
        anchors.push({
          id: `${sourceId}:queue:${item.id}:${anchors.length}`,
          sourceId,
          surface: token.text,
          range: { start, end },
          anchor: {
            kind: "queue-item",
            sourceId,
            itemId: item.id,
            start,
            end,
            confidence: anchorConfidence(1),
            confidenceScore: 1,
          },
        });
      }
      cursor += item.text.length;
    });
    this.anchors = anchors;
    this.documentLength = cursor;
  }

  getTokenAnchors(): readonly ReaderTokenAnchor[] {
    return this.anchors;
  }

  getVisibleRange(): VisibleRange {
    return { start: 0, end: this.documentLength };
  }

  dispose(): void {
    // Queue lifecycle remains owned by QueueScrollPage/queue stores.
  }
}
