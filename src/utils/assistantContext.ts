import type { Document } from "../types/document";
import { isReaderRelativeRequest } from "../lib/ai/assistant/documentIntent";
import { parsePdfPageRequest, resolvePdfPageEvidence, usablePdfPageText, type PdfPageEvidence, type PdfPageSource } from "./pdfAssistantEvidence";
import { trimToTokenWindow } from "./tokenizer";

export type AssistantContextStatus = "ready" | "loading" | "unavailable";

export type AssistantContextSource =
  | "selection"
  | "pdf-window"
  | "ocr"
  | "document-content"
  | "video-transcript"
  | "document"
  | "none";

export interface ResolvedAssistantContext {
  status: AssistantContextStatus;
  content?: string;
  source: AssistantContextSource;
  message?: string;
  /**
   * How much of the source the content actually covers. "window" means a
   * bounded slice (reader position / PDF page window), "full" means the whole
   * loaded source fits the budget. Adapters forward this so prompts never
   * present a window as the whole source.
   */
  coverage?: "full" | "window" | "chunks";
  pageScoped?: boolean;
  pdfPagesRequested?: boolean;
  pdfPageEvidence?: PdfPageEvidence;
}

export interface PdfTextWindow {
  documentId: string;
  activePage: number;
  activePageText?: string;
  source?: PdfPageSource;
}

export interface ResolveAssistantPromptOptions {
  documentId?: string;
  sourceTokenBudget?: number;
  signal?: AbortSignal;
  usesLibraryScope?: boolean;
}

interface ResolvePdfAssistantContextParams {
  document?: Document | null;
  liveWindowText?: string;
  storedDocumentText?: string;
  ocrText?: string | null;
  selection?: string;
  pageNumber?: number;
  contextPageWindow?: number;
  preferOcr?: boolean;
  requireCurrentPage?: boolean;
  liveWindow?: PdfTextWindow;
  extractedTextLoader?: () => Promise<string | undefined>;
}

const PDF_TEXT_MIN_WORDS = 24;
const PDF_TEXT_MIN_CHARS = 160;

export const SELECTION_EXCERPT_MAX_CHARS = 2000;
export const SELECTION_TRUNCATION_MARKER = "\n\n[Selected text truncated due to context limit...]";
export const SELECTION_PRECEDENCE_INSTRUCTION =
  'The user\'s question is about the Selected text first; use Document context as secondary grounding. Ambiguous references like "this", "it", or "this paragraph" refer to the selection.';

export function formatSelectionExcerpt(
  selection?: string | null,
  maxChars: number = SELECTION_EXCERPT_MAX_CHARS,
): { text: string; truncated: boolean } {
  const normalized = normalizeWhitespace(selection);
  if (!normalized) return { text: "", truncated: false };
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  const target = Math.max(1, maxChars - SELECTION_TRUNCATION_MARKER.length);
  const candidate = normalized.slice(0, target);
  // Prefer a word boundary so we don't cut mid-word when there is one nearby.
  const lastSpace = candidate.lastIndexOf(" ");
  const cut = lastSpace > target * 0.6 ? candidate.slice(0, lastSpace) : candidate;
  return { text: `${cut.trimEnd()}${SELECTION_TRUNCATION_MARKER}`, truncated: true };
}

