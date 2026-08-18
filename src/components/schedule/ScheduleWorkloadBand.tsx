import { useMemo, useRef, useEffect } from "react";
import { CaretDown, CaretUp, Funnel } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import type {
  ScheduleForecastDay,
  ScheduleInsights,
  ScheduleSpreadSource,
} from "../../lib/scheduleViewModel";
import { parseScheduleDate } from "../../lib/scheduleUtils";

interface ScheduleWorkloadBandProps {
  forecastDays: ScheduleForecastDay[];
  insights: ScheduleInsights;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  spreadSource: ScheduleSpreadSource | null;
  canSpread: boolean;
}

function relativeDateLabel(dateKey: string, todayKey: string, t: ReturnType<typeof useI18n>["t"]): string {
  const date = parseScheduleDate(dateKey);
  if (!date) return dateKey;
  const today = parseScheduleDate(todayKey);
  const diff = today ? Math.round((date.getTime() - today.getTime()) / 86400000) : 0;
  if (diff === 0) return t("schedule.today");
  if (diff === 1) return t("schedule.tomorrow");
  return date.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

/** Accessible label for a forecast day — communicates everything without color. */
function forecastDayAriaLabel(
  day: ScheduleForecastDay,
  todayKey: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const base = day.isBacklog
    ? t("schedule.overdueBacklog")
    : relativeDateLabel(day.dateKey, todayKey, t);
  const parts = [base];
  if (day.isToday) parts.push(t("schedule.today"));
  if (day.isSelected) parts.push(t("schedule.selected"));
  if (day.dueTotal > 0) {
    parts.push(t("schedule.forecastDayCount", { count: day.dueTotal }));
    if (day.learningCount > 0 || day.documentCount > 0) {
      parts.push(
        t("schedule.forecastDayComposition", {
          learning: day.learningCount,
          documents: day.documentCount,
        }),
      );
    }
    if (day.extractCount > 0 || day.videoExtractCount > 0) {
      parts.push(
        t("schedule.forecastDayExtracts", {
          extracts: day.extractCount,
          videoExtracts: day.videoExtractCount,
        }),
      );
    }
    if (day.estimatedMinutes > 0) {
      parts.push(t("schedule.forecastDayTime", { count: day.estimatedMinutes }));
    }
    if (day.isPeak) parts.push(t("schedule.peakDayLabel"));
  } else {
    parts.push(t("schedule.noItemsDue"));
  }
  return parts.join(", ");
}

/**
 * Workload band: compact insight strip + continuous 14-day forecast rail.
 * Collapses to a compact due-now/overdue summary line.
 */
export function ScheduleWorkloadBand({
  forecastDays,
  insights,
  selectedDate,
  onSelectDate,
  collapsed,
  onToggleCollapse,
  spreadSource,
  canSpread,
}: ScheduleWorkloadBandProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  // todayKey: derive from the first forecast day's isToday flag, else "today" label
  const todayKey = useMemo(() => {
    const today = forecastDays.find((d) => d.isToday);
    return today?.dateKey ?? "";
  }, [forecastDays]);

  // Scroll "today"/"All" into view on mount (rail starts at the selected day when present).
  useEffect(() => {
    if (scrollRef.current) {
      const target = scrollRef.current.querySelector("[data-scroll-target='true']");
      if (target) {
        target.scrollIntoView({ inline: "center", behavior: "instant" as ScrollBehavior });
      }
    }
  }, []);

  if (collapsed) {
    return (
      <div className="px-4 py-1.5 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground min-w-0">
          <span className="flex items-center gap-1 whitespace-nowrap">
            <span className={cn("font-semibold", insights.dueNow > 0 ? "text-foreground" : "text-muted-foreground")}>
              {insights.dueNow}
            </span>
            {t("schedule.dueNow")}
          </span>
          <span className="flex items-center gap-1 whitespace-nowrap">
            <span className={cn("font-semibold", insights.overdue > 0 ? "text-destructive" : "text-muted-foreground")}>
              {insights.overdue}
            </span>
            {t("schedule.overdue")}
          </span>
          {selectedDate && (
            <span className="flex items-center gap-1 truncate min-w-0">
              <Funnel className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{relativeDateLabel(selectedDate, todayKey, t)}</span>
            </span>
          )}
        </div>
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded hover:bg-muted transition-colors text-muted-foreground min-h-[28px]"
          aria-expanded={false}
        >
          <CaretDown className="w-3.5 h-3.5" />
          {t("common.expand")}
        </button>
      </div>
    );
  }

  const insightItems: Array<{ label: string; value: string; danger?: boolean }> = [
    { label: t("schedule.dueToday"), value: String(insights.dueToday), danger: false },
    { label: t("schedule.overdue"), value: String(insights.overdue), danger: insights.overdue > 0 },
    {
      label: t("schedule.dailyAvg", { count: insights.nextSevenAverage }),
      value: insights.nextSevenAverage > 0 ? `~${insights.nextSevenAverage}` : "0",
    },
    {
      label: insights.peakDay
        ? t("schedule.peakDay", {
            date: relativeDateLabel(insights.peakDay.dateKey, todayKey, t),
            count: insights.peakDay.dueTotal,
          })
        : "—",
      value: insights.peakDay ? String(insights.peakDay.dueTotal) : "0",
    },
  ];

  return (
    <div className="border-b border-border bg-card overflow-hidden">
      <div className="px-4 pt-2.5 pb-2 space-y-2">
        {/* Insight strip */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {insightItems.map((item, i) => (
              <span key={i} className="flex items-baseline gap-1 whitespace-nowrap">
                <span className={cn("text-base font-semibold tabular-nums", item.danger ? "text-destructive" : "text-foreground")}>
                  {item.value}
                </span>
                <span className="text-[11px] text-muted-foreground">{item.label}</span>
              </span>
            ))}
            {canSpread && spreadSource && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {t("schedule.spreadSource", { date: relativeDateLabel(spreadSource.dateKey, todayKey, t) })}
              </span>
            )}
          </div>
          <button
            onClick={onToggleCollapse}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded hover:bg-muted transition-colors text-muted-foreground flex-shrink-0 min-h-[28px]"
            aria-expanded={true}
          >
            <CaretUp className="w-3.5 h-3.5" />
            {t("common.collapse")}
          </button>
        </div>

        {/* 14-day forecast rail */}
        <div
          ref={scrollRef}
          className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-proximity scrollbar-hide"
          role="radiogroup"
          aria-label={t("schedule.forecastRail")}
        >
          {/* All upcoming scope */}
          <button
            data-scroll-target={selectedDate == null ? "true" : undefined}
            role="radio"
            aria-checked={selectedDate == null}
            onClick={() => onSelectDate(null)}
            className={cn(
              "flex-shrink-0 flex flex-col items-center justify-center w-14 rounded-lg snap-start transition-colors min-h-[56px]",
              "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selectedDate == null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/50 text-foreground border-border hover:bg-muted",
            )}
            title={t("schedule.allUpcoming")}
          >
            <span className="text-[10px] font-semibold leading-none px-1 text-center">
              {t("schedule.allUpcoming")}
            </span>
          </button>

          {forecastDays.map((day) => {
            const isSelected = day.isSelected;
            const magnitudePct = Math.round(day.magnitude * 100);
            const label = forecastDayAriaLabel(day, todayKey, t);
            return (
              <button
                key={day.dateKey}
                data-scroll-target={day.isToday ? "true" : undefined}
                role="radio"
                aria-checked={isSelected}
                aria-label={label}
                onClick={() => onSelectDate(isSelected ? null : day.dateKey)}
                className={cn(
                  "flex-shrink-0 flex flex-col items-center justify-center w-14 rounded-lg snap-start transition-colors min-h-[56px] px-1",
                  "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isSelected
                    ? "bg-primary/15 border-primary text-foreground"
                    : day.isToday
                      ? "bg-primary/5 border-primary/40 text-foreground"
                      : "bg-muted/30 border-border hover:bg-muted text-foreground",
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-medium leading-none truncate w-full text-center",
                    day.isBacklog
                      ? "text-destructive font-semibold"
                      : day.isToday
                        ? "text-primary"
                        : "text-muted-foreground",
                  )}
                >
                  {day.isBacklog
                    ? t("schedule.overdueBacklogShort")
                    : relativeDateLabel(day.dateKey, todayKey, t)}
                </span>
                <span className="text-base font-semibold leading-tight tabular-nums">
                  {day.dueTotal > 0 ? day.dueTotal : "·"}
                </span>
                {/* Magnitude bar — tonal + structural cue, aria-label carries the value */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-full h-1 rounded-full overflow-hidden",
                    day.dueTotal > 0 ? "bg-muted" : "bg-transparent",
                  )}
                >
                  {day.dueTotal > 0 && (
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        day.bucket === "critical" || day.bucket === "heavy"
                          ? "bg-destructive"
                          : day.bucket === "moderate"
                            ? "bg-amber-500"
                            : "bg-primary",
                      )}
                      style={{ width: `${Math.max(8, magnitudePct)}%` }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
