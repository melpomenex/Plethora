import { languageHighlightCssVariables } from "./cssTokens";
import { canAnnotateAnchor } from "./annotations";
import type { LanguageHighlightAnchor, LanguageHighlightSettings, VocabularyAnnotation } from "./types";

const LANGUAGE_MARK_ATTR = "data-language-vocabulary-token";

function domCoordinates(anchor: LanguageHighlightAnchor): { node: Text; startOffset: number; endOffset: number } | null {
  if (anchor.kind === "dom-text" || anchor.kind === "epub-text") {
    return { node: anchor.node, startOffset: anchor.startOffset, endOffset: anchor.endOffset };
  }
  if (anchor.kind === "pdf-canonical-word" && anchor.node && anchor.startOffset !== undefined && anchor.endOffset !== undefined) {
    return { node: anchor.node, startOffset: anchor.startOffset, endOffset: anchor.endOffset };
  }
  return null;
}

function unwrap(node: Element): void {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

export function clearLanguageAnnotationSpans(root: ParentNode): void {
  for (const mark of Array.from(root.querySelectorAll(`[${LANGUAGE_MARK_ATTR}]`))) unwrap(mark);
}

/**
 * Applies vocabulary state as a DOM wrapper around existing text nodes. The
 * source text is never replaced and all wrappers are removable by attribute.
 * Annotations with ambiguous/non-DOM anchors are intentionally ignored.
 */
export function applyLanguageAnnotationSpans(
  root: ParentNode,
  annotations: readonly VocabularyAnnotation[],
  settings: LanguageHighlightSettings,
): number {
  clearLanguageAnnotationSpans(root);
  if (settings.mode === "off") return 0;
  let applied = 0;
  const ordered = [...annotations]
    .filter((annotation) => canAnnotateAnchor(annotation.anchor))
    .filter((annotation) =>
      annotation.anchor.kind === "dom-text" ||
      annotation.anchor.kind === "epub-text" ||
      Boolean(domCoordinates(annotation.anchor)),
    )
    .sort((left, right) => {
      const leftStart = domCoordinates(left.anchor)?.startOffset ?? 0;
      const rightStart = domCoordinates(right.anchor)?.startOffset ?? 0;
      return rightStart - leftStart;
    });

  for (const annotation of ordered) {
    const coordinates = domCoordinates(annotation.anchor);
    if (!coordinates) continue;
    const { node, startOffset, endOffset } = coordinates;
    if (!node.isConnected || !root.contains(node)) continue;
    if (startOffset >= endOffset || startOffset < 0 || endOffset > node.data.length) continue;
    const doc = node.ownerDocument;
    const mark = doc.createElement("span");
    mark.setAttribute(LANGUAGE_MARK_ATTR, annotation.tokenId);
    mark.setAttribute("data-language-layer", "vocabulary");
    mark.setAttribute("data-language-state", annotation.dataAttributes.state);
    mark.setAttribute("data-language-entry-id", annotation.dataAttributes.lexicalEntryId);
    if (annotation.ariaLabel) mark.setAttribute("aria-label", annotation.ariaLabel);
    mark.className = `${annotation.className} language-annotation-layer-vocabulary`;
    const variables = languageHighlightCssVariables(
      annotation.dataAttributes.state,
      settings,
      annotation.treatment,
      annotation.cue,
    );
    for (const [property, value] of Object.entries(variables)) mark.style.setProperty(property, value);
    const range = doc.createRange();
    range.setStart(node, startOffset);
    range.setEnd(node, endOffset);
    try {
      range.surroundContents(mark);
      applied += 1;
    } catch {
      // A range crossing an existing reader/search wrapper is ambiguous; do
      // not rewrite DOM or selection just to force an annotation.
    } finally {
      range.detach();
    }
  }
  return applied;
}

export function languageAnnotationStyleText(): string {
  return `
    .language-annotation-layer-vocabulary {
      color: var(--language-vocabulary-ink);
      background: var(--language-vocabulary-background);
      text-decoration-line: underline;
      text-decoration-color: var(--language-vocabulary-decoration);
      text-decoration-style: var(--language-vocabulary-pattern);
      text-decoration-thickness: 0.12em;
      text-underline-offset: 0.16em;
    }
    [data-language-layer="selection"] .language-annotation-layer-vocabulary,
    .language-annotation-layer-selection .language-annotation-layer-vocabulary { text-decoration-thickness: 0.2em; }
    @media (prefers-reduced-motion: reduce) {
      .language-annotation-layer-vocabulary { transition: none !important; animation: none !important; }
    }
  `;
}