function normalizeWhitespace(value?: string | null): string {
  if (value == null) return "";
  const str = typeof value === "string" ? value : String(value);
  return str.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function stripHtml(value?: string | null): string {
  return normalizeWhitespace(value?.replace(/<[^>]+>/g, " "));
}

function hasUsableContextText(value?: string | null): boolean {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return normalized.length >= PDF_TEXT_MIN_CHARS || wordCount >= PDF_TEXT_MIN_WORDS;
}

function buildPdfContextContent(params: {
  title?: string;
  pageNumber?: number;
  contextPageWindow?: number;
  selection?: string;
  body: string;
  source: AssistantContextSource;
}): string {
  const lines: string[] = [];
  lines.push(`PDF document: ${params.title || "Untitled document"}`);

  if (params.pageNumber && params.pageNumber > 0) {
    const pageWindow = params.contextPageWindow ?? 2;
    const start = Math.max(1, params.pageNumber - pageWindow);
    const end = params.pageNumber + pageWindow;
    lines.push(`Active page: ${params.pageNumber}`);
    if (pageWindow > 0) lines.push(`Nearby page window: ${start}-${end}`);
  }

  lines.push(`Context source: ${params.source}`);

  const { text: selectionExcerpt } = formatSelectionExcerpt(params.selection);
  if (selectionExcerpt) {
    lines.push("");
    lines.push(SELECTION_PRECEDENCE_INSTRUCTION);
    lines.push("");
    lines.push("Selected text:");
    lines.push(selectionExcerpt);
  }

  lines.push("");
  lines.push("Document context:");
  lines.push(params.body);

  return lines.join("\n");
}

export function getAssistantContextErrorMessage(reason?: string): string {
  switch (reason) {
    case "loading":
      return "Document context is still loading. Try again in a moment.";
    case "unavailable":
      return "No text content available for this document. Transcribe the audio or extract text first, then try again.";
    default:
      return "Document context is unavailable for this request.";
  }
}

function resolveCurrentPdfPage(
  params: ResolvePdfAssistantContextParams,
  selection: string,
): ResolvedAssistantContext {
  const page = params.liveWindow?.activePage;
  const currentWindow = params.liveWindow?.documentId === params.document?.id
    && (params.pageNumber === undefined || page === params.pageNumber);
  const pageText = currentWindow ? usablePdfPageText(params.liveWindow?.activePageText) : "";
  if (!pageText && !selection) {
    return {
      status: "unavailable",
      source: "none",
      pageScoped: true,
      message: "Text from the current PDF page is unavailable. Select a passage or recognize the page with OCR and try again.",
    };
  }
  const source = pageText ? "pdf-window" : "selection";
  return {
    status: "ready",
    source,
    coverage: "window",
    pageScoped: true,
    content: buildPdfContextContent({
      title: params.document?.title,
      pageNumber: currentWindow ? page : params.pageNumber,
      contextPageWindow: 0,
      selection,
      body: pageText || selection,
      source,
    }),
  };
}

export async function resolvePdfContextForPrompt(
  prompt: string,
  params: ResolvePdfAssistantContextParams,
  maxTokens: number,
  model?: string,
  options?: ResolveAssistantPromptOptions,
): Promise<ResolvedAssistantContext> {
  if (options?.documentId && options.documentId !== params.document?.id) {
    return { status: "unavailable", source: "none", pageScoped: true, message: "The active PDF changed before this request could be prepared." };
  }
  const requested = !options?.usesLibraryScope ? parsePdfPageRequest(prompt) : undefined;
  if (requested) {
    if (/\b(?:another|other|second|both|two)\s+(?:pdfs?|documents?)\b/iu.test(prompt)) {
      return { status: "unavailable", source: "none", pageScoped: true, pdfPagesRequested: true, message: "This reader has physical page evidence for its active PDF. Include both PDFs in a source-scoped workspace for a cross-document comparison." };
    }
    const result = "message" in requested ? requested : await resolvePdfPageEvidence({
      source: params.liveWindow?.source,
      documentId: params.document?.id,
      title: params.document?.title,
      pages: requested.pages,
      tokenBudget: Math.min(maxTokens, options?.sourceTokenBudget ?? maxTokens),
      model,
      signal: options?.signal,
    });
    if ("message" in result) {
      return { status: "unavailable", source: "none", pageScoped: true, pdfPagesRequested: true, message: result.message };
    }
    return {
      status: "ready",
      source: "pdf-window",
      content: result.evidence.content,
      coverage: "window",
      pageScoped: true,
      pdfPagesRequested: true,
      pdfPageEvidence: result.evidence,
    };
  }

  const resolution = await resolvePdfAssistantContext({ ...params, requireCurrentPage: isReaderRelativeRequest(prompt) });
  return resolution.status === "ready" && resolution.content
    ? { ...resolution, content: await trimToTokenWindow(resolution.content, maxTokens, model, params.selection) }
    : resolution;
}

export async function resolvePdfAssistantContext(
  params: ResolvePdfAssistantContextParams
): Promise<ResolvedAssistantContext> {
  const selection = normalizeWhitespace(params.selection);
  if (params.requireCurrentPage) return resolveCurrentPdfPage(params, selection);
  const liveWindowText = normalizeWhitespace(params.liveWindowText);
  const ocrText = normalizeWhitespace(params.ocrText);
  let storedDocumentText = stripHtml(params.storedDocumentText);

  const preferOcr = Boolean(params.preferOcr);
  const preferredBody = preferOcr
    ? (hasUsableContextText(ocrText) ? ocrText : liveWindowText)
    : (hasUsableContextText(liveWindowText) ? liveWindowText : ocrText);

  let body = preferredBody;
  let source: AssistantContextSource = preferOcr
    ? (body === ocrText ? "ocr" : body === liveWindowText ? "pdf-window" : "none")
    : (body === liveWindowText ? "pdf-window" : body === ocrText ? "ocr" : "none");

  if (!hasUsableContextText(body) && hasUsableContextText(storedDocumentText)) {
    body = storedDocumentText;
    source = "document-content";
  }

  if (!hasUsableContextText(body) && params.extractedTextLoader) {
    try {
      const extracted = stripHtml(await params.extractedTextLoader());
      if (hasUsableContextText(extracted)) {
        storedDocumentText = extracted;
        body = extracted;
        source = "document-content";
      }
    } catch {
      // Ignore extraction errors here and let the caller surface the unavailable state.
    }
  }

  const usableBody = hasUsableContextText(body);
  if (!usableBody && !selection) {
    return {
      status: "unavailable",
      source: "none",
      message: getAssistantContextErrorMessage("unavailable"),
    };
  }

  const resolvedSource = usableBody ? source : "selection";
  const content = buildPdfContextContent({
    title: params.document?.title,
    pageNumber: resolvedSource === "pdf-window" ? params.pageNumber : undefined,
    contextPageWindow: params.contextPageWindow,
    selection,
    body: usableBody ? body : selection,
    source: resolvedSource,
  });

  return {
    status: "ready",
    content,
    source: resolvedSource,
    coverage: "window",
  };
}

export function resolveGenericAssistantContext(
  content?: string,
  source: AssistantContextSource = "document",
  selection?: string,
): ResolvedAssistantContext {
  const normalized = normalizeWhitespace(content);
  const { text: selectionExcerpt } = formatSelectionExcerpt(selection);
  if (!normalized && !selectionExcerpt) {
    return {
      status: "unavailable",
      source: "none",
      message: getAssistantContextErrorMessage("unavailable"),
    };
  }

  if (selectionExcerpt) {
    const lines: string[] = [];
    lines.push(SELECTION_PRECEDENCE_INSTRUCTION);
    lines.push("");
    lines.push("Selected text:");
    lines.push(selectionExcerpt);
    if (normalized) {
      lines.push("");
      lines.push("Document context:");
      lines.push(normalized);
    }
    return {
      status: "ready",
      source: normalized ? source : "selection",
      content: lines.join("\n"),
    };
  }

  return {
    status: "ready",
    source,
    content: normalized,
  };
}

export function resolveTwitterThreadAssistantContext(
  document?: Document | null,
  selection?: string
): ResolvedAssistantContext {
  const xThread = document?.metadata?.xThread;
  const { text: selectionExcerpt } = formatSelectionExcerpt(selection);
  const selectionNormalized = selectionExcerpt;

  let structuredText = "";
  if (xThread) {
    if (xThread.structuredText) {
      structuredText = xThread.structuredText;
    } else {
      const author = xThread.author;
      const posts = xThread.posts || [];
      const lines: string[] = [];
      lines.push(`X Thread by ${author.name} (@${author.screenName}):\n`);
      for (const post of posts) {
        lines.push(`[Post ${post.postIndex} by @${author.screenName}]`);
        lines.push(post.fullText || post.text);
        if (post.quotedPost) {
          lines.push(`[Quoting @${post.quotedPost.author.screenName}]: "${post.quotedPost.text}"`);
        }
        lines.push("");
      }
      structuredText = lines.join("\n");
    }
  } else if (document?.content) {
    structuredText = document.content;
  }

  if (!structuredText && !selectionNormalized) {
    return {
      status: "unavailable",
      source: "none",
      message: getAssistantContextErrorMessage("unavailable"),
    };
  }

  const lines: string[] = [];
  lines.push(`Document: ${document?.title || "X Thread"}`);
  lines.push(`Source: ${document?.filePath || "X / Twitter"}`);
  if (selectionNormalized) {
    lines.push("");
    lines.push(SELECTION_PRECEDENCE_INSTRUCTION);
    lines.push("");
    lines.push("Selected text:");
    lines.push(selectionNormalized);
  }
  lines.push("");
  lines.push("Thread Content:");
  lines.push(structuredText || selectionNormalized);

  return {
    status: "ready",
    source: selectionNormalized && !structuredText ? "selection" : "document-content",
    content: lines.join("\n"),
  };
}
