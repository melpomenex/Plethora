/**
 * Anchored speech index for document-reader TTS.
 *
 * Preserves the mapping `displayed document text → normalized TTS text → word`
 * while text is normalized for speech. Chunks are built with the same
 * sentence-greedy packing the reader always used (`CHUNK_TARGET`/`CHUNK_MAX`
 * semantics, `<page number="N"/>` marker stripping), but every word carries the
 * source anchor it came from, so start resolution, highlighting, and selection
 * mapping are exact instead of substring-guessed.
 *
 * Coordinate systems (never conflated):
 * - document anchor: `SourceAnchor` (CFI-convertible offsets, word IDs, …)
 * - speech position: `{chunkIndex, wordIndex}` into this index
 * - audio timing: `WordTiming[]` (src/utils/wordTimings.ts)
 * - visual range: DOM Range resolved per anchor kind by the highlighter
 */

/** Chunk sizing defaults, identical to the legacy ReaderTTSControls chunker. */
export const CHUNK_TARGET = 420;
export const CHUNK_MAX = 700;

const PAGE_MARKER_RE = /<page number="(\d+)"\s*\/?>/g;

export type SourceAnchor =
  | { kind: "epub"; spineIndex: number; sectionOffset: number }
  | { kind: "pdf-word"; wordId: string }
  | { kind: "pdf-token"; tokenId: string }
  | { kind: "text"; surface: string; startOffset: number }
  | { kind: "page"; pageNumber: number; pageOffset: number };

export interface SpeechWord {
  text: string;
  anchor: SourceAnchor | null;
  /** Char span of the word within its chunk's `text` (for engine boundary mapping). */
  normStart: number;
  normEnd: number;
  /** Char offset of the word's start within its section's normalized text. */
  sectionOffset: number;
}

export interface SpeechSectionInput {
  /** Stable section identity: spine href, "page:37", document key, … */
  key: string;
  /** Extraction-cleaned text of the section (may contain `<page number/>` markers). */
  text: string;
  /** Word → document anchor (lazy CFI resolution, page tables, text offsets). May be absent. */
  anchorAt?: (offset: number) => SourceAnchor | null;
  /** Anchor → offset in this section's normalized text, for anchors this section owns. */
  offsetForAnchor?: (anchor: SourceAnchor) => number | null;
}

export interface TTSChunk {
  index: number;
  text: string;
  words: SpeechWord[];
  sectionKey: string;
  pageNumbers?: number[];
  /** Sliced leading chunk from a mid-chunk start; not part of the stable index. */
  transient?: boolean;
}

export interface SpeechPosition {
  chunkIndex: number;
  wordIndex: number;
}

interface SectionBuild {
  input: SpeechSectionInput;
  /** Normalized text (markers stripped, whitespace collapsed). */
  text: string;
  /** Offset of this section's text within the concatenated document text. */
  docStart: number;
  /** page number → offset of the page's first char within `text`. */
  pageOffsets: Map<number, number>;
  /** First global word index belonging to this section (filled during packing). */
  firstWordIndex: number;
}

interface WordEntry {
  text: string;
  /** Offset within the concatenated document text. */
  docStart: number;
  docEnd: number;
  sectionIdx: number;
  sectionOffset: number;
  anchor: SourceAnchor | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Strip `<page number="N"/>` markers while tracking each page's offset in the
 * cleaned text (marker replaced by a single space, fragments joined with " ").
 */
function stripPageMarkers(text: string): { text: string; pageOffsets: Map<number, number> } {
  const pageOffsets = new Map<number, number>();
  if (!PAGE_MARKER_RE.test(text)) {
    PAGE_MARKER_RE.lastIndex = 0;
    return { text: normalizeWhitespace(text.replace(/<[^>]+>/g, " ")), pageOffsets };
  }
  PAGE_MARKER_RE.lastIndex = 0;

  let cleaned = "";
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = PAGE_MARKER_RE.exec(text)) !== null) {
    const fragment = normalizeWhitespace(text.slice(lastIdx, match.index).replace(/<[^>]+>/g, " "));
    if (fragment) cleaned += (cleaned ? " " : "") + fragment;
    pageOffsets.set(parseInt(match[1], 10), cleaned.length);
    lastIdx = PAGE_MARKER_RE.lastIndex;
  }
  const remaining = normalizeWhitespace(text.slice(lastIdx).replace(/<[^>]+>/g, " "));
  if (remaining) cleaned += (cleaned ? " " : "") + remaining;
  return { text: cleaned, pageOffsets };
}

