import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BookOpen,
  Brain,
  CaretDown,
  CaretRight,
  Clock,
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
import { ScheduleItemDetails, severityClasses } from "./ScheduleItemDetails";
import { ScheduleItemActions } from "./ScheduleItemActions";
import { ScheduleItemContextMenu } from "./ScheduleItemContextMenu";

const TYPE_ICONS = {
  document: BookOpen,
  extract: Stack,
  "learning-item": Brain,
};

interface ScheduleAgendaProps {
  groups: ScheduleGroup[];
  callbacks: ScheduleActionCallbacks;
  /** Items currently busy (in-flight mutations) keyed by id. */
  busyIds: ReadonlySet<string>;
  isMobile?: boolean;
  onOpenItem?: (item: ScheduleDayItem) => void;
}

type FlatEntry =
  | { kind: "header"; key: string; group: ScheduleGroup }
  | { kind: "item"; key: string; item: ScheduleDayItem };

/**
 * Dense Agenda: continuous grouped surface with a sticky day summary, measured
 * windowed rows (@tanstack/react-virtual), collapsed-by-default item rows, and
 * progressive detail disclosure. Quick actions appear on hover / :focus-within;
 * on touch layouts they are exposed through expansion.
 */
export function ScheduleAgenda({
  groups,
  callbacks,
  busyIds,
  isMobile = false,
}: ScheduleAgendaProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [topGroupKey, setTopGroupKey] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ item: ScheduleDayItem; x: number; y: number } | null>(null);
  const todayKey = localDateKey(new Date());

  const flat = useMemo<FlatEntry[]>(() => {
    const entries: FlatEntry[] = [];
    for (const group of groups) {
      entries.push({ kind: "header", key: `date:${group.dateKey}`, group });
      for (const item of group.items) {
        entries.push({ kind: "item", key: `item:${item.id}`, item });
      }
    }
    return entries;
  }, [groups]);

  const groupByEntryIndex = useMemo(() => {
    const map = new Map<number, string>();
    let current: string | null = null;
    flat.forEach((entry, i) => {
      if (entry.kind === "header") current = entry.key;
      if (current) map.set(i, current);
    });
    return map;
  }, [flat]);

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (flat[i]?.kind === "header" ? 34 : 60),
    overscan: 8,
    getItemKey: (i) => flat[i]?.key ?? String(i),
  });

  // Date-scope changes scroll to the beginning intentionally.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setTopGroupKey(flat[0]?.kind === "header" ? flat[0].key : null);
  }, [groups]);

  const handleScroll = useCallback(() => {
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    const items = virtualizer.getVirtualItems();
    let topKey: string | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const v = items[i];
      if (v.start <= scrollTop + 4) {
        topKey = groupByEntryIndex.get(v.index) ?? null;
        break;
      }
    }
    if (topKey == null && items.length > 0) {
      topKey = groupByEntryIndex.get(items[0].index) ?? null;
    }
    setTopGroupKey(topKey);
  }, [virtualizer, groupByEntryIndex]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const activeGroup = useMemo(
    () => groups.find((g) => `date:${g.dateKey}` === topGroupKey) ?? null,
    [groups, topGroupKey],
  );

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      data-testid="schedule-agenda-scroll"
      className="relative flex-1 overflow-y-auto overscroll-contain"
    >
      {/* Sticky day summary — preserves date context while scrolling */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-1.5 bg-background/95 backdrop-blur-sm border-b border-border">
        {activeGroup ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">
                {formatDayHeader(activeGroup.dateKey, todayKey, t)}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {t("schedule.itemsDue", { count: activeGroup.items.length })}
              </span>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
              {activeGroup.estimatedMinutes > 0
                ? t("schedule.estimatedTimeTotal", { count: activeGroup.estimatedMinutes })
                : ""}
            </span>
          </>
        ) : (
          <span className="text-sm font-semibold text-foreground">
            {t("schedule.allUpcoming")}
          </span>
        )}
      </div>

      {/* Windowed rows */}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const entry = flat[virtualRow.index];
          if (!entry) return null;
          if (entry.kind === "header") {
            return (
              <div
                key={entry.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full px-4 pt-3 pb-1"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {formatDayHeader(entry.group.dateKey, todayKey, t)}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {t("schedule.itemsDue", { count: entry.group.items.length })}
                  </span>
                  {entry.group.estimatedMinutes > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      · {t("schedule.estimatedTimeTotal", { count: entry.group.estimatedMinutes })}
                    </span>
                  )}
                </div>
              </div>
            );
          }

          const item = entry.item;
          const isExpanded = expandedId === item.id;
          const busy = busyIds.has(item.id);
          return (
            <div
              key={entry.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <ScheduleAgendaRow
                item={item}
                isExpanded={isExpanded}
                busy={busy}
                isMobile={isMobile}
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
  );
}

