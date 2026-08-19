/**
 * Deterministic first-visible-word resolution (D6).
 *
 * A word qualifies when the intersection of its bounding rect with the reading
 * viewport has height ≥ 50% of the word rect's own height and non-zero width.
 * Fully-clipped text and one-pixel slivers never qualify. Scanning is top-down
 * in document order and stops at the first qualifying word; block ancestors are
 * pre-rejected with a single getBoundingClientRect. Runs only on Play/retarget
 * — never per frame.
 */

export interface ViewportBounds {
  top: number;
  bottom: number;
  left?: number;
  right?: number;
}

export interface VisibleWord {
  node: Text;
  start: number;
  end: number;
  rect: DOMRect;
}

export interface FindFirstVisibleWordOptions {
  /** Viewport rect translator for iframe-nested content (identity default). */
  translateRect?: (rect: DOMRect, node: Text) => DOMRect;
  /** Rect source override (tests). Defaults to a per-word Range rect. */
  getRect?: (range: Range) => DOMRect;
  /** Block-rect source override (tests). Defaults to getBoundingClientRect. */
  getBlockRect?: (el: Element) => DOMRect;
  /** Viewport bounds override (defaults to the node document's window). */
  viewport?: ViewportBounds;
}

const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "SECTION", "ARTICLE", "MAIN", "ASIDE", "TABLE", "TR", "FIGURE",
  "FIGCAPTION", "DL", "DT", "DD", "PRE",
]);

function closestBlock(el: Element | null): Element | null {
  let n: Element | null = el;
  while (n) {
    if (BLOCK_TAGS.has(n.tagName)) return n;
    n = n.parentElement;
  }
  return null;
}

/**
 * Find the first sufficiently-visible word under `root`, in document order.
 * `root` should be the reading content container (or an iframe body); text in
 * nested iframes is not traversed — callers iterate iframe bodies themselves
 * and translate rects via `translateRect`.
 */
export function findFirstVisibleWord(
  root: Element | null | undefined,
  options: FindFirstVisibleWordOptions = {},
): VisibleWord | null {
  if (!root) return null;
  const doc = root.ownerDocument || document;
  const getRect = options.getRect ?? ((range: Range) => range.getBoundingClientRect());
  const translate = options.translateRect ?? ((rect: DOMRect) => rect);
  const viewport: ViewportBounds =
    options.viewport ??
    (() => {
      const win = doc.defaultView;
      const top = win?.scrollY ?? 0;
      const height = win?.innerHeight ?? 0;
      return { top, bottom: top + height };
    })();

  const blockCache = new Map<Element, DOMRect>();
  const getBlockRect = options.getBlockRect ?? ((el: Element) => el.getBoundingClientRect());
  const blockVisible = (blockEl: Element | null): boolean => {
    if (!blockEl) return true;
    const cached = blockCache.get(blockEl);
    if (cached) {
      return cached.bottom > viewport.top && cached.top < viewport.bottom;
    }
    const translated = translate(getBlockRect(blockEl), null as unknown as Text);
    blockCache.set(blockEl, translated);
    return translated.bottom > viewport.top && translated.top < viewport.bottom;
  };

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.textContent && node.textContent.trim().length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT,
  });

  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    current = walker.nextNode();

    // Paragraph pre-reject: one rect per block ancestor, skip whole paragraphs
    // that don't intersect the viewport at all.
    if (!blockVisible(closestBlock(textNode.parentElement))) continue;

    const value = textNode.textContent ?? "";
    const re = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      const range = doc.createRange();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, re.lastIndex);
      let rect: DOMRect;
      try {
        rect = translate(getRect(range), textNode);
      } catch {
        continue;
      }
      if (rect.height <= 0 || rect.width <= 0) continue;

      const intersectionTop = Math.max(rect.top, viewport.top);
      const intersectionBottom = Math.min(rect.bottom, viewport.bottom);
      const intersectionHeight = intersectionBottom - intersectionTop;
      const intersectionLeft = Math.max(rect.left, viewport.left ?? rect.left);
      const intersectionRight = Math.min(rect.right, viewport.right ?? rect.right);
      const intersectionWidth = intersectionRight - intersectionLeft;

      if (intersectionHeight >= rect.height * 0.5 && intersectionWidth > 0) {
        return { node: textNode, start: match.index, end: re.lastIndex, rect };
      }
    }
  }
  return null;
}

/**
 * Flattened-text offset of a visible word within its extraction root (Range-
 * based, matching buildTextSelectionContext's measurement).
 */
export function flatOffsetOfWord(root: Element, word: VisibleWord): number {
  const doc = root.ownerDocument || document;
  const probe = doc.createRange();
  probe.selectNodeContents(root);
  try {
    probe.setEnd(word.node, word.start);
  } catch {
    return 0;
  }
  return probe.toString().length;
}

/**
 * Offset mapper between a root's raw flattened text (Range.toString /
 * textContent semantics, ALL text nodes) and its whitespace-normalized form —
 * used to convert viewport flat offsets into speech-section offsets for
 * textContent-derived sections (EPUB spine items).
 */
export interface TextContentOffsetMapper {
  /** Normalized text of the root (whitespace-collapsed). */
  normalized: string;
  /** Flat → normalized offset (clamped into the nearest word). */
  flatToNorm(flatOffset: number): number;
}

export function buildTextContentOffsetMapper(root: Element): TextContentOffsetMapper {
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const wordStarts: Array<{ normStart: number; flatStart: number }> = [];
  let normalized = "";
  let flat = 0;
  let prevBlock: Element | null = null;
  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const value = textNode.textContent ?? "";
    // Insert a synthetic separator when crossing a block boundary (adjacent
    // block elements may have no whitespace text node between them). The
    // separator lives only in the normalized text, never in the flat space.
    const block = closestBlock(textNode.parentElement);
    if (
      normalized.length > 0 &&
      !normalized.endsWith(" ") &&
      prevBlock !== null &&
      block !== prevBlock
    ) {
      normalized += " ";
    }
    prevBlock = block;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (/\s/.test(char)) {
        if (normalized.length > 0 && !normalized.endsWith(" ")) normalized += " ";
        flat += 1;
        continue;
      }
      if (normalized.length === 0 || normalized.endsWith(" ")) {
        wordStarts.push({ normStart: normalized.length, flatStart: flat });
      }
      normalized += char;
      flat += 1;
    }
    node = walker.nextNode();
  }
  normalized = normalized.trimEnd();

  return {
    normalized,
    flatToNorm(flatOffset: number): number {
      if (wordStarts.length === 0) return 0;
      let lo = 0;
      let hi = wordStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (wordStarts[mid].flatStart <= flatOffset) lo = mid;
        else hi = mid - 1;
      }
      const word = wordStarts[lo];
      return word.normStart;
    },
  };
}
