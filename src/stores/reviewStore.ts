import { create } from "zustand";
import {
  getDueItems,
  submitReview,
  restoreLearningItemState,
  previewReviewIntervals,
  getReviewStreak,
  startReview,
  LearningItem,
  ReviewRating,
  PreviewIntervals,
  ReviewStreak,
  ArenaSelection,
  ArenaSelectionSource,
  SM20ArenaModelId,
  ArenaReviewProvenance,
  SM20ArenaGradePreview,
} from "../api/review";
import { getLearningItems } from "../api/learning-items";
import { useCollectionStore } from "./collectionStore";
import { useSettingsStore } from "./settingsStore";
import { useStudyDeckStore } from "./studyDeckStore";
import { getUser } from "../lib/sync-client";
import { resolveFsrsParamsForScope } from "../utils/fsrsScope";
import { filterByDecks } from "../utils/studyDecks";
import { featureFlags } from "../lib/featureFlags";

interface StoredReviewSession {
  reviewedIds: string[];
  sessionId?: string;
  updatedAt: number;
}

const getReviewSessionKey = () => {
  const user = getUser();
  const collectionId = useCollectionStore.getState().activeCollectionId ?? "default";
  const userKey = user?.id ?? "demo";
  return `review-session:${userKey}:${collectionId}`;
};

const loadStoredSession = (): StoredReviewSession | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(getReviewSessionKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredReviewSession;
  } catch {
    return null;
  }
};

const saveStoredSession = (session: StoredReviewSession) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getReviewSessionKey(), JSON.stringify(session));
};

const clearStoredSession = () => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getReviewSessionKey());
};

// The review session queue is flashcards / learning items only. Reading items
// (documents) are reviewed in the Queue / Optimal Queue tab, never here.
export type ReviewSessionItem = LearningItem;

export type ReviewPhase =
  | "question"
  | "answer"
  | "arena-loading"
  | "arena-ready"
  | "arena-committing"
  | "arena-error";

export interface ArenaSelectionDraft {
  source: ArenaSelectionSource;
  modelId?: SM20ArenaModelId;
  intervalDays?: number;
}

export interface PendingArenaReview {
  itemId: string;
  rating: ReviewRating;
  grade: number;
  commitId: string;
  gradedAt: number;
  recallTimeTaken: number;
  selection: ArenaSelectionDraft;
  preview?: SM20ArenaGradePreview;
  error?: string;
}

interface ReviewState {
  // Data
  queue: ReviewSessionItem[];
  currentIndex: number;
  currentCard: ReviewSessionItem | null;
  previewIntervals: PreviewIntervals | null;
  reviewPhase: ReviewPhase;
  pendingArenaReview: PendingArenaReview | null;
  arenaPreviewError: string | null;

  // UI State
  isLoading: boolean;
  isAnswerShown: boolean;
  isSubmitting: boolean;
  error: string | null;
  sessionId: string;

  // Statistics for current session
  reviewsCompleted: number;
  correctCount: number;
  sessionStartTime: number;
  averageTimePerCard: number; // in seconds

  // Streak information
  streak: ReviewStreak | null;
  streakLoading: boolean;
  reviewMode: "normal" | "cram";
  canUndoLastReview: boolean;
  lastUndoError: string | null;
  pendingReviewMetadata: {
    hintsUsed: number;
    typedMode?: "exact" | "fuzzy" | "semantic";
    typedCorrect?: boolean;
    typedSimilarity?: number;
    typedProvider?: "local" | "cloud" | "heuristic";
    handwritingCaptured?: boolean;
    interactionType?: "ordering" | "matching" | "multiple-choice" | "image-occlusion";
    interactionCorrect?: boolean;
  } | null;
  reviewEventLog: Array<{
    itemId: string;
    rating: ReviewRating;
    timestamp: string;
    metadata?: {
      hintsUsed: number;
      typedMode?: "exact" | "fuzzy" | "semantic";
      typedCorrect?: boolean;
      typedSimilarity?: number;
      typedProvider?: "local" | "cloud" | "heuristic";
      handwritingCaptured?: boolean;
      interactionType?: "ordering" | "matching" | "multiple-choice" | "image-occlusion";
      interactionCorrect?: boolean;
    };
  }>;

