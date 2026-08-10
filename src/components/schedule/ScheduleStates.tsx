import { CalendarBlank, WarningCircle, FunnelSimple } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";

/**
 * Shape-matched workload-band skeleton — keeps workspace geometry stable while
 * forecast and item data load.
 */
export function ScheduleWorkloadBandSkeleton() {
  return (
    <div className="border-b border-border bg-card overflow-hidden">
      <div className="px-4 pt-2.5 pb-2 space-y-2">
        <div className="flex items-center gap-3">
          {[24, 40, 56, 64].map((w, i) => (
            <div key={i} className="animate-pulse bg-muted rounded h-6" style={{ width: w }} />
          ))}
        </div>
        <div className="flex gap-1.5 overflow-hidden">
          {Array.from({ length: 12 }, (_, i) => (
            <div
              key={i}
              className="animate-pulse bg-muted rounded-lg h-14 w-14 flex-shrink-0"
              style={{ animationDelay: `${i * 40}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Shape-matched row skeleton for the agenda/grid body. */
export function ScheduleRowsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="border-b border-border px-4 py-1.5 bg-background/95">
        <div className="animate-pulse bg-muted rounded h-4 w-40" />
      </div>
      <div className="space-y-0">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40">
            <div className="animate-pulse bg-muted rounded-lg w-8 h-8 flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="animate-pulse bg-muted rounded h-3.5 w-2/3" />
              <div className="animate-pulse bg-muted rounded h-3 w-1/3" />
            </div>
            <div className="animate-pulse bg-muted rounded h-6 w-24 flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface ScheduleEmptyStateProps {
  variant: "empty" | "filtered-empty";
  selectedDate?: string | null;
  onShowAll?: () => void;
}

/**
 * Distinct empty states: a genuinely empty schedule, and a selected date with
 * no results (preserves and explains the filter, with a clear route back).
 */
export function ScheduleEmptyState({
  variant,
  selectedDate,
  onShowAll,
}: ScheduleEmptyStateProps) {
  const { t } = useI18n();

  if (variant === "filtered-empty") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center">
        <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-4">
          <FunnelSimple className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">{t("schedule.noItemsForDate")}</p>
        {selectedDate && (
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            {formatSelectedDate(selectedDate)}
          </p>
        )}
        <button
          onClick={onShowAll}
          className="mt-4 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-sm font-semibold transition-colors min-h-[36px]"
        >
          {t("schedule.showAllUpcoming")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
        <CalendarBlank className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{t("schedule.noItemsScheduled")}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">
        {t("schedule.noItemsScheduledDesc")}
      </p>
    </div>
  );
}

/** Inline load error with Retry — retains the Schedule shell. */
export function ScheduleErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-4">
        <WarningCircle className="w-6 h-6 text-destructive" />
      </div>
      <p className="text-sm font-medium text-foreground">{t("schedule.loadFailed")}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-sm">{t("schedule.loadFailedDesc")}</p>
      <button
        onClick={onRetry}
        className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-semibold transition-colors min-h-[36px]"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

function formatSelectedDate(dateKey: string): string {
  const [y, m, d] = dateKey.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
