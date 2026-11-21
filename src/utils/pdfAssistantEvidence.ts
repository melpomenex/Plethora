import { budgetScopedBodies } from "./scopedContextBudget";
import { countTokens } from "./tokenizer";

const MAX_REQUESTED_PAGES = 16;
const PAGE_TERMS = String.raw`(?:pages?|pp?\.|seiten?|p[áa]ginas?)`;
const PAGE_START = new RegExp(String.raw`\b${PAGE_TERMS}\s*#?\s*(-?\d+)`, "giu");
const PAGE_CONTINUATION = new RegExp(String.raw`\s*([-–—]|\b(?:through|to|and|bis|und|hasta)\b|,(?:\s*and\b)?)\s*(?:${PAGE_TERMS}\s*#?\s*)?(-?\d+)`, "iyu");
const OPEN_ENDED_RANGE = /^\s*(?:[-–—]|through\b|to\s+(?:the\s+)?end\b|bis\s+zum\s+ende\b|hasta\s+el\s+final\b)/iu;

export interface PdfPageSource {
  documentId: string;
  version: string;
  pageCount: number;
  isCurrent: () => boolean;
  loadPageText: (page: number) => Promise<string>;
}

export interface PdfPageEvidence {
  documentId: string;
  title?: string;
  version: string;
  content: string;
  excerpts: Array<{ pageNumber: number; text: string }>;
}

/** Reserve room for Assistant's fixed prompt layers and source wrapper. */
export function pdfSourceTokenBudget(promptBudget: number, prompt: string, history: readonly { content: string }[], instructions = ""): number {
  const overhead = prompt.length + instructions.length +
    history.reduce((sum, turn) => sum + turn.content.length + 16, 0);
  return Math.max(0, Math.floor(promptBudget - overhead / 4 - 384));
}

type RequestedPages = { pages: number[] } | { message: string };

/** Parse bounded lists and inclusive ranges of one-based physical pages. */
export function parsePdfPageRequest(prompt: string): RequestedPages | undefined {
  const starts = new RegExp(PAGE_START);
  const pages = new Set<number>();
  let start: RegExpExecArray | null;
  while ((start = starts.exec(prompt))) {
    const nextPage = Number(start[1]);
    if (!Number.isSafeInteger(nextPage) || nextPage < 1) return { message: "Use positive physical PDF page numbers." };
    pages.add(nextPage);
    const continuation = new RegExp(PAGE_CONTINUATION);
    continuation.lastIndex = starts.lastIndex;
    let priorPage = nextPage;
    let next: RegExpExecArray | null;
    while ((next = continuation.exec(prompt))) {
      const followingPage = Number(next[2]);
      if (!Number.isSafeInteger(followingPage) || followingPage < 1) return { message: "Use positive physical PDF page numbers." };
      const listSeparator = /^(?:,|and\b|und\b)/iu.test(next[1]);
      const first = listSeparator ? followingPage : priorPage + 1;
      if (!listSeparator && followingPage < priorPage) return { message: "Write the PDF page range in ascending order." };
      if (followingPage - first >= MAX_REQUESTED_PAGES) return { message: tooManyPages() };
      for (let page = first; page <= followingPage; page += 1) pages.add(page);
      priorPage = followingPage;
      starts.lastIndex = continuation.lastIndex;
      if (pages.size > MAX_REQUESTED_PAGES) return { message: tooManyPages() };
    }
    if (OPEN_ENDED_RANGE.test(prompt.slice(starts.lastIndex))) {
      return { message: "Give the physical page number at both ends of the PDF range." };
    }
    if (/^\.\d/u.test(prompt.slice(starts.lastIndex))) {
      return { message: "Use whole physical PDF page numbers." };
    }
    if (pages.size > MAX_REQUESTED_PAGES) return { message: tooManyPages() };
  }
  return pages.size > 0 ? { pages: [...pages] } : undefined;
}

function tooManyPages(): string {
  return `Choose up to ${MAX_REQUESTED_PAGES} physical PDF pages per request.`;
}

export function usablePdfPageText(value?: string): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return /^(?:page\s+)?\d+(?:\s*\/\s*\d+)?$/iu.test(normalized) ? "" : normalized;
}

export async function resolvePdfPageEvidence(options: {
  source?: PdfPageSource;
  documentId?: string;
  title?: string;
  pages: number[];
  tokenBudget: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ evidence: PdfPageEvidence } | { message: string }> {
  const { source, documentId, title, pages, tokenBudget, model, signal } = options;
  if (!source || !documentId || source.documentId !== documentId || !source.isCurrent()) {
    return { message: "Open the PDF reader before requesting its physical pages." };
  }
  if (pages.some((page) => page > source.pageCount)) {
    return { message: `This PDF has ${source.pageCount} physical pages. Check the requested page numbers.` };
  }
  const bodies: Array<{ label: string; text: string }> = [];
  const missing: number[] = [];
  for (const [index, page] of pages.entries()) {
    if (signal?.aborted || !source.isCurrent()) break;
    const text = usablePdfPageText(await source.loadPageText(page).catch(() => ""));
    if (!text) missing.push(page);
    bodies.push({ label: `[${index + 1}] Physical PDF page ${page}`, text });
  }
  if (signal?.aborted || !source.isCurrent() || bodies.length !== pages.length) {
    return { message: "The PDF changed before the requested pages could be loaded." };
  }
  if (missing.length) {
    return { message: `Readable text is unavailable on PDF page${missing.length === 1 ? "" : "s"} ${missing.join(", ")}. Recognize the page text with OCR or choose a smaller range.` };
  }
  try {
    let budgeted = budgetScopedBodies(bodies, tokenBudget, 0.7);
    const measured = await countTokens(budgeted.content, model);
    if (measured > tokenBudget) {
      budgeted = budgetScopedBodies(bodies, Math.floor(tokenBudget * tokenBudget / measured), 0.65);
      if (await countTokens(budgeted.content, model) > tokenBudget) throw new Error();
    }
    if (signal?.aborted || !source.isCurrent()) {
      return { message: "The PDF changed before the requested pages could be loaded." };
    }
    return {
      evidence: {
        documentId,
        title,
        version: source.version,
        content: budgeted.content,
        excerpts: pages.map((pageNumber, index) => ({ pageNumber, text: budgeted.excerpts[index] })),
      },
    };
  } catch {
    return { message: "Each requested PDF page needs room in the context budget. Choose fewer pages or start a new conversation." };
  }
}
