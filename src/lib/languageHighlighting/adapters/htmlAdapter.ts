import { DomLanguageHighlightAdapter, domTextAnchor } from "./domAdapter";
import type { DomAdapterRoot } from "./types";

export class HtmlLanguageHighlightAdapter extends DomLanguageHighlightAdapter {
  constructor(root: DomAdapterRoot, sourceId: string) {
    super("html", sourceId, root, (node, start, end) => domTextAnchor(sourceId, node, start, end));
  }
}
