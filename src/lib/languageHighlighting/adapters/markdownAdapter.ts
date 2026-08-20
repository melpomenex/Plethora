import { DomLanguageHighlightAdapter, domTextAnchor } from "./domAdapter";
import type { DomAdapterRoot } from "./types";

export class MarkdownLanguageHighlightAdapter extends DomLanguageHighlightAdapter {
  constructor(root: DomAdapterRoot, sourceId: string) {
    super("markdown", sourceId, root, (node, start, end) => domTextAnchor(sourceId, node, start, end));
  }
}
