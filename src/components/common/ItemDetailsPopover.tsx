import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  CircleNotch,
  Eye,
  EyeSlash,
  Info,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { getDocument, dismissDocument, updateDocument } from "../../api/documents";
import { useToast } from "../common/Toast";
import { getExtract, updateExtract } from "../../api/extracts";
import { getLearningItem, updateLearningItemTags } from "../../api/learning-items";
import { getAlgorithmParams } from "../../api/algorithm";
import { previewReviewIntervals, formatInterval, type PreviewIntervals } from "../../api/review";
import type { TaggedItemSummary } from "../../api/tags";
import { cn } from "../../utils";
import { useSettingsStore } from "../../stores/settingsStore";
import { useI18n } from "../../lib/i18n";
import { useModal } from "./Modal";
import { TagItemsModalContent } from "./TagItemsModal";

export type ItemDetailsTarget =
  | {
      type: "document";
      id: string;
      title: string;
      tags?: string[];
      category?: string;
    }
  | {
      type: "extract";
      id: string;
      title: string;
      tags?: string[];
      category?: string;
    }
  | {
      type: "learning-item";
      id: string;
      title: string;
      tags?: string[];
      category?: string;
    }
  | {
      type: "rss";
      title: string;
      source?: string;
      link?: string;
      category?: string;
    };

interface ItemDetailsData {
  stability?: number | null;
  difficulty?: number | null;
  retrievability?: number | null;
  nextIntervalDays?: number | null;
  dueDate?: string | null;
  reps?: number | null;
  lapses?: number | null;
  previewIntervals?: PreviewIntervals | null;
  raw?: Record<string, unknown> | null;
  isDismissed?: boolean;
  algorithmType?: string | null;
  intervalModifier?: number | null;
  firstReviewedAt?: string | null;
}

interface ItemDetailsPopoverProps {
  target: ItemDetailsTarget;
  renderTrigger: (props: { onClick: () => void; isOpen: boolean; }) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
  onDismissStateChange?: (dismissed: boolean) => void;
  /** Runs the same smart-postpone flow as the Queue context menu. Omit to hide the postpone action. */
  onPostpone?: () => Promise<{ increase: number; newInterval: number }>;
  /** Deletes the current item (caller decides how). Omit to hide the delete action. */
  onDelete?: () => Promise<void>;
  /** Called when the user picks an item from the "items with this tag" modal. Omit to disable navigation from that modal. */
  onNavigateToTaggedItem?: (item: TaggedItemSummary) => void;
}

const EMPTY_DETAILS: ItemDetailsData = {
  stability: null,
  difficulty: null,
  retrievability: null,
  nextIntervalDays: null,
  dueDate: null,
  reps: null,
  lapses: null,
  previewIntervals: null,
  raw: null,
  algorithmType: null,
  intervalModifier: null,
  firstReviewedAt: null,
};

