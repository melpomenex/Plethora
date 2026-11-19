/**
 * SumatraPDF-style geometric character layout & selection engine for PDF pages.
 *
 * Instead of relying on Chromium/WebKit's DOM `Selection` over PDF.js's
 * absolutely-positioned `.textLayer` spans (which breaks on OCR PDFs with
 * `/Suspect` marked-content `display: contents` wrappers, font-fallback
 * `scaleX` mismatches, overlapping spans, and synthetic micro-spaces), this
 * module builds an exact per-character geometric index directly from PDF.js's
 * `page.getTextContent()` in PDF user space.
 *
 * All coordinates are in unrotated PDF user space (matching
 * `viewport.convertToPdfPoint` and `viewport.convertToViewportRectangle`).
 */

import type { PdfRect } from "../../types/selection";

export interface PdfTextStyleLike {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
  fontFamily?: string;
}

export interface PdfTextItemLike {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
  dir?: string;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfTextContentLike {
  items: ReadonlyArray<unknown>;
  styles?: Record<string, PdfTextStyleLike | undefined>;
}

export interface PdfCharBox {
  /** Single Unicode character (code point). */
  char: string;
  /** Exact PDF user-space bounding box (x0 <= x1, y0 <= y1). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Visual line index in `layout.lines`. */
  lineIndex: number;
  /** Character index in `layout.chars` (visual reading order). */
  index: number;
  /** Font height in PDF user units. */
  fontHeight: number;
  /** Whether a word space should be emitted after this character on the same line. */
  spaceAfter: boolean;
}

export interface PdfCharLine {
  lineIndex: number;
  /** Inclusive start index in `layout.chars`. */
  startChar: number;
  /** Exclusive end index in `layout.chars`. */
  endChar: number;
  /** Unified line bounding box in PDF user space. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Representative baseline Y in PDF user space. */
  baselineY: number;
  /** Median font height on this line. */
  fontHeight: number;
  /** True when a paragraph break follows this line. */
  paragraphBreakAfter: boolean;
}

export interface PdfPageCharLayout {
  pageNumber: number;
  chars: PdfCharBox[];
  lines: PdfCharLine[];
}

/**
 * A caret boundary between characters on a page: `charIndex` is in
 * `[0 .. layout.chars.length]`. A selection between `anchor` and `focus`
 * covers characters `[min .. max)` (half-open), matching native text editors
 * and SumatraPDF.
 */
export interface PdfCaretPosition {
  pageNumber: number;
  charIndex: number;
}

export interface PdfSelectionPageRects {
  pageNumber: number;
  pdfRects: PdfRect[];
}

export interface PdfResolvedGeometricSelection {
  text: string;
  pages: PdfSelectionPageRects[];
  start: PdfCaretPosition;
  end: PdfCaretPosition;
}

interface RawChar {
  char: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  baselineY: number;
  fontHeight: number;
  rtl: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isTextItem(raw: unknown): raw is PdfTextItemLike {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Partial<PdfTextItemLike>;
  return (
    typeof item.str === "string" &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    typeof item.width === "number" &&
    typeof item.height === "number"
  );
}

/**
 * True for CJK ideographs, kana, hangul, CJK punctuation, and fullwidth forms
 * (including `，`, `；`, `：`, `！`, `？`, `（`, `）` in U+FF00..U+FFEF).
 */
export function isCjkOrFullwidth(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x2e80 && cp <= 0x2fff) || // CJK radicals
    (cp >= 0x3000 && cp <= 0x30ff) || // CJK punctuation, Hiragana, Katakana
    (cp >= 0x3100 && cp <= 0x31ff) || // Bopomofo, Hangul Compat
    (cp >= 0x3200 && cp <= 0x4dbf) || // Enclosed CJK, Extension A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xffef) || // Halfwidth and Fullwidth Forms
    (cp >= 0x20000 && cp <= 0x2fa1f) // CJK Extensions B-F
  );
}

/** Relative visual advance weight for proportional splitting inside multi-char PDF items. */
function charVisualWeight(ch: string): number {
  if (isCjkOrFullwidth(ch)) return 2.0;
  if (ch === " " || ch === "\t") return 0.55;
  if ("ilIjtf1.,:;!|'\"()[]`".includes(ch)) return 0.55;
  if ("mwMW@%".includes(ch)) return 1.4;
  return 1.0;
}

