import { useEffect } from "react";
import { Brain, CirclesThreePlus, SquaresFour, TextT } from "@phosphor-icons/react";
import { resolveMarketingSceneApplication } from "../../lib/marketingCapture/sceneApplicators";
import { waitForMarketingReadiness } from "../../lib/marketingCapture/readiness";
import { useStartupExperienceStore } from "../../lib/startupAnimation/store";
import { useDocumentStore } from "../../stores/documentStore";
import { useReviewStore } from "../../stores/reviewStore";
import { useTabsStore, type Tab } from "../../stores/tabsStore";
import {
  DocumentViewer,
  DocumentsTab,
  KnowledgeNetworkTab,
  ReviewTab,
} from "../tabs/TabRegistry";

async function positionSceneForCapture(sceneId: string, layout: string): Promise<void> {
  if (sceneId !== "review.answer" || layout !== "mobile") return;
  const deadline = performance.now() + 5_000;
  let control: HTMLElement | null = null;
  while (performance.now() < deadline) {
    control = document.querySelector<HTMLElement>('[data-showcase-action="grade-good"]');
    if (control?.getBoundingClientRect().height) break;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  }
  if (!control) throw new Error("Unable to position mobile review grading controls");

  for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const overflowY = getComputedStyle(ancestor).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      ancestor.style.setProperty("scroll-behavior", "auto", "important");
    }
  }
  control.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function captureTab(application: ReturnType<typeof resolveMarketingSceneApplication>): Tab {
  const base = { id: `marketing-capture-${application.sceneId}`, closable: true } as const;
  if (application.surface === "library") {
    return { ...base, title: "Library", icon: <SquaresFour className="h-4 w-4" />, type: "documents", content: DocumentsTab };
  }
  if (application.surface === "review") {
    return { ...base, title: "Review", icon: <Brain className="h-4 w-4" />, type: "review", content: ReviewTab };
  }
  if (application.surface === "connections") {
    return {
      ...base,
      title: "Connections",
      icon: <CirclesThreePlus className="h-4 w-4" />,
      type: "knowledge-network",
      content: KnowledgeNetworkTab,
      data: { captureConnection: application.connectionContext },
    };
  }
  return {
    ...base,
    title: "Why highlighting feels like learning",
    icon: <TextT className="h-4 w-4" />,
    type: "document-viewer",
    content: DocumentViewer,
    data: {
      documentId: application.currentDocumentId,
      openedFrom: "documents",
      captureReader: application.reader,
      captureCardPreview: application.cardPreview,
    },
  };
}

/**
 * Applies ephemeral route/reader/review state after the compiled fixture has
 * been committed. Entity data is queried through normal app stores first;
 * this host never substitutes in-memory records for persistence.
 */
export function MarketingCaptureHost() {
  const bootstrap = globalThis.__PLETHORA_MARKETING_CAPTURE__;
  const sceneId = bootstrap?.request.sceneId;

  useEffect(() => {
    if (!bootstrap || !sceneId) return;
    let cancelled = false;
    const run = async () => {
      const application = resolveMarketingSceneApplication(sceneId);
      if (!application.captureSupported) {
        throw new Error(`${sceneId} is catalogued but omitted: no deterministic real-UI injection path exists`);
      }

      await useDocumentStore.getState().loadDocuments();
      if (cancelled) return;
      const persistedDocuments = useDocumentStore.getState().documents;
      if (persistedDocuments.length !== bootstrap.counts.documents) {
        throw new Error(`Product document query returned ${persistedDocuments.length} records`);
      }
      if (application.currentDocumentId) {
        const hydrated = await useDocumentStore.getState().hydrateDocument(application.currentDocumentId);
        if (!hydrated) throw new Error(`Unable to hydrate capture document ${application.currentDocumentId}`);
        useDocumentStore.getState().setCurrentDocument(hydrated);
      }

      if (application.review) {
        await useReviewStore.getState().loadQueue();
        if (cancelled) return;
        const queue = useReviewStore.getState().queue;
        const selected = queue.find((item) => item.id === application.review?.learningItemId);
        if (!selected) throw new Error(`Review item ${application.review.learningItemId} is not queryable as due`);
        const isScheduled = application.review.phase === "scheduled";
        useReviewStore.setState({
          queue: isScheduled ? [] : [selected, ...queue.filter((item) => item.id !== selected.id)],
          currentIndex: 0,
          currentCard: isScheduled ? null : selected,
          isAnswerShown: application.review.phase !== "question",
          reviewPhase: application.review.phase === "question" ? "question" : "answer",
          reviewTabMode: "session",
          reviewsCompleted: isScheduled ? 1 : 0,
          correctCount: isScheduled ? 1 : 0,
          sessionStartTime: Date.now(),
          lastReviewOutcome: isScheduled ? {
            itemId: selected.id,
            rating: application.review.rating ?? 3,
            intervalDays: application.review.scheduledDays ?? selected.interval,
            dueDate: "2026-08-26T12:00:00.000Z",
          } : null,
          isLoading: false,
          error: null,
        });
        if (!isScheduled) await useReviewStore.getState().loadPreviewIntervals();
      }

      useStartupExperienceStore.getState().setStage("done");
      document.getElementById("boot-frame")?.remove();
      const tab = captureTab(application);
      useTabsStore.setState({
        tabs: [tab],
        rootPane: { id: "marketing-capture-pane", type: "tabs", tabIds: [tab.id], activeTabId: tab.id },
        closedTabs: [],
        activeTabHistory: [tab.id],
        forwardTabHistory: [],
        evictedTabIds: new Set<string>(),
      });
      globalThis.__PLETHORA_MARKETING_SCENE__ = application;
      document.body.dataset.marketingStateApplied = "true";
      document.body.dataset.marketingSurface = application.surface;
      await positionSceneForCapture(sceneId, bootstrap.request.layout);
      await waitForMarketingReadiness(application);
      document.body.dataset.marketingReady = "1";
    };

    void run().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      document.body.dataset.marketingReady = "error";
      document.body.dataset.marketingError = message;
      console.error("[MarketingCaptureHost]", error);
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap, sceneId]);

  if (!bootstrap || !sceneId) return null;
  return (
    <span className="sr-only" data-marketing-capture={sceneId}>
      Marketing capture scene: {sceneId}
    </span>
  );
}
