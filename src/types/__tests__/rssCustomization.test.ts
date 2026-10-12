import { describe, expect, it } from "vitest";
import {
  filterRssArticles,
  normalizeRssPreferences,
  resolveRssPreferences,
  sortRssArticles,
  RSS_PRESETS,
} from "../rssCustomization";
import type { FeedItem } from "../../api/rss";
const articles = [
  {
    id: "b",
    title: "Beta",
    author: "Jane",
    categories: ["science"],
    pubDate: "2026-01-02",
    read: true,
    content: "<p>two words</p>",
  },
  {
    id: "a",
    title: "Alpha",
    author: "John",
    categories: ["tech"],
    pubDate: "2026-01-01",
    read: false,
    content: "<p>one</p>",
  },
].map((item) => ({ item: item as FeedItem }));
describe("RSS customization contract", () => {
  it("resolves partial feed overrides without erasing global values", () => {
    expect(
      resolveRssPreferences(
        { font_size: 24, show_author: false },
        { line_height: 1.7, font_size: null }
      )
    ).toMatchObject({ font_size: 24, line_height: 1.7, show_author: false });
  });
  it("validates enums and finite ranges without truncating fractions", () => {
    expect(
      normalizeRssPreferences({
        view_mode: "bad",
        font_size: 999,
        line_height: 1.7,
        column_count: NaN,
      })
    ).toEqual({ font_size: 32, line_height: 1.7 });
  });
  it.each([
    ["keyword_include", "Alpha", "a"],
    ["keyword_exclude", "Beta", "a"],
    ["author_whitelist", "Jane", "b"],
    ["author_blacklist", "John", "b"],
    ["category_filter", "tech", "a"],
  ])("applies %s", (key, value, id) =>
    expect(filterRssArticles(articles, { [key]: value }).map((x) => x.item.id)).toEqual([id])
  );
  it.each(["date", "title", "read_status", "reading_time"])(
    "sorts %s in both directions",
    (sort_by) => {
      expect(
        sortRssArticles(articles, { sort_by, sort_order: "asc" }).map((x) => x.item.id)
      ).toEqual(["a", "b"]);
      expect(
        sortRssArticles(articles, { sort_by, sort_order: "desc" }).map((x) => x.item.id)
      ).toEqual(["b", "a"]);
    }
  );
  it("uses the unread preset with unread first", () =>
    expect(sortRssArticles(articles, RSS_PRESETS.unread)[0].item.read).toBe(false));
  it("handles equal and missing dates deterministically", () => {
    const tied = articles.map((x) => ({ item: { ...x.item, pubDate: "invalid" } }));
    expect(sortRssArticles(tied, {}).map((x) => x.item.id)).toEqual(["a", "b"]);
  });
});
