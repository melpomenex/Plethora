const HIGHLIGHT_CLASS = "tts-word-highlight";
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
  normalizedText: string;
}

export class WordHighlighter {
  private container: HTMLElement | null = null;
  private enabled = false;
  private useChunkLevel = false;
  private styleElement: HTMLStyleElement | null = null;
  private previousRanges: HighlightRange[] = [];
  private lastTargetScrollTop: number | null = null;
  private lastUserScrollTime = 0;
  private cachedIndexedText: IndexedText | null = null;
  private cachedSignature: string | null = null;
  private cachedScrollableContainer: HTMLElement | null | undefined = undefined;
  private cachedScrollableForContainer: HTMLElement | null = null;
  private cachedCharOffset = new Map<string, number>();

  private userInteractionListener = () => {
    this.lastUserScrollTime = Date.now();
  };

  init(container: HTMLElement, useChunkLevel = false): void {
    this.container = container;
    this.useChunkLevel = useChunkLevel;
    this.cachedIndexedText = null;
    this.cachedSignature = null;
    this.cachedScrollableContainer = undefined;
    this.cachedScrollableForContainer = null;
    this.cachedCharOffset.clear();
    this.injectStyles();
    this.setupInteractionListeners();
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
      this.highlightChunk(chunkText);
      return;
    }

    const words = chunkText.split(/\s+/).filter(Boolean);
    if (wordOffset >= words.length) return;

    const targetWord = words[wordOffset];
    if (!targetWord) return;

    const charOffset = chunkText.indexOf(targetWord, this.getCharOffsetForWord(chunkText, wordOffset));
    if (charOffset < 0) {
      this.highlightChunk(chunkText);
      return;
    }

    const ranges = this.findTextRanges(chunkText, charOffset, charOffset + targetWord.length);
    if (ranges.length === 0) {
      this.highlightChunk(chunkText);
      return;
    }

