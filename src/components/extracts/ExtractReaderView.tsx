import React, { useMemo } from "react";
import { ArrowLeft, ArrowSquareOut, Queue, SpinnerGap } from "@phosphor-icons/react";
import type { Extract } from "../../api/extracts";
import type { ExtractSourceContext } from "../../types/extractNavigation";
import { RichContentRenderer } from "../common/RichContentRenderer";
import { useI18n } from "../../lib/i18n";

export interface ExtractReaderViewProps {
  extract: Extract;
  sourceContext?: ExtractSourceContext;
  documentId?: string;
  documentTitle?: string;
  sourceKind?: "book" | "article" | "source";
  sourceAvailable?: boolean | null;
  onReturnToSource?: () => void;
  onResumeQueue?: () => void;
  rating?: "idle" | "submitting" | "done";
  onRate?: (value: number) => void;
  nextReviewDate?: string | null;
  className?: string;
}

const RATING_VALUES = [1, 2, 3, 4] as const;

export function ExtractReaderView({
  extract,
  sourceContext,
  documentId,
  documentTitle,
  sourceKind,
  sourceAvailable = true,
  onReturnToSource,
  onResumeQueue,
  rating = "idle",
  onRate,
  nextReviewDate,
  className = "",
}: ExtractReaderViewProps) {
  const { t } = useI18n();

  const effectiveKind = useMemo(() => {
    if (sourceContext?.sourceKind) return sourceContext.sourceKind;
    if (sourceKind) return sourceKind;
    return "source";
  }, [sourceContext?.sourceKind, sourceKind]);

  const returnToSourceLabel = useMemo(() => {
    switch (effectiveKind) {
      case "book":
        return t("extractReader.backToBook", { defaultValue: "Back to book" });
      case "article":
        return t("extractReader.backToArticle", { defaultValue: "Back to article" });
      default:
        return t("extractReader.backToSource", { defaultValue: "Back to source" });
    }
  }, [effectiveKind, t]);

  const effectiveTitle = useMemo(
    () =>
      sourceContext?.sourceTitle ??
      documentTitle ??
      extract.page_title ??
      extract.source_url ??
      t("extractReader.document", { defaultValue: "Document" }),
    [sourceContext?.sourceTitle, documentTitle, extract.page_title, extract.source_url, t]
  );

  const canReturnToSource = Boolean(
    onReturnToSource && (sourceAvailable !== false) && (documentId || sourceContext?.documentId)
  );

  return (
    <div className={`space-y-6 ${className}`} data-testid="extract-reader-view">
      {/* Header & Navigation Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-border">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            {t("extractReader.fromDocument", { defaultValue: "From Document" })}
          </p>
          <h2 className="text-xl font-semibold text-foreground line-clamp-2 break-words">
            {effectiveTitle}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onReturnToSource && (
            <button
              type="button"
              data-testid="return-to-source-btn"
              onClick={onReturnToSource}
              disabled={!canReturnToSource}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              title={
                !canReturnToSource
                  ? t("extractReader.sourceUnavailable", { defaultValue: "Source document is unavailable" })
                  : returnToSourceLabel
              }
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{returnToSourceLabel}</span>
            </button>
          )}

          {onResumeQueue && (
            <button
              type="button"
              data-testid="resume-queue-btn"
              onClick={onResumeQueue}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
              title={t("extractReader.resumeQueue", { defaultValue: "Resume queue" })}
            >
              <Queue className="w-4 h-4" />
              <span>{t("extractReader.resumeQueue", { defaultValue: "Resume queue" })}</span>
            </button>
          )}
        </div>
      </div>

      {sourceAvailable === false && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {t("extractReader.sourceUnavailable", { defaultValue: "Source document is unavailable or was removed." })}
        </p>
      )}

      {/* Extract Content */}
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <RichContentRenderer
          content={extract.content}
          htmlContent={extract.html_content}
          sourceUrl={extract.source_url}
          mode="full"
          maxHeight="70vh"
        />
      </div>

      {/* Rating Controls (Incremental Reading / SRS) */}
      {onRate && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border pt-4">
          <div>
            {rating === "done" && nextReviewDate ? (
              <p className="text-sm text-muted-foreground">
                {t("extractReader.nextReview", {
                  date: new Date(nextReviewDate).toLocaleDateString(),
                  defaultValue: `Next review: ${new Date(nextReviewDate).toLocaleDateString()}`,
                })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("extractReader.rate", { defaultValue: "Rate this extract:" })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {RATING_VALUES.map((value) => {
              const labels: Record<number, string> = {
                1: t("review.again", { defaultValue: "Again" }),
                2: t("review.hard", { defaultValue: "Hard" }),
                3: t("review.good", { defaultValue: "Good" }),
                4: t("review.easy", { defaultValue: "Easy" }),
              };
              const colors: Record<number, string> = {
                1: "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20",
                2: "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
                3: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20",
                4: "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20",
              };
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onRate(value)}
                  disabled={rating !== "idle"}
                  className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${colors[value]}`}
                >
                  {labels[value]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