/** Whitespace-collapse tag-free text (used when no page markers exist). */
export function normalizeSectionText(text: string): string {
  return stripPageMarkers(text).text;
}

// ─── Shared word-stream packer ──────────────────────────────────────────────
// The single packing primitive both TTS chunkers route through: a flat stream
// of char-range units (words, pre-split when a caller slices long words),
// partitioned into sentences, packed sentence-greedily up to a target size and
// hard-wrapped at a hard size. Options preserve each legacy caller's exact
// semantics (separator accounting and long-sentence handling differ slightly).

export interface PackUnit {
  start: number;
  end: number;
}

export interface WordStreamPackOptions {
  targetSize: number;
  hardSize: number;
  /** Separator chars charged when testing whether a sentence fits the target. */
  targetSeparatorCost: number;
  /** Hard-wrap over-long sentences by slicing words longer than hardSize mid-word. */
  sliceLongWords: boolean;
  /** Hard-wrap a long sentence even when it starts a fresh group after a push. */
  hardWrapAfterPush: boolean;
  /** Keep a hard-wrapped sentence's trailing fragment open for the next sentence. */
  carryHardWrapTrailingFragment: boolean;
}

/**
 * Pack `units` (grouped into sentences by unit-index ranges) into chunk groups
 * expressed as CHAR ranges into the underlying text. Internal bookkeeping is in
 * unit indices; mid-word slices (when `sliceLongWords`) are emitted directly as
 * char ranges.
 */
export function packWordStream(
  units: PackUnit[],
  sentenceBounds: Array<{ start: number; end: number }>,
  opts: WordStreamPackOptions,
): Array<{ start: number; end: number }> {
  const groups: Array<{ start: number; end: number }> = [];
  let currentStart = -1; // unit index (inclusive)
  let currentEnd = -1; // unit index (exclusive)

  const joinedLen = (startUnit: number, endUnit: number) =>
    endUnit > startUnit ? units[endUnit - 1].end - units[startUnit].start : 0;

  const emit = (startUnit: number, endUnit: number) => {
    if (endUnit > startUnit) groups.push({ start: units[startUnit].start, end: units[endUnit - 1].end });
  };

  const pushCurrent = () => {
    if (currentStart >= 0) emit(currentStart, currentEnd);
    currentStart = -1;
    currentEnd = -1;
  };

  for (const sentence of sentenceBounds) {
    const sentenceLen = joinedLen(sentence.start, sentence.end);
    const currentLen = currentStart < 0 ? 0 : joinedLen(currentStart, currentEnd);
    const candidateLen =
      currentStart < 0 ? sentenceLen : currentLen + opts.targetSeparatorCost + sentenceLen;

    if (candidateLen <= opts.targetSize && sentence.end > sentence.start) {
      if (currentStart < 0) currentStart = sentence.start;
      currentEnd = sentence.end;
      continue;
    }
    if (currentStart >= 0) {
      pushCurrent();
      if (!(opts.hardWrapAfterPush && sentenceLen > opts.hardSize)) {
        if (sentence.end > sentence.start) {
          currentStart = sentence.start;
          currentEnd = sentence.end;
        }
        continue;
      }
    }
    if (sentence.end <= sentence.start) continue;
    // Sentence itself is long; hard-wrap by words (optionally slicing
    // over-long words mid-word).
    let fragmentStartUnit = -1;
    for (let u = sentence.start; u < sentence.end; u++) {
      const unit = units[u];
      if (opts.sliceLongWords && unit.end - unit.start > opts.hardSize) {
        if (fragmentStartUnit >= 0) {
          emit(fragmentStartUnit, u);
          fragmentStartUnit = -1;
        }
        let pieceStart = unit.start;
        while (pieceStart < unit.end) {
          const pieceEnd = Math.min(pieceStart + opts.hardSize, unit.end);
          groups.push({ start: pieceStart, end: pieceEnd });
          pieceStart = pieceEnd;
        }
        continue;
      }
      if (fragmentStartUnit < 0) {
        fragmentStartUnit = u;
        continue;
      }
      if (joinedLen(fragmentStartUnit, u + 1) <= opts.hardSize) {
        continue;
      }
      emit(fragmentStartUnit, u);
      fragmentStartUnit = u;
    }
    if (fragmentStartUnit >= 0 && fragmentStartUnit < sentence.end) {
      if (opts.carryHardWrapTrailingFragment) {
        currentStart = fragmentStartUnit;
        currentEnd = sentence.end;
      } else {
        emit(fragmentStartUnit, sentence.end);
      }
    }
  }
  pushCurrent();
  return groups;
}

