import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useReviewStore } from "../../stores/reviewStore";
import { ReviewHome } from "../../components/review/ReviewHome";
import { ReviewSession } from "../../components/review/ReviewSession";
import { DeckManager } from "../../components/review/DeckManager";

export function ReviewTab() {
  const {
    loadQueue,
    resetSession,
    queue,
    currentCard,
    reviewTabMode,
    reviewsCompleted,
    setReviewTabMode
  } = useReviewStore(
    useShallow((state) => ({
      loadQueue: state.loadQueue,
      resetSession: state.resetSession,
      queue: state.queue,
      currentCard: state.currentCard,
      reviewTabMode: state.reviewTabMode,
      reviewsCompleted: state.reviewsCompleted,
      setReviewTabMode: state.setReviewTabMode,
    }))
  );

  const handleStartReview = async () => {
    await loadQueue();
    const { queue: nextQueue } = useReviewStore.getState();
    if (nextQueue.length > 0) {
      setReviewTabMode("session");
    }
  };

  const handleExit = () => {
    resetSession();
    setReviewTabMode("home");
  };

  useEffect(() => {
    if (queue.length > 0 && currentCard) {
      setReviewTabMode("session");
    } else if (queue.length === 0 && reviewTabMode === "session" && reviewsCompleted === 0) {
      setReviewTabMode("home");
    }
  }, [queue.length, currentCard, reviewTabMode, reviewsCompleted, setReviewTabMode]);

  useEffect(() => {
    return () => {
      // Responsive shell changes can remount the active tab at the desktop /
      // mobile boundary. A pending Arena grade is deliberately transactional,
      // so preserve it across that remount instead of silently discarding the
      // user's recall decision. Explicit exits still go through handleExit.
      if (!useReviewStore.getState().pendingArenaReview) {
        resetSession();
      }
    };
  }, [resetSession]);

  useEffect(() => {
    const handleOpenFlashcard = () => setReviewTabMode("deck-manager");
    window.addEventListener("plethora:open-flashcard", handleOpenFlashcard);
    if (sessionStorage.getItem("plethora:pending-flashcard-id")) {
      setReviewTabMode("deck-manager");
    }
    return () => window.removeEventListener("plethora:open-flashcard", handleOpenFlashcard);
  }, [setReviewTabMode]);

  if (reviewTabMode === "session") {
    return <ReviewSession onExit={handleExit} />;
  }

  if (reviewTabMode === "deck-manager") {
    return <DeckManager onBack={() => setReviewTabMode("home")} onStartReview={handleStartReview} />;
  }

  return (
    <ReviewHome
      onStartReview={handleStartReview}
      onOpenDeckManager={() => setReviewTabMode("deck-manager")}
    />
  );
}