  // Actions
  loadQueue: () => Promise<void>;
  loadStreak: () => Promise<void>;
  showAnswer: () => void;
  hideAnswer: () => void;
  /** Submit a review. `grade` is the native SM-20 grade (0-5) when the native
   * grading scale is active; the rating is still passed for stats/history. */
  submitRating: (rating: ReviewRating, grade?: number, arenaSelection?: ArenaSelection) => Promise<void>;
  selectArenaChoice: (selection: ArenaSelectionDraft) => void;
  confirmArenaSelection: () => Promise<void>;
  cancelArenaDecision: () => void;
  retryArenaPreview: () => Promise<void>;
  scheduleArenaAutomatically: () => Promise<void>;
  loadPreviewIntervals: () => Promise<void>;
  nextCard: () => void;
  goToIndex: (index: number) => void;
  /** Replace the in-flight card (and its queue entry) after an edit, without
   * reloading the queue or touching any other session state. */
  patchCurrentCard: (updated: ReviewSessionItem) => void;
  removeItemFromSession: (itemId: string) => void;
  resetSession: () => void;
  startReviewAtItem: (itemId: string) => Promise<void>;
  startReviewWithQueue: (itemIds: string[]) => Promise<void>;
  studyDocumentCards: (documentId: string) => Promise<void>;
  getEstimatedTimeRemaining: () => number; // in seconds
  setReviewMode: (mode: "normal" | "cram") => void;
  setPendingReviewMetadata: (metadata: ReviewState["pendingReviewMetadata"]) => void;
  undoLastReview: () => Promise<void>;

  // Global tab navigation and selection state
  reviewTabMode: "home" | "session" | "deck-manager";
  selectedDeckId: string | null;
  setReviewTabMode: (mode: "home" | "session" | "deck-manager") => void;
  setSelectedDeckId: (deckId: string | null) => void;
}

type ReviewUndoSnapshot = {
  queue: ReviewSessionItem[];
  currentIndex: number;
  currentCard: ReviewSessionItem | null;
  isAnswerShown: boolean;
  reviewsCompleted: number;
  correctCount: number;
  averageTimePerCard: number;
  sessionStartTime: number;
  reviewedIdsBefore: string[];
  learningItemState?: {
    itemId: string;
    dueDate: string;
    interval: number;
    easeFactor: number;
    lastReviewDate?: string;
    reviewCount: number;
    lapses: number;
    state: string;
    memoryState?: { stability: number; difficulty: number } | null;
    difficulty: number;
    algorithmType?: string;
    algorithmState?: string;
    arenaCommitId?: string;
  };
};

let lastUndoSnapshot: ReviewUndoSnapshot | null = null;

const ratingToSm20Grade = (rating: ReviewRating): number => {
  if (rating === 1) return 0;
  if (rating === 2) return 3;
  if (rating === 3) return 4;
  return 5;
};

