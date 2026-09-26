/**
 * Durable selection anchors for text surfaces (html/markdown readers).
 *
 * `buildTextSelectionContext` captures a `WebSelectionAnchor` alongside the
 * flattened character offsets at selection time; `findQuoteRange` later
 * re-resolves the anchor to a DOM Range when the offsets no longer align
 * (re-imported or re-rendered content). Resolution is uniqueness-gated: an
 * ambiguous or absent quote returns null rather than guessing a location.
 */

import type { WebSelectionAnchor } from "../types/selection";

/** Bounded prefix/suffix context kept on each side of the exact quote. */
export const ANCHOR_CONTEXT_CHARS = 64;

/** Max segments in a derived container selector (deep paths buy little). */
const MAX_SELECTOR_SEGMENTS = 8;

export interface SelectionAnchorParts {
  root: HTMLElement;
  range: Range;
  /** Flattened text of `root` before the selection start. */
  textBefore: string;
  /** Flattened text of `root` after the selection end. */
  textAfter: string;
}

/**
 * Build the durable anchor for a selection from the flattened text probes
 * the offset computation already performed — no extra DOM walk.
 */
export function captureSelectionAnchor(parts: SelectionAnchorParts): WebSelectionAnchor | undefined {
  const { root, range, textBefore, textAfter } = parts;
  const exact = range.toString().trim();
  if (!exact) return undefined;

  const anchor: WebSelectionAnchor = {
    textQuote: {
      exact,
      prefix: textBefore.slice(-ANCHOR_CONTEXT_CHARS),
      suffix: textAfter.slice(0, ANCHOR_CONTEXT_CHARS),
    },
  };
  const selector = buildContainerSelector(range.commonAncestorContainer, root);
  if (selector) anchor.selector = selector;
  const sectionHeading = nearestSectionHeading(range.commonAncestorContainer, root);
  if (sectionHeading) anchor.sectionHeading = sectionHeading;
  return anchor;
}

/**
 * A short CSS path from `root` to the selection's container element, using
 * nth-of-type positions among same-tag siblings. Returns undefined when the
 * container is the root itself or has no element ancestry within it.
 *
 * Node-type checks (not `instanceof`) keep this working for nodes that come
 * from a reader iframe's realm.
 */
export function buildContainerSelector(node: Node, root: HTMLElement): string | undefined {
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element || element === root) return undefined;
  const segments: string[] = [];
  while (element && element !== root && segments.length < MAX_SELECTOR_SEGMENTS) {
    const tag = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent) break;
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === element!.tagName);
    const nth = sameTag.indexOf(element) + 1;
    segments.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
    element = parent;
  }
  return segments.length ? segments.join(" > ") : undefined;
}

/** Text of the nearest heading that precedes the selection, if any. */
export function nearestSectionHeading(node: Node, root: HTMLElement): string | undefined {
  const container = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!container || !root.contains(container)) return undefined;
  const headings = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
  let match: HTMLElement | null = null;
  for (const heading of headings) {
    // container follows heading in document order → heading precedes it.
    if (heading.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING) {
      match = heading;
    } else {
      break;
    }
  }
  const text = match?.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

interface FlatIndex {
  /** Whitespace-folded text of the whole root. */
  folded: string;
  /** folded[i] maps back to this raw index into the concatenated node text. */
  foldMap: number[];
  /** Text nodes in document order with their raw start offsets. */
  entries: Array<{ node: Text; start: number; end: number }>;
}

function buildFlatIndex(root: HTMLElement): FlatIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-highlight-wrapper='true']")) return NodeFilter.FILTER_REJECT;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const entries: FlatIndex["entries"] = [];
  let raw = "";
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const text = textNode.textContent ?? "";
    entries.push({ node: textNode, start: raw.length, end: raw.length + text.length });
    raw += text;
    current = walker.nextNode();
  }

  // Fold runs of whitespace to single spaces, tracking raw positions so a
  // folded match can be mapped back onto the original text nodes.
  let folded = "";
  const foldMap: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!;
    if (/\s/.test(ch)) {
      if (folded.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      folded += " ";
      foldMap.push(i);
      pendingSpace = false;
    }
    folded += ch;
    foldMap.push(i);
  }
  return { folded, foldMap, entries };
}

function rawIndexToPosition(index: FlatIndex, raw: number): { node: Text; offset: number } | null {
  for (const entry of index.entries) {
    if (raw >= entry.start && raw <= entry.end) {
      return { node: entry.node, offset: raw - entry.start };
    }
  }
  return null;
}