interface AgendaRowProps {
  item: ScheduleDayItem;
  isExpanded: boolean;
  busy: boolean;
  isMobile: boolean;
  callbacks: ScheduleActionCallbacks;
  onToggleExpand: () => void;
  onOpenContextMenu: (x: number, y: number) => void;
}

function ScheduleAgendaRow({
  item,
  isExpanded,
  busy,
  isMobile,
  callbacks,
  onToggleExpand,
  onOpenContextMenu,
}: AgendaRowProps) {
  const { t } = useI18n();
  const todayKey = localDateKey(new Date());
  const p = buildItemPresentation(item, todayKey, t);
  const TypeIcon = TYPE_ICONS[item.itemType] ?? BookOpen;
  const hasExpandable = p.hasAlgoData || p.estimatedTime != null;

  return (
    <div
      className={cn(
        "group relative border-b border-border/40 transition-colors",
        "hover:bg-muted/30 focus-within:bg-muted/30",
        isExpanded && "bg-muted/20",
      )}
      onClick={() => {
        if (isMobile) onToggleExpand();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu(e.clientX, e.clientY);
      }}
    >
      {/* Summary row */}
      <div className="flex items-start gap-3 px-4 py-2">
        {/* Type icon */}
        <div
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5",
            "bg-muted text-muted-foreground",
          )}
        >
          <TypeIcon className="w-4 h-4" />
        </div>

        {/* Title + context */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h4 className="text-sm font-medium text-foreground line-clamp-1 leading-snug min-w-0">
              {p.title}
            </h4>
            {/* Disclosure (keyboard-visible) */}
            {hasExpandable && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand();
                }}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? t("schedule.collapseItem") : t("schedule.expandItem")}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {isExpanded ? <CaretDown className="w-4 h-4" /> : <CaretRight className="w-4 h-4" />}
              </button>
            )}
          </div>

          {/* Context line: type label · due · priority · est time · memory signals */}
          <div className="flex items-center gap-2 mt-1 flex-wrap min-w-0">
            <span className="px-1.5 py-0.5 text-[11px] font-medium rounded bg-muted/60 text-muted-foreground">
              {p.type.label}
            </span>

            {p.due && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-[11px] font-medium",
                  severityClasses(p.due.severity),
                )}
              >
                <Clock className="w-3 h-3" />
                {p.due.label}
              </span>
            )}

            <span className="text-[11px] text-muted-foreground tabular-nums">
              P:{item.priority.toFixed(1)}
            </span>

            {p.estimatedTime && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {p.estimatedTime.value}
              </span>
            )}

            {p.stability && (
              <span className={cn("text-[11px] tabular-nums", severityClasses(p.stability.severity))}>
                S:{p.stability.value.toFixed(1)}
              </span>
            )}

            {p.retrievability && (
              <span className={cn("text-[11px] tabular-nums", severityClasses(p.retrievability.severity))}>
                R:{p.retrievability.value}%
              </span>
            )}

            {item.reps != null && (
              <span className="text-[11px] text-muted-foreground tabular-nums">×{item.reps}</span>
            )}
          </div>
        </div>

        {/* Quick actions: hover / focus-within on desktop, expansion on touch */}
        {(isMobile ? isExpanded : true) && (
          <div
            className={cn(
              "flex-shrink-0 flex items-center gap-1 self-start",
              !isMobile && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity",
            )}
          >
            <ScheduleItemActions item={item} callbacks={callbacks} busy={busy} />
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-4 pb-3 pl-[3.25rem]">
          <div className="pt-2 border-t border-border/50">
            <ScheduleItemDetails item={item} callbacks={callbacks} busy={busy} />
            {isMobile && (
              <div className="mt-2">
                <ScheduleItemActions item={item} callbacks={callbacks} busy={busy} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Localized day header: relative label + absolute date. */
function formatDayHeader(
  dateKey: string,
  todayKey: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = parseScheduleDate(todayKey);
  const diff = today ? Math.round((date.getTime() - today.getTime()) / 86400000) : 0;
  const absolute = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  if (diff === 0) return t("schedule.today");
  if (diff === 1) return t("schedule.tomorrow");
  return absolute;
}
