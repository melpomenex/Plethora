import { foldForMatch } from "./readerSpeechIndex";
import type { TTSChunk } from "./readerSpeechIndex";

const HIGHLIGHT_CLASS = "tts-word-highlight";
const APPROX_HIGHLIGHT_CLASS = "tts-word-highlight tts-word-highlight--approx";
const CHUNK_HIGHLIGHT_CLASS = "tts-chunk-highlight";

function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < Math.min(str.length, 400); i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return h >>> 0;
}

interface HighlightRange {
  node: Node;
  startOffset: number;
  endOffset: number;
}

interface IndexedTextChar {
  node: Text;
  offset: number;
  normalizedIndex: number;
}

interface IndexedText {
  chars: IndexedTextChar[];
  /** Every distinct Text node backing `chars`, for connectivity validation. */
  nodes: Text[];
  normalizedText: string;
  /** Normalized-text start offset of each word, in order. */
  wordNormStarts: number[];
}

export class WordHighlighter {
  private container: HTMLElement | null = null;
  private enabled = false;
  private useChunkLevel = false;
  private styleElement: HTMLStyleElement | null = null;
  private previousRanges: HighlightRange[] = [];
  private cachedIndexedText: IndexedText | null = null;
  private cachedSignature: string | null = null;
  private cachedCharOffset = new Map<string, number>();

