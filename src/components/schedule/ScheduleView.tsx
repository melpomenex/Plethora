import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { parseScheduleDate } from "../../lib/scheduleUtils";
import type { ScheduleDayItem, ForecastPoint, QueueItem } from "../../types/queue";
import { getWorkloadForecast } from "../../api/analytics";
import { getQueue, postponeItem, bulkSuspendItems, bulkUnsuspendItems, bulkDeleteItems } from "../../api/queue";
import { buildScheduleViewModel, localDateKey, dateKey, spreadTargetDay, type ScheduleViewModel } from "../../lib/scheduleViewModel";
import type { ScheduleActionCallbacks } from "../../lib/scheduleActions";
import { ScheduleWorkspaceHeader, type ScheduleViewMode } from "./ScheduleWorkspaceHeader";
import { ScheduleWorkloadBand } from "./ScheduleWorkloadBand";
import { ScheduleAgenda } from "./ScheduleAgenda";
import { ScheduleDataGrid } from "./ScheduleDataGrid";
import { SpreadModal } from "./SpreadModal";
import {
  ScheduleWorkloadBandSkeleton,
  ScheduleRowsSkeleton,
  ScheduleEmptyState,
  ScheduleErrorState,
} from "./ScheduleStates";
import { useToast } from "../common/Toast";
import { cn } from "../../utils";
import { subscribeItemTagsUpdated } from "../../lib/tagEditing/itemTagEvents";

interface ScheduleViewProps {
  isMobile?: boolean;
  onStartReview?: (itemId?: string) => void;
  onOpenDocument?: (documentId: string, title: string) => void;
}

function queueItemToScheduleDay(item: {
  id: string;
  documentId: string;
  documentTitle: string;
  question?: string;
  clozeText?: string;
  documentFileType?: string;
  itemType: string;
  dueDate?: string;
  estimatedTime: number;
  stability?: number;
  difficulty?: number;
  interval?: number;
  retrievability?: number;
  priority: number;
  tags: string[];
  category?: string;
  progress: number;
  lapses?: number;
  reps?: number;
}): ScheduleDayItem | null {
  if (!item.dueDate) return null;
  return {
    id: item.id,
    documentId: item.documentId,
    documentTitle: item.documentTitle,
    question: item.question,
    clozeText: item.clozeText,
    documentFileType: item.documentFileType as ScheduleDayItem["documentFileType"],
    itemType: item.itemType as ScheduleDayItem["itemType"],
    dueDate: item.dueDate,
    estimatedTime: item.estimatedTime,
    stability: item.stability,
    difficulty: item.difficulty,
    interval: item.interval,
    retrievability: item.retrievability,
    priority: item.priority,
    tags: item.tags ?? [],
    category: item.category,
    progress: item.progress,
    lapses: item.lapses,
    reps: item.reps,
  };
}

/** Map stored view-mode values (legacy "cards"/"table") to the new modes, falling back safely. */
function readViewMode(raw: string | null, isMobile: boolean): ScheduleViewMode {
  if (raw === "cards" || raw === "agenda") return "agenda";
  if (raw === "table" || raw === "grid") return "grid";
  return isMobile ? "agenda" : "grid";
}