/**
 * Shared fold-for-match normalization for ALL cross-surface text comparison
 * (chunk ↔ DOM, selection ↔ chunk, highlight fallback): Unicode NFC, curly
 * quotes/apostrophes → ASCII, em/en dashes → hyphen, ligatures expanded,
 * whitespace folded, casefolded. Fixes smart-quote/dash match failures without
 * touching the spoken text itself.
 */
export function foldForMatch(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]|\u0301/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]|\u0303/g, '"')
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .replace(/\u00AD/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export class ReaderSpeechIndex {
  readonly chunks: TTSChunk[] = [];
  readonly totalChars: number;
  private readonly sections: SectionBuild[] = [];
  private readonly words: WordEntry[] = [];
  /** Cumulative doc-text offsets of section starts (parallel to `sections`). */
  private readonly sectionDocStarts: number[] = [];
  /** Cumulative word-index starts per section (parallel to `sections`). */
  private readonly sectionWordStarts: number[] = [];
  /** Doc-text char start of each chunk (parallel to `chunks`). */
  private readonly chunkDocStarts: number[] = [];
  /** Word-count prefix sums per chunk for position resolution. */
  private readonly chunkWordPrefix: number[] = [];
  /** Global page table (legacy PDF `<page number/>` markers), page → sectionIdx. */
  private readonly pageSections = new Map<number, number>();

  constructor(sections: SpeechSectionInput[], maxChunkSize = CHUNK_MAX) {
    const targetSize = Math.min(CHUNK_TARGET, Math.max(1, maxChunkSize));
    const hardSize = Math.max(1, maxChunkSize);

    // 1. Normalize each section, strip markers, concatenate into doc text.
    let docText = "";
    for (const input of sections) {
      const stripped = stripPageMarkers(input.text ?? "");
      const sectionIdx = this.sections.length;
      const build: SectionBuild = {
        input,
        text: stripped.text,
        docStart: docText.length,
        pageOffsets: stripped.pageOffsets,
        firstWordIndex: 0,
      };
      this.sections.push(build);
      this.sectionDocStarts.push(docText.length);
      for (const page of stripped.pageOffsets.keys()) {
        this.pageSections.set(page, sectionIdx);
      }
      if (stripped.text) docText += (docText ? " " : "") + stripped.text;
    }
    this.totalChars = Math.max(1, docText.length);

    // 2. Word stream over the doc text, each word mapped to its section/anchor.
    const wordRe = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(docText)) !== null) {
      const sectionIdx = this.sectionForDocOffset(m.index);
      const section = this.sections[sectionIdx];
      const sectionOffset = m.index - section.docStart;
      let anchor: SourceAnchor | null = null;
      if (section.input.anchorAt) {
        try {
          anchor = section.input.anchorAt(sectionOffset);
        } catch {
          anchor = null;
        }
      }
      if (!anchor && section.pageOffsets.size > 0) {
        // Legacy PDF page-marker sections without an explicit anchorAt.
        anchor = this.pageAnchorForOffset(section, sectionOffset);
      }
      this.words.push({
        text: m[0],
        docStart: m.index,
        docEnd: wordRe.lastIndex,
        sectionIdx,
        sectionOffset,
        anchor,
      });
    }
    this.sectionWordStarts = this.sections.map(() => 0);
    for (let w = 0; w < this.words.length; w++) {
      const section = this.words[w].sectionIdx;
      if (w === 0 || this.words[w - 1].sectionIdx !== section) {
        this.sections[section].firstWordIndex = w;
      }
    }
    this.sections.forEach((s, i) => {
      this.sectionWordStarts[i] = s.firstWordIndex;
    });

    if (this.words.length === 0) return;

    // 3. Sentence-greedy packing via the shared word-stream packer (identical
    //    algorithm to the legacy buildChunks: pack sentences up to targetSize,
    //    hard-wrap over-long sentences by words at hardSize).
    const sentenceUnitBounds: Array<{ start: number; end: number }> = [];
    const sentenceRe = /(?<=[.!?])\s+/g;
    let sentenceStart = 0;
    let sm: RegExpExecArray | null;
    while ((sm = sentenceRe.exec(docText)) !== null) {
      const bound = this.unitRangeForCharRange(sentenceStart, sm.index);
      if (bound) sentenceUnitBounds.push(bound);
      sentenceStart = sentenceRe.lastIndex;
    }
    if (sentenceStart < docText.length) {
      const bound = this.unitRangeForCharRange(sentenceStart, docText.length);
      if (bound) sentenceUnitBounds.push(bound);
    }

    const units: PackUnit[] = this.words.map((w) => ({ start: w.docStart, end: w.docEnd }));
    const chunkRanges = packWordStream(units, sentenceUnitBounds, {
      targetSize,
      hardSize,
      targetSeparatorCost: 1,
      sliceLongWords: false,
      hardWrapAfterPush: false,
      carryHardWrapTrailingFragment: false,
    });

    // 4. Materialize chunks with their word lists and anchors.
    this.chunks = chunkRanges.map((range, index) => {
      const chunkWords = this.wordsInRange(range.start, range.end).map((word) => ({
        text: word.text,
        anchor: word.anchor,
        normStart: word.docStart - range.start,
        normEnd: word.docEnd - range.start,
        sectionOffset: word.sectionOffset,
      }));
      const firstWord = this.wordsInRange(range.start, range.end)[0];
      const sectionIdx = firstWord ? firstWord.sectionIdx : this.sectionForDocOffset(range.start);
      const section = this.sections[sectionIdx];
      const pageNumbers: number[] = [];
      for (const [page, offset] of section.pageOffsets) {
        const abs = section.docStart + offset;
        if (abs >= range.start && abs < range.end) pageNumbers.push(page);
      }
      return {
        index,
        text: docText.slice(range.start, range.end),
        words: chunkWords,
        sectionKey: section.input.key,
        pageNumbers: pageNumbers.length ? pageNumbers : undefined,
      };
    });
    let wordAcc = 0;
    for (const range of chunkRanges) {
      this.chunkDocStarts.push(range.start);
      this.chunkWordPrefix.push(wordAcc);
      wordAcc += this.wordsInRange(range.start, range.end).length;
    }
  }

  /** Index of the section owning doc-text `offset` (binary search over starts). */
  private sectionForDocOffset(offset: number): number {
    let lo = 0;
    let hi = this.sections.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.sectionDocStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Map a char range in the doc text to a unit(word)-index range. */
  private unitRangeForCharRange(start: number, end: number): { start: number; end: number } | null {
    let lo = 0;
    let hi = this.words.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.words[mid].docEnd <= start) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= this.words.length || this.words[lo].docStart >= end) return null;
    let last = lo;
    while (last < this.words.length && this.words[last].docStart < end) last++;
    return { start: lo, end: last };
  }

  private wordsInRange(start: number, end: number): WordEntry[] {
    // Words are in doc order; binary search the first word ending after `start`.
    let lo = 0;
    let hi = this.words.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.words[mid].docEnd <= start) lo = mid + 1;
      else hi = mid;
    }
    const out: WordEntry[] = [];
    for (let i = lo; i < this.words.length && this.words[i].docStart < end; i++) {
      out.push(this.words[i]);
    }
    return out;
  }

  private pageAnchorForOffset(section: SectionBuild, sectionOffset: number): SourceAnchor | null {
    let bestPage: number | null = null;
    let bestOffset = -1;
    for (const [page, offset] of section.pageOffsets) {
      if (offset <= sectionOffset && offset > bestOffset) {
        bestPage = page;
        bestOffset = offset;
      }
    }
    if (bestPage === null) return null;
    return { kind: "page", pageNumber: bestPage, pageOffset: sectionOffset - bestOffset };
  }

  /** Resolve a document anchor to an exact speech position. */
  locate(anchor: SourceAnchor): SpeechPosition | null {
    const resolved = this.locateSectionOffset(anchor);
    if (!resolved) return null;
    const { sectionIdx, sectionOffset } = resolved;
    const wordIdx = this.wordIndexForSectionOffset(sectionIdx, sectionOffset);
    if (wordIdx === null) return null;
    return this.positionForGlobalWord(wordIdx);
  }

  /** Section + section-relative offset for an anchor, or null when unresolvable. */
  private locateSectionOffset(
    anchor: SourceAnchor,
  ): { sectionIdx: number; sectionOffset: number } | null {
    if (anchor.kind === "page") {
      const sectionIdx = this.pageSections.get(anchor.pageNumber);
      if (sectionIdx !== undefined) {
        const markerOffset = this.sections[sectionIdx].pageOffsets.get(anchor.pageNumber);
        if (markerOffset !== undefined) {
          return { sectionIdx, sectionOffset: markerOffset + Math.max(0, anchor.pageOffset) };
        }
      }
      // Canonical per-page sections carry no `<page number/>` markers; their
      // offsetForAnchor accepts page anchors directly.
    }
    // Section-owned anchors (epub/text/pdf-word/pdf-token/page) — the section
    // that recognizes the anchor provides its offset.
    for (let i = 0; i < this.sections.length; i++) {
      const resolver = this.sections[i].input.offsetForAnchor;
      if (!resolver) continue;
      let offset: number | null = null;
      try {
        offset = resolver(anchor);
      } catch {
        offset = null;
      }
      if (offset !== null && offset >= 0 && offset <= this.sections[i].text.length) {
        return { sectionIdx: i, sectionOffset: offset };
      }
    }
    return null;
  }

  /** Binary search: first word at or after `sectionOffset` in the section. */
  private wordIndexForSectionOffset(sectionIdx: number, sectionOffset: number): number | null {
    const start = this.sectionWordStarts[sectionIdx] ?? 0;
    const end =
      sectionIdx + 1 < this.sectionWordStarts.length
        ? this.sectionWordStarts[sectionIdx + 1]
        : this.words.length;
    let lo = start;
    let hi = end;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.words[mid].sectionOffset < sectionOffset) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= end) return end - 1 >= start ? end - 1 : null;
    return lo;
  }

  private positionForGlobalWord(globalWordIndex: number): SpeechPosition | null {
    if (globalWordIndex < 0 || globalWordIndex >= this.words.length) return null;
    // Binary search over chunk word-prefix sums.
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.chunkWordPrefix[mid] <= globalWordIndex) lo = mid;
      else hi = mid - 1;
    }
    const wordIndex = globalWordIndex - this.chunkWordPrefix[lo];
    if (wordIndex < 0 || wordIndex >= this.chunks[lo].words.length) return null;
    return { chunkIndex: lo, wordIndex };
  }

  /**
   * Mid-chunk start primitive: a transient chunk containing exactly
   * `words[wordIndex..]` of chunk `chunkIndex`. The underlying index is
   * untouched, so a later start from the chunk beginning still resolves and
   * caches normally.
   */
  sliceChunkAtWord(chunkIndex: number, wordIndex: number): TTSChunk | null {
    const chunk = this.chunks[chunkIndex];
    if (!chunk || wordIndex < 0 || wordIndex >= chunk.words.length) return null;
    if (wordIndex === 0) return { ...chunk, transient: true };
    const first = chunk.words[wordIndex];
    const text = chunk.text.slice(first.normStart);
    const words = chunk.words.slice(wordIndex).map((w) => ({
      ...w,
      normStart: w.normStart - first.normStart,
      normEnd: w.normEnd - first.normStart,
    }));
    return {
      index: chunk.index,
      text,
      words,
      sectionKey: chunk.sectionKey,
      pageNumbers: chunk.pageNumbers,
      transient: true,
    };
  }

  /** Legacy scroll-sync percent for a chunk (TextPositionIndex-compatible). */
  getScrollPercent(chunkIndex: number): number {
    if (this.chunks.length === 0) return 0;
    if (chunkIndex >= this.chunks.length) return 100;
    return (this.chunkDocStarts[chunkIndex] / this.totalChars) * 100;
  }

  /** Fallback: chunk index for a legacy scroll percentage (binary search). */
  chunkIndexForScrollPercent(percent: number): number {
    if (this.chunks.length === 0) return 0;
    const target = (Math.min(100, Math.max(0, percent)) / 100) * this.totalChars;
    let lo = 0;
    let hi = this.chunks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.chunkDocStarts[mid] <= target) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** All page numbers known from `<page number/>` markers (legacy PDF). */
  get pages(): number[] {
    return Array.from(this.pageSections.keys()).sort((a, b) => a - b);
  }

  /**
   * Sentence look-behind for deliberate-scroll resume: the start of the
   * sentence containing `pos`'s word, so resumed speech has audible context
   * rather than a jarring word-exact jump. When the sentence began in the
   * previous chunk, the start of that chunk's final sentence is returned (at
   * most one chunk of look-behind).
   */
  sentenceStartFor(pos: SpeechPosition): SpeechPosition {
    const chunkIndex = Math.min(Math.max(0, pos.chunkIndex), this.chunks.length - 1);
    const chunk = this.chunks[chunkIndex];
    if (!chunk) return { chunkIndex: 0, wordIndex: 0 };
    const wordIndex = Math.min(pos.wordIndex, Math.max(0, chunk.words.length - 1));
    const targetChar = chunk.words[wordIndex]?.normStart ?? 0;

    const sentenceStartChar = sentenceStartBoundary(chunk.text, targetChar);
    if (sentenceStartChar > 0) {
      const w = chunk.words.findIndex((wd) => wd.normStart >= sentenceStartChar);
      if (w > 0) return { chunkIndex, wordIndex: w };
    }

    // The active word is in the chunk's first sentence. Look back into the
    // previous chunk's final sentence only when that sentence actually
    // continues into this chunk (the previous chunk ends mid-sentence). When
    // the previous chunk ends with sentence punctuation, this chunk begins a
    // fresh sentence — start at its first word.
    if (chunkIndex > 0) {
      const prev = this.chunks[chunkIndex - 1];
      if (prev && prev.words.length > 0 && !SENTENCE_END_RE.test(prev.text.trim())) {
        const lastBoundary = lastSentenceBoundary(prev.text);
        if (lastBoundary >= 0) {
          const w = prev.words.findIndex((wd) => wd.normStart >= lastBoundary);
          return { chunkIndex: chunkIndex - 1, wordIndex: w > 0 ? w : 0 };
        }
        return { chunkIndex: chunkIndex - 1, wordIndex: 0 };
      }
    }
    return { chunkIndex, wordIndex: 0 };
  }

  /** Chunk indices that contain words of `pageNumber` (legacy PDF paging). */
  chunksForPage(pageNumber: number): number[] {
    const sectionIdx = this.pageSections.get(pageNumber);
    if (sectionIdx === undefined) return [];
    return this.chunks
      .filter((c) => c.pageNumbers?.includes(pageNumber))
      .map((c) => c.index);
  }
}