  init(container: HTMLElement, useChunkLevel = false): void {
    this.container = container;
    this.useChunkLevel = useChunkLevel;
    this.cachedIndexedText = null;
    this.cachedSignature = null;
    this.cachedCharOffset.clear();
    this.injectStyles();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setUseChunkLevel(chunkLevel: boolean): void {
    this.useChunkLevel = chunkLevel;
  }

  highlightWord(chunkText: string, wordOffset: number): void {
    if (!this.enabled || !this.container || !chunkText) return;
    this.clear();

    if (this.useChunkLevel) {
      this.applyChunkHighlight(chunkText);
      return;
    }

    const words = chunkText.split(/\s+/).filter(Boolean);
    if (wordOffset >= words.length) return;

    const targetWord = words[wordOffset];
    if (!targetWord) return;

    const charOffset = chunkText.indexOf(targetWord, this.getCharOffsetForWord(chunkText, wordOffset));
    if (charOffset < 0) {
      this.applyChunkHighlight(chunkText);
      return;
    }

    const ranges = this.findTextRanges(chunkText, charOffset, charOffset + targetWord.length);
    if (ranges.length === 0) {
      this.applyChunkHighlight(chunkText);
      return;
    }

    this.applyHighlights(ranges, HIGHLIGHT_CLASS);
    this.previousRanges = ranges;
  }

  /**
   * Anchored spoken-word highlighting: resolve the word's position EXACTLY
   * from its speech-index offsets (word ordinal within this container's
   * normalized text) — no document-wide string search, so duplicate text
   * elsewhere can never match. `pdf-word` anchors resolve via `[data-w]`
   * (reflow). Returns false when resolution fails so the caller can keep its
   * chunk-level fallback. Approximate (synthesized) timing renders softer.
   */
  highlightAnchoredWord(chunk: TTSChunk, wordIndex: number, approximate = false): boolean {
    if (!this.enabled || !this.container) return false;
    const word = chunk.words[wordIndex];
    if (!word) return false;
    this.clear();

    if (word.anchor?.kind === "pdf-word") {
      const el = this.container.querySelector(
        `[data-w="${CSS.escape(word.anchor.wordId)}"]`
      );
      if (el) {
        const textNode = this.firstTextNode(el);
        if (textNode) {
          const ranges = [{ node: textNode, startOffset: 0, endOffset: textNode.textContent?.length ?? 0 }];
          this.applyHighlights(ranges, approximate ? APPROX_HIGHLIGHT_CLASS : HIGHLIGHT_CLASS);
          this.previousRanges = ranges;
          return true;
        }
      }
    }

    const indexed = this.getIndexedText();
    // The word's section-normalized offset maps to an exact word ordinal in
    // this container when the instance covers that section.
    const ordinal = this.ordinalForSectionOffset(indexed, word.sectionOffset);
    if (ordinal !== null) {
      const normStart = indexed.wordNormStarts[ordinal];
      const normEnd =
        ordinal + 1 < indexed.wordNormStarts.length
          ? indexed.wordNormStarts[ordinal + 1] - 1
          : indexed.normalizedText.length;
      const target = indexed.normalizedText.slice(normStart, normEnd);
      if (foldForMatch(target) === foldForMatch(word.text)) {
        const ranges = this.rangesForNormalizedSpan(indexed, normStart, normEnd);
        if (ranges.length > 0) {
          this.applyHighlights(ranges, approximate ? APPROX_HIGHLIGHT_CLASS : HIGHLIGHT_CLASS);
          this.previousRanges = ranges;
          return true;
        }
      }
    }

    // Resolution failure → constrained chunk-level fallback (graceful).
    // The container was already cleared at the top of this call, so apply
    // directly — no second clear pass.
    this.applyChunkHighlight(chunk.text);
    return false;
  }

  private firstTextNode(el: Element): Text | null {
    const walker = el.ownerDocument?.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const node = walker?.nextNode() ?? null;
    return (node as Text) ?? null;
  }

  private ordinalForSectionOffset(indexed: IndexedText, sectionOffset: number): number | null {
    const starts = indexed.wordNormStarts;
    if (starts.length === 0) return null;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= sectionOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private rangesForNormalizedSpan(
    indexed: IndexedText,
    normStart: number,
    normEnd: number,
  ): HighlightRange[] {
    const rangesByNode = new Map<Text, { startOffset: number; endOffset: number }>();
    for (const entry of indexed.chars) {
      if (entry.normalizedIndex >= normStart && entry.normalizedIndex < normEnd) {
        const existing = rangesByNode.get(entry.node);
        if (!existing) {
          rangesByNode.set(entry.node, { startOffset: entry.offset, endOffset: entry.offset + 1 });
        } else {
          existing.startOffset = Math.min(existing.startOffset, entry.offset);
          existing.endOffset = Math.max(existing.endOffset, entry.offset + 1);
        }
      }
    }
    return Array.from(rangesByNode.entries()).map(([node, range]) => ({
      node,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
    }));
  }

  highlightChunk(chunkText: string): void {
    if (!this.enabled || !this.container || !chunkText) return;
    this.clear();
    this.applyChunkHighlight(chunkText);
  }

  /** Apply chunk-level ranges; caller must have cleared the container. */
  private applyChunkHighlight(chunkText: string): void {
    const ranges = this.findTextRanges(chunkText, 0, chunkText.length);
    this.applyHighlights(ranges, CHUNK_HIGHLIGHT_CLASS);
    this.previousRanges = ranges;
  }

  clear(): void {
    if (!this.container) return;
    const doc = this.container.ownerDocument || document;
    this.container.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${CHUNK_HIGHLIGHT_CLASS}`).forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(doc.createTextNode(el.textContent || ""), el);
        parent.normalize();
      }
    });
    this.previousRanges = [];
    // Replacing spans with text nodes + normalize() destroys Text-node
    // identity; the cached index must never survive a clear.
    this.cachedIndexedText = null;
    this.cachedSignature = null;
  }

  destroy(): void {
    this.clear();
    this.container = null;
    this.cachedIndexedText = null;
    this.cachedSignature = null;
    this.cachedCharOffset.clear();
    if (this.styleElement?.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
    }
  }

  private getCharOffsetForWord(text: string, wordIndex: number): number {
    const cacheKey = `${hashString(text.slice(0, 200))}:${text.length}:${wordIndex}`;
    const hit = this.cachedCharOffset.get(cacheKey);
    if (hit !== undefined) return hit;
    const words = text.split(/\s+/);
    let offset = 0;
    for (let i = 0; i < wordIndex && i < words.length; i++) {
      const idx = text.indexOf(words[i], offset);
      if (idx >= 0) offset = idx + words[i].length + 1;
    }
    if (this.cachedCharOffset.size > 200) {
      const first = this.cachedCharOffset.keys().next().value;
      if (first) this.cachedCharOffset.delete(first);
    }
    this.cachedCharOffset.set(cacheKey, offset);
    return offset;
  }

  private getContainerSignature(): string {
    if (!this.container) return "";
    return `${this.container.childNodes.length}:${this.container.textContent?.length ?? 0}`;
  }

  private getIndexedText(): IndexedText {
    const signature = this.getContainerSignature();
    const cached = this.cachedIndexedText;
    // A cached index is only reusable when its Text nodes are still connected:
    // external DOM mutations or normalization can orphan them without changing
    // the container signature. Stale/detached entries force a clean rebuild.
    if (cached && this.cachedSignature === signature && cached.nodes.every((n) => n.isConnected)) {
      return cached;
    }
    const doc = this.container?.ownerDocument || document;
    const textNodes: Text[] = [];
    const walker = doc.createTreeWalker(this.container!, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      // Keep whitespace-only nodes: they carry the word boundary between
      // block elements. Skipping them glues adjacent blocks' text together
      // ("charlie"+"second" → "charliesecond") and breaks anchored offset
      // matching against the speech index, which preserves those spaces.
      if (node.textContent && node.textContent.length > 0) {
        textNodes.push(node);
      }
    }
    const indexedText = this.buildIndexedText(textNodes);
    this.cachedIndexedText = indexedText;
    this.cachedSignature = signature;
    return indexedText;
  }

  private findTextRanges(searchText: string, startChar: number, endChar: number): HighlightRange[] {
    if (!this.container) return [];

    const indexedText = this.getIndexedText();
    const normalizedSearchText = this.normalizeForMatch(searchText);
    const normalizedStartChar = this.normalizePrefixForOffset(searchText.slice(0, startChar)).length;
    const normalizedEndChar = this.normalizePrefixForOffset(searchText.slice(0, endChar)).length;
    const searchStart = this.findRelevantOffset(indexedText.normalizedText, normalizedSearchText);
    if (searchStart < 0) return [];

    const targetStart = searchStart + normalizedStartChar;
    const targetEnd = searchStart + Math.min(normalizedEndChar, normalizedSearchText.length);
    const matchingChars = indexedText.chars.filter(
      (entry) => entry.normalizedIndex >= targetStart && entry.normalizedIndex < targetEnd
    );
    if (matchingChars.length === 0) return [];

    const rangesByNode = new Map<Text, { startOffset: number; endOffset: number }>();
    for (const entry of matchingChars) {
      const existing = rangesByNode.get(entry.node);
      if (!existing) {
        rangesByNode.set(entry.node, { startOffset: entry.offset, endOffset: entry.offset + 1 });
      } else {
        existing.startOffset = Math.min(existing.startOffset, entry.offset);
        existing.endOffset = Math.max(existing.endOffset, entry.offset + 1);
      }
    }

    return Array.from(rangesByNode.entries()).map(([node, range]) => ({
      node,
      startOffset: range.startOffset,
      endOffset: range.endOffset,
    }));
  }

  private findRelevantOffset(fullText: string, searchText: string): number {
    const normalizedSearch = this.normalizeForMatch(searchText);
    const idx = fullText.indexOf(normalizedSearch);
    if (idx >= 0) return idx;

    const firstSentence = normalizedSearch.match(/^[^.!?]+[.!?]?/)?.[0]?.trim();
    if (firstSentence && firstSentence.length >= 16) {
      const sentenceIdx = fullText.indexOf(firstSentence);
      if (sentenceIdx >= 0) return sentenceIdx;
    }

    const firstWord = normalizedSearch.split(/\s+/)[0];
    if (!firstWord) return -1;
    return fullText.indexOf(firstWord);
  }

  private normalizeForMatch(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  private normalizePrefixForOffset(value: string): string {
    return value.replace(/\s+/g, " ").replace(/^ /, "");
  }

  private buildIndexedText(textNodes: Text[]): IndexedText {
    const chars: IndexedTextChar[] = [];
    let normalizedText = "";
    let pendingSpace: IndexedTextChar | null = null;
    const wordNormStarts: number[] = [];

    for (const node of textNodes) {
      const value = node.textContent || "";
      for (let offset = 0; offset < value.length; offset++) {
        const char = value[offset];
        if (/\s/.test(char)) {
          pendingSpace = { node, offset, normalizedIndex: normalizedText.length };
          continue;
        }

        if (pendingSpace && normalizedText.length > 0) {
          pendingSpace.normalizedIndex = normalizedText.length;
          chars.push(pendingSpace);
          normalizedText += " ";
          pendingSpace = null;
        }
        if (normalizedText.length === 0 || normalizedText.endsWith(" ")) {
          wordNormStarts.push(normalizedText.length);
        }

        chars.push({ node, offset, normalizedIndex: normalizedText.length });
        normalizedText += char;
        pendingSpace = null;
      }
    }

    return { chars, nodes: textNodes, normalizedText: normalizedText.trim(), wordNormStarts };
  }

  private applyHighlights(ranges: HighlightRange[], className: string): void {
    let mutated = false;
    for (const range of ranges) {
      try {
        const doc = range.node.ownerDocument || this.container?.ownerDocument || document;
        const span = doc.createElement("span");
        span.className = className;
        const textNode = range.node;
        const parent = textNode.parentNode;
        if (!parent) continue;

        const text = textNode.textContent || "";
        const before = text.slice(0, range.startOffset);
        const middle = text.slice(range.startOffset, range.endOffset);
        const after = text.slice(range.endOffset);

        span.textContent = middle;

        const fragment = doc.createDocumentFragment();
        if (before) fragment.appendChild(doc.createTextNode(before));
        fragment.appendChild(span);
        if (after) fragment.appendChild(doc.createTextNode(after));

        parent.replaceChild(fragment, textNode);
        mutated = true;
      } catch (err) {
        console.warn("WordHighlighter: Failed to apply highlight", err);
      }
    }
    if (mutated) {
      // Splitting text nodes invalidates indexed node identity; drop the
      // cache so the next resolution re-indexes the mutated DOM.
      this.cachedIndexedText = null;
      this.cachedSignature = null;
    }
  }

  private injectStyles(): void {
    if (this.styleElement || !this.container) return;
    const doc = this.container.ownerDocument || document;
    this.styleElement = doc.createElement("style");
    // Karaoke vocabulary via theme tokens: primary-tinted emphasis, stronger
    // for measured timing, softer for synthesized (approximate) timing, and a
    // flat high-contrast variant for e-ink. No pulse animation per word — the
    // highlight is never conveyed solely by animation.
    this.styleElement.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: color-mix(in srgb, var(--primary, #3b82f6) 22%, transparent) !important;
        color: var(--primary-foreground, inherit);
        border-radius: 2px !important;
        box-shadow: inset 0 -2px 0 0 color-mix(in srgb, var(--primary, #3b82f6) 55%, transparent);
      }
      .tts-word-highlight--approx {
        background-color: color-mix(in srgb, var(--primary, #3b82f6) 12%, transparent) !important;
        box-shadow: inset 0 -1px 0 0 color-mix(in srgb, var(--primary, #3b82f6) 30%, transparent);
      }
      .${CHUNK_HIGHLIGHT_CLASS} {
        background-color: color-mix(in srgb, var(--primary, #3b82f6) 8%, transparent) !important;
        border-radius: 2px !important;
        box-shadow: none;
      }
      :root[data-display-mode="eink"] .${HIGHLIGHT_CLASS},
      :root[data-display-mode="eink"] .tts-word-highlight--approx {
        background-color: rgba(0, 0, 0, 0.18) !important;
        box-shadow: none !important;
        color: inherit !important;
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-display-mode="eink"]) .${HIGHLIGHT_CLASS} {
          background-color: color-mix(in srgb, var(--primary, #60a5fa) 30%, transparent) !important;
        }
      }
    `;
    doc.head?.appendChild(this.styleElement);
  }
}
