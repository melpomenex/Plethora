import { useEffect, useMemo, useState } from "react";
import { Brain, CaretRight, Fire, Target } from "@phosphor-icons/react";
import { getActivityData, type ActivityDay, type DashboardStats } from "../../../api/analytics";
import { cn } from "../../../utils/cn";

export interface StreakGoalsWidgetProps {
  stats: DashboardStats | null;
  isLoading: boolean;
  onStartReview: () => void;
  onOpenAnalytics: () => void;
}

export function StreakGoalsWidget({
  stats,
  isLoading,
  onStartReview,
  onOpenAnalytics,
}: StreakGoalsWidgetProps) {
  const [activityDays, setActivityDays] = useState<ActivityDay[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getActivityData(7)
      .then((days) => {
        if (!cancelled && Array.isArray(days)) {
          setActivityDays(days);
        }
      })
      .catch(() => {
        // Gracefully fall back to stats-only view
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reviewsToday = stats?.reviews_today ?? stats?.cards_reviewed_today ?? 0;
  const dailyGoal = Math.max(1, stats?.daily_goal ?? 20);
  const goalPct = Math.min(100, Math.round((reviewsToday / dailyGoal) * 100));
  const streak = stats?.study_streak ?? 0;
  const retention = Math.round((stats?.retention_rate ?? 0) * (stats?.retention_rate && stats.retention_rate <= 1 ? 100 : 1));

  const last7Bars = useMemo(() => {
    if (activityDays.length > 0) {
      const slice = activityDays.slice(-7);
      const maxCount = Math.max(1, ...slice.map((d) => d.reviews_count));
      return slice.map((d) => {
        const parsed = new Date(d.date);
        const dayLabel = Number.isNaN(parsed.getTime())
          ? d.date.slice(-2)
          : parsed.toLocaleDateString(undefined, { weekday: "narrow" });
        return {
          key: d.date,
          label: dayLabel,
          count: d.reviews_count,
          heightPct: Math.max(10, Math.round((d.reviews_count / maxCount) * 100)),
        };
      });
    }

    const fallbackLabels = ["M", "T", "W", "T", "F", "S", "S"];
    return fallbackLabels.map((label, idx) => ({
      key: `fallback-${idx}`,
      label,
      count: idx === 6 ? reviewsToday : 0,
      heightPct: idx === 6 && reviewsToday > 0 ? Math.max(20, goalPct) : 12,
    }));
  }, [activityDays, goalPct, reviewsToday]);

  return (
    <div className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500">
            <Fire className="h-4 w-4" weight="fill" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Streak & Daily Goal</h3>
            <p className="text-xs text-muted-foreground">
              {isLoading ? "Loading activity..." : `${streak} day streak · ${retention}% retention`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(stats?.cards_due_today ?? 0) > 0 && (
            <button
              type="button"
              onClick={onStartReview}
              className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <Brain className="h-3.5 w-3.5" aria-hidden="true" />
              Review ({stats?.cards_due_today})
            </button>
          )}
          <button
            type="button"
            onClick={onOpenAnalytics}
            className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Analytics
            <CaretRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Target className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Daily goal
            </span>
            <span className="font-semibold text-foreground">
              {reviewsToday} / {dailyGoal} ({goalPct}%)
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                goalPct >= 100 ? "bg-emerald-500" : "bg-primary",
              )}
              style={{ width: `${goalPct}%` }}
            />
          </div>
        </div>

        <div className="flex items-end justify-between gap-1.5 h-12 pt-1" aria-label="7-day review activity">
          {last7Bars.map((bar) => (
            <div key={bar.key} className="flex flex-1 flex-col items-center gap-1 h-full justify-end">
              <div
                className={cn(
                  "w-full max-w-[20px] rounded-t transition-all",
                  bar.count > 0 ? "bg-primary/80" : "bg-muted",
                )}
                style={{ height: `${bar.heightPct}%` }}
                title={`${bar.count} reviews`}
              />
              <span className="text-[10px] text-muted-foreground leading-none">{bar.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