/** Build an anchor-less index over a plain text string (QueueScrollPage-style callers). */
export function buildSpeechIndexFromText(text: string, maxChunkSize = CHUNK_MAX): ReaderSpeechIndex {
  return new ReaderSpeechIndex([{ key: "text", text }], maxChunkSize);
}

// ─── Exact start resolution (D3) ────────────────────────────────────────────

/** A requested TTS start, in priority order of provenance. */
export type TTSStartAnchor =
  | { kind: "epub-cfi"; cfi: string }
  | { kind: "pdf-word"; wordId: string }
  | { kind: "pdf-token"; tokenId: string }
  | { kind: "text-offset"; surface: string; startOffset: number }
  | { kind: "page-offset"; pageNumber: number; pageOffset: number }
  /** An already-resolved source anchor (viewport/TOC resolution output). */
  | { kind: "source"; anchor: SourceAnchor }
  | { kind: "viewport" }
  | { kind: "position"; pageNumber: number | null; scrollPercent: number | null }
  | { kind: "start" };

export interface ResolveStartContext {
  /** EPUB CFI → section anchor (via EpubVimRuntime.rangeFromCfi → offset). */
  cfiToEpubAnchor?: (cfi: string) => SourceAnchor | null;
  /** Live visible-viewport resolution (D6); called only at Play/retarget. */
  resolveViewport?: () => SourceAnchor | null;
}

