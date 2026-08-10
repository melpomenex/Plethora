import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowCounterClockwise,
  CalendarHeart,
  CaretDown,
  CaretUp,
  Clock,
  DeviceMobile,
  DotsThree,
  EyeSlash,
  Funnel,
  Graph,
  Info,
  Keyboard,
  Lightning,
  ListBullets,
  Pause,
  Play,
  Rss,
  Sparkle,
  Target,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import { DynamicVirtualList } from "../common/VirtualList";
import { useQueueStore } from "../../stores/queueStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useRssStudyStore } from "../../stores/rssStudyStore";
import { useTASStore } from "../../stores/tasStore";
import { RssTab } from "../tabs/TabRegistry";
import type { QueueItem } from "../../types/queue";
import { ItemDetailsPopover, type ItemDetailsTarget } from "../common/ItemDetailsPopover";
import {
  PriorityPreset,
  buildSessionBlocks,
  applyFilters,
  formatMinutesRange,
  getFsrsMetrics,
  getFsrsSchedulingInfo,
  getPriorityScore,
  getPriorityVector,
  getQueueStatus,
  getReadingImpact,
  getStatusLabel,
  getTimeEstimateRange,
  orderQueueItems,
  splitPriorityTargets,
  type SessionCustomizationOptions,
  type SessionItemTypes,
} from "../../utils/reviewUx";
import {
  SessionCustomizeModal,
  DEFAULT_CUSTOMIZATION,
  type SessionCustomization,
} from "./SessionCustomizeModal";
import { SemanticGraphPanel } from "./SemanticGraphPanel";
import { tourAnchor } from "../onboarding/tour/anchors";
import type { EmbeddingConfig } from "../../utils/semanticEngine";
import { TASQueueBadge } from "../tas";
import { TASQueueIndicator } from "../tas";
import { postponeItem } from "../../api/queue";
import { dismissDocument } from "../../api/documents";
import { useToast } from "../common/Toast";
import { EmptyState } from "../common/EmptyState";
import { getShortcutCombo, eventMatchesCombo } from "../common/KeyboardShortcuts";
import { usePriorityPopup } from "../documents/usePriorityPopup";
import { getQueuePrimaryAction, getQueuePrimaryActionLabelKey } from "./queueActions";
import { QueueItemActionSheet } from "../queue/QueueItemActionSheet";
import { getSessionStats, clearQueueSession } from "../../lib/queueSession";
import { useI18n } from "../../lib/i18n";
import { ScheduleView } from "../schedule/ScheduleView";
import { useIsActiveTab } from "../common/Tabs";
import { useStartupStore } from "../../stores/startupStore";
import { useCollectionStore } from "../../stores/collectionStore";

type QueueMode = "reading" | "review" | "schedule";

interface ReviewQueueViewProps {
  onStartReview?: (itemId?: string, queueItemIds?: string[]) => void;
  onOpenDocument?: (item: QueueItem) => void;
  onOpenScrollMode?: (options?: {
    items?: QueueItem[];
    mode?: "queue-list" | "optimal";
    itemTypes?: SessionItemTypes;
  }) => void;
}

const PRESET_DESC_KEYS: Record<PriorityPreset, string> = {
  "maximize-retention": "queuePreset.maximizeRetentionDesc",
  "minimize-time": "queuePreset.minimizeTimeDesc",
  "aggressive-catchup": "queuePreset.aggressiveCatchUpDesc",
  exploratory: "queuePreset.exploratoryDesc",
  "project-focused": "queuePreset.projectFocusedDesc",
};

type ScrollAnchor = { id: string; offset: number; scrollTop: number };
let persistentQueueScrollAnchor: ScrollAnchor | null = null;

