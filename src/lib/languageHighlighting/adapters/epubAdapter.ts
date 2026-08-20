import { DomLanguageHighlightAdapter } from "./domAdapter";
import type { DomAdapterRoot } from "./types";
import type { LanguageHighlightAnchor } from "../types";
import { anchorConfidence } from "./tokenizer";

export class EpubLanguageHighlightAdapter extends DomLanguageHighlightAdapter {
  constructor(root: DomAdapterRoot, sourceId: string, sectionId = sourceId) {
    super(
      "epub",
      sourceId,
      root,
      (node, start, end): LanguageHighlightAnchor => ({
        kind: "epub-text",
        sourceId,
        sectionId,
        node,
        startOffset: start,
        endOffset: end,
        confidence: anchorConfidence(1),
        confidenceScore: 1,
      }),
    );
  }
}
