import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowSquareOut,
  Download,
  EyeSlash,
  GraduationCap,
  Star,
  Tag,
} from "@phosphor-icons/react";
import "../index.css";
import { ThemeProvider, useTheme } from "../contexts/ThemeContext";
import { PresentationProvider } from "../contexts/PresentationContext";
import { RSSCustomizationPanel } from "../components/media/RSSCustomizationPanel";
import { RSSReader } from "../components/media/RSSReader";
import { RSSListArticleCard } from "../components/media/RSSListArticleCard";
import { RSSFullContentView } from "../components/media/RSSFullContentView";
import { RSSScrollMode } from "../components/media/RSSScrollMode";
import { StoryView } from "../components/media/StoryView";
import { MagazineLayout, GridLayout } from "../components/media/ArticleLayouts";
import { iconButtonVariants } from "../components/md3/IconButton";
import { cn } from "../utils";
import {
  RSS_DEFAULTS,
  rssReadingStyle,
  type RssUserPreferenceUpdate,
} from "../types/rssCustomization";
import type { Feed, FeedItem } from "../api/rss";
import { setRssPreferencesViaHttp, getRssPreferencesViaHttp } from "../api/rss";

const fixtureThumbnail =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='steelblue'/%3E%3C/svg%3E";

const itemSeed = {
  id: "article-a",
  feedId: "feed-a",
  title: "Alpha article",
  author: "Jane",
  pubDate: "2026-10-01",
  read: false,
  favorite: false,
  categories: ["science"],
  description: "<p>Article paragraph for reading appearance verification.</p>",
  content: "<p>Article paragraph for reading appearance verification.</p>",
  fullContent: "<p>Article paragraph for reading appearance verification.</p>",
  link: "https://example.com/article",
  thumbnail: fixtureThumbnail,
} satisfies FeedItem;

const feed = {
  id: "feed-a",
  title: "Science Feed",
  items: [itemSeed],
  icon: fixtureThumbnail,
  feedUrl: "https://example.com/rss",
  link: "https://example.com",
  description: "Science",
  lastUpdated: "2026-10-01",
  lastFetched: "2026-10-01",
  updateInterval: 60,
  subscribeDate: "2026-01-01",
  unreadCount: 1,
} as Feed;

type RecordedAction = {
  type: string;
  itemId?: string;
  feedId?: string;
  key?: string;
};

interface HarnessApi {
  setPreferences: (patch: RssUserPreferenceUpdate) => void;
  setView: (view: string) => void;
  reload: () => Promise<void>;
  setListWidth: (width: number) => void;
  setCardFixture: (patch: Partial<FeedItem>) => void;
  setTheme: (id: string) => void;
  getThemes: () => string[];
  getActions: () => RecordedAction[];
  resetActions: () => void;
}

