import { useMemo } from "react";

export interface SurroundingParagraphsResult {
  breadcrumb: string[];
  before: string[];
  after: string[];
  matched: boolean;
}

function stripTags(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHeading(block: string): { level: number; text: string } | null {
  const mdMatch = block.trim().match(/^(#{1,4})\s+(.+)$/);
  if (mdMatch) {
    return { level: mdMatch[1].length, text: stripTags(mdMatch[2]) };
  }
  const htmlMatch = block.trim().match(/^<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  if (htmlMatch) {
    return { level: Number(htmlMatch[1]), text: stripTags(htmlMatch[2]) };
  }
  return null;
}

/**
 * Extract up to `radius` preceding and succeeding paragraphs plus the heading
 * breadcrumb stack leading up to the paragraph matching `extractText`.
 */
export function extractSurroundingParagraphs(
  parentContent: string,
  extractText: string,
  radius = 2
): SurroundingParagraphsResult {
  if (!parentContent || !parentContent.trim()) {
    return { breadcrumb: [], before: [], after: [], matched: false };
  }

  const rawBlocks = parentContent
    .split(/\n\s*\n|<\/p>|<\/h[1-4]>/i)
    .map((b) => b.trim())
    .filter(Boolean);

  const paragraphs: Array<{ text: string; breadcrumb: string[] }> = [];
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
        breadcrumb: headingStack.map((h) => h.text),
      });
    }
  }

  const needle = stripTags(extractText).slice(0, 64).trim().toLowerCase();
  const matchIdx = needle
    ? paragraphs.findIndex((p) => p.text.toLowerCase().includes(needle))
    : -1;

  if (matchIdx === -1) {
    return {
      breadcrumb: headingStack.map((h) => h.text),
      before: [],
      after: [],
      matched: false,
    };
  }

  const before = paragraphs
    .slice(Math.max(0, matchIdx - radius), matchIdx)
    .map((p) => p.text);
  const after = paragraphs
    .slice(matchIdx + 1, matchIdx + 1 + radius)
    .map((p) => p.text);

  return {
    breadcrumb: paragraphs[matchIdx].breadcrumb,
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
  radius?: number;
}

export function GhostContextPeek({
  isPeeking,
  documentTitle,
  parentContent,
  extractText,
  radius = 2,
}: GhostContextPeekProps) {
  const context = useMemo(() => {
    if (!isPeeking || !parentContent || !parentContent.trim()) {
      return null;
    }
    return extractSurroundingParagraphs(parentContent, extractText, radius);
  }, [isPeeking, parentContent, extractText, radius]);

  if (!isPeeking) return null;

  const breadcrumbLine = [documentTitle, ...(context?.breadcrumb ?? [])]
    .filter(Boolean)
    .join(" > ");

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

      {!parentContent || !parentContent.trim() ? (
        <p className="italic text-xs text-muted-foreground/80">
          Parent context unavailable
        </p>
      ) : (
        <>
          {context?.before.map((para, idx) => (
            <p key={`before-${idx}`} className="leading-relaxed opacity-75">
              {para}
            </p>
          ))}
          {context?.after && context.after.length > 0 && (
            <div className="border-t border-dashed border-border/60 pt-3 flex flex-col gap-2">
              {context.after.map((para, idx) => (
                <p key={`after-${idx}`} className="leading-relaxed opacity-75">
                  {para}
                </p>
              ))}
            </div>
          )}
          {context && !context.matched && (
            <p className="italic text-xs text-muted-foreground/80">
              Parent context unavailable
            </p>
          )}
        </>
      )}
    </div>
  );
}
