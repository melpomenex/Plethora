import { invokeCommand } from "../lib/tauri";
import type { LearningItemInteractionMetadata } from "../types/learningItemInteractions";

export interface PreviewIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
  /** Native per-grade intervals (index = grade 0-5). Present only for
   * algorithms with a native grade scale (currently SM-20). */
  grade_intervals?: number[];
}

export interface ReviewStreak {
  current_streak: number;
  longest_streak: number;
  total_reviews: number;
  last_review_date?: string;
}

export async function startReview(): Promise<string> {
  return await invokeCommand<string>("start_review");
}

export async function submitReview(
  itemId: string,
  rating: number,
  timeTaken: number,
  sessionId?: string,
  options?: {
    desiredRetention?: number;
    fsrsWeights?: number[];
    algorithm?: "fsrs" | "sm2" | "sm18" | "sm20";
    noScheduleUpdate?: boolean;
    /** Native SM-20 grade (0-5). When set, the backend schedules with this
     * grade directly instead of mapping the 4-button rating. */
    grade?: number;
  }
): Promise<LearningItem> {
  const normalizedSessionId = sessionId?.trim() ? sessionId : undefined;
  const updated = await invokeCommand<LearningItem>("submit_review", {
    item_id: itemId,
    itemId,
    rating,
    time_taken: timeTaken,
    timeTaken,
    session_id: normalizedSessionId,
    sessionId: normalizedSessionId,
    desired_retention: options?.desiredRetention,
    desiredRetention: options?.desiredRetention,
    fsrs_weights: options?.fsrsWeights,
    fsrsWeights: options?.fsrsWeights,
    algorithm: options?.algorithm,
    no_schedule_update: options?.noScheduleUpdate,
    noScheduleUpdate: options?.noScheduleUpdate,
    grade: options?.grade,
  });

  // Replicate the review to other devices. Fire-and-forget — never blocks the
  // review UX on sync, and never fails the review if sync is offline. The card
  // row (with its new due_date/reps/stability) is published with a fresh sync
  // clock so the receiver's last-writer-wins merge takes it; the review event
  // is appended to the revlog under a deterministic id so two devices reviewing
  // the same card both count once.
  if (!options?.noScheduleUpdate) {
    void (async () => {
      try {
        const { publishCard, publishReview, toSyncedLearningItem } = await import("../lib/sync/entities/flashcards");
        const { nowHLC } = await import("../lib/sync/syncClock");
        const synced = toSyncedLearningItem(updated as unknown as Record<string, unknown>);
        synced.updated_at = nowHLC();
        await Promise.all([
          publishCard(synced),
          publishReview({
            itemId,
            collectionId: synced.collection_id,
            rating,
            timeTaken,
            resultDueDate: synced.due_date,
            resultInterval: synced.interval,
            resultEase: synced.ease_factor,
            sessionId: normalizedSessionId,
          }),
        ]);
      } catch (err) {
        console.warn("[review] sync publish failed (non-fatal)", err);
      }
    })();
  }

  return updated;
}

export async function restoreLearningItemState(
  itemId: string,
  previousState: {
    dueDate: string;
    interval: number;
    easeFactor: number;
    lastReviewDate?: string;
    reviewCount: number;
    lapses: number;
    state: string;
    memoryState?: { stability: number; difficulty: number } | null;
    difficulty: number;
  }
): Promise<LearningItem> {
  return await invokeCommand<LearningItem>("restore_learning_item_state", {
    item_id: itemId,
    itemId,
    due_date: previousState.dueDate,
    dueDate: previousState.dueDate,
    interval: previousState.interval,
    ease_factor: previousState.easeFactor,
    easeFactor: previousState.easeFactor,
    last_review_date: previousState.lastReviewDate,
    lastReviewDate: previousState.lastReviewDate,
    review_count: previousState.reviewCount,
    reviewCount: previousState.reviewCount,
    lapses: previousState.lapses,
    state: previousState.state,
    memory_state: previousState.memoryState ?? null,
    memoryState: previousState.memoryState ?? null,
    difficulty: previousState.difficulty,
  });
}

export async function getDueItems(collectionId?: string): Promise<LearningItem[]> {
  return await invokeCommand<LearningItem[]>("get_due_items", { collectionId });
}

export async function previewReviewIntervals(
  itemId: string,
  algorithm?: string
): Promise<PreviewIntervals> {
  return await invokeCommand<PreviewIntervals>("preview_review_intervals", {
    item_id: itemId,
    itemId,
    algorithm,
  });
}

export async function getReviewStreak(): Promise<ReviewStreak> {
  return await invokeCommand<ReviewStreak>("get_review_streak");
}

export interface CardSourceContext {
  document_id: string;
  document_title: string;
  extract_id?: string;
  extract_snippet?: string;
  page_number?: number;
  source_url?: string;
}

/**
 * Resolve the source context (document title + extract snippet) for a
 * learning item, so review cards can show provenance. Returns null when the
 * card has no resolvable source.
 */
export async function getCardSourceContext(
  itemId: string
): Promise<CardSourceContext | null> {
  return await invokeCommand<CardSourceContext | null>(
    "get_card_source_context",
    { itemId, item_id: itemId }
  );
}

export interface LearningItem {
  id: string;
  extract_id?: string;
  document_id?: string;
  item_type: "flashcard" | "cloze" | "qa" | "basic" | "Cloze";
  question: string;
  answer?: string;
  cloze_text?: string;
  cloze_ranges?: [number, number][];
  difficulty: number;
  interval: number;
  ease_factor: number;
  due_date: string;
  date_created: string;
  date_modified: string;
  last_review_date?: string;
  review_count: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  is_suspended: boolean;
  tags: string[];
  memory_state?: {
    stability: number;
    difficulty: number;
  };
  algorithm_type?: string;
  algorithm_state?: string;
  interaction_metadata?: LearningItemInteractionMetadata;
  source_anchor?: {
    document_id?: string;
    extract_id?: string;
    page_number?: number;
    start_offset?: number;
    end_offset?: number;
  };
}

export type ReviewRating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export const RATING_LABELS: Record<ReviewRating, string> = {
  1: "Again",
  2: "Hard",
  3: "Good",
  4: "Easy",
};

export const RATING_COLORS: Record<ReviewRating, string> = {
  1: "bg-red-500 hover:bg-red-600",
  2: "bg-orange-500 hover:bg-orange-600",
  3: "bg-blue-500 hover:bg-blue-600",
  4: "bg-green-500 hover:bg-green-600",
};

export function formatInterval(days: number): string {
  if (days < 1) return "< 1 day";
  if (days === 1) return "1 day";
  if (days < 30) {
    const formatted = days.toFixed(1);
    return `${formatted.endsWith(".0") ? Math.round(days) : formatted} days`;
  }
  const months = days / 30;
  if (days < 365) {
    const formatted = months.toFixed(1);
    return `${formatted.endsWith(".0") ? Math.round(months) : formatted} months`;
  }
  const years = days / 365;
  const formatted = years.toFixed(1);
  return `${formatted.endsWith(".0") ? Math.round(years) : formatted} years`;
}
