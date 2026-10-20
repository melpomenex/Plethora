import { rssReadingStyle, type RssUserPreferenceUpdate } from "../../types/rssCustomization";
/**
 * StoryView
 * Single-article focused reading with minimal chrome, next/prev navigation
 */

import { useCallback, useMemo } from "react";
import {
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  Clock,
  LinkSimple,
  Star,
  User,
} from "@phosphor-icons/react";
import { formatFeedDate, type FeedItem, type Feed } from "../../api/rss";
import { openExternal } from "../../lib/tauri";
import { copyShareLink } from "../../lib/shareLink";
import { stripTrackingParams } from "../../lib/cleanUrl";
import { useToast } from "../common/Toast";
import { useRssSelectionMenu } from "./useRssSelectionMenu";
import { sanitizeHtml } from "../common/RichContentRenderer";
import { IntelligenceIndicator } from "./IntelligenceIndicator";

interface StoryViewProps {
  preferences?: RssUserPreferenceUpdate | null;
  item: FeedItem;
  feed: Feed;
  items: FeedItem[];
  onSelectItem: (item: FeedItem) => void;
  onToggleFavorite: (feed: Feed, item: FeedItem) => void;
}

export function StoryView({
  item,
  feed,
  items,
  onSelectItem,
  onToggleFavorite,
  preferences,
}: StoryViewProps) {
  const toast = useToast();
  // Text-selection menu with the same actions as document viewing.
  const selection = useRssSelectionMenu(feed, item);
  // Keep the DOM nodes that hold the article text stable across menu-only
  // rerenders. A fresh `{ __html }` object every render makes React reset
  // `innerHTML`, which silently collapses the native selection while the
  // selection menu is opening.
  const articleHtml = useMemo(
    () => ({
      __html: sanitizeHtml(item.fullContent || item.description || item.content),
    }),
    [item.fullContent, item.description, item.content],
  );
  const currentIndex = items.findIndex((i) => i.id === item.id);
  const hasNext = currentIndex < items.length - 1;
  const hasPrev = currentIndex > 0;

  const goNext = useCallback(() => {
    if (hasNext) onSelectItem(items[currentIndex + 1]);
  }, [hasNext, currentIndex, items, onSelectItem]);

  const goPrev = useCallback(() => {
    if (hasPrev) onSelectItem(items[currentIndex - 1]);
  }, [hasPrev, currentIndex, items, onSelectItem]);

  const handleCopyLink = useCallback(async () => {
    const rawUrl = item.link || item.guid;
    if (!rawUrl) return;
    const ok = await copyShareLink(stripTrackingParams(rawUrl));
    if (ok) toast.success("Link copied", "Clean article link copied to clipboard");
    else toast.error("Failed to copy link");
  }, [item.link, item.guid, toast]);

  return (
    <div className="h-full flex flex-col bg-background" style={rssReadingStyle(preferences)}>
      {/* Minimal toolbar */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border/50">
        <button
          onClick={goPrev}
          disabled={!hasPrev}
          className="p-2 text-muted-foreground hover:text-foreground rounded-lg disabled:opacity-30 transition-colors"
        >
          <CaretLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{currentIndex + 1} / {items.length}</span>
        </div>
        <button
          onClick={goNext}
          disabled={!hasNext}
          className="p-2 text-muted-foreground hover:text-foreground rounded-lg disabled:opacity-30 transition-colors"
        >
          <CaretRight className="w-4 h-4" />
        </button>
      </div>

      {/* Article content */}
      <div className="flex-1 overflow-auto">
        <article className="rss-reading-width px-4 sm:px-8 py-10">
          <header className="mb-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              {preferences?.show_feed_icon !== false && (feed.icon || feed.imageUrl) && (
                <img src={feed.icon || feed.imageUrl} alt="" className="w-4 h-4 rounded-sm" />
              )}
              <span className="font-medium">{feed.title}</span>
              <IntelligenceIndicator />
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight mb-4">{item.title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {preferences?.show_author !== false && item.author && (
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {item.author}
                </span>
              )}
              {preferences?.show_date !== false && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatFeedDate(item.pubDate)}
                </span>
              )}
            </div>
          </header>

          {/* Content */}
          <div
            ref={selection.contentRef}
            className="rss-reading-prose prose prose-sm dark:prose-invert max-w-none leading-relaxed"
            onContextMenu={selection.handleContextMenu}
            onMouseDown={selection.handleMouseDown}
            dangerouslySetInnerHTML={articleHtml}
          />

          {/* Actions */}
          <div className="flex items-center gap-2 mt-8 pt-6 border-t border-border/50">
            <button
              onClick={() => onToggleFavorite(feed, item)}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 transition-colors ${
                item.favorite
                  ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <Star className={`w-4 h-4 ${item.favorite ? "fill-yellow-500" : ""}`} />
              {item.favorite ? "Saved" : "Save"}
            </button>
            <a
              href={item.link}
              onClick={(e) => {
                e.preventDefault();
                void openExternal(item.link);
              }}
              className="px-3 py-1.5 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 flex items-center gap-1.5 transition-colors"
            >
              <ArrowSquareOut className="w-4 h-4" />
              Original
            </a>
            <button
              onClick={() => void handleCopyLink()}
              className="px-3 py-1.5 text-sm bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 flex items-center gap-1.5 transition-colors"
            >
              <LinkSimple className="w-4 h-4" />
              Copy Link
            </button>
          </div>
        </article>
      </div>
      {selection.overlays}
    </div>
  );
}
