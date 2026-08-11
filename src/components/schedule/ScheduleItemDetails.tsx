import { memo } from "react";
import {
  BookOpen,
  Brain,
  Stack,
  Clock,
  Warning,
  FolderSimple,
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
import { ItemTagEditor } from "../common/ItemTagEditor";
import { GRID_COLUMNS, GRID_METRIC_COLUMNS, type ScheduleGridColumnKey } from "./scheduleGridColumns";

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
  /**
   * `agenda` (default): responsive labeled 2/3-column metric grid.
   * `grid`: align duplicated metrics to the shared data-grid semantic columns
   * (same track definition as the header and rows); tags/category/actions sit
   * in a deliberate spanning region.
   */
  mode?: "agenda" | "grid";
}

const NO_VALUE = "—";

/**
 * Shared expanded detail region: complete labeled metrics, tags/category, and
 * the open/study action. Used by both Agenda and Data grid rows. In grid mode
 * the metrics are placed on the shared data-grid column tracks so expanded
 * values align with their sticky header labels.
 */
export const ScheduleItemDetails = memo(function ScheduleItemDetails({
  item,
  callbacks,
  busy = false,
  className,
  mode = "agenda",
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

  // Semantic metric values keyed by their data-grid column, used in grid mode.
  const metricByColumn: Partial<Record<ScheduleGridColumnKey, { label: string; value: string; severity: MetricSeverity }>> = {
    priority: {
      label: t("schedule.colPriorityFull"),
      value: item.priority != null ? item.priority.toFixed(1) : NO_VALUE,
      severity: "neutral",
    },
    interval: {
      label: t("schedule.interval"),
      value: p.interval?.value ?? NO_VALUE,
      severity: p.interval?.severity ?? "neutral",
    },
    reps: {
      label: t("schedule.colReps"),
      value: item.reps != null ? String(item.reps) : NO_VALUE,
      severity: "neutral",
    },
    lapses: {
      label: t("schedule.colLapses"),
      value: item.lapses != null && item.lapses > 0 ? String(item.lapses) : NO_VALUE,
      severity: item.lapses != null && item.lapses > 0 ? "danger" : "neutral",
    },
    due: {
      label: t("schedule.colDue"),
      value: p.due?.label ?? NO_VALUE,
      severity: p.due?.severity ?? "neutral",
    },
    difficulty: {
      label: t("schedule.difficulty"),
      value: p.difficulty ? p.difficulty.value.toFixed(1) : NO_VALUE,
      severity: p.difficulty?.severity ?? "neutral",
    },
    stability: {
      label: t("schedule.stability"),
      value: p.stability ? p.stability.value.toFixed(2) : NO_VALUE,
      severity: p.stability?.severity ?? "neutral",
    },
    retrievability: {
      label: t("schedule.retrievability"),
      value: p.retrievability ? `${p.retrievability.value}%` : NO_VALUE,
      severity: p.retrievability?.severity ?? "neutral",
    },
    progress: {
      label: t("schedule.progress"),
      value: p.progress ? `${p.progress.value}%` : NO_VALUE,
      severity: p.progress?.severity ?? "neutral",
    },
    estimatedTime: {
      label: t("schedule.estTime", { count: item.estimatedTime }),
      value: p.estimatedTime?.value ?? NO_VALUE,
      severity: "neutral",
    },
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      {mode === "grid" ? (
        /* Data-grid layout: metrics on their semantic column tracks. */
        <div
          className="grid items-end gap-2"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
          role="row"
          aria-label={t("schedule.gridDetailLabel")}
        >
          {/* Expand column spacer */}
          <div />
          {/* Title column: compact summary (type icon + title) */}
          <div className="min-w-0 flex items-center gap-1.5 text-xs text-foreground">
            <TypeIcon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{p.title}</span>
          </div>
          {/* Type column: badge (matches row type column) */}
          <div className="text-center">
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-muted text-[10px] font-semibold text-muted-foreground">
              {p.type.label.charAt(0)}
            </span>
          </div>
          {GRID_METRIC_COLUMNS.map(({ key }) => {
            const metric = metricByColumn[key];
            if (!metric) return <div key={key} />;
            return (
              <div
                key={key}
                className="min-w-0 text-center"
                title={`${metric.label}: ${metric.value}`}
              >
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 truncate">
                  {metric.label}
                </div>
                <div
                  className={cn(
                    "font-mono tabular-nums text-xs truncate",
                    severityClasses(metric.severity),
                  )}
                >
                  {metric.value}
                </div>
              </div>
            );
          })}
          {/* Actions column spacer — actions live in the spanning region below */}
          <div />
        </div>
      ) : (
        /* Agenda layout: responsive labeled metric grid. */
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
      )}

      {/* Tags / category — inline shared editor (Agenda and Data grid) */}
      <div className="flex items-start gap-1.5 flex-wrap">
          {item.category && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/50 text-accent-foreground text-xs">
              <FolderSimple className="w-3 h-3" />
              {item.category}
            </span>
          )}
          <ItemTagEditor
            target={{ type: item.itemType, id: item.id, tags: item.tags }}
            dense
            className="min-w-0"
          />
      </div>

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