function formatMaybeNumber(value?: number | null, suffix?: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const formatted = Math.round(value * 100) / 100;
  return suffix ? `${formatted}${suffix}` : `${formatted}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function getIntervalFromDueDate(value?: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = date.getTime() - Date.now();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.round(diffDays * 10) / 10;
}

async function loadItemDetails(target: ItemDetailsTarget): Promise<ItemDetailsData> {
  if (target.type === "learning-item") {
    const [item, algorithm, previewIntervals] = await Promise.all([
      getLearningItem(target.id),
      getAlgorithmParams(target.id).catch(() => null),
      previewReviewIntervals(target.id).catch(() => null),
    ]);

    const stability = algorithm?.stability ?? item?.memory_state?.stability ?? null;
    const difficulty = algorithm?.difficulty ?? item?.memory_state?.difficulty ?? null;
    const nextIntervalDays = algorithm?.interval ?? null;

    return {
      stability,
      difficulty,
      retrievability: null,
      nextIntervalDays,
      dueDate: item?.due_date ?? null,
      reps: item?.review_count ?? null,
      lapses: item?.lapses ?? null,
      previewIntervals,
      raw: item ? { ...item } : null,
      algorithmType: item?.algorithm_type ?? null,
    };
  }

  if (target.type === "extract") {
    const extract = await getExtract(target.id);
    return {
      stability: extract?.memory_state?.stability ?? null,
      difficulty: extract?.memory_state?.difficulty ?? null,
      retrievability: null,
      nextIntervalDays: getIntervalFromDueDate(extract?.next_review_date ?? null),
      dueDate: extract?.next_review_date ?? null,
      reps: extract?.reps ?? null,
      lapses: null,
      previewIntervals: null,
      raw: extract ? { ...extract } : null,
    };
  }

  if (target.type === "document") {
    const document = await getDocument(target.id);
    return {
      stability: document?.stability ?? null,
      difficulty: document?.difficulty ?? null,
      retrievability: null,
      nextIntervalDays: getIntervalFromDueDate(document?.nextReadingDate ?? null),
      dueDate: document?.nextReadingDate ?? null,
      reps: document?.reps ?? document?.readingCount ?? null,
      lapses: null,
      previewIntervals: null,
      isDismissed: document?.isDismissed ?? false,
      raw: document ? { ...document } : null,
      intervalModifier: document?.intervalModifier ?? 1.0,
      firstReviewedAt: document?.firstReviewedAt ?? null,
    };
  }

  return EMPTY_DETAILS;
}

export function ItemDetailsPopover({
  target,
  renderTrigger,
  align = "right",
  className,
  onDismissStateChange,
  onPostpone,
  onDelete,
  onNavigateToTaggedItem,
}: ItemDetailsPopoverProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [details, setDetails] = useState<ItemDetailsData>(EMPTY_DETAILS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isUpdatingDismiss, setIsUpdatingDismiss] = useState(false);
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [localModifier, setLocalModifier] = useState<string>("");
  const [isSavingModifier, setIsSavingModifier] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const modal = useModal();
  const { settings } = useSettingsStore();
  const canEditTags = target.type !== "rss";

  const targetKey = useMemo(() => {
    if (target.type === "rss") return `rss:${target.title}`;
    return `${target.type}:${target.id}`;
  }, [target]);

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setIsLoading(true);
    setError(null);

    loadItemDetails(target)
      .then((data) => {
        if (!active) return;
        setDetails(data);
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load item details", err);
        setError(t("itemDetails.failedToLoad"));
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, targetKey, target]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (event.target instanceof Node && wrapperRef.current.contains(event.target)) return;
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setShowRaw(false);
    }
  }, [isOpen]);

  // Reset to the prop-supplied tags whenever the popover opens or the target
  // changes; the loadItemDetails effect below reconciles with the freshly
  // fetched item once it resolves, since target.tags can be stale.
  useEffect(() => {
    if (!isOpen) return;
    setLocalTags(target.type === "rss" ? [] : target.tags ?? []);
    setTagInput("");
  }, [isOpen, targetKey]);

  useEffect(() => {
    if (!details.raw) return;
    const rawTags = (details.raw as { tags?: unknown }).tags;
    if (Array.isArray(rawTags)) {
      setLocalTags(rawTags.filter((tag): tag is string => typeof tag === "string"));
    }
  }, [details.raw]);

  useEffect(() => {
    if (details.intervalModifier != null) {
      setLocalModifier(details.intervalModifier.toFixed(1));
    }
  }, [details.intervalModifier]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  const persistTags = async (nextTags: string[]) => {
    if (target.type === "document") {
      const rawDoc = details.raw as unknown as import("../../types/document").Document | null;
      if (!rawDoc) throw new Error("Document details not loaded yet");
      await updateDocument(target.id, { ...rawDoc, tags: nextTags });
    } else if (target.type === "extract") {
      await updateExtract({ id: target.id, tags: nextTags });
    } else if (target.type === "learning-item") {
      await updateLearningItemTags(target.id, nextTags);
    }
  };

  const handleAddTag = async () => {
    if (!canEditTags) return;
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (localTags.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      setTagInput("");
      return;
    }

    const previousTags = localTags;
    setLocalTags([...localTags, trimmed]);
    setTagInput("");
    setIsSavingTag(true);
    try {
      await persistTags([...localTags, trimmed]);
    } catch (err) {
      console.error("Failed to add tag", err);
      setLocalTags(previousTags);
      setTagInput(trimmed);
      toast.error(
        t("itemDetails.tagAddFailed"),
        err instanceof Error ? err.message : t("itemDetails.pleaseTryAgain")
      );
    } finally {
      setIsSavingTag(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!canEditTags) return;
    const previousTags = localTags;
    const nextTags = localTags.filter((existing) => existing !== tagToRemove);
    setLocalTags(nextTags);
    setIsSavingTag(true);
    try {
      await persistTags(nextTags);
    } catch (err) {
      console.error("Failed to remove tag", err);
      setLocalTags(previousTags);
      toast.error(
        t("itemDetails.tagRemoveFailed"),
        err instanceof Error ? err.message : t("itemDetails.pleaseTryAgain")
      );
    } finally {
      setIsSavingTag(false);
    }
  };

  const handleTagInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleAddTag();
    }
  };

  const handleTagClick = (tag: string) => {
    void modal.custom(
      <TagItemsModalContent
        tag={tag}
        currentItemId={target.type !== "rss" ? target.id : undefined}
        onSelect={(item) => onNavigateToTaggedItem?.(item)}
      />,
      {
        title: t("itemDetails.tagItemsModalTitle", { tag }),
        size: "md",
        confirmText: t("common.close"),
      }
    );
  };

  const handlePostpone = async () => {
    if (!onPostpone) return;
    setIsPostponing(true);
    try {
      const result = await onPostpone();
      toast.success(
        t("postpone.itemPostponed"),
        t("postpone.itemPostponedDescription", { days: result.increase, newInterval: result.newInterval })
      );
    } catch (err) {
      console.error("Failed to postpone item", err);
      toast.error(
        t("itemDetails.postponeFailed"),
        err instanceof Error ? err.message : t("itemDetails.pleaseTryAgain")
      );
    } finally {
      setIsPostponing(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm(t("itemDetails.deleteConfirm", { title: target.title }))) return;
    setIsDeleting(true);
    try {
      await onDelete();
      setIsOpen(false);
      toast.success(t("itemDetails.itemDeleted"));
    } catch (err) {
      console.error("Failed to delete item", err);
      toast.error(
        t("itemDetails.deleteFailed"),
        err instanceof Error ? err.message : t("itemDetails.pleaseTryAgain")
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveModifier = async (overrideValue?: number) => {
    if (target.type !== "document") return;
    const value = overrideValue ?? parseFloat(localModifier);
    if (Number.isNaN(value) || value < 0.1 || value > 5.0) {
      toast.error(t("itemDetails.invalidModifier") || "Invalid value", "Must be between 0.1 and 5.0");
      return;
    }
    const rounded = Math.round(value * 10) / 10;
    setIsSavingModifier(true);
    try {
      const rawDoc = details.raw as unknown as import("../../types/document").Document | null;
      if (!rawDoc) throw new Error("Document details not loaded yet");
      await updateDocument(target.id, { ...rawDoc, intervalModifier: rounded });
      setDetails((prev) => ({ ...prev, intervalModifier: rounded }));
      setLocalModifier(rounded.toFixed(1));
      toast.success(t("itemDetails.modifierSaved") || "Interval modifier saved");
    } catch (err) {
      console.error("Failed to save interval modifier", err);
      toast.error(
        t("itemDetails.modifierSaveFailed") || "Failed to save",
        err instanceof Error ? err.message : t("itemDetails.pleaseTryAgain")
      );
    } finally {
      setIsSavingModifier(false);
    }
  };

  const handleDismissToggle = async () => {
    if (target.type !== "document") return;
    
    setIsUpdatingDismiss(true);
    try {
      const newDismissedState = !details.isDismissed;
      await dismissDocument(target.id, newDismissedState);
      setDetails((prev) => ({ ...prev, isDismissed: newDismissedState }));
      onDismissStateChange?.(newDismissedState);
      toast.success(
        newDismissedState ? t("itemDetails.documentDismissed") : t("itemDetails.documentRestored"),
        newDismissedState 
          ? t("itemDetails.hiddenFromQueue")
          : t("itemDetails.appearsInQueue")
      );
    } catch (error) {
      console.error("Failed to update dismiss status:", error);
      toast.error(
        t("itemDetails.updateFailed"),
        error instanceof Error ? error.message : t("itemDetails.pleaseTryAgain")
      );
    } finally {
      setIsUpdatingDismiss(false);
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative inline-flex", className)}>
      {renderTrigger({ onClick: handleToggle, isOpen })}
      {isOpen && (
        <div
          className={cn(
            "fixed inset-x-4 bottom-4 max-w-lg mx-auto md:absolute md:inset-x-auto md:bottom-auto md:top-full md:mt-2 md:w-96 md:max-w-none md:mx-0 z-50 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl",
            align === "right" ? "md:right-0 md:left-auto" : "md:left-0 md:right-auto"
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Info className="h-4 w-4" />
              {t("queue.itemDetails")}
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("itemDetails.closeDetails")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-4 py-3 space-y-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t("common.title")}</div>
              <div className="font-semibold text-foreground truncate">{target.title}</div>
              <div className="text-xs text-muted-foreground capitalize">{t(`itemDetails.type.${target.type.replace("-", "")}`)}</div>
              {target.type === "rss" && target.source && (
                <div className="text-xs text-muted-foreground">{t("itemDetails.source")}: {target.source}</div>
              )}
            </div>

            {(localTags.length > 0 || target.category || canEditTags) && (
              <div className="space-y-1">
                {target.category && (
                  <div className="text-xs text-foreground/80">{t("itemDetails.category")}: {target.category}</div>
                )}
                <div className="flex flex-wrap items-center gap-1">
                  {localTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/60 text-xs text-foreground border border-border/50"
                    >
                      <button
                        type="button"
                        onClick={() => handleTagClick(tag)}
                        className="hover:underline"
                        title={t("itemDetails.viewItemsWithTag", { tag })}
                      >
                        {tag}
                      </button>
                      {canEditTags && (
                        <button
                          type="button"
                          onClick={() => void handleRemoveTag(tag)}
                          disabled={isSavingTag}
                          aria-label={t("itemDetails.removeTag", { tag })}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {canEditTags && (
                    <div className="inline-flex items-center gap-1">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={handleTagInputKeyDown}
                        placeholder={t("itemDetails.addTagPlaceholder")}
                        disabled={isSavingTag}
                        className="w-24 px-1.5 py-0.5 text-xs rounded border border-border/50 bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddTag()}
                        disabled={isSavingTag || !tagInput.trim()}
                        aria-label={t("itemDetails.addTag")}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs text-muted-foreground">
                {t("itemDetails.scheduling")} / {
                  details.algorithmType === "sm18" || (details.algorithmType !== "fsrs" && settings.learning.algorithm === "sm18")
                    ? "SM-18"
                    : details.algorithmType === "sm20" || (details.algorithmType !== "fsrs" && settings.learning.algorithm === "sm20")
                    ? "SM-20"
                    : "FSRS-6"
                }
              </div>
              {isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CircleNotch className="h-3.5 w-3.5 animate-spin" />
                  {t("itemDetails.loadingScheduling")}
                </div>
              ) : error ? (
                <div className="text-xs text-destructive">{error}</div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.stability")}</div>
                      <div className="font-semibold text-foreground">{formatMaybeNumber(details.stability)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.difficulty")}</div>
                      <div className="font-semibold text-foreground">{formatMaybeNumber(details.difficulty)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.retrievability")}</div>
                      <div className="font-semibold text-foreground">{formatMaybeNumber(details.retrievability)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.nextInterval")}</div>
                      <div className="font-semibold text-foreground">
                        {details.nextIntervalDays === null || details.nextIntervalDays === undefined
                          ? t("itemDetails.notAvailable")
                          : t("itemDetails.daysValue", { count: details.nextIntervalDays })}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.dueDate")}</div>
                      <div className="font-semibold text-foreground">{formatDate(details.dueDate)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.reps")}</div>
                      <div className="font-semibold text-foreground">{formatMaybeNumber(details.reps)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">{t("itemDetails.lapses")}</div>
                      <div className="font-semibold text-foreground">{formatMaybeNumber(details.lapses)}</div>
                    </div>
                  </div>

                  {target.type === "document" && details.intervalModifier != null && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-muted-foreground">Interval Modifier</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0.1"
                          max="5.0"
                          step="0.1"
                          value={localModifier}
                          onChange={(e) => setLocalModifier(e.target.value)}
                          onBlur={() => void handleSaveModifier()}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleSaveModifier(); }}
                          disabled={isSavingModifier}
                          className="w-20 px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                        />
                        <span className="text-xs text-muted-foreground">x</span>
                        {isSavingModifier && <CircleNotch className="w-3 h-3 animate-spin text-muted-foreground" />}
                        {parseFloat(localModifier) !== 1.0 && (
                          <button
                            type="button"
                            onClick={() => { setLocalModifier("1.0"); void handleSaveModifier(1.0); }}
                            className="text-[10px] text-muted-foreground hover:text-foreground underline"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      {(() => {
                        const v = parseFloat(localModifier);
                        if (!Number.isNaN(v) && (v <= 0.3 || v >= 3.0)) {
                          return <div className="text-[10px] text-amber-500">Extreme value — intervals will be significantly {v < 1 ? "shorter" : "longer"}</div>;
                        }
                        return null;
                      })()}
                    </div>
                  )}

                  {details.firstReviewedAt && (
                    <div className="text-xs">
                      <div className="text-muted-foreground">First Reviewed</div>
                      <div className="font-semibold text-foreground">{formatDate(details.firstReviewedAt)}</div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{t("itemDetails.previewIntervals")}</div>
                    {details.previewIntervals ? (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {([
                          ["again", t("queue.again")],
                          ["hard", t("queue.hard")],
                          ["good", t("queue.good")],
                          ["easy", t("queue.easy")],
                        ] as const).map(([key, label]) => (
                          <div key={key} className="rounded-md bg-muted/60 p-2">
                            <div className="text-muted-foreground">{label}</div>
                            <div className="font-semibold text-foreground">
                              {formatInterval(details.previewIntervals[key])}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{t("itemDetails.unavailable")}</div>
                    )}
                  </div>
                </>
              )}
            </div>

            {details.raw && (
              <div className="border-t border-border pt-3">
                <button
                  onClick={() => setShowRaw((prev) => !prev)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showRaw ? t("itemDetails.hideRawData") : t("itemDetails.showRawData")}
                </button>
                {showRaw && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-popover p-2 text-[10px] text-foreground">
{JSON.stringify(details.raw, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Common actions: dismiss (documents), postpone, delete */}
            {(target.type === "document" || onPostpone || onDelete) && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="text-xs text-muted-foreground">{t("itemDetails.commonActions")}</div>
                <div className="flex flex-col gap-2">
                  {target.type === "document" && (
                    <button
                      onClick={handleDismissToggle}
                      disabled={isUpdatingDismiss}
                      className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        details.isDismissed
                          ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                          : "bg-slate-500/10 text-slate-600 hover:bg-slate-500/20"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isUpdatingDismiss ? (
                        <CircleNotch className="w-4 h-4 animate-spin" />
                      ) : details.isDismissed ? (
                        <>
                          <Eye className="w-4 h-4" />
                          {t("itemDetails.undismiss")}
                        </>
                      ) : (
                        <>
                          <EyeSlash className="w-4 h-4" />
                          {t("itemDetails.dismiss")}
                        </>
                      )}
                    </button>
                  )}

                  {onPostpone && (
                    <button
                      onClick={() => void handlePostpone()}
                      disabled={isPostponing}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isPostponing ? (
                        <CircleNotch className="w-4 h-4 animate-spin" />
                      ) : (
                        <Calendar className="w-4 h-4" />
                      )}
                      {t("delete.postpone")}
                    </button>
                  )}

                  {onDelete && (
                    <button
                      onClick={() => void handleDelete()}
                      disabled={isDeleting}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isDeleting ? (
                        <CircleNotch className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash className="w-4 h-4" />
                      )}
                      {t("common.delete")}
                    </button>
                  )}
                </div>
                {target.type === "document" && (
                  <p className="text-xs text-muted-foreground text-center">
                    {details.isDismissed
                      ? t("itemDetails.hiddenButSearchable")
                      : t("itemDetails.dismissedRemainSearchable")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
