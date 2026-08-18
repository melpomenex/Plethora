import { useEffect, useState } from "react";
import { ChartBarHorizontal } from "@phosphor-icons/react";
import { getDueWorkloadForecast, getReviewStatistics } from "../../api/algorithm";

interface ReviewStatistics {
  total_items: number;
  total_reviews: number;
  total_lapses: number;
  avg_interval: number;
  retention_estimate: number;
  due_today: number;
  due_week: number;
  due_month: number;
}

interface DueWorkloadForecast {
  points: Array<{
    date: string;
    due_learning_items: number;
    due_documents: number;
    /** Text extracts due this day (part of due_total). */
    due_extracts?: number;
    /** Video extracts due this day (part of due_total). */
    due_video_extracts?: number;
    due_total: number;
    /** True for the leading overdue/backlog bucket. */
    is_backlog?: boolean;
  }>;
  summaries: Array<{
    horizon_days: number;
    due_total: number;
  }>;
}

export function ScheduleVisualization() {
  const [stats, setStats] = useState<ReviewStatistics | null>(null);
  const [forecast, setForecast] = useState<DueWorkloadForecast | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      try {
        setIsLoading(true);
        const [statsData, forecastData] = await Promise.all([
          getReviewStatistics(),
          getDueWorkloadForecast(90),
        ]);
        setStats(statsData);
        setForecast(forecastData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load statistics");
      } finally {
        setIsLoading(false);
      }
    }
    loadStats();
  }, []);

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <ChartBarHorizontal className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Schedule Overview</h3>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-1/2"></div>
          <div className="h-4 bg-muted rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  if (error || !stats || !forecast) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <ChartBarHorizontal className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground">Schedule Overview</h3>
        </div>
        <p className="text-muted-foreground">
          {error || "Unable to load schedule statistics"}
        </p>
      </div>
    );
  }

  const dueByHorizon = (horizon: number): number =>
    forecast.summaries.find((summary) => summary.horizon_days === horizon)?.due_total ?? 0;

  const due30 = dueByHorizon(30);
  const due60 = dueByHorizon(60);
  const due90 = dueByHorizon(90);

  // The leading overdue/backlog bucket (when present) represents items whose
  // due date already passed — counted per item type like every other day.
  const backlogPoint = forecast.points.find((point) => point.is_backlog) ?? null;
  const backlogExtracts = (backlogPoint?.due_extracts ?? 0) + (backlogPoint?.due_video_extracts ?? 0);

  // Calculate bar widths (percentage of max value)
  const maxDue = Math.max(due30, due60, due90, 1);
  const due30Width = (due30 / maxDue) * 100;
  const due60Width = (due60 / maxDue) * 100;
  const due90Width = (due90 / maxDue) * 100;

  const peakPoint = forecast.points.reduce<{ date: string; due_total: number } | null>(
    (best, point) => {
      if (!best || point.due_total > best.due_total) {
        return { date: point.date, due_total: point.due_total };
      }
      return best;
    },
    null
  );

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <ChartBarHorizontal className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Schedule Overview</h3>
      </div>

      <div className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-foreground">{stats.total_items}</div>
            <div className="text-sm text-muted-foreground">Total Items</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-500">
              {Math.round(stats.retention_estimate * 100)}%
            </div>
            <div className="text-sm text-muted-foreground">Retention Rate</div>
          </div>
        </div>

        {/* Overdue backlog note — the forecast's leading bucket */}
        {backlogPoint && backlogPoint.due_total > 0 && (
          <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm">
            <span className="text-foreground">
              Overdue backlog: <strong>{backlogPoint.due_total}</strong> items due before today
            </span>
            <span className="text-xs text-muted-foreground">
              {backlogPoint.due_learning_items} cards · {backlogPoint.due_documents} documents ·{" "}
              {backlogExtracts} extracts
            </span>
          </div>
        )}

        {/* Due Items Bar Chart */}
        <div>
          <h4 className="text-sm font-medium text-foreground mb-3">Items Due</h4>
          <div className="space-y-2">
            {/* 30 days */}
            <div className="flex items-center gap-3">
              <div className="w-20 text-sm text-muted-foreground">30 days</div>
              <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 flex items-center justify-end pr-2"
                  style={{ width: `${due30Width}%` }}
                >
                  {due30Width > 15 && (
                    <span className="text-xs font-medium text-primary-foreground">
                      {due30}
                    </span>
                  )}
                </div>
              </div>
              {due30Width <= 15 && (
                <span className="w-8 text-sm text-foreground text-right">{due30}</span>
              )}
            </div>

            {/* 60 days */}
            <div className="flex items-center gap-3">
              <div className="w-20 text-sm text-muted-foreground">60 days</div>
              <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300 flex items-center justify-end pr-2"
                  style={{ width: `${due60Width}%` }}
                >
                  {due60Width > 15 && (
                    <span className="text-xs font-medium text-primary-foreground">
                      {due60}
                    </span>
                  )}
                </div>
              </div>
              {due60Width <= 15 && (
                <span className="w-8 text-sm text-foreground text-right">{due60}</span>
              )}
            </div>

            {/* 90 days */}
            <div className="flex items-center gap-3">
              <div className="w-20 text-sm text-muted-foreground">90 days</div>
              <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-300 flex items-center justify-end pr-2"
                  style={{ width: `${due90Width}%` }}
                >
                  {due90Width > 15 && (
                    <span className="text-xs font-medium text-primary-foreground">
                      {due90}
                    </span>
                  )}
                </div>
              </div>
              {due90Width <= 15 && (
                <span className="w-8 text-sm text-foreground text-right">{due90}</span>
              )}
            </div>
          </div>
        </div>

        {/* Additional Metrics */}
        <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border">
          <div className="text-center">
            <div className="text-lg font-semibold text-foreground">
              {stats.total_reviews}
            </div>
            <div className="text-xs text-muted-foreground">Total Reviews</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-foreground">
              {stats.total_lapses}
            </div>
            <div className="text-xs text-muted-foreground">Total Lapses</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-foreground">
              {Math.round(stats.avg_interval)}d
            </div>
            <div className="text-xs text-muted-foreground">Avg Interval</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-foreground">
              {peakPoint?.due_total ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">Peak Day (90d)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
