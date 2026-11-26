import { useMemo } from "react";
import type { SelectionContext } from "../../types/selection";

export interface SurroundingParagraphsResult {
  breadcrumb: string[];
  before: string[];
  after: string[];
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

  const blocks = prepared
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length <= 1 && prepared.includes("\n")) {
    return prepared
      .split(/\n+/)
      .map((b) => b.trim())
      .filter(Boolean);
  }

  return blocks;
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
  selectionContext?: SelectionContext | null
): SurroundingParagraphsResult | null {
  if (!selectionContext || selectionContext.type !== "text") return null;
  const anchor = selectionContext.anchor;
  if (!anchor?.textQuote) return null;
  const prefix = stripTags(anchor.textQuote.prefix || "");
  const suffix = stripTags(anchor.textQuote.suffix || "");
  if (!prefix && !suffix) return null;
  return {
    breadcrumb: anchor.sectionHeading ? [anchor.sectionHeading] : [],
    before: prefix ? [prefix] : [],
    after: suffix ? [suffix] : [],
    matched: true,
  };
}

/**
 * Extract up to `radius` preceding and succeeding paragraphs plus the heading
 * breadcrumb stack leading up to the paragraph matching `extractText`.
 */
export function extractSurroundingParagraphs(
  parentContent: string,
  extractText: string,
  radius = 2,
  selectionContext?: SelectionContext | null
): SurroundingParagraphsResult {
  if (!parentContent || !parentContent.trim()) {
    return (
      fallbackFromSelectionAnchor(selectionContext) ?? {
        breadcrumb: [],
        before: [],
        after: [],
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
      fallbackFromSelectionAnchor(selectionContext) ?? {
        breadcrumb: headingStack.map((h) => h.text),
        before: [],
        after: [],
        matched: false,
      }
    );
  }

  const before = paragraphs
    .slice(Math.max(0, startIdx - radius), startIdx)
    .map((p) => p.text);
  const after = paragraphs
    .slice(endIdx + 1, endIdx + 1 + radius)
    .map((p) => p.text);

  return {
    breadcrumb: paragraphs[startIdx].breadcrumb,
    before,
    after,
    matched: true,
  };
}

export interface GhostContextPeekProps {
  isPeeking: boolean;
  documentTitle?: string;
  parentContent?: string | null;
  extractText: string;
  selectionContext?: SelectionContext | null;
  isLoading?: boolean;
  radius?: number;
}

export function GhostContextPeek({
  isPeeking,
  documentTitle,
  parentContent,
  extractText,
  selectionContext,
  isLoading = false,
  radius = 2,
}: GhostContextPeekProps) {
  const context = useMemo(() => {
    if (!isPeeking) return null;
    if (!parentContent || !parentContent.trim()) {
      return fallbackFromSelectionAnchor(selectionContext);
    }
    return extractSurroundingParagraphs(
      parentContent,
      extractText,
      radius,
      selectionContext
    );
  }, [isPeeking, parentContent, extractText, radius, selectionContext]);

  if (!isPeeking) return null;

  const breadcrumbLine = [documentTitle, ...(context?.breadcrumb ?? [])]
    .filter(Boolean)
    .join(" > ");

  const hasSurroundings =
    Boolean(context?.matched) &&
    ((context?.before.length ?? 0) > 0 || (context?.after.length ?? 0) > 0);

  return (
    <div
      data-ghost-context-peek="true"
      className="flex flex-col gap-3 rounded-xl border border-dashed border-border/80 bg-muted/25 p-4 text-sm text-muted-foreground transition-all"
    >
      {breadcrumbLine && (
        <div className="text-xs font-medium tracking-wide text-muted-foreground/90">
          {breadcrumbLine}
        </div>
      )}

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
        <>
          {context.before.map((para, idx) => (
            <p key={`before-${idx}`} className="leading-relaxed opacity-75">
              {para}
            </p>
          ))}
          {context.after.length > 0 && (
            <div className="border-t border-dashed border-border/60 pt-3 flex flex-col gap-2">
              {context.after.map((para, idx) => (
                <p key={`after-${idx}`} className="leading-relaxed opacity-75">
                  {para}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
