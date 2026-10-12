import { formatFeedDate, generateArticleExcerpt, type FeedItem, type Feed } from "../../api/rss";
import { Star } from "@phosphor-icons/react";
import { IntelligenceIndicator } from "./IntelligenceIndicator";
import { resolveRssPreferences, type RssUserPreferenceUpdate } from "../../types/rssCustomization";

interface ArticleLayoutProps {
  items: Array<{ feed: Feed; item: FeedItem }>;
  onSelect: (feed: Feed, item: FeedItem) => void;
  onToggleFavorite?: (feed: Feed, item: FeedItem) => void;
  selectedItemId?: string;
  preferences?: RssUserPreferenceUpdate | null;
  columnCount?: number;
  showThumbnails?: boolean;
  showAuthor?: boolean;
  showDate?: boolean;
  excerptLength?: number;
  onContextMenuEntry?: (feed: Feed, item: FeedItem, e: React.MouseEvent) => void;
  onMenuKeyDown?: (feed: Feed, item: FeedItem, e: React.KeyboardEvent) => void;
}

function ArticleCards(props: ArticleLayoutProps & { magazine: boolean }) {
  const {
    items,
    onSelect,
    onToggleFavorite,
    selectedItemId,
    onContextMenuEntry,
    onMenuKeyDown,
    magazine,
  } = props;
  const p = resolveRssPreferences(props.preferences ?? {}, {
    column_count: props.columnCount,
    show_thumbnails: props.showThumbnails,
    show_author: props.showAuthor,
    show_date: props.showDate,
    excerpt_length: props.excerptLength,
  });
  const compact = p.view_mode === "compact";
  const padding = p.density === "compact" ? "p-2" : p.density === "comfortable" ? "p-5" : "p-3";
  return (
    <div
      className={`rss-article-grid ${magazine ? "rss-magazine" : ""} p-4`}
      style={
        {
          "--rss-columns": p.column_count,
          gap: p.density === "compact" ? 8 : p.density === "comfortable" ? 24 : 16,
        } as React.CSSProperties
      }
    >
      {items.map(({ feed, item }) => {
        const image =
          item.thumbnail ||
          (item.enclosure?.type?.startsWith("image/") ? item.enclosure.url : undefined);
        const large = p.thumbnail_size === "large" && p.view_mode === "card";
        return (
          <article
            key={`${feed.id}-${item.id}`}
            data-article-id={item.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(feed, item)}
            onContextMenu={
              onContextMenuEntry ? (e) => onContextMenuEntry(feed, item, e) : undefined
            }
            onKeyDown={(e) => {
              onMenuKeyDown?.(feed, item, e);
              if (e.key === "Enter" && !e.defaultPrevented) onSelect(feed, item);
            }}
            className={`bg-card border rounded-xl overflow-hidden cursor-pointer hover:border-primary/50 min-w-0 ${selectedItemId === item.id ? "ring-2 ring-primary" : "border-border/50"}`}
          >
            <div className={`${padding} flex ${large ? "flex-col" : "items-start"} gap-3`}>
              {!compact && p.show_thumbnails && image && (
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  className={`${large ? "w-full aspect-video" : "w-16 h-12 shrink-0"} object-cover rounded-md`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  {p.show_feed_icon && (feed.icon || feed.imageUrl) && (
                    <img src={feed.icon || feed.imageUrl} alt="" className="w-4 h-4 rounded-sm" />
                  )}
                  <span className="truncate">{feed.title}</span>
                  <IntelligenceIndicator score={item.intelligenceScore} />
                </div>
                <h3
                  className={`${magazine ? "text-base" : "text-sm"} font-semibold text-foreground line-clamp-2`}
                >
                  {item.title}
                </h3>
                {!compact && p.card_height !== "compact" && (
                  <p
                    className={`text-sm text-muted-foreground mt-2 ${p.card_height === "tall" ? "line-clamp-6" : "line-clamp-2"}`}
                  >
                    {generateArticleExcerpt(
                      item.fullContent || item.content || item.description || "",
                      p.excerpt_length ?? 150
                    )}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-2">
                  {p.show_author && item.author && <span>by {item.author}</span>}
                  {p.show_date && <span>{formatFeedDate(item.pubDate)}</span>}
                  {onToggleFavorite && (
                    <button
                      aria-label={item.favorite ? "Remove favorite" : "Add favorite"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(feed, item);
                      }}
                      className="p-1 rounded hover:bg-muted"
                    >
                      <Star
                        className={`w-4 h-4 ${item.favorite ? "text-yellow-500 fill-yellow-500" : ""}`}
                      />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
export function MagazineLayout(props: ArticleLayoutProps) {
  return <ArticleCards {...props} magazine />;
}
export function GridLayout(props: ArticleLayoutProps) {
  return <ArticleCards {...props} magazine={false} />;
}
