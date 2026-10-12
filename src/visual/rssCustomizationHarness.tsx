import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { RSSCustomizationPanel } from "../components/media/RSSCustomizationPanel";
import { RSSReader } from "../components/media/RSSReader";
import { RSSFullContentView } from "../components/media/RSSFullContentView";
import { RSSScrollMode } from "../components/media/RSSScrollMode";
import { StoryView } from "../components/media/StoryView";
import { MagazineLayout, GridLayout } from "../components/media/ArticleLayouts";
import {
  RSS_DEFAULTS,
  rssReadingStyle,
  type RssUserPreferenceUpdate,
} from "../types/rssCustomization";
import type { Feed, FeedItem } from "../api/rss";
import { setRssPreferencesViaHttp, getRssPreferencesViaHttp } from "../api/rss";
const item = {
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
  thumbnail:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='steelblue'/%3E%3C/svg%3E",
} as FeedItem;
const feed = {
  id: "feed-a",
  title: "Science Feed",
  items: [item],
  icon: item.thumbnail,
  feedUrl: "https://example.com/rss",
  link: "https://example.com",
  description: "Science",
  unreadCount: 1,
} as Feed;
function Harness() {
  const [preferences, setPreferences] = useState<RssUserPreferenceUpdate>(RSS_DEFAULTS);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("basic");
  const save = async (patch: RssUserPreferenceUpdate) => {
    const saved = await setRssPreferencesViaHttp(patch);
    setPreferences(saved);
  };
  (window as unknown as { rssHarness: unknown }).rssHarness = {
    setPreferences: (patch: RssUserPreferenceUpdate) => setPreferences((p) => ({ ...p, ...patch })),
    setView,
    reload: async () => setPreferences(await getRssPreferencesViaHttp()),
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
        {["basic", "story", "full", "scroll", "magazine", "grid", "standard"].map((v) => (
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
            item={item}
            feed={feed}
            items={[item]}
            preferences={preferences}
            onSelectItem={() => {}}
            onToggleFavorite={() => {}}
          />
        )}
        {view === "full" && (
          <RSSFullContentView
            item={item}
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
              item: { ...item, id: `article-${i}` },
            }))}
            preferences={preferences}
            onSelect={() => {}}
          />
        )}
        {view === "grid" && (
          <GridLayout
            items={Array.from({ length: 8 }, (_, i) => ({
              feed,
              item: { ...item, id: `article-${i}` },
            }))}
            preferences={preferences}
            onSelect={() => {}}
          />
        )}
        {view === "standard" && <RSSReader />}
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
createRoot(document.getElementById("root")!).render(<Harness />);
