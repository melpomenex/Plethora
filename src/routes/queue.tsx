import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowsVertical,
  CalendarHeart,
  CheckSquare,
  Download,
  DotsThree,
  Funnel,
  MagnifyingGlass,
  MinusSquare,
  Play,
  Square,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useQueueStore } from "../stores";
import { QueueStatsDisplay } from "../components/queue/QueueStats";
import { BulkActionBar } from "../components/queue/BulkActionBar";
import { QueueContextMenu } from "../components/queue/QueueContextMenu";
import { QueueItemActionSheet } from "../components/queue/QueueItemActionSheet";
import { ExportQueueDialog } from "../components/queue/ExportQueueDialog";
import { PostponeAllDialog } from "../components/queue/PostponeAllDialog";
import { AutoPostponePrompt } from "../components/queue/AutoPostponePrompt";
import { DynamicVirtualList } from "../components/common/VirtualList";
import type { QueueItem } from "../types/queue";
import type { SortOptions } from "../types/api";
import { useCollectionStore } from "../stores/collectionStore";
import ConfirmDialog, { useConfirmDialog } from "../components/common/ConfirmDialog";
import { dismissDocument, updateDocumentPriority } from "../api/documents";
import { bulkSuspendItems, bulkUnsuspendItems, type BulkOperationResult, type LifecycleTransition } from "../api/queue";
import { TranscriptionQueueActions, TranscriptionQueueIndicator, isTranscribableFileType } from "../components/transcription/TranscriptionQueueActions";
import { useI18n } from "../lib/i18n";
import { useSettingsStore } from "../stores/settingsStore";
import { orderQueueItems, type PriorityPreset } from "../utils/reviewUx";
import { emitQueueActionFeedback } from "../components/review/queueActions";

/**
 * The sort button cycles priority → overdue → title rather than toggling two
 * fields, so "most overdue first" is reachable without adding a second control.
 * Overdue defaults to descending, which is the only direction anyone wants
 * first: the longest-outstanding item at the top.
 */
const SORT_CYCLE: SortOptions["field"][] = ["priority", "overdue", "title"];

function nextSort(current: SortOptions): SortOptions {
  const index = SORT_CYCLE.indexOf(current.field);
  const field = SORT_CYCLE[(index + 1) % SORT_CYCLE.length] ?? "priority";
  return { field, direction: field === "title" ? "asc" : "desc" };
}