export function ScheduleView({ isMobile = false, onStartReview, onOpenDocument }: ScheduleViewProps) {
  const { t } = useI18n();
  const toast = useToast();

  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [scheduleItems, setScheduleItems] = useState<ScheduleDayItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>(() =>
    readViewMode(localStorage.getItem("incrementum_schedule_view_mode"), isMobile),
  );
  const [isOverviewCollapsed, setIsOverviewCollapsed] = useState(() => {
    return localStorage.getItem("incrementum_schedule_dashboard_collapsed") === "true";
  });

  // Spread modal state
  const [showSpread, setShowSpread] = useState(false);
  const [spreadSourceDate, setSpreadSourceDate] = useState<string>("");

  const todayKey = useMemo(() => localDateKey(new Date()), []);

  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // View model — all derived schedule semantics live here.
  const viewModel: ScheduleViewModel = useMemo(
    () =>
      buildScheduleViewModel({
        forecast,
        items: scheduleItems,
        todayKey,
        selectedDate,
      }),
    [forecast, scheduleItems, todayKey, selectedDate],
  );

  // Persist desktop view-mode + overview-collapse preferences (legacy keys).
  useEffect(() => {
    if (!isMobile) {
      localStorage.setItem("incrementum_schedule_view_mode", viewMode === "agenda" ? "cards" : "table");
    }
  }, [viewMode, isMobile]);

  useEffect(() => {
    localStorage.setItem("incrementum_schedule_dashboard_collapsed", String(isOverviewCollapsed));
  }, [isOverviewCollapsed]);

  // Clear a selected date safely when refreshed data no longer contains it.
  const reconcileSelectedDate = useCallback((items: ScheduleDayItem[], selected: string | null) => {
    if (!selected) return;
    const key = dateKey(selected);
    const exists = items.some((i) => i.dueDate && dateKey(i.dueDate) === key);
    if (!exists) setSelectedDate(null);
  }, []);

  const mapQueueItems = useCallback((queueItems: QueueItem[]) => {
    return queueItems
      .map(queueItemToScheduleDay)
      .filter((i): i is ScheduleDayItem => i !== null)
      .sort((a, b) => {
        const dateDiff = a.dueDate.localeCompare(b.dueDate);
        if (dateDiff !== 0) return dateDiff;
        return b.priority - a.priority;
      });
  }, []);

  const loadData = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [forecastData, queueItems] = await Promise.all([
        getWorkloadForecast(90),
        getQueue(),
      ]);
      setForecast(forecastData.points);
      const scheduled = mapQueueItems(queueItems);
      setScheduleItems(scheduled);
      reconcileSelectedDate(scheduled, selectedDateRef.current);
      return true;
    } catch (err) {
      console.error("Failed to load schedule data:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [mapQueueItems, reconcileSelectedDate]);

  // Reconcile the visible workload model after a mutation: one bounded refresh
  // of forecast + items (never a per-item follow-up request or page reload).
  const reconcileAfterMutation = useCallback(async () => {
    try {
      const [forecastData, queueItems] = await Promise.all([
        getWorkloadForecast(90),
        getQueue(),
      ]);
      setForecast(forecastData.points);
      const scheduled = mapQueueItems(queueItems);
      setScheduleItems(scheduled);
      reconcileSelectedDate(scheduled, selectedDateRef.current);
    } catch (err) {
      console.error("Failed to reconcile schedule after mutation:", err);
      toast.error(t("schedule.actionFailed"));
    }
  }, [mapQueueItems, reconcileSelectedDate, toast, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Cross-surface tag reconciliation: when a tag mutation is persisted from
  // ANY surface (Queue, Documents, graph, ...), perform the same bounded
  // refresh used after postpone so the visible schedule item converges on the
  // persisted tag list without a full reload.
  useEffect(() => {
    return subscribeItemTagsUpdated(() => {
      void reconcileAfterMutation();
    });
  }, [reconcileAfterMutation]);

  const handlePostpone = useCallback(
    async (itemId: string, days: number, itemType?: string) => {
      try {
        await postponeItem(itemId, days, itemType);
        toast.success(t("schedule.postponed", { count: days }));
        await reconcileAfterMutation();
      } catch {
        toast.error(t("schedule.postponeFailed"));
      }
    },
    [reconcileAfterMutation, toast, t],
  );

  const handleOpen = useCallback(
    (item: ScheduleDayItem) => {
      if (item.itemType === "learning-item") {
        onStartReview?.(item.id);
      } else {
        onOpenDocument?.(item.documentId, item.documentTitle);
      }
    },
    [onStartReview, onOpenDocument],
  );

  const handleSuspend = useCallback(
    async (itemId: string, itemType: string) => {
      try {
        if (itemType === "learning-item") {
          await bulkSuspendItems([itemId]);
          toast.success(t("schedule.itemSuspended"));
        }
        await reconcileAfterMutation();
      } catch {
        toast.error(t("schedule.actionFailed"));
      }
    },
    [reconcileAfterMutation, toast, t],
  );

  const handleUnsuspend = useCallback(
    async (itemId: string, itemType: string) => {
      try {
        if (itemType === "learning-item") {
          await bulkUnsuspendItems([itemId]);
          toast.success(t("schedule.itemUnsuspended"));
        }
        await reconcileAfterMutation();
      } catch {
        toast.error(t("schedule.actionFailed"));
      }
    },
    [reconcileAfterMutation, toast, t],
  );

  const handleDelete = useCallback(
    async (itemId: string, _itemType: string) => {
      try {
        await bulkDeleteItems([itemId]);
        toast.success(t("schedule.itemDeleted"));
        await reconcileAfterMutation();
      } catch {
        toast.error(t("schedule.actionFailed"));
      }
    },
    [reconcileAfterMutation, toast, t],
  );

  const handleDismiss = useCallback(
    async (itemId: string) => {
      try {
        await bulkDeleteItems([itemId]);
        toast.success(t("schedule.itemDismissed"));
        await reconcileAfterMutation();
      } catch {
        toast.error(t("schedule.actionFailed"));
      }
    },
    [reconcileAfterMutation, toast, t],
  );

  const handleSpreadToolbar = useCallback(() => {
    if (!viewModel.canSpread || !viewModel.spreadSource) return;
    setSpreadSourceDate(viewModel.spreadSource.dateKey);
    setShowSpread(true);
  }, [viewModel.canSpread, viewModel.spreadSource]);

  const getItemsForDate = useCallback(
    (date: string) => {
      const key = dateKey(date);
      return scheduleItems.filter((i) => dateKey(i.dueDate) === key);
    },
    [scheduleItems],
  );

  const handleSpreadConfirm = useCallback(
    async (itemIds: string[], horizonDays: number) => {
      const items = getItemsForDate(spreadSourceDate);
      const eligibleItems = items.filter((i) => itemIds.includes(i.id));

      const perDay = Math.ceil(eligibleItems.length / horizonDays);
      const source = parseScheduleDate(spreadSourceDate);
      const batchSize = 20;
      for (let i = 0; i < eligibleItems.length; i += batchSize) {
        const batch = eligibleItems.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (item, idx) => {
            // Use the absolute index within the eligible set so items spread
            // evenly across the horizon (a batch-start index would cluster
            // every item in a batch onto the same target day).
            const absoluteIndex = i + idx;
            const targetDay = spreadTargetDay(absoluteIndex, eligibleItems.length, horizonDays);
            const targetDate = new Date(
              source.getTime() + targetDay * 86400000,
            );
            const daysToAdd = Math.max(
              1,
              Math.ceil((targetDate.getTime() - source.getTime()) / 86400000),
            );
            const jitter = Math.floor(Math.random() * Math.min(perDay, 7));
            const totalDays = Math.min(daysToAdd + jitter, horizonDays);
            await postponeItem(item.id, totalDays, item.itemType);
          }),
        );
      }

      await reconcileAfterMutation();
    },
    [spreadSourceDate, getItemsForDate, reconcileAfterMutation],
  );

  // Per-item busy state: item ids currently running a mutation.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const busyCallbacks: ScheduleActionCallbacks = useMemo(() => {
    const withBusy = <A extends unknown[], R>(
      fn: (...args: A) => Promise<R>,
      idOf: (...args: A) => string,
    ) => async (...args: A): Promise<R> => {
      const id = idOf(...args);
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        return await fn(...args);
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    };
    return {
      onOpen: handleOpen,
      onPostpone: withBusy(handlePostpone, (id) => id),
      onSuspend: withBusy(handleSuspend, (id) => id),
      onUnsuspend: withBusy(handleUnsuspend, (id) => id),
      onDismiss: withBusy(handleDismiss, (id) => id),
      onDelete: withBusy(handleDelete, (id) => id),
    };
  }, [handleOpen, handlePostpone, handleSuspend, handleUnsuspend, handleDismiss, handleDelete]);

  // Render helpers
  const renderBody = () => {
    if (isLoading) {
      return <ScheduleRowsSkeleton />;
    }
    if (loadError) {
      return <ScheduleErrorState onRetry={() => loadData()} />;
    }
    if (viewModel.visibleGroups.length === 0) {
      if (viewModel.groups.length === 0) {
        return <ScheduleEmptyState variant="empty" />;
      }
      return (
        <ScheduleEmptyState
          variant="filtered-empty"
          selectedDate={selectedDate}
          onShowAll={() => setSelectedDate(null)}
        />
      );
    }
    if (viewMode === "grid" && !isMobile) {
      return (
        <ScheduleDataGrid
          groups={viewModel.visibleGroups}
          callbacks={busyCallbacks}
          busyIds={busyIds}
        />
      );
    }
    return (
      <ScheduleAgenda
        groups={viewModel.visibleGroups}
        callbacks={busyCallbacks}
        busyIds={busyIds}
        isMobile={isMobile}
      />
    );
  };

  const spreadDisabledReason =
    viewModel.spreadSource == null
      ? t("schedule.spreadNoSource")
      : t("schedule.spreadNoEligible");

  return (
    <div className={cn("flex flex-col h-full bg-background", isMobile && "pb-safe")}>
      <ScheduleWorkspaceHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSpread={handleSpreadToolbar}
        canSpread={viewModel.canSpread}
        spreadDisabledReason={spreadDisabledReason}
        isOverviewCollapsed={isOverviewCollapsed}
        onToggleOverview={() => setIsOverviewCollapsed((v) => !v)}
        selectedDate={selectedDate}
        onClearDate={() => setSelectedDate(null)}
        insights={viewModel.insights}
        isMobile={isMobile}
      />

      {isLoading ? (
        <ScheduleWorkloadBandSkeleton />
      ) : (
        <ScheduleWorkloadBand
          forecastDays={viewModel.forecastDays}
          insights={viewModel.insights}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          collapsed={isOverviewCollapsed}
          onToggleCollapse={() => setIsOverviewCollapsed((v) => !v)}
          spreadSource={viewModel.spreadSource}
          canSpread={viewModel.canSpread}
        />
      )}

      {renderBody()}

      <SpreadModal
        isOpen={showSpread}
        onClose={() => setShowSpread(false)}
        items={getItemsForDate(spreadSourceDate)}
        sourceDate={spreadSourceDate}
        forecast={forecast}
        onConfirm={handleSpreadConfirm}
        onToast={(msg, desc) => {
          if (desc) toast.success(msg, desc);
          else toast.success(msg);
        }}
        isMobile={isMobile}
      />
    </div>
  );
}
