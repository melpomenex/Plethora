import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowLeft,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
  Upload,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useReviewStore } from "../../stores/reviewStore";
import { ReviewCard } from "./ReviewCard";
import { RatingButtons } from "./RatingButtons";
import { ReviewProgress } from "./ReviewProgress";
import { ReviewComplete } from "./ReviewComplete";
import { ReviewTransparencyPanel } from "./ReviewTransparencyPanel";
import { QueueNavigationControls } from "../queue/QueueNavigationControls";
import { ReviewFeedback } from "./ReviewFeedback";
import { ReviewCardSkeleton } from "../common/Skeleton";
import { useModal } from "../common/Modal";
import { FSRSExplanationModal, useFSRSExplanation } from "../onboarding/FSRSExplanationModal";
import { tourAnchor } from "../onboarding/tour/anchors";
import { useSwipeGesture, getSwipeIndicatorStyle, SWIPE_RATINGS } from "../../hooks/useSwipeGesture";
import {
  SuperMemoRatingControl,
  useIsTouchRating,
} from "./SuperMemoRatingControl";
import {
  gradeToRating,
  useRatingSchema,
  type ReviewRating,
  type SM20NativeGrade,
} from "../../lib/supermemo-grades";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { useAudioReviewMode } from "../../hooks/useAudioReviewMode";
import { useSettingsStore } from "../../stores/settingsStore";
import { handleVolumeRockerNavigation } from "../../utils/volumeRockerNavigation";
import { BreakReminderModal, useBreakReminder } from "./BreakReminderModal";
import { ZenReviewMode } from "./ZenReviewMode";
import { FSRSInspector, useFSRSInspector } from "./FSRSInspector";
import { useToast } from "../common/Toast";
import { bulkDeleteItems, bulkSuspendItems } from "../../api/queue";
import { invokeCommand, openFilePicker } from "../../lib/tauri";
import { importAnkiPackageFromPicker, inferAnkiDeckNames } from "../../utils/ankiImport";
import { useCollectionStore } from "../../stores/collectionStore";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { renderAnkiHtmlWithLatex } from "../../utils/ankiLatex";
import { useI18n } from "../../lib/i18n";
import { setActiveReviewSession } from "../../lib/feedback";
import { AlgorithmArenaDecision } from "./AlgorithmArenaDecision";
import { formatArenaInterval } from "./arenaFormatters";
import { AlgorithmArenaModeControl } from "./AlgorithmArenaModeControl";
import { featureFlags } from "../../lib/featureFlags";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { InlineCardEditor } from "./InlineCardEditor";
import { FlashcardStudioModal } from "./FlashcardStudioModal";
import {
  computeSuggestedRating,
  recordCardAssessment,
  shouldSuggestGrade,
} from "./answerAssessmentIntegration";
import { useCardAnswerAssessment } from "./useCardAnswerAssessment";
import type { LearningItem as EditableCard } from "../../api/learning-items";
import type { ReviewSessionItem } from "../../stores/reviewStore";

interface ReviewSessionProps {
  onExit: () => void;
}

function ensureAnkiStudyDecks(deckNames: string[]): string[] {
  return useStudyDeckStore.getState().ensureDecksExist(deckNames);
}

