import type { AssistSpan } from "../languageReadingAssist/types";

const READING_ASSIST_ATTR = "data-language-reading-assist";

function unwrap(node: Element): void {
  const parent = node.parentNode;
  if (!parent) return;
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
}

export function clearReadingAssistSpans(root: ParentNode): void {
  for (const mark of Array.from(root.querySelectorAll(`[${READING_ASSIST_ATTR}]`))) unwrap(mark);
}

function findTextRange(root: ParentNode, passage: string): Range | null {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument ?? document;
  const normalizedPassage = passage.trim();
  if (!normalizedPassage) return null;
  const walker = ownerDocument.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!(node instanceof Text) || !root.contains(node)) continue;
    const value = node.data;
    const index = value.indexOf(normalizedPassage);
    if (index < 0) continue;
    const range = ownerDocument.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + normalizedPassage.length);
    return range;
  }
  return null;
}

/** Applies gloss annotations as removable ruby-like overlays without mutating source text. */
export function applyReadingAssistSpans(
  root: ParentNode,
  passage: string,
  spans: readonly AssistSpan[],
): number {
  clearReadingAssistSpans(root);
  const baseRange = findTextRange(root, passage);
  if (!baseRange) return 0;
  const ownerDocument = baseRange.startContainer.ownerDocument ?? document;
  let applied = 0;
  const ordered = [...spans].sort((left, right) => right.sourceStart - left.sourceStart);
  for (const span of ordered) {
    try {
      const range = ownerDocument.createRange();
      range.setStart(baseRange.startContainer, baseRange.startOffset + span.sourceStart);
      range.setEnd(baseRange.startContainer, baseRange.startOffset + span.sourceEnd);
      const ruby = ownerDocument.createElement("ruby");
      ruby.setAttribute(READING_ASSIST_ATTR, span.id);
      ruby.className = "language-reading-assist-gloss";
      const rb = ownerDocument.createElement("rb");
      rb.textContent = span.sourceText;
      const rt = ownerDocument.createElement("rt");
      rt.textContent = span.annotation ?? span.renderedText ?? "";
      ruby.append(rb, rt);
      range.deleteContents();
      range.insertNode(ruby);
      applied += 1;
    } catch {
      // Skip ambiguous ranges that cross existing wrappers.
    }
  }
  baseRange.detach();
  return applied;
}

export function readingAssistStyleText(): string {
  return `
    .language-reading-assist-gloss {
      ruby-position: over;
    }
    .language-reading-assist-gloss rt {
      font-size: 0.7em;
      color: var(--muted-foreground, #6b7280);
      user-select: none;
    }
  `;
}
