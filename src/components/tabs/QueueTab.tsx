import { ReviewQueueView } from "../review/ReviewQueueView";
import { MobileQueueView } from "../mobile/MobileQueueView";
import { useReviewStore, useTabsStore } from "../../stores";
import type { QueueItem } from "../../types/queue";
import { ReviewTab, DocumentViewer, ExtractReader } from "./TabRegistry";
import { QueueScrollPage } from "../../pages/QueueScrollPage";
import { usePaneId } from "../common/Tabs";
import { useMobileShell } from "../../hooks/useMobileShell";
import { Brain, Stack, TextT } from "@phosphor-icons/react";

export function QueueTab() {
  const addTab = useTabsStore((state) => state.addTab);
  const paneId = usePaneId();
  const isMobile = useMobileShell();

  const handleStartReview = (itemId?: string, queueItemIds?: string[]) => {
    const reviewStore = useReviewStore.getState();
    if (queueItemIds?.length) {
      void reviewStore.startReviewWithQueue(queueItemIds);
    } else if (itemId) {
      void reviewStore.startReviewAtItem(itemId);
    }
    addTab({
      title: "Review",
      icon: <Brain className="w-4 h-4" />,
      type: "review",
      content: ReviewTab,
      closable: true,
    }, paneId);
  };

  const handleOpenDocument = (item: QueueItem) => {
    // Extracts are readable as items in their own right: route the queue's
    // primary action to the extract reader. "Open source document" remains
    // available from inside the reader.
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
      }, paneId);
      return;
    }
    addTab({
      title: item.documentTitle,
      icon: <TextT className="w-4 h-4 text-muted-foreground" />,
      type: "document-viewer",
      content: DocumentViewer,
      closable: true,
      data: {
        documentId: item.documentId,
        ...(item.extractId ? { focusedExtractId: item.extractId } : {}),
      },
    }, paneId);
  };

  const handleOpenScrollMode = (options?: { items?: QueueItem[]; mode?: "queue-list" | "optimal" }) => {
    addTab({
      title: "Scroll Mode",
      icon: <Stack className="w-4 h-4" />,
      type: "queue-scroll",
      content: QueueScrollPage,
      closable: true,
      data: {
        customQueueItems: options?.items,
        queueScrollMode: options?.mode ?? "queue-list",
      },
    }, paneId);
  };

  // Use mobile-optimized view on mobile devices
  if (isMobile) {
    return (
      <MobileQueueView
        onStartReview={handleStartReview}
        onOpenDocument={handleOpenDocument}
        onOpenScrollMode={handleOpenScrollMode}
      />
    );
  }

  return (
    <ReviewQueueView
      onStartReview={handleStartReview}
      onOpenDocument={handleOpenDocument}
      onOpenScrollMode={handleOpenScrollMode}
    />
  );
}