export function Queue() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const sortFieldLabel = (field: SortOptions["field"]) => {
    if (field === "overdue") return t("queue.sortOverdue");
    if (field === "title") return t("common.title");
    return t("queueLegacy.priority");
  };
  const {
    filteredItems,
    stats,
    isLoading,
    error,
    searchQuery,
    setSearchQuery,
    sortOptions,
    setSortOptions,
    loadQueue,
    loadStats,
    selectedIds,
    setSelected,
    setSelectionFromClick,
    selectAll,
    clearSelection,
    bulkSuspend,
    bulkUnsuspend,
    bulkDelete,
    bulkSetPriority,
    bulkPostpone,
    bulkMoveToCollection,
    bulkUpdateTags,
    bulkSetLifecycle,
    postponeItemSmart,
    bulkOperationLoading,
    bulkOperationResult,
    clearBulkResult,
  } = useQueueStore(useShallow(state => ({
    filteredItems: state.filteredItems,
    stats: state.stats,
    isLoading: state.isLoading,
    error: state.error,
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
    sortOptions: state.sortOptions,
    setSortOptions: state.setSortOptions,
    loadQueue: state.loadQueue,
    loadStats: state.loadStats,
    selectedIds: state.selectedIds,
    setSelected: state.setSelected,
    setSelectionFromClick: state.setSelectionFromClick,
    selectAll: state.selectAll,
    clearSelection: state.clearSelection,
    bulkSuspend: state.bulkSuspend,
    bulkUnsuspend: state.bulkUnsuspend,
    bulkDelete: state.bulkDelete,
    bulkSetPriority: state.bulkSetPriority,
    bulkPostpone: state.bulkPostpone,
    bulkMoveToCollection: state.bulkMoveToCollection,
    bulkUpdateTags: state.bulkUpdateTags,
    bulkSetLifecycle: state.bulkSetLifecycle,
    postponeItemSmart: state.postponeItemSmart,
    bulkOperationLoading: state.bulkOperationLoading,
    bulkOperationResult: state.bulkOperationResult,
    clearBulkResult: state.clearBulkResult,
  })));

  const [showFilters, setShowFilters] = useState(false);
  const [allSelected, setAllSelected] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPostponeAllDialog, setShowPostponeAllDialog] = useState(false);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, { rating?: number; slider?: number }>>({});
  const [priorityUpdatingIds, setPriorityUpdatingIds] = useState<Set<string>>(new Set());
  const [actionItem, setActionItem] = useState<QueueItem | null>(null);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const collections = useCollectionStore((state) => state.collections);
  const confirmDialog = useConfirmDialog();
  const queueStrategyPreset = useSettingsStore(
    (state) => state.settings.smartQueue.queueStrategyPreset as PriorityPreset,
  );
  const orderedItems = useMemo(
    () => orderQueueItems(filteredItems, queueStrategyPreset),
    [filteredItems, queueStrategyPreset],
  );

  useEffect(() => {
    loadQueue();
    loadStats();
  }, [loadQueue, loadStats]);

  const renderedIds = useMemo(() => orderedItems.map((item) => item.id), [orderedItems]);

  useEffect(() => {
    setAllSelected(orderedItems.length > 0 && selectedIds.size === orderedItems.length);
  }, [selectedIds, orderedItems]);

  // Partially selected: drives the header checkbox's indeterminate state.
  const someSelected = selectedIds.size > 0 && !allSelected;

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll();
    }
  }, [allSelected, clearSelection, selectAll]);

  const handleRowClick = useCallback(
    (event: React.MouseEvent, itemId: string) => {
      // Row-level controls (start review, priority, the action menu) own their
      // own clicks; only bare row surface drives selection.
      if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      setSelectionFromClick(itemId, renderedIds, {
        shift: event.shiftKey,
        meta: event.metaKey || event.ctrlKey,
      });
    },
    [renderedIds, setSelectionFromClick],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal Cmd+A or Escape from a field the user is typing in.
      const inField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && !inField) {
        event.preventDefault();
        handleToggleSelectAll();
        return;
      }

      // Escape clears the selection from anywhere in the view, including the
      // search box — deliberately not gated on `inField` the way Cmd+A is.
      // Escape in a text field does nothing else here, so there is nothing to
      // steal, and "Escape drops my selection" should not depend on where focus
      // happens to sit. IME composition still owns Escape while composing.
      if (event.key === "Escape" && !event.isComposing && selectedIds.size > 0) {
        // A dialog or an open bulk-action panel dismisses first — the panel
        // stops this event in the capture phase (see BulkActionBar).
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleToggleSelectAll, clearSelection, selectedIds.size]);

  const selectedItems = useMemo(
    () => orderedItems.filter((item) => selectedIds.has(item.id)),
    [orderedItems, selectedIds],
  );

  const reportBulk = (result: BulkOperationResult, title: string) => {
    // Surface partial outcomes rather than claiming a clean sweep — a batch that
    // skipped flashcards or hit stale ids must say so.
    emitQueueActionFeedback({
      action: "postpone",
      succeeded: result.failed.length === 0,
      title,
      message:
        result.failed.length === 0
          ? t("queue.scheduleUpdated")
          : result.errors.slice(0, 3).join("; "),
    });
  };

  const handleBulkPriority = async (slider: number) => {
    const result = await bulkSetPriority(slider);
    reportBulk(result, t("bulkAction.priority"));
  };

  const handleBulkPostpone = async (days: number) => {
    const result = await bulkPostpone(days);
    reportBulk(result, t("bulkAction.postpone"));
  };

  /**
   * Smart postpone runs the frontend postpone engine per item — it is the only
   * place the priority-weighted formula lives, and reimplementing it in the
   * batch command would give the two copies room to drift.
   */
  const handleBulkSmartPostpone = async () => {
    const items = selectedItems;
    clearSelection();
    let failed = 0;
    for (const item of items) {
      try {
        await postponeItemSmart(item);
      } catch {
        failed += 1;
      }
    }
    emitQueueActionFeedback({
      action: "postpone",
      succeeded: failed === 0,
      title: t("bulkAction.smartPostpone"),
      message: t("queue.scheduleUpdated"),
    });
    await loadQueue();
  };

  const handleBulkMove = async (collectionId: string) => {
    const result = await bulkMoveToCollection(collectionId);
    reportBulk(result, t("bulkAction.moveToCollection"));
    await loadQueue();
  };

  const handleBulkTags = async (add: string[], remove: string[]) => {
    const result = await bulkUpdateTags(add, remove);
    reportBulk(result, t("bulkAction.manageTags"));
    await loadQueue();
  };

  const handleBulkLifecycle = (transition: LifecycleTransition) => {
    const count = selectedIds.size;
    const run = async () => {
      const result = await bulkSetLifecycle(transition);
      reportBulk(result, t(`bulkAction.lifecycle.${transition}`));
    };
    // Forget throws away scheduling history and cannot be reconstructed, so it
    // is the one transition that asks first.
    if (transition === "forget") {
      confirmDialog.confirm({
        title: t("bulkAction.forgetConfirmTitle", { count }),
        message: t("bulkAction.forgetConfirmMessage"),
        variant: "danger",
        itemCount: count,
        onConfirm: () => void run(),
      });
      return;
    }
    void run();
  };

  /**
   * Bulk delete is permanent, so it confirms and does NOT offer Undo.
   *
   * `bulk_delete_items` hard-deletes every type — `DELETE FROM documents`
   * (`repository.rs:1683`), `delete_extract` (`:2122`), and a direct delete for
   * learning items. There is no soft-delete column to restore from, so an Undo
   * button here could only pretend to work. The confirmation says so instead;
   * offering a restore that silently fails is worse than offering none.
   */
  const handleBulkDelete = () => {
    const count = selectedIds.size;
    confirmDialog.confirm({
      title: t("bulkAction.deleteConfirmTitle", { count }),
      message: t("bulkAction.deleteConfirmMessage"),
      variant: "danger",
      itemCount: count,
      onConfirm: () => {
        void (async () => {
          await bulkDelete();
          emitQueueActionFeedback({
            action: "delete",
            succeeded: true,
            title: t("bulkAction.deleted", { count }),
            message: t("queue.scheduleUpdated"),
          });
        })();
      },
    });
  };

  const handleBulkFlashcardStudio = () => {
    // Hand the combined extract text to the studio via the same event the
    // single-extract path uses, so one session can span the whole selection.
    const texts = selectedItems
      .map((item) => item.question || item.documentTitle)
      .filter(Boolean);
    window.dispatchEvent(
      new CustomEvent("open-flashcard-studio", {
        detail: { extractIds: selectedItems.map((i) => i.id), context: texts.join("\n\n") },
      }),
    );
    clearSelection();
  };

  const handleStartReview = (item: QueueItem) => {
    if (item.itemType === "learning-item") {
      navigate("/review");
    } else {
      navigate(`/documents/${item.documentId}`);
    }
  };

  const handleDeleteItem = async (id: string) => {
    // For single item delete, we'll need to implement this
    // For now, select the item and use bulk delete
    setSelected(id, true);
    await bulkDelete();
  };

  const openItemActions = (item: QueueItem, trigger: HTMLElement) => {
    actionTriggerRef.current = trigger;
    setActionItem(item);
  };

  const closeItemActions = () => {
    setActionItem(null);
    requestAnimationFrame(() => actionTriggerRef.current?.focus());
  };

  const handleActionPostpone = async (item: QueueItem) => {
    try {
      const result = await postponeItemSmart(item);
      emitQueueActionFeedback({
        action: "postpone",
        succeeded: true,
        title: t("queue.postponed"),
        message: t("queue.reviewScheduleUpdated", { days: result.increase }),
      });
      await loadQueue();
    } catch (error) {
      emitQueueActionFeedback({
        action: "postpone",
        succeeded: false,
        title: t("queue.operationFailed"),
        message: error instanceof Error ? error.message : t("queue.pleaseRefresh"),
      });
    }
  };

  const handleActionRemove = async (item: QueueItem) => {
    try {
      if (item.itemType === "document") {
        await dismissDocument(item.documentId, true);
        emitQueueActionFeedback({
          action: "dismiss",
          succeeded: true,
          title: t("queueScroll.documentDismissed"),
          message: t("queueScroll.documentDismissedDesc"),
          undoLabel: t("queue.undo"),
          onUndo: async () => {
            await dismissDocument(item.documentId, false);
            await loadQueue();
            emitQueueActionFeedback({
              action: "restore",
              succeeded: true,
              title: t("queue.restored"),
              message: t("queue.scheduleUpdated"),
            });
          },
        });
      } else if (item.itemType === "learning-item") {
        const result = await bulkSuspendItems([item.id]);
        if (result.failed.length > 0) {
          throw new Error(result.errors.join(", "));
        }
        emitQueueActionFeedback({
          action: "suspend",
          succeeded: true,
          title: t("queue.suspended"),
          message: t("queue.scheduleUpdated"),
          undoLabel: t("queue.undo"),
          onUndo: async () => {
            await bulkUnsuspendItems([item.id]);
            await loadQueue();
            emitQueueActionFeedback({
              action: "restore",
              succeeded: true,
              title: t("queue.restored"),
              message: t("queue.scheduleUpdated"),
            });
          },
        });
      }
      await loadQueue();
    } catch (error) {
      emitQueueActionFeedback({
        action: item.itemType === "document" ? "dismiss" : "suspend",
        succeeded: false,
        title: t("queue.operationFailed"),
        message: error instanceof Error ? error.message : t("queue.pleaseRefresh"),
      });
    }
  };

  const getItemIcon = (itemType: QueueItem["itemType"], fileType?: string) => {
    // Use specific icons for video/audio content
    if (isTranscribableFileType(fileType as QueueItem["documentFileType"])) {
      if (fileType === 'audio' || fileType === 'audiobook') {
        return "🎵";
      }
      if (fileType === 'video' || fileType === 'youtube') {
        return "🎬";
      }
    }
    switch (itemType) {
      case "document":
        return "📄";
      case "extract":
        return "📝";
      case "learning-item":
        return "🧠";
      default:
        return "📚";
    }
  };

  const getPriorityColor = (priority: number) => {
    if (priority > 10) {
      if (priority >= 80) return "text-red-500";
      if (priority >= 50) return "text-yellow-500";
      return "text-green-500";
    }
    if (priority >= 8) return "text-red-500";
    if (priority >= 5) return "text-yellow-500";
    return "text-green-500";
  };

  const getDraftPriority = (item: QueueItem) => {
    const draft = priorityDrafts[item.id];
    return {
      rating: draft?.rating ?? item.priorityRating ?? 0,
      slider: draft?.slider ?? item.prioritySlider ?? 0,
    };
  };

  const updateDocumentQueuePriority = async (
    item: QueueItem,
    rating: number,
    slider: number
  ) => {
    if (item.itemType !== "document") return;

    setPriorityUpdatingIds((prev) => new Set(prev).add(item.id));
    try {
      await updateDocumentPriority(item.documentId, rating, slider);
      await loadQueue();
      setPriorityDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      console.error("Failed to update document priority:", error);
    } finally {
      setPriorityUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const now = new Date();
    const daysUntilDue = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDue < 0) return t("queueLegacy.overdue");
    if (daysUntilDue === 0) return t("queueLegacy.today");
    if (daysUntilDue === 1) return t("queueLegacy.tomorrow");
    if (daysUntilDue <= 7) return t("queueLegacy.inDays", { count: daysUntilDue });
    return date.toLocaleDateString();
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t("dashboard.readingQueue")}</h1>
        <p className="text-muted-foreground">
          {t("queueLegacy.manageQueue", { count: filteredItems.length })}
        </p>
      </div>

      {/* Statistics */}
      <QueueStatsDisplay stats={stats} isLoading={isLoading} />

      {/* Search and Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <MagnifyingGlass className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <input
            type="text"
            aria-label="Search queue"
            placeholder={t("queueLegacy.searchItems")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className="p-2 bg-card border border-border rounded-md hover:bg-muted transition-colors"
          title={t("queueLegacy.toggleFilters")}
        >
          <Funnel className="w-4 h-4" />
        </button>

        <button
          onClick={() => setSortOptions(nextSort(sortOptions))}
          className="p-2 bg-card border border-border rounded-md hover:bg-muted transition-colors"
          title={t("queueLegacy.sortBy", {
            field: sortFieldLabel(sortOptions.field),
            direction: sortOptions.direction,
          })}
        >
          <ArrowsVertical className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowExportDialog(true)}
          className="p-2 bg-card border border-border rounded-md hover:bg-muted transition-colors"
          title={t("queueLegacy.exportQueue")}
        >
          <Download className="w-4 h-4" />
        </button>

        <button
          onClick={() => setShowPostponeAllDialog(true)}
          disabled={filteredItems.length === 0}
          className="p-2 bg-card border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          title={t("postpone.postponeAllTitle")}
        >
          <CalendarHeart className="w-4 h-4" />
        </button>

        <button
          onClick={() => navigate("/review")}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity flex items-center gap-2"
        >
          <Play className="w-4 h-4" />
          {t("queueLegacy.startReview")}
        </button>
      </div>

      {/* Bulk Operation Result */}
      {bulkOperationResult && (
        <div className={`p-4 border rounded-lg ${
          bulkOperationResult.failed.length === 0
            ? "bg-green-500/10 border-green-500 text-green-500"
            : "bg-yellow-500/10 border-yellow-500 text-yellow-500"
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {t("queueLegacy.bulkSucceeded", { count: bulkOperationResult.succeeded.length })}
                {bulkOperationResult.failed.length > 0 && (
                  <>, {t("queueLegacy.bulkFailedInline", { count: bulkOperationResult.failed.length })}</>
                )}
              </p>
              {bulkOperationResult.failed.length > 0 && (
                <div className="text-sm mt-1">
                  {bulkOperationResult.errors.join(", ")}
                </div>
              )}
            </div>
            <button
              onClick={clearBulkResult}
              className="p-1 hover:bg-black/10 rounded transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">
          {error}
        </div>
      )}

      {/* Bulk Action Bar */}
      <BulkActionBar
        selectedItems={selectedItems}
        isLoading={bulkOperationLoading}
        collections={collections}
        onSuspend={bulkSuspend}
        onUnsuspend={bulkUnsuspend}
        onDelete={handleBulkDelete}
        onClearSelection={clearSelection}
        onSetPriority={handleBulkPriority}
        onPostpone={handleBulkPostpone}
        onSmartPostpone={handleBulkSmartPostpone}
        onMoveToCollection={handleBulkMove}
        onUpdateTags={handleBulkTags}
        onLifecycle={handleBulkLifecycle}
        onOpenFlashcardStudio={handleBulkFlashcardStudio}
      />

      {/* Queue Items */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-muted-foreground">{t("queue.loading")}</div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📚</div>
          <h3 className="text-xl font-semibold text-foreground mb-2">
            {searchQuery ? t("queueLegacy.noSearchMatches") : t("queueLegacy.emptyQueue")}
          </h3>
          <p className="text-muted-foreground mb-6">
            {searchQuery
              ? t("queueLegacy.tryAdjusting")
              : t("queueLegacy.importToStart")}
          </p>
          {!searchQuery && (
            <button
              onClick={() => navigate("/documents")}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              {t("queueLegacy.importDocuments")}
            </button>
          )}
        </div>
      ) : (
        <div className="min-h-0 space-y-3">
          {/* Select All Header */}
          <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
            <button
              onClick={handleToggleSelectAll}
              className="p-2 hover:bg-muted rounded transition-colors"
              role="checkbox"
              aria-checked={allSelected ? "true" : someSelected ? "mixed" : "false"}
              title={allSelected ? t("queueLegacy.deselectAll") : t("queueLegacy.selectAll")}
            >
              {allSelected ? (
                <CheckSquare className="w-4 h-4 text-primary" />
              ) : someSelected ? (
                <MinusSquare className="w-4 h-4 text-primary" />
              ) : (
                <Square className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            <span className="text-sm text-muted-foreground">
              {allSelected
                ? t("queueLegacy.allSelected")
                : someSelected
                  ? t("queue.selectedCount", { count: selectedIds.size })
                  : t("queueLegacy.selectAll")}
            </span>
          </div>

          {/* Virtual Scrolled Items List */}
          <DynamicVirtualList
            items={orderedItems}
            renderItem={(item) => (
              <div
                onClick={(event) => handleRowClick(event, item.id)}
                aria-selected={selectedIds.has(item.id)}
                className={`p-4 mb-3 rounded-lg border hover:shadow-md transition-shadow ${
                  selectedIds.has(item.id)
                    ? "bg-primary/10 border-primary"
                    : "bg-card border-border"
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Checkbox — toggles this row alone, like Cmd+Click. */}
                  <button
                    onClick={() =>
                      setSelectionFromClick(item.id, renderedIds, { meta: true })
                    }
                    className="pt-1"
                    title={t("queueLegacy.selectItem")}
                  >
                    {selectedIds.has(item.id) ? (
                      <CheckSquare className="w-5 h-5 text-primary" />
                    ) : (
                      <Square className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>

                  <div
                    className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${item.isUpNext ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                    aria-label={t("queue.queuePosition", {
                      position: item.queuePosition,
                      total: item.queueTotal,
                    })}
                  >
                    {item.isUpNext
                      ? `${t("queue.upNext")} · ${t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}`
                      : t("queue.positionOf", { position: item.queuePosition, total: item.queueTotal })}
                  </div>

                  {/* Icon */}
                  <div className="text-2xl flex-shrink-0">{getItemIcon(item.itemType, item.documentFileType)}</div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground mb-1 truncate">
                          {item.documentTitle}
                        </h3>

                        {/* Metadata */}
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          {item.category && (
                            <span className="inline-block px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
                              {item.category}
                            </span>
                          )}
                          {item.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-block px-2 py-0.5 text-xs bg-primary/10 text-primary rounded"
                            >
                              {tag}
                            </span>
                          ))}
                          {item.dueDate && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              {formatDate(item.dueDate)}
                            </span>
                          )}
                          {/* Transcription status indicator */}
                          <TranscriptionQueueIndicator 
                            documentId={item.documentId}
                            fileType={item.documentFileType}
                          />
                        </div>

                        {/* Progress bar */}
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-foreground">{item.progress}%</span>
                        </div>
                      </div>

                      {/* Priority */}
                      <div className="text-right flex-shrink-0 ml-4">
                        <div className={`text-lg font-bold ${getPriorityColor(item.priority)}`}>
                          {item.priority.toFixed(1)}
                        </div>
                      <div className="text-xs text-muted-foreground">{t("queueLegacy.priority")}</div>
                    </div>
                  </div>

                  {item.itemType === "document" && (
                    <div className="mt-3 space-y-3">
                      {/* Transcription actions for video/audio */}
                      {isTranscribableFileType(item.documentFileType) && (
                        <TranscriptionQueueActions
                          documentId={item.documentId}
                          documentTitle={item.documentTitle}
                          fileType={item.documentFileType}
                          compact
                        />
                      )}
                      
                      <div className="rounded-md border border-border bg-muted/30 p-3">
                      <div className="flex flex-wrap items-center gap-4">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            {t("queueLegacy.rating")}
                          </div>
                          <div className="flex items-center gap-2">
                            {[1, 2, 3, 4].map((rating) => {
                              const isActive = getDraftPriority(item).rating === rating;
                              const isUpdating = priorityUpdatingIds.has(item.id);
                              return (
                                <button
                                  key={rating}
                                  onClick={() => {
                                    setPriorityDrafts((prev) => ({
                                      ...prev,
                                      [item.id]: {
                                        ...prev[item.id],
                                        rating,
                                      },
                                    }));
                                    const slider = getDraftPriority(item).slider;
                                    void updateDocumentQueuePriority(item, rating, slider);
                                  }}
                                  disabled={isUpdating}
                                  className={`w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                                    isActive
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-background text-foreground border border-border"
                                  } ${isUpdating ? "opacity-50 cursor-not-allowed" : "hover:bg-primary/10"}`}
                                  title={t("queueLegacy.rateNumber", { count: rating })}
                                >
                                  {rating}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="flex-1 min-w-[200px]">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                            <span>{t("queueLegacy.prioritySlider")}</span>
                            <span>{getDraftPriority(item).slider}</span>
                          </div>
                          <input
                            type="range"
                            aria-label="Priority"
                            min={0}
                            max={100}
                            step={1}
                            value={getDraftPriority(item).slider}
                            onChange={(event) => {
                              const slider = Number(event.target.value);
                              setPriorityDrafts((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...prev[item.id],
                                  slider,
                                },
                              }));
                            }}
                            onMouseUp={(event) => {
                              const slider = Number((event.target as HTMLInputElement).value);
                              const rating = getDraftPriority(item).rating;
                              void updateDocumentQueuePriority(item, rating, slider);
                            }}
                            onTouchEnd={(event) => {
                              const slider = Number((event.target as HTMLInputElement).value);
                              const rating = getDraftPriority(item).rating;
                              void updateDocumentQueuePriority(item, rating, slider);
                            }}
                            disabled={priorityUpdatingIds.has(item.id)}
                            className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                          />
                        </div>
                      </div>
                    </div>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                      <div className="text-sm text-muted-foreground">
                        {item.estimatedTime > 0 && (
                          <span>⏱️ {item.estimatedTime} min</span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleStartReview(item)}
                          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity flex items-center gap-1.5 text-sm"
                          title={t("common.start")}
                        >
                          <Play className="w-3.5 h-3.5" />
                          {t("common.start")}
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

                        <QueueContextMenu
                          item={item}
                          onDelete={handleDeleteItem}
                          onStartReview={handleStartReview}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            className="max-h-[calc(100vh-20rem)] min-h-[280px]"
            estimateSize={200}
          />
        </div>
      )}

      {/* Export Dialog */}
      <ExportQueueDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
      />

      {/* Postpone All Dialog */}
      <PostponeAllDialog
        isOpen={showPostponeAllDialog}
        onClose={() => setShowPostponeAllDialog(false)}
      />

      {/* Auto-Postpone Prompt */}
      <AutoPostponePrompt />

      <QueueItemActionSheet
        item={actionItem}
        open={Boolean(actionItem)}
        onClose={closeItemActions}
        triggerElement={actionTriggerRef.current}
        onOpenDocument={(item) => handleStartReview(item)}
        onStartReview={() => {
          if (actionItem) handleStartReview(actionItem);
        }}
        onPostpone={handleActionPostpone}
        onRemove={handleActionRemove}
        onSelect={(item) => setSelected(item.id, true)}
      />

      {/* Bulk Delete / Forget confirmation. The hook only holds state — without
          this the confirm() calls would set state nothing renders. */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={confirmDialog.close}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant}
        itemCount={confirmDialog.itemCount}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
      />
    </div>
  );
}
