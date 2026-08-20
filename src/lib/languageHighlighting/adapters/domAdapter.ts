import type { LanguageHighlightAnchor, ReaderTokenAnchor, ReaderSurface, VisibleRange } from "../types";
import type { DomAdapterRoot, LanguageHighlightReaderAdapter } from "./types";
import { anchorConfidence, tokenizeLanguageText } from "./tokenizer";

function documentFor(root: DomAdapterRoot): Document {
  if (root.nodeType === 9) return root as unknown as Document;
  return root.ownerDocument ?? document;
}

function isExcludedTextNode(node: Text): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (
      parent.matches("script, style, noscript, template, [aria-hidden='true']") ||
      parent.classList.contains("language-vocabulary-token")
    ) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

export type DomAnchorFactory = (
  node: Text,
  startOffset: number,
  endOffset: number,
) => LanguageHighlightAnchor;

/** Shared read-only DOM traversal for HTML, Markdown, and EPUB content documents. */
export class DomLanguageHighlightAdapter implements LanguageHighlightReaderAdapter {
  private anchors: ReaderTokenAnchor[] = [];
  private documentLength = 0;

  constructor(
    readonly surface: ReaderSurface,
    readonly sourceId: string,
    private readonly root: DomAdapterRoot,
    private readonly makeAnchor: DomAnchorFactory,
  ) {
    this.refresh();
  }

  refresh(): void {
    const doc = documentFor(this.root);
    const walker = doc.createTreeWalker(this.root as unknown as Node, 4);
    const anchors: ReaderTokenAnchor[] = [];
    let logicalOffset = 0;
    let tokenIndex = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!(node instanceof Text) || isExcludedTextNode(node)) continue;
      const text = node.textContent ?? "";
      for (const token of tokenizeLanguageText(text)) {
        const range = { start: logicalOffset + token.start, end: logicalOffset + token.end };
        anchors.push({
          id: `${this.sourceId}:dom:${tokenIndex++}`,
          sourceId: this.sourceId,
          surface: token.text,
          range,
          anchor: this.makeAnchor(node, token.start, token.end),
        });
      }
      logicalOffset += text.length;
    }
    this.anchors = anchors;
    this.documentLength = logicalOffset;
  }

  getTokenAnchors(): readonly ReaderTokenAnchor[] {
    return this.anchors;
  }

  getVisibleRange(): VisibleRange {
    // Reader hosts can pass a narrower viewport range to the shared index.
    return { start: 0, end: this.documentLength };
  }

  dispose(): void {
    this.anchors = [];
  }
}

export function domTextAnchor(
  sourceId: string,
  node: Text,
  startOffset: number,
  endOffset: number,
): LanguageHighlightAnchor {
  return {
    kind: "dom-text",
    sourceId,
    node,
    startOffset,
    endOffset,
    confidence: anchorConfidence(1),
    confidenceScore: 1,
  };
}
