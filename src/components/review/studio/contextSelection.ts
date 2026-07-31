/**
 * Shared context-selection types and token helpers for the AI Flashcard Studio.
 *
 * These live here rather than in `FlashcardStudioModal.tsx` so the extracted
 * studio components (`ContextControlPanel`, the chip bar, the sheets) can use
 * them without importing from the modal — which would be a runtime circular
 * import, since the modal imports those components in turn.
 *
 * `FlashcardStudioModal.tsx` re-exports `ContextSelection`,
 * `DEFAULT_CONTEXT_SELECTION`, and `normalizeContextSelection` so existing
 * importers (`flashcardStudioSessions.ts` and its test suites) are unaffected.
 */

import { buildChapterQAContext } from "../../../utils/chapterUtils";

export type ContextMode = "full" | "chapters" | "pages" | "excerpt" | "search" | "sections";

export interface ContextSelection {
  mode: ContextMode;
  chapters: number[];
  pageRange: { start: number; end: number } | null;
  excerpt: string;
  searchQuery: string;
  searchResults: Array<{ start: number; end: number; preview: string }>;
  /** Section ids selected via the `#` mention menu in `sections` mode. */
  selectedSectionIds: string[];
}

export const DEFAULT_CONTEXT_SELECTION: ContextSelection = {
  mode: "full",
  chapters: [],
  pageRange: null,
  excerpt: "",
  searchQuery: "",
  searchResults: [],
  selectedSectionIds: [],
};

export function normalizeContextSelection(value: unknown): ContextSelection {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ContextSelection>;
  const mode: ContextMode =
    raw.mode === "full" || raw.mode === "chapters" || raw.mode === "pages" || raw.mode === "excerpt" || raw.mode === "search" || raw.mode === "sections"
      ? raw.mode
      : DEFAULT_CONTEXT_SELECTION.mode;
  return {
    mode,
    chapters: Array.isArray(raw.chapters)
      ? raw.chapters.filter((chapter): chapter is number => typeof chapter === "number" && Number.isInteger(chapter) && chapter > 0)
      : [],
    pageRange:
      raw.pageRange && typeof raw.pageRange.start === "number" && typeof raw.pageRange.end === "number"
        ? {
            start: Math.max(1, Math.floor(raw.pageRange.start)),
            end: Math.max(Math.max(1, Math.floor(raw.pageRange.start)), Math.floor(raw.pageRange.end)),
          }
        : null,
    excerpt: typeof raw.excerpt === "string" ? raw.excerpt : "",
    searchQuery: typeof raw.searchQuery === "string" ? raw.searchQuery : "",
    searchResults: Array.isArray(raw.searchResults)
      ? raw.searchResults.filter((result): result is { start: number; end: number; preview: string } =>
          Boolean(result) && typeof result.start === "number" && typeof result.end === "number" && typeof result.preview === "string"
        )
      : [],
    selectedSectionIds: Array.isArray(raw.selectedSectionIds)
      ? raw.selectedSectionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
  };
}

// Rough token estimation: ~4 chars per token
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}

/**
 * Token estimate for whatever the current selection would send.
 *
 * Shared by `ContextControlPanel` (which shows it in its summary line) and the
 * mobile context chip (which shows it on the bar) so the two can never disagree
 * about how large the context is.
 *
 * `sections` mode is resolved upstream — full resolution happens at send time,
 * so the caller passes in the precomputed estimate.
 */
export function estimateContextTokens(options: {
  content: string | null | undefined;
  title: string;
  selection: ContextSelection;
  maxTokens: number;
  focusedSectionTokens?: number;
}): number {
  const { content, title, selection, maxTokens, focusedSectionTokens } = options;
  const safe = normalizeContextSelection(selection);
  if (safe.mode === "sections") return focusedSectionTokens ?? 0;
  if (!content) return 0;

  switch (safe.mode) {
    case "full":
      return estimateTokens(content);
    case "chapters":
      return estimateTokens(
        safe.chapters
          .map((num) =>
            buildChapterQAContext(title, content, num, Math.floor(maxTokens / Math.max(1, safe.chapters.length)))
          )
          .join("\n\n")
      );
    case "excerpt":
      return estimateTokens(safe.excerpt);
    default:
      return estimateTokens(content.slice(0, maxTokens * CHARS_PER_TOKEN));
  }
}