const newArenaCommitId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `arena-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const useReviewStore = create<ReviewState>((set, get) => ({
  // Initial State
  queue: [],
  currentIndex: 0,
  currentCard: null,
  previewIntervals: null,
  reviewPhase: "question",
  pendingArenaReview: null,
  arenaPreviewError: null,
  isLoading: false,
  isAnswerShown: false,
  isSubmitting: false,
  error: null,
  sessionId: "",
  reviewsCompleted: 0,
  correctCount: 0,
  sessionStartTime: 0,
  averageTimePerCard: 0,
  streak: null,
  streakLoading: false,
  reviewMode: "normal",
  canUndoLastReview: false,
  lastUndoError: null,
  pendingReviewMetadata: null,
  reviewEventLog: [],
  reviewTabMode: "home",
  selectedDeckId: null,

  // Actions
  setReviewTabMode: (mode) => set({ reviewTabMode: mode }),
  setSelectedDeckId: (deckId) => set({ selectedDeckId: deckId }),
  loadQueue: async () => {
    set({ isLoading: true, error: null });
    try {
      const collectionId = useCollectionStore.getState().activeCollectionId;
      const items = await getDueItems(collectionId);

      // Collection filtering is handled by the backend (collection_id on items).
      // The review session is flashcards / learning items only — reading items
      // (documents) are reviewed in the Queue / Optimal Queue tab, never here.
      const collectionFilteredItems = items;

      // Filter by active deck selection
      const { activeDeckIds, decks } = useStudyDeckStore.getState();
      const activeDecks = activeDeckIds
        .map((id) => decks.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => d != null);
      const deckFilteredItems = activeDecks.length > 0
        ? filterByDecks(collectionFilteredItems, activeDecks)
        : collectionFilteredItems;

      const storedSession = loadStoredSession();
      const reviewedIds = new Set(storedSession?.reviewedIds ?? []);
      const pendingCards = deckFilteredItems.filter((item) => !reviewedIds.has(item.id));

      const sortByDueDate = (date: string | undefined) => {
        if (!date) return 0;
        const ts = new Date(date).getTime();
        return Number.isNaN(ts) ? 0 : ts;
      };

      const queue: ReviewSessionItem[] = [...pendingCards].sort(
        (a, b) => sortByDueDate(a.due_date) - sortByDueDate(b.due_date)
      );

      const sessionId = queue.length > 0 ? await startReview() : "";
      const firstItem = queue[0] || null;

      set({
        queue,
        currentIndex: 0,
        currentCard: firstItem,
        sessionStartTime: Date.now(),
        isLoading: false,
        reviewsCompleted: 0,
        correctCount: 0,
        sessionId,
        averageTimePerCard: 0,
        isAnswerShown: false,
        previewIntervals: null,
        reviewPhase: "question",
        pendingArenaReview: null,
        arenaPreviewError: null,
        canUndoLastReview: false,
        lastUndoError: null,
      });
      lastUndoSnapshot = null;

      if (queue.length > 0) {
        saveStoredSession({
          reviewedIds: Array.from(reviewedIds),
          sessionId,
          updatedAt: Date.now(),
        });
      } else {
        clearStoredSession();
      }

      get().loadStreak();

      if (queue.length > 0) {
        get().loadPreviewIntervals();
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load review queue",
        isLoading: false,
      });
    }
  },

  loadStreak: async () => {
    set({ streakLoading: true });
    try {
      const streak = await getReviewStreak();
      set({ streak, streakLoading: false });
    } catch (error) {
      console.error("Failed to load streak:", error);
      set({ streakLoading: false });
    }
  },

  showAnswer: () => {
    set({ isAnswerShown: true, reviewPhase: "answer" });
  },

  hideAnswer: () => {
    set({ isAnswerShown: false, reviewPhase: "question" });
  },

  submitRating: async (rating: ReviewRating, grade?: number, arenaSelection?: ArenaSelection) => {
    const state = get();
    const { currentCard, reviewMode } = state;
    if (!currentCard) return;

    const settings = useSettingsStore.getState().settings;
    const arenaEligible =
      featureFlags.reviewAlgorithmArena &&
      reviewMode === "normal" &&
      settings.learning.algorithm === "sm20" &&
      !settings.learning.sm20PureM4;
    const effectiveGrade = Math.max(0, Math.min(5, grade ?? ratingToSm20Grade(rating)));
    const arenaReviewMode = settings.learning.sm20ArenaReviewMode ?? "automatic";

    // Automatic is still an Arena review: commit the authoritative weighted
    // pick (and provenance) immediately. The fallback token deliberately asks
    // the backend to recompute from current collection state, so a background
    // sync cannot turn the zero-friction path into a stale-preview interruption.
    if (arenaEligible && arenaReviewMode === "automatic" && !arenaSelection) {
      arenaSelection = {
        commit_id: newArenaCommitId(),
        preview_id: "automatic-fallback",
        item_revision: "",
        arena_revision: "",
        source: "arena",
        decision_time_ms: 0,
      };
    }

    // Grading is intentionally non-mutating for Arena reviews. The same card,
    // answer, and queue remain on screen until an interval is confirmed.
    if (arenaEligible && arenaReviewMode === "choose" && !arenaSelection) {
      const hasGradePreview = Boolean(state.previewIntervals?.arena?.grades[effectiveGrade]);
      set({
        pendingArenaReview: {
          itemId: currentCard.id,
          rating,
          grade: effectiveGrade,
          commitId: newArenaCommitId(),
          gradedAt: Date.now(),
          recallTimeTaken: Math.floor((Date.now() - state.sessionStartTime) / 1000),
          selection: { source: "arena" },
          preview: state.previewIntervals?.arena?.grades[effectiveGrade],
        },
        reviewPhase: hasGradePreview ? "arena-ready" : "arena-loading",
        arenaPreviewError: null,
        isSubmitting: false,
        error: null,
      });
      if (!hasGradePreview) void get().loadPreviewIntervals();
      return;
    }

    const pending = state.pendingArenaReview;
    const timeTaken = pending?.recallTimeTaken
      ?? Math.floor((Date.now() - state.sessionStartTime) / 1000);
    const pendingReviewMetadata = state.pendingReviewMetadata;
    const wasCorrect = grade != null ? grade >= 3 : rating >= 3;
    const learningCard = currentCard as LearningItem;
    const storedSession = loadStoredSession();
    const reviewedIdsBefore = [...(storedSession?.reviewedIds ?? [])];
    const snapshot: ReviewUndoSnapshot = {
      queue: state.queue,
      currentIndex: state.currentIndex,
      currentCard,
      isAnswerShown: state.isAnswerShown,
      reviewsCompleted: state.reviewsCompleted,
      correctCount: state.correctCount,
      averageTimePerCard: state.averageTimePerCard,
      sessionStartTime: state.sessionStartTime,
      reviewedIdsBefore,
      learningItemState: {
        itemId: learningCard.id,
        dueDate: learningCard.due_date,
        interval: learningCard.interval,
        easeFactor: learningCard.ease_factor,
        lastReviewDate: learningCard.last_review_date,
        reviewCount: learningCard.review_count,
        lapses: learningCard.lapses,
        state: learningCard.state,
        memoryState: learningCard.memory_state ?? null,
        difficulty: learningCard.difficulty,
        algorithmType: learningCard.algorithm_type,
        algorithmState: learningCard.algorithm_state,
        arenaCommitId: arenaSelection?.commit_id,
      },
    };

    set({
      isSubmitting: true,
      reviewPhase: arenaSelection ? "arena-committing" : state.reviewPhase,
      error: null,
    });

    try {
      if (reviewMode === "normal") {
        const studyDeckState = useStudyDeckStore.getState();
        const activeDeckId = studyDeckState.activeDeckIds[0] ?? null;
        const fsrsParams = resolveFsrsParamsForScope({
          settings,
          activeDeckId,
          tags: learningCard.tags ?? [],
        });
        let arenaProvenance: ArenaReviewProvenance | undefined;
        if (arenaSelection && state.previewIntervals?.arena) {
          const arena = state.previewIntervals.arena;
          const gradePreview = arena.grades[effectiveGrade];
          if (gradePreview) {
            arenaProvenance = {
              schedule_source: arenaSelection.source,
              schedule_model_id: arenaSelection.model_id ?? null,
              arena_commit_id: arenaSelection.commit_id,
              arena_recommended_interval: gradePreview.recommendation.interval_days,
              arena_decision_time_ms: arenaSelection.decision_time_ms,
              arena_snapshot: JSON.stringify({
                version: 1,
                preview_schema_version: arena.schema_version,
                preview_id: arena.preview_id,
                item_revision: arena.item_revision,
                arena_revision: arena.arena_revision,
                grade: effectiveGrade,
                model_order: arena.model_order,
                recommendation: gradePreview.recommendation,
                candidates: gradePreview.candidates,
                custom_bounds: gradePreview.custom_bounds,
                selection_source: arenaSelection.source,
                selection_model_id: arenaSelection.model_id ?? null,
              }),
            };
          }
        }
        await submitReview(currentCard.id, rating, timeTaken, state.sessionId, {
          desiredRetention: fsrsParams.desiredRetention,
          fsrsWeights: fsrsParams.personalizedWeights,
          algorithm: settings.learning.algorithm,
          noScheduleUpdate: false,
          grade,
          sm20PureM4: settings.learning.sm20PureM4,
          arenaSelection,
          arenaProvenance,
        });
      }

      // Only now may visible session state advance.
      const newReviewsCompleted = state.reviewsCompleted + 1;
      const newCorrectCount = wasCorrect ? state.correctCount + 1 : state.correctCount;
      const newAverageTime =
        (state.reviewsCompleted * (state.averageTimePerCard || 0) + timeTaken)
        / newReviewsCompleted;
      const buryExtractId = learningCard.extract_id;
      const remainingQueue = state.queue.filter((item) => {
        if (item.id === currentCard.id) return false;
        return !buryExtractId || item.extract_id !== buryExtractId;
      });
      const reviewedIds = new Set(reviewedIdsBefore);
      reviewedIds.add(currentCard.id);
      const nextIndex = remainingQueue.length > 0
        ? Math.min(state.currentIndex, remainingQueue.length - 1)
        : 0;

      lastUndoSnapshot = snapshot;
      set((latest) => ({
        queue: remainingQueue,
        currentIndex: nextIndex,
        currentCard: remainingQueue[nextIndex] ?? null,
        isAnswerShown: false,
        isSubmitting: false,
        previewIntervals: null,
        reviewsCompleted: newReviewsCompleted,
        correctCount: newCorrectCount,
        averageTimePerCard: newAverageTime,
        sessionStartTime: Date.now(),
        pendingReviewMetadata: null,
        pendingArenaReview: null,
        reviewPhase: "question",
        arenaPreviewError: null,
        canUndoLastReview: true,
        lastUndoError: null,
        reviewEventLog: [
          ...latest.reviewEventLog,
          {
            itemId: currentCard.id,
            rating,
            timestamp: new Date().toISOString(),
            metadata: pendingReviewMetadata ?? undefined,
          },
        ],
      }));

      if (remainingQueue.length === 0) {
        clearStoredSession();
      } else {
        saveStoredSession({
          reviewedIds: Array.from(reviewedIds),
          sessionId: state.sessionId,
          updatedAt: Date.now(),
        });
        setTimeout(() => void get().loadPreviewIntervals(), 100);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to submit review";
      set({
        error: message,
        isSubmitting: false,
        reviewPhase: arenaSelection ? "arena-error" : state.reviewPhase,
        pendingArenaReview: arenaSelection && get().pendingArenaReview
          ? { ...get().pendingArenaReview!, error: message }
          : get().pendingArenaReview,
      });
      if (arenaSelection && message.includes("arena_preview_stale")) {
        void get().retryArenaPreview();
      }
    }
  },

  selectArenaChoice: (selection) => {
    const pending = get().pendingArenaReview;
    if (!pending) return;
    set({ pendingArenaReview: { ...pending, selection }, error: null });
  },

  confirmArenaSelection: async () => {
    const { pendingArenaReview: pending, previewIntervals, currentCard } = get();
    const arena = previewIntervals?.arena;
    if (!pending || !arena || currentCard?.id !== pending.itemId) return;
    const gradePreview = arena.grades[pending.grade];
    if (!gradePreview) return;
    if (pending.selection.source === "custom") {
      const interval = pending.selection.intervalDays;
      if (interval == null
        || !Number.isFinite(interval)
        || interval < gradePreview.custom_bounds.min_days
        || interval > gradePreview.custom_bounds.max_days) {
        set({
          error: `Choose an interval between ${gradePreview.custom_bounds.min_days} and ${gradePreview.custom_bounds.max_days} days`,
          pendingArenaReview: {
            ...pending,
            error: "Custom interval is outside the allowed range",
          },
        });
        return;
      }
    }

    const selection: ArenaSelection = {
      commit_id: pending.commitId,
      preview_id: arena.preview_id,
      item_revision: arena.item_revision,
      arena_revision: arena.arena_revision,
      source: pending.selection.source,
      model_id: pending.selection.modelId,
      interval_days: pending.selection.source === "custom"
        ? pending.selection.intervalDays
        : undefined,
      decision_time_ms: Math.max(0, Date.now() - pending.gradedAt),
    };
    await get().submitRating(pending.rating, pending.grade, selection);
  },

  cancelArenaDecision: () => {
    set({
      pendingArenaReview: null,
      reviewPhase: "answer",
      arenaPreviewError: null,
      isSubmitting: false,
      error: null,
    });
  },

  retryArenaPreview: async () => {
    set({ reviewPhase: "arena-loading", arenaPreviewError: null, error: null });
    await get().loadPreviewIntervals();
  },

  scheduleArenaAutomatically: async () => {
    const pending = get().pendingArenaReview;
    if (!pending) return;
    await get().submitRating(pending.rating, pending.grade, {
      commit_id: pending.commitId,
      preview_id: "automatic-fallback",
      item_revision: "",
      arena_revision: "",
      source: "arena",
      decision_time_ms: Math.max(0, Date.now() - pending.gradedAt),
    });
  },

  loadPreviewIntervals: async () => {
    const { currentCard } = get();
    if (!currentCard) return;

    try {
      const settings = useSettingsStore.getState().settings;
      const intervals = await previewReviewIntervals(
        currentCard.id,
        settings.learning.algorithm,
        settings.learning.sm20PureM4
      );
      const pending = get().pendingArenaReview;
      set({
        previewIntervals: intervals,
        arenaPreviewError: null,
        pendingArenaReview: pending
          ? { ...pending, preview: intervals.arena?.grades[pending.grade], error: undefined }
          : null,
        reviewPhase: pending
          ? (intervals.arena?.grades[pending.grade] ? "arena-ready" : "arena-error")
          : get().reviewPhase,
      });
    } catch (error) {
      console.error("Failed to load preview intervals:", error);
      if (get().pendingArenaReview) {
        set({
          reviewPhase: "arena-error",
          arenaPreviewError: error instanceof Error
            ? error.message
            : "Could not load Algorithm Arena",
          pendingArenaReview: get().pendingArenaReview
            ? {
                ...get().pendingArenaReview!,
                error: error instanceof Error ? error.message : "Could not load Algorithm Arena",
              }
            : null,
        });
      }
    }
  },

  nextCard: () => {
    if (get().pendingArenaReview) return;
    const { queue, currentIndex } = get();
    const nextIndex = currentIndex + 1;

    if (nextIndex >= queue.length) {
      set({
        currentCard: null,
        currentIndex: nextIndex,
        isAnswerShown: false,
        isSubmitting: false,
        previewIntervals: null,
        reviewPhase: "question",
        pendingArenaReview: null,
        sessionStartTime: Date.now(), // Reset for next card
      });
    } else {
      const nextItem = queue[nextIndex];
      set({
        currentIndex: nextIndex,
        currentCard: nextItem,
        isAnswerShown: false,
        isSubmitting: false,
        previewIntervals: null,
        reviewPhase: "question",
        pendingArenaReview: null,
        sessionStartTime: Date.now(), // Reset for next card
      });

      setTimeout(() => {
        get().loadPreviewIntervals();
      }, 100);
    }
  },

  goToIndex: (index: number) => {
    if (get().pendingArenaReview) return;
    const { queue } = get();
    if (queue.length === 0) {
      set({
        currentIndex: 0,
        currentCard: null,
        isAnswerShown: false,
        isSubmitting: false,
        previewIntervals: null,
        reviewPhase: "question",
        pendingArenaReview: null,
        sessionStartTime: Date.now(),
      });
      return;
    }

    const clampedIndex = Math.max(0, Math.min(index, queue.length - 1));
    const nextItem = queue[clampedIndex];
    set({
      currentIndex: clampedIndex,
      currentCard: nextItem,
      isAnswerShown: false,
      isSubmitting: false,
      previewIntervals: null,
      reviewPhase: "question",
      pendingArenaReview: null,
      sessionStartTime: Date.now(),
    });

    setTimeout(() => {
      get().loadPreviewIntervals();
    }, 100);
  },

  patchCurrentCard: (updated) => {
    const { queue, currentIndex } = get();
    if (queue[currentIndex]?.id === updated.id) {
      const nextQueue = queue.slice();
      nextQueue[currentIndex] = updated;
      set({ queue: nextQueue, currentCard: updated });
      return;
    }
    // Defensive fallback: the queue moved on (e.g. a rating landed between
    // open and save) — still keep the visible card consistent with the edit.
    set({ currentCard: updated });
  },

  removeItemFromSession: (itemId: string) => {
    const state = get();
    const removedIndex = state.queue.findIndex((item) => item.id === itemId);
    if (removedIndex === -1) return;

    const remainingQueue = state.queue.filter((item) => item.id !== itemId);
    let nextIndex = state.currentIndex;
    if (removedIndex < state.currentIndex) {
      nextIndex -= 1;
    }
    nextIndex = remainingQueue.length > 0
      ? Math.max(0, Math.min(nextIndex, remainingQueue.length - 1))
      : 0;

    set({
      queue: remainingQueue,
      currentIndex: nextIndex,
      currentCard: remainingQueue[nextIndex] ?? null,
      isAnswerShown: false,
      isSubmitting: false,
      previewIntervals: null,
      pendingReviewMetadata: null,
      pendingArenaReview: null,
      reviewPhase: "question",
      arenaPreviewError: null,
      error: null,
    });

    if (remainingQueue.length === 0) {
      clearStoredSession();
    } else {
      setTimeout(() => void get().loadPreviewIntervals(), 100);
    }
  },

  resetSession: () => {
    lastUndoSnapshot = null;
    set({
      queue: [],
      currentIndex: 0,
      currentCard: null,
      previewIntervals: null,
      reviewPhase: "question",
      pendingArenaReview: null,
      arenaPreviewError: null,
      isAnswerShown: false,
      isSubmitting: false,
      error: null,
      sessionId: "",
      reviewsCompleted: 0,
      correctCount: 0,
      sessionStartTime: 0,
      averageTimePerCard: 0,
      streak: null,
      streakLoading: false,
      reviewMode: "normal",
      canUndoLastReview: false,
      lastUndoError: null,
      pendingReviewMetadata: null,
      reviewEventLog: [],
      reviewTabMode: "home",
    });
    clearStoredSession();
  },

  startReviewAtItem: async (itemId: string) => {
    await get().loadQueue();
    const { queue } = get();
    const index = queue.findIndex((item) => item.id === itemId);
    if (index === -1) return;
    const nextItem = queue[index];
    set({
      currentIndex: index,
      currentCard: nextItem,
      isAnswerShown: false,
      isSubmitting: false,
      previewIntervals: null,
      reviewPhase: "question",
      pendingArenaReview: null,
      sessionStartTime: Date.now(),
    });
    setTimeout(() => {
      get().loadPreviewIntervals();
    }, 100);
  },

  startReviewWithQueue: async (itemIds: string[]) => {
    const orderedIds = Array.from(
      new Set(itemIds.map((itemId) => itemId.trim()).filter(Boolean))
    );
    set({
      isLoading: true,
      error: null,
      queue: [],
      currentIndex: 0,
      currentCard: null,
      reviewTabMode: "home",
    });

    try {
      const collectionId = useCollectionStore.getState().activeCollectionId;
      const dueItems = await getDueItems(collectionId);
      const dueById = new Map(dueItems.map((item) => [item.id, item]));
      const queue = orderedIds
        .map((itemId) => dueById.get(itemId))
        .filter((item): item is ReviewSessionItem => item != null);
      const sessionId = queue.length > 0 ? await startReview() : "";

      set({
        queue,
        currentIndex: 0,
        currentCard: queue[0] ?? null,
        sessionStartTime: Date.now(),
        isLoading: false,
        reviewsCompleted: 0,
        correctCount: 0,
        sessionId,
        averageTimePerCard: 0,
        isAnswerShown: false,
        isSubmitting: false,
        previewIntervals: null,
        reviewPhase: "question",
        pendingArenaReview: null,
        arenaPreviewError: null,
        canUndoLastReview: false,
        lastUndoError: null,
        pendingReviewMetadata: null,
        reviewEventLog: [],
        reviewMode: "normal",
        reviewTabMode: queue.length > 0 ? "session" : "home",
      });
      lastUndoSnapshot = null;

      if (queue.length > 0) {
        saveStoredSession({
          reviewedIds: [],
          sessionId,
          updatedAt: Date.now(),
        });
        void get().loadStreak();
        void get().loadPreviewIntervals();
      } else {
        clearStoredSession();
        set({ error: "No cards from this review queue are currently available." });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to start review queue",
        isLoading: false,
        reviewTabMode: "home",
      });
    }
  },

  studyDocumentCards: async (documentId: string) => {
    set({ isLoading: true, error: null });
    try {
      const cards = await getLearningItems(documentId);
      if (cards.length === 0) {
        set({ isLoading: false });
        return;
      }
      const queue = cards as unknown as ReviewSessionItem[];
      const sessionId = await startReview();
      set({
        queue,
        currentIndex: 0,
        currentCard: queue[0],
        isAnswerShown: false,
        isLoading: false,
        reviewsCompleted: 0,
        correctCount: 0,
        sessionId,
        averageTimePerCard: 0,
        sessionStartTime: Date.now(),
        isSubmitting: false,
        previewIntervals: null,
        reviewPhase: "question",
        pendingArenaReview: null,
        arenaPreviewError: null,
      });
    } catch (error) {
      set({ isLoading: false, error: error instanceof Error ? error.message : "Failed to load cards" });
    }
  },

  getEstimatedTimeRemaining: () => {
    const { queue, currentIndex, averageTimePerCard } = get();
    const remainingCards = queue.length - currentIndex;

    if (averageTimePerCard > 0) {
      return Math.round(remainingCards * averageTimePerCard);
    }

    // Default estimate: 30 seconds per card
    return remainingCards * 30;
  },

  setReviewMode: (mode) => {
    set({ reviewMode: mode });
  },

  setPendingReviewMetadata: (metadata) => {
    set({ pendingReviewMetadata: metadata });
  },

  undoLastReview: async () => {
    const snapshot = lastUndoSnapshot;
    if (!snapshot) return;

    try {
      if (snapshot.learningItemState) {
        await restoreLearningItemState(snapshot.learningItemState.itemId, {
          dueDate: snapshot.learningItemState.dueDate,
          interval: snapshot.learningItemState.interval,
          easeFactor: snapshot.learningItemState.easeFactor,
          lastReviewDate: snapshot.learningItemState.lastReviewDate,
          reviewCount: snapshot.learningItemState.reviewCount,
          lapses: snapshot.learningItemState.lapses,
          state: snapshot.learningItemState.state,
          memoryState: snapshot.learningItemState.memoryState,
          difficulty: snapshot.learningItemState.difficulty,
          algorithmType: snapshot.learningItemState.algorithmType,
          algorithmState: snapshot.learningItemState.algorithmState,
          arenaCommitId: snapshot.learningItemState.arenaCommitId,
        });
      }

      set({
        queue: snapshot.queue,
        currentIndex: snapshot.currentIndex,
        currentCard: snapshot.currentCard,
        isAnswerShown: snapshot.isAnswerShown,
        reviewsCompleted: snapshot.reviewsCompleted,
        correctCount: snapshot.correctCount,
        averageTimePerCard: snapshot.averageTimePerCard,
        sessionStartTime: snapshot.sessionStartTime,
        canUndoLastReview: false,
        lastUndoError: null,
      });

      saveStoredSession({
        reviewedIds: snapshot.reviewedIdsBefore,
        sessionId: get().sessionId,
        updatedAt: Date.now(),
      });

      lastUndoSnapshot = null;
    } catch (error) {
      set({
        lastUndoError: error instanceof Error ? error.message : "Failed to undo review",
      });
    }
  },
}));
