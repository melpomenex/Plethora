import React, { useCallback, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, BookOpen, HighlighterCircle, X } from "@phosphor-icons/react";
import type { ExactSearchHitLocation } from "../../../types/searchHit";
import type { StudySourceAnchor } from "../../../types/studyMode";
import { formatAnchorLocationLabel } from "../../../lib/study-plans/studyMode/anchoring";

export interface OriginalSourcePaneProps {
  documentTitle: string;
  passageText: string;
  activeSelection: string | null;
  activeAnchor: StudySourceAnchor | null;
  currentLocator?: ExactSearchHitLocation | null;
  showInlineCheckPrompt?: boolean;
  onSelectTextToStudy: (selectedText: string) => void;
  onClearSelectionScope: () => void;
  onJumpToReader?: (quote?: string, locator?: ExactSearchHitLocation) => void;
  onTriggerInlineCheck?: () => void;
}

export const OriginalSourcePane: React.FC<OriginalSourcePaneProps> = ({
  documentTitle,
  passageText,
  activeSelection,
  activeAnchor,
  currentLocator,
  showInlineCheckPrompt = false,
  onSelectTextToStudy,
  onClearSelectionScope,
  onJumpToReader,
  onTriggerInlineCheck,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pendingSelection, setPendingSelection] = useState<string>("");

  const handleMouseUp = useCallback(() => {
    if (typeof window === "undefined" || !window.getSelection) return;
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel.length >= 6) {
      setPendingSelection(sel);
    } else {
      setPendingSelection("");
    }
  }, []);

  const displayedText = activeSelection?.trim() ? activeSelection : passageText;

  // Render passage with active anchor quote highlighted cleanly (no dangerouslySetInnerHTML)
  const renderedSegments = useMemo(() => {
    if (!displayedText) return null;
    const quote = activeAnchor?.quote?.trim();
    if (!quote) {
      return <span>{displayedText}</span>;
    }
    const lowerText = displayedText.toLowerCase();
    const lowerQuote = quote.toLowerCase();
    const idx = lowerText.indexOf(lowerQuote);
    if (idx < 0) {
      return <span>{displayedText}</span>;
    }
    const before = displayedText.slice(0, idx);
    const match = displayedText.slice(idx, idx + quote.length);
    const after = displayedText.slice(idx + quote.length);
    return (
      <>
        <span>{before}</span>
        <mark
          data-testid="study-source-active-highlight"
          className="rounded px-0.5 bg-primary/20 text-foreground ring-1 ring-primary/40"
        >
          {match}
        </mark>
        <span>{after}</span>
      </>
    );
  }, [activeAnchor?.quote, displayedText]);

  const locationSummary = useMemo(() => {
    if (activeAnchor) return formatAnchorLocationLabel(activeAnchor);
    if (currentLocator) {
      return formatAnchorLocationLabel({
        sourceId: "",
        sourceRevision: "",
        locator: currentLocator,
      });
    }
    return "Full Passage";
  }, [activeAnchor, currentLocator]);

  return (
    <section
      aria-label="Original Source"
      className="flex flex-col h-full min-w-0 bg-background text-foreground"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-card/60 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold truncate">{documentTitle}</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {locationSummary}
          </span>
          {activeSelection && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-primary/15 text-primary shrink-0">
              Selection Scope
              <button
                type="button"
                onClick={onClearSelectionScope}
                aria-label="Return to full passage"
                className="hover:opacity-80"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pendingSelection && (
            <button
              type="button"
              onClick={() => {
                onSelectTextToStudy(pendingSelection);
                setPendingSelection("");
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              <HighlighterCircle className="w-3.5 h-3.5" aria-hidden="true" />
              Study this
            </button>
          )}
          {onJumpToReader && (
            <button
              type="button"
              onClick={() => onJumpToReader(activeAnchor?.quote, activeAnchor?.locator ?? currentLocator ?? undefined)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowSquareOut className="w-3.5 h-3.5" aria-hidden="true" />
              Focus in Reader
            </button>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        onKeyUp={handleMouseUp}
        className="flex-1 overflow-y-auto px-5 py-4"
      >
        {activeAnchor?.quote && (
          <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground">
            <span className="font-medium text-primary mr-1.5">Anchored citation:</span>
            <span className="italic">&ldquo;{activeAnchor.quote}&rdquo;</span>
          </div>
        )}
        <article className="max-w-prose mx-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground select-text">
          {renderedSegments ?? (
            <p className="text-xs text-muted-foreground">
              No extractable passage text available for this scope. You can still inspect the source in the reader.
            </p>
          )}
        </article>
        {showInlineCheckPrompt && onTriggerInlineCheck && displayedText.length > 0 && (
          <div
            data-testid="inline-knowledge-check-prompt"
            className="max-w-prose mx-auto mt-5 rounded-lg border border-border bg-card/70 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">
              Optional check-in: ready to verify your understanding of this passage?
            </span>
            <button
              type="button"
              onClick={onTriggerInlineCheck}
              className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
            >
              Quick Check
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
