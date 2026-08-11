import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BookOpen,
  Brain,
  CaretDown,
  CaretRight,
  Stack,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { parseScheduleDate } from "../../lib/scheduleUtils";
import { cn } from "../../utils";
import type { ScheduleDayItem } from "../../types/queue";
import type { ScheduleGroup } from "../../lib/scheduleViewModel";
import {
  buildItemPresentation,
} from "../../lib/scheduleItemPresentation";
import { localDateKey } from "../../lib/scheduleViewModel";
import type { ScheduleActionCallbacks } from "../../lib/scheduleActions";
import { QUICK_POSTPONE_PRESETS } from "./ScheduleItemActions";
import { ScheduleItemDetails, severityClasses } from "./ScheduleItemDetails";
import { ScheduleItemContextMenu } from "./ScheduleItemContextMenu";
import { GRID_COLUMNS } from "./scheduleGridColumns";

const TYPE_ICONS = {
  document: BookOpen,
  extract: Stack,
  "learning-item": Brain,
};

const NO_VALUE = "—";

interface ScheduleDataGridProps {
  groups: ScheduleGroup[];
  callbacks: ScheduleActionCallbacks;
  busyIds: ReadonlySet<string>;
}

type FlatRow =
  | { kind: "header"; key: string; group: ScheduleGroup }
  | { kind: "item"; key: string; item: ScheduleDayItem };

const COLUMN_LABELS = [
  "schedule.colType",
  "schedule.colPriorityFull",
  "schedule.interval",
  "schedule.colReps",
  "schedule.colLapses",
  "schedule.colDue",
  "schedule.difficulty",
  "schedule.stability",
  "schedule.retrievability",
  "schedule.progress",
  "schedule.colTime",
] as const;

/**
 * Legible Data grid: sticky readable headers, aligned tabular values, quiet
 * missing values, semantic metric states, date grouping, virtualization with
 * measured windowed rows (expanded detail participates in layout), and the
 * shared item details/context-menu model.
 */
export function ScheduleDataGrid({
  groups,
  callbacks,
  busyIds,
}: ScheduleDataGridProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ item: ScheduleDayItem; x: number; y: number } | null>(null);
  const todayKey = localDateKey(new Date());

  const flat = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const group of groups) {
      rows.push({ kind: "header", key: `date:${group.dateKey}`, group });
      for (const item of group.items) {
        rows.push({ kind: "item", key: `item:${item.id}`, item });
      }
    }
    return rows;
  }, [groups]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flat[i]?.kind === "header" ? 30 : 38),
    overscan: 10,
    getItemKey: (i) => flat[i]?.key ?? String(i),
  });

  // Date-scope changes scroll to the beginning intentionally.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [groups]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* One scroll viewport for header AND rows: the sticky header lives
          inside the same overflow container as the virtualized rows, so both
          compute column positions from the same available inline width
          (including any vertical scrollbar gutter) and scroll horizontally
          together when the pane is narrower than the grid. */}
      <div
        ref={scrollRef}
        data-testid="schedule-grid-scroll"
        className="relative flex-1 overflow-auto overscroll-contain"
        role="rowgroup"
      >
        {/* Grid header — sticky, readable, not hover-dependent */}
        <div
          className="sticky top-0 z-10 grid items-center gap-2 px-3 py-2 border-b border-border bg-background/95 backdrop-blur-sm"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
          role="row"
          aria-label={t("schedule.gridHeaderLabel")}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" />
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground min-w-0 truncate">
            {t("schedule.title")}
          </div>
          {COLUMN_LABELS.map((key) => (
            <div
              key={key}
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right tabular-nums whitespace-nowrap"
            >
              {t(key)}
            </div>
          ))}
          <div className="w-24" />
        </div>

        {/* Virtualized body */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = flat[virtualRow.index];
            if (!row) return null;
            if (row.kind === "header") {
              return (
                <div
                  key={row.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-3 pt-2.5 pb-1"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {formatDayLabel(row.group.dateKey, todayKey, t)}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">
                      {t("schedule.itemsDue", { count: row.group.items.length })}
                    </span>
                    {row.group.estimatedMinutes > 0 && (
                      <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                        · {t("schedule.estimatedTimeTotal", { count: row.group.estimatedMinutes })}
                      </span>
                    )}
                  </div>
                </div>
              );
            }

            const item = row.item;
            const isExpanded = expandedId === item.id;
            const busy = busyIds.has(item.id);
            return (
              <div
                key={row.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <DataGridRow
                  item={item}
                  isExpanded={isExpanded}
                  busy={busy}
                  callbacks={callbacks}
                  onToggleExpand={() => toggleExpand(item.id)}
                  onOpenContextMenu={(x, y) => setCtx({ item, x, y })}
                />
              </div>
            );
          })}
        </div>

        {ctx && (
          <ScheduleItemContextMenu
            position={{ x: ctx.x, y: ctx.y }}
            item={ctx.item}
            callbacks={callbacks}
            onClose={() => setCtx(null)}
          />
        )}
      </div>
    </div>
  );
}

