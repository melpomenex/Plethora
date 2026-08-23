import { PreviewIntervals, formatInterval } from "../../api/review";
import {
  ArrowCounterClockwise,
  Lightning,
  Prohibit,
  ThumbsDown,
  ThumbsUp,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import {
  SIX_GRADES,
  SUGGESTED_GRADE_BY_RATING,
  type ReviewRating,
} from "../../lib/rating-grades";

interface RatingButtonsProps {
  /** `grade` is set (0-5) when the native six-grade scale is active. */
  onSelectRating: (rating: ReviewRating, grade?: number) => void;
  disabled?: boolean;
  previewIntervals?: PreviewIntervals | null;
  /** Render the algorithm's native 0-5 grade scale instead of the
   *  4-button scale. */
  gradeScale?: boolean;
  /**
   * EXPERIMENTAL (`aiAutoGradeSuggest`, default off): advisory highlight of
   * the assessment-suggested rating. Visual emphasis ONLY — the suggestion
   * is never clicked or submitted on the user's behalf (spec:
   * "Auto-grade suggestion is advisory").
   */
  suggestedRating?: ReviewRating;
}

/** Per-grade icon for the tappable grid (presentation detail; the shared
 * grade semantics live in `lib/rating-grades`). */
const GRADE_ICON: Record<number, typeof ArrowCounterClockwise> = {
  0: Prohibit,
  1: X,
  2: ArrowCounterClockwise,
  3: ThumbsDown,
  4: ThumbsUp,
  5: Lightning,
};

/** Native grades (0-2 fail, 3-5 pass) joined with their grid icons. */
const GRADE_BUTTONS = SIX_GRADES.map((g) => ({
  ...g,
  icon: GRADE_ICON[g.grade],
}));

const BUTTON_CLASS = `
  text-white rounded-lg transition-all
  hover:shadow-lg hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
  flex items-center justify-center gap-1 md:flex-col md:gap-2
  px-1 py-2 md:px-2 md:py-3 md:min-h-[100px]
  touch-manipulation
  focus-visible:ring-4 focus-visible:ring-white/50 focus-visible:outline-none
  focus-visible:scale-[1.02]
`;

/** Compact variant for the 0-5 grade scale: six buttons must fit in one row
 *  on desktop (Review footer, flashcard cards) without crowding the card,
 *  and stay unobtrusive on the phone where the joystick is the primary path. */
const GRADE_BUTTON_CLASS = `
  text-white rounded-lg transition-all
  hover:shadow-lg hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed
  flex items-center justify-center gap-1 md:flex-col md:gap-0.5
  px-1 py-1.5 md:px-1.5 md:py-2 md:min-h-[52px]
  touch-manipulation
  focus-visible:ring-4 focus-visible:ring-white/50 focus-visible:outline-none
  focus-visible:scale-[1.02]
`;

export function RatingButtons({
  onSelectRating,
  disabled = false,
  previewIntervals,
  gradeScale = false,
  suggestedRating,
}: RatingButtonsProps) {
  const { t } = useI18n();
  const suggestedGrade =
    suggestedRating != null ? SUGGESTED_GRADE_BY_RATING[suggestedRating] : undefined;

  if (gradeScale) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-1 md:gap-1.5">
          {GRADE_BUTTONS.map((entry) => {
            const Icon = entry.icon;
            const label = t(entry.labelKey);
            const description = t(entry.descriptionKey);
            const interval = previewIntervals?.grade_intervals?.[entry.grade] != null
              ? formatInterval(previewIntervals.grade_intervals[entry.grade])
              : null;
            const isSuggested = suggestedGrade === entry.grade;

            return (
              <button
                key={entry.grade}
                data-review-rating={entry.grade}
                data-showcase-action={entry.rating === 3 ? "grade-good" : undefined}
                data-suggested={isSuggested ? "true" : undefined}
                onClick={() => onSelectRating(entry.rating, entry.grade)}
                disabled={disabled}
                aria-keyshortcuts={String(entry.grade)}
                title={
                  isSuggested
                    ? `${t("ratingButtons.rateAsTitle", { label: `${entry.grade} — ${label}`, description })} — ${t("aiRecall.suggestedGrade")}`
                    : t("ratingButtons.rateAsTitle", { label: `${entry.grade} — ${label}`, description })
                }
                className={`${entry.color} ${GRADE_BUTTON_CLASS} ${
                  isSuggested ? "ring-4 ring-white/70" : ""
                }`}
                aria-label={
                  interval
                    ? t("ratingButtons.rateAsWithInterval", {
                        label: `${entry.grade} — ${label}`,
                        description,
                        interval,
                      })
                    : t("ratingButtons.rateAs", { label: `${entry.grade} — ${label}`, description })
                }
              >
                <Icon className="w-3.5 h-3.5 md:w-4 md:h-4 flex-shrink-0" aria-hidden="true" />
                <span className="font-semibold text-[11px] md:text-xs leading-tight">
                  {entry.grade} {label}
                </span>
                {interval && (
                  <span
                    className="text-[9px] md:text-[10px] opacity-90 md:mt-0 leading-tight"
                    aria-label={t("ratingButtons.nextReviewIn", { interval })}
                  >
                    {interval}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Keyboard shortcuts hint - hide on mobile */}
        <div className="mt-2 md:mt-2.5 text-center text-sm text-muted-foreground hidden md:block">
          {t("ratingButtons.press")}{" "}
          {GRADE_BUTTONS.map((entry) => (
            <kbd
              key={entry.grade}
              className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1 first:ml-0"
            >
              {entry.grade}
            </kbd>
          ))}
          {" "}{t("ratingButtons.toRate")}
        </div>
      </div>
    );
  }

  const ratings: {
    value: ReviewRating;
    label: string;
    icon: typeof ArrowCounterClockwise;
    color: string;
    description: string;
  }[] = [
    {
      value: 1,
      label: t("review.again"),
      icon: ArrowCounterClockwise,
      color: "bg-red-500 hover:bg-red-600",
      description: t("ratingButtons.againDescription"),
    },
    {
      value: 2,
      label: t("review.hard"),
      icon: ThumbsDown,
      color: "bg-orange-500 hover:bg-orange-600",
      description: t("ratingButtons.hardDescription"),
    },
    {
      value: 3,
      label: t("review.good"),
      icon: ThumbsUp,
      color: "bg-blue-500 hover:bg-blue-600",
      description: t("ratingButtons.goodDescription"),
    },
    {
      value: 4,
      label: t("review.easy"),
      icon: Lightning,
      color: "bg-green-500 hover:bg-green-600",
      description: t("ratingButtons.easyDescription"),
    },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="grid grid-cols-4 gap-1.5 md:gap-3">
        {ratings.map((rating) => {
          const Icon = rating.icon;
          const interval = previewIntervals
            ? formatInterval(
                previewIntervals[
                  rating.value === 1
                    ? "again"
                    : rating.value === 2
                      ? "hard"
                      : rating.value === 3
                        ? "good"
                        : "easy"
                ]
              )
            : null;

          return (
            <button
              key={rating.value}
              data-review-rating={rating.value}
              data-showcase-action={rating.value === 3 ? "grade-good" : undefined}
              data-suggested={suggestedRating === rating.value ? "true" : undefined}
              onClick={() => onSelectRating(rating.value)}
              disabled={disabled}
              aria-keyshortcuts={String(rating.value)}
              className={`${rating.color} ${BUTTON_CLASS} md:px-4 ${
                suggestedRating === rating.value ? "ring-4 ring-white/70" : ""
              }`}
              title={
                suggestedRating === rating.value
                  ? `${t("ratingButtons.rateAsTitle", { label: rating.label, description: rating.description })} — ${t("aiRecall.suggestedGrade")}`
                  : t("ratingButtons.rateAsTitle", { label: rating.label, description: rating.description })
              }
              aria-label={
                interval
                  ? t("ratingButtons.rateAsWithInterval", {
                      label: rating.label,
                      description: rating.description,
                      interval,
                    })
                  : t("ratingButtons.rateAs", { label: rating.label, description: rating.description })
              }
            >
              <Icon className="w-4 h-4 md:w-6 md:h-6 flex-shrink-0" aria-hidden="true" />
              <span className="font-semibold text-xs md:text-base leading-tight">{rating.label}</span>
              {interval && (
                <span
                  className="text-[9px] md:text-xs opacity-90 md:mt-0 leading-tight"
                  aria-label={t("ratingButtons.nextReviewIn", { interval })}
                >
                  {interval}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Keyboard shortcuts hint - hide on mobile */}
      <div className="mt-3 md:mt-4 text-center text-sm text-muted-foreground hidden md:block">
        {t("ratingButtons.press")} <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">1</kbd>
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1">2</kbd>
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1">3</kbd>
        <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs ml-1">4</kbd>
        {" "}{t("ratingButtons.toRate")}
      </div>
    </div>
  );
}
