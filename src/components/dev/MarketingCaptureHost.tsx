import { useEffect } from "react";
import { ListChecks, SquaresFour, TextT } from "@phosphor-icons/react";
import { marketingCaptureSurface, MARKETING_CARDS, MARKETING_DOCUMENTS } from "../../lib/marketingCapture/seed";
import { useStartupExperienceStore } from "../../lib/startupAnimation/store";
import { useDocumentStore } from "../../stores/documentStore";
import { useReviewStore } from "../../stores/reviewStore";
import { useTabsStore } from "../../stores/tabsStore";
import { DocumentViewer, DocumentsTab, ReviewTab } from "../tabs/TabRegistry";

/**
 * DEV-only: seed the PWA with the memory/sleep demo library and open a
 * named surface for Playwright marketing captures.
 */
export function MarketingCaptureHost() {
  const surface = marketingCaptureSurface();

  useEffect(() => {
    if (!surface) return;
    let cancelled = false;

    const run = async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      if (cancelled) return;

      useDocumentStore.getState().setDocuments(MARKETING_DOCUMENTS);
      useDocumentStore.getState().setCurrentDocument(MARKETING_DOCUMENTS[0]);

      const card = MARKETING_CARDS[0];
      const showAnswer = surface === "explain" || surface === "review";
      useReviewStore.setState({
        queue: MARKETING_CARDS,
        currentIndex: 0,
        currentCard: card,
        isAnswerShown: showAnswer,
        reviewPhase: showAnswer ? "answer" : "question",
        isLoading: false,
        error: null,
        reviewTabMode: "session",
        reviewsCompleted: 1,
        sessionStartTime: Date.now(),
      });

      useStartupExperienceStore.getState().setStage("done");
      document.querySelector(".kp-overlay")?.remove();
      document.getElementById("boot-frame")?.remove();

      const addTab = useTabsStore.getState().addTab;
      const openReader = surface === "reader" || surface === "eink-reader";
      if (openReader) {
        addTab({
          title: MARKETING_DOCUMENTS[0].title,
          icon: <TextT className="w-4 h-4" />,
          type: "document-viewer",
          content: DocumentViewer,
          closable: true,
          data: { documentId: MARKETING_DOCUMENTS[0].id, openedFrom: "documents" },
        });
      } else if (surface === "card" || surface === "explain" || surface === "review") {
        addTab({
          title: "Review",
          icon: <ListChecks className="w-4 h-4" />,
          type: "review",
          content: ReviewTab,
          closable: true,
        });
      } else {
        addTab({
          title: "Documents",
          icon: <SquaresFour className="w-4 h-4" />,
          type: "documents",
          content: DocumentsTab,
          closable: true,
        });
      }

      document.body.setAttribute("data-marketing-surface", surface);
      document.body.setAttribute("data-marketing-ready", "1");
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [surface]);

  if (!surface) return null;
  return (
    <span className="sr-only" data-marketing-capture={surface}>
      Marketing capture: {surface}
    </span>
  );
}
