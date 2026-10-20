import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CaretDown, CaretUp, TextT } from "@phosphor-icons/react";
import {
  formatFeedDate,
  generateArticleExcerpt,
  getFeedIcon,
  type Feed,
  type FeedItem,
} from "../../api/rss";
import {
  resolveRssPreferences,
  type RssUserPreferenceUpdate,
} from "../../types/rssCustomization";
import { useI18n } from "../../lib/i18n";
import { iconButtonVariants } from "../md3/IconButton";
import { cn } from "../../utils";
import { IntelligenceIndicator } from "./IntelligenceIndicator";

/** Deliberate fine-pointer dwell before a List card reveals its details. */
export const RSS_LIST_HOVER_DELAY_MS = 120;

const DENSITY_CLASS: Record<string, string> = {
  compact: "rss-list-card--compact",
  normal: "rss-list-card--normal",
  comfortable: "rss-list-card--comfortable",
};

export interface RSSListArticleCardProps {
  feed: Feed;
  item: FeedItem;
  preferences: RssUserPreferenceUpdate | null;
  selected: boolean;
  index: number;
  start: number;
  isScrolling: boolean;
  measureElement: (node: HTMLDivElement | null) => void;
  actions: React.ReactNode;
  onSelect: (feed: Feed, item: FeedItem) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMenuKeyDown: (event: React.KeyboardEvent) => void;
}

function imageUrlFor(item: FeedItem): string | undefined {
  return (
    item.thumbnail ||
    (item.enclosure?.type?.startsWith("image/") ? item.enclosure.url : undefined) ||
    undefined
  );
}

function finePointerAvailable(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  } catch {
    return true;
  }
}

function hasValidDate(value?: string | null): boolean {
  if (!value) return false;
  return Number.isFinite(Date.parse(value));
}

function matchesFocusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

