/**
 * SiteBySiteTraining
 * Walkthrough mode stepping through feeds with trainable highlights.
 *
 * Uses useTrainFeedback for consistent sound + haptic feedback.
 */

import { useState, useCallback } from "react";
import {
  SkipForward,
  ThumbsDown,
  ThumbsUp,
  X,
} from "@phosphor-icons/react";
import { useTrainFeedback } from "../../hooks/useTrainFeedback";
import { useI18n } from "../../lib/i18n";
import type { Feed } from "../../api/rss";
import { sanitizeHtml } from "../common/RichContentRenderer";

interface SiteBySiteTrainingProps {
  feeds: Feed[];
  onClose: () => void;
}

export function SiteBySiteTraining({ feeds, onClose }: SiteBySiteTrainingProps) {
  const { t } = useI18n();
  const [currentFeedIndex, setCurrentFeedIndex] = useState(0);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);

  const currentFeed = feeds[currentFeedIndex];
  const articles = currentFeed?.items || [];
  const currentItem = articles[currentItemIndex];

  const hasMoreItems = currentItemIndex < articles.length - 1;
  const hasMoreFeeds = currentFeedIndex < feeds.length - 1;

  const advance = useCallback(() => {
    if (hasMoreItems) {
      setCurrentItemIndex((i) => i + 1);
    } else if (hasMoreFeeds) {
      setCurrentFeedIndex((i) => i + 1);
      setCurrentItemIndex(0);
    }
  }, [hasMoreItems, hasMoreFeeds]);

  // Sound + haptic feedback via the shared hook; suppress the toast since the
  // walkthrough has its own on-screen progression feedback.
  const { trainClassifier } = useTrainFeedback({ silentToast: true, onSuccess: advance });

  const handleTrain = (sentiment: "like" | "dislike") => {
    if (!currentFeed || !currentItem || !currentItem.author) {
      advance();
      return;
    }
    void trainClassifier({
      feedId: currentFeed.id,
      classifierType: "author",
      value: currentItem.author,
      sentiment,
    });
  };

  if (!currentFeed || !currentItem) {
    return (
      <div className="h-full flex items-center justify-center bg-card">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-2">{t("siteBySite.complete")}</p>
          <p className="text-sm text-muted-foreground mb-4">
            {t("siteBySite.completeDescription")}
          </p>
          <button onClick={onClose} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            {t("siteBySite.done")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{currentFeed.title}</span>
          <span className="mx-2">·</span>
          {currentFeedIndex + 1}/{feeds.length}
          <span className="mx-2">·</span>
          {t("siteBySite.feedProgress", { current: currentItemIndex + 1, total: articles.length })}
        </div>
        <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-xl mx-auto">
          <article className="mb-8">
            <h2 className="text-xl font-semibold text-foreground mb-2">{currentItem.title}</h2>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
              {currentItem.author && <span>{t("siteBySite.by", { author: currentItem.author })}</span>}
              <span>{currentItem.pubDate && new Date(currentItem.pubDate).toLocaleDateString()}</span>
            </div>
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentItem.description || currentItem.content) }}
            />
          </article>

          {/* Training actions */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => handleTrain("dislike")}
              className="px-6 py-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-xl flex items-center gap-2 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors active:scale-95"
            >
              <ThumbsDown className="w-5 h-5" />
              {t("siteBySite.dislike")}
            </button>
            <button
              onClick={advance}
              className="px-4 py-3 bg-muted text-muted-foreground rounded-xl flex items-center gap-2 hover:bg-muted/80 transition-colors active:scale-95"
            >
              <SkipForward className="w-5 h-5" />
              {t("siteBySite.skip")}
            </button>
            <button
              onClick={() => handleTrain("like")}
              className="px-6 py-3 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded-xl flex items-center gap-2 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors active:scale-95"
            >
              <ThumbsUp className="w-5 h-5" />
              {t("siteBySite.like")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
