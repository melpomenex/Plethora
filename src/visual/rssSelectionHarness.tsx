import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { RSSReader } from "../components/media/RSSReader";
import { RSSFullContentView } from "../components/media/RSSFullContentView";
import { StoryView } from "../components/media/StoryView";
import { RSS_DEFAULTS, type RssUserPreferenceUpdate } from "../types/rssCustomization";
import type { Feed, FeedItem } from "../api/rss";

/**
 * Deterministic RSS article fixture for the selection-preservation browser
 * regression. The same article content is mounted through the three real
 * selection-menu consumers:
 *   - `reader`: the full inline reader (RSSReader, list + reading pane)
 *   - `full`:   the full-content article view
 *   - `story`:  the focused Story view
 *
 * The harness exposes state hooks so the spec can trigger an unrelated
 * rerender (`bump`), replace article content (`setContentVersion`), or switch
 * articles (`setArticle`) while the selection menu is open.
 */

const PARAGRAPH_ONE =
  "The first paragraph gives the reader a stable target sentence for selection.";
const PARAGRAPH_THREE =
  "The third paragraph keeps enough words to make a backward selection practical.";

const ARTICLE_HTML = `<p>${PARAGRAPH_ONE}</p><p>A second paragraph carries <strong>formatted text</strong> so a selected range can cross <em>inline elements</em>.</p><p>${PARAGRAPH_THREE} <a href="https://example.com/source">Source link</a></p><p><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Crect width='120' height='60' fill='rebeccapurple'/%3E%3C/svg%3E" alt="Fixture image" /></p>`;
const ARTICLE_B_HTML =
  "<p>Beta article begins with different words for the replacement article.</p><p>Beta article keeps a second paragraph so a stale range cannot survive.</p>";

function buildItem(id: string, content: string): FeedItem {
  return {
    id,
    feedId: "feed-a",
    title: id === "article-a" ? "Alpha article" : "Beta article",
    author: "Jane",
    pubDate: "2026-10-01",
    read: false,
    favorite: false,
    categories: ["science"],
    description: content,
    content,
    fullContent: content,
    link: `https://example.com/${id}`,
    thumbnail:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='steelblue'/%3E%3C/svg%3E",
  } as FeedItem;
}

function buildFeed(item: FeedItem): Feed {
  return {
    id: "feed-a",
    title: "Science Feed",
    items: [item],
    icon: item.thumbnail,
    feedUrl: "https://example.com/rss",
    link: "https://example.com",
    description: "Science",
    unreadCount: 1,
  } as Feed;
}

type HarnessView = "reader" | "full" | "story";

interface HarnessState {
  view: HarnessView;
  articleId: string;
  contentVersion: number;
  renderTick: number;
}

const INITIAL_STATE: HarnessState = {
  view: "story",
  articleId: "article-a",
  contentVersion: 0,
  renderTick: 0,
};

function Harness() {
  const [state, setState] = useState<HarnessState>(INITIAL_STATE);
  const [preferences] = useState<RssUserPreferenceUpdate>({
    ...RSS_DEFAULTS,
    theme_mode: "light",
  });

  const content =
    state.articleId === "article-a"
      ? state.contentVersion === 0
        ? ARTICLE_HTML
        : `<p>Replacement content for ${state.articleId}.</p>`
      : ARTICLE_B_HTML;
  const item = buildItem(state.articleId, content);
  const feed = buildFeed(item);

  (window as unknown as { rssSelectionHarness: unknown }).rssSelectionHarness = {
    setView: (view: HarnessView) => setState((prev) => ({ ...prev, view })),
    setArticle: (articleId: string) =>
      setState((prev) => ({ ...prev, articleId, contentVersion: 0 })),
    setContentVersion: (contentVersion: number) =>
      setState((prev) => ({ ...prev, contentVersion })),
    bump: () => setState((prev) => ({ ...prev, renderTick: prev.renderTick + 1 })),
    state: () => ({ ...state }),
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
      <header className="p-2 flex flex-wrap gap-2" data-render-tick={state.renderTick}>
        {(["reader", "full", "story"] as const).map((view) => (
          <button
            key={view}
            data-harness-view={view}
            onClick={() => setState((prev) => ({ ...prev, view }))}
          >
            {view}
          </button>
        ))}
      </header>
      <div id="rss-fixture" className="flex-1 min-h-0 overflow-auto">
        {state.view === "reader" && <RSSReader />}
        {state.view === "full" && (
          <RSSFullContentView
            key={`full-${state.articleId}-${state.contentVersion}`}
            item={item}
            feed={feed}
            preferences={preferences}
            onSavePreferences={async () => {}}
          />
        )}
        {state.view === "story" && (
          <StoryView
            item={item}
            feed={feed}
            items={[item]}
            preferences={preferences}
            onSelectItem={() => {}}
            onToggleFavorite={() => {}}
          />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