/**
 * Resolve a start anchor to an exact speech position against the index.
 * Returns null when the anchor cannot be resolved (caller falls to the next
 * priority level); `position`/`start` always resolve.
 */
export function resolveStartAnchor(
  anchor: TTSStartAnchor,
  index: ReaderSpeechIndex,
  ctx: ResolveStartContext = {},
): SpeechPosition | null {
  switch (anchor.kind) {
    case "start":
      return { chunkIndex: 0, wordIndex: 0 };
    case "source":
      return index.locate(anchor.anchor);
    case "viewport":
      return ctx.resolveViewport ? index.locate(ctx.resolveViewport()) : null;
    case "position": {
      if (anchor.pageNumber !== null) {
        const forPage = index.chunksForPage(anchor.pageNumber);
        if (forPage.length > 0) return { chunkIndex: forPage[0], wordIndex: 0 };
      }
      if (anchor.scrollPercent !== null) {
        return { chunkIndex: index.chunkIndexForScrollPercent(anchor.scrollPercent), wordIndex: 0 };
      }
      return { chunkIndex: 0, wordIndex: 0 };
    }
    case "epub-cfi": {
      if (!ctx.cfiToEpubAnchor) return null;
      const source = ctx.cfiToEpubAnchor(anchor.cfi);
      return source ? index.locate(source) : null;
    }
    case "pdf-word":
      return index.locate({ kind: "pdf-word", wordId: anchor.wordId });
    case "pdf-token":
      return index.locate({ kind: "pdf-token", tokenId: anchor.tokenId });
    case "text-offset":
      return index.locate({
        kind: "text",
        surface: anchor.surface,
        startOffset: anchor.startOffset,
      });
    case "page-offset":
      return index.locate({
        kind: "page",
        pageNumber: anchor.pageNumber,
        pageOffset: anchor.pageOffset,
      });
  }
}