interface DataGridRowProps {
  item: ScheduleDayItem;
  isExpanded: boolean;
  busy: boolean;
  callbacks: ScheduleActionCallbacks;
  onToggleExpand: () => void;
  onOpenContextMenu: (x: number, y: number) => void;
}

function DataGridRow({
  item,
  isExpanded,
  busy,
  callbacks,
  onToggleExpand,
  onOpenContextMenu,
}: DataGridRowProps) {
  const { t } = useI18n();
  const todayKey = localDateKey(new Date());
  const p = buildItemPresentation(item, todayKey, t);
  const TypeIcon = TYPE_ICONS[item.itemType] ?? BookOpen;

  const cell = (
    value: React.ReactNode,
    className?: string,
    title?: string,
  ) => (
    <div
      className={cn(
        "min-w-0 truncate text-xs tabular-nums",
        value === NO_VALUE ? "text-muted-foreground/50" : "text-muted-foreground",
        className,
      )}
      title={title}
    >
      {value}
    </div>
  );

  const hasExpandable = p.hasAlgoData || p.estimatedTime != null;

  return (
    <div
      className={cn(
        "group border-b border-border/30 transition-colors hover:bg-muted/40",
        isExpanded && "bg-muted/30 border-b-0",
      )}
      onDoubleClick={() => {
        if (callbacks.onOpen) callbacks.onOpen(item);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu(e.clientX, e.clientY);
      }}
    >
      <div
        className="grid items-center gap-2 px-3 py-1.5 cursor-pointer"
        style={{ gridTemplateColumns: GRID_COLUMNS }}
        onClick={onToggleExpand}
        role="row"
      >
        <button
          type="button"
          className="flex items-center justify-center text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm w-5 h-5"
          onClick={(e) => {
            e.stopPropagation();
            if (hasExpandable) onToggleExpand();
          }}
          aria-label={isExpanded ? t("schedule.collapseItem") : t("schedule.expandItem")}
          aria-expanded={hasExpandable ? isExpanded : undefined}
        >
          {hasExpandable ? (
            isExpanded ? <CaretDown className="w-3.5 h-3.5" /> : <CaretRight className="w-3.5 h-3.5" />
          ) : null}
        </button>

        {/* Title */}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <TypeIcon className={cn("w-3.5 h-3.5 flex-shrink-0", "text-muted-foreground")} />
            <span className="text-xs font-medium text-foreground line-clamp-1 truncate" title={p.title}>
              {p.title}
            </span>
          </div>
        </div>

        {/* Type (first letter badge) */}
        <div className="text-center">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-muted text-[10px] font-semibold text-muted-foreground">
            {p.type.label.charAt(0)}
          </span>
        </div>

        {cell(item.priority != null ? item.priority.toFixed(1) : NO_VALUE, "text-center")}
        {cell(p.interval?.value ?? NO_VALUE, "text-center")}
        {cell(item.reps != null ? String(item.reps) : NO_VALUE, "text-center")}
        {cell(
          item.lapses != null && item.lapses > 0 ? String(item.lapses) : NO_VALUE,
          "text-center",
          item.lapses != null && item.lapses > 0 ? t("schedule.lapses", { count: item.lapses }) : undefined,
        )}

        {/* Due */}
        {cell(
          p.due ? (
            <span className={severityClasses(p.due.severity)}>{p.due.label}</span>
          ) : (
            NO_VALUE
          ),
          "text-center",
          p.due?.accessibleLabel,
        )}

        {/* Difficulty */}
        {cell(
          p.difficulty ? (
            <span className={severityClasses(p.difficulty.severity)}>{p.difficulty.value.toFixed(1)}</span>
          ) : (
            NO_VALUE
          ),
          "text-center",
          p.difficulty?.accessibleLabel,
        )}

        {/* Stability */}
        {cell(
          p.stability ? (
            <span className="flex items-center gap-1">
              <span className="w-6 h-1 bg-muted rounded-full overflow-hidden">
                <span
                  className={cn("block h-full rounded-full", stabilityBar(p.stability.severity))}
                  style={{ width: `${Math.round((p.stability.ratio ?? 0) * 100)}%` }}
                />
              </span>
              <span className={severityClasses(p.stability.severity)}>{p.stability.value.toFixed(1)}</span>
            </span>
          ) : (
            NO_VALUE
          ),
          undefined,
          p.stability?.accessibleLabel,
        )}

        {/* Retrievability */}
        {cell(
          p.retrievability ? (
            <span className={severityClasses(p.retrievability.severity)}>{p.retrievability.value}%</span>
          ) : (
            NO_VALUE
          ),
          "text-center",
          p.retrievability?.accessibleLabel,
        )}

        {/* Progress */}
        {cell(
          p.progress ? (
            <span className={severityClasses(p.progress.severity)}>{p.progress.value}%</span>
          ) : (
            NO_VALUE
          ),
          "text-center",
          p.progress?.accessibleLabel,
        )}

        {/* Estimated time */}
        {cell(p.estimatedTime?.value ?? NO_VALUE, "text-center")}

        {/* Quick postpone (hover/focus) */}
        <div className="flex items-center justify-end gap-0.5">
          {actionAppliesToPostpone(item) ? (
            <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-0.5">
              {QUICK_POSTPONE_PRESETS.map((days) => (
                <button
                  key={days}
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    callbacks.onPostpone?.(item.id, days, item.itemType);
                  }}
                  className="px-1.5 py-1 text-[10px] font-mono rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 min-h-[28px]"
                  aria-label={t("schedule.postponeDays", { count: days })}
                >
                  +{days}d
                </button>
              ))}
            </div>
          ) : (
            <span className="w-24" />
          )}
        </div>
      </div>

      {/* Expanded detail participates in layout (measured row). Grid mode
          spans the same column tracks as the row, so no title indent is
          applied — the shared GRID_COLUMNS definition keeps metrics aligned. */}
      {isExpanded && (
        <div className="px-3 pb-2.5">
          <div className="pt-2 border-t border-border/50">
            <ScheduleItemDetails item={item} callbacks={callbacks} busy={busy} mode="grid" />
          </div>
        </div>
      )}
    </div>
  );
}

function actionAppliesToPostpone(item: ScheduleDayItem): boolean {
  return item.itemType === "document" || item.itemType === "learning-item";
}

function stabilityBar(severity: "good" | "warning" | "danger" | "neutral"): string {
  switch (severity) {
    case "danger":
      return "bg-destructive";
    case "warning":
      return "bg-amber-500";
    default:
      return "bg-primary";
  }
}

function formatDayLabel(
  dateKey: string,
  todayKey: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = parseScheduleDate(todayKey);
  const diff = today ? Math.round((date.getTime() - today.getTime()) / 86400000) : 0;
  if (diff === 0) return t("schedule.today");
  if (diff === 1) return t("schedule.tomorrow");
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