function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build a per-character geometric layout for a single PDF page from PDF.js's
 * `getTextContent()` result.
 */
export function buildPdfPageCharLayout(
  pageNumber: number,
  textContent: PdfTextContentLike,
): PdfPageCharLayout {
  const styles = textContent.styles ?? {};
  const rawChars: RawChar[] = [];

  for (const raw of textContent.items) {
    if (!isTextItem(raw)) continue;
    const { str, transform, width, height, fontName, dir } = raw;
    if (!str || str.trim().length === 0) continue;
    if (
      !Number.isFinite(transform[0]) ||
      !Number.isFinite(transform[1]) ||
      !Number.isFinite(transform[2]) ||
      !Number.isFinite(transform[3]) ||
      !Number.isFinite(transform[4]) ||
      !Number.isFinite(transform[5]) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      continue;
    }

    const scaleX = Math.hypot(transform[0], transform[1]);
    const scaleY = Math.hypot(transform[2], transform[3]);
    const fontHeight = scaleY > 1e-3 ? scaleY : (scaleX > 1e-3 ? scaleX : (height > 1e-3 ? height : 10));

    const style = fontName ? styles[fontName] : undefined;
    const ascentRatio = clamp(style?.ascent ?? 0.85, 0.55, 1.15);
    const descentRatio = clamp(Math.abs(style?.descent ?? -0.18), 0.1, 0.45);
    const ascent = fontHeight * ascentRatio;
    const descent = fontHeight * descentRatio;

    const codePoints = Array.from(str);
    const weights = codePoints.map(charVisualWeight);
    const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;

    const advanceLen = width > 1e-3 ? width : fontHeight * 0.5 * totalWeight;
    const advLen = Math.hypot(transform[0], transform[1]);
    const advX = advLen > 1e-9 ? transform[0] / advLen : 1;
    const advY = advLen > 1e-9 ? transform[1] / advLen : 0;
    const upLen = Math.hypot(transform[2], transform[3]);
    const upX = upLen > 1e-9 ? transform[2] / upLen : 0;
    const upY = upLen > 1e-9 ? transform[3] / upLen : 1;

    const ox = transform[4];
    const oy = transform[5];
    const isSimpleHorizontal = Math.abs(advY) < 1e-4 && Math.abs(upX) < 1e-4 && advX > 0 && upY > 0;
    const rtl = (dir ?? "").toLowerCase() === "rtl";

    let cumWeight = 0;
    for (let i = 0; i < codePoints.length; i += 1) {
      const ch = codePoints[i];
      const w = weights[i];
      const startFrac = cumWeight / totalWeight;
      const endFrac = (cumWeight + w) / totalWeight;
      cumWeight += w;

      // Skip whitespace characters; spaces are reconstructed geometrically from
      // inter-character gaps so synthetic 0.1–0.9pt OCR spaces never pollute
      // selection or hit-testing.
      if (ch.trim().length === 0) continue;

      let x0: number;
      let y0: number;
      let x1: number;
      let y1: number;

      if (isSimpleHorizontal) {
        x0 = ox + startFrac * advanceLen;
        x1 = ox + endFrac * advanceLen;
        y0 = oy - descent;
        y1 = oy + ascent;
      } else {
        const ax = ox + advX * startFrac * advanceLen;
        const ay = oy + advY * startFrac * advanceLen;
        const bx = ox + advX * endFrac * advanceLen;
        const by = oy + advY * endFrac * advanceLen;
        const c1x = ax - upX * descent;
        const c1y = ay - upY * descent;
        const c2x = ax + upX * ascent;
        const c2y = ay + upY * ascent;
        const c3x = bx - upX * descent;
        const c3y = by - upY * descent;
        const c4x = bx + upX * ascent;
        const c4y = by + upY * ascent;
        x0 = Math.min(c1x, c2x, c3x, c4x);
        x1 = Math.max(c1x, c2x, c3x, c4x);
        y0 = Math.min(c1y, c2y, c3y, c4y);
        y1 = Math.max(c1y, c2y, c3y, c4y);
      }

      if (x1 - x0 <= 1e-4 || y1 - y0 <= 1e-4) continue;

      rawChars.push({
        char: ch,
        x0,
        y0,
        x1,
        y1,
        baselineY: oy,
        fontHeight,
        rtl,
      });
    }
  }

  if (rawChars.length === 0) {
    return { pageNumber, chars: [], lines: [] };
  }

  // Group characters into visual lines by baseline proximity (tolerant of OCR
  // vertical jitter like 308.7..309.2 on the same line).
  const sortedByY = [...rawChars].sort((a, b) => b.baselineY - a.baselineY || a.x0 - b.x0);
  const rawLines: Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }> = [];

  for (const ch of sortedByY) {
    let matched: { baselineY: number; fontHeight: number; chars: RawChar[] } | null = null;
    let bestDist = Infinity;
    for (let i = rawLines.length - 1; i >= Math.max(0, rawLines.length - 6); i -= 1) {
      const candidate = rawLines[i];
      const tol = Math.max(candidate.fontHeight, ch.fontHeight) * 0.45;
      const dist = Math.abs(ch.baselineY - candidate.baselineY);
      if (dist <= tol && dist < bestDist) {
        bestDist = dist;
        matched = candidate;
      }
    }
    if (matched) {
      matched.chars.push(ch);
      // Running mean keeps baseline anchored even if first char was slightly jittered.
      const n = matched.chars.length;
      matched.baselineY = matched.baselineY + (ch.baselineY - matched.baselineY) / n;
      matched.fontHeight = Math.max(matched.fontHeight, ch.fontHeight);
    } else {
      rawLines.push({
        baselineY: ch.baselineY,
        fontHeight: ch.fontHeight,
        chars: [ch],
      });
    }
  }

  // Sort characters within each line and deduplicate faux-bold overlapping glyphs.
  const cleanedLines = rawLines.map((line) => {
    const rtlCount = line.chars.reduce((acc, c) => acc + (c.rtl ? 1 : 0), 0);
    const isRtlLine = rtlCount > line.chars.length / 2;
    line.chars.sort((a, b) => (isRtlLine ? b.x0 - a.x0 : a.x0 - b.x0));

    const deduped: RawChar[] = [];
    for (const ch of line.chars) {
      const prev = deduped[deduped.length - 1];
      if (
        prev &&
        prev.char === ch.char &&
        Math.abs(prev.x0 - ch.x0) < ch.fontHeight * 0.15 &&
        Math.abs(prev.baselineY - ch.baselineY) < ch.fontHeight * 0.15
      ) {
        continue;
      }
      deduped.push(ch);
    }
    return {
      baselineY: line.baselineY,
      fontHeight: median(deduped.map((c) => c.fontHeight), line.fontHeight),
      chars: deduped,
    };
  });

  // Detect 2-column layouts: if a consistent vertical gutter separates segments
  // on >= 40% of lines, split those lines at the gutter and order left column
  // top-to-bottom before right column top-to-bottom.
  const orderedSegments = orderColumnSegments(cleanedLines);

  // Compute median line step for paragraph break detection.
  const lineSteps: number[] = [];
  for (let i = 1; i < orderedSegments.length; i += 1) {
    const step = orderedSegments[i - 1].baselineY - orderedSegments[i].baselineY;
    if (step > 0 && step < orderedSegments[i].fontHeight * 4) {
      lineSteps.push(step);
    }
  }
  const medianLineStep = median(lineSteps, 14);

  const chars: PdfCharBox[] = [];
  const lines: PdfCharLine[] = [];

  for (let lineIdx = 0; lineIdx < orderedSegments.length; lineIdx += 1) {
    const seg = orderedSegments[lineIdx];
    if (seg.chars.length === 0) continue;

    const startChar = chars.length;
    const lineY0 = Math.min(...seg.chars.map((c) => c.y0));
    const lineY1 = Math.max(...seg.chars.map((c) => c.y1));
    const lineX0 = Math.min(...seg.chars.map((c) => c.x0));
    const lineX1 = Math.max(...seg.chars.map((c) => c.x1));

    for (let i = 0; i < seg.chars.length; i += 1) {
      const curr = seg.chars[i];
      const next = seg.chars[i + 1];
      let spaceAfter = false;
      if (next) {
        const gap = next.x0 - curr.x1;
        const fh = Math.max(curr.fontHeight, next.fontHeight, 1);
        const currCjk = isCjkOrFullwidth(curr.char);
        const nextCjk = isCjkOrFullwidth(next.char);
        if (currCjk && nextCjk) {
          // CJK characters never have word spaces unless there is an explicit wide gap.
          spaceAfter = gap > fh * 0.55;
        } else if (currCjk || nextCjk) {
          // Mixed CJK + ASCII/digits (e.g. "从1791年"): only add space for a clear gap.
          spaceAfter = gap > fh * 0.28;
        } else {
          // Standard Latin/numeric word spacing.
          spaceAfter = gap > fh * 0.16;
        }
      }

      chars.push({
        char: curr.char,
        x0: curr.x0,
        y0: curr.y0,
        x1: curr.x1,
        y1: curr.y1,
        lineIndex: lines.length,
        index: chars.length,
        fontHeight: curr.fontHeight,
        spaceAfter,
      });
    }

    const nextSeg = orderedSegments[lineIdx + 1];
    let paragraphBreakAfter = false;
    if (nextSeg) {
      const step = seg.baselineY - nextSeg.baselineY;
      // Positive large vertical gap or column wrap (nextSeg is higher on page).
      if (step < 0 || step > medianLineStep * 1.45) {
        paragraphBreakAfter = true;
      }
    }

    lines.push({
      lineIndex: lines.length,
      startChar,
      endChar: chars.length,
      x0: lineX0,
      y0: lineY0,
      x1: lineX1,
      y1: lineY1,
      baselineY: seg.baselineY,
      fontHeight: seg.fontHeight,
      paragraphBreakAfter,
    });
  }

  return { pageNumber, chars, lines };
}

