/**
 * ContextControlPanel — granular control over which part of a document is sent
 * to the model (full text, chapters, `#` sections, page range, excerpt, search).
 *
 * Moved verbatim out of `FlashcardStudioModal.tsx` so it can be rendered both
 * inline (desktop) and inside a bottom sheet (mobile) from one definition.
 */

import { useCallback, useMemo, useState } from "react";
import {
  BookOpen,
  CaretDown,
  Hash,
  Highlighter,
  MagnifyingGlass,
  Scissors,
  Scroll,
  TextT,
  WarningCircle,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";
import { getChapterTitles } from "../../../utils/chapterUtils";
import { SectionMentionCard } from "../../common/SectionMentionCard";
import type { SectionNode } from "../../../utils/sectionIndex";
import {
  estimateContextTokens,
  estimateTokens,
  formatTokenCount,
  normalizeContextSelection,
  type ContextMode,
  type ContextSelection,
} from "./contextSelection";

export function ContextControlPanel({
  document,
  selection,
  onChange,
  maxTokens,
  selectedSections,
  focusedSectionTokens,
  onRemoveSection,
}: {
  document: { id: string; title: string; content?: string | null } | null;
  selection: ContextSelection;
  onChange: (selection: ContextSelection) => void;
  maxTokens: number;
  /** Section nodes currently focused in `sections` mode (resolved from ids). */
  selectedSections?: SectionNode[];
  /** Cheap token estimate for the focused sections (precomputed upstream). */
  focusedSectionTokens?: number;
  /** Remove a focused section by id (also strips the `#{title}` token). */
  onRemoveSection?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageStart, setPageStart] = useState("");
  const [pageEnd, setPageEnd] = useState("");
  const [excerptText, setExcerptText] = useState("");

  const chapters = useMemo(() => {
    if (!document?.content) return [];
    return getChapterTitles(document.content);
  }, [document]);
  const safeSelection = normalizeContextSelection(selection);
  const selectedChapters = safeSelection.chapters;

  const estimatedTokens = useMemo(
    () =>
      estimateContextTokens({
        content: document?.content,
        title: document?.title ?? "",
        selection: safeSelection,
        maxTokens,
        focusedSectionTokens,
      }),
    [document, safeSelection, maxTokens, focusedSectionTokens]
  );

  const handleSearch = useCallback(() => {
    if (!searchQuery.trim() || !document?.content) return;

    const query = searchQuery.toLowerCase();
    const content = document.content;
    const results: Array<{ start: number; end: number; preview: string }> = [];

    // Simple search: find all occurrences and extract surrounding context
    let index = content.toLowerCase().indexOf(query);
    while (index !== -1) {
      const start = Math.max(0, index - 100);
      const end = Math.min(content.length, index + query.length + 100);
      results.push({
        start,
        end,
        preview: content.slice(start, end),
      });
      index = content.toLowerCase().indexOf(query, index + 1);
    }

    onChange({ ...selection, searchResults: results.slice(0, 5) });
  }, [searchQuery, document, selection, onChange]);

  if (!document) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-600">
        <WarningCircle className="w-3.5 h-3.5" />
        <span>{t("flashcardStudio.selectDocumentForContext")}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Scissors className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-foreground">{t("flashcardStudio.contextControlTitle")}</div>
            <div className="text-xs text-muted-foreground">
              {safeSelection.mode === "full" && t("flashcardStudio.contextModeFullSummary")}
              {safeSelection.mode === "chapters" && t("flashcardStudio.contextModeChaptersSummary", { count: selectedChapters.length })}
              {safeSelection.mode === "pages" && t("flashcardStudio.contextModePagesSummary")}
              {safeSelection.mode === "excerpt" && t("flashcardStudio.contextModeExcerptSummary")}
              {safeSelection.mode === "search" && t("flashcardStudio.contextModeSearchSummary")}
              {safeSelection.mode === "sections" && t("flashcardStudio.contextModeSectionsSummary", { count: safeSelection.selectedSectionIds.length })}
              {" · "}
              {t("flashcardStudio.tokensWithCount", { count: formatTokenCount(estimatedTokens) })}
            </div>
          </div>
        </div>
        <CaretDown className={cn("w-4 h-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
      </button>

      {isExpanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* Mode Selection */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: "full", label: t("flashcardStudio.contextModeFull"), icon: TextT },
              { id: "chapters", label: t("flashcardStudio.contextModeChapters"), icon: BookOpen },
              { id: "sections", label: t("flashcardStudio.contextModeSections"), icon: Hash },
              { id: "pages", label: t("flashcardStudio.contextModePages"), icon: Scroll },
              { id: "excerpt", label: t("flashcardStudio.contextModeExcerpt"), icon: Highlighter },
              { id: "search", label: t("flashcardStudio.contextModeSearch"), icon: MagnifyingGlass },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => onChange({ ...selection, mode: mode.id as ContextMode })}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                  safeSelection.mode === mode.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                <mode.icon className="w-3.5 h-3.5" />
                {mode.label}
              </button>
            ))}
          </div>

          {/* Chapter Selection */}
          {safeSelection.mode === "chapters" && chapters.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.selectChapters")}</div>
              <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                {chapters.map((chapter) => (
                  <label
                    key={chapter.number}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChapters.includes(chapter.number)}
                      onChange={() => {
                        const newChapters = selectedChapters.includes(chapter.number)
                          ? selectedChapters.filter((c) => c !== chapter.number)
                          : [...selectedChapters, chapter.number];
                        onChange({ ...selection, chapters: newChapters });
                      }}
                      className="rounded"
                    />
                    <span className="text-xs text-muted-foreground w-16">{t("flashcardStudio.chapterNumber", { count: chapter.number })}</span>
                    <span className="text-sm text-foreground truncate">{chapter.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Page Range */}
          {safeSelection.mode === "pages" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.enterPageRange")}</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={pageStart}
                  onChange={(e) => setPageStart(e.target.value)}
                  placeholder={t("flashcardStudio.start")}
                  className="w-24 px-3 py-2 text-sm border border-border rounded-lg bg-background"
                />
                <span className="text-muted-foreground">{t("flashcardStudio.to")}</span>
                <input
                  type="number"
                  value={pageEnd}
                  onChange={(e) => setPageEnd(e.target.value)}
                  placeholder={t("flashcardStudio.end")}
                  className="w-24 px-3 py-2 text-sm border border-border rounded-lg bg-background"
                />
                <button
                  onClick={() => {
                    const start = parseInt(pageStart);
                    const end = parseInt(pageEnd);
                    if (!isNaN(start) && !isNaN(end)) {
                      onChange({ ...selection, pageRange: { start, end } });
                    }
                  }}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  {t("flashcardStudio.apply")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("flashcardStudio.pageRangeNote")}
              </p>
            </div>
          )}

          {/* Excerpt */}
          {safeSelection.mode === "excerpt" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.pasteExcerptPrompt")}</div>
              <textarea
                value={excerptText}
                onChange={(e) => setExcerptText(e.target.value)}
                placeholder={t("flashcardStudio.excerptPlaceholder")}
                rows={5}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t("flashcardStudio.tokensWithCount", { count: formatTokenCount(estimateTokens(excerptText)) })}
                </span>
                <button
                  onClick={() => {
                    onChange({ ...selection, excerpt: excerptText });
                    setExcerptText("");
                  }}
                  disabled={!excerptText.trim()}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {t("flashcardStudio.useExcerpt")}
                </button>
              </div>
            </div>
          )}

          {/* MagnifyingGlass */}
          {safeSelection.mode === "search" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.searchWithinDocument")}</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder={t("flashcardStudio.searchWithinDocumentPlaceholder")}
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background"
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                >
                  <MagnifyingGlass className="w-4 h-4" />
                </button>
              </div>

              {safeSelection.searchResults.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
                  {safeSelection.searchResults.map((result, i) => (
                    <button
                      key={i}
                      onClick={() => onChange({ ...selection, excerpt: result.preview })}
                      className="w-full text-left p-2 rounded-md hover:bg-muted/50 text-xs"
                    >
                      <span className="text-muted-foreground">...{result.preview}...</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sections (via `#` mentions) */}
          {safeSelection.mode === "sections" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">{t("flashcardStudio.sectionsHint")}</div>
              {selectedSections && selectedSections.length > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-1 border border-border rounded-lg p-2">
                  {selectedSections.map((node) => (
                    <SectionMentionCard
                      key={node.id}
                      node={node}
                      onRemove={onRemoveSection}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                  <WarningCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{t("flashcardStudio.sectionsEmpty")}</span>
                </div>
              )}
            </div>
          )}

          {/* Token Estimation */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground">
              {t("flashcardStudio.estimatedTokensPrefix")} <span className="font-medium text-foreground">{formatTokenCount(estimatedTokens)}</span> {t("flashcardStudio.tokens")}
              {safeSelection.mode !== "full" && (
                <span className="text-green-600 ml-2">
                  {t("flashcardStudio.savesTokens", { count: formatTokenCount(estimateTokens(document.content || "") - estimatedTokens) })}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("flashcardStudio.maxTokens", { count: formatTokenCount(maxTokens) })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