export function ReviewSession({ onExit }: ReviewSessionProps) {
  const {
    currentCard,
    queue,
    isLoading,
    isAnswerShown,
    isSubmitting,
    error,
    reviewsCompleted,
    correctCount,
    sessionStartTime,
    averageTimePerCard,
    currentIndex,
    streak,
    previewIntervals,
    pendingArenaReview,
    getEstimatedTimeRemaining,
    loadQueue,
    showAnswer,
    submitRating,
    goToIndex,
    patchCurrentCard,
    removeItemFromSession,
    cancelArenaDecision,
  } = useReviewStore(
    // Explicit property selector: a bare useReviewStore() re-renders this
    // component on every unrelated store write (timers, previews, arena state).
    useShallow((state) => ({
      currentCard: state.currentCard,
      queue: state.queue,
      isLoading: state.isLoading,
      isAnswerShown: state.isAnswerShown,
      isSubmitting: state.isSubmitting,
      error: state.error,
      reviewsCompleted: state.reviewsCompleted,
      correctCount: state.correctCount,
      sessionStartTime: state.sessionStartTime,
      averageTimePerCard: state.averageTimePerCard,
      currentIndex: state.currentIndex,
      streak: state.streak,
      previewIntervals: state.previewIntervals,
      pendingArenaReview: state.pendingArenaReview,
      getEstimatedTimeRemaining: state.getEstimatedTimeRemaining,
      loadQueue: state.loadQueue,
      showAnswer: state.showAnswer,
      submitRating: state.submitRating,
      goToIndex: state.goToIndex,
      patchCurrentCard: state.patchCurrentCard,
      removeItemFromSession: state.removeItemFromSession,
      cancelArenaDecision: state.cancelArenaDecision,
    }))
  );
  const [isQueueListOpen, setIsQueueListOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [studioSeed, setStudioSeed] = useState<{
    key: string;
    documentId?: string | null;
    excerpt?: string;
    resetDraftCards?: boolean;
  } | null>(null);
  const queueListRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [interactionResult, setInteractionResult] = useState<{
    interactionType: "multiple-choice" | "image-occlusion";
    correct?: boolean;
    selectedOptionId?: string;
    selectedOptionText?: string;
  } | null>(null);
  // Free-response assessment of the current card (Phase 4, task 5.8):
  // captured on reveal, persisted AFTER grading via a separate invoke —
  // the submitReview path is identical whether or not this is set.
  const cardAssessment = useCardAnswerAssessment({
    card: currentCard,
    showAnswer: isAnswerShown,
  });
  const aiAutoGradeSuggest = useSettingsStore(
    (state) => state.settings.features.aiAutoGradeSuggest
  );
  const { t, locale } = useI18n();
  const modal = useModal();
  const requestExit = async () => {
    if (useReviewStore.getState().pendingArenaReview) {
      // window.confirm() is suppressed in the desktop WebView and returns
      // false, so this always aborted the exit instead of asking.
      const discard = await modal.confirm(t("algorithmArena.discardConfirm"));
      if (!discard) return;
      useReviewStore.getState().cancelArenaDecision();
    }
    onExit();
  };

  useEffect(() => {
    if (!pendingArenaReview) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [pendingArenaReview]);

  useEffect(() => {
    setActiveReviewSession(true);
    return () => setActiveReviewSession(false);
  }, []);
  
  // Zen mode state
  const [isZenMode, setIsZenMode] = useState(false);
  const [isAnkiImporting, setIsAnkiImporting] = useState(false);
  
  // FSRS Inspector
  const { isOpen: isInspectorOpen, setIsOpen: setIsInspectorOpen } = useFSRSInspector();
  const toast = useToast();
  const haptic = useHapticFeedback();
  const volumeRockerMode = useSettingsStore(
    (state) => state.settings.interface.volumeRockerScroll ?? "none",
  );
  // SM-18 and SM-20 grade natively on a 0-5 scale (0-2 fail, 3-5 pass) —
  // surface the native scale instead of squeezing it into the 4 Anki-style
  // buttons. The scale is declared by the shared rating schema.
  const ratingSchema = useRatingSchema();
  const useNativeGrades = ratingSchema.type === "supermemo";
  const canChooseArenaMode = useSettingsStore(
    (state) =>
      featureFlags.reviewAlgorithmArena &&
      state.settings.learning.algorithm === "sm20" &&
      !state.settings.learning.sm20PureM4,
  );
  // The H-pattern joystick is a touch-only affordance; desktop uses the
  // tappable grid + keyboard 0-5.
  const isTouch = useIsTouchRating();

  // FSRS explanation modal for first-time reviewers
  const { shouldShow: showFSRSExplanation, markShown: markFSRSShown } = useFSRSExplanation();

  // Swipe gestures for mobile/tablet (only when answer is shown and not submitting).
  // On touch devices with a native 0-5 grade algorithm (SM-18/SM-20), the
  // 4-axis swipe is replaced by the 6-zone H-pattern joystick so all grades
  // are reachable. FSRS/SM-2 and desktop keep the classic 4-direction swipe.
  const useJoystick = useNativeGrades && isTouch;

  // Keep latest state in refs so the gesture callbacks (registered once)
  // always see current values without re-binding listeners every render.
  const answerShownRef = useRef(isAnswerShown);
  const submittingRef = useRef(isSubmitting);
  // `handleRating` is declared below; initialize to a no-op and patch the ref
  // every render once it exists. The gesture hooks read `.current` at call time.
  const ratingCbRef = useRef<(rating: ReviewRating, grade?: number) => Promise<void>>(
    async () => {},
  );
  answerShownRef.current = isAnswerShown && !pendingArenaReview;
  submittingRef.current = isSubmitting;

  const {
    ref: swipeRef,
    direction: swipeDirection,
    deltaX,
    deltaY,
  } = useSwipeGesture({
    onSwipeLeft: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(1 as ReviewRating),
    onSwipeRight: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(4 as ReviewRating),
    onSwipeUp: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(3 as ReviewRating),
    onSwipeDown: () => answerShownRef.current && !submittingRef.current && ratingCbRef.current(2 as ReviewRating),
    threshold: 80,
    preventDefaultTouch: true,
  });

  // The joystick and swipe gestures both attach to the same card container;
  // only one is active depending on the algorithm + form factor. The joystick
  // itself is owned by `SuperMemoRatingControl` below.
  const joystickAreaRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useJoystick ? joystickAreaRef : swipeRef;

  // Break reminder for long review sessions (30 minutes)
  const {
    showReminder: showBreakReminder,
    sessionMinutes: breakSessionMinutes,
    dismissReminder: dismissBreakReminder,
    continueAfterReminder: continueAfterBreakReminder,
  } = useBreakReminder(sessionStartTime, 30);

  // Feedback state
  const [feedback, setFeedback] = useState<{
    type: "streak" | "milestone" | "complete" | "mastered" | null;
    value?: number;
  }>({ type: null });

  // Audio read-aloud review mode (hands-free TTS flow).
  const audioCard = currentCard;
  const audioQuestionText = audioCard
    ? (audioCard.cloze_text || audioCard.question || "").replace(/<[^>]*>/g, " ")
    : "";
  const audioAnswerText = audioCard
    ? (audioCard.answer || "").replace(/<[^>]*>/g, " ")
    : "";
  const audioReview = useAudioReviewMode({
    cardId: audioCard?.id ?? null,
    questionText: audioQuestionText,
    answerText: audioAnswerText,
    isAnswerShown,
    onFlip: () => showAnswer(),
    onAdvance: async () => {
      const cfg = useSettingsStore.getState().settings.audioReviewMode;
      const rating = (cfg?.defaultRating ?? 3) as ReviewRating;
      await handleRating(rating);
      const pending = useReviewStore.getState().pendingArenaReview;
      if (!pending) return;

      const committedInterval = pending.preview?.recommendation.interval_days;
      await useReviewStore.getState().confirmArenaSelection();
      const committedState = useReviewStore.getState();
      if (committedState.pendingArenaReview || committedState.error || !committedInterval) return;

      return t("algorithmArena.audioScheduled", {
        interval: formatArenaInterval(committedInterval, locale),
      });
    },
  });

  const handleRating = async (rating: ReviewRating, grade?: number) => {
    haptic.click();
    const beforeId = currentCard?.id;
    if (interactionResult) {
      useReviewStore.getState().setPendingReviewMetadata({
        hintsUsed: 0,
        interactionType: interactionResult.interactionType,
        interactionCorrect: interactionResult.correct,
      });
    }

    const currentStreak = streak;
    const willComplete = currentIndex >= queue.length - 1;

    // Snapshot BEFORE submitRating: the store advances the queue as soon as
    // the grade commits. The submitReview arguments are untouched — the
    // assessment is recorded by a separate, fire-and-forget invoke below.
    const pendingAssessment = cardAssessment.payload;

    await submitRating(rating, grade);
    if (!beforeId) return;
    const committedState = useReviewStore.getState();
    if (committedState.pendingArenaReview || committedState.error) return;

    // Phase 4 (task 5.8): persist the assessment AFTER grading. Advisory
    // only — never part of the scheduling path, and failures are silent.
    if (pendingAssessment && pendingAssessment.cardId === beforeId) {
      void recordCardAssessment(pendingAssessment);
    }

    // Show feedback for milestones
    if (willComplete) {
      setFeedback({ type: "complete" });
      haptic.complete();
    } else if (currentStreak?.current_streak && currentStreak.current_streak > 0 && currentStreak.current_streak % 10 === 0) {
      setFeedback({ type: "streak", value: currentStreak.current_streak });
      haptic.streak();
    }

  };
  const handleArenaCommitted = () => {
    const committedState = useReviewStore.getState();
    if (!committedState.currentCard) {
      setFeedback({ type: "complete" });
      haptic.complete();
    } else if (streak?.current_streak && streak.current_streak > 0 && streak.current_streak % 10 === 0) {
      setFeedback({ type: "streak", value: streak.current_streak });
      haptic.streak();
    }
  };
  // Keep the gesture-hook ref pointed at the latest rating handler.
  ratingCbRef.current = handleRating;

  const handleDeleteCurrent = async () => {
    const target = deleteTarget;
    if (!target) {
      toast.info(t("queue.delete"), t("reviewSession.deleteOnlyLearning"));
      return;
    }
    setDeletingCardId(target.id);
    try {
      await bulkDeleteItems([target.id]);
      removeItemFromSession(target.id);
      toast.success(t("reviewSession.cardDeleted"));
    } catch (error) {
      toast.error(t("reviewSession.deleteFailed"), error instanceof Error ? error.message : t("reviewSession.unknownError"));
    } finally {
      setDeletingCardId(null);
    }
  };

  const requestDeleteCurrent = () => {
    if (!currentCard || pendingArenaReview || isSubmitting) return;
    const rawLabel = currentCard.question || currentCard.cloze_text || t("reviewSession.untitledCard");
    const label = rawLabel
      .replace(/<[^>]*>/g, " ")
      .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, "$1")
      .replace(/\[\[c\d+::(.*?)\]\]/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    setDeleteTarget({
      id: currentCard.id,
      label: label || t("reviewSession.untitledCard"),
    });
  };

  const canEditCurrentCard = Boolean(currentCard) && !isSubmitting && !pendingArenaReview;

  // Anki-style edit-during-review: opens the inline editor over the session.
  // Disabled while a rating submission or an arena decision is in flight so an
  // edit can never race the scheduler.
  const handleOpenEditor = () => {
    if (!canEditCurrentCard) return;
    setIsEditorOpen(true);
  };

  const handleEditorSave = (updated: EditableCard) => {
    // The editor works in the learning-items card shape; the session store
    // keeps the review shape (they only differ in item_type casing).
    patchCurrentCard(updated as unknown as ReviewSessionItem);
  };

  // Complex interaction types keep the Studio hand-off: occlusion cards reopen
  // the composer on the same asset, everything else seeds the Flashcard Studio
  // with the card's text as the starting point.
  const handleEditInStudio = (card: EditableCard) => {
    const interactionMetadata =
      (card as any).interaction_metadata ?? (card as any).interactionMetadata;
    const occlusionAssetId = interactionMetadata?.imageOcclusionAssetId;
    setIsEditorOpen(false);
    if (occlusionAssetId) {
      window.dispatchEvent(
        new CustomEvent("incrementum:create-image-occlusion", {
          detail: { assetId: occlusionAssetId, documentId: card.document_id ?? undefined },
        })
      );
      return;
    }
    setStudioSeed({
      key: `review-edit-${card.id}-${Date.now()}`,
      documentId: card.document_id ?? null,
      excerpt: card.question || card.cloze_text || "",
      resetDraftCards: true,
    });
    setIsStudioOpen(true);
  };

  const handleSuspendCurrent = async () => {
    if (!currentCard) {
      toast.info(t("queue.suspend"), t("reviewSession.suspendOnlyLearning"));
      return;
    }
    try {
      await bulkSuspendItems([currentCard.id]);
      toast.success(t("reviewSession.cardSuspended"));
      await loadQueue();
    } catch (error) {
      toast.error(t("reviewSession.suspendFailed"), error instanceof Error ? error.message : t("reviewSession.unknownError"));
    }
  };

  const handleImportDeck = async () => {
    if (isAnkiImporting) return;
    setIsAnkiImporting(true);
    try {
      const selected = await openFilePicker({
        title: t("reviewSession.importDeckDialogTitle"),
        multiple: false,
        filters: [{ name: t("reviewSession.deckFiles"), extensions: ["apkg", "json"] }],
      });
      if (!selected || selected.length === 0) return;

      const filePath = selected[0];
      const ext = filePath.toLowerCase().split(".").pop();

      if (ext === "json") {
        const result = await invokeCommand<{ deck_name: string; cards_imported: number }>(
          "import_study_json_file",
          { filePath, collectionId: useCollectionStore.getState().activeCollectionId }
        );
        const deckNames = [result.deck_name];
        const deckIds = ensureAnkiStudyDecks(deckNames);
        if (deckIds.length > 0) {
          useStudyDeckStore.getState().clearDeckSelection();
          useStudyDeckStore.getState().toggleDeckSelection(deckIds[0]);
        }
        await loadQueue();
        toast.success(
          t("reviewSession.deckImportComplete"),
          t("reviewSession.deckImportSummary", { cards: result.cards_imported, decks: 1 })
        );
      } else {
        const imported = await importAnkiPackageFromPicker(filePath);
        const deckNames = inferAnkiDeckNames(imported);
        const deckIds = ensureAnkiStudyDecks(deckNames);
        if (deckIds.length > 0) {
          useStudyDeckStore.getState().clearDeckSelection();
          useStudyDeckStore.getState().toggleDeckSelection(deckIds[0]);
        }
        await loadQueue();
        toast.success(
          t("reviewSession.ankiImportComplete"),
          t("reviewSession.ankiImportSummary", { cards: imported.length, decks: deckNames.length || 1 })
        );
      }
    } catch (error) {
      toast.error(
        t("reviewSession.ankiImportFailed"),
        error instanceof Error ? error.message : t("reviewSession.unknownImportError")
      );
    } finally {
      setIsAnkiImporting(false);
    }
  };

  useEffect(() => {
    setInteractionResult(null);
  }, [currentCard?.id]);

  useEffect(() => {
    if (!isQueueListOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (!queueListRef.current) return;
      if (e.target instanceof Node && queueListRef.current.contains(e.target)) {
        return;
      }
      setIsQueueListOpen(false);
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsQueueListOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isQueueListOpen]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // The inline card editor owns all keys while open (including Escape,
      // which closes it before the session-level handler can see it).
      if (isEditorOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsEditorOpen(false);
        }
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      // When no inner element is focused (e.g. right after the auto-focused
      // "Show Answer" button unmounts on flip), the event target falls back to
      // <body>/<html>. Allow those through so rating keys (1-4) keep working;
      // only bail when focus is genuinely inside another app surface.
      const target = e.target as Node | null;
      if (
        target &&
        target !== document.body &&
        target !== document.documentElement &&
        !containerRef.current?.contains(target)
      ) {
        return;
      }

      // Hardware volume rocker (and PageUp/PageDown when enabled) navigates
      // or scrolls the review content per the user's interface setting.
      // Handled before the shortcut bindings below so it can consume the key
      // without interfering with Space/1-4/Cmd+... review shortcuts.
      const getScrollableContentElement = (): HTMLElement | null => {
        // Prefer the active Extract's scroll container when present...
        const extractScroll = containerRef.current?.querySelector(
          '[data-extract-scroll="true"]',
        ) as HTMLElement | null;
        if (extractScroll && extractScroll.scrollHeight > extractScroll.clientHeight + 4) {
          return extractScroll;
        }
        // ...else fall back to the session's primary scroll container.
        return containerRef.current ?? null;
      };
      const scrollContentVertically = (direction: "up" | "down") => {
        const scrollable = getScrollableContentElement();
        if (!scrollable) return;
        scrollable.scrollBy({ top: direction === "down" ? 180 : -180, behavior: "smooth" });
      };
      if (
        handleVolumeRockerNavigation(
          e,
          volumeRockerMode,
          {
            pageUp: () => goToIndex(currentIndex - 1),
            pageDown: () => goToIndex(currentIndex + 1),
            scrollUp: () => scrollContentVertically("up"),
            scrollDown: () => scrollContentVertically("down"),
          },
        )
      ) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const lowerKey = e.key.toLowerCase();

      if (pendingArenaReview) {
        if (e.key === "Escape") {
          e.preventDefault();
          cancelArenaDecision();
        }
        // AlgorithmArenaDecision owns all chooser shortcuts while a grade is
        // pending so session-level rating/navigation cannot skip the card.
        return;
      }

      if (mod && lowerKey === "i") {
        e.preventDefault();
        setIsInspectorOpen((prev) => !prev);
        return;
      }
      if (mod && e.shiftKey && lowerKey === "z") {
        e.preventDefault();
        setIsZenMode((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        // In Zen Mode, let ZenReviewMode's own Escape handler exit Zen only
        // (back to the normal session). This session-level handler stays
        // mounted while Zen is shown, so without this guard a single Esc
        // would also leave the whole session.
        if (isZenMode) return;
        e.preventDefault();
        void requestExit();
        return;
      }

      // Space to show answer for learning items
      if (e.key === " " && !isAnswerShown && currentCard) {
        e.preventDefault();
        showAnswer();
      }

      // Ctrl/Cmd + Enter to show answer
      if (mod && e.key === "Enter" && !isAnswerShown && currentCard) {
        e.preventDefault();
        showAnswer();
        return;
      }

      // Ctrl/Cmd + 1/2/3/4 to rate without showing answer first
      if (mod && currentCard && !isSubmitting && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        handleRating(Number(e.key) as ReviewRating);
        return;
      }

      // Ctrl/Cmd + E to edit the current card in place. While a submission or
      // arena decision is in flight the editor stays closed (the on-card Edit
      // control is disabled for the same window).
      if (mod && lowerKey === "e") {
        e.preventDefault();
        if (currentCard && !isSubmitting && !pendingArenaReview) {
          setIsEditorOpen(true);
        }
        return;
      }

      // Review actions that are currently placeholders in the session UI.
      if (mod && (lowerKey === "d" || lowerKey === "s" || lowerKey === "h")) {
        e.preventDefault();
        if (lowerKey === "d") requestDeleteCurrent();
        if (lowerKey === "s") void handleSuspendCurrent();
        if (lowerKey === "h") toast.info(t("reviewSession.historyUnavailable"));
        return;
      }

      // Number keys for rating (only when answer is shown)
      if (isAnswerShown && currentCard && !isSubmitting) {
        if (useNativeGrades) {
          // Native SM-20 grade scale: keys 0-5 (0-2 fail, 3-5 pass).
          if (/^[0-5]$/.test(e.key)) {
            const grade = Number(e.key) as SM20NativeGrade;
            handleRating(gradeToRating(grade), grade);
          }
        } else {
          if (e.key === "1") handleRating(1 as ReviewRating);
          if (e.key === "2") handleRating(2 as ReviewRating);
          if (e.key === "3") handleRating(3 as ReviewRating);
          if (e.key === "4") handleRating(4 as ReviewRating);
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    isAnswerShown,
    currentCard,
    isSubmitting,
    isEditorOpen,
    showAnswer,
    submitRating,
    onExit,
    toast,
    requestDeleteCurrent,
    handleSuspendCurrent,
    volumeRockerMode,
    goToIndex,
    currentIndex,
    useNativeGrades,
    isZenMode,
    pendingArenaReview,
    cancelArenaDecision,
  ]);

  if (isLoading) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-full p-8">
        <ReviewCardSkeleton />
      </div>
    );
  }

  if (error && !pendingArenaReview) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <WarningCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {t("reviewSession.errorLoading")}
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            onClick={requestExit}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            {t("review.backToHome")}
          </button>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div ref={containerRef} className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h3 className="text-2xl font-bold text-foreground mb-2">
            {t("reviewSession.allCaughtUp")}
          </h3>
          <p className="text-muted-foreground mb-6">
            {t("review.emptyState")}
          </p>
          <button
            onClick={handleImportDeck}
            disabled={isAnkiImporting}
            className="mb-3 inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Upload className="h-4 w-4" />
            {isAnkiImporting ? t("review.importing") : t("review.importDeck")}
          </button>
          <br />
          <button
            onClick={requestExit}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            {t("review.backToHome")}
          </button>
        </div>
      </div>
    );
  }

  if (!currentCard) {
    return (
      <div ref={containerRef} className="flex flex-col items-center justify-center h-full p-6 gap-6">
        <ReviewComplete
          reviewsCompleted={reviewsCompleted}
          correctCount={correctCount}
          sessionStartTime={sessionStartTime}
          streak={streak || undefined}
        />
        <button
          onClick={requestExit}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
        >
          {t("review.backToHome")}
        </button>
      </div>
    );
  }

  const estimatedSecondsRemaining = getEstimatedTimeRemaining();
  const perItemSeconds = averageTimePerCard > 0 ? averageTimePerCard : 30;
  const remainingItems = queue.length - currentIndex;
  const safeStopCount = Math.max(1, Math.min(remainingItems, Math.floor((20 * 60) / perItemSeconds)));
  const minMinutes = Math.max(1, Math.round((estimatedSecondsRemaining / 60) * 0.85));
  const maxMinutes = Math.max(1, Math.round((estimatedSecondsRemaining / 60) * 1.15));
  const deleteConfirmDialog = (
    <ConfirmDialog
      isOpen={deleteTarget !== null}
      onClose={() => setDeleteTarget(null)}
      onConfirm={() => void handleDeleteCurrent()}
      title={t("learningCards.deleteCard")}
      message={t("reviewSession.deleteConfirmMessage")}
      confirmLabel={t("common.delete")}
      cancelLabel={t("common.cancel")}
      variant="danger"
      details={deleteTarget ? [deleteTarget.label] : undefined}
      itemName="card"
    />
  );

  if (isZenMode && !isLoading && queue.length > 0 && currentCard) {
    return (
      <>
        <ZenReviewMode
          onExit={() => setIsZenMode(false)}
          onRequestDelete={requestDeleteCurrent}
          isDeleting={deletingCardId === currentCard.id}
        />
        {deleteConfirmDialog}
      </>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto md:overflow-hidden flex flex-col p-4 md:p-6 pb-6">
      {/* Header */}
      <div className="mb-4 md:mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={requestExit}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground min-h-[44px] md:min-h-0"
          >
            <ArrowLeft className="h-4 w-4 md:h-3 md:w-3" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl md:text-3xl font-bold text-foreground">{t("review.title")}</h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden md:block">
              {t("review.subtitle")}
            </p>
          </div>
        </div>

        {/* Mode Toggles & Queue Navigation */}
        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-start md:justify-end">
          <button
            onClick={() => setIsZenMode(!isZenMode)}
            className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isZenMode 
                ? "bg-primary/10 text-primary border border-primary/30" 
                : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
              title={isZenMode ? t("review.exitZen") : t("review.enterZen")}
          >
            <Sparkle className="w-3.5 h-3.5" />
            {t("reviewSession.zenShort")}
          </button>
          
          <button
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isInspectorOpen
                ? "bg-primary/10 text-primary border border-primary/30"
                : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            title={t("reviewSession.toggleInspector")}
          >
            <span className="font-mono text-[10px]">FSRS</span>
          </button>
          {audioReview.isSupported && (
            <button
              onClick={audioReview.toggle}
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                audioReview.isEnabled
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title={audioReview.isEnabled ? "Disable audio review mode" : "Enable audio review mode (hands-free TTS)"}
            >
              {audioReview.isEnabled ? <SpeakerHigh className="w-3.5 h-3.5" /> : <SpeakerSlash className="w-3.5 h-3.5" />}
              Audio
            </button>
          )}
          <button
            onClick={requestDeleteCurrent}
            disabled={!currentCard || isSubmitting || Boolean(pendingArenaReview) || deletingCardId === currentCard?.id}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-destructive/30 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 disabled:cursor-not-allowed"
            title={t("learningCards.deleteCard")}
            aria-label={t("learningCards.deleteCard")}
          >
            <Trash className="w-3.5 h-3.5" />
            {t("common.delete")}
          </button>
          <button
            onClick={handleImportDeck}
            disabled={isAnkiImporting}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium bg-blue-500 text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            title={t("reviewSession.importDeckTooltip")}
          >
            <Upload className="w-3.5 h-3.5" />
            {isAnkiImporting ? t("review.importing") : t("review.import")}
          </button>

          {queue.length > 0 && (
          <div className="relative">
            <QueueNavigationControls
              currentDocumentIndex={currentIndex}
              totalDocuments={queue.length}
              hasMoreChunks={queue.length > 0}
              onPreviousDocument={() => goToIndex(currentIndex - 1)}
              onNextDocument={() => goToIndex(currentIndex + 1)}
              onNextChunk={() => setIsQueueListOpen((prev) => !prev)}
              listButtonLabel={t("review.queue")}
              disabled={isSubmitting}
            />

            {isQueueListOpen && (
              <div
                ref={queueListRef}
                className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50"
              >
                <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                  {t("review.queue")}
                </div>
                <div className="max-h-80 overflow-auto">
                  {queue.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        goToIndex(index);
                        setIsQueueListOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                        index === currentIndex
                          ? "bg-muted text-foreground"
                          : "hover:bg-muted/60 text-foreground"
                      }`}
                    >
                      <div className="text-xs text-muted-foreground mb-1">
                        {index + 1} / {queue.length}
                      </div>
                      <div className="line-clamp-2">
                        <span
                          dangerouslySetInnerHTML={{
                            __html: renderAnkiHtmlWithLatex(item.question || item.cloze_text || t("reviewSession.untitledCard")),
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {pendingArenaReview && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <div className="max-h-[28dvh] shrink-0 overflow-y-auto rounded-2xl border border-border/70 bg-card/55 p-1 sm:max-h-[32dvh]">
            <ReviewCard
              card={currentCard}
              showAnswer={true}
              onShowAnswer={() => {}}
              onInteractionResultChange={setInteractionResult}
            />
          </div>
          <AlgorithmArenaDecision onCommitted={handleArenaCommitted} />
        </div>
      )}

      <div className={`${pendingArenaReview ? "hidden" : "grid"} grid-cols-1 md:grid-cols-[1fr_320px] gap-4 md:gap-6 md:flex-1 md:min-h-0`}>
        <div className="flex flex-col gap-4 md:gap-6 md:min-h-0">
          <div className="hidden md:flex bg-card border border-border rounded-lg p-4 flex-wrap gap-4 text-sm text-muted-foreground">
            <div>
              {t("review.timeRemaining")}: <span className="text-foreground font-semibold">{minMinutes}-{maxMinutes} min</span>
            </div>
            <div>
              {t("review.itemsRemaining")}: <span className="text-foreground font-semibold">{remainingItems}</span>
            </div>
            <div>
              {t("review.safeStopAfter")}: <span className="text-foreground font-semibold">{safeStopCount} {t("review.items")}</span>
            </div>
            <div>
              {t("review.sessionGoal")}: <span className="text-foreground font-semibold">{t("review.retentionMaintenance")}</span>
            </div>
          </div>

          {/* Progress */}
          <ReviewProgress
            currentIndex={currentIndex}
            totalCards={queue.length}
            reviewsCompleted={reviewsCompleted}
            correctCount={correctCount}
            estimatedTimeRemaining={getEstimatedTimeRemaining()}
            streak={streak}
          />

          {/* Card and Ratings */}
          <div ref={gestureRef} className="md:flex-1 flex flex-col md:min-h-0 relative touch-pan-y">
            {/* Swipe Indicator Overlay (legacy 4-axis; hidden when the joystick owns the gesture) */}
            {!useJoystick && swipeDirection && isAnswerShown && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 rounded-lg"
                style={getSwipeIndicatorStyle(swipeDirection, deltaX, deltaY)}
              >
                <div className="flex flex-col items-center">
                  <div className={`px-6 py-3 rounded-xl ${SWIPE_RATINGS[swipeDirection].color} text-white font-bold text-xl shadow-lg`}>
                    {SWIPE_RATINGS[swipeDirection].label}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {t("review.releaseToRate")}
                  </div>
                </div>
              </div>
            )}

            {/* H-pattern rating joystick overlay (touch + native-grade only)
                is rendered by SuperMemoRatingControl below. */}

            {isAnswerShown ? (
              <>
                {/* Card with answer shown */}
                <div className="flex-none overflow-visible md:flex-1 md:overflow-y-auto md:min-h-0">
                  <div className="w-full flex flex-col justify-start md:min-h-full md:justify-center">
                    <div className="w-full">
                      <ReviewCard
                        card={currentCard}
                        showAnswer={true}
                        onShowAnswer={() => {}}
                        onInteractionResultChange={setInteractionResult}
                        onEdit={handleOpenEditor}
                        editDisabled={!canEditCurrentCard}
                        assessmentPanel={{
                          assessment: cardAssessment.assessment,
                          error: cardAssessment.assessmentError,
                          pending: cardAssessment.assessmentPending,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Rating Buttons */}
                <div {...tourAnchor("reviewGradingControls")} className="flex-shrink-0 mt-4">
                  {useNativeGrades ? (
                    <SuperMemoRatingControl
                      onSelect={(rating, grade) => ratingCbRef.current(rating, grade)}
                      enabled={() => answerShownRef.current && !submittingRef.current}
                      disabled={isSubmitting}
                      previewIntervals={previewIntervals}
                      suggestedRating={
                        shouldSuggestGrade(cardAssessment.assessment, aiAutoGradeSuggest)
                          ? computeSuggestedRating(cardAssessment.assessment)
                          : undefined
                      }
                      touchAreaRef={useJoystick ? joystickAreaRef : undefined}
                    />
                  ) : (
                    <RatingButtons
                      onSelectRating={handleRating}
                      disabled={isSubmitting}
                      previewIntervals={previewIntervals}
                      suggestedRating={
                        shouldSuggestGrade(cardAssessment.assessment, aiAutoGradeSuggest)
                          ? computeSuggestedRating(cardAssessment.assessment)
                          : undefined
                      }
                    />
                  )}
                  {canChooseArenaMode && <AlgorithmArenaModeControl compact />}
                  {/* Hint for mobile */}
                  <div className="mt-3 text-center text-xs text-muted-foreground md:hidden">
                    <span className="inline-flex items-center gap-1">
                      {useJoystick ? t("review.joystickHint") : t("review.swipeHint")}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Card with answer hidden */}
                <div className="flex-1 md:overflow-y-auto md:min-h-0">
                  <div className="w-full flex flex-col justify-start md:min-h-full md:justify-center">
                    <ReviewCard
                      card={currentCard}
                      showAnswer={false}
                      onShowAnswer={showAnswer}
                      onInteractionResultChange={setInteractionResult}
                      onEdit={handleOpenEditor}
                      editDisabled={!canEditCurrentCard}
                      freeResponse={
                        cardAssessment.inputEnabled
                          ? {
                              value: cardAssessment.freeResponse,
                              onChange: cardAssessment.setFreeResponse,
                            }
                          : undefined
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <ReviewTransparencyPanel
            card={currentCard}
            previewIntervals={previewIntervals}
          />
          <div className="hidden md:block bg-card border border-border rounded-lg p-4 text-xs text-muted-foreground">
            {t("review.cutoffGuarantee", { count: safeStopCount })}
          </div>
        </div>
      </div>

      {/* Feedback Overlay */}
      <ReviewFeedback
        type={feedback.type}
        value={feedback.value}
        onClose={() => setFeedback({ type: null })}
      />

      {/* Audio review mode status pill */}
      {audioReview.isEnabled && audioReview.status !== "idle" && (
        <div className="audio-review-pill fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-card border border-border shadow-lg flex items-center gap-2 text-sm">
          <SpeakerHigh className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-foreground">
            {audioReview.status === "speaking-question" && t("algorithmArena.audioReadingQuestion")}
            {audioReview.status === "awaiting-flip" && t("algorithmArena.audioRevealAnswer")}
            {audioReview.status === "speaking-answer" && t("algorithmArena.audioReadingAnswer")}
            {audioReview.status === "advancing" && t("algorithmArena.audioNextCard")}
            {audioReview.status === "announcing-schedule" && t("algorithmArena.audioReviewScheduled")}
          </span>
          {audioReview.lastError && (
            <span className="text-xs text-destructive ml-2">{audioReview.lastError}</span>
          )}
        </div>
      )}

      {/* FSRS Explanation Modal for first-time reviewers */}
      <FSRSExplanationModal
        isOpen={showFSRSExplanation && !isLoading && queue.length > 0}
        onClose={markFSRSShown}
      />

      {/* Break Reminder Modal for long review sessions */}
      <BreakReminderModal
        isOpen={showBreakReminder}
        onClose={dismissBreakReminder}
        onContinue={continueAfterBreakReminder}
        sessionMinutes={breakSessionMinutes}
      />

      {/* FSRS Inspector Panel */}
      <FSRSInspector
        card={currentCard as any}
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
      />
      {deleteConfirmDialog}

      {/* Inline card editor overlay (edit-during-review, Cmd/Ctrl+E) */}
      {isEditorOpen && currentCard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("reviewSession.editCardTitle")}
          className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 p-4"
        >
          <button
            type="button"
            aria-label={t("common.close")}
            className="absolute inset-0 cursor-default"
            onClick={() => setIsEditorOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                {t("reviewSession.editCardTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[75dvh] overflow-y-auto">
              <InlineCardEditor
                card={currentCard as unknown as EditableCard}
                surface="review"
                onClose={() => setIsEditorOpen(false)}
                onSave={handleEditorSave}
                onSaved={() => setIsEditorOpen(false)}
                onEditInStudio={handleEditInStudio}
              />
            </div>
          </div>
        </div>
      )}

      {/* Flashcard Studio, seeded from the current card via the editor's
          "Edit in Studio" hand-off for complex interaction types. */}
      <FlashcardStudioModal
        isOpen={isStudioOpen}
        onClose={() => {
          setIsStudioOpen(false);
          setStudioSeed(null);
        }}
        seed={studioSeed}
      />
    </div>
  );
}
