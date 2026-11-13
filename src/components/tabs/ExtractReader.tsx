import { emitUserInteraction, emitInteractionFeedback, createFeedbackInteractionId } from "../../lib/feedback/orchestrator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextT, SpinnerGap, ListBullets } from "@phosphor-icons/react";
import { getExtract, type Extract } from "../../api/extracts";
import { submitExtractReview } from "../../api/extract-review";
import { getDocument } from "../../api/documents";
import { useQueueStore, useTabsStore } from "../../stores";
import { usePaneId } from "../common/Tabs";
import { useToast } from "../common/Toast";
import { useI18n } from "../../lib/i18n";
import { DocumentViewer, QueueTab } from "./TabRegistry";
import { ExtractReaderView } from "../extracts/ExtractReaderView";
import type { ExtractSourceContext } from "../../types/extractNavigation";

interface ExtractReaderProps {
  extractId?: string;
  documentId?: string;
  documentTitle?: string;
  sourceContext?: ExtractSourceContext;
  sourceKind?: "book" | "article" | "source";
  onReturnToSource?: () => void;
  onResumeQueue?: () => void;
}

/**
 * Extract reading surface: presents an extract's own text as the subject,
 * independent of its source document. Opened from the queue for `extract`
 * items; "Return to Source" jumps back into the document viewer at the
 * extract's card (focusedExtractId path), and "Resume queue" returns to the queue.
 */
export function ExtractReader({
  extractId,
  documentId,
  documentTitle,
  sourceContext,
  sourceKind: propSourceKind,
  onReturnToSource,
  onResumeQueue,
}: ExtractReaderProps) {
  const { t } = useI18n();
  const toast = useToast();
  const addTab = useTabsStore((state) => state.addTab);
  const paneId = usePaneId();

  const [extract, setExtract] = useState<Extract | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceAvailable, setSourceAvailable] = useState<boolean | null>(null);
  const [sourceKind, setSourceKind] = useState<"book" | "article" | "source" | undefined>(
    propSourceKind ?? sourceContext?.sourceKind
  );
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

  // Determine whether the source document is still loadable and its kind.
  useEffect(() => {
    const docId = documentId ?? sourceContext?.documentId;
    if (!docId) {
      setSourceAvailable(false);
      return;
    }
    let cancelled = false;
    setSourceAvailable(null);
    void getDocument(docId)
      .then((doc) => {
        if (cancelled) return;
        setSourceAvailable(doc !== null);
        if (doc && !sourceContext?.sourceKind && !propSourceKind) {
          if (doc.fileType === "epub" || doc.fileType === "pdf") {
            setSourceKind("book");
          } else if (doc.fileType === "html" || doc.fileType === "markdown" || doc.metadata?.url) {
            setSourceKind("article");
          } else {
            setSourceKind("source");
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSourceAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, sourceContext?.documentId, sourceContext?.sourceKind, propSourceKind]);

  const effectiveDocId = documentId ?? sourceContext?.documentId;

  const openSourceDocument = useCallback(() => {
    if (!effectiveDocId || !sourceAvailable) return;
    addTab(
      {
        title: documentTitle ?? sourceContext?.sourceTitle ?? t("extractReader.document"),
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "document-viewer",
        content: DocumentViewer,
        closable: true,
        data: {
          documentId: effectiveDocId,
          focusedExtractId: extractId,
        },
      },
      paneId,
    );
    emitUserInteraction("navigation.destination-opened");
  }, [addTab, effectiveDocId, documentTitle, sourceContext?.sourceTitle, extractId, paneId, sourceAvailable, t]);

  const resumeQueue = useCallback(() => {
    if (onResumeQueue) {
      onResumeQueue();
      return;
    }
    const tabs = useTabsStore.getState().tabs;
    const queueTab = tabs.find((t) => t.type === "queue" || t.type === "queue-scroll");
    if (queueTab) {
      const pane = useTabsStore.getState().findPaneContainingTab(queueTab.id);
      if (pane) {
        useTabsStore.getState().setActiveTab(pane.id, queueTab.id);
      }
    } else {
      addTab(
        {
          title: "Queue",
          icon: <ListBullets className="w-4 h-4 text-muted-foreground" />,
          type: "queue",
          content: QueueTab,
          closable: true,
        },
        paneId
      );
    }
    emitUserInteraction("navigation.destination-opened");
  }, [onResumeQueue, addTab, paneId]);

  const rate = useCallback(
    async (value: number) => {
      if (!extractId || !extract || rating !== "idle") return;
      setRating("submitting");
      try {
        const timeTaken = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
        const updated = await submitExtractReview(extractId, value, timeTaken);
        emitInteractionFeedback("review.card-graded", { rating: value }, { interactionId: createFeedbackInteractionId(), origin: "user" });
        setExtract(updated);
        setNextReviewDate(updated.next_review_date ?? null);
        setRating("done");
        useQueueStore.getState().applyItemDelta(extractId, {
          dueDate: updated.next_review_date ?? undefined,
          reps: updated.reps,
        });
        toast.success(t("extractReader.ratingSubmitted"));
      } catch (err) {
        emitUserInteraction("action.failed");
        setRating("idle");
        toast.error(t("extractReader.ratingFailed"), err instanceof Error ? err.message : undefined);
      }
    },
    [extract, extractId, rating, t, toast],
  );

  const sourceTitle = useMemo(
    () => sourceContext?.sourceTitle ?? documentTitle ?? extract?.page_title ?? extract?.source_url ?? t("extractReader.document"),
    [sourceContext?.sourceTitle, documentTitle, extract, t],
  );

  return (
    <div className="h-full w-full overflow-y-auto bg-background" data-paper-surface="reading">
      <div className="mx-auto max-w-3xl px-6 py-8">
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
          <ExtractReaderView
            extract={extract}
            sourceContext={sourceContext}
            documentId={effectiveDocId}
            documentTitle={sourceTitle}
            sourceKind={sourceKind}
            sourceAvailable={sourceAvailable}
            onReturnToSource={onReturnToSource ?? openSourceDocument}
            onResumeQueue={resumeQueue}
            rating={rating}
            onRate={rate}
            nextReviewDate={nextReviewDate}
          />
        )}
      </div>
    </div>
  );
}
