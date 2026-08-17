/**
 * RelevanceIndicator
 * Displays relevance score as a colored dot on queue items
 * Green = high relevance (>0.7), Red = low relevance (<0.3), Gray = neutral
 *
 * When `reason` is provided (semantic preference drove the placement), the
 * tooltip explains it via the driving liked/disliked exemplar article.
 */

interface RelevanceReason {
  score?: number | null;
  driver_exemplar_title?: string | null;
  driver_sentiment?: "like" | "dislike" | null;
}

interface RelevanceIndicatorProps {
  score?: number | null;
  reason?: RelevanceReason;
  className?: string;
}

function reasonLine(reason: RelevanceReason): string | null {
  const title = reason.driver_exemplar_title?.trim();
  if (!title) return null;
  return reason.driver_sentiment === "dislike"
    ? `less like “${title}”`
    : `you liked articles like “${title}”`;
}

export function RelevanceIndicator({ score, reason, className = "" }: RelevanceIndicatorProps) {
  if (score == null) {
    return null;
  }

  const suffix = reason ? reasonLine(reason) : null;
  const withReason = (label: string) =>
    suffix ? `${label} — ${suffix}` : `${label} (${(score * 100).toFixed(0)}%)`;

  if (score > 0.7) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full bg-emerald-500 ${className}`}
        title={withReason("High relevance")}
      />
    );
  }

  if (score < 0.3) {
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full bg-red-400 ${className}`}
        title={withReason("Low relevance")}
      />
    );
  }

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 ${className}`}
      title={withReason("Neutral relevance")}
    />
  );
}
