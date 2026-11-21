import type React from "react";
import { useId, useState } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  Check,
  PencilSimple,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  SmartFeedMatchDecision,
  SmartFeedProgress,
  SmartFeedSortOrder,
  SmartFeedWithStats,
} from "../../../api/rss-smart-feeds";
import { useI18n } from "../../../lib/i18n";

export interface SmartFeedHeaderBarProps {
  feed: SmartFeedWithStats;
  progress?: SmartFeedProgress;
  bucket: SmartFeedMatchDecision;
  sortOrder: SmartFeedSortOrder;
  groupSimilarStories: boolean;
  onBucketChange: (bucket: SmartFeedMatchDecision) => void;
  onSortOrderChange: (sortOrder: SmartFeedSortOrder) => void;
  onToggleGroupStories: () => void;
  onRefresh: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isMobile?: boolean;
  onBackToFeeds?: () => void;
}

const BUCKETS: SmartFeedMatchDecision[] = ["INCLUDE", "UNCERTAIN", "EXCLUDE", "PENDING"];

export function SmartFeedHeaderBar({
  feed,
  progress,
  bucket,
  sortOrder,
  groupSimilarStories,
  onBucketChange,
  onSortOrderChange,
  onToggleGroupStories,
  onRefresh,
  onCancel,
  onEdit,
  onDelete,
  isMobile,
  onBackToFeeds,
}: SmartFeedHeaderBarProps) {
  const { t } = useI18n();
  const sortSelectId = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isRunning = progress?.phase === "running";
  const bucketLabel = (b: SmartFeedMatchDecision) => {
    switch (b) {
      case "INCLUDE":
        return `${t("smartFeeds.bucketMatched")} (${feed.matched_count})`;
      case "UNCERTAIN":
        return `${t("smartFeeds.bucketUncertain")} (${feed.uncertain_count})`;
      case "EXCLUDE":
        return `${t("smartFeeds.bucketExcluded")} (${feed.excluded_count})`;
      case "PENDING":
        return `${t("smartFeeds.bucketPending")} (${feed.pending_count})`;
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = BUCKETS.indexOf(bucket);
    if (idx === -1) return;
    let nextIdx = -1;
    if (event.key === "ArrowRight") nextIdx = (idx + 1) % BUCKETS.length;
    else if (event.key === "ArrowLeft") nextIdx = (idx - 1 + BUCKETS.length) % BUCKETS.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = BUCKETS.length - 1;
    if (nextIdx >= 0) {
      event.preventDefault();
      onBucketChange(BUCKETS[nextIdx]);
    }
  };

  return (
    <div className="space-y-3" data-testid="smart-feed-header">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {isMobile && onBackToFeeds && (
            <button
              type="button"
              onClick={onBackToFeeds}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-lg shrink-0"
              aria-label={t("smartFeeds.backToFeeds")}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-1.5 truncate">
              <Sparkle className="w-4 h-4 text-primary shrink-0" weight="fill" aria-hidden="true" />
              <span className="truncate">{feed.name}</span>
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {feed.description}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-muted-foreground">
              <span>{t("smartFeeds.sourceFeedsCount", { count: feed.source_feed_count })}</span>
              {feed.lexical_only_count > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  {t("smartFeeds.lexicalModeBadge")}
                </span>
              )}
              {!feed.is_enabled && (
                <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {t("smartFeeds.pausedBadge")}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-border bg-muted/60 hover:bg-destructive/15 hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              {t("common.cancel")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onRefresh}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-lg"
              title={t("smartFeeds.reevaluate")}
              aria-label={t("smartFeeds.reevaluate")}
            >
              <ArrowsClockwise className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-lg"
            title={t("common.edit")}
            aria-label={t("smartFeeds.editFeedAction")}
          >
            <PencilSimple className="w-4 h-4" aria-hidden="true" />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete();
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                {t("common.confirm")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
                aria-label={t("common.cancel")}
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-2 text-destructive hover:bg-destructive/15 rounded-lg"
              title={t("common.delete")}
              aria-label={t("smartFeeds.deleteFeedAction")}
            >
              <Trash className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {isRunning && progress && (
        <div
          className="p-2.5 rounded-lg border border-primary/30 bg-primary/5 space-y-1"
          role="status"
          aria-live="polite"
        >
          <progress
            value={progress.evaluated}
            max={Math.max(1, progress.total)}
            aria-label={t("smartFeeds.evaluatingProgress", { name: feed.name })}
            className="w-full h-1.5 rounded overflow-hidden accent-primary"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {t("smartFeeds.progressSummary", {
                evaluated: progress.evaluated,
                total: progress.total,
              })}
            </span>
            <span>
              {t("smartFeeds.progressRemaining", { remaining: progress.remaining })}
            </span>
          </div>
        </div>
      )}

      <div
        role="tablist"
        aria-label={t("smartFeeds.bucketTabsLabel")}
        onKeyDown={handleTabKeyDown}
        className="flex flex-wrap items-center gap-1 bg-muted/50 p-1 rounded-lg"
      >
        {BUCKETS.map((b) => {
          const selected = bucket === b;
          return (
            <button
              key={b}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onBucketChange(b)}
              className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {bucketLabel(b)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor={sortSelectId} className="text-muted-foreground">
            {t("smartFeeds.sortByLabel")}
          </label>
          <select
            id={sortSelectId}
            value={sortOrder}
            onChange={(e) => onSortOrderChange(e.target.value as SmartFeedSortOrder)}
            className="px-2 py-1 rounded-md border border-border bg-background text-foreground text-xs"
          >
            <option value="relevance">{t("smartFeeds.sortRelevance")}</option>
            <option value="newest">{t("smartFeeds.sortNewest")}</option>
            <option value="oldest">{t("smartFeeds.sortOldest")}</option>
            <option value="unread_first">{t("smartFeeds.sortUnreadFirst")}</option>
          </select>
        </div>

        <button
          type="button"
          aria-pressed={groupSimilarStories}
          onClick={onToggleGroupStories}
          className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
            groupSimilarStories
              ? "border-primary/50 bg-primary/10 text-primary font-medium"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("smartFeeds.groupSimilarStories")}
        </button>
      </div>
    </div>
  );
}
