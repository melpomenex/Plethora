import {
  CaretDown,
  CaretUp,
  Funnel,
  GridFour,
  Lightning,
  Table,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import type { ScheduleInsights } from "../../lib/scheduleViewModel";

export type ScheduleViewMode = "agenda" | "grid";

interface ScheduleWorkspaceHeaderProps {
  viewMode: ScheduleViewMode;
  onViewModeChange: (mode: ScheduleViewMode) => void;
  onSpread: () => void;
  /** Whether Spread can run (has a valid selected/peak source with eligible items). */
  canSpread: boolean;
  /** Localized reason shown when Spread is disabled (tooltip/aria). */
  spreadDisabledReason?: string;
  isOverviewCollapsed: boolean;
  onToggleOverview: () => void;
  selectedDate: string | null;
  onClearDate: () => void;
  insights: ScheduleInsights;
  isMobile?: boolean;
}

/**
 * Workspace header: title + localized workload status, active-date chip,
 * Agenda/Data grid selection, Spread state, and overview-collapse control.
 */
export function ScheduleWorkspaceHeader({
  viewMode,
  onViewModeChange,
  onSpread,
  canSpread,
  spreadDisabledReason,
  isOverviewCollapsed,
  onToggleOverview,
  selectedDate,
  onClearDate,
  insights,
  isMobile = false,
}: ScheduleWorkspaceHeaderProps) {
  const { t } = useI18n();

  const statusCopy = (() => {
    if (insights.dueNow > 0) {
      return t("schedule.statusDueNow", { count: insights.dueNow });
    }
    if (insights.overdue === 0 && insights.dueToday === 0) {
      return t("schedule.statusClear");
    }
    return t("schedule.statusAllCaughtUp");
  })();

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-border bg-background">
      {/* Left: title + status + active date */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <h1 className="text-sm font-bold text-foreground whitespace-nowrap">
          {t("schedule.title")}
        </h1>

        <span
          className={cn(
            "text-xs font-medium whitespace-nowrap hidden sm:inline",
            insights.dueNow > 0 ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {statusCopy}
        </span>

        {selectedDate && (
          <div className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-xs font-medium min-w-0">
            <Funnel className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">
              {new Date(`${selectedDate.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
            <button
              onClick={onClearDate}
              className="ml-0.5 hover:text-primary/70 transition-colors rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label={t("schedule.clearDate")}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2">
        {/* View toggle (desktop only) */}
        {!isMobile && (
          <div
            className="flex items-center gap-0.5 bg-muted rounded-md p-0.5"
            role="group"
            aria-label={t("schedule.viewModeLabel")}
          >
            <button
              onClick={() => onViewModeChange("agenda")}
              aria-pressed={viewMode === "agenda"}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors min-h-[36px]",
                viewMode === "agenda"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GridFour className="w-3.5 h-3.5" />
              {t("schedule.viewAgenda")}
            </button>
            <button
              onClick={() => onViewModeChange("grid")}
              aria-pressed={viewMode === "grid"}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-colors min-h-[36px]",
                viewMode === "grid"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Table className="w-3.5 h-3.5" />
              {t("schedule.viewGrid")}
            </button>
          </div>
        )}

        {/* Spread */}
        <button
          onClick={canSpread ? onSpread : undefined}
          disabled={!canSpread}
          title={canSpread ? t("schedule.spreadOverloaded") : (spreadDisabledReason ?? t("schedule.spreadUnavailable"))}
          aria-disabled={!canSpread}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px]",
            canSpread
              ? "bg-primary/10 text-primary hover:bg-primary/20"
              : "bg-muted text-muted-foreground/60 cursor-not-allowed",
          )}
        >
          <Lightning className="w-3.5 h-3.5" />
          {!isMobile && t("schedule.spreadOverloaded")}
        </button>

        {/* Overview collapse */}
        <button
          onClick={onToggleOverview}
          className={cn(
            "p-1.5 rounded-lg border border-border transition-colors hover:bg-muted text-muted-foreground min-h-[32px] min-w-[32px]",
            !isOverviewCollapsed && "bg-muted text-foreground",
          )}
          title={isOverviewCollapsed ? t("common.expand") : t("common.collapse")}
          aria-expanded={!isOverviewCollapsed}
          aria-label={isOverviewCollapsed ? t("common.expand") : t("common.collapse")}
        >
          {isOverviewCollapsed ? <CaretDown className="w-4 h-4" /> : <CaretUp className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