/**
 * Map a selection snapshot's context onto a TTS start anchor using each
 * reader's strongest anchor: EPUB CFI range start (never a string search),
 * PDF canonical `startWordId` → `startTokenId` → first page, and exact
 * flattened-text offsets. Returns null for unmappable selections.
 */
export function selectionContextToTTSAnchor(
  ctx: unknown,
  opts: { surface?: string } = {},
): TTSStartAnchor | null {
  if (!ctx || typeof ctx !== "object") return null;
  const c = ctx as Record<string, unknown>;
  if (typeof c.cfiRange === "string" && c.cfiRange) {
    const first = Array.isArray(c.cfiRanges) && typeof c.cfiRanges[0] === "string" ? c.cfiRanges[0] : null;
    return { kind: "epub-cfi", cfi: first ?? c.cfiRange };
  }
  const canonical = c.canonical as { startWordId?: string } | undefined;
  if (canonical?.startWordId) {
    return { kind: "pdf-word", wordId: canonical.startWordId };
  }
  const tokenData = c.tokenData as { startTokenId?: string } | undefined;
  if (tokenData?.startTokenId) {
    return { kind: "pdf-token", tokenId: tokenData.startTokenId };
  }
  if (Array.isArray(c.pages) && c.pages.length > 0) {
    const page = (c.pages[0] as { pageNumber?: number })?.pageNumber;
    if (typeof page === "number") {
      return { kind: "page-offset", pageNumber: page, pageOffset: 0 };
    }
  }
  if (typeof c.startOffset === "number" && typeof c.surface === "string") {
    const surface = opts.surface ?? String(c.surface);
    return { kind: "text-offset", surface, startOffset: c.startOffset };
  }
  return null;
}

