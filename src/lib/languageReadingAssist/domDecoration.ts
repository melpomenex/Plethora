import type { AssistSpan, ReadingAssistDirection, ReadingAssistKind } from "./types";

const READING_ASSIST_ATTR = "data-language-reading-assist";
const READING_ASSIST_ANNOTATION_ATTR = "data-language-reading-assist-annotation";

export interface ApplyReadingAssistOptions {
  kind?: ReadingAssistKind;
  direction?: ReadingAssistDirection;
}

function unwrap(node: Element): void {
  const parent = node.parentNode;
  if (!parent) return;
  for (const annotation of Array.from(node.querySelectorAll(`rt, [${READING_ASSIST_ANNOTATION_ATTR}]`))) {
    annotation.remove();
  }
  for (const rb of Array.from(node.querySelectorAll("rb"))) {
    while (rb.firstChild) node.insertBefore(rb.firstChild, rb);
    rb.remove();
  }
  while (node.firstChild) parent.insertBefore(node.firstChild, node);
  parent.removeChild(node);
  if (typeof parent.normalize === "function") parent.normalize();
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

function filterValidNonOverlappingSpans(
  spans: readonly AssistSpan[],
  passage: string,
): AssistSpan[] {
  const valid = spans.filter(
    (span) =>
      Number.isInteger(span.sourceStart) &&
      Number.isInteger(span.sourceEnd) &&
      span.sourceStart >= 0 &&
      span.sourceEnd > span.sourceStart &&
      span.sourceEnd <= passage.length,
  );
  const ascending = [...valid].sort((a, b) => a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd);
  const nonOverlapping: AssistSpan[] = [];
  let lastEnd = 0;
  for (const span of ascending) {
    if (span.sourceStart < lastEnd) continue;
    nonOverlapping.push(span);
    lastEnd = span.sourceEnd;
  }
  return nonOverlapping.sort((left, right) => right.sourceStart - left.sourceStart);
}

/** Applies reading-assist annotations as removable overlays without mutating source text. */
export function applyReadingAssistSpans(
  root: ParentNode,
  passage: string,
  spans: readonly AssistSpan[],
  options: ApplyReadingAssistOptions = {},
): number {
  clearReadingAssistSpans(root);
  const baseRange = findTextRange(root, passage);
  if (!baseRange) return 0;
  const ownerDocument = baseRange.startContainer.ownerDocument ?? document;
  const normalizedPassage = passage.trim();
  const ordered = filterValidNonOverlappingSpans(spans, normalizedPassage);
  let applied = 0;

  for (const span of ordered) {
    try {
      const range = ownerDocument.createRange();
      range.setStart(baseRange.startContainer, baseRange.startOffset + span.sourceStart);
      range.setEnd(baseRange.startContainer, baseRange.startOffset + span.sourceEnd);

      const isSegmentation = options.kind === "segmentation";
      const label = span.annotation ?? span.renderedText ?? "";

      if (isSegmentation || !label) {
        const wrapper = ownerDocument.createElement("span");
        wrapper.setAttribute(READING_ASSIST_ATTR, span.id);
        wrapper.className = isSegmentation ? "language-reading-assist-segment" : "language-reading-assist-token";
        if (options.direction === "rtl") wrapper.setAttribute("dir", "rtl");
        if (label) wrapper.setAttribute("title", label);
        wrapper.textContent = span.sourceText;
        range.deleteContents();
        range.insertNode(wrapper);
      } else {
        const ruby = ownerDocument.createElement("ruby");
        ruby.setAttribute(READING_ASSIST_ATTR, span.id);
        ruby.className = options.kind === "bidi" ? "language-reading-assist-gloss language-reading-assist-bidi" : "language-reading-assist-gloss";
        if (options.direction === "rtl" || options.kind === "bidi") {
          ruby.setAttribute("dir", "rtl");
        }
        const rb = ownerDocument.createElement("rb");
        rb.textContent = span.sourceText;
        const rt = ownerDocument.createElement("rt");
        rt.setAttribute(READING_ASSIST_ANNOTATION_ATTR, "true");
        rt.textContent = label;
        ruby.append(rb, rt);
        range.deleteContents();
        range.insertNode(ruby);
      }
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
      color: var(--color-muted-foreground, currentColor);
      user-select: none;
    }
    .language-reading-assist-bidi {
      unicode-bidi: isolate;
    }
    .language-reading-assist-segment {
      display: inline-block;
      margin-inline-end: 0.25em;
      border-inline-end: 1px dotted var(--color-muted-foreground, currentColor);
      padding-inline-end: 0.12em;
    }
  `;
}
