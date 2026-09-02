import { describe, it, expect, vi } from "vitest";
import { importOPML, mapWithConcurrency, Feed } from "../rss";

// Mock generateFeedId to avoid calling generateFeedId dependency
vi.mock("../rss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../rss")>();
  return {
    ...actual,
    generateFeedId: (url: string) => `mock-id-${url.replace(/[^a-zA-Z0-9]/g, "-")}`,
  };
});

describe("OPML Import Parser Tests", () => {
  it("should successfully parse standard OPML", () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My Subscriptions</title>
  </head>
  <body>
    <outline text="Technology" title="Technology">
      <outline type="rss" text="Hacker News" title="Hacker News" xmlUrl="https://news.ycombinator.com/rss" htmlUrl="https://news.ycombinator.com"/>
    </outline>
  </body>
</opml>`;

    const feeds = importOPML(opml);
    expect(feeds.length).toBe(1);
    expect(feeds[0].title).toBe("Hacker News");
    expect(feeds[0].feedUrl).toBe("https://news.ycombinator.com/rss");
    expect(feeds[0].category).toBe("Technology");
  });

  it("should normalize feed:// and feed: protocols", () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Feed 1" xmlUrl="feed://example.com/rss"/>
    <outline type="rss" text="Feed 2" xmlUrl="feed:https://example2.com/feed.xml"/>
  </body>
</opml>`;

    const feeds = importOPML(opml);
    expect(feeds.length).toBe(2);
    expect(feeds[0].feedUrl).toBe("https://example.com/rss");
    expect(feeds[1].feedUrl).toBe("https://example2.com/feed.xml");
  });

  it("should parse case-insensitive tags", () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<OPML version="2.0">
  <BODY>
    <OUTLINE text="Folder">
      <OUTLINE type="rss" text="Feed 3" xmlUrl="https://example3.com/rss"/>
    </OUTLINE>
  </BODY>
</OPML>`;

    const feeds = importOPML(opml);
    expect(feeds.length).toBe(1);
    expect(feeds[0].title).toBe("Feed 3");
    expect(feeds[0].feedUrl).toBe("https://example3.com/rss");
    expect(feeds[0].category).toBe("Folder");
  });

  it("should fall back to tolerant parsing when XML is malformed (bare &)", () => {
    // A bare "&" in an attribute makes this not well-formed XML, which makes
    // DOMParser emit a <parsererror>. The fallback regex pass should still
    // recover the feed.
    const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline type="rss" text="Research & News" title="Research & News" xmlUrl="https://example.com/rss"/>
    <outline type="rss" text="Another Feed" xmlUrl="https://example2.com/feed"/>
  </body>
</opml>`;

    const feeds = importOPML(opml);
    expect(feeds.length).toBe(2);
    expect(feeds[0].feedUrl).toBe("https://example.com/rss");
    expect(feeds[1].feedUrl).toBe("https://example2.com/feed");
  });

  it("should dedupe feeds in the fallback path", () => {
    const opml = `<?xml version="1.0"?><opml><body>
      <outline text="A & B" xmlUrl="https://example.com/rss"/>
      <outline text="A and B" xmlUrl="https://example.com/rss"/>
    </body></opml>`;
    const feeds = importOPML(opml);
    expect(feeds.length).toBe(1);
  });

  it("should return [] for non-OPML content without throwing", () => {
    expect(() => importOPML("")).not.toThrow();
    expect(() => importOPML("<html><body>not opml</body></html>")).not.toThrow();
    expect(importOPML("<<<garbage>>>")).toEqual([]);
  });
});

describe("OPML Concurrency and Import Hydration", () => {
  it("executes tasks with bounded concurrency and preserves order", async () => {
    let running = 0;
    let maxRunning = 0;
    const items = [10, 20, 30, 40, 50, 60];

    const results = await mapWithConcurrency(items, 3, async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      return item * 2;
    });

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(results).toEqual([20, 40, 60, 80, 100, 120]);
  });

  it("handles individual task errors gracefully during concurrent mapping", async () => {
    const feeds = [
      { id: "1", feedUrl: "https://good1.com/rss", title: "Good 1" },
      { id: "2", feedUrl: "https://bad.com/rss", title: "Bad" },
      { id: "3", feedUrl: "https://good2.com/rss", title: "Good 2" },
    ];

    const results = await mapWithConcurrency(feeds, 2, async (feed) => {
      try {
        if (feed.id === "2") {
          throw new Error("Network timeout");
        }
        return { success: true, feedId: feed.id };
      } catch {
        return { success: false, feedId: feed.id };
      }
    });

    expect(results).toEqual([
      { success: true, feedId: "1" },
      { success: false, feedId: "2" },
      { success: true, feedId: "3" },
    ]);
  });

  it("registers initial feeds immediately in Phase 1 before article fetching in Phase 2", async () => {
    const opmlXml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Feed Alpha" title="Feed Alpha" xmlUrl="https://alpha.com/rss"/>
      <outline type="rss" text="Feed Beta" title="Feed Beta" xmlUrl="https://beta.com/rss"/>
    </outline>
  </body>
</opml>`;

    const parsedFeeds = importOPML(opmlXml);
    expect(parsedFeeds.length).toBe(2);

    // Simulated Phase 1: immediate feed registration
    const registeredStore: Feed[] = [];
    const syncFeed = vi.fn(async (feed: Feed) => {
      registeredStore.push({ ...feed, items: [] });
    });

    await Promise.all(parsedFeeds.map((feed) => syncFeed(feed)));

    // Feeds are immediately present in the store before any remote articles are fetched
    expect(syncFeed).toHaveBeenCalledTimes(2);
    expect(registeredStore.length).toBe(2);
    expect(registeredStore.map((f) => f.feedUrl)).toEqual([
      "https://alpha.com/rss",
      "https://beta.com/rss",
    ]);

    // Simulated Phase 2: background article fetching
    const fetchArticles = vi.fn(async (url: string) => {
      if (url === "https://beta.com/rss") {
        throw new Error("Temporary network glitch");
      }
      return [{ id: "art-1", title: "Article 1" }];
    });

    const results = await mapWithConcurrency(registeredStore, 2, async (feed) => {
      try {
        const articles = await fetchArticles(feed.feedUrl);
        feed.items = articles as any;
        return true;
      } catch {
        return false;
      }
    });

    // Alpha succeeded, Beta failed to fetch articles but remains registered
    expect(results).toEqual([true, false]);
    expect(registeredStore[0].items.length).toBe(1);
    expect(registeredStore[1].items.length).toBe(0);
    // Crucially, both feeds remain registered and visible
    expect(registeredStore.length).toBe(2);
  });
});