/**
 * Split multi-column lines when a consistent vertical gutter exists across
 * multiple lines on the page, preserving top-to-bottom reading order per column.
 */
function orderColumnSegments(
  lines: Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }>,
): Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }> {
  if (lines.length < 4) {
    return [...lines].sort((a, b) => b.baselineY - a.baselineY);
  }

  const medianFh = median(lines.map((l) => l.fontHeight), 10);
  const gutterThreshold = Math.max(medianFh * 2.5, 18);

  // Find candidate gutter X midpoints on lines that have a wide horizontal gap.
  const gutterMids: number[] = [];
  for (const line of lines) {
    let bestGap = 0;
    let bestMid = 0;
    for (let i = 0; i < line.chars.length - 1; i += 1) {
      const gap = line.chars[i + 1].x0 - line.chars[i].x1;
      if (gap > bestGap) {
        bestGap = gap;
        bestMid = (line.chars[i].x1 + line.chars[i + 1].x0) / 2;
      }
    }
    if (bestGap >= gutterThreshold) {
      gutterMids.push(bestMid);
    }
  }

  if (gutterMids.length < Math.max(3, Math.floor(lines.length * 0.35))) {
    return [...lines].sort((a, b) => b.baselineY - a.baselineY);
  }

  const gutterX = median(gutterMids, 0);
  // Verify how many lines cleanly split around gutterX without characters crossing it.
  let cleanSplits = 0;
  for (const line of lines) {
    const hasLeft = line.chars.some((c) => c.x1 <= gutterX + medianFh * 0.25);
    const hasRight = line.chars.some((c) => c.x0 >= gutterX - medianFh * 0.25);
    const crosses = line.chars.some((c) => c.x0 < gutterX - medianFh * 0.25 && c.x1 > gutterX + medianFh * 0.25);
    if (hasLeft && hasRight && !crosses) {
      cleanSplits += 1;
    }
  }

  if (cleanSplits < Math.max(3, Math.floor(lines.length * 0.35))) {
    return [...lines].sort((a, b) => b.baselineY - a.baselineY);
  }

  // Partition into full-width header/footer lines, left column, and right column.
  const leftCol: Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }> = [];
  const rightCol: Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }> = [];
  const fullWidthTop: Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }> = [];
  const fullWidthBottom: Array<{ baselineY: number; fontHeight: number; chars: RawChar[] }> = [];

  const splitYs: number[] = [];
  for (const line of lines) {
    const crosses = line.chars.some((c) => c.x0 < gutterX - medianFh * 0.25 && c.x1 > gutterX + medianFh * 0.25);
    if (!crosses) {
      const leftChars = line.chars.filter((c) => (c.x0 + c.x1) / 2 < gutterX);
      const rightChars = line.chars.filter((c) => (c.x0 + c.x1) / 2 >= gutterX);
      if (leftChars.length > 0 && rightChars.length > 0) {
        splitYs.push(line.baselineY);
      }
    }
  }
  const topSplitY = Math.max(...splitYs);
  const bottomSplitY = Math.min(...splitYs);

  for (const line of lines) {
    const crosses = line.chars.some((c) => c.x0 < gutterX - medianFh * 0.25 && c.x1 > gutterX + medianFh * 0.25);
    if (crosses) {
      if (line.baselineY >= topSplitY) fullWidthTop.push(line);
      else if (line.baselineY <= bottomSplitY) fullWidthBottom.push(line);
      else leftCol.push(line);
      continue;
    }
    const leftChars = line.chars.filter((c) => (c.x0 + c.x1) / 2 < gutterX);
    const rightChars = line.chars.filter((c) => (c.x0 + c.x1) / 2 >= gutterX);
    if (leftChars.length > 0) {
      leftCol.push({ baselineY: line.baselineY, fontHeight: line.fontHeight, chars: leftChars });
    }
    if (rightChars.length > 0) {
      rightCol.push({ baselineY: line.baselineY, fontHeight: line.fontHeight, chars: rightChars });
    }
  }

  fullWidthTop.sort((a, b) => b.baselineY - a.baselineY);
  leftCol.sort((a, b) => b.baselineY - a.baselineY);
  rightCol.sort((a, b) => b.baselineY - a.baselineY);
  fullWidthBottom.sort((a, b) => b.baselineY - a.baselineY);

  return [...fullWidthTop, ...leftCol, ...rightCol, ...fullWidthBottom];
}

