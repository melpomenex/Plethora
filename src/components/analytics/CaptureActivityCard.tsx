import { useMemo } from "react";
import { useI18n } from "../../lib/i18n";
import type {
  CaptureActivity,
  CaptureSource,
} from "../../api/capture-activity";
import {
  Tray,
  ArrowClockwise,
  Browsers,
  Warning,
} from "@phosphor-icons/react";

const SOURCE_LABEL_KEYS: Record<CaptureSource, string> = {
  "browser-extension": "dashboard.captureSource.browserExtension",
  "share-target": "dashboard.captureSource.shareTarget",
  rss: "dashboard.captureSource.rss",
  manual: "dashboard.captureSource.manual",
};

/**
 * Dashboard capture-activity widget: captures-per-day sparkline, per-source
 * breakdown, and the needs-attention count. Presentational by design —
 * DashboardTab owns the fetch lifecycle and error state so this card can
 * fail without degrading the rest of the Dashboard.
 */
export interface CaptureActivityCardProps {
  data: CaptureActivity | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenNeedsReview: () => void;
}

export function CaptureActivityCard({
  data,
  isLoading,
  error,
  onRetry,
  onOpenNeedsReview,
}: CaptureActivityCardProps) {
  const { t } = useI18n();

  const total = data?.perDay.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const maxCount = useMemo(
    () => Math.max(1, ...(data?.perDay.map((day) => day.count) ?? [1])),
    [data],
  );

  return (
    <div className="border border-border rounded-xl p-4 md:p-6">
      <div className="flex items-center justify-between mb-3 md:mb-4">
        <div className="flex items-center gap-2">
          <Browsers className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-base md:text-lg font-semibold text-foreground">
            {t("dashboard.captureActivity")}
          </h2>
        </div>
        {data && total > 0 && (
          <span className="text-xs text-muted-foreground">
            {t("dashboard.captureActivityWindow", {
              count: total,
              days: data.windowDays,
            })}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3" aria-busy="true">
          <div className="h-16 flex items-end gap-0.5">
            {Array.from({ length: 30 }).map((_, i) => (
              <div key={i} className="flex-1 h-full bg-muted rounded-sm" />
            ))}
          </div>
          <div className="h-4 w-2/3 bg-muted rounded" />
        </div>
      ) : error ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive">
            {t("dashboard.captureActivityError")}
            {error ? `: ${error}` : ""}
          </p>
          <button
            onClick={onRetry}
            className="self-start inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            <ArrowClockwise className="w-4 h-4" />
            {t("dashboard.captureActivityRetry")}
          </button>
        </div>
      ) : !data || total === 0 ? (
        <div className="flex items-center gap-3 py-4 text-muted-foreground">
          <Tray className="w-8 h-8 opacity-50 shrink-0" />
          <p className="text-sm">{t("dashboard.captureActivityEmpty")}</p>
        </div>
      ) : (
        <>
          {/* Captures-per-day sparkline (dependency-free, like ActivityChart) */}
          <div
            className="h-14 md:h-16 flex items-end gap-[2px] mb-4"
            role="img"
            aria-label={t("dashboard.captureActivityWindow", {
              count: total,
              days: data.windowDays,
            })}
          >
            {data.perDay.map((day) => (
              <div
                key={day.date}
                className="flex-1 flex flex-col justify-end min-w-0"
                title={`${day.date}: ${day.count}`}
              >
                <div
                  className={`w-full rounded-sm ${
                    day.count > 0 ? "bg-primary/70" : "bg-muted"
                  }`}
                  style={{
                    height: day.count > 0
                      ? `${Math.max(12, (day.count / maxCount) * 100)}%`
                      : "2px",
                  }}
                />
              </div>
            ))}
          </div>

          {/* Per-source breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {data.bySource.map((source) => (
              <div
                key={source.source}
                className="p-2 bg-muted/50 rounded-lg text-center"
              >
                <p className="text-lg font-semibold text-foreground">
                  {source.count}
                </p>
                <p className="text-[10px] md:text-xs text-muted-foreground line-clamp-1">
                  {t(SOURCE_LABEL_KEYS[source.source])}
                </p>
              </div>
            ))}
          </div>

          {/* Needs-attention link (hidden when nothing needs review) */}
          {data.needsAttention > 0 && (
            <button
              onClick={onOpenNeedsReview}
              className="w-full flex items-center gap-2 p-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Warning className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-sm text-foreground">
                {t("dashboard.captureNeedsAttention", {
                  count: data.needsAttention,
                })}
              </span>
              <span className="ml-auto text-sm text-primary">→</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
