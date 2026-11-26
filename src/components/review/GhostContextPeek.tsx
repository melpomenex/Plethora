import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CaretDown, CaretUp, PushPin, Scissors, X } from "@phosphor-icons/react";
import type { SelectionContext } from "../../types/selection";

export interface SurroundingParagraphsResult {
  breadcrumb: string[];
  before: string[];
  matchedParagraphs: string[];
  after: string[];
  highlightText: string;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  matched: boolean;
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(raw: string): string {
  return stripTags(raw)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/^>\s*/gm, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseHeading(block: string): { level: number; text: string } | null {
  const mdMatch = block.trim().match(/^(#{1,6})\s+(.+)$/);
  if (mdMatch) {
    return { level: mdMatch[1].length, text: stripTags(mdMatch[2]) };
  }
  const htmlMatch = block.trim().match(/^<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  if (htmlMatch) {
    return { level: Number(htmlMatch[1]), text: stripTags(htmlMatch[2]) };
  }
  return null;
}

function splitLongBlockIntoReadableChunks(block: string, maxChars = 650, targetChars = 420): string[] {
  if (block.length <= maxChars) return [block];
  const sentences = block.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g);
  if (!sentences || sentences.length <= 1) return [block];

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (current && current.length + 1 + trimmed.length > targetChars) {
      chunks.push(current);
      current = trimmed;
    } else {
      current = current ? `${current} ${trimmed}` : trimmed;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [block];
}

function splitParentBlocks(parentContent: string): string[] {
  // Preserve HTML headings as markdown-style headings before splitting block tags,
  // otherwise splitting on </hN> strips the closing tag and breaks parseHeading.
  const prepared = parentContent
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => {
      const text = stripTags(inner);
      return text ? `\n\n${"#".repeat(Number(lvl))} ${text}\n\n` : "\n\n";
    })
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n\n")
    .replace(/<\/?(?:p|div|li|blockquote|section|article|tr|pre|figcaption)\b[^>]*>/gi, "\n\n");

  const initialBlocks = prepared
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const lineSplit =
    initialBlocks.length <= 1 && prepared.includes("\n")
      ? prepared
          .split(/\n+/)
          .map((b) => b.trim())
          .filter(Boolean)
      : initialBlocks.flatMap((b) =>
          b.length > 500 && b.includes("\n")
            ? b
                .split(/\n+/)
                .map((line) => line.trim())
                .filter(Boolean)
            : [b]
        );

  return lineSplit.flatMap((b) =>
    parseHeading(b) ? [b] : splitLongBlockIntoReadableChunks(b)
  );
}

function getOriginalTextFromSelection(selectionContext?: SelectionContext | null): string | null {
  if (!selectionContext) return null;
  if (selectionContext.type === "text") {
    return selectionContext.anchor?.textQuote?.exact || selectionContext.selectedText || null;
  }
  if (selectionContext.type === "epub") {
    return selectionContext.selectedText || null;
  }
  if (selectionContext.type === "pdf") {
    return selectionContext.canonical?.text || null;
  }
  if (selectionContext.type === "session_transcript") {
    return selectionContext.selectedText || null;
  }
  return null;
}

function buildSearchNeedles(text: string): string[] {
  const needles: string[] = [];
  const lines = text
    .split(/\n+/)
    .map((line) => normalizeForMatch(line))
    .filter((line) => line.length >= 6);

  for (const line of lines) {
    if (line.length <= 64) {
      needles.push(line);
    } else {
      needles.push(line.slice(0, 64).trim());
      const midStart = Math.max(0, Math.floor(line.length / 2) - 24);
      needles.push(line.slice(midStart, midStart + 48).trim());
      needles.push(line.slice(-48).trim());
    }
  }

  const whole = normalizeForMatch(text);
  if (whole && !needles.includes(whole)) {
    needles.push(whole.slice(0, 64).trim());
  }

  return Array.from(new Set(needles.filter((n) => n.length >= 6)));
}

function findBestOverlapIndex(
  paragraphs: Array<{ norm: string }>,
  candidateText: string
): number {
  const words = Array.from(
    new Set(
      normalizeForMatch(candidateText)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4)
    )
  );
  if (words.length < 3) return -1;

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const pWords = new Set(
      paragraphs[i].norm.split(/[^a-z0-9]+/).filter((w) => w.length >= 4)
    );
    if (pWords.size === 0) continue;
    let hits = 0;
    for (const w of words) {
      if (pWords.has(w)) hits++;
    }
    const overlap = hits / Math.min(words.length, pWords.size);
    if (hits >= 3 && overlap >= 0.3 && overlap > bestScore) {
      bestScore = overlap;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function fallbackFromSelectionAnchor(
  selectionContext?: SelectionContext | null,
  extractText = ""
): SurroundingParagraphsResult | null {
  if (!selectionContext || selectionContext.type !== "text") return null;
  const anchor = selectionContext.anchor;
  if (!anchor?.textQuote) return null;
  const prefix = stripTags(anchor.textQuote.prefix || "");
  const suffix = stripTags(anchor.textQuote.suffix || "");
  if (!prefix && !suffix) return null;
  const exact = stripTags(anchor.textQuote.exact || extractText || "");
  return {
    breadcrumb: anchor.sectionHeading ? [anchor.sectionHeading] : [],
    before: prefix ? [prefix] : [],
    matchedParagraphs: exact ? [exact] : [],
    after: suffix ? [suffix] : [],
    highlightText: exact,
    hasMoreBefore: false,
    hasMoreAfter: false,
    matched: true,
  };
}

/**
 * Extract up to `radius` preceding and succeeding paragraphs plus the matched
 * paragraph(s) and heading breadcrumb stack leading up to `extractText`.
 */
export function extractSurroundingParagraphs(
  parentContent: string,
  extractText: string,
  radius: number | { before: number; after: number } = 2,
  selectionContext?: SelectionContext | null
): SurroundingParagraphsResult {
  const beforeRadius = typeof radius === "number" ? radius : radius.before;
  const afterRadius = typeof radius === "number" ? radius : radius.after;

  if (!parentContent || !parentContent.trim()) {
    return (
      fallbackFromSelectionAnchor(selectionContext, extractText) ?? {
        breadcrumb: [],
        before: [],
        matchedParagraphs: [],
        after: [],
        highlightText: extractText,
        hasMoreBefore: false,
        hasMoreAfter: false,
        matched: false,
      }
    );
  }

  const rawBlocks = splitParentBlocks(parentContent);
  const paragraphs: Array<{ text: string; norm: string; breadcrumb: string[] }> = [];
  const headingStack: Array<{ level: number; text: string }> = [];

  for (const block of rawBlocks) {
    const heading = parseHeading(block);
    if (heading && heading.text) {
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= heading.level
      ) {
        headingStack.pop();
      }
      headingStack.push(heading);
      continue;
    }

    const clean = stripTags(block);
    if (clean) {
      paragraphs.push({
        text: clean,
        norm: normalizeForMatch(block),
        breadcrumb: headingStack.map((h) => h.text),
      });
    }
  }

  const candidates = [
    extractText,
    getOriginalTextFromSelection(selectionContext) ?? "",
  ].filter((c) => c && c.trim().length > 0);

  let startIdx = -1;
  let endIdx = -1;

  for (const candidate of candidates) {
    const needles = buildSearchNeedles(candidate);
    for (const needle of needles) {
      const idx = paragraphs.findIndex(
        (p) =>
          p.norm.includes(needle) ||
          (p.norm.length >= 16 && needle.includes(p.norm))
      );
      if (idx !== -1) {
        startIdx = idx;
        break;
      }
    }
    if (startIdx !== -1) {
      // If the extract spans multiple paragraphs, advance endIdx to its last matched paragraph
      const lastLine = candidate
        .split(/\n+/)
        .map((l) => normalizeForMatch(l))
        .filter((l) => l.length >= 12)
        .pop();
      endIdx = startIdx;
      if (lastLine) {
        const tailNeedle = lastLine.slice(0, 64).trim();
        for (let i = startIdx + 1; i < Math.min(paragraphs.length, startIdx + 10); i++) {
          if (
            paragraphs[i].norm.includes(tailNeedle) ||
            (paragraphs[i].norm.length >= 16 && tailNeedle.includes(paragraphs[i].norm))
          ) {
            endIdx = i;
            break;
          }
        }
      }
      break;
    }
  }

  if (startIdx === -1) {
    for (const candidate of candidates) {
      const idx = findBestOverlapIndex(paragraphs, candidate);
      if (idx !== -1) {
        startIdx = idx;
        endIdx = idx;
        break;
      }
    }
  }

  if (startIdx === -1) {
    return (
      fallbackFromSelectionAnchor(selectionContext, extractText) ?? {
        breadcrumb: headingStack.map((h) => h.text),
        before: [],
        matchedParagraphs: [],
        after: [],
        highlightText: extractText,
        hasMoreBefore: false,
        hasMoreAfter: false,
        matched: false,
      }
    );
  }

  const beforeStart = Math.max(0, startIdx - beforeRadius);
  const afterEnd = Math.min(paragraphs.length, endIdx + 1 + afterRadius);

  const before = paragraphs.slice(beforeStart, startIdx).map((p) => p.text);
  const matchedParagraphs = paragraphs
    .slice(startIdx, endIdx + 1)
    .map((p) => p.text);
  const after = paragraphs.slice(endIdx + 1, afterEnd).map((p) => p.text);

  const originalSelection = getOriginalTextFromSelection(selectionContext);

  return {
    breadcrumb: paragraphs[startIdx].breadcrumb,
    before,
    matchedParagraphs,
    after,
    highlightText: extractText.trim() || originalSelection || "",
    hasMoreBefore: beforeStart > 0,
    hasMoreAfter: afterEnd < paragraphs.length,
    matched: true,
  };
}

function findMatchRangeInParagraph(
  paragraph: string,
  candidates: string[]
): [number, number] | null {
  const lowerPara = paragraph.toLowerCase();

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.trim();
    if (candidate.length < 4) continue;

    // 1. Direct case-insensitive substring match
    const directIdx = lowerPara.indexOf(candidate.toLowerCase());
    if (directIdx !== -1) {
      return [directIdx, directIdx + candidate.length];
    }

    // 2. Line-by-line match (for multi-paragraph extracts)
    const lines = candidate
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 6);
    for (const line of lines) {
      const lineIdx = lowerPara.indexOf(line.toLowerCase());
      if (lineIdx !== -1) {
        return [lineIdx, lineIdx + line.length];
      }
    }

    // 3. Whitespace-collapsed match mapped back to original indices
    const collapsedChars: string[] = [];
    const origIndices: number[] = [];
    let prevSpace = true;
    for (let i = 0; i < paragraph.length; i++) {
      const ch = paragraph[i];
      const isSpace = /\s/.test(ch);
      if (isSpace) {
        if (!prevSpace) {
          collapsedChars.push(" ");
          origIndices.push(i);
          prevSpace = true;
        }
      } else {
        collapsedChars.push(ch.toLowerCase());
        origIndices.push(i);
        prevSpace = false;
      }
    }
    const collapsedPara = collapsedChars.join("");
    const collapsedCand = candidate.replace(/\s+/g, " ").trim().toLowerCase();
    const normIdx = collapsedPara.indexOf(collapsedCand);
    if (normIdx !== -1 && normIdx + collapsedCand.length - 1 < origIndices.length) {
      const start = origIndices[normIdx];
      const end = origIndices[normIdx + collapsedCand.length - 1] + 1;
      return [start, end];
    }
  }

  return null;
}

function renderHighlightedParagraph(
  paragraph: string,
  candidates: string[]
): ReactNode {
  const range = findMatchRangeInParagraph(paragraph, candidates);
  if (!range) {
    return paragraph;
  }
  const [start, end] = range;
  return (
    <>
      {paragraph.slice(0, start)}
      <mark
        data-ghost-context-highlight="true"
        className="rounded bg-amber-400/25 px-1 py-0.5 text-foreground font-medium ring-1 ring-amber-400/40"
      >
        {paragraph.slice(start, end)}
      </mark>
      {paragraph.slice(end)}
    </>
  );
}

export interface GhostContextPeekProps {
  isPeeking: boolean;
  documentTitle?: string;
  parentContent?: string | null;
  extractText: string;
  selectionContext?: SelectionContext | null;
  isLoading?: boolean;
  radius?: number;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onClose?: () => void;
  onExtractSelection?: (selectedText: string) => Promise<void> | void;
  onHasSelectionChange?: (hasSelection: boolean) => void;
}

export function GhostContextPeek({
  isPeeking,
  documentTitle,
  parentContent,
  extractText,
  selectionContext,
  isLoading = false,
  radius = 2,
  isPinned = false,
  onTogglePin,
  onClose,
  onExtractSelection,
  onHasSelectionChange,
}: GhostContextPeekProps) {
  const [extraBefore, setExtraBefore] = useState(0);
  const [extraAfter, setExtraAfter] = useState(0);
  const [selectedText, setSelectedText] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isPeeking) {
      setExtraBefore(0);
      setExtraAfter(0);
      setSelectedText("");
      onHasSelectionChange?.(false);
    }
  }, [isPeeking, extractText, onHasSelectionChange]);

  const context = useMemo(() => {
    if (!isPeeking) return null;
    if (!parentContent || !parentContent.trim()) {
      return fallbackFromSelectionAnchor(selectionContext, extractText);
    }
    return extractSurroundingParagraphs(
      parentContent,
      extractText,
      { before: radius + extraBefore, after: radius + extraAfter },
      selectionContext
    );
  }, [isPeeking, parentContent, extractText, radius, extraBefore, extraAfter, selectionContext]);

  useEffect(() => {
    if (!isPeeking || !context?.matched) return;
    if (typeof anchorRef.current?.scrollIntoView === "function") {
      anchorRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isPeeking, context?.matched]);

  const syncSelectionFromDom = () => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      setSelectedText("");
      onHasSelectionChange?.(false);
      return;
    }
    const anchorInContainer = sel.anchorNode && container.contains(sel.anchorNode);
    const focusInContainer = sel.focusNode && container.contains(sel.focusNode);
    if (!anchorInContainer || !focusInContainer) {
      setSelectedText("");
      onHasSelectionChange?.(false);
      return;
    }
    const text = sel.toString().trim();
    if (text.length >= 3) {
      setSelectedText(text);
      onHasSelectionChange?.(true);
    } else {
      setSelectedText("");
      onHasSelectionChange?.(false);
    }
  };

  const handleExtractSelected = async () => {
    if (!onExtractSelection || !selectedText || isExtracting) return;
    setIsExtracting(true);
    try {
      await onExtractSelection(selectedText);
      window.getSelection()?.removeAllRanges();
      setSelectedText("");
      onHasSelectionChange?.(false);
    } finally {
      setIsExtracting(false);
    }
  };

  if (!isPeeking) return null;

  const breadcrumbLine = [documentTitle, ...(context?.breadcrumb ?? [])]
    .filter(Boolean)
    .join(" > ");

  const hasSurroundings =
    Boolean(context?.matched) &&
    ((context?.before.length ?? 0) > 0 ||
      (context?.matchedParagraphs.length ?? 0) > 0 ||
      (context?.after.length ?? 0) > 0);

  const highlightCandidates = [
    context?.highlightText ?? "",
    extractText,
    getOriginalTextFromSelection(selectionContext) ?? "",
  ].filter(Boolean);

  return (
    <div
      ref={containerRef}
      data-ghost-context-peek="true"
      onMouseUp={syncSelectionFromDom}
      onKeyUp={syncSelectionFromDom}
      className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-lg backdrop-blur-sm text-sm text-muted-foreground transition-all"
    >
      {/* Structured Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          {breadcrumbLine ? (
            <div
              className="truncate text-xs font-medium tracking-wide text-foreground/80"
              title={breadcrumbLine}
            >
              {breadcrumbLine}
            </div>
          ) : (
            <div className="text-xs font-medium text-muted-foreground">
              Source Context
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onExtractSelection && selectedText && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void handleExtractSelected()}
              disabled={isExtracting}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>{isExtracting ? "Extracting..." : "Extract selection"}</span>
            </button>
          )}
          {onTogglePin && (
            <button
              type="button"
              onClick={onTogglePin}
              aria-pressed={isPinned}
              title={isPinned ? "Unpin context" : "Keep context open"}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                isPinned
                  ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <PushPin className="h-3.5 w-3.5" />
              <span>{isPinned ? "Pinned" : "Pin"}</span>
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close context peek"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Structured Scrollable Reading Body */}
      <div className="max-h-[42vh] overflow-y-auto px-4 py-3.5 select-text">
        {isLoading && (!parentContent || !parentContent.trim()) ? (
          <p className="italic text-xs text-muted-foreground/80">
            Loading parent context...
          </p>
        ) : !context || !context.matched ? (
          <p className="italic text-xs text-muted-foreground/80">
            Parent context unavailable
          </p>
        ) : !hasSurroundings ? (
          <p className="italic text-xs text-muted-foreground/80">
            No surrounding paragraphs found in source document
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {context.hasMoreBefore && (
              <button
                type="button"
                onClick={() => setExtraBefore((prev) => prev + 3)}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <CaretUp className="h-3.5 w-3.5" />
                <span>Show earlier context</span>
              </button>
            )}

            {context.before.length > 0 && (
              <div className="flex flex-col gap-2.5 border-l border-border/50 pl-3">
                {context.before.map((para, idx) => (
                  <p
                    key={`before-${idx}`}
                    className="text-[13.5px] leading-relaxed text-muted-foreground/85"
                  >
                    {para}
                  </p>
                ))}
              </div>
            )}

            {context.matchedParagraphs.length > 0 && (
              <div
                ref={anchorRef}
                data-ghost-context-anchor="true"
                className="flex flex-col gap-2 rounded-lg border-l-2 border-amber-400/80 bg-amber-500/[0.07] px-3.5 py-2.5"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  <span>Current extract</span>
                </div>
                {context.matchedParagraphs.map((para, idx) => (
                  <p
                    key={`matched-${idx}`}
                    className="text-[13.5px] leading-relaxed text-foreground/90"
                  >
                    {renderHighlightedParagraph(para, highlightCandidates)}
                  </p>
                ))}
              </div>
            )}

            {context.after.length > 0 && (
              <div className="flex flex-col gap-2.5 border-l border-border/50 pl-3">
                {context.after.map((para, idx) => (
                  <p
                    key={`after-${idx}`}
                    className="text-[13.5px] leading-relaxed text-muted-foreground/85"
                  >
                    {para}
                  </p>
                ))}
              </div>
            )}

            {context.hasMoreAfter && (
              <button
                type="button"
                onClick={() => setExtraAfter((prev) => prev + 3)}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border/60 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <CaretDown className="h-3.5 w-3.5" />
                <span>Show more below</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer Hint */}
      {onExtractSelection && context?.matched && hasSurroundings && (
        <div className="border-t border-border/50 bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground/75">
          {selectedText
            ? "Click Extract selection above to save the highlighted passage."
            : "Select any text above or below to create a new extract."}
        </div>
      )}
    </div>
  );
}
