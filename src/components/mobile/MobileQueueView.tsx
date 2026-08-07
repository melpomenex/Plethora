/**
 * Mobile Queue View - Simplified for PWA
 * 
 * A streamlined mobile-optimized queue view that:
 * - Shows only essential information
 * - Collapses complex filters into a drawer
 * - Prioritizes quick actions (Start Reading, Scroll Mode)
 * - Uses cards optimized for touch
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Archive,
  BookOpen,
  Brain,
  Calendar,
  CalendarBlank,
  CaretDown,
  Check,
  Clock,
  DeviceMobile,
  DotsThree,
  MagnifyingGlass,
  Play,
  Sliders,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useQueueStore } from "../../stores/queueStore";
import type { QueueItem } from "../../types/queue";
import { useToast } from "../common/Toast";
import { cn } from "../../utils";
import { SwipeableItem } from "./SwipeableItem";
import { PullToRefresh } from "./PullToRefresh";
import { bulkSuspendItems, bulkUnsuspendItems } from "../../api/queue";
import { dismissDocument } from "../../api/documents";
import { useI18n } from "../../lib/i18n";
import { useLongPress } from "../../hooks/useLongPress";
import { useIsActiveTab } from "../common/Tabs";
import { MobileScheduleView } from "../schedule/MobileScheduleView";
import { useSettingsStore } from "../../stores/settingsStore";
import { orderQueueItems, type OrderedQueueItem, type PriorityPreset } from "../../utils/reviewUx";
import { QueueItemActionSheet } from "../queue/QueueItemActionSheet";
import { useStartupStore } from "../../stores/startupStore";
import { DynamicVirtualList } from "../common/VirtualList";

/**
 * Above this many filtered items the mobile queue list windows its rows
 * (same threshold as the desktop queue in ReviewQueueView). Small queues keep
 * the plain map — no virtualization overhead, identical markup to before.
 */
const MOBILE_QUEUE_VIRTUALIZE_THRESHOLD = 20;

interface MobileQueueViewProps {
  onStartReview?: (itemId?: string, queueItemIds?: string[]) => void;
  onOpenDocument?: (item: QueueItem) => void;
  onOpenScrollMode?: (options?: { items?: QueueItem[]; mode?: "queue-list" | "optimal" }) => void;
}

type QuickFilter = "today" | "all" | "new";

// sessionStorage key for the queue list scroll offset. Survives the
// display:none → visible cycle (and a full remount) so the queue doesn't
// jump back to the top when the user returns from another tab.
const SCROLL_RESTORE_KEY = "incrementum.mobileQueue.scroll";

