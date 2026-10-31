import { describe, expect, it } from "vitest";
import { orderFeedPriorities } from "../queueScrollExternalPriority";

describe("feed priority ordering", () => {
  it("orders within each feed type and preserves the prior order for ties", () => {
    const items = [
      { type: "rss", rssItem: { id: "a" } },
      { type: "document" },
      { type: "rss", rssItem: { id: "b" } },
      { type: "podcast", podcastEpisode: { id: "p" } },
      { type: "rss", rssItem: { id: "c" } },
    ];
    const ordered = orderFeedPriorities(items, { "rss-article:b": 73, "rss-article:a": 0 });
    expect(ordered.map((item) => item.rssItem?.id ?? item.type)).toEqual(["b", "document", "c", "podcast", "a"]);
    expect(items[0].rssItem?.id).toBe("a");
  });
});
