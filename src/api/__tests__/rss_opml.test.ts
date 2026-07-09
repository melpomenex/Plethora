import { describe, it, expect, vi } from "vitest";
import { importOPML } from "../rss";

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
});