/**
 * Hit-test a PDF-space point `(pdfX, pdfY)` against a page's character layout,
 * returning the nearest caret boundary `[0 .. layout.chars.length]`.
 */
export function hitTestPdfChar(
  layout: PdfPageCharLayout,
  pdfX: number,
  pdfY: number,
): PdfCaretPosition | null {
  if (layout.lines.length === 0 || layout.chars.length === 0) return null;

  // Step 1: find the best matching visual line.
  // First prefer lines whose vertical band contains pdfY (choosing the closest
  // horizontally if multiple column lines share the same Y band).
  let bestLine: PdfCharLine | null = null;
  let bestScore = Infinity;

  for (const line of layout.lines) {
    const padY = line.fontHeight * 0.35;
    const dy =
      pdfY < line.y0 - padY
        ? line.y0 - padY - pdfY
        : pdfY > line.y1 + padY
          ? pdfY - (line.y1 + padY)
          : 0;
    const dx =
      pdfX < line.x0
        ? line.x0 - pdfX
        : pdfX > line.x1
          ? pdfX - line.x1
          : 0;
    // Vertical proximity dominates; horizontal distance breaks ties (columns).
    const score = dy * 100 + dx;
    if (score < bestScore) {
      bestScore = score;
      bestLine = line;
    }
  }

  if (!bestLine) return null;

  // Step 2: find the caret boundary within the matched line.
  const firstChar = layout.chars[bestLine.startChar];
  const lastChar = layout.chars[bestLine.endChar - 1];

  if (pdfX <= firstChar.x0) {
    return { pageNumber: layout.pageNumber, charIndex: bestLine.startChar };
  }
  if (pdfX >= lastChar.x1) {
    return { pageNumber: layout.pageNumber, charIndex: bestLine.endChar };
  }

  let closestChar = firstChar;
  let closestDist = Infinity;
  for (let i = bestLine.startChar; i < bestLine.endChar; i += 1) {
    const ch = layout.chars[i];
    if (pdfX >= ch.x0 && pdfX <= ch.x1) {
      const mid = (ch.x0 + ch.x1) / 2;
      return {
        pageNumber: layout.pageNumber,
        charIndex: pdfX < mid ? ch.index : ch.index + 1,
      };
    }
    const center = (ch.x0 + ch.x1) / 2;
    const dist = Math.abs(pdfX - center);
    if (dist < closestDist) {
      closestDist = dist;
      closestChar = ch;
    }
  }

  const mid = (closestChar.x0 + closestChar.x1) / 2;
  return {
    pageNumber: layout.pageNumber,
    charIndex: pdfX < mid ? closestChar.index : closestChar.index + 1,
  };
}

