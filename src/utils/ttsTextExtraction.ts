/**
 * TTS Text Extraction Utilities
 *
 * Provides text extraction helpers for different document types (PDF, EPUB, Markdown)
 * to support text-to-speech functionality across all document viewers.
 */

import {
  normalizeSectionText,
  packWordStream,
  type PackUnit,
  type SourceAnchor,
  type SpeechSectionInput,
} from "./readerSpeechIndex";

/**
 * Configuration for text extraction
 */
export interface TextExtractionOptions {
  /** Maximum characters per chunk (for streaming) */
  maxChunkSize?: number;
  /** Whether to preserve paragraph breaks */
  preserveParagraphs?: boolean;
  /** Whether to include page numbers in output */
  includePageNumbers?: boolean;
}

/**
 * Result of text extraction
 */
export interface ExtractedText {
  /** Full extracted text */
  text: string;
  /** Text chunks for streaming (if maxChunkSize specified) */
  chunks?: string[];
  /** Character count */
  charCount: number;
  /** Estimated word count */
  wordCount: number;
  /** Estimated reading time in seconds */
  readingTimeSec: number;
}

/**
 * Clean and normalize text for TTS
 */
export function cleanTextForTTS(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*_]{3,}\s*$/gm, "")
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Chunk text for streaming TTS.
 *
 * Thin wrapper over the shared word-stream packer (`packWordStream`) with the
 * same observable semantics as the previous dedicated implementation: sentences
 * via `/[^.!?]+[.!?]+/g`, packing against a single limit, hard-wrapping
 * over-long sentences at word boundaries (slicing words longer than the limit),
 * and carrying a hard-wrap's trailing fragment into the next chunk.
 */
export function chunkTextForTTS(
  text: string,
  maxChunkSize: number = 500
): string[] {
  const limit = Math.max(1, Math.floor(maxChunkSize));
  const sentences = (text.match(/[^.!?]+[.!?]+/g) || [text])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [];

  // Work in the joined trimmed-sentence space so packer lengths match the
  // legacy joined-string lengths exactly.
  const working = sentences.join(" ");
  const units: PackUnit[] = [];
  const wordRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(working)) !== null) {
    units.push({ start: m.index, end: wordRe.lastIndex });
  }

  const sentenceBounds: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const sentence of sentences) {
    const start = working.indexOf(sentence, cursor);
    const end = start + sentence.length;
    let lo = 0;
    let hi = units.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (units[mid].end <= start) lo = mid + 1;
      else hi = mid;
    }
    let last = lo;
    while (last < units.length && units[last].start < end) last++;
    if (last > lo) sentenceBounds.push({ start: lo, end: last });
    cursor = end;
  }

  const groups = packWordStream(units, sentenceBounds, {
    targetSize: limit,
    hardSize: limit,
    targetSeparatorCost: 0,
    sliceLongWords: true,
    hardWrapAfterPush: true,
    carryHardWrapTrailingFragment: true,
  });

  return groups
    .map((g) => working.slice(g.start, g.end))
    .filter((chunk) => chunk.length > 0);
}

/**
 * Extract text from PDF.js page content
 */
