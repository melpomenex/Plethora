import { ReviewQueueView } from "../components/review/ReviewQueueView";
import { useReviewStore, useTabsStore } from "../stores";
import { DocumentViewer, ExtractReader, ReviewTab } from "../components/tabs/TabRegistry";
import type { QueueItem } from "../types/queue";
import { QueueScrollPage } from "./QueueScrollPage";
import type { SessionItemTypes } from "../utils/reviewUx";
import { Brain, Stack, TextT } from "@phosphor-icons/react";
import { useI18n } from "../lib/i18n";

export function QueuePage() {
  const { t } = useI18n();
  const { addTab } = useTabsStore();

  const handleStartReview = (itemId?: string, queueItemIds?: string[]) => {
    const reviewStore = useReviewStore.getState();
    if (queueItemIds?.length) {
      void reviewStore.startReviewWithQueue(queueItemIds);
    } else if (itemId) {
      void reviewStore.startReviewAtItem(itemId);
    }
    addTab({
      title: t("review.title"),
      icon: <Brain className="w-4 h-4" />,
      type: "review",
      content: ReviewTab,
      closable: true,
    });
  };

  const handleOpenDocument = (item: QueueItem) => {
    if (item.itemType === "extract" && item.extractId) {
      addTab({
        title: item.documentTitle,
        icon: <TextT className="w-4 h-4 text-muted-foreground" />,
        type: "extract-reader",
        content: ExtractReader,
        closable: true,
        data: {
          extractId: item.extractId,
          documentId: item.documentId,
          documentTitle: item.documentTitle,
        },
      });
      return;
    }
    addTab({
      title: item.documentTitle,
      icon: <TextT className="w-4 h-4 text-muted-foreground" />,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: { documentId: item.documentId },
    });
  };

  const handleOpenScrollMode = (options?: {
    items?: QueueItem[];
    mode?: "queue-list" | "optimal";
    itemTypes?: SessionItemTypes;
  }) => {
    addTab({
      title: t("queue.scrollMode"),
      icon: <Stack className="w-4 h-4" />,
      type: "queue-scroll",
      content: QueueScrollPage,
      closable: true,
      data: {
        customQueueItems: options?.items,
        queueScrollMode: options?.mode ?? "queue-list",
        itemTypes: options?.itemTypes,
      },
    });
  };

  return (
    <ReviewQueueView
      onStartReview={handleStartReview}
      onOpenDocument={handleOpenDocument}
      onOpenScrollMode={handleOpenScrollMode}
    />
  );
}