/**
 * Wrap every text portion of `range` in marks produced by `createMark`
 * (e.g. the viewer's search-highlight marks). Unlike
 * `Range.surroundContents`, this works across element boundaries — a
 * multi-paragraph quote gets one mark per text-node portion. Returns the
 * first mark created, for scrolling, or null when the range covers no text.
 */
export function wrapRangeTextWithMark(
  range: Range,
  createMark: (doc: Document) => HTMLElement,
): HTMLElement | null {
  const walkerRoot =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!walkerRoot) return null;
  const doc = walkerRoot.ownerDocument;
  if (!doc) return null;

  const targets: Array<{ node: Text; start: number; end: number }> = [];
  const walker = doc.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== Node.TEXT_NODE) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || node.textContent.length === 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest("script, style, noscript")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const length = text.textContent?.length ?? 0;
    // The node intersects the range when its endpoints bracket the range.
    const beforeOrInsideStart = range.comparePoint(text, 0) <= 0;
    const afterOrInsideEnd = range.comparePoint(text, length) >= 0;
    if (beforeOrInsideStart && afterOrInsideEnd && length > 0) {
      const start = range.startContainer === text ? range.startOffset : 0;
      const end = range.endContainer === text ? range.endOffset : length;
      if (end > start) targets.push({ node: text, start, end });
    }
    current = walker.nextNode();
  }

  let firstMark: HTMLElement | null = null;
  for (const target of targets) {
    if (!target.node.isConnected) continue;
    const text = target.node.textContent ?? "";
    const before = text.slice(0, target.start);
    const middle = text.slice(target.start, target.end);
    const after = text.slice(target.end);
    const fragment = doc.createDocumentFragment();
    if (before) fragment.appendChild(doc.createTextNode(before));
    const mark = createMark(doc);
    mark.textContent = middle;
    fragment.appendChild(mark);
    if (after) fragment.appendChild(doc.createTextNode(after));
    target.node.replaceWith(fragment);
    if (!firstMark) firstMark = mark;
  }
  return firstMark;
}

/**
 * Resolve a quote anchor back to a DOM Range inside `root`, requiring the
 * match to be unambiguous: occurrences confirmed by prefix/suffix context
 * win; a single bare occurrence is accepted; anything else returns null.
 */
export function findQuoteRange(root: HTMLElement, anchor: WebSelectionAnchor): Range | null {
  const exact = anchor.textQuote.exact.replace(/\s+/g, " ").trim();
  if (!exact) return null;
  const prefix = anchor.textQuote.prefix.replace(/\s+/g, " ").trim();
  const suffix = anchor.textQuote.suffix.replace(/\s+/g, " ").trim();

  const index = buildFlatIndex(root);
  const { folded } = index;

  const bareMatches: number[] = [];
  const confirmedMatches: number[] = [];
  const needle = exact.toLowerCase();
  const haystack = folded.toLowerCase();
  // The anchor's prefix/suffix are trimmed, but a boundary space usually sits
  // between them and the quote in the folded text — pad the context windows
  // and compare against trimmed edges so adjacency is whitespace-tolerant.
  const contextPad = 8;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    bareMatches.push(at);
    const before = prefix
      ? folded.slice(Math.max(0, at - prefix.length - contextPad), at).trimEnd()
      : "";
    const after = suffix
      ? folded.slice(at + exact.length, at + exact.length + suffix.length + contextPad).trimStart()
      : "";
    const contextOk = (!prefix || before.endsWith(prefix)) && (!suffix || after.startsWith(suffix));
    if (contextOk) confirmedMatches.push(at);
    at = haystack.indexOf(needle, at + 1);
  }

  const chosen = confirmedMatches.length === 1 ? confirmedMatches[0]! : bareMatches.length === 1 ? bareMatches[0]! : -1;
  if (chosen === -1) return null;

  const startRaw = index.foldMap[chosen] ?? -1;
  const endFolded = chosen + exact.length - 1;
  const endRaw = (index.foldMap[endFolded] ?? -1) + 1;
  if (startRaw < 0 || endRaw <= startRaw) return null;

  const start = rawIndexToPosition(index, startRaw);
  const end = rawIndexToPosition(index, Math.min(endRaw, index.entries[index.entries.length - 1]?.end ?? endRaw));
  if (!start || !end) return null;

  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}