export function ReviewQueueView({ onStartReview, onOpenDocument, onOpenScrollMode }: ReviewQueueViewProps) {
  const { locale, t } = useI18n();
  const isActiveTab = useIsActiveTab();
  const ensureStartup = useStartupStore((state) => state.ensureStartup);
  const activeCollectionId = useCollectionStore((state) => state.activeCollectionId);

  // NOTE: a previous "reconcile-on-focus" effect auto-reloaded the queue via
  // reconcileIfDirty() whenever this tab regained focus (isActiveTab true). It
  // fired whenever hasLocalDeltas was armed by ANY local mutation (postpone /
  // suspend / delete, even a single item), and the resulting server refetch
  // recomputed the engagement/priority sort — reshuffling the whole list every
  // time the user returned to the queue. That effect has been removed so the
  // displayed order stays stable across tab switches. Local deltas already
  // update `items` optimistically (applyItemDelta / removeItemsLocally), so the
  // list is current without a reload. For a genuine server refresh, the
  // Toolbar's refresh button still calls the load functions directly.
  const {

    items,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    loadQueue,
    loadStats,
    setSelected,
    setSelectionFromClick,
    selectAll,
    clearSelection,
    bulkSuspend,
    bulkUnsuspend,
    bulkDelete,
    postponeItemSmart,
    bulkOperationLoading,
    bulkOperationResult,
    clearBulkResult,
    queueFilterMode,
    setQueueFilterMode,
    loadDueDocumentsOnly,
    loadDueQueueItems,
  } = useQueueStore(
    useShallow((state) => ({
      items: state.items,
      isLoading: state.isLoading,
      error: state.error,
      searchQuery: state.searchQuery,
      setSearchQuery: state.setSearchQuery,
      loadQueue: state.loadQueue,
      loadStats: state.loadStats,
      setSelected: state.setSelected,
      setSelectionFromClick: state.setSelectionFromClick,
      selectAll: state.selectAll,
      clearSelection: state.clearSelection,
      bulkSuspend: state.bulkSuspend,
      bulkUnsuspend: state.bulkUnsuspend,
      bulkDelete: state.bulkDelete,
      postponeItemSmart: state.postponeItemSmart,
      bulkOperationLoading: state.bulkOperationLoading,
      bulkOperationResult: state.bulkOperationResult,
      clearBulkResult: state.clearBulkResult,
      queueFilterMode: state.queueFilterMode,
      setQueueFilterMode: state.setQueueFilterMode,
      loadDueDocumentsOnly: state.loadDueDocumentsOnly,
      loadDueQueueItems: state.loadDueQueueItems,
    }))
  );
  // Subscribe to selectedIds separately to avoid creating new Set reference in selector
  const selectedIds = useQueueStore((state) => state.selectedIds);
  const customSubset = useQueueStore((state) => state.customSubset);
  const setCustomSubset = useQueueStore((state) => state.setCustomSubset);
  const priorityPopup = usePriorityPopup();
  const [queueMode, setQueueMode] = useState<QueueMode>("reading");
  const [preset, setPreset] = useState<PriorityPreset>(
    useSettingsStore.getState().settings.smartQueue.queueStrategyPreset as PriorityPreset
  );
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);
  const itemTypesCustomized = useSettingsStore(
    (s) => s.settings.smartQueue.sessionItemTypesCustomized ?? false
  );
  const handleSetPreset = (value: PriorityPreset) => {
    setPreset(value);
    updateSettingsCategory("smartQueue", { queueStrategyPreset: value });
  };
  const [queueSortMode, setQueueSortMode] = useState<"priority" | "overdue-desc">("priority");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInspectorOpen, setInspectorOpen] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [isCustomizeModalOpen, setCustomizeModalOpen] = useState(false);
  const [isSemanticGraphOpen, setSemanticGraphOpen] = useState(false);
  const [embeddingConfig, setEmbeddingConfig] = useState<EmbeddingConfig | undefined>(undefined);
  const [sessionCustomization, setSessionCustomization] = useState<SessionCustomization>(() => {
    const localDefault: SessionCustomization = {
      sessionDurationMinutes: 60,
      maxItems: 50,
      blockTimeBudgets: { overdue: 10, maintenance: 15, explore: 20, empty: 15 },
      filters: { tags: [], categories: [], priorityRange: { min: 0, max: 100 }, excludeSuspended: true },
      itemTypes: { documents: true, extracts: true, learningItems: true },
      semanticStudy: { enabled: false, relatednessThreshold: 30, focalTopic: "" }
    };
    
    const baseDefault = (typeof DEFAULT_CUSTOMIZATION !== "undefined" && DEFAULT_CUSTOMIZATION) ? DEFAULT_CUSTOMIZATION : localDefault;
    const finalDefault: SessionCustomization = {
      ...localDefault,
      ...baseDefault,
      blockTimeBudgets: { ...localDefault.blockTimeBudgets, ...baseDefault?.blockTimeBudgets },
      filters: { ...localDefault.filters, ...baseDefault?.filters },
      itemTypes: { ...localDefault.itemTypes, ...baseDefault?.itemTypes },
      semanticStudy: { ...localDefault.semanticStudy, ...baseDefault?.semanticStudy }
    };

    const saved = useSettingsStore.getState().settings.smartQueue.sessionItemTypes;
    if (saved) {
      return {
        ...finalDefault,
        itemTypes: {
          documents: saved.documents ?? finalDefault.itemTypes.documents,
          extracts: saved.extracts ?? finalDefault.itemTypes.extracts,
          learningItems: saved.learningItems ?? finalDefault.itemTypes.learningItems,
        },
      };
    }
    return finalDefault;
  });
  const [selectedFileType, setSelectedFileType] = useState<string>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ id: string; offset: number; scrollTop?: number } | null>(null);
  const selectedIndexRef = useRef(0);
  const toast = useToast();

  // Context menu state
  const [ctxItem, setCtxItem] = useState<QueueItem | null>(null);
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const [actionItem, setActionItem] = useState<QueueItem | null>(null);
  const actionTriggerRef = useRef<HTMLElement | null>(null);

  const captureQueueScrollAnchor = useCallback(() => {
    const container = queueScrollRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const firstVisible = Array.from(
      container.querySelectorAll<HTMLElement>("[data-queue-item-id]"),
    ).find((row) => row.getBoundingClientRect().bottom > containerTop + 1);
    const anchor: ScrollAnchor = {
      id: firstVisible?.dataset.queueItemId ?? "",
      offset: firstVisible ? firstVisible.getBoundingClientRect().top - containerTop : 0,
      scrollTop: container.scrollTop,
    };
    scrollAnchorRef.current = anchor;
    persistentQueueScrollAnchor = anchor;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { invokeCommand } = await import("../../lib/tauri");
        const config = await invokeCommand<EmbeddingConfig | null>("get_embedding_config");
        setEmbeddingConfig(config ?? undefined);
      } catch { /* non-critical */ }
    })();
  }, []);

  // Close context menu on outside click (using contains check to avoid race with menu clicks)
  useEffect(() => {
    if (!ctxPos) return;
    const handler = (e: MouseEvent) => {
      if (ctxMenuRef.current && ctxMenuRef.current.contains(e.target as Node)) return;
      setCtxPos(null);
      setCtxItem(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxPos]);

  // Session stats for smart queue
  const [sessionStats, setSessionStats] = useState(() => getSessionStats());
  // Badge stays dismissed until more items are viewed
  const [sessionBadgeDismissedAt, setSessionBadgeDismissedAt] = useState<number | null>(null);

  const handleClearSession = () => {
    clearQueueSession();
    setSessionStats(getSessionStats());
    // Reload queue to show all items again
    loadQueue();
    toast.success(t("queue.sessionCleared"), t("queue.allItemsAvailableAgain"));
  };

  // Debug: Check if scroll mode is available
  useEffect(() => {
  }, [queueMode, onOpenScrollMode]);

  // `ensureStartup`'s snapshot caps the queue at 50 items (a bounded preview
  // for a fast first paint — see startup.rs DEFAULT_QUEUE_LIMIT). Reusing it
  // after the real, unbounded queue has already loaded would silently
  // truncate it back down to 50, which the user sees as the queue
  // reordering/shrinking out from under them. The "has this view completed
  // its first load" and "what query is currently loaded" state lives in the
  // QUEUE STORE now — not in component refs — because a closed-and-reopened
  // Queue tab resets refs (unmount), which re-ran the first-load path and
  // re-applied the bounded snapshot over an already-loaded queue.
  //
  // This effect's dependencies include `isActiveTab` so a Queue tab that
  // mounts in the background still loads once it becomes active. But that
  // means simply switching away (e.g. into Scroll Mode or an Optimal
  // Session) and back flips `isActiveTab` and re-runs this effect even
  // though nothing about the query changed — refetching would visibly
  // reload and re-sort an already-correct list for no reason. Skip the
  // reload unless the actual query parameters changed since the last run
  // (compared against the store's `loadedQueryKey`, which survives unmount).

  useEffect(() => {
    if (!isActiveTab) return;

    const loadKey = JSON.stringify([
      queueFilterMode,
      activeCollectionId,
      sessionCustomization.semanticStudy?.enabled,
      sessionCustomization.semanticStudy?.focalTopic,
    ]);
    const storeState = useQueueStore.getState();
    if (storeState.loadedQueryKey === loadKey) return;
    // Record the key up-front so a rapid re-entry (e.g. isActiveTab toggling)
    // doesn't double-fire the load; each loader path below is also dedupeLoad-
    // coalesced. The key is only "claimed" when a load actually runs.
    storeState.setLoadedQueryKey(loadKey);

    const isFirstLoad = !storeState.hasCompletedFirstLoad;
    if (isFirstLoad) storeState.setHasCompletedFirstLoad(true);

    if (
      isFirstLoad &&
      queueFilterMode === "due-all" &&
      !sessionCustomization.semanticStudy?.enabled
    ) {
      void ensureStartup("queue").finally(() => {
        if (isActiveTab) {
          void loadStats();
          if (useQueueStore.getState().items.length <= 50) {
            void loadDueQueueItems();
          }
        }
      });
      return;
    }
    // If a semantic study focus is active, load the entire database/collection
    // so we can query all matching items in the library.
    if (sessionCustomization.semanticStudy?.enabled && sessionCustomization.semanticStudy?.focalTopic) {
      loadQueue(true);
      loadStats();
      return;
    }

    // Reading & Review queue: load based on current filter mode
    switch (queueFilterMode) {
      case "due-today":
        loadDueDocumentsOnly();
        break;
      case "due-all":
        loadDueQueueItems();
        break;
      case "all-items":
      case "new-only":
      default:
        loadQueue();
        break;
    }
    loadStats();
  }, [
    queueFilterMode,
    isActiveTab,
    ensureStartup,
    activeCollectionId,
    sessionCustomization.semanticStudy?.enabled,
    sessionCustomization.semanticStudy?.focalTopic,
    loadQueue,
    loadStats,
    loadDueDocumentsOnly,
    loadDueQueueItems,
  ]);

  // --- TAS (Tag-Aware Scheduling) integration ---
  // Build the TAS-annotated queue on mount and when toggled on
  const tasBuildQueue = useTASStore((s) => s.buildQueue);
  const tasConfig = useTASStore((s) => s.config);

  useEffect(() => {
    if (tasConfig.enabled) {
      const today = new Date().toISOString().split("T")[0];
      tasBuildQueue(today);
    } else {
      useTASStore.getState().resetQueue();
    }
  }, [tasConfig.enabled, tasBuildQueue]);

  function getLearningHint(item: QueueItem) {
    if (item.itemType !== "learning-item") return null;
    // `learningHint` is only populated when a caller opts into the slim
    // listing (get_queue slim=true), which the store load does NOT do — so
    // this short-circuit is inert today and the raw-content path below runs.
    // It stays wired for a future dedicated slim listing.
    if (item.learningHint) return item.learningHint;
    const raw = item.clozeText || item.question || "";
    if (!raw) return null;
    const noCloze = raw.replace(/\[\[c\d+::(.*?)\]\]/g, "$1");
    const withoutHtml = noCloze.replace(/<[^>]*>/g, " ");
    const trimmed = withoutHtml.replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    const maxLength = 80;
    return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
  }

  const availableFileTypes = useMemo(() => {
    const types = new Set(items.map((item) => item.documentFileType).filter(Boolean));
    return Array.from(types).sort();
  }, [items]);

  /**
   * Which item types the reading queue shows.
   *
   * The Customize Queue toggles are authoritative once the user has actually
   * changed them. Due All used to bypass them entirely ("Due All promises every
   * due item type"), so unchecking Learning Items there did nothing at all —
   * and Due All is the default filter, which made the toggles look inert.
   *
   * Until the user changes them, each filter keeps its own default: Due All
   * shows every due type, the narrower reading filters are documents-first.
   * A single stored `sessionItemTypes` object cannot carry both defaults, which
   * is why the "has the user customized this" flag exists.
   */
  const effectiveItemTypes = useMemo(() => {
    if (!itemTypesCustomized && queueFilterMode === "due-all") {
      return { documents: true, extracts: true, learningItems: true };
    }
    return sessionCustomization.itemTypes;
  }, [itemTypesCustomized, queueFilterMode, sessionCustomization.itemTypes]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    
    // If a custom semantic cluster subset is active, use it as the base queue
    let queueItems = customSubset
      ? customSubset
      : items.filter((item) => {
          if (queueMode === "review") {
            return item.itemType === "learning-item";
          }
          // Types the toggles do not cover (RSS articles) always pass, matching
          // applyFilters' own itemTypes branch — a `return false` here would
          // strip them from Due All, which never filtered them before.
          if (item.itemType === "document") return effectiveItemTypes.documents;
          if (item.itemType === "extract") return effectiveItemTypes.extracts;
          if (item.itemType === "learning-item") return effectiveItemTypes.learningItems;
          return true;
        });
    
    // Apply file type filter
    if (selectedFileType !== "all") {
      queueItems = queueItems.filter((item) => item.documentFileType === selectedFileType);
    }
    
    const searchedItems = normalizedQuery
      ? queueItems.filter((item) => {
        const hint = getLearningHint(item) ?? "";
        const haystack = [item.documentTitle, item.category, hint, ...(item.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      : queueItems;

    const customizationOptions: SessionCustomizationOptions = {
      maxItems: sessionCustomization.maxItems,
      filters: sessionCustomization.filters,
      // In review mode the queue is already restricted to learning items
      // above, so passing `learningItems: false` (its default) here would
      // strip every card and leave the Review Queue empty. Omit it so the
      // other filters (tags/categories/priority/excludeSuspended) still apply.
      // Every other mode applies itemTypes as a hard post-filter, so disabling
      // a type is an absolute exclusion. (This is what the comment above the
      // old `|| queueFilterMode === "due-all"` claimed it already did.)
      itemTypes: queueMode === "review" ? undefined : effectiveItemTypes,
      priorityPreset: preset,
      semanticStudy: sessionCustomization.semanticStudy,
    };
    const filtered = applyFilters(searchedItems, customizationOptions);
    const ordered = orderQueueItems(filtered, preset);
    if (queueSortMode === "overdue-desc") {
      return [...ordered].sort((a, b) => {
        const now = Date.now();
        const overdueA = a.dueDate ? Math.max(0, (now - new Date(a.dueDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const overdueB = b.dueDate ? Math.max(0, (now - new Date(b.dueDate).getTime()) / (1000 * 60 * 60 * 24)) : 0;
        return overdueB - overdueA;
      });
    }
    return ordered;
  }, [items, queueMode, queueFilterMode, preset, searchQuery, selectedFileType, sessionCustomization, effectiveItemTypes, customSubset, queueSortMode]);

  useEffect(() => {
    const container = queueScrollRef.current;
    if (!container) return;
    const handleScroll = () => {
      if (container.scrollTop > 0) {
        captureQueueScrollAnchor();
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      captureQueueScrollAnchor();
    };
  }, [captureQueueScrollAnchor]);

  useEffect(() => {
    if (isLoading) return;
    const anchor = scrollAnchorRef.current ?? persistentQueueScrollAnchor;
    if (!anchor) return;

    const frame = requestAnimationFrame(() => {
      const container = queueScrollRef.current;
      if (!container) return;
      if (anchor.id) {
        const row = Array.from(
          container.querySelectorAll<HTMLElement>("[data-queue-item-id]"),
        ).find((candidate) => candidate.dataset.queueItemId === anchor.id);
        if (row) {
          const containerTop = container.getBoundingClientRect().top;
          container.scrollTop += row.getBoundingClientRect().top - containerTop - anchor.offset;
        } else if (anchor.scrollTop > 0) {
          container.scrollTop = anchor.scrollTop;
        }
      } else if (anchor.scrollTop > 0) {
        container.scrollTop = anchor.scrollTop;
      }
      scrollAnchorRef.current = null;
      persistentQueueScrollAnchor = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleItems, isLoading]);

  // Every visible row is selectable, not just learning items: the bulk actions
  // resolve documents and extracts too, and select-all now covers them, so a
  // narrower list here would select rows the user has no checkbox to clear.
  const selectableItems = visibleItems;
  const selectableIds = useMemo(() => selectableItems.map((item) => item.id), [selectableItems]);

  const allSelected = selectableItems.length > 0 && selectableItems.every((item) => selectedIds.has(item.id));

  const sessionBlocks = useMemo(() => {
    const options: SessionCustomizationOptions = {
      maxItems: sessionCustomization.maxItems,
      blockTimeBudgets: sessionCustomization.blockTimeBudgets,
    };
    return buildSessionBlocks(visibleItems, options);
  }, [visibleItems, sessionCustomization.maxItems, sessionCustomization.blockTimeBudgets]);
  const selectedItem = useMemo(
    () => visibleItems.find((item) => item.id === selectedId) ?? null,
    [visibleItems, selectedId]
  );
  const selectedBrowseIndex = useMemo(
    () => visibleItems.findIndex((item) => item.id === selectedId),
    [visibleItems, selectedId]
  );

  const getDaysUntilDue = (item: QueueItem) => {
    if (!item.dueDate) return 0;
    const due = new Date(item.dueDate);
    if (Number.isNaN(due.getTime())) return 0;
    const now = Date.now();
    return Math.round((due.getTime() - now) / (1000 * 60 * 60 * 24));
  };

  const refreshQueue = async () => {
    captureQueueScrollAnchor();
    if (sessionCustomization.semanticStudy?.enabled && sessionCustomization.semanticStudy?.focalTopic) {
      await loadQueue(true);
    } else if (queueMode === "review") {
      await loadDueQueueItems();
    } else {
      switch (queueFilterMode) {
        case "due-today":
          await loadDueDocumentsOnly();
          break;
        case "due-all":
          await loadDueQueueItems();
          break;
        case "all-items":
        case "new-only":
        default:
          await loadQueue();
          break;
      }
    }
    await loadStats();
  };

  const applyScheduleShift = async (label: string, deltaDays: number) => {
    if (!selectedItem) return;
    if (selectedItem.itemType !== "learning-item") {
      toast.info(label, t("queue.learningItemsOnly"));
      return;
    }
    try {
      await postponeItem(selectedItem.id, deltaDays);
      toast.success(label, t("queue.reviewScheduleUpdated"));
      await refreshQueue();
    } catch (error) {
      toast.error(label, error instanceof Error ? error.message : t("queue.failedToUpdateSchedule"));
    }
  };

  const handleCompressIntervals = async () => {
    if (!selectedItem) return;
    const daysUntil = Math.abs(getDaysUntilDue(selectedItem));
    const deltaDays = -Math.max(1, Math.round(daysUntil * 0.5));
    await applyScheduleShift(t("queue.compressIntervals"), deltaDays);
  };

  const handleRescheduleIntelligently = async () => {
    if (!selectedItem) return;
    const deltaDays = -getDaysUntilDue(selectedItem);
    await applyScheduleShift(t("queue.rescheduleIntelligently"), deltaDays);
  };

  const handleDowngradeFrequency = async () => {
    if (!selectedItem) return;
    const daysUntil = Math.max(1, getDaysUntilDue(selectedItem));
    const deltaDays = Math.max(1, Math.round(daysUntil * 0.5));
    await applyScheduleShift(t("queue.downgradeFrequency"), deltaDays);
  };

  // Context menu action handlers
  const handleCtxStudyNow = (item: QueueItem) => {
    setCtxPos(null);
    setCtxItem(null);
    if (item.itemType === "learning-item") {
      onStartReview?.(item.learningItemId ?? item.id);
    } else {
      onOpenDocument?.(item);
    }
  };

  const openItemActions = (item: QueueItem, target: HTMLElement) => {
    actionTriggerRef.current = target;
    setSelectedId(item.id);
    setActionItem(item);
  };

  const closeItemActions = () => {
    setActionItem(null);
    requestAnimationFrame(() => actionTriggerRef.current?.focus());
  };

  const handleCtxSuspend = async (item: QueueItem) => {
    setCtxPos(null);
    setCtxItem(null);
    if (item.itemType !== "learning-item") return;
    try {
      const { bulkSuspendItems } = await import("../../api/queue");
      const result = await bulkSuspendItems([item.id]);
      if (result.failed.length === 0) {
        toast.success(t("queue.suspended"), t("queue.scheduleUpdated"), {
          action: {
            label: t("queue.undo"),
            onClick: async () => {
              try {
                const { bulkUnsuspendItems } = await import("../../api/queue");
                await bulkUnsuspendItems([item.id]);
                await refreshQueue();
                toast.success(t("queue.restored"), t("queue.scheduleUpdated"));
              } catch (error) {
                toast.error(t("queue.couldNotRestoreItem"), error instanceof Error ? error.message : t("queue.pleaseRefresh"));
              }
            },
          },
        });
      } else {
        toast.error(t("queue.operationFailed"), result.errors.join(", "));
      }
      await refreshQueue();
    } catch (error) {
      toast.error(t("queue.operationFailed"), error instanceof Error ? error.message : "Unknown error");
    }
  };

  const handleCtxPostpone = async (item: QueueItem, days: number) => {
    setCtxPos(null);
    setCtxItem(null);
    try {
      await postponeItem(item.id, days);
      toast.success(t("queue.postponed"), t("queue.reviewScheduleUpdated", { days }), {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await postponeItem(item.id, -days);
              await refreshQueue();
              toast.success("Restored", t("queue.scheduleUpdated"));
            } catch (error) {
              toast.error("Could not restore item", error instanceof Error ? error.message : "Please refresh and try again.");
            }
          },
        },
      });
      await refreshQueue();
    } catch (error) {
      toast.error(t("queue.operationFailed"), error instanceof Error ? error.message : "Unknown error");
    }
  };

  const handleCtxDelete = async (item: QueueItem) => {
    setCtxPos(null);
    setCtxItem(null);
    if (item.itemType !== "learning-item") return;
    try {
      const { bulkDeleteItems } = await import("../../api/queue");
      const result = await bulkDeleteItems([item.id]);
      if (result.failed.length === 0) {
        toast.success(t("queue.deleted"), t("queue.itemRemoved"));
      } else {
        toast.error(t("queue.operationFailed"), result.errors.join(", "));
      }
      await refreshQueue();
    } catch (error) {
      toast.error(t("queue.operationFailed"), error instanceof Error ? error.message : t("queue.unknownError"));
    }
  };

  const handleDismissDocument = async (item: QueueItem) => {
    if (item.itemType !== "document") {
      toast.info(t("queueScroll.dismissNotAvailable"), t("queueScroll.onlyDocuments"));
      return;
    }

    try {
      await dismissDocument(item.documentId, true);
      toast.success(t("queueScroll.documentDismissed"), t("queueScroll.documentDismissedDesc"), {
        action: {
          label: t("queue.undo"),
          onClick: async () => {
            try {
              await dismissDocument(item.documentId, false);
              await refreshQueue();
              toast.success(t("queue.restored"), t("queue.scheduleUpdated"));
            } catch (error) {
              toast.error(t("queue.couldNotRestoreDocument"), error instanceof Error ? error.message : t("queue.pleaseRefresh"));
            }
          },
        },
      });
      await refreshQueue();
    } catch (error) {
      console.error("Failed to dismiss document:", error);
      toast.error(
        t("queueScroll.dismissFailed"),
        error instanceof Error ? error.message : t("queueScroll.pleaseTryAgain")
      );
    }
  };

  const handleActionPostpone = async (item: QueueItem) => {
    if (!postponeItemSmart) return;
    try {
      const result = await postponeItemSmart(item);
      toast.success(
        t("queue.postponed"),
        t("queue.reviewScheduleUpdated", { days: result.increase }),
      );
      await refreshQueue();
    } catch (error) {
      toast.error(
        t("queue.operationFailed"),
        error instanceof Error ? error.message : t("queue.pleaseRefresh"),
      );
    }
  };

  const handleActionRemove = async (item: QueueItem) => {
    if (item.itemType === "learning-item") {
      await handleCtxSuspend(item);
    } else if (item.itemType === "document") {
      await handleDismissDocument(item);
    }
  };

  const handleActionSelect = (item: QueueItem) => {
    setSelected(item.id, true);
    toast.info(t("queue.selectedCount", { count: 1 }), item.documentTitle);
  };

  useEffect(() => {
    if (selectedBrowseIndex >= 0) {
      selectedIndexRef.current = selectedBrowseIndex;
    }
  }, [selectedBrowseIndex]);

  useEffect(() => {
    if (visibleItems.length === 0) {
      selectedIndexRef.current = 0;
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }

    if (!selectedId) {
      const initialIndex = Math.min(selectedIndexRef.current, visibleItems.length - 1);
      setSelectedId(visibleItems[Math.max(0, initialIndex)].id);
      return;
    }

    const currentIndex = visibleItems.findIndex((item) => item.id === selectedId);
    if (currentIndex === -1) {
      const fallbackIndex = Math.min(selectedIndexRef.current, visibleItems.length - 1);
      setSelectedId(visibleItems[Math.max(0, fallbackIndex)].id);
    }
  }, [selectedId, visibleItems]);

  useEffect(() => {
    const handleStartReviewShortcut = () => {
      const selectedLearningId =
        selectedItem?.itemType === "learning-item"
          ? (selectedItem.learningItemId ?? selectedItem.id)
          : undefined;
      onStartReview?.(selectedLearningId);
    };

    window.addEventListener("start-review-session", handleStartReviewShortcut as EventListener);
    return () =>
      window.removeEventListener("start-review-session", handleStartReviewShortcut as EventListener);
  }, [onStartReview, selectedItem?.id, selectedItem?.learningItemId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Escape is checked before the text-field bail: clearing a selection must
      // work from the search box too, and Escape does nothing else in a field
      // here. Every other shortcut below stays field-safe.
      if (event.key === "Escape" && !event.isComposing) {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        if (selectedIds.size > 0) {
          event.preventDefault();
          clearSelection();
          return;
        }
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (allSelected) {
          clearSelection();
        } else {
          selectAll();
        }
        return;
      }
      if (event.key === "Delete" && selectedIds.size > 0) {
        event.preventDefault();
        void bulkDelete();
        return;
      }
      const priorityCombo = getShortcutCombo("doc.priority");
      if (priorityCombo && eventMatchesCombo(event, priorityCombo)) {
        event.preventDefault();
        const targetItems =
          selectedIds.size > 0
            ? visibleItems.filter((item) => selectedIds.has(item.id))
            : selectedItem
              ? [selectedItem]
              : [];
        if (targetItems.length === 0) return;
        const { documentIds, learningItemIds } = splitPriorityTargets(targetItems);
        const docs = documentIds.map((id) => {
          const item = targetItems.find((candidate) => candidate.documentId === id);
          return {
            id,
            prioritySlider: item?.prioritySlider,
            priorityRating: item?.priorityRating,
          };
        });
        void priorityPopup
          .open(documentIds, docs, { learningItemIds })
          .then(({ committed }) => {
            if (committed) void refreshQueue();
          });
        return;
      }
      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        setInspectorOpen((prev) => !prev);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    selectedIds.size,
    allSelected,
    clearSelection,
    selectAll,
    bulkDelete,
    visibleItems,
    selectedItem,
    priorityPopup,
    refreshQueue,
  ]);

  /**
   * Delegates to the store so this surface and the queue route share one set of
   * selection semantics. Shift extends from the anchor; anything else toggles
   * the single row, which is what both entry points here want — the checkbox
   * and a modifier-held row click are additive by nature, never "replace".
   */
  const handleLearningItemSelection = (itemId: string, _checked: boolean, shiftKey: boolean) => {
    setSelectionFromClick(itemId, selectableIds, { shift: shiftKey, meta: !shiftKey });
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleStartOptimalSession = () => {
    captureQueueScrollAnchor();
    if (queueMode === "review") {
      const seen = new Set<string>();
      const reviewQueueIds = sessionBlocks
        .flatMap((block) => block.items)
        .filter((item) => item.itemType === "learning-item")
        .map((item) => item.learningItemId ?? item.id)
        .filter((itemId) => {
          if (seen.has(itemId)) return false;
          seen.add(itemId);
          return true;
        });
      if (reviewQueueIds.length > 0) {
        onStartReview?.(reviewQueueIds[0], reviewQueueIds);
      }
      return;
    }

    if (onOpenScrollMode) {
      onOpenScrollMode({ mode: "optimal", itemTypes: effectiveItemTypes });
      return;
    }
    onStartReview?.();
  };

  const handleToggleSelectAll = () => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll();
    }
  };

  const handleBulkSuspend = async () => {
    await bulkSuspend();
  };

  const handleBulkUnsuspend = async () => {
    await bulkUnsuspend();
  };

  const handleBulkDelete = async () => {
    await bulkDelete();
  };

  const buildDetailsTarget = (item: QueueItem): ItemDetailsTarget => {
    if (item.itemType === "learning-item") {
      return {
        type: "learning-item",
        id: item.learningItemId ?? item.id,
        title: item.documentTitle,
        tags: item.tags,
        category: item.category,
      };
    }
    if (item.itemType === "extract") {
      return {
        type: "extract",
        id: item.extractId ?? item.id,
        title: item.documentTitle,
        tags: item.tags,
        category: item.category,
      };
    }
    return {
      type: "document",
      id: item.documentId,
      title: item.documentTitle,
      tags: item.tags,
      category: item.category,
    };
  };

  return (
    <div className="h-full flex flex-col bg-cream pb-20 md:pb-0">
      <div {...tourAnchor("queueControls")} className="border-b border-border bg-card p-3 md:p-4">
        <div className="flex flex-col md:flex-row md:flex-wrap items-start md:items-center justify-between gap-3">
          <div className="w-full md:w-auto">
            <h1 className="text-xl md:text-2xl font-semibold text-foreground">
              {queueMode === "reading" ? t("nav.queue") : queueMode === "schedule" ? t("schedule.title") : t("review.title")}
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground hidden md:block">
              {queueMode === "reading"
                ? t("queue.readingSubtitle")
                : queueMode === "schedule"
                  ? ""
                  : t("queue.reviewSubtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <button
              onClick={handleStartOptimalSession}
              {...tourAnchor("queueStartSession")}
              className="flex-1 md:flex-none px-3 md:px-4 py-2 md:py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 flex items-center justify-center gap-2 min-h-[44px] text-sm md:text-base"
            >
              <Play className="w-4 h-4" />
              <span className="hidden sm:inline">{t("queue.startOptimalSession")}</span>
              <span className="sm:hidden">{t("common.start")}</span>
            </button>
            {queueMode === "reading" && onOpenScrollMode && (
              <button
                onClick={() => {
                  captureQueueScrollAnchor();
                  onOpenScrollMode({ items: visibleItems, mode: "queue-list", itemTypes: effectiveItemTypes });
                }}
                className="flex-1 md:flex-none px-3 md:px-4 py-1 md:py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-md hover:opacity-90 flex flex-col items-center justify-center min-h-[44px] shadow-sm transition-all"
                title={t("queue.scrollModeTooltip")}
              >
                <div className="flex items-center gap-1.5 font-medium text-xs md:text-sm">
                  <DeviceMobile className="w-4 h-4" />
                  <span>{t("queue.scrollMode")}</span>
                </div>
                <span className="text-[10px] opacity-90 font-normal -mt-0.5">{t("queue.scrollModeSubtext")}</span>
              </button>
            )}
            <button
              onClick={() => setCustomizeModalOpen(true)}
              className="px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80"
            >
              {t("queue.customizeSession")}
            </button>
            <button
              onClick={() => setSemanticGraphOpen(true)}
              className="px-4 py-2 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-md hover:from-blue-500/20 hover:to-indigo-500/20 transition-all flex items-center gap-1.5 font-medium shadow-sm"
              title={t("queue.semanticGraphTooltip")}
            >
              <Graph className="w-4 h-4" />
              <span>{t("queue.semanticGraph")}</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-muted/60 rounded-md p-1">
            <button
              onClick={() => setQueueMode("reading")}
              className={`px-3 py-1 text-sm rounded ${queueMode === "reading" ? "bg-background shadow text-foreground" : "text-muted-foreground"
                }`}
            >
              {t("dashboard.readingQueue")}
            </button>
            <button
              onClick={() => setQueueMode("schedule")}
              className={`px-3 py-1 text-sm rounded ${queueMode === "schedule" ? "bg-background shadow text-foreground" : "text-muted-foreground"
                }`}
            >
              {t("schedule.title")}
            </button>
            <button
              onClick={() => setQueueMode("review")}
              className={`px-3 py-1 text-sm rounded ${queueMode === "review" ? "bg-background shadow text-foreground" : "text-muted-foreground"
                }`}
            >
              {t("review.queue")}
            </button>
          </div>
          <div className="flex-1 min-w-[220px] relative">
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("queue.searchPlaceholder")}
              className="w-full pl-4 pr-10 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Funnel className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
          {queueMode === "reading" && (
            <div className="flex items-center gap-1 bg-muted/60 rounded-md p-1">
              <button
                onClick={() => setQueueFilterMode("due-today")}
                className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 ${queueFilterMode === "due-today" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title={t("queue.filterDueTodayDesc")}
              >
                <Clock className="w-3 h-3" />
                {t("queue.filterDueToday")}
              </button>
              <button
                onClick={() => setQueueFilterMode("all-items")}
                className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 ${queueFilterMode === "all-items" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title={t("queue.filterAllItemsDesc")}
              >
                <ListBullets className="w-3 h-3" />
                {t("queue.filterAllItems")}
              </button>
              <button
                onClick={() => setQueueFilterMode("new-only")}
                className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 ${queueFilterMode === "new-only" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title={t("queue.filterNewOnlyDesc")}
              >
                <Sparkle className="w-3 h-3" />
                {t("queue.filterNewOnly")}
              </button>
              <button
                onClick={() => setQueueFilterMode("due-all")}
                className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 ${queueFilterMode === "due-all" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                title={t("queue.filterDueAllDesc")}
              >
                <Target className="w-3 h-3" />
                {t("queue.filterDueAll")}
              </button>
            </div>
          )}
          {queueMode === "reading" && (
            <select
              value={queueSortMode}
              onChange={(e) => setQueueSortMode(e.target.value as "priority" | "overdue-desc")}
              className="px-2 py-1 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="priority">Sort: Priority</option>
              <option value="overdue-desc">Sort: Overdue Days</option>
            </select>
          )}

          {/* Session Status - Shows if smart filtering is active */}
          {sessionStats.totalViewed > 0 && queueMode === "reading" && queueFilterMode === "due-today" &&
            sessionStats.totalViewed !== sessionBadgeDismissedAt && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <span className="text-xs text-amber-700">
                {t("queue.viewedThisSession", { count: sessionStats.totalViewed })}
                {sessionStats.unratedCount > 0 && ` (${t("queue.unratedCount", { count: sessionStats.unratedCount })})`}
              </span>
              <button
                onClick={handleClearSession}
                className="p-1 hover:bg-amber-500/20 rounded transition-colors"
                title={t("queue.clearSession")}
              >
                <ArrowCounterClockwise className="w-3 h-3 text-amber-700" />
              </button>
              <button
                onClick={() => setSessionBadgeDismissedAt(sessionStats.totalViewed)}
                className="p-1 hover:bg-amber-500/20 rounded transition-colors"
                title={t("common.dismiss")}
                aria-label={t("common.dismiss")}
              >
                <X className="w-3 h-3 text-amber-700" />
              </button>
            </div>
          )}

          {/* TAS Status Indicator */}
          <TASQueueIndicator />

          {/* File Type Funnel */}
          <div className="flex items-center gap-2">
            <Funnel className="w-4 h-4 text-muted-foreground" />
            <select
              value={selectedFileType}
              onChange={(event) => setSelectedFileType(event.target.value)}
              className="px-3 py-2 bg-background border border-border rounded-md text-sm"
            >
              <option value="all">{t("mediaLibrary.allTypes")}</option>
              {availableFileTypes.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <select
            value={preset}
            onChange={(event) => handleSetPreset(event.target.value as PriorityPreset)}
            className="px-3 py-2 bg-background border border-border rounded-md text-sm"
          >
            <option value="maximize-retention">{t("queuePreset.maximizeRetention")}</option>
            <option value="minimize-time">{t("queuePreset.minimizeTime")}</option>
            <option value="aggressive-catchup">{t("queuePreset.aggressiveCatchUp")}</option>
            <option value="exploratory">{t("queuePreset.exploratoryLearning")}</option>
            <option value="project-focused">{t("queuePreset.projectFocused")}</option>
          </select>
          <p className="text-xs text-muted-foreground max-w-[200px]">
            {t(PRESET_DESC_KEYS[preset])}
          </p>
          <button
            onClick={() => setInspectorOpen((prev) => !prev)}
            className="px-3 py-2 bg-muted text-foreground rounded-md text-sm hover:bg-muted/80"
          >
            {isInspectorOpen ? t("queue.hideInspector") : t("queue.showInspector")}
          </button>
        </div>
      </div>

      {queueMode === "schedule" ? (
        <ScheduleView
          onStartReview={onStartReview}
          onOpenDocument={(docId, title) => onOpenDocument?.({ id: docId, documentId: docId, documentTitle: title, itemType: "document" } as QueueItem)}
        />
      ) : (
      <>
      <div className="min-h-0 flex-1 flex overflow-hidden">
        <div ref={queueScrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 space-y-4">
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">
              {error}
            </div>
          )}

          {bulkOperationResult && (() => {
            // A result where nothing succeeded is an error, not a status line,
            // and the reasons have to be reachable — a bare "0 succeeded,
            // 2 failed" gave no way to tell what went wrong.
            const failedCount = bulkOperationResult.failed.length;
            const allFailed = failedCount > 0 && bulkOperationResult.succeeded.length === 0;
            return (
              <div
                role={failedCount > 0 ? "alert" : undefined}
                className={`p-3 border rounded-lg text-sm flex items-start justify-between gap-3 ${
                  allFailed
                    ? "bg-destructive/10 border-destructive/30 text-foreground"
                    : "bg-muted border-border text-foreground"
                }`}
              >
                <div className="min-w-0">
                  <span>
                    {t("queue.bulkUpdateResult", {
                      succeeded: bulkOperationResult.succeeded.length,
                      failed: failedCount,
                    })}
                  </span>
                  {bulkOperationResult.errors.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {bulkOperationResult.errors.map((error) => (
                        <li key={error} className="break-words">
                          {error}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <button
                  onClick={clearBulkResult}
                  className="px-2 py-1 text-xs bg-background border border-border rounded flex-shrink-0"
                >
                  {t("queue.dismiss")}
                </button>
              </div>
            );
          })()}

          {selectedIds.size > 0 && (
            <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg flex items-center justify-between">
              <span className="text-sm text-primary">
                {t("queue.selectedCount", { count: selectedIds.size })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkSuspend}
                  disabled={bulkOperationLoading}
                  className="px-3 py-1.5 bg-background border border-border rounded text-sm"
                >
                  {t("queue.suspend")}
                </button>
                <button
                  onClick={handleBulkUnsuspend}
                  disabled={bulkOperationLoading}
                  className="px-3 py-1.5 bg-background border border-border rounded text-sm"
                >
                  {t("queue.unsuspend")}
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkOperationLoading}
                  className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded text-sm"
                >
                  {t("queue.delete")}
                </button>
              </div>
            </div>
          )}

          {customSubset && (
            <div className="mb-4 p-4 rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-500/5 to-indigo-500/5 dark:from-blue-500/10 dark:to-indigo-500/10 flex items-center justify-between shadow-sm animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                  <Sparkle className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{t("queue.studyingCluster")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("queue.clusterFiltered", { count: visibleItems.length })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCustomSubset(null)}
                className="px-3 py-1.5 bg-background border border-border hover:bg-muted text-foreground font-semibold rounded-lg text-xs transition-all shadow-sm"
              >
                {t("queue.clearCluster")}
              </button>
            </div>
          )}

          {(isLoading && items.length === 0) ? (
            <div className="text-center py-12 text-muted-foreground">{t("queue.loading")}</div>
          ) : visibleItems.length === 0 ? (
            sessionCustomization.semanticStudy?.enabled && sessionCustomization.semanticStudy?.focalTopic ? (
              <div className="p-8 text-center max-w-md mx-auto my-12 glass-card rounded-2xl border border-blue-500/20 bg-blue-500/5 dark:bg-blue-400/5 animate-scaleIn">
                <Warning className="w-12 h-12 text-blue-500 dark:text-blue-400 mx-auto mb-4" />
                <h3 className="text-base font-semibold text-foreground mb-2">{t("queue.noRelatedItems")}</h3>
                <p className="text-xs text-muted-foreground mb-6">
                  {t("queue.noRelatedItemsDesc", {
                    topic: sessionCustomization.semanticStudy?.focalTopic ?? "",
                    threshold: sessionCustomization.semanticStudy?.relatednessThreshold ?? 0,
                  })}
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => {
                      setSessionCustomization({
                        ...sessionCustomization,
                        semanticStudy: { ...sessionCustomization.semanticStudy, enabled: false }
                      });
                    }}
                    className="px-4 py-2 bg-background border border-border hover:bg-muted text-foreground rounded-xl text-xs font-semibold transition-all shadow-sm"
                  >
                    {t("queue.clearFunnel")}
                  </button>
                  <button
                    onClick={() => {
                      setSessionCustomization({
                        ...sessionCustomization,
                        semanticStudy: { ...sessionCustomization.semanticStudy, relatednessThreshold: 10 }
                      });
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-all shadow-sm shadow-blue-500/10"
                  >
                    {t("queue.decreaseStrictness")}
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                icon="queue"
                title={queueMode === "reading" ? t("queue.emptyReading") : t("queue.emptyReview")}
                description={items.length === 0 ? t("emptyState.queueDesc") : t("queue.noMatchingFilters")}
                action={items.length === 0 ? {
                  label: t("emptyState.goToDocuments"),
                  onClick: () => window.dispatchEvent(new CustomEvent("navigate", { detail: "/documents" })),
                } : {
                  label: t("queue.showAllItems"),
                  onClick: () => setQueueFilterMode("all-items"),
                }}
              />
            )
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {sessionBlocks?.map((block) => (
                  <div key={block.id} className="bg-card border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-sm font-semibold text-foreground">{block.title}</h2>
                      <span className="text-xs text-muted-foreground">
                        {block.timeBudgetMinutes} min
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-3">
                      {t("queue.safeStopAfterItem", { count: block.safeStopCount })}
                    </div>
                    <div className="space-y-2">
                      {block.items?.slice(0, 3).map((item) => (
                        <div key={item.id} className="text-xs text-muted-foreground flex items-center gap-2">
                          <span className="text-foreground">•</span>
                          <span className="line-clamp-1">{item.documentTitle}</span>
                        </div>
                      ))}
                      {(block.items?.length ?? 0) > 3 && (
                        <div className="text-xs text-muted-foreground">
                          {t("queue.moreCount", { count: (block.items?.length ?? 0) - 3 })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>
                  {t("queue.sessionEstimatePerItem", {
                    estimate: visibleItems?.[0] ? formatMinutesRange(getTimeEstimateRange(visibleItems[0])) : t("reviewComplete.notAvailable"),
                  })}
                </span>
              </div>

              <div className="space-y-3" aria-label={t("queue.queueItemsList")}>
                {selectableItems.length > 0 && queueMode === "review" && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={allSelected} onChange={handleToggleSelectAll} />
                      {t("queue.selectAllLearningItems")}
                    </label>
                  </div>
                )}
                {visibleItems?.length > 20 ? (
                  <DynamicVirtualList
                    items={visibleItems}
                    renderItem={(item) => {
                      const isExpanded = expandedIds.has(item.id);
                      const status = getQueueStatus(item);
                      const priorityVector = getPriorityVector(item);
                      const estimateRange = getTimeEstimateRange(item);
                      const learningHint = getLearningHint(item);
                      return (
                        <div
                          key={item.id}
                          data-queue-item-id={item.id}
                          aria-selected={item.id === selectedId}
                          className={`border rounded-lg bg-card transition-colors ${item.id === selectedId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                            }`}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedId(item.id);
                            setCtxItem(item);
                            setCtxPos({ x: e.clientX, y: e.clientY });
                          }}
                        >
                          <div
                            onClick={(event) => {
                              setSelectedId(item.id);
                              const isModifierMulti = event.metaKey || event.ctrlKey;
                              if (event.shiftKey || isModifierMulti) {
                                handleLearningItemSelection(
                                  item.id,
                                  !selectedIds.has(item.id),
                                  event.shiftKey
                                );
                              }
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              if (item.itemType === "learning-item") {
                                onStartReview?.(item.learningItemId ?? item.id);
                                return;
                              }
                              if (item.itemType === "rss-article") {
                                const rssId = item.id.replace("rss-", "");
                                useRssStudyStore.getState().setActiveArticleToView(rssId);
                                useTabsStore.getState().addTab({
                                  title: "RSS",
                                  icon: <Rss className="w-4 h-4" />,
                                  type: "rss",
                                  content: RssTab,
                                  closable: true,
                                });
                                return;
                              }
                              onOpenDocument?.(item);
                            }}
                            className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(item.id)}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  handleLearningItemSelection(
                                    item.id,
                                    !selectedIds.has(item.id),
                                    !!(event.nativeEvent as MouseEvent).shiftKey
                                  );
                                }}
                              />
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.isUpNext ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                                aria-label={t("queue.queuePosition", {
                                  position: item.queuePosition,
                                  total: item.queueTotal,
                                })}
                              >
                                {item.isUpNext
                                  ? `${t("queue.upNext")} · ${t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}`
                                  : t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}
                              </span>
                              <StatusPill status={status} />
                              {item.itemType === "document" && (() => {
                                const fsrsInfo = getFsrsSchedulingInfo(item);
                                const overdueDays = fsrsInfo.isOverdue && fsrsInfo.daysUntilDue != null
                                  ? Math.max(0, Math.abs(fsrsInfo.daysUntilDue))
                                  : 0;
                                return (
                                  <>
                                    <span
                                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                                        fsrsInfo.isOverdue
                                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                          : "bg-blue-500/10 text-blue-600 dark:text-blue-300"
                                      }`}
                                      title={
                                        fsrsInfo.isOverdue && fsrsInfo.nextReviewDate
                                          ? `Outstanding since ${fsrsInfo.nextReviewDate.toLocaleDateString(locale)} (${overdueDays}d overdue)`
                                          : t("queue.nextReviewTitle", {
                                              date: fsrsInfo.nextReviewDate
                                                ? fsrsInfo.nextReviewDate.toLocaleDateString(locale)
                                                : t("queue.notScheduled"),
                                            })
                                      }
                                    >
                                      <Clock className="w-3 h-3 inline mr-1" />
                                      {fsrsInfo.statusLabel}
                                    </span>
                                    {overdueDays > 0 && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-500">
                                        {overdueDays}d overdue
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                              {item.itemType === "rss-article" && (
                                <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                  <Rss className="w-3 h-3 inline mr-1 align-middle" />
                                  RSS
                                </span>
                              )}
                              <TASQueueBadge
                                item={item}
                                onForceShow={(id) => useTASStore.getState().forceShowItem(id)}
                              />
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-foreground line-clamp-1">
                                  {item.documentTitle}
                                  {item.itemType === "learning-item" && learningHint && (
                                    <span className="font-normal text-muted-foreground">
                                      {" "}
                                      — {learningHint}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {formatMinutesRange(estimateRange)} • {t("queue.priorityWithValue", { value: getPriorityScore(item, preset) })}
                                </div>
                                <TimeConfidenceBar min={estimateRange.min} max={estimateRange.max} />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <PriorityGlyph vector={priorityVector} />

                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCtxStudyNow(item);
                                }}
                                className="min-h-9 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                {t(getQueuePrimaryActionLabelKey(getQueuePrimaryAction(item.itemType)))}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openItemActions(item, event.currentTarget);
                                }}
                                className="min-h-9 min-w-9 rounded-md border border-border bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                aria-label={t("queue.itemActionsFor", { title: item.documentTitle })}
                              >
                                <DotsThree className="h-4 w-4" weight="bold" aria-hidden="true" />
                              </button>

                              {/* Dismiss Button - Only for documents */}
                              {item.itemType === "document" && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDismissDocument(item);
                                  }}
                                  className="group relative w-8 h-8 rounded-full bg-slate-500 hover:bg-slate-600 flex items-center justify-center transition-all shadow-sm hover:shadow-md hover:scale-105"
                                  title={t("queueScroll.dismissTitle")}
                                >
                                  <EyeSlash className="w-4 h-4 text-white" />
                                  <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                                    {t("queue.dismiss")}
                                  </span>
                                </button>
                              )}

                              <ItemDetailsPopover
                                target={buildDetailsTarget(item)}
                                onDismissStateChange={(dismissed) => {
                                  if (dismissed) {
                                    void refreshQueue();
                                  }
                                }}
                                renderTrigger={({ onClick, isOpen }) => (
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onClick();
                                    }}
                                    className={`p-2 rounded-md border border-border bg-background hover:bg-muted/60 ${isOpen ? "text-foreground" : "text-muted-foreground"
                                      }`}
                                    title={t("queue.itemDetails")}
                                  >
                                    <Info className="w-4 h-4" />
                                  </button>
                                )}
                              />
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleExpanded(item.id);
                                }}
                                className="p-2 bg-muted rounded-md text-muted-foreground hover:text-foreground"
                              >
                                {isExpanded ? <CaretUp className="w-4 h-4" /> : <CaretDown className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground space-y-2">
                              <div className="flex items-center gap-3">
                                <Sparkle className="w-4 h-4" />
                                <span>
                                  {t("queue.fsrsSummary", {
                                    stability: getFsrsMetrics(item).stability,
                                    difficulty: getFsrsMetrics(item).difficulty,
                                    retrievability: Math.round(getFsrsMetrics(item).retrievability * 100),
                                  })}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <Target className="w-4 h-4" />
                                <span>
                                  {t("queue.nextIntervalImpact", {
                                    days: getFsrsMetrics(item).nextIntervalDays,
                                    impact: getReadingImpact(item),
                                  })}
                                </span>
                              </div>
                              {status === "drifted" && (
                                <div className="flex items-center gap-3 text-muted-foreground">
                                  <Warning className="w-4 h-4" />
                                  <span>
                                    {t("queue.driftedStateMessage")}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }}
                    estimateSize={80}
                    overscan={5}
                  />
                ) : (
                  visibleItems?.map((item) => {
                    const isExpanded = expandedIds.has(item.id);
                    const status = getQueueStatus(item);
                    const priorityVector = getPriorityVector(item);
                    const estimateRange = getTimeEstimateRange(item);
                    const learningHint = getLearningHint(item);
                    return (
                      <div
                        key={item.id}
                        data-queue-item-id={item.id}
                        aria-selected={item.id === selectedId}
                        className={`border rounded-lg bg-card transition-colors ${item.id === selectedId ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                          }`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedId(item.id);
                          setCtxItem(item);
                          setCtxPos({ x: e.clientX, y: e.clientY });
                        }}
                      >
                        <div
                          onClick={(event) => {
                            setSelectedId(item.id);
                            const isModifierMulti = event.metaKey || event.ctrlKey;
                            if (event.shiftKey || isModifierMulti) {
                              handleLearningItemSelection(
                                item.id,
                                !selectedIds.has(item.id),
                                event.shiftKey
                              );
                            }
                          }}
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            if (item.itemType === "learning-item") {
                              onStartReview?.(item.learningItemId ?? item.id);
                              return;
                            }
                            onOpenDocument?.(item);
                          }}
                          className="p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={(event) => {
                                event.stopPropagation();
                                handleLearningItemSelection(
                                  item.id,
                                  !selectedIds.has(item.id),
                                  !!(event.nativeEvent as MouseEvent).shiftKey
                                );
                              }}
                            />
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.isUpNext ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                              aria-label={t("queue.queuePosition", {
                                position: item.queuePosition,
                                total: item.queueTotal,
                              })}
                            >
                              {item.isUpNext
                                ? `${t("queue.upNext")} · ${t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}`
                                : t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}
                            </span>
                            <StatusPill status={status} />
                            {item.itemType === "document" && (() => {
                              const fsrsInfo = getFsrsSchedulingInfo(item);
                              return (
                                <span
                                  className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-300"
                                  title={t("queue.nextReviewTitle", {
                                    date: fsrsInfo.nextReviewDate
                                      ? fsrsInfo.nextReviewDate.toLocaleDateString(locale)
                                      : t("queue.notScheduled"),
                                  })}
                                >
                                  <Clock className="w-3 h-3 inline mr-1" />
                                  {fsrsInfo.statusLabel}
                                </span>
                              );
                            })()}
                            <TASQueueBadge
                              item={item}
                              onForceShow={(id) => useTASStore.getState().forceShowItem(id)}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground line-clamp-1">
                                {item.documentTitle}
                                {item.itemType === "learning-item" && learningHint && (
                                  <span className="font-normal text-muted-foreground">
                                    {" "}
                                    — {learningHint}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatMinutesRange(estimateRange)} • {t("queue.priorityWithValue", { value: getPriorityScore(item, preset) })}
                              </div>
                              <TimeConfidenceBar min={estimateRange.min} max={estimateRange.max} />
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <PriorityGlyph vector={priorityVector} />

                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCtxStudyNow(item);
                              }}
                              className="min-h-9 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              {t(getQueuePrimaryActionLabelKey(getQueuePrimaryAction(item.itemType)))}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                  openItemActions(item, event.currentTarget);
                              }}
                              className="min-h-9 min-w-9 rounded-md border border-border bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              aria-label={t("queue.itemActionsFor", { title: item.documentTitle })}
                            >
                              <DotsThree className="h-4 w-4" weight="bold" aria-hidden="true" />
                            </button>

                            {/* Dismiss Button - Only for documents */}
                            {item.itemType === "document" && (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDismissDocument(item);
                                }}
                                className="group relative w-8 h-8 rounded-full bg-slate-500 hover:bg-slate-600 flex items-center justify-center transition-all shadow-sm hover:shadow-md hover:scale-105"
                                title={t("queueScroll.dismissTitle")}
                              >
                                <EyeSlash className="w-4 h-4 text-white" />
                                <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                                  {t("queue.dismiss")}
                                </span>
                              </button>
                            )}

                            <ItemDetailsPopover
                              target={buildDetailsTarget(item)}
                              onDismissStateChange={(dismissed) => {
                                if (dismissed) {
                                  void refreshQueue();
                                }
                              }}
                              renderTrigger={({ onClick, isOpen }) => (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onClick();
                                  }}
                                  className={`p-2 rounded-md border border-border bg-background hover:bg-muted/60 ${isOpen ? "text-foreground" : "text-muted-foreground"
                                    }`}
                                  title={t("queue.itemDetails")}
                                >
                                  <Info className="w-4 h-4" />
                                </button>
                              )}
                            />
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpanded(item.id);
                              }}
                              className="p-2 bg-muted rounded-md text-muted-foreground hover:text-foreground"
                            >
                              {isExpanded ? <CaretUp className="w-4 h-4" /> : <CaretDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground space-y-2">
                            <div className="flex items-center gap-3">
                              <Sparkle className="w-4 h-4" />
                              <span>
                                {t("queue.fsrsSummary", {
                                  stability: getFsrsMetrics(item).stability,
                                  difficulty: getFsrsMetrics(item).difficulty,
                                  retrievability: Math.round(getFsrsMetrics(item).retrievability * 100),
                                })}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <Target className="w-4 h-4" />
                              <span>
                                {t("queue.nextIntervalImpact", {
                                  days: getFsrsMetrics(item).nextIntervalDays,
                                  impact: getReadingImpact(item),
                                })}
                              </span>
                            </div>
                            {status === "drifted" && (
                              <div className="flex items-center gap-3 text-muted-foreground">
                                <Warning className="w-4 h-4" />
                                <span>
                                  {t("queue.driftedStateMessage")}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {isInspectorOpen && (
          <aside className="w-80 border-l border-border bg-card p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">{t("queue.inspector")}</h2>
              <button
                onClick={() => setInspectorOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <ListBullets className="w-4 h-4" />
              </button>
            </div>
            {!selectedItem ? (
              <div className="text-sm text-muted-foreground">{t("queue.selectItemToInspect")}</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t("common.title")}</div>
                  <div className="text-sm font-semibold text-foreground">{selectedItem.documentTitle}</div>
                  <div className="text-xs text-muted-foreground mt-1">{selectedItem.itemType}</div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t("queue.schedulingRationale")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("queue.prioritySummary", {
                      value: getPriorityScore(selectedItem, preset),
                      status: getStatusLabel(getQueueStatus(selectedItem)),
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t("queue.fsrsSnapshot")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("queue.fsrsSummary", {
                      stability: getFsrsMetrics(selectedItem).stability,
                      difficulty: getFsrsMetrics(selectedItem).difficulty,
                      retrievability: Math.round(getFsrsMetrics(selectedItem).retrievability * 100),
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t("queue.nextInterval")}</div>
                  <div className="text-sm font-semibold text-foreground">
                    {t("queue.nextIntervalDays", { days: getFsrsMetrics(selectedItem).nextIntervalDays })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t("queue.conversionPathway")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("queue.conversionPathwayValue")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("queue.impactWithValue", { impact: getReadingImpact(selectedItem) })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">{t("queue.recoveryActions")}</div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={handleCompressIntervals}
                      disabled={!selectedItem || selectedItem.itemType !== "learning-item"}
                      className="px-3 py-2 bg-background border border-border rounded text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("queue.compressIntervals")}
                    </button>
                    <button
                      onClick={handleRescheduleIntelligently}
                      disabled={!selectedItem || selectedItem.itemType !== "learning-item"}
                      className="px-3 py-2 bg-background border border-border rounded text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("queue.rescheduleIntelligently")}
                    </button>
                    <button
                      onClick={handleDowngradeFrequency}
                      disabled={!selectedItem || selectedItem.itemType !== "learning-item"}
                      className="px-3 py-2 bg-background border border-border rounded text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t("queue.downgradeFrequency")}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    onClick={() => setShowAdvanced((prev) => !prev)}
                    className="px-3 py-2 bg-muted rounded text-sm flex items-center gap-2 text-foreground"
                  >
                    <Keyboard className="w-4 h-4" />
                    {showAdvanced ? t("queue.hideAdvanced") : t("queue.showAdvanced")}
                  </button>
                  {showAdvanced && (
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <div>{t("queue.rawFsrsValues")}</div>
                      <div>{t("queue.overrideScheduling")}</div>
                      <button
                        onClick={() => setShowRawJson((prev) => !prev)}
                        className="px-3 py-1 bg-background border border-border rounded"
                      >
                        {showRawJson ? t("queue.hideJson") : t("queue.showJson")}
                      </button>
                      {showRawJson && (
                        <pre className="text-[10px] whitespace-pre-wrap bg-background border border-border rounded p-2">
                          {JSON.stringify(selectedItem, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Right-click Context Menu */}
      {ctxPos && ctxItem && (
        <>
          <div className="fixed inset-0 z-[9998]" onContextMenu={(e) => { e.preventDefault(); setCtxPos(null); setCtxItem(null); }} />
          <div
            ref={ctxMenuRef}
            role="menu"
            aria-label={`Actions for ${ctxItem.documentTitle}`}
            className="fixed z-[9999] bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[220px] animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ left: ctxPos.x, top: ctxPos.y }}
          >
            {/* Study / Open */}
            <button
              autoFocus
              role="menuitem"
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onClick={() => handleCtxStudyNow(ctxItem)}
            >
              <Play className="w-4 h-4 text-emerald-500" />
              {ctxItem.itemType === "learning-item" ? t("queue.studyNow") : t("queue.openDocument")}
            </button>

            {ctxItem.itemType === "learning-item" && (
              <>
                <div className="h-px bg-border my-1" />

                {/* Suspend */}
                <button
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80 flex items-center gap-2"
                  onClick={() => void handleCtxSuspend(ctxItem)}
                >
                  <Pause className="w-4 h-4 text-amber-500" />
                  {t("queue.suspend")}
                </button>

                {/* Postpone submenu */}
                <div className="h-px bg-border my-1" />
                <div className="px-3 py-1 text-xs text-muted-foreground font-medium">{t("queue.postpone")}</div>
                {[1, 3, 7].map((days) => (
                  <button
                    key={days}
                    className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80 flex items-center gap-2"
                    onClick={() => void handleCtxPostpone(ctxItem, days)}
                  >
                    <CalendarHeart className="w-4 h-4 text-blue-400" />
                    +{days} {days === 1 ? t("queue.day") : t("queue.days")}
                  </button>
                ))}

                <div className="h-px bg-border my-1" />

                {/* Compress intervals */}
                <button
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80 flex items-center gap-2"
                  onClick={async () => {
                    setCtxPos(null); setCtxItem(null);
                    setSelectedId(ctxItem.id);
                    // Temporarily set selectedItem so inspector handlers work
                    await applyScheduleShift(t("queue.compressIntervals"), -Math.max(1, Math.round(Math.abs(getDaysUntilDue(ctxItem)) * 0.5)));
                  }}
                >
                  <Lightning className="w-4 h-4 text-orange-400" />
                  {t("queue.compressIntervals")}
                </button>

                {/* Reschedule to now */}
                <button
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80 flex items-center gap-2"
                  onClick={async () => {
                    setCtxPos(null); setCtxItem(null);
                    setSelectedId(ctxItem.id);
                    await applyScheduleShift(t("queue.rescheduleIntelligently"), -getDaysUntilDue(ctxItem));
                  }}
                >
                  <ArrowCounterClockwise className="w-4 h-4 text-purple-400" />
                  {t("queue.rescheduleIntelligently")}
                </button>

                <div className="h-px bg-border my-1" />

                {/* Delete */}
                <button
                  className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
                  onClick={() => void handleCtxDelete(ctxItem)}
                >
                  <Trash className="w-4 h-4" />
                  {t("queue.delete")}
                </button>
              </>
            )}

            {ctxItem.itemType === "document" && (
              <>
                <div className="h-px bg-border my-1" />

                {/* Dismiss */}
                <button
                  className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/80 flex items-center gap-2"
                  onClick={() => { setCtxPos(null); setCtxItem(null); void handleDismissDocument(ctxItem); }}
                >
                  <EyeSlash className="w-4 h-4 text-slate-400" />
                  {t("queue.dismiss")}
                </button>

                {/* Delete */}
                <button
                  className="w-full px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
                  onClick={() => {
                    setCtxPos(null); setCtxItem(null);
                    toast.info(t("queue.delete"), t("queueScroll.onlyDocuments"));
                  }}
                >
                  <Trash className="w-4 h-4" />
                  {t("queue.delete")}
                </button>
              </>
            )}
          </div>
        </>
      )}

      <QueueItemActionSheet
        item={actionItem}
        open={Boolean(actionItem)}
        onClose={closeItemActions}
        triggerElement={actionTriggerRef.current}
        onOpenDocument={onOpenDocument}
        onStartReview={onStartReview}
        onPostpone={handleActionPostpone}
        onRemove={handleActionRemove}
        onSelect={handleActionSelect}
      />

      <SessionCustomizeModal
        isOpen={isCustomizeModalOpen}
        onClose={() => setCustomizeModalOpen(false)}
        // Show the types actually in effect, not the raw stored object — in an
        // uncustomized Due All those differ, and a checkbox that contradicts
        // the list below it is its own bug.
        customization={{ ...sessionCustomization, itemTypes: effectiveItemTypes }}
        onChange={(next) => {
          // Only an actual toggle change marks the item types as customized —
          // the modal fires onChange for every field, and adjusting the session
          // duration must not silently pin Due All to the documents-first
          // default. See `effectiveItemTypes`.
          const current = effectiveItemTypes;
          const itemTypesChanged =
            next.itemTypes.documents !== current.documents ||
            next.itemTypes.extracts !== current.extracts ||
            next.itemTypes.learningItems !== current.learningItems;
          setSessionCustomization(next);
          // Persist item type preferences to settings
          updateSettingsCategory("smartQueue", {
            sessionItemTypes: { ...next.itemTypes },
            ...(itemTypesChanged ? { sessionItemTypesCustomized: true } : {}),
          });
        }}
        onApply={() => setCustomizeModalOpen(false)}
        availableTags={Array.from(new Set(items.flatMap((item) => item.tags || [])))}
        availableCategories={Array.from(new Set(items.map((item) => item.category).filter(Boolean)))}
      />

      <SemanticGraphPanel
        isOpen={isSemanticGraphOpen}
        onClose={() => setSemanticGraphOpen(false)}
        items={items}
        focalTopic={sessionCustomization.semanticStudy?.enabled ? sessionCustomization.semanticStudy?.focalTopic : ""}
        embeddingConfig={embeddingConfig}
        onStartSessionWithFilter={(filteredItems) => {
          setCustomSubset(filteredItems);
          toast.success(t("queue.semanticStudyActive"), t("queue.semanticStudyLoaded", { count: filteredItems.length }));
        }}
      />
      </>
      )}
    </div>
  );
}

const PriorityGlyph = React.memo(function PriorityGlyph({ vector }: { vector: ReturnType<typeof getPriorityVector> }) {
  const tooltip = `Retention ${vector.retentionRisk} • Load ${vector.cognitiveLoad} • Time ${vector.timeEfficiency} • Intent ${vector.userIntent} • Overdue ${vector.overduePenalty}`;
  return (
    <div className="flex items-center gap-1" title={tooltip}>
      <div className="h-2 w-20 bg-muted/60 rounded-full overflow-hidden flex">
        <div className="h-full bg-red-500/50" style={{ width: `${vector.retentionRisk / 5}%` }} />
        <div className="h-full bg-amber-500/50" style={{ width: `${vector.cognitiveLoad / 5}%` }} />
        <div className="h-full bg-emerald-500/50" style={{ width: `${vector.timeEfficiency / 5}%` }} />
        <div className="h-full bg-blue-500/50" style={{ width: `${vector.userIntent / 5}%` }} />
        <div className="h-full bg-slate-500/50" style={{ width: `${vector.overduePenalty / 5}%` }} />
      </div>
    </div>
  );
});

const StatusPill = React.memo(function StatusPill({ status }: { status: ReturnType<typeof getQueueStatus> }) {
  const label = getStatusLabel(status);
  const styles =
    status === "drifted"
      ? "bg-slate-500/15 text-slate-200 dark:text-slate-300"
      : status === "due-overdue"
        ? "bg-red-500/15 text-red-600 dark:text-red-300"
        : status === "due"
          ? "bg-orange-500/15 text-orange-600 dark:text-orange-300"
          : status === "scheduled"
            ? "bg-blue-500/15 text-blue-600 dark:text-blue-300"
            : status === "review"
              ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
              : status === "learning"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${styles}`} role="status" aria-label={`Queue status: ${label}`}>
      {label}
    </span>
  );
});

function TimeConfidenceBar({ min, max }: { min: number; max: number }) {
  const width = Math.min(100, Math.max(10, Math.round((min / Math.max(max, 1)) * 100)));
  return (
    <div className="mt-1 h-1.5 w-24 bg-muted/60 rounded-full overflow-hidden">
      <div className="h-full bg-primary/50" style={{ width: `${width}%` }} />
    </div>
  );
}
