import { useEffect, useState } from "react";
import {
  CalendarPlus,
  CircleNotch,
  Flag,
  FolderOpen,
  Pause,
  Play,
  Sparkle,
  Tag,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import type { QueueItem } from "../../types/queue";
import type { LifecycleTransition } from "../../api/queue";

/**
 * Which bulk actions a selection can actually accept.
 *
 * Priority is document/extract only — `learning_items` has no priority column,
 * so a flashcard-only selection cannot be reprioritized at all. A *mixed*
 * selection still offers it: the backend applies it where it exists and reports
 * the flashcards as failures, which is more useful than greying the button out.
 */
export function selectionCapabilities(items: QueueItem[]) {
  const types = new Set(items.map((item) => item.itemType));
  return {
    /** At least one item that has a priority column. */
    canPrioritize: types.has("document") || types.has("extract"),
    /** The AI studio needs extract bodies, so the selection must be all extracts. */
    canOpenStudio: items.length > 0 && types.size === 1 && types.has("extract"),
    types,
  };
}

const POSTPONE_PRESETS = [1, 3, 7, 30];

interface BulkActionBarProps {
  selectedItems: QueueItem[];
  isLoading: boolean;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
  onSetPriority: (slider: number) => void;
  onPostpone: (days: number) => void;
  onSmartPostpone: () => void;
  onMoveToCollection: (collectionId: string) => void;
  onUpdateTags: (add: string[], remove: string[]) => void;
  onLifecycle: (transition: LifecycleTransition) => void;
  onOpenFlashcardStudio: () => void;
  collections: { id: string; name: string }[];
}

type OpenPanel = "priority" | "postpone" | "collection" | "tags" | "lifecycle" | null;

export function BulkActionBar({
  selectedItems,
  isLoading,
  onSuspend,
  onUnsuspend,
  onDelete,
  onClearSelection,
  onSetPriority,
  onPostpone,
  onSmartPostpone,
  onMoveToCollection,
  onUpdateTags,
  onLifecycle,
  onOpenFlashcardStudio,
  collections,
}: BulkActionBarProps) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [priority, setPriority] = useState(50);
  const [tagsToAdd, setTagsToAdd] = useState("");
  const [tagsToRemove, setTagsToRemove] = useState("");

  /**
   * An open panel swallows Escape so the selection survives closing it.
   *
   * Registered in the capture phase because the queue surfaces listen on
   * `window` too: without capture, whichever effect happened to bind first
   * would win, and Escape would clear the selection out from under a panel the
   * user was only trying to dismiss.
   */
  useEffect(() => {
    if (!panel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setPanel(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [panel]);

  const selectedCount = selectedItems.length;
  if (selectedCount === 0) return null;

  const { canPrioritize, canOpenStudio } = selectionCapabilities(selectedItems);
  const togglePanel = (next: OpenPanel) => setPanel((prev) => (prev === next ? null : next));

  const parseTags = (raw: string) =>
    raw
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

  const button =
    "flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-card text-sm transition-colors hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      role="toolbar"
      aria-label={t("bulkAction.toolbar")}
      className="fixed bottom-6 left-1/2 z-50 w-[min(56rem,calc(100vw-2rem))] -translate-x-1/2"
    >
      {/* Popover panels sit above the bar so they never cover the queue rows. */}
      {panel === "priority" && (
        <div className="mb-2 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
          <label className="mb-2 block text-sm font-medium">
            {t("bulkAction.setPriorityTo", { value: priority })}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              className="flex-1"
              aria-label={t("bulkAction.priority")}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(event) =>
                // Clamp here as well as in the backend so the field can never
                // display a value that would not be the one applied.
                setPriority(Math.max(0, Math.min(100, Number(event.target.value) || 0)))
              }
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
              aria-label={t("bulkAction.priority")}
            />
            <button
              className={button}
              onClick={() => {
                onSetPriority(priority);
                setPanel(null);
              }}
            >
              {t("common.apply")}
            </button>
          </div>
          {!canPrioritize && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("bulkAction.priorityFlashcardsSkipped")}
            </p>
          )}
        </div>
      )}

      {panel === "postpone" && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
          {POSTPONE_PRESETS.map((days) => (
            <button
              key={days}
              className={button}
              onClick={() => {
                onPostpone(days);
                setPanel(null);
              }}
            >
              {t("bulkAction.postponeDays", { days })}
            </button>
          ))}
          <button
            className={button}
            onClick={() => {
              onSmartPostpone();
              setPanel(null);
            }}
            title={t("bulkAction.smartPostponeHint")}
          >
            <Sparkle className="h-3.5 w-3.5" />
            {t("bulkAction.smartPostpone")}
          </button>
        </div>
      )}

      {panel === "collection" && (
        <div className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-card/95 p-2 shadow-xl backdrop-blur">
          {collections.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{t("bulkAction.noCollections")}</p>
          ) : (
            collections.map((collection) => (
              <button
                key={collection.id}
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onMoveToCollection(collection.id);
                  setPanel(null);
                }}
              >
                {collection.name}
              </button>
            ))
          )}
        </div>
      )}

      {panel === "tags" && (
        <div className="mb-2 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={tagsToAdd}
              onChange={(event) => setTagsToAdd(event.target.value)}
              placeholder={t("bulkAction.tagsToAdd")}
              aria-label={t("bulkAction.tagsToAdd")}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <input
              value={tagsToRemove}
              onChange={(event) => setTagsToRemove(event.target.value)}
              placeholder={t("bulkAction.tagsToRemove")}
              aria-label={t("bulkAction.tagsToRemove")}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
            <button
              className={button}
              disabled={!tagsToAdd.trim() && !tagsToRemove.trim()}
              onClick={() => {
                onUpdateTags(parseTags(tagsToAdd), parseTags(tagsToRemove));
                setTagsToAdd("");
                setTagsToRemove("");
                setPanel(null);
              }}
            >
              {t("common.apply")}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("bulkAction.tagsHint")}</p>
        </div>
      )}

      {panel === "lifecycle" && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/95 p-4 shadow-xl backdrop-blur">
          {(["done", "dismiss", "forget"] as LifecycleTransition[]).map((transition) => (
            <button
              key={transition}
              className={button}
              onClick={() => {
                onLifecycle(transition);
                setPanel(null);
              }}
              title={
                transition === "forget" ? t("bulkAction.forgetHint") : undefined
              }
            >
              {t(`bulkAction.lifecycle.${transition}`)}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/90 p-3 shadow-2xl backdrop-blur-md">
        <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
          {t("queue.selectedCount", { count: selectedCount })}
        </span>

        {isLoading && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleNotch className="h-4 w-4 animate-spin" />
            {t("common.processing")}
          </span>
        )}

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <button
            className={button}
            disabled={isLoading}
            onClick={() => togglePanel("priority")}
            title={t("bulkAction.priority")}
          >
            <Flag className="h-3.5 w-3.5" />
            {t("bulkAction.priority")}
          </button>

          <button
            className={button}
            disabled={isLoading}
            onClick={() => togglePanel("postpone")}
            title={t("bulkAction.postpone")}
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            {t("bulkAction.postpone")}
          </button>

          <button
            className={button}
            disabled={isLoading}
            onClick={onSuspend}
            title={t("bulkAction.suspendSelected")}
          >
            <Pause className="h-3.5 w-3.5" />
            {t("queue.suspend")}
          </button>

          <button
            className={button}
            disabled={isLoading}
            onClick={onUnsuspend}
            title={t("bulkAction.unsuspendSelected")}
          >
            <Play className="h-3.5 w-3.5" />
            {t("queue.unsuspend")}
          </button>

          <button
            className={button}
            disabled={isLoading}
            onClick={() => togglePanel("collection")}
            title={t("bulkAction.moveToCollection")}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("bulkAction.move")}
          </button>

          <button
            className={button}
            disabled={isLoading}
            onClick={() => togglePanel("tags")}
            title={t("bulkAction.manageTags")}
          >
            <Tag className="h-3.5 w-3.5" />
            {t("bulkAction.tags")}
          </button>

          <button
            className={button}
            disabled={isLoading}
            onClick={() => togglePanel("lifecycle")}
            title={t("bulkAction.lifecycle")}
          >
            {t("bulkAction.lifecycle")}
          </button>

          <button
            className={button}
            disabled={isLoading || !canOpenStudio}
            onClick={onOpenFlashcardStudio}
            title={
              canOpenStudio
                ? t("bulkAction.flashcardStudio")
                : t("bulkAction.flashcardStudioExtractsOnly")
            }
          >
            <Sparkle className="h-3.5 w-3.5" />
            {t("bulkAction.flashcardStudio")}
          </button>

          <button
            className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
            disabled={isLoading}
            onClick={onDelete}
            title={t("bulkAction.deleteSelected")}
          >
            <Trash className="h-3.5 w-3.5" />
            {t("common.delete")}
          </button>

          <button
            className="rounded-md p-2 transition-colors hover:bg-muted"
            onClick={onClearSelection}
            title={t("bulkAction.clearSelection")}
            aria-label={t("bulkAction.clearSelection")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
