import type { SavedAnnotationTarget } from "../components/viewer/annotationContextMenu";
import { normalizeHighlightColor } from "./highlightColors";
import { captureSelectionAnchor, findQuoteRange } from "./selectionAnchors";
import type { TextSelectionContext, WebSelectionAnchor } from "../types/selection";

export interface AnchoredTextHighlight {
  id: string;
  annotation?: SavedAnnotationTarget;
  startOffset: number;
  endOffset: number;
  color?: string | null;
  title?: string;
  /** Durable quote anchor; repaints fall back to it when offsets drift. */
  anchor?: TextSelectionContext["anchor"];
}

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
}

export function buildTextSelectionContext(params: {
  root: HTMLElement;
  range: Range;
  documentId: string;
  surface: TextSelectionContext["surface"];
  extractId?: string;
}): TextSelectionContext | null {
  const { root, range, documentId, surface, extractId } = params;
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }

  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  const textBefore = probe.toString();
  const startOffset = textBefore.length;

  const probeEnd = document.createRange();
  probeEnd.selectNodeContents(root);
  probeEnd.setEnd(range.endContainer, range.endOffset);
  const textThrough = probeEnd.toString();
  const endOffset = textThrough.length;

  const selectedText = range.toString().trim();
  if (!selectedText || endOffset <= startOffset) {
    return null;
  }

  const probeAfter = document.createRange();
  probeAfter.selectNodeContents(root);
  probeAfter.setStart(range.endContainer, range.endOffset);
  const textAfter = probeAfter.toString();

  // Durable quote anchor captured from the same probes that produced the
  // offsets — survives content regeneration that invalidates them.
  const anchor = captureSelectionAnchor({ root, range, textBefore, textAfter });

  return {
    type: "text",
    surface,
    documentId,
    extractId,
    startOffset,
    endOffset,
    selectedText,
    ...(anchor ? { anchor } : {}),
  };
}

/**
 * Build a TextSelectionContext from the live selection inside a reader
 * iframe (html document / OCR-HTML view). Returns null when no usable
 * selection exists — callers keep their no-context fallback.
 */
export function buildIframeTextSelectionContext(params: {
  win: Window | null | undefined;
  doc: Document;
  documentId: string;
  surface: TextSelectionContext["surface"];
}): TextSelectionContext | null {
  const selection = params.win?.getSelection?.() ?? null;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text || !params.doc.body) return null;
  try {
    return buildTextSelectionContext({
      root: params.doc.body,
      range: selection.getRangeAt(0),
      documentId: params.documentId,
      surface: params.surface,
    });
  } catch {
    // Cross-document range issues: offsets unavailable, caller falls back.
    return null;
  }
}

function collectTextNodes(root: HTMLElement): TextNodeEntry[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== 3) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-highlight-wrapper='true']")) return NodeFilter.FILTER_REJECT;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const entries: TextNodeEntry[] = [];
  let offset = 0;
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const length = textNode.textContent?.length ?? 0;
    entries.push({ node: textNode, start: offset, end: offset + length });
    offset += length;
    current = walker.nextNode();
  }
  return entries;
}

function paintTextNode(entry: TextNodeEntry, highlights: AnchoredTextHighlight[]) {
  const text = entry.node.textContent ?? "";
  const intersecting = highlights.filter((h) => h.endOffset > entry.start && h.startOffset < entry.end);
  if (!intersecting.length) return;
  const boundaries = [...new Set([0, text.length, ...intersecting.flatMap((h) => [
    Math.max(0, h.startOffset - entry.start), Math.min(text.length, h.endOffset - entry.start),
  ])])].sort((a, b) => a - b);
  const doc = entry.node.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (let i = 1; i < boundaries.length; i++) {
    const start = boundaries[i - 1];
    const end = boundaries[i];
    const active = intersecting.filter((h) => h.startOffset < entry.start + end && h.endOffset > entry.start + start);
    const part = doc.createTextNode(text.slice(start, end));
    if (!active.length) { fragment.appendChild(part); continue; }
    const mark = doc.createElement("mark");
    mark.dataset.highlightWrapper = "true";
    mark.dataset.highlightId = active[0].id;
    mark.dataset.highlightIds = JSON.stringify(active.map((h) => h.id));
    mark.className = "persisted-text-highlight";
    mark.style.backgroundColor = normalizeHighlightColor(active[0].color);
    mark.style.padding = "0";
    mark.style.borderRadius = "0.12rem";
    if (active[0].title) mark.title = active[0].title;
    mark.appendChild(part);
    fragment.appendChild(mark);
  }
  entry.node.replaceWith(fragment);
}