export function extractTextFromPDFContent(items: unknown[]): string {
  const textItems = items
    .map((item: unknown) => {
      if (typeof item === "object" && item !== null && "str" in item) {
        return (item as { str: string }).str;
      }
      return "";
    })
    .filter((str) => str.length > 0);

  return textItems.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Extract text from EPUB.js section
 */
export function extractTextFromEPUBSection(doc: Document): string {
  // Clone the document to avoid modifying the original
  const clone = doc.cloneNode(true) as Document;

  clone.querySelectorAll("script, style, nav, header, footer").forEach((el) => el.remove());

  return clone.body?.textContent?.replace(/\s+/g, " ").trim() || "";
}

/**
 * Process extracted text with options
 */
export function processExtractedText(
  text: string,
  options: TextExtractionOptions = {}
): ExtractedText {
  const {
    maxChunkSize,
    preserveParagraphs = true,
  } = options;

  let processedText = text;

  if (!preserveParagraphs) {
    processedText = processedText.replace(/\n+/g, " ");
  }

  processedText = cleanTextForTTS(processedText);

  const charCount = processedText.length;
  const wordCount = processedText.split(/\s+/).filter((w) => w.length > 0).length;
  const readingTimeSec = Math.ceil((wordCount / 200) * 60); // 200 words per minute

  const result: ExtractedText = {
    text: processedText,
    charCount,
    wordCount,
    readingTimeSec,
  };

  if (maxChunkSize && charCount > maxChunkSize) {
    result.chunks = chunkTextForTTS(processedText, maxChunkSize);
  }

  return result;
}

/**
 * Calculate reading progress
 */
export function calculateReadingProgress(
  currentPosition: number,
  totalLength: number
): number {
  if (totalLength <= 0) return 0;
  return Math.min(100, Math.round((currentPosition / totalLength) * 100));
}

/**
 * Find the nearest sentence boundary
 */
export function findSentenceBoundary(
  text: string,
  position: number,
  direction: "forward" | "backward" = "forward"
): number {
  const sentenceEndRegex = /[.!?]\s+/g;

  if (direction === "forward") {
    let match;
    while ((match = sentenceEndRegex.exec(text)) !== null) {
      if (match.index > position) {
        return match.index + match[0].length;
      }
    }
    return text.length;
  } else {
    let lastBoundary = 0;
    let match;
    while ((match = sentenceEndRegex.exec(text)) !== null) {
      if (match.index < position) {
        lastBoundary = match.index + match[0].length;
      } else {
        break;
      }
    }
    return lastBoundary;
  }
}

/**
 * Format reading time for display
 */
export function formatReadingTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export interface TextPositionIndexEntry {
  chunkIndex: number;
  wordOffset: number;
}interface ChunkPosition {
  charStart: number;
  charEnd: number;
}

export class TextPositionIndex {
  private chunkPositions: ChunkPosition[] = [];
  private totalChars = 0;
  private pageCharOffsets: Map<number, number> = new Map();
  private docType: "pdf" | "epub" | "scroll" = "scroll";

  constructor(docType?: "pdf" | "epub" | "scroll") {
    if (docType) this.docType = docType;
  }

  build(chunks: string[]): void {
    this.chunkPositions = [];
    let charOffset = 0;
    for (const chunk of chunks) {
      this.chunkPositions.push({ charStart: charOffset, charEnd: charOffset + chunk.length });
      charOffset += chunk.length + 1;
    }
    this.totalChars = Math.max(1, charOffset);
  }

  setPageCharOffsets(offsets: Map<number, number>): void {
    this.pageCharOffsets = offsets;
  }

  getPosition(
    pageNumber: number | null,
    scrollPercent: number | null
  ): TextPositionIndexEntry | null {
    if (this.chunkPositions.length === 0) return null;

    if (this.docType === "pdf" && pageNumber !== null) {
      const pageOffset = this.pageCharOffsets.get(pageNumber);
      if (pageOffset !== undefined) {
        return this.charOffsetToChunkIndex(pageOffset);
      }
    }

    if (scrollPercent !== null) {
      const charTarget = Math.round((scrollPercent / 100) * this.totalChars);
      return this.charOffsetToChunkIndex(charTarget);
    }

    return { chunkIndex: 0, wordOffset: 0 };
  }

  getScrollPercent(chunkIndex: number): number {
    if (chunkIndex >= this.chunkPositions.length) return 100;
    const pos = this.chunkPositions[chunkIndex];
    return (pos.charStart / this.totalChars) * 100;
  }

  private charOffsetToChunkIndex(charOffset: number): TextPositionIndexEntry {
    for (let i = 0; i < this.chunkPositions.length; i++) {
      const pos = this.chunkPositions[i];
      if (charOffset >= pos.charStart && charOffset < pos.charEnd) {
        const wordOffset = Math.max(0, Math.round((charOffset - pos.charStart) / 5));
        return { chunkIndex: i, wordOffset };
      }
    }
    const lastIdx = Math.max(0, this.chunkPositions.length - 1);
    return { chunkIndex: lastIdx, wordOffset: 0 };
  }
}

// ─── DOM-derived speech sections (markdown / HTML / OCR-HTML readers) ───────

/**
 * A speech section extracted from the rendered DOM.
 *
 * `text` is the whitespace-normalized speakable text; `wordTable` maps each
 * normalized word onto its offset in the FULL flattened text of the root
 * (Range.toString-compatible with `buildTextSelectionContext`, i.e. offsets
 * count every text node under the root, including skipped chrome), so
 * selection offsets and speech offsets live in the same coordinate space.
 */
export interface DOMSpeechSection {
  key: string;
  /** Normalized speakable text. */
  text: string;
  /** Word starts: normalized-text span + flattened-text start per word. */
  wordTable: Array<{ normStart: number; normEnd: number; flatStart: number }>;
  /** Total flattened text length under the root (including skipped nodes). */
  flatLength: number;
}

export interface ExtractSpeechSectionsOptions {
  key?: string;
  /** Extra skip predicate for app chrome and surface-specific decoration. */
  shouldSkip?: (el: Element) => boolean;
  /** Check computed display:none (default true). Costs style resolution. */
  checkComputedStyle?: boolean;
}

const SKIP_SELECTOR = "script, style, noscript, nav, header, footer, [aria-hidden='true'], [hidden], [data-tts-skip]";

/**
 * Extract a speech section from a rendered container (or iframe body):
 * TreeWalker over text nodes, skipping `script/style/nav/header/footer`,
 * hidden and `aria-hidden` elements, and app chrome, while flattening offsets
 * compatibly with `buildTextSelectionContext`.
 */
export function extractSpeechSectionsFromDOM(
  root: Element | null | undefined,
  opts: ExtractSpeechSectionsOptions = {},
): DOMSpeechSection[] {
  if (!root) return [];
  const doc = root.ownerDocument || document;
  const checkComputedStyle = opts.checkComputedStyle !== false;

  const hiddenCache = new Map<Element, boolean>();
  const isHidden = (el: Element): boolean => {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    let hidden = false;
    try {
      const win = el.ownerDocument?.defaultView;
      hidden = !!win && win.getComputedStyle(el).display === "none";
    } catch {
      hidden = false;
    }
    hiddenCache.set(el, hidden);
    return hidden;
  };

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent && node.textContent.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });

  // Stream every text node in tree order; skipped nodes still advance the
  // flattened offset (Range.toString compatibility).
  const accepted: Array<{ value: string; flatStart: number; parent: Element | null }> = [];
  let flatOffset = 0;
  let current = walker.nextNode();
  while (current) {
    const value = current.textContent ?? "";
    const parent = current.parentElement;
    let skip = false;
    if (parent) {
      if (parent.closest(SKIP_SELECTOR)) skip = true;
      else if (opts.shouldSkip && opts.shouldSkip(parent)) skip = true;
      else if (checkComputedStyle && isHidden(parent)) skip = true;
    }
    if (!skip) accepted.push({ value, flatStart: flatOffset, parent });
    flatOffset += value.length;
    current = walker.nextNode();
  }

  // Whitespace-collapse the accepted text, recording word spans in both the
  // normalized text and the flattened space. Synthetic separators are inserted
  // when the text crosses a block boundary (adjacent block elements may have
  // no whitespace text node between them); synthetic separators exist only in
  // the normalized text, never in the flattened coordinate space.
  const BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
    "BLOCKQUOTE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE",
    "TABLE", "THEAD", "TBODY", "TR", "FIGURE", "FIGCAPTION", "DL", "DT", "DD", "PRE",
  ]);
  const closestBlock = (el: Element | null): Element | null => {
    let n: Element | null = el;
    while (n && n !== root) {
      if (BLOCK_TAGS.has(n.tagName)) return n;
      n = n.parentElement;
    }
    return root;
  };

  const wordTable: DOMSpeechSection["wordTable"] = [];
  let normalized = "";
  let prevBlock: Element | null = null;
  for (const entry of accepted) {
    const entryBlock = closestBlock(entry.parent);
    if (
      normalized.length > 0 &&
      !normalized.endsWith(" ") &&
      prevBlock !== null &&
      entryBlock !== prevBlock
    ) {
      normalized += " ";
    }
    prevBlock = entryBlock;
    for (let i = 0; i < entry.value.length; i++) {
      const char = entry.value[i];
      const charFlat = entry.flatStart + i;
      if (/\s/.test(char)) {
        if (normalized.length > 0 && !normalized.endsWith(" ")) {
          normalized += " ";
        }
        continue;
      }
      if (normalized.endsWith(" ") || normalized.length === 0) {
        // Word starts at this char.
        wordTable.push({
          normStart: normalized.length,
          normEnd: normalized.length + 1,
          flatStart: charFlat,
        });
      } else {
        const last = wordTable[wordTable.length - 1];
        if (last) last.normEnd = normalized.length + 1;
      }
      normalized += char;
    }
  }
  normalized = normalized.trimEnd();
  for (const w of wordTable) {
    if (w.normStart >= normalized.length) w.normEnd = Math.min(w.normEnd, normalized.length);
  }

  return [
    {
      key: opts.key ?? "dom",
      text: normalized,
      wordTable,
      flatLength: flatOffset,
    },
  ];
}