/**
 * Convert a resolved source anchor into a start anchor for the imperative
 * start/queue APIs (viewport resolution → startable anchor).
 */
export function sourceAnchorToTTSStartAnchor(anchor: SourceAnchor): TTSStartAnchor {
  switch (anchor.kind) {
    case "epub":
      return { kind: "source", anchor };
    case "pdf-word":
      return { kind: "pdf-word", wordId: anchor.wordId };
    case "pdf-token":
      return { kind: "pdf-token", tokenId: anchor.tokenId };
    case "text":
      return { kind: "text-offset", surface: anchor.surface, startOffset: anchor.startOffset };
    case "page":
      return { kind: "page-offset", pageNumber: anchor.pageNumber, pageOffset: anchor.pageOffset };
  }
}

const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+/g;
const SENTENCE_END_RE = /[.!?]\s*$/;

/** Char offset of the sentence start containing `charOffset` (0 when the sentence began before the text). */
function sentenceStartBoundary(text: string, charOffset: number): number {
  SENTENCE_BOUNDARY_RE.lastIndex = 0;
  let boundary = -1;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_BOUNDARY_RE.exec(text)) !== null) {
    const after = m.index + m[0].length;
    if (after <= charOffset) boundary = after;
    else break;
  }
  return boundary >= 0 ? boundary : 0;
}

/** Char offset of the last sentence boundary in `text`, or -1 when none. */
function lastSentenceBoundary(text: string): number {
  SENTENCE_BOUNDARY_RE.lastIndex = 0;
  let boundary = -1;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_BOUNDARY_RE.exec(text)) !== null) {
    boundary = m.index + m[0].length;
  }
  return boundary;
}