function ListCardActions({
  item,
  record,
}: {
  item: FeedItem;
  record: (action: RecordedAction) => void;
}) {
  const stop =
    (type: string) =>
    (event: React.MouseEvent) => {
      event.stopPropagation();
      record({ type, itemId: item.id });
    };
  return (
    <>
      {!item.fullContent && (
        <button
          type="button"
          aria-label="Fetch full content"
          title="Fetch full content"
          className={cn(iconButtonVariants({ size: "md" }), "rss-list-control")}
          onClick={stop("fetch")}
        >
          <Download className="rss-list-control-icon" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        aria-label={item.favorite ? "Remove favorite" : "Add to favorites"}
        aria-pressed={item.favorite}
        className={cn(iconButtonVariants({ size: "md" }), "rss-list-control")}
        onClick={stop("favorite")}
      >
        <Star className="rss-list-control-icon" aria-hidden="true" />
      </button>
      <a
        href={item.link}
        aria-label="Open original"
        title="Open original"
        className={cn(iconButtonVariants({ size: "md" }), "rss-list-control")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          record({ type: "external", itemId: item.id });
        }}
      >
        <ArrowSquareOut className="rss-list-control-icon" aria-hidden="true" />
      </a>
      {item.read && (
        <button
          type="button"
          aria-label="Mark as unread"
          title="Mark as unread"
          className={cn(iconButtonVariants({ size: "md" }), "rss-list-control")}
          onClick={stop("unread")}
        >
          <EyeSlash className="rss-list-control-icon" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        aria-label="Train intelligence"
        title="Train intelligence"
        className={cn(iconButtonVariants({ size: "md" }), "rss-list-control")}
        onClick={stop("train")}
      >
        <GraduationCap className="rss-list-control-icon" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Tag article"
        title="Tag article"
        className={cn(iconButtonVariants({ size: "md" }), "rss-list-control")}
        onClick={stop("tag")}
      >
        <Tag className="rss-list-control-icon" aria-hidden="true" />
      </button>
    </>
  );
}

function ListCardFixture({
  item,
  preferences,
  width,
  record,
}: {
  item: FeedItem;
  preferences: RssUserPreferenceUpdate;
  width: number;
  record: (action: RecordedAction) => void;
}) {
  return (
    <div
      id="list-card-viewport"
      className="rss-list-viewport"
      style={{ position: "relative", height: 800, width }}
    >
      <RSSListArticleCard
        feed={{ ...feed, title: item.feedId === "feed-b" ? "Second Feed" : feed.title }}
        item={item}
        preferences={preferences}
        selected={false}
        index={0}
        start={0}
        isScrolling={false}
        measureElement={() => {}}
        actions={<ListCardActions item={item} record={record} />}
        onSelect={(selectedFeed, selectedItem) =>
          record({ type: "select", feedId: selectedFeed.id, itemId: selectedItem.id })
        }
        onContextMenu={(event) => {
          event.preventDefault();
          record({ type: "contextmenu", itemId: item.id });
        }}
        onMenuKeyDown={(event) => record({ type: "menu-key", key: event.key })}
      />
    </div>
  );
}

function HarnessContent() {
  const { setTheme, themes } = useTheme();
  const [preferences, setPreferences] = useState<RssUserPreferenceUpdate>(RSS_DEFAULTS);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("basic");
  const [listWidth, setListWidth] = useState(420);
  const [cardItem, setCardItem] = useState<FeedItem>({
    ...itemSeed,
    read: true,
    fullContent: undefined,
  });
  const [cardRevision, setCardRevision] = useState(0);
  const [recordedActions, setRecordedActions] = useState<RecordedAction[]>([]);

  const record = (action: RecordedAction) => {
    setRecordedActions((actions) => [...actions, action]);
  };

  const save = async (patch: RssUserPreferenceUpdate) => {
    const saved = await setRssPreferencesViaHttp(patch);
    setPreferences(saved);
  };

  const resolvedPreferences = useMemo(
    () => ({ ...RSS_DEFAULTS, ...preferences }),
    [preferences],
  );

  (window as unknown as { rssHarness: HarnessApi }).rssHarness = {
    setPreferences: (patch: RssUserPreferenceUpdate) => setPreferences((p) => ({ ...p, ...patch })),
    setView,
    reload: async () => setPreferences(await getRssPreferencesViaHttp()),
    setListWidth: (width: number) => setListWidth(width),
    setCardFixture: (patch: Partial<FeedItem>) => {
      setCardItem((current) => ({ ...current, ...patch }));
      setCardRevision((revision) => revision + 1);
    },
    setTheme,
    getThemes: () => themes.map((theme) => theme.id),
    getActions: () => recordedActions,
    resetActions: () => setRecordedActions([]),
  };

  return (
    <div
      style={{
        height: "100dvh",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header className="p-2 flex flex-wrap gap-2">
        <button onClick={() => setOpen(true)}>Customize fixture</button>
        {[
          "basic",
          "story",
          "full",
          "scroll",
          "magazine",
          "grid",
          "standard",
          "list-card",
          "list-stress",
        ].map((v) => (
          <button key={v} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </header>
      <div id="rss-fixture" className="flex-1 min-h-0 overflow-auto">
        {view === "basic" && (
          <div className="reading-surface" style={rssReadingStyle(preferences)}>
            <div className="rss-reading-prose prose prose-sm">
              <p>Article paragraph for reading appearance verification.</p>
            </div>
          </div>
        )}
        {view === "story" && (
          <StoryView
            item={itemSeed}
            feed={feed}
            items={[itemSeed]}
            preferences={preferences}
            onSelectItem={() => {}}
            onToggleFavorite={() => {}}
          />
        )}
        {view === "full" && (
          <RSSFullContentView
            item={itemSeed}
            feed={feed}
            preferences={preferences}
            onSavePreferences={save}
          />
        )}
        {view === "scroll" && <RSSScrollMode preferences={preferences} />}
        {view === "magazine" && (
          <MagazineLayout
            items={Array.from({ length: 8 }, (_, i) => ({
              feed,
              item: { ...itemSeed, id: `article-${i}` },
            }))}
            preferences={preferences}
            onSelect={() => {}}
          />
        )}
        {view === "grid" && (
          <GridLayout
            items={Array.from({ length: 8 }, (_, i) => ({
              feed,
              item: { ...itemSeed, id: `article-${i}` },
            }))}
            preferences={preferences}
            onSelect={() => {}}
          />
        )}
        {view === "standard" && <RSSReader />}
        {view === "list-stress" && <RSSReader />}
        {view === "list-card" && (
          <ListCardFixture
            key={`${cardRevision}:${JSON.stringify(resolvedPreferences)}`}
            item={cardItem}
            preferences={resolvedPreferences}
            width={listWidth}
            record={record}
          />
        )}
      </div>
      <nav
        id="bottom-toolbar"
        style={{
          position: "fixed",
          bottom: 0,
          width: "100%",
          height: 56,
          zIndex: 1000,
          background: "#444",
        }}
      >
        <button>Background navigation</button>
      </nav>
      <RSSCustomizationPanel
        isOpen={open}
        onClose={() => setOpen(false)}
        currentPreferences={preferences}
        onSave={save}
      />
    </div>
  );
}

function Harness() {
  return (
    <PresentationProvider>
      <ThemeProvider defaultTheme="aurora-light">
        <HarnessContent />
      </ThemeProvider>
    </PresentationProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
