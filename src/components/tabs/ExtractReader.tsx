import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, TextT, SpinnerGap } from "@phosphor-icons/react";
import { getExtract, type Extract } from "../../api/extracts";
import { submitExtractReview } from "../../api/extract-review";
import { getDocument } from "../../api/documents";
import { useQueueStore, useTabsStore } from "../../stores";
import { usePaneId } from "../common/Tabs";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { DocumentViewer } from "./TabRegistry";
import { RichContentRenderer } from "../common/RichContentRenderer";

interface ExtractReaderProps {
  extractId?: string;
  documentId?: string;
  documentTitle?: string;
}

const RATING_VALUES = [1, 2, 3, 4] as const;

/**
 * Extract reading surface: presents an extract's own text as the subject,
 * independent of its source document. Opened from the queue for `extract`
 * items; "Open source document" jumps back into the document viewer at the
 * extract's card (focusedExtractId path).
 */
export function ExtractReader({ extractId, documentId, documentTitle }: ExtractReaderProps) {
  const { t } = useI18n();
  const toast = useToast();
  const addTab = useTabsStore((state) => state.addTab);
  const paneId = usePaneId();

  const [extract, setExtract] = useState<Extract | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceAvailable, setSourceAvailable] = useState<boolean | null>(null);
  const [rating, setRating] = useState<"idle" | "submitting" | "done">("idle");
  const [nextReviewDate, setNextReviewDate] = useState<string | null>(null);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    if (!extractId) {
      setLoading(false);
      setLoadError(t("extractReader.notFound"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setExtract(null);
    startTimeRef.current = Date.now();
    void getExtract(extractId)
      .then((result) => {
        if (cancelled) return;
        setExtract(result);
        if (!result) setLoadError(t("extractReader.notFound"));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : t("extractReader.notFound"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [extractId, t]);

  // Determine whether the source document is still loadable. When it is not,
  // "Open source document" is disabled with an explanation (spec: source
  // document is missing → extract still displays, action disabled).
  useEffect(() => {
    if (!documentId) {
      setSourceAvailable(false);
      return;
    }
    let cancelled = false;
    setSourceAvailable(null);
    void getDocument(documentId)
      .then((doc) => {
        if (cancelled) return;
        setSourceAvailable(doc !== null);
      })
      .catch(() => {
        if (cancelled) return;
        setSourceAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const openSourceDocument = useCallback(() => {
    if (!documentId || !sourceAvailable) return;
    addTab(
      {
        title: documentTitle ?? t("extractReader.document"),
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: {
          documentId,
          focusedExtractId: extractId,
        },
      },
      paneId,
    );
  }, [addTab, documentId, documentTitle, extractId, paneId, sourceAvailable, t]);

  const rate = useCallback(
    async (value: number) => {
      if (!extractId || !extract || rating !== "idle") return;
      setRating("submitting");
      try {
        const timeTaken = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        const updated = await submitExtractReview(extractId, value, timeTaken);
        setExtract(updated);
        setNextReviewDate(updated.next_review_date ?? null);
        setRating("done");
        // Queue reflects the new schedule without a full reload: extract queue
        // items carry the extract id as their own id, so a single local delta
        // keeps the queue tab in sync.
        useQueueStore.getState().applyItemDelta(extractId, {
          dueDate: updated.next_review_date ?? undefined,
          reps: updated.reps,
        });
        toast.success(t("extractReader.ratingSubmitted"));
      } catch (err) {
        setRating("idle");
        toast.error(t("extractReader.ratingFailed"), err instanceof Error ? err.message : undefined);
      }
    },
    [extract, extractId, rating, t, toast],
  );

  const sourceTitle = useMemo(
    () => documentTitle ?? extract?.page_title ?? extract?.source_url ?? t("extractReader.document"),
    [documentTitle, extract, t],
  );

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Header: source title + open-source action */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
              {t("extractReader.fromDocument")}
            </p>
            <h2 className="text-xl font-semibold text-foreground line-clamp-2 break-words">
              {sourceTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={openSourceDocument}
            disabled={!documentId || sourceAvailable !== true}
            className="shrink-0 inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title={documentId && sourceAvailable === false ? t("extractReader.sourceUnavailable") : undefined}
          >
            <ArrowSquareOut className="w-4 h-4" />
            {t("extractReader.openSourceDocument")}
          </button>
        </div>

        {sourceAvailable === false && (
          <p className="mb-4 text-sm text-amber-600 dark:text-amber-400">
            {t("extractReader.sourceUnavailable")}
          </p>
        )}

        {/* Content */}
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <SpinnerGap className="w-5 h-5 animate-spin" />
            <span className="ml-2 text-sm">{t("extractReader.loading")}</span>
          </div>
        )}

        {!loading && loadError && (
          <div className="py-16 text-center">
            <p className="text-sm text-destructive">{loadError}</p>
          </div>
        )}

        {!loading && !loadError && extract && (
          <div className="rounded-lg border border-border bg-card p-6">
            <RichContentRenderer
              content={extract.content}
              htmlContent={extract.html_content}
              sourceUrl={extract.source_url}
              mode="full"
              maxHeight="70vh"
            />
          </div>
        )}

        {/* Rating controls */}
        {!loading && !loadError && extract && (
          <div className="mt-6 flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              {rating === "done" && nextReviewDate ? (
                <p className="text-sm text-muted-foreground">
                  {t("extractReader.nextReview", { date: new Date(nextReviewDate).toLocaleDateString() })}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("extractReader.rate")}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {RATING_VALUES.map((value) => {
                const labels: Record<number, string> = {
                  1: t("review.again"),
                  2: t("review.hard"),
                  3: t("review.good"),
                  4: t("review.easy"),
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
                    onClick={() => void rate(value)}
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
    </div>
  );
}