/**
 * Build a speech-index section input from a `DOMSpeechSection`, mapping
 * normalized speech offsets to/from `{kind:"text"}` anchors in the flattened
 * coordinate space of the extracted root. `base` is the flattened offset of the
 * section's root within the surface (0 for single-container surfaces).
 */
export function buildDOMSectionInput(
  section: DOMSpeechSection,
  surface: string,
  base = 0,
): SpeechSectionInput {
  const { wordTable } = section;
  const findWordByNorm = (normOffset: number): number => {
    let lo = 0;
    let hi = wordTable.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (wordTable[mid].normStart <= normOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const findWordByFlat = (flatOffset: number): number => {
    let lo = 0;
    let hi = wordTable.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (wordTable[mid].flatStart <= flatOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return {
    key: section.key,
    text: section.text,
    anchorAt: (normOffset) => {
      if (wordTable.length === 0) return null;
      const i = findWordByNorm(normOffset);
      const word = wordTable[i];
      const within = Math.max(0, Math.min(normOffset - word.normStart, word.normEnd - word.normStart));
      const anchor: SourceAnchor = {
        kind: "text",
        surface,
        startOffset: base + word.flatStart + within,
      };
      return anchor;
    },
    offsetForAnchor: (anchor) => {
      if (anchor.kind !== "text" || anchor.surface !== surface) return null;
      const rel = anchor.startOffset - base;
      if (rel < 0 || rel > section.flatLength) return null;
      if (wordTable.length === 0) return null;
      const i = findWordByFlat(rel);
      const word = wordTable[i];
      const within = Math.max(0, Math.min(rel - word.flatStart, word.normEnd - word.normStart));
      return word.normStart + within;
    },
  };
}

// ─── Canonical PDF speech page sections ─────────────────────────────────────

export interface PdfSpeechPageLike {
  pageNumber: number;
  text: string;
  words: Array<{ offset: number; wordId: string }>;
}

/**
 * Build a speech-index section for one canonical PDF page: the page's emitted
 * body text plus its offset→wordId table, mapping normalized speech offsets
 * to `pdf-word` anchors (inside table words) and `page` anchors (gaps). Word
 * pairing is positional over the whitespace-normalized text, matching the
 * index's own word stream.
 */
export function buildPdfSpeechPageInput(page: PdfSpeechPageLike): SpeechSectionInput {
  const normalized = normalizeSectionText(page.text);
  const wordStarts: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) wordStarts.push(m.index);

  const table = page.words;
  const findWord = (normOffset: number): number => {
    let lo = 0;
    let hi = wordStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (wordStarts[mid] <= normOffset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  return {
    key: `page:${page.pageNumber}`,
    text: page.text,
    anchorAt: (normOffset) => {
      if (wordStarts.length === 0) return null;
      const i = findWord(normOffset);
      const entry = table[i];
      if (entry) {
        return { kind: "pdf-word", wordId: entry.wordId };
      }
      return { kind: "page", pageNumber: page.pageNumber, pageOffset: normOffset };
    },
    offsetForAnchor: (anchor) => {
      if (anchor.kind === "pdf-word") {
        const idx = table.findIndex((e) => e.wordId === anchor.wordId);
        if (idx < 0) return null;
        const wordIdx = Math.min(idx, wordStarts.length - 1);
        return wordStarts[wordIdx] ?? null;
      }
      if (anchor.kind === "page" && anchor.pageNumber === page.pageNumber) {
        // Resolve to the first word at/after the page offset.
        const target = anchor.pageOffset;
        for (let i = 0; i < wordStarts.length; i++) {
          if (wordStarts[i] >= target) return wordStarts[i];
        }
        return wordStarts[wordStarts.length - 1] ?? null;
      }
      return null;
    },
  };
}