/**
 * Check if a PDF-space point is close enough to any text line on the page to
 * begin a text selection (used to distinguish text clicks from margin clicks).
 */
export function isPointNearPdfText(
  layout: PdfPageCharLayout,
  pdfX: number,
  pdfY: number,
  toleranceMultiplier = 1.5,
): boolean {
  for (const line of layout.lines) {
    const padY = Math.max(line.fontHeight * toleranceMultiplier, 12);
    const padX = Math.max(line.fontHeight * toleranceMultiplier, 18);
    if (
      pdfY >= line.y0 - padY &&
      pdfY <= line.y1 + padY &&
      pdfX >= line.x0 - padX &&
      pdfX <= line.x1 + padX
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the `[start, end)` word range containing `caretIndex` (for double-click).
 * Uses `Intl.Segmenter` when available for CJK/Japanese/Thai word segmentation.
 */
export function wordRangeAtPdfCaret(
  layout: PdfPageCharLayout,
  caretIndex: number,
): { start: number; end: number } | null {
  if (layout.chars.length === 0) return null;
  const charIdx = clamp(
    caretIndex >= layout.chars.length ? layout.chars.length - 1 : caretIndex,
    0,
    layout.chars.length - 1,
  );
  const targetChar = layout.chars[charIdx];
  const line = layout.lines[targetChar.lineIndex];
  if (!line) return null;

  // Build line string and map UTF-16 code unit offsets → layout char indices.
  let lineText = "";
  const offsetToCharIdx: number[] = [];
  const charIdxToOffset = new Map<number, number>();

  for (let i = line.startChar; i < line.endChar; i += 1) {
    const c = layout.chars[i];
    charIdxToOffset.set(i, lineText.length);
    for (let k = 0; k < c.char.length; k += 1) {
      offsetToCharIdx.push(i);
    }
    lineText += c.char;
    if (c.spaceAfter && i < line.endChar - 1) {
      offsetToCharIdx.push(-1);
      lineText += " ";
    }
  }

  const targetOffset = charIdxToOffset.get(charIdx) ?? 0;

  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    try {
      const segmenter = new (Intl as any).Segmenter(undefined, { granularity: "word" });
      for (const seg of segmenter.segment(lineText)) {
        const segStart = seg.index as number;
        const segEnd = segStart + (seg.segment as string).length;
        if (targetOffset >= segStart && targetOffset < segEnd) {
          let start = charIdx;
          let end = charIdx + 1;
          for (let pos = segStart; pos < segEnd; pos += 1) {
            const idx = offsetToCharIdx[pos];
            if (idx !== undefined && idx >= 0) {
              start = Math.min(start, idx);
              end = Math.max(end, idx + 1);
            }
          }
          return { start, end };
        }
      }
    } catch {
      // Fall through to simple word boundary heuristic.
    }
  }

  // Fallback: expand across contiguous word characters without spaces.
  const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch);
  let start = charIdx;
  let end = charIdx + 1;
  if (isWordChar(targetChar.char)) {
    while (start > line.startChar && !layout.chars[start - 1].spaceAfter && isWordChar(layout.chars[start - 1].char)) {
      start -= 1;
    }
    while (end < line.endChar && !layout.chars[end - 1].spaceAfter && isWordChar(layout.chars[end].char)) {
      end += 1;
    }
  }
  return { start, end };
}

/**
 * Compute the `[start, end)` line segment containing `caretIndex`, stopping at
 * wide horizontal gaps (e.g. column gutters or diagrams) so selection never
 * jumps across columns.
 */
export function lineRangeAtPdfCaret(
  layout: PdfPageCharLayout,
  caretIndex: number,
): { start: number; end: number } | null {
  if (layout.chars.length === 0) return null;
  const charIdx = clamp(
    caretIndex >= layout.chars.length ? layout.chars.length - 1 : caretIndex,
    0,
    layout.chars.length - 1,
  );
  const line = layout.lines[layout.chars[charIdx].lineIndex];
  if (!line) return null;

  let start = charIdx;
  while (start > line.startChar) {
    const prev = layout.chars[start - 1];
    const curr = layout.chars[start];
    const gap = curr.x0 - prev.x1;
    const fh = Math.max(curr.fontHeight, prev.fontHeight, line.fontHeight, 1);
    if (gap > fh * 2.5) break;
    start -= 1;
  }

  let end = charIdx + 1;
  while (end < line.endChar) {
    const curr = layout.chars[end - 1];
    const next = layout.chars[end];
    const gap = next.x0 - curr.x1;
    const fh = Math.max(curr.fontHeight, next.fontHeight, line.fontHeight, 1);
    if (gap > fh * 2.5) break;
    end += 1;
  }

  return { start, end };
}

function horizontalOverlapRatio(a: PdfCharLine, b: PdfCharLine): boolean {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const minWidth = Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
  return overlap / minWidth > 0.25;
}

/**
 * Compute the `[start, end)` paragraph range containing `caretIndex` (for
 * triple/quad-click, matching Chromium/EPUB behavior). Respects vertical
 * paragraph breaks, column boundaries, and first-line indentation.
 */
export function paragraphRangeAtPdfCaret(
  layout: PdfPageCharLayout,
  caretIndex: number,
): { start: number; end: number } | null {
  if (layout.chars.length === 0) return null;
  const charIdx = clamp(
    caretIndex >= layout.chars.length ? layout.chars.length - 1 : caretIndex,
    0,
    layout.chars.length - 1,
  );
  const targetLineIdx = layout.chars[charIdx].lineIndex;
  const targetLine = layout.lines[targetLineIdx];
  if (!targetLine) return null;

  // If the line itself has a wide horizontal gap (unsplit 2-column line),
  // fall back to the contiguous horizontal segment so we don't cross columns.
  const seg = lineRangeAtPdfCaret(layout, charIdx);
  if (seg && (seg.start > targetLine.startChar || seg.end < targetLine.endChar)) {
    return seg;
  }

  let firstLineIdx = targetLineIdx;
  while (firstLineIdx > 0) {
    const prev = layout.lines[firstLineIdx - 1];
    const curr = layout.lines[firstLineIdx];
    if (prev.paragraphBreakAfter) break;
    if (!horizontalOverlapRatio(prev, curr)) break;
    const fh = Math.max(curr.fontHeight, prev.fontHeight, 1);
    // First-line indent: current line starts noticeably to the right of prev line.
    if (curr.x0 - prev.x0 > fh * 0.6) break;
    // Font size jump (e.g. heading above body).
    if (Math.abs(curr.fontHeight - prev.fontHeight) > fh * 0.35) break;
    firstLineIdx -= 1;
  }

  let lastLineIdx = targetLineIdx;
  while (lastLineIdx + 1 < layout.lines.length) {
    const curr = layout.lines[lastLineIdx];
    const next = layout.lines[lastLineIdx + 1];
    if (curr.paragraphBreakAfter) break;
    if (!horizontalOverlapRatio(curr, next)) break;
    const fh = Math.max(curr.fontHeight, next.fontHeight, 1);
    if (next.x0 - curr.x0 > fh * 0.6) break;
    if (Math.abs(curr.fontHeight - next.fontHeight) > fh * 0.35) break;
    lastLineIdx += 1;
  }

  return {
    start: layout.lines[firstLineIdx].startChar,
    end: layout.lines[lastLineIdx].endChar,
  };
}

function compareCarets(a: PdfCaretPosition, b: PdfCaretPosition): number {
  if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
  return a.charIndex - b.charIndex;
}

/**
 * Resolve a geometric selection between `anchor` and `focus` across one or more
 * pages into clean SumatraPDF-style per-line PDF rects and accurately formatted text.
 */
export function resolveGeometricSelection(
  layoutsByPage: ReadonlyMap<number, PdfPageCharLayout>,
  anchor: PdfCaretPosition,
  focus: PdfCaretPosition,
): PdfResolvedGeometricSelection | null {
  if (compareCarets(anchor, focus) === 0) return null;

  const [start, end] = compareCarets(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
  const pageResults: PdfSelectionPageRects[] = [];
  const pageTexts: string[] = [];

  for (let pageNum = start.pageNumber; pageNum <= end.pageNumber; pageNum += 1) {
    const layout = layoutsByPage.get(pageNum);
    if (!layout || layout.chars.length === 0) continue;

    const fromIdx = pageNum === start.pageNumber ? clamp(start.charIndex, 0, layout.chars.length) : 0;
    const toIdx = pageNum === end.pageNumber ? clamp(end.charIndex, 0, layout.chars.length) : layout.chars.length;
    if (fromIdx >= toIdx) continue;

    const pdfRects: PdfRect[] = [];
    const lineChunks: Array<{
      lineIndex: number;
      text: string;
      firstChar: string;
      lastChar: string;
      paragraphBreakAfter: boolean;
    }> = [];

    let idx = fromIdx;
    while (idx < toIdx) {
      const lineIdx = layout.chars[idx].lineIndex;
      const line = layout.lines[lineIdx];
      let minX = Infinity;
      let maxX = -Infinity;
      let chunkText = "";
      const firstChar = layout.chars[idx].char;
      let lastChar = firstChar;

      while (idx < toIdx && layout.chars[idx].lineIndex === lineIdx) {
        const ch = layout.chars[idx];
        minX = Math.min(minX, ch.x0);
        maxX = Math.max(maxX, ch.x1);
        chunkText += ch.char;
        lastChar = ch.char;
        const nextIdx = idx + 1;
        if (ch.spaceAfter && nextIdx < toIdx && layout.chars[nextIdx].lineIndex === lineIdx) {
          chunkText += " ";
        }
        idx = nextIdx;
      }

      if (minX < maxX && line) {
        // Unified per-line height (y0..y1) produces crisp, non-overlapping
        // SumatraPDF-style highlight bars.
        pdfRects.push({
          x1: minX,
          y1: line.y0,
          x2: maxX,
          y2: line.y1,
        });
        lineChunks.push({
          lineIndex: lineIdx,
          text: chunkText,
          firstChar,
          lastChar,
          paragraphBreakAfter: line.paragraphBreakAfter,
        });
      }
    }

    if (pdfRects.length === 0) continue;

    // Join lines cleanly with CJK awareness and Latin de-hyphenation.
    let pageText = "";
    for (let i = 0; i < lineChunks.length; i += 1) {
      const chunk = lineChunks[i];
      if (i === 0) {
        pageText += chunk.text;
        continue;
      }
      const prev = lineChunks[i - 1];
      if (prev.paragraphBreakAfter) {
        pageText += `\n${chunk.text}`;
      } else if (
        prev.lastChar === "-" &&
        prev.text.length >= 2 &&
        /[a-zA-Z]/.test(prev.text[prev.text.length - 2]) &&
        /^[a-z]/.test(chunk.firstChar)
      ) {
        // Soft line-break hyphenation in Latin text: strip trailing hyphen.
        pageText = pageText.slice(0, -1) + chunk.text;
      } else if (isCjkOrFullwidth(prev.lastChar) || isCjkOrFullwidth(chunk.firstChar)) {
        // CJK lines wrap without inserting spaces.
        pageText += chunk.text;
      } else {
        pageText += ` ${chunk.text}`;
      }
    }

    pageResults.push({ pageNumber: pageNum, pdfRects });
    pageTexts.push(pageText);
  }

  const text = pageTexts.join("\n").trim();
  if (!text || pageResults.length === 0) return null;

  return {
    text,
    pages: pageResults,
    start,
    end,
  };
}
