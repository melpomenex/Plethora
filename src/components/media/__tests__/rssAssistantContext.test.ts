import { describe, expect, it } from "vitest";
import type { FeedItem } from "../../../api/rss";
import { buildRssAssistantContext } from "../rssAssistantContext";

const baseItem: FeedItem = {
  id: "a1",
  title: "Article title",
  description: "Feed description",
  content: "",
  link: "https://example.com/article",
  pubDate: "2026-01-01",
  categories: [],
  read: false,
  favorite: false,
  feedId: "f1",
};

describe("buildRssAssistantContext", () => {
  it("returns undefined without a selected item", () => {
    expect(buildRssAssistantContext(null)).toBeUndefined();
    expect(buildRssAssistantContext(undefined)).toBeUndefined();
  });

  it("prefers fetched full content and hands the assistant plain text", () => {
    const context = buildRssAssistantContext({
      ...baseItem,
      fullContent: "<p>Full <b>article</b> body</p><script>bad()</script>",
      content: "<p>Feed excerpt</p>",
    });
    expect(context).toMatchObject({
      type: "web",
      url: "https://example.com/article",
      content: "Full article body",
      metadata: { title: "Article title" },
      status: "ready",
    });
  });

  it("falls back to feed content, then description, decoding entities", () => {
    expect(buildRssAssistantContext({ ...baseItem, content: "<p>Feed &amp; content</p>" })?.content).toBe("Feed & content");
    expect(buildRssAssistantContext({ ...baseItem })?.content).toBe("Feed description");
    expect(buildRssAssistantContext({ ...baseItem, description: "" })?.content).toBe("");
  });

  it("falls back to a stable rss: url when the item has no link", () => {
    expect(buildRssAssistantContext({ ...baseItem, link: "" })?.url).toBe("rss:a1");
  });
});
