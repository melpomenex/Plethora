/**
 * Single source of truth for the SuperMemo native 0-5 grade scale shared by
 * the rating buttons, the touch joystick, the keyboard handlers, and the
 * queue/review submission pipelines.
 *
 * Grades 0-2 are fail variants, 3-5 are pass variants. Each grade carries the
 * equivalent 4-button rating (Again/Hard/Good/Easy) used for the legacy
 * `rating` field, stats, and history.
 */

import { useSettingsStore, type LearningSettings } from "../stores/settingsStore";
import type { ReviewRating, SM20NativeGrade } from "../api/review";

export type { ReviewRating, SM20NativeGrade };
export { RATING_LABELS, RATING_COLORS } from "../api/review";

/** Equivalent 4-button rating for a native grade (0/1/2→1, 3→2, 4→3, 5→4). */
export function gradeToRating(grade: SM20NativeGrade): ReviewRating {
  return (grade < 3 ? 1 : grade - 1) as ReviewRating;
}

/** The 6 grades in ascending order with their labels, tooltips, and colors. */
export interface SuperMemoGrade {
  grade: SM20NativeGrade;
  rating: ReviewRating;
  /** i18n key for the short label (e.g. "review.grade3" → "Hard"). */
  labelKey: string;
  /** i18n key for the tooltip/aria description. */
  descriptionKey: string;
  /** Tailwind background class for the tappable grid buttons. */
  color: string;
}

export const SUPERMEMO_GRADES: SuperMemoGrade[] = [
  {
    grade: 0,
    rating: 1,
    labelKey: "review.grade0",
    descriptionKey: "ratingButtons.grade0Description",
    color: "bg-red-700 hover:bg-red-800",
  },
  {
    grade: 1,
    rating: 1,
    labelKey: "review.grade1",
    descriptionKey: "ratingButtons.grade1Description",
    color: "bg-red-500 hover:bg-red-600",
  },
  {
    grade: 2,
    rating: 1,
    labelKey: "review.grade2",
    descriptionKey: "ratingButtons.grade2Description",
    color: "bg-orange-500 hover:bg-orange-600",
  },
  {
    grade: 3,
    rating: 2,
    labelKey: "review.grade3",
    descriptionKey: "ratingButtons.grade3Description",
    color: "bg-amber-500 hover:bg-amber-600",
  },
  {
    grade: 4,
    rating: 3,
    labelKey: "review.grade4",
    descriptionKey: "ratingButtons.grade4Description",
    color: "bg-blue-500 hover:bg-blue-600",
  },
  {
    grade: 5,
    rating: 4,
    labelKey: "review.grade5",
    descriptionKey: "ratingButtons.grade5Description",
    color: "bg-green-500 hover:bg-green-600",
  },
];

/** Equivalent native grade for an advisory 4-button rating suggestion. */
export const SUGGESTED_GRADE_BY_RATING: Record<ReviewRating, SM20NativeGrade> = {
  1: 1,
  2: 3,
  3: 4,
  4: 5,
};

// ── Rating schema (scheduler capability) ────────────────────────────────────

/** The rating scale the active scheduling algorithm grades natively on. */
export interface RatingSchema {
  /** `supermemo` = native 0-5 grade scale; `four-grade` = 1-4 Anki-style. */
  type: "supermemo" | "four-grade";
  /** The grade/rating values the UI offers, in display order. */
  grades: number[];
}

export const SUPERMEMO_RATING_SCHEMA: RatingSchema = {
  type: "supermemo",
  grades: [0, 1, 2, 3, 4, 5],
};

export const FOUR_GRADE_RATING_SCHEMA: RatingSchema = {
  type: "four-grade",
  grades: [1, 2, 3, 4],
};

/**
 * Derive the rating schema from the active scheduling algorithm. SM-18 and
 * SM-20 grade natively on the SuperMemo 0-5 scale; every other scheduler uses
 * the four-button scale. Register future six-grade schedulers here — view
 * code must never hard-code algorithm-name checks.
 */
export function getRatingSchema(
  algorithm: LearningSettings["algorithm"] | undefined,
): RatingSchema {
  return algorithm === "sm18" || algorithm === "sm20"
    ? SUPERMEMO_RATING_SCHEMA
    : FOUR_GRADE_RATING_SCHEMA;
}

/** Reactive `getRatingSchema` over the settings store. */
export function useRatingSchema(): RatingSchema {
  return useSettingsStore((state) =>
    getRatingSchema(state.settings.learning.algorithm),
  );
}