function RSSListArticleCardImpl({
  feed,
  item,
  preferences,
  selected,
  index,
  start,
  isScrolling,
  measureElement,
  actions,
  onSelect,
  onContextMenu,
  onMenuKeyDown,
}: RSSListArticleCardProps) {
  const { t } = useI18n();
  const resolved = useMemo(() => resolveRssPreferences(preferences ?? {}), [preferences]);
  const viewMode = resolved.view_mode ?? "card";
  const density = resolved.density ?? "normal";
  const cardHeight = resolved.card_height ?? "normal";
  const showThumbnails = resolved.show_thumbnails ?? true;
  const showAuthor = resolved.show_author ?? true;
  const showDate = resolved.show_date ?? true;
  const showFeedIcon = resolved.show_feed_icon ?? true;
  const thumbnailSize = resolved.thumbnail_size ?? "small";
  const excerptLength = resolved.excerpt_length ?? 150;

  const articleRef = useRef<HTMLElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const dwellTimer = useRef<number | null>(null);
  const pointerInside = useRef(false);
  const pointerDown = useRef(false);
  const keyboardIntent = useRef(false);
  const lastPointerPoint = useRef<{ x: number; y: number } | null>(null);

  const [hoverActive, setHoverActive] = useState(false);
  const [keyboardWithin, setKeyboardWithin] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const detailsId = useId();
  const expanded = !dismissed && (hoverActive || keyboardWithin || pinned);

  const imageUrl = imageUrlFor(item);
  const showThumbnail =
    showThumbnails && viewMode !== "compact" && Boolean(imageUrl) && !imageFailed;

  const excerptSource = item.fullContent || item.description || item.content || "";
  const excerpt = useMemo(
    () => (excerptSource ? generateArticleExcerpt(excerptSource, excerptLength) : ""),
    [excerptSource, excerptLength],
  );

  const excerptLines =
    cardHeight === "compact" ? 0 : viewMode === "compact" ? 2 : cardHeight === "tall" ? 4 : 3;
  const showExcerpt = expanded && excerptLines > 0 && Boolean(excerpt);
  const showAuthorLine = expanded && showAuthor && Boolean(item.author);
  const relativeDate = hasValidDate(item.pubDate) ? formatFeedDate(item.pubDate) : null;
  const feedIcon = showFeedIcon ? getFeedIcon(feed) : undefined;

  const isLargeCardImage = viewMode === "card" && thumbnailSize === "large";
  const thumbnailKind = isLargeCardImage
    ? "card-large"
    : viewMode === "list"
      ? thumbnailSize === "large"
        ? "list-large"
        : "list-small"
      : "card-small";

  const intelligenceScore = item.intelligenceScore;
  const intelligenceTone =
    intelligenceScore == null || intelligenceScore === 0
      ? "Neutral"
      : intelligenceScore > 0
        ? "Positive"
        : "Negative";
  const intelligenceLabel =
    intelligenceTone === "Neutral"
      ? t("rssReader.intelligenceNeutral")
      : t(`rssReader.intelligence${intelligenceTone}`, {
          score: (intelligenceScore ?? 0).toFixed(1),
        });

  const clearDwell = useCallback(() => {
    if (dwellTimer.current !== null) {
      window.clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
  }, []);

  // A recycled row must never inherit disclosure or a pending timer.
  useEffect(() => {
    pointerInside.current = false;
    pointerDown.current = false;
    keyboardIntent.current = false;
    lastPointerPoint.current = null;
    clearDwell();
    setHoverActive(false);
    setKeyboardWithin(false);
    setPinned(false);
    setDismissed(false);
    setImageFailed(false);
  }, [feed.id, item.id, clearDwell]);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  useEffect(
    () => () => {
      clearDwell();
    },
    [clearDwell],
  );

  useEffect(() => {
    if (!isScrolling) return;
    clearDwell();
    setHoverActive(false);
  }, [isScrolling, clearDwell]);

  const setRowRef = useCallback(
    (node: HTMLDivElement | null) => {
      rowRef.current = node;
      measureElement(node);
    },
    [measureElement, index],
  );

  useLayoutEffect(() => {
    if (rowRef.current) measureElement(rowRef.current);
  }, [
    expanded,
    resolved,
    item.title,
    excerpt,
    item.author,
    item.read,
    Boolean(item.fullContent),
    imageFailed,
    measureElement,
    index,
  ]);

  const dismiss = useCallback(() => {
    clearDwell();
    setHoverActive(false);
    setPinned(false);
    setDismissed(true);
  }, [clearDwell]);

  const handlePointerLeave = () => {
    pointerInside.current = false;
    lastPointerPoint.current = null;
    clearDwell();
    setHoverActive(false);
    if (!keyboardWithin && !pinned) setDismissed(false);
  };

  const handlePointerEnter = () => {
    pointerInside.current = true;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    pointerInside.current = true;
    if (event.pointerType !== "mouse" || !finePointerAvailable()) return;
    if (isScrolling) {
      clearDwell();
      setHoverActive(false);
      return;
    }
    if (hoverActive || pinned || dismissed || dwellTimer.current !== null) return;
    const previous = lastPointerPoint.current;
    const moved =
      !previous || previous.x !== event.clientX || previous.y !== event.clientY;
    lastPointerPoint.current = { x: event.clientX, y: event.clientY };
    if (!moved) return;
    dwellTimer.current = window.setTimeout(() => {
      dwellTimer.current = null;
      if (pointerInside.current) setHoverActive(true);
    }, RSS_LIST_HOVER_DELAY_MS);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    pointerDown.current = true;
    const target = event.target;
    const onDetailsToggle =
      target instanceof Element && Boolean(target.closest(".rss-list-details-toggle"));
    // The details toggle owns explicit disclosure; clearing keyboard intent
    // before its click would make an already expanded card look collapsed and
    // the click would immediately reopen it.
    if (!onDetailsToggle) {
      keyboardIntent.current = false;
      setKeyboardWithin(false);
    }
  };

  const handlePointerUp = () => {
    pointerDown.current = false;
  };

  const applyKeyboardIntent = () => {
    setKeyboardWithin(true);
    setDismissed(false);
  };

  const handleFocusCapture = (event: React.FocusEvent<HTMLElement>) => {
    const article = articleRef.current;
    if (!article) return;
    const related = event.relatedTarget as Node | null;
    const entering = !related || !article.contains(related);
    if (!entering) {
      // Tab between controls keeps focus within the card; it must not clear a
      // dismissal applied to the focused control.
      if (keyboardIntent.current) setKeyboardWithin(true);
      keyboardIntent.current = false;
      return;
    }
    const focusVisible = matchesFocusVisible(event.target as Element);
    if (pointerDown.current && !focusVisible) {
      keyboardIntent.current = false;
      return;
    }
    applyKeyboardIntent();
    keyboardIntent.current = false;
  };

  const handleBlurCapture = (event: React.FocusEvent<HTMLElement>) => {
    const article = articleRef.current;
    if (!article) return;
    const related = event.relatedTarget as Node | null;
    if (related && article.contains(related)) return;
    setKeyboardWithin(false);
    setPinned(false);
    setDismissed(false);
  };

  const handleKeyDownCapture = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") keyboardIntent.current = true;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }
  };

  const handleTitleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect(feed, item);
  };

  const handleArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        "button, a[href], input, select, textarea, [role='button'], [data-rss-list-actions]",
      )
    ) {
      return;
    }
    onSelect(feed, item);
  };

  const handleToggleDetails = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (expanded) {
      dismiss();
    } else {
      clearDwell();
      setDismissed(false);
      setPinned(true);
    }
  };

  return (
    <div
      ref={setRowRef}
      data-index={index}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${start}px)`,
      }}
    >
      <article
        ref={articleRef}
        data-article-id={item.id}
        data-rss-list-card
        data-expanded={expanded ? "true" : "false"}
        data-density={density}
        data-view-mode={viewMode}
        data-selected={selected ? "true" : "false"}
        data-read={item.read ? "true" : "false"}
        onClick={handleArticleClick}
        onContextMenu={onContextMenu}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerLeave}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        onKeyDownCapture={handleKeyDownCapture}
        onKeyDown={handleKeyDown}
        className={cn("rss-list-card", DENSITY_CLASS[density] ?? DENSITY_CLASS.normal)}
      >
        <header className="rss-list-header">
          <h3 className="rss-list-title-row">
            <button
              type="button"
              className="rss-list-title"
              title={item.title}
              onClick={handleTitleClick}
              onKeyDown={onMenuKeyDown}
            >
              {item.title}
            </button>
          </h3>
          <div
            className="rss-list-actions"
            data-rss-list-actions
            role="group"
            aria-label={t("rssReader.articleActions")}
          >
            {actions}
            <button
              type="button"
              className={cn(
                iconButtonVariants({ size: "md" }),
                "rss-list-control rss-list-details-toggle",
              )}
              aria-label={
                expanded ? t("rssReader.hideArticleDetails") : t("rssReader.showArticleDetails")
              }
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={handleToggleDetails}
              onKeyDown={onMenuKeyDown}
            >
              {expanded ? (
                <CaretUp className="rss-list-control-icon" aria-hidden="true" />
              ) : (
                <CaretDown className="rss-list-control-icon" aria-hidden="true" />
              )}
            </button>
          </div>
        </header>

        <div
          className="rss-list-body"
          data-thumbnail={showThumbnail ? (isLargeCardImage ? "above" : "beside") : "none"}
        >
          {showThumbnail && imageUrl && (
            <div
              className={`rss-list-thumb rss-list-thumb--${thumbnailKind}`}
              data-thumbnail-size={thumbnailSize}
            >
              <img
                src={imageUrl}
                alt=""
                loading="lazy"
                onError={() => setImageFailed(true)}
              />
            </div>
          )}
          <div className="rss-list-body-main">
            <div className="rss-list-source">
              <span
                className="rss-list-status-dot"
                data-read={item.read ? "true" : "false"}
                aria-hidden="true"
              />
              <span className="sr-only">
                {item.read
                  ? t("rssReader.readArticleStatus")
                  : t("rssReader.unreadArticleStatus")}
              </span>
              <span className="rss-list-intelligence" role="img" aria-label={intelligenceLabel}>
                <IntelligenceIndicator score={intelligenceScore} />
              </span>
              {feedIcon && (
                <img
                  src={feedIcon}
                  alt=""
                  className="rss-list-feed-icon"
                  loading="lazy"
                />
              )}
              <span className="rss-list-feed-title">{feed.title}</span>
              {showDate && relativeDate && (
                <>
                  <span className="rss-list-meta-separator" aria-hidden="true">
                    ·
                  </span>
                  <time className="rss-list-date" dateTime={item.pubDate}>
                    {relativeDate}
                  </time>
                </>
              )}
              {item.fullContent && (
                <span className="rss-list-full-badge">
                  <TextT className="rss-list-full-badge-icon" aria-hidden="true" />
                  Full
                </span>
              )}
            </div>
            <div id={detailsId} className="rss-list-details" hidden={!expanded}>
              {showExcerpt && (
                <p
                  className={cn("rss-list-excerpt", `rss-list-excerpt--${excerptLines}`)}
                >
                  {excerpt}
                </p>
              )}
              {showAuthorLine && <p className="rss-list-author">by {item.author}</p>}
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

export const RSSListArticleCard = memo(RSSListArticleCardImpl);
