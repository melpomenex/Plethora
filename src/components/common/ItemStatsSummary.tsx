import { CircleNotch } from "@phosphor-icons/react";
import type { ItemStatsSummary as ItemStatsSummaryPayload } from "../../api/item-stats";
import { useI18n } from "../../lib/i18n";
import { formatDate } from "../../utils/date";
import { formatDurationCompact } from "../../utils/date";
import { formatMetric } from "../../utils/itemStats";

/**
 * The at-a-glance investment summary shown above the scheduling grid in the
 * Details popover.
 *
 * At most six values, and it never blocks the popover: the surrounding content
 * renders immediately while this streams in behind its own loading state. That
 * is why it takes `summary` and `isLoading` rather than fetching for itself —
 * the caller owns when the request starts.
 */

interface ItemStatsSummaryProps {
  summary: ItemStatsSummaryPayload | null;
  isLoading: boolean;
  error?: string | null;
}

export function ItemStatsSummaryBlock({ summary, isLoading, error }: ItemStatsSummaryProps) {
  const { t } = useI18n();
  const notRecorded = t("itemStats.notRecorded");

  if (isLoading) {
    return (
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-xs text-muted-foreground">{t("itemStats.summaryTitle")}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CircleNotch className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          {t("itemStats.loading")}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-border pt-3 space-y-2">
        <div className="text-xs text-muted-foreground">{t("itemStats.summaryTitle")}</div>
        <div className="text-xs text-destructive">{t("itemStats.error")}</div>
      </div>
    );
  }

  if (!summary) return null;

  const totalTime = formatMetric(summary.totalActiveSeconds, formatDurationCompact, notRecorded);
  const repetitions = formatMetric(summary.repetitions, (value) => `${value}`, notRecorded);
  const averageTime = formatMetric(
    summary.averageSecondsPerRepetition,
    formatDurationCompact,
    notRecorded,
  );
  const firstInteraction = formatMetric(
    summary.firstInteractionAt,
    (value) => formatDate(value),
    notRecorded,
  );

  const cells = [
    { key: "total", label: t("itemStats.totalTime"), text: totalTime },
    { key: "reps", label: t("itemStats.repetitions"), text: repetitions },
    { key: "average", label: t("itemStats.averagePerRepetition"), text: averageTime },
  ].filter((cell): cell is { key: string; label: string; text: string } => cell.text !== null);

  // Every metric omitted means this item type has none of them — say so once
  // rather than rendering an empty block.
  if (cells.length === 0 && firstInteraction === null) {
    return null;
  }

  return (
    <div className="border-t border-border pt-3 space-y-2" data-testid="item-stats-summary">
      <div className="text-xs text-muted-foreground">{t("itemStats.summaryTitle")}</div>

      {cells.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          {cells.map((cell) => (
            <div key={cell.key}>
              <div className="text-muted-foreground">{cell.label}</div>
              <div className="font-semibold text-foreground">{cell.text}</div>
            </div>
          ))}
        </div>
      )}

      {firstInteraction !== null && (
        <div className="text-xs text-muted-foreground">
          {summary.firstInteractionAt.state === "value"
            ? t("itemStats.investedSince", { date: firstInteraction })
            : t("itemStats.notRecordedHint")}
        </div>
      )}
    </div>
  );
}