export function MobileQueueView({
  onStartReview,
  onOpenDocument,
  onOpenScrollMode,
}: MobileQueueViewProps) {
  const {
    items,
    isLoading,
    selectedIds,
    loadQueue,
    loadDueQueueItems,
    setQueueFilterMode,
    setSelected,
    clearSelection,
    bulkSuspend,
    bulkUnsuspend,
    bulkDelete,
    postponeItemSmart,
  } = useQueueStore(
    useShallow((state) => ({
      items: state.items,
      isLoading: state.isLoading,
      selectedIds: state.selectedIds,
      loadQueue: state.loadQueue,
      loadDueQueueItems: state.loadDueQueueItems,
      setQueueFilterMode: state.setQueueFilterMode,
      setSelected: state.setSelected,
      clearSelection: state.clearSelection,
      bulkSuspend: state.bulkSuspend,
      bulkUnsuspend: state.bulkUnsuspend,
      bulkDelete: state.bulkDelete,
      postponeItemSmart: state.postponeItemSmart,
    }))
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<"reading" | "review" | "schedule">("reading");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("today");
  const { t } = useI18n();
  const toast = useToast();
  const queueStrategyPreset = useSettingsStore(
    (state) => state.settings.smartQueue.queueStrategyPreset as PriorityPreset,
  );

  // Multi-select mode: entered from an item action sheet. While active, tapping
  // a row toggles selection instead of opening it.
  const [selectionMode, setSelectionMode] = useState(false);
  const [actionItem, setActionItem] = useState<QueueItem | null>(null);
  const actionTriggerRef = useRef<HTMLElement | null>(null);

  // --- Scroll position preservation across tab switches ---
  // MobileQueueView is kept mounted (display:none) when inactive, so React
  // state survives — but scrollTop is DOM state that resets to 0 when the
  // element is hidden. We capture it continuously and restore on reactivation.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollRef = useRef(0);
  const scrollAnchorRef = useRef<{ id: string; offset: number } | null>(null);
  const isActiveTab = useIsActiveTab();
  const ensureStartup = useStartupStore((state) => state.ensureStartup);
  const wasActiveRef = useRef(isActiveTab);

  // Persist scroll continuously so a remount (e.g. after scroll mode) can also
  // restore it, not just the keep-alive hide/show cycle.
  //
  // Bound as an onScroll PROP on the scroll container (both the plain-list div
  // and the virtualized list) rather than an effect that addEventListener's to
  // listScrollRef.current once. The scroll container element swaps when the
  // list crosses the virtualization threshold (or isLoading toggles), and a
  // once-bound listener would strand on the detached element and silently stop
  // saving — breaking scroll restore for exactly the large queues that
  // virtualize. Reading e.currentTarget keeps it correct across the swap.
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    savedScrollRef.current = top;
    try {
      sessionStorage.setItem(SCROLL_RESTORE_KEY, String(top));
    } catch {
      // sessionStorage may be unavailable (private mode); ref still holds it.
    }
  }, []);

  // NOTE: a previous "reconcile-on-focus" effect auto-reloaded the queue via
  // reconcileIfDirty() whenever this tab regained focus. It fired whenever
  // hasLocalDeltas was armed by ANY local mutation (postpone / suspend / delete,
  // even a single item), and the resulting server refetch recomputed the
  // engagement/priority sort — reshuffling the whole list on every return. It
  // has been removed so the displayed order stays stable across tab switches;
  // local deltas already update `items` optimistically. For a genuine server
  // refresh, the Toolbar's refresh button still calls the load functions
  // directly.

  // On a false → true (re)activation, restore the saved scroll position.
  useEffect(() => {
    if (!wasActiveRef.current && isActiveTab) {
      const restore = () => {
        const el = listScrollRef.current;
        if (!el) return;
        let top = savedScrollRef.current;
        if (!top) {
          try {
            top = Number(sessionStorage.getItem(SCROLL_RESTORE_KEY)) || 0;
          } catch {
            top = 0;
          }
        }
        el.scrollTo({ top });
      };
      // Defer until after the tab is actually visible (display:none → block),
      // otherwise scrollTop can't be set.
      requestAnimationFrame(restore);
    }
    wasActiveRef.current = isActiveTab;
  }, [isActiveTab]);

  const captureScrollAnchor = useCallback(() => {
    const container = listScrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const firstVisible = Array.from(
      container.querySelectorAll<HTMLElement>("[data-queue-item-id]"),
    ).find((row) => row.getBoundingClientRect().bottom > containerTop + 1);
    if (!firstVisible) return;
    scrollAnchorRef.current = {
      id: firstVisible.dataset.queueItemId ?? "",
      offset: firstVisible.getBoundingClientRect().top - containerTop,
    };
  }, []);

  // Undo toast state
  const [undoState, setUndoState] = useState<{
    visible: boolean;
    action: "suspend" | "postpone" | "dismiss";
    itemId: string;
    documentId?: string;
    itemTitle: string;
    progress: number;
  } | null>(null);

  // Load the queue based on the active quick filter, but NEVER on a bare
  // isActiveTab false→true transition (e.g. returning to the queue after
  // exiting Scroll Mode): that reload recomputes the engagement/priority sort
  // and on a large queue a transition-triggered reload cycles the item count.
  // We reload on first activation and when the quick filter genuinely changes
  // (an explicit user action). Genuine refresh also via pull-to-refresh.
  //
  // The "which quick filter is currently loaded" state lives in the QUEUE
  // STORE's `loadedQueryKey` (namespaced `mobile:` so it doesn't collide with
  // the desktop view's key) rather than a component ref: a ref resets on tab
  // unmount, so closing/reopening the mobile queue tab re-ran the first-load
  // path over an already-loaded queue. See design decision D3.
  useEffect(() => {
    if (!isActiveTab) return;
    // Skip when the quick filter is unchanged (returning to the same tab).
    const mobileKey = `mobile:${quickFilter}`;
    const storeState = useQueueStore.getState();
    if (storeState.loadedQueryKey === mobileKey) return;
    storeState.setLoadedQueryKey(mobileKey);
    if (quickFilter === "today") {
      void ensureStartup("queue", { queueMode: "due-today" }).then(() => {
        if (useQueueStore.getState().items.length <= 50) {
          void loadDueQueueItems();
        }
      });
      return;
    }
    switch (quickFilter) {
      case "all":
        setQueueFilterMode("all-items");
        break;
      case "new":
        setQueueFilterMode("new-only");
        break;
    }
  }, [quickFilter, ensureStartup, isActiveTab, setQueueFilterMode, loadDueQueueItems]);

  // Filter items
  const filteredItems = useMemo(() => {
    let result = items.filter((item) => {
      if (activeTab === "review") {
        return item.itemType === "learning-item";
      }
      return item.itemType === "document";
    });

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.documentTitle.toLowerCase().includes(query) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    return orderQueueItems(result, queueStrategyPreset);
  }, [items, activeTab, searchQuery, queueStrategyPreset]);

  useEffect(() => {
    if (isLoading || !scrollAnchorRef.current) return;
    const frame = requestAnimationFrame(() => {
      const container = listScrollRef.current;
      const anchor = scrollAnchorRef.current;
      if (!container || !anchor?.id) return;
      const row = Array.from(
        container.querySelectorAll<HTMLElement>("[data-queue-item-id]"),
      ).find((candidate) => candidate.dataset.queueItemId === anchor.id);
      if (row) {
        const containerTop = container.getBoundingClientRect().top;
        container.scrollTop += row.getBoundingClientRect().top - containerTop - anchor.offset;
      }
      scrollAnchorRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [filteredItems, isLoading]);

  const dueCount = useMemo(() => {
    return items.filter((item) => {
      if (item.itemType !== "document") return false;
      const due = item.dueDate ? new Date(item.dueDate) : null;
      return due && due <= new Date();
    }).length;
  }, [items]);

  const newCount = useMemo(() => {
    return items.filter((item) => 
      item.itemType === "document" && !item.dueDate
    ).length;
  }, [items]);

  const handleStartSession = () => {
    const firstDue = filteredItems[0];
    if (!firstDue) {
      toast.info(t("mobileQueue.noItemsReady"), t("mobileQueue.noItemsReadyDesc"));
      return;
    }
    if (activeTab === "review") {
      const reviewQueueIds = filteredItems
        .filter((item) => item.itemType === "learning-item")
        .map((item) => item.learningItemId ?? item.id);
      if (reviewQueueIds.length > 0) {
        onStartReview?.(reviewQueueIds[0], reviewQueueIds);
      }
      return;
    }
    // On mobile, "Start Reading" opens Scroll Mode — the same immersive flow the
    // Scroll Mode button uses — so the experience matches (bottom action bar,
    // swipe navigation, draggable video/transcript split). The standalone
    // DocumentViewer tab path lacks queue chrome for YouTube and uses a
    // per-document tab model. Fall back to opening the document directly only
    // if scroll mode isn't wired up.
    if (onOpenScrollMode) {
      onOpenScrollMode({ mode: "optimal" });
    } else {
      onOpenDocument?.(firstDue);
    }
  };

  // Note: getDueBadge is defined at module level (below) so QueueRow can share it.

  // Swipe handlers
  const handleSuspend = useCallback(async (item: QueueItem) => {
    captureScrollAnchor();
    try {
      await bulkSuspendItems([item.id]);
      toast.success(t("mobileQueue.itemSuspended"), t("mobileQueue.removedFromQueue"));
      // Drop the one suspended item locally (design D2) — no full reload.
      useQueueStore.getState().removeItemsLocally([item.id]);

      setUndoState({
        visible: true,
        action: "suspend",
        itemId: item.id,
        itemTitle: item.documentTitle,
        progress: 100,
      });

      const startTime = Date.now();
      const duration = 3000; // 3 seconds

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 100 - (elapsed / duration) * 100);

        setUndoState((prev) => prev ? { ...prev, progress: remaining } : null);

        if (elapsed < duration && undoState?.visible) {
          requestAnimationFrame(animate);
        } else if (undoState?.visible) {
          setUndoState((prev) => (prev ? { ...prev, visible: false } : null));
        }
      };

      requestAnimationFrame(animate);
    } catch (error) {
      toast.error(t("mobileQueue.failedToSuspend"), error instanceof Error ? error.message : t("reviewSession.unknownError"));
    }
  }, [captureScrollAnchor, loadQueue, toast, undoState?.visible]);

  const handlePostpone = useCallback(async (item: QueueItem) => {
    captureScrollAnchor();
    try {
      // postponeItemSmart applies the new due date to store state itself
      // (local delta, design D2) — no full queue reload here.
      const result = await postponeItemSmart(item);
      toast.success(
        t("mobileQueue.itemPostponed"),
        t("mobileQueue.rescheduledByDays", { days: result.increase }),
      );

      // Show undo toast (for postpone, we'd need to store the original due date to undo)
      setUndoState({
        visible: true,
        action: "postpone",
        itemId: item.id,
        itemTitle: item.documentTitle,
        progress: 100,
      });

      const startTime = Date.now();
      const duration = 3000;

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 100 - (elapsed / duration) * 100);

        setUndoState((prev) => prev ? { ...prev, progress: remaining } : null);

        if (elapsed < duration && undoState?.visible) {
          requestAnimationFrame(animate);
        } else if (undoState?.visible) {
          setUndoState((prev) => (prev ? { ...prev, visible: false } : null));
        }
      };

      requestAnimationFrame(animate);
    } catch (error) {
      toast.error(t("mobileQueue.failedToPostpone"), error instanceof Error ? error.message : t("reviewSession.unknownError"));
    }
  }, [captureScrollAnchor, loadQueue, postponeItemSmart, toast, t, undoState?.visible]);

  const handleActionPostpone = useCallback(async (item: QueueItem) => {
    await handlePostpone(item);
  }, [handlePostpone]);

  const handleActionRemove = useCallback(async (item: QueueItem) => {
    captureScrollAnchor();
    try {
      if (item.itemType === "learning-item") {
        const result = await bulkSuspendItems([item.id]);
        if (result.failed.length > 0) {
          throw new Error(result.errors.join(", "));
        }
        toast.success(t("mobileQueue.itemSuspended"), t("mobileQueue.removedFromQueue"));
        setUndoState({
          visible: true,
          action: "suspend",
          itemId: item.id,
          itemTitle: item.documentTitle,
          progress: 100,
        });
      } else if (item.itemType === "document") {
        await dismissDocument(item.documentId, true);
        toast.success(t("queueScroll.documentDismissed"), t("queueScroll.documentDismissedDesc"));
        setUndoState({
          visible: true,
          action: "dismiss",
          itemId: item.id,
          documentId: item.documentId,
          itemTitle: item.documentTitle,
          progress: 100,
        });
      }
      await loadQueue();
    } catch (error) {
      toast.error(
        t("mobileQueue.failedToRemove"),
        error instanceof Error ? error.message : t("reviewSession.unknownError"),
      );
    }
  }, [captureScrollAnchor, loadQueue, t, toast]);

  const openItemActions = useCallback((item: QueueItem, trigger?: HTMLElement) => {
    actionTriggerRef.current = trigger ?? null;
    setActionItem(item);
  }, []);

  const closeItemActions = useCallback(() => {
    setActionItem(null);
    requestAnimationFrame(() => actionTriggerRef.current?.focus());
  }, []);

  const handleUndo = useCallback(async () => {
    if (!undoState) return;

    try {
      if (undoState.action === "suspend") {
        await bulkUnsuspendItems([undoState.itemId]);
        toast.success(t("mobileQueue.itemRestored"), t("mobileQueue.backInQueue"));
      } else if (undoState.action === "dismiss" && undoState.documentId) {
        await dismissDocument(undoState.documentId, false);
        toast.success(t("mobileQueue.itemRestored"), t("mobileQueue.backInQueue"));
      }
      // Postpone undo would require storing the original due date
      loadQueue();
    } catch (error) {
      toast.error(t("mobileQueue.failedToUndo"), error instanceof Error ? error.message : t("reviewSession.unknownError"));
    } finally {
      setUndoState(null);
    }
  }, [undoState, loadQueue, toast]);

  // --- Multi-select helpers ---
  const enterSelection = useCallback((itemId: string) => {
    setSelectionMode(true);
    setSelected(itemId, true);
  }, [setSelected]);

  const toggleSelect = useCallback((itemId: string) => {
    // Reuse the store's current selection to decide toggle direction so we
    // don't depend on stale closure state.
    const isSelected = useQueueStore.getState().selectedIds.has(itemId);
    setSelected(itemId, !isSelected);
  }, [setSelected]);

  const exitSelection = useCallback(() => {
    clearSelection();
    setSelectionMode(false);
  }, [clearSelection]);

  // Touch-first surface, but the PWA also runs on desktop browsers where a
  // hardware Escape is the expected way out of a selection.
  useEffect(() => {
    if (!selectionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      exitSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode, exitSelection]);

  const handleBulkSuspend = useCallback(async () => {
    await bulkSuspend();
    toast.success(t("mobileQueue.itemSuspended"), "");
    exitSelection();
    loadQueue();
  }, [bulkSuspend, toast, t, exitSelection, loadQueue]);

  const handleBulkRestore = useCallback(async () => {
    await bulkUnsuspend();
    toast.success(t("mobileQueue.itemRestored"), "");
    exitSelection();
    loadQueue();
  }, [bulkUnsuspend, toast, t, exitSelection, loadQueue]);

  const handleBulkDelete = useCallback(async () => {
    await bulkDelete();
    toast.success(t("mobileQueue.itemSuspended"), "");
    exitSelection();
    loadQueue();
  }, [bulkDelete, toast, t, exitSelection, loadQueue]);

  return (
    <div className="flex flex-col w-full min-w-0 h-full bg-background" data-responsive-surface="queue">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-foreground">
            {activeTab === "reading" ? t("mobileQueue.readingQueue") : activeTab === "schedule" ? t("schedule.title") : t("mobileQueue.review")}
          </h1>
          <div className="flex items-center gap-2">
            {activeTab === "reading" && (
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "p-2 rounded-full transition-colors",
                  showFilters ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                )}
                aria-label={t("mobileQueue.toggleFilters")}
              >
                <Sliders className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-muted rounded-lg p-1">
          <button
            onClick={() => setActiveTab("reading")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "reading"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            )}
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden xs:inline">{t("mobileQueue.reading")}</span>
            {dueCount > 0 && (
              <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                {dueCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "schedule"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            )}
          >
            <CalendarBlank className="w-4 h-4" />
            <span className="hidden xs:inline">{t("schedule.title")}</span>
          </button>
          <button
            onClick={() => setActiveTab("review")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium transition-all",
              activeTab === "review"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground"
            )}
          >
            <Brain className="w-4 h-4" />
            <span className="hidden xs:inline">{t("mobileQueue.review")}</span>
          </button>
        </div>
      </div>

      {activeTab === "schedule" ? (
        <MobileScheduleView
          onStartReview={onStartReview}
          onOpenDocument={(docId, title) => onOpenDocument?.({ id: docId, documentId: docId, documentTitle: title, itemType: "document" } as QueueItem)}
        />
      ) : (
      <>
      {/* Quick Filters (Reading only) */}
      {activeTab === "reading" && (
        <div className="px-4 py-2 border-b border-border bg-card/50">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide" data-horizontal-scroll>
            <button
              onClick={() => setQuickFilter("today")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                quickFilter === "today"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              {t("mobileQueue.dueToday")}
              {dueCount > 0 && <span className="ml-0.5">({dueCount})</span>}
            </button>
            <button
              onClick={() => setQuickFilter("new")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                quickFilter === "new"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              {t("mobileQueue.new")}
              {newCount > 0 && <span className="ml-0.5">({newCount})</span>}
            </button>
            <button
              onClick={() => setQuickFilter("all")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors",
                quickFilter === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              {t("mobileQueue.allItems")}
            </button>
          </div>
        </div>
      )}

      {/* Expanded Filters Panel */}
      {showFilters && activeTab === "reading" && (
        <div className="px-4 py-3 border-b border-border bg-card/50 animate-in slide-in-from-top-2">
          {/* MagnifyingGlass */}
          <div className="relative mb-3">
            <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("mobileQueue.searchPlaceholder")}
              className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Action Buttons */}
      <div className="px-4 py-3 border-b border-border bg-card/30">
        <div className="flex gap-2">
          <button
            onClick={handleStartSession}
            disabled={filteredItems.length === 0}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
          >
            <Play className="w-5 h-5" />
            {activeTab === "reading" ? t("mobileQueue.startReading") : t("mobileQueue.startReview")}
          </button>
          {activeTab === "reading" && onOpenScrollMode && (
            <button
              onClick={() => onOpenScrollMode({ items: filteredItems, mode: "queue-list" })}
              disabled={filteredItems.length === 0}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all"
              title={t("queue.scrollModeTooltip")}
            >
              <DeviceMobile className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Items List — wrapped in PullToRefresh for swipe-down reload. The inner
          div is the scroll container (data-scroll-container) so PullToRefresh
          can detect scroll-top, and its scrollTop is preserved across tab
          switches via listScrollRef (see restore effect above).

          Above MOBILE_QUEUE_VIRTUALIZE_THRESHOLD items the list renders through
          DynamicVirtualList (same threshold as the desktop queue) so a large
          queue mounts only the visible window of rows instead of thousands of
          DOM nodes. The virtual list IS the scroll container in that branch —
          it takes listScrollRef and the data-scroll-container marker, keeping
          the PullToRefresh detection and the scroll save/restore contract that
          commit 2b12f2f2 established (never nest a second scroller). */}
      <PullToRefresh onRefresh={() => loadQueue()} className="flex-1 min-h-0 overflow-hidden">
        {!isLoading && filteredItems.length > MOBILE_QUEUE_VIRTUALIZE_THRESHOLD ? (
          <DynamicVirtualList
            items={filteredItems}
            scrollRef={listScrollRef}
            containerProps={{ "data-scroll-container": "true" }}
            className="h-full min-h-0 overflow-y-auto overscroll-contain"
            estimateSize={88}
            overscan={6}
            onScroll={handleListScroll}
            renderItem={(item) => (
              <QueueRow
                item={item}
                activeTab={activeTab}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(item.id)}
                onToggleSelect={toggleSelect}
                onOpenDocument={onOpenDocument}
                onStartReview={onStartReview}
                onOpenActions={openItemActions}
                onSwipeLeft={handlePostpone}
                onSwipeRight={handleSuspend}
                t={t}
              />
            )}
          />
        ) : (
        <div ref={listScrollRef} onScroll={handleListScroll} className="h-full min-h-0 overflow-y-auto overscroll-contain" data-scroll-container="true">
          {(isLoading && filteredItems.length === 0) ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mr-2" />
              {t("mobileQueue.loading")}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 px-6 text-center">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <BookOpen className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground mb-2">
                {activeTab === "reading"
                  ? t("mobileQueue.noDocumentsReady")
                  : t("mobileQueue.noCardsDueReview")}
              </p>
              <p className="text-sm text-muted-foreground/70">
                {activeTab === "reading"
                  ? t("mobileQueue.importToStart")
                  : t("mobileQueue.allCaughtUp")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredItems.map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  activeTab={activeTab}
                  selectionMode={selectionMode}
                  isSelected={selectedIds.has(item.id)}
                  onToggleSelect={toggleSelect}
                  onOpenDocument={onOpenDocument}
                  onStartReview={onStartReview}
                  onOpenActions={openItemActions}
                  onSwipeLeft={handlePostpone}
                  onSwipeRight={handleSuspend}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
        )}
      </PullToRefresh>

      {/* Stats Footer */}
      <div className="px-4 py-2 border-t border-border bg-card/30 text-center text-xs text-muted-foreground">
        {t("mobileQueue.itemsReady", { count: filteredItems.length })}
      </div>

      <QueueItemActionSheet
        item={actionItem}
        open={Boolean(actionItem)}
        onClose={closeItemActions}
        triggerElement={actionTriggerRef.current}
        onOpenDocument={onOpenDocument}
        onStartReview={onStartReview}
        onPostpone={handleActionPostpone}
        onRemove={handleActionRemove}
        onSelect={(item) => enterSelection(item.id)}
      />

      {/* Undo Toast */}
      {undoState && undoState.visible && (
        <div
          className={cn(
            "undo-toast",
            undoState.visible && "visible"
          )}
        >
          <div
            className={cn(
              "undo-toast-icon",
              undoState.action === "suspend" ? "mark-read" : "favorite"
            )}
          >
            {undoState.action === "suspend" ? (
              <Archive className="w-full h-full" />
            ) : (
              <Calendar className="w-full h-full" />
            )}
          </div>
          <div className="undo-toast-message">
            <span>{undoState.itemTitle}</span>
            <span className="text-xs text-muted-foreground">
              {undoState.action === "suspend" ? ` ${t("mobileQueue.suspended")}` : ` ${t("mobileQueue.postponed")}`}
            </span>
          </div>
          <button onClick={handleUndo} className="undo-toast-action">
            {t("mobileQueue.undo")}
          </button>
          <div className="undo-toast-progress">
            <div
              className="undo-toast-progress-bar"
              style={{ width: `${undoState.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Multi-select action bar — appears above the bottom nav when one or
          more items are selected. Anchored fixed so it floats over the list. */}
      {selectionMode && (
        <div className="fixed left-0 right-0 z-40 px-4 py-3 bg-card border-t border-border"
          style={{ bottom: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={exitSelection}
              className="px-3 py-2 rounded-lg text-sm text-muted-foreground active:bg-muted"
            >
              {t("common.cancel")}
            </button>
            <span className="text-sm text-muted-foreground">
              {selectedIds.size}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkRestore}
                disabled={selectedIds.size === 0}
                className="p-2 rounded-lg bg-muted text-foreground disabled:opacity-40 active:scale-95"
                aria-label={t("mobileQueue.itemRestored")}
              >
                <Archive className="w-5 h-5" />
              </button>
              <button
                onClick={handleBulkSuspend}
                disabled={selectedIds.size === 0}
                className="p-2 rounded-lg bg-muted text-foreground disabled:opacity-40 active:scale-95"
                aria-label={t("mobileQueue.suspend")}
              >
                <Calendar className="w-5 h-5" />
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
                className="p-2 rounded-lg bg-destructive text-destructive-foreground disabled:opacity-40 active:scale-95"
                aria-label={t("common.delete")}
              >
                <Trash className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// --- QueueRow: extracted so the long-press hook is called at the top level of
//     a component (not inside a .map() callback, which would violate the Rules
//     of Hooks). ---
interface QueueRowProps {
  item: OrderedQueueItem;
  activeTab: "reading" | "review" | "schedule";
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (itemId: string) => void;
  onOpenDocument?: (item: QueueItem) => void;
  onStartReview?: (itemId?: string, queueItemIds?: string[]) => void;
  onOpenActions: (item: QueueItem, trigger?: HTMLElement) => void;
  onSwipeLeft: (item: QueueItem) => void;
  onSwipeRight: (item: QueueItem) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

function getDueBadge(item: QueueItem, t: (key: string, params?: Record<string, unknown>) => string) {
  if (!item.dueDate) return null;
  const due = new Date(item.dueDate);
  const now = new Date();
  const daysDiff = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 0) return { label: t("mobileQueue.dueNow"), color: "bg-red-500" };
  if (daysDiff <= 3) return { label: t("mobileQueue.daysShort", { count: daysDiff }), color: "bg-orange-500" };
  return { label: t("mobileQueue.daysShort", { count: daysDiff }), color: "bg-blue-500" };
}

function QueueRow({
  item,
  activeTab,
  selectionMode,
  isSelected,
  onToggleSelect,
  onOpenDocument,
  onStartReview,
  onOpenActions,
  onSwipeLeft,
  onSwipeRight,
  t,
}: QueueRowProps) {
  const dueBadge = getDueBadge(item, t);
  const rowButtonRef = useRef<HTMLButtonElement>(null);
  // Long-press opens the item action sheet. The tap that would otherwise
  // immediately follow a long-press is suppressed via didFire().
  const rowLongPress = useLongPress(() => onOpenActions(item, rowButtonRef.current ?? undefined));

  return (
    <SwipeableItem
      leftAction={{
        icon: <Calendar className="w-5 h-5" />,
        label: t("mobileQueue.postpone"),
        color: "#6366f1",
        bgColor: "rgba(99, 102, 241, 0.15)",
      }}
      rightAction={{
        icon: <Archive className="w-5 h-5" />,
        label: t("mobileQueue.suspend"),
        color: "#6366f1",
        bgColor: "rgba(99, 102, 241, 0.15)",
      }}
      onSwipeLeft={() => onSwipeLeft(item)}
      onSwipeRight={() => onSwipeRight(item)}
      disabled={selectionMode}
      className={cn(
        "border-b border-border last:border-b-0",
        selectionMode && isSelected && "bg-primary/10",
      )}
    >
      <div className="flex items-stretch gap-1" data-queue-item-id={item.id}>
        <button
          ref={rowButtonRef}
          {...(selectionMode ? {} : rowLongPress)}
          onClick={() => {
            if (selectionMode) {
              onToggleSelect(item.id);
              return;
            }
            if (rowLongPress.didFire()) return; // suppress tap right after long-press
            if (activeTab === "reading") {
              onOpenDocument?.(item);
            } else {
              onStartReview?.(item.learningItemId ?? item.id);
            }
          }}
          className="flex-1 min-w-0 px-4 py-4 flex items-start gap-3 active:bg-muted/50 transition-colors text-left"
        >
        {/* Selection checkbox / Icon-Status */}
        <div className="flex-shrink-0 mt-0.5">
          {selectionMode ? (
            <div className={cn(
              "w-6 h-6 rounded-full border-2 flex items-center justify-center",
              isSelected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/40"
            )}>
              {isSelected && <Check className="w-4 h-4" weight="bold" />}
            </div>
          ) : activeTab === "reading" ? (
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              dueBadge ? "bg-red-500/10" : "bg-muted"
            )}>
              <BookOpen className={cn(
                "w-5 h-5",
                dueBadge ? "text-red-500" : "text-muted-foreground"
              )} />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Brain className="w-5 h-5 text-purple-500" />
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground line-clamp-2 mb-1">
            {item.documentTitle}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "px-1.5 py-0.5 rounded font-medium",
                item.isUpNext ? "bg-primary/15 text-primary" : "bg-muted",
              )}
              aria-label={t("queue.queuePosition", {
                position: item.queuePosition,
                total: item.queueTotal,
              })}
            >
              {item.isUpNext
                ? `${t("queue.upNext")} · ${t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}`
                : t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}
            </span>
            {dueBadge && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-white font-medium",
                dueBadge.color
              )}>
                {dueBadge.label}
              </span>
            )}
            {item.category && (
              <span className="bg-muted px-1.5 py-0.5 rounded">
                {item.category}
              </span>
            )}
            {item.documentFileType && (
              <span className="uppercase">{item.documentFileType}</span>
            )}
          </div>
        </div>

        {/* Chevron */}
          <CaretDown className="w-5 h-5 text-muted-foreground -rotate-90 flex-shrink-0 mt-2" />
        </button>
        {!selectionMode && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenActions(item, event.currentTarget);
            }}
            className="mt-3 mr-2 h-10 w-10 flex-shrink-0 rounded-lg text-muted-foreground hover:bg-muted active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={t("queue.itemActionsFor", { title: item.documentTitle })}
          >
            <DotsThree className="w-5 h-5 mx-auto" weight="bold" />
          </button>
        )}
      </div>
    </SwipeableItem>
  );
}
