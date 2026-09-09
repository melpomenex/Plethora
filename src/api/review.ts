import { invokeCommand } from "../lib/tauri";
import type { LearningItemInteractionMetadata } from "../types/learningItemInteractions";
import type { LearningSettings } from "../stores/settingsStore";
import type { ArenaModelId } from "../lib/schedulerIdentity";

export type { ArenaModelId } from "../lib/schedulerIdentity";

export const ARENA_SCHEMA_VERSION = 1 as const;

export const ARENA_MODEL_ORDER = [
  "m1",
  "m2",
  "m3",
  "m4",
  "m5",
] as const satisfies readonly ArenaModelId[];

export type NativeGrade = 0 | 1 | 2 | 3 | 4 | 5;
export type ArenaSelectionSource = "arena" | "model" | "custom";

export interface ArenaIntervalChoice {
  interval_days: number;
  due_at: string;
}

export interface ArenaModelCandidate extends ArenaIntervalChoice {
  model_id: ArenaModelId;
  label: string;
  weight_percent: number;
  personalized: boolean;
}

export interface ArenaIntervalRange {
  min_days: number;
  max_days: number;
}

export interface ArenaGradePreview {
  grade: NativeGrade;
  recommendation: ArenaIntervalChoice;
  candidates: ArenaModelCandidate[];
  range: ArenaIntervalRange;
  custom_bounds: ArenaIntervalRange;
}

export interface ArenaPreviewSet {
  schema_version: typeof ARENA_SCHEMA_VERSION;
  preview_id: string;
  item_revision: string;
  arena_revision: string;
  generated_at: string;
  model_order: ArenaModelId[];
  grades: ArenaGradePreview[];
}

export interface ArenaSelection {
  commit_id: string;
  preview_id: string;
  item_revision: string;
  arena_revision: string;
  source: ArenaSelectionSource;
  model_id?: ArenaModelId;
  /** Required for custom selections and ignored for model selections. */
  interval_days?: number;
  decision_time_ms: number;
}

export interface ArenaReviewProvenance {
  schedule_source?: ArenaSelectionSource | null;
  schedule_model_id?: ArenaModelId | null;
  arena_commit_id?: string | null;
  arena_recommended_interval?: number | null;
  arena_decision_time_ms?: number | null;
  arena_snapshot?: string | null;
}

export interface PreviewIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
  /** Native per-grade intervals (index = grade 0-5). Present for six-grade schedulers. */
  grade_intervals?: number[];
  /** Full Algorithm Arena decision data. Present only for Precision Arena mode. */
  arena?: ArenaPreviewSet;
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
    algorithm?: LearningSettings["algorithm"];
    noScheduleUpdate?: boolean;
    /** Native six-grade (0-5). When set, the backend schedules with this
     * grade directly instead of mapping the 4-button rating. */
    grade?: number;
    precisionPureKernel?: boolean;
    arenaSelection?: ArenaSelection;
    /** Sync-only copy. Native persistence uses an authoritative recomputation. */
    arenaProvenance?: ArenaReviewProvenance;
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
    sm20_pure_m4: options?.precisionPureKernel,
    precisionPureKernel: options?.precisionPureKernel,
    arena_selection: options?.arenaSelection,
    arenaSelection: options?.arenaSelection,
  });

  // Replicate the review to other devices. Fire-and-forget — never blocks the
  // review UX on sync, and never fails the review if sync is offline. The card
  // row (with its new due_date/reps/stability) is published with a fresh sync
  // clock so the receiver's last-writer-wins merge takes it; the review event
  // is appended to the revlog under a deterministic id so two devices reviewing
  // the same card both count once.
  if (!options?.noScheduleUpdate) {
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
    algorithmType?: string;
    algorithmState?: string;
    arenaCommitId?: string;
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
    algorithm_type: previousState.algorithmType,
    algorithmType: previousState.algorithmType,
    algorithm_state: previousState.algorithmState,
    algorithmState: previousState.algorithmState,
    arena_commit_id: previousState.arenaCommitId,
    arenaCommitId: previousState.arenaCommitId,
  });
}

export async function getDueItems(collectionId?: string): Promise<LearningItem[]> {
  return await invokeCommand<LearningItem[]>("get_due_items", { collectionId });
}

export async function previewReviewIntervals(
  itemId: string,
  algorithm?: string,
  precisionPureKernel?: boolean
): Promise<PreviewIntervals> {
  return await invokeCommand<PreviewIntervals>("preview_review_intervals", {
    item_id: itemId,
    itemId,
    algorithm,
    sm20_pure_m4: precisionPureKernel,
    precisionPureKernel,
  });
}

export async function getReviewStreak(): Promise<ReviewStreak> {
  return await invokeCommand<ReviewStreak>("get_review_streak");
}

// ── Algorithm Arena + per-user optimizers ───────────────────────────────────

/** Live Algorithm Arena snapshot: adaptive weights over the five
 * competitors (Classic / Classic 15 / Classic 19 / Precision / FSRS) plus the R-Metric. */
export interface ArenaStats {
  model_names: string[];
  /** Blend weights, sum 100, slot order matches model_names. */
  weights: number[];
  /** Mean decayed log-loss per model (null until enough scored reviews). */
  mean_losses: number[] | null;
  /** % log-loss improvement of the blend over baseline alone. */
  r_metric: number | null;
  total_scored: number;
  fsrs_optimized: boolean;
  m4_optimized: boolean;
}

export async function getArenaStats(): Promise<ArenaStats> {
  return await invokeCommand<ArenaStats>("get_arena_stats");
}

export interface FsrsOptimizeSummary {
  accepted: boolean;
  items: number;
  train_items: number;
  message: string;
}

/** Fit per-user FSRS parameters for the Arena's FSRS competitor. */
export async function optimizeArenaFsrs(): Promise<FsrsOptimizeSummary> {
  return await invokeCommand<FsrsOptimizeSummary>("optimize_arena_fsrs");
}

export interface PrecisionOptimizeOutcome {
  accepted: boolean;
  params?: number[] | null;
  items: number;
  train_predictions: number;
  val_predictions: number;
  val_loss_before: number;
  val_loss_after: number;
  iterations: number;
  message: string;
}

export type M4OptimizeOutcome = PrecisionOptimizeOutcome;

/** Fit the Precision kernel parameters to the user's review history. */
export async function optimizePrecisionKernel(): Promise<PrecisionOptimizeOutcome> {
  return await invokeCommand<PrecisionOptimizeOutcome>("optimize_precision_kernel");
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
  /** Serialized `CardSourceReference` JSON — provenance for extract-less cards. */
  source_reference?: string | null;
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
