import { memo } from "react";
import {
  BookOpen,
  Brain,
  Stack,
  Clock,
  Warning,
  FolderSimple,
  Tag,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import type { ScheduleDayItem } from "../../types/queue";
import {
  buildItemPresentation,
  type MetricSeverity,
} from "../../lib/scheduleItemPresentation";
import { localDateKey } from "../../lib/scheduleViewModel";
import {
  actionAppliesTo,
  runScheduleAction,
  type ScheduleActionCallbacks,
} from "../../lib/scheduleActions";

const TYPE_ICONS = {
  document: BookOpen,
  extract: Stack,
  learning: Brain,
} as const;

/** Map a metric severity to semantic Tailwind classes (never color alone). */
export function severityClasses(severity: MetricSeverity): string {
  switch (severity) {
    case "danger":
      return "text-destructive";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    case "good":
      return "text-emerald-600 dark:text-emerald-400";
    default:
      return "text-muted-foreground";
  }
}

interface ScheduleItemDetailsProps {
  item: ScheduleDayItem;
  callbacks: ScheduleActionCallbacks;
  /** true while a mutation for this item is in flight */
  busy?: boolean;
  className?: string;
}

/**
 * Shared expanded detail region: complete labeled metrics, tags/category, and
 * the open/study action. Used by both Agenda and Data grid rows.
 */
export const ScheduleItemDetails = memo(function ScheduleItemDetails({
  item,
  callbacks,
  busy = false,
  className,
}: ScheduleItemDetailsProps) {
  const { t } = useI18n();
  const p = buildItemPresentation(item, localDateKey(new Date()), t);
  const TypeIcon = TYPE_ICONS[p.type.icon] ?? BookOpen;

  const metricRow = (
    label: string,
    value: string | undefined | null,
    severity: MetricSeverity = "neutral",
    icon?: React.ReactNode,
  ) =>
    value != null ? (
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
          {icon}
          {label}
        </span>
        <span
          className={cn(
            "font-mono tabular-nums text-xs truncate",
            severityClasses(severity),
          )}
        >
          {value}
        </span>
      </div>
    ) : null;

  return (
    <div className={cn("space-y-2.5", className)}>
      {/* Metric grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
        {metricRow(t("schedule.stability"), p.stability ? p.stability.value.toFixed(2) : null, p.stability?.severity)}
        {metricRow(t("schedule.difficulty"), p.difficulty ? p.difficulty.value.toFixed(1) : null, p.difficulty?.severity)}
        {metricRow(t("schedule.interval"), p.interval?.value, p.interval?.severity)}
        {metricRow(t("schedule.retrievability"), p.retrievability ? `${p.retrievability.value}%` : null, p.retrievability?.severity)}
        {metricRow(t("schedule.progress"), p.progress ? `${p.progress.value}%` : null, p.progress?.severity)}
        {metricRow(t("schedule.colReps"), item.reps != null ? String(item.reps) : null)}
        {metricRow(
          t("schedule.lapses", { count: item.lapses ?? 0 }),
          item.lapses != null && item.lapses > 0 ? String(item.lapses) : null,
          item.lapses != null && item.lapses > 0 ? "danger" : "neutral",
          <Warning className="w-3.5 h-3.5" />,
        )}
        {metricRow(t("schedule.estTime", { count: item.estimatedTime }), p.estimatedTime?.value, "neutral", <Clock className="w-3.5 h-3.5" />)}
      </div>

      {/* Tags / category */}
      {(item.tags.length > 0 || item.category) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {item.category && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/50 text-accent-foreground text-xs">
              <FolderSimple className="w-3 h-3" />
              {item.category}
            </span>
          )}
          {item.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-xs"
            >
              <Tag className="w-3 h-3" />
              {tag}
            </span>
          ))}
          {item.tags.length > 4 && (
            <span className="text-xs text-muted-foreground">+{item.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Open / Study */}
      {actionAppliesTo("open", item.itemType) && callbacks.onOpen && (
        <button
          type="button"
          onClick={() => runScheduleAction("open", item, callbacks)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-semibold transition-colors disabled:opacity-50 min-h-[36px]"
        >
          <TypeIcon className="w-3.5 h-3.5" />
          {item.itemType === "learning-item" ? t("queue.studyNow") : t("queue.openDocument")}
        </button>
      )}
    </div>
  );
});