/**
 * Remove all existing highlight marks, unwrapping their text content back
 * into the parent. This modifies the DOM in place without changing the
 * rendered text — no visual flash.
 */
function removeAllHighlightMarks(root: HTMLElement) {
  const marks = root.querySelectorAll("mark[data-highlight-wrapper='true']");
  for (const mark of marks) {
    const text = mark.textContent ?? "";
    const parent = mark.parentNode;
    if (!parent) continue;
    const textNode = root.ownerDocument.createTextNode(text);
    parent.replaceChild(textNode, mark);
    parent.normalize(); // merge adjacent text nodes
  }
}

const foldSpace = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Verify each anchored highlight's offsets still reproduce its captured text
 * and repair the ones that do not via quote resolution. Runs on a text-node
 * snapshot before any painting mutates the DOM.
 */
function resolveAnchoredHighlightOffsets(
  root: HTMLElement,
  highlights: Array<AnchoredTextHighlight & { anchor: WebSelectionAnchor }>,
): AnchoredTextHighlight[] {
  const entries = collectTextNodes(root);
  const flat = entries.map((e) => e.node.textContent ?? "").join("");
  const resolved: AnchoredTextHighlight[] = [];

  for (const highlight of highlights) {
    const expected = foldSpace(highlight.anchor.textQuote.exact);
    const current =
      highlight.endOffset <= flat.length && highlight.endOffset > highlight.startOffset
        ? foldSpace(flat.slice(highlight.startOffset, highlight.endOffset))
        : "";
    if (current === expected) {
      resolved.push(highlight);
      continue;
    }
    const range = findQuoteRange(root, highlight.anchor);
    if (!range) continue; // unresolved: skip rather than guess a location
    const startEntry = entries.find((e) => e.node === range.startContainer);
    const endEntry = entries.find((e) => e.node === range.endContainer);
    if (!startEntry || !endEntry) continue;
    const start = startEntry.start + range.startOffset;
    const end = endEntry.start + range.endOffset;
    if (end <= start) continue;
    resolved.push({ ...highlight, startOffset: start, endOffset: end });
  }
  return resolved;
}

export function applyAnchoredTextHighlights(params: {
  root: HTMLElement | null;
  highlights: AnchoredTextHighlight[];
  signature: string;
}) {
  const { root, highlights, signature } = params;
  if (!root) return;

  if (root.dataset.highlightSignature !== signature) {
    // Document content changed — need full reset
    root.dataset.highlightSignature = signature;
    root.dataset.highlightOriginalHtml = root.innerHTML;
    // When content changes, existing marks are invalid (offsets shifted)
    removeAllHighlightMarks(root);
  }

  const stateKey = JSON.stringify(highlights);
  const marks = root.querySelectorAll("mark[data-highlight-wrapper='true']");
  if (root.dataset.highlightState === stateKey && (marks.length > 0 || highlights.length === 0)) return;
  removeAllHighlightMarks(root);
  root.dataset.highlightState = stateKey;

  // Resolve against pristine text, then split every node at all boundaries.
  // Shared segments retain all IDs, so removing one overlapping record can
  // repaint the surviving record without losing ownership or shifting offsets.
  const anchored = highlights.filter(
    (h): h is AnchoredTextHighlight & { anchor: WebSelectionAnchor } => Boolean(h.anchor),
  );
  const resolved = [
    ...highlights.filter((h) => !h.anchor),
    ...resolveAnchoredHighlightOffsets(root, anchored),
  ].filter((h) => h.endOffset > h.startOffset);
  for (const entry of collectTextNodes(root)) paintTextNode(entry, resolved);
}