    this.applyHighlights(ranges, HIGHLIGHT_CLASS);
    this.previousRanges = ranges;
  }

  highlightChunk(chunkText: string): void {
    if (!this.enabled || !this.container || !chunkText) return;
    this.clear();

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
  }

  destroy(): void {
    this.clear();
    this.removeInteractionListeners();
    this.container = null;
    this.cachedIndexedText = null;
    this.cachedSignature = null;
    this.cachedScrollableContainer = undefined;
    this.cachedScrollableForContainer = null;
    this.cachedCharOffset.clear();
    if (this.styleElement?.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
    }
    this.lastTargetScrollTop = null;
  }

  private setupInteractionListeners(): void {
    if (!this.container) return;
    const doc = this.container.ownerDocument || document;
    const win = doc.defaultView || window;

    const events = ["wheel", "touchmove", "pointerdown", "keydown"];
    events.forEach((event) => {
      win.addEventListener(event, this.userInteractionListener, { passive: true });
      doc.addEventListener(event, this.userInteractionListener, { passive: true });
    });
  }

  private removeInteractionListeners(): void {
    if (!this.container) return;
    const doc = this.container.ownerDocument || document;
    const win = doc.defaultView || window;

    const events = ["wheel", "touchmove", "pointerdown", "keydown"];
    events.forEach((event) => {
      win.removeEventListener(event, this.userInteractionListener);
      doc.removeEventListener(event, this.userInteractionListener);
    });
  }

  private findScrollableContainer(el: HTMLElement): HTMLElement | null {
    if (
      this.cachedScrollableForContainer === this.container &&
      this.cachedScrollableContainer !== undefined
    ) {
      return this.cachedScrollableContainer;
    }

    const doc = el.ownerDocument;
    const win = doc?.defaultView || window;

    let current = el.parentElement;
    while (current) {
      const hasAttr =
        current.hasAttribute("data-document-scroll-container") ||
        current.getAttribute("data-epub-viewer") === "true";
      if (hasAttr && current.scrollHeight > current.clientHeight) {
        this.cachedScrollableContainer = current;
        this.cachedScrollableForContainer = this.container;
        return current;
      }
      const style = win.getComputedStyle(current);
      const overflowY = style.overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        this.cachedScrollableContainer = current;
        this.cachedScrollableForContainer = this.container;
        return current;
      }
      current = current.parentElement;
    }

    if (win !== win.parent) {
      try {
        const parentDoc = win.parent.document;
        const iframes = parentDoc.querySelectorAll("iframe");
        let iframeElement: HTMLIFrameElement | null = null;
        for (const iframe of iframes) {
          if (iframe.contentWindow === win) {
            iframeElement = iframe;
            break;
          }
        }
        if (iframeElement) {
          let parentEl = iframeElement.parentElement;
          while (parentEl) {
            const hasAttr =
              parentEl.hasAttribute("data-document-scroll-container") ||
              parentEl.getAttribute("data-epub-viewer") === "true";
            if (hasAttr && parentEl.scrollHeight > parentEl.clientHeight) {
              this.cachedScrollableContainer = parentEl;
              this.cachedScrollableForContainer = this.container;
              return parentEl;
            }
            const style = win.parent.getComputedStyle(parentEl);
            const overflowY = style.overflowY;
            if (
              (overflowY === "auto" || overflowY === "scroll") &&
              parentEl.scrollHeight > parentEl.clientHeight
            ) {
              this.cachedScrollableContainer = parentEl;
              this.cachedScrollableForContainer = this.container;
              return parentEl;
            }
            parentEl = parentEl.parentElement;
          }
        }
      } catch (e) {
        console.warn("WordHighlighter: Failed to access parent document frame", e);
      }
    }

    if (doc) {
      const docScroll = doc.querySelector("[data-document-scroll-container]");
      if (docScroll) {
        this.cachedScrollableContainer = docScroll as HTMLElement;
        this.cachedScrollableForContainer = this.container;
        return docScroll as HTMLElement;
      }
    }
    if (win !== win.parent) {
      try {
        const parentDoc = win.parent.document;
        const docScroll = parentDoc.querySelector("[data-document-scroll-container]");
        if (docScroll) {
          this.cachedScrollableContainer = docScroll as HTMLElement;
          this.cachedScrollableForContainer = this.container;
          return docScroll as HTMLElement;
        }
      } catch {
        // Ignore inaccessible parent frames.
      }
    }

    this.cachedScrollableContainer = null;
    this.cachedScrollableForContainer = this.container;
    return null;
  }

  private getElementTopRelativeToContainer(el: HTMLElement, container: HTMLElement): number {
    let top = el.getBoundingClientRect().top;
    let currentWin: Window | null = el.ownerDocument?.defaultView || null;
    const targetWin = container.ownerDocument?.defaultView || window;

    while (currentWin && currentWin !== targetWin) {
      try {
        const parentDoc = currentWin.parent.document;
        const iframes = parentDoc.querySelectorAll("iframe");
        let foundIframe: HTMLIFrameElement | null = null;
        for (const iframe of iframes) {
          if (iframe.contentWindow === currentWin) {
            foundIframe = iframe;
            break;
          }
        }
        if (foundIframe) {
          top += foundIframe.getBoundingClientRect().top;
        } else {
          break;
        }
      } catch (e) {
        console.warn("WordHighlighter: Error traversing iframe hierarchy", e);
        break;
      }
      currentWin = currentWin.parent;
    }

    top -= container.getBoundingClientRect().top;
    return top;
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

  private findTextRanges(searchText: string, startChar: number, endChar: number): HighlightRange[] {
    if (!this.container) return [];

    const signature = this.getContainerSignature();
    let indexedText: IndexedText;
    if (this.cachedSignature === signature && this.cachedIndexedText) {
      indexedText = this.cachedIndexedText;
    } else {
      const doc = this.container.ownerDocument || document;
      const textNodes: Text[] = [];
      const walker = doc.createTreeWalker(this.container, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && node.textContent.trim()) {
          textNodes.push(node);
        }
      }
      indexedText = this.buildIndexedText(textNodes);
      this.cachedIndexedText = indexedText;
      this.cachedSignature = signature;
    }
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
        }

        chars.push({ node, offset, normalizedIndex: normalizedText.length });
        normalizedText += char;
        pendingSpace = null;
      }
    }

    return { chars, normalizedText: normalizedText.trim() };
  }

  private applyHighlights(ranges: HighlightRange[], className: string): void {
    let scrolled = false;
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

        if (!scrolled) {
          const scrollContainer = this.findScrollableContainer(span);
          if (scrollContainer) {
            const spanRect = span.getBoundingClientRect();
            const containerHeight = scrollContainer.clientHeight || (doc.defaultView || window).innerHeight;
            const spanHeight = spanRect.height || 20;

            const relativeTop = this.getElementTopRelativeToContainer(span, scrollContainer);
            const currentScrollTop = scrollContainer.scrollTop;
            const targetScrollTop = currentScrollTop + relativeTop - containerHeight / 2 + spanHeight / 2;

            const maxScroll = Math.max(0, scrollContainer.scrollHeight - containerHeight);
            const clampedTarget = Math.max(0, Math.min(maxScroll, targetScrollTop));

            const isUserInteracting = Date.now() - this.lastUserScrollTime < 2000;
            const lineChanged = this.lastTargetScrollTop === null || Math.abs(clampedTarget - this.lastTargetScrollTop) > 8;
            const outOfViewport = relativeTop < 40 || relativeTop > containerHeight - 60;

            if (!isUserInteracting && (lineChanged || outOfViewport)) {
              scrollContainer.scrollTo({
                top: clampedTarget,
                behavior: "smooth",
              });
              this.lastTargetScrollTop = clampedTarget;
            }
            scrolled = true;
          } else {
            const isUserInteracting = Date.now() - this.lastUserScrollTime < 2000;
            if (!isUserInteracting) {
              span.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            scrolled = true;
          }
        }
      } catch (err) {
        console.warn("WordHighlighter: Failed to apply highlight or scroll", err);
      }
    }
  }

  private injectStyles(): void {
    if (this.styleElement || !this.container) return;
    const doc = this.container.ownerDocument || document;
    this.styleElement = doc.createElement("style");
    this.styleElement.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: rgba(59, 130, 246, 0.35) !important;
        border-radius: 2px !important;
        transition: background-color 0.1s ease !important;
      }
      .${CHUNK_HIGHLIGHT_CLASS} {
        background-color: rgba(59, 130, 246, 0.15) !important;
        border-radius: 2px !important;
      }
    `;
    doc.head?.appendChild(this.styleElement);
  }
}
