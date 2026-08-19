import { describe, it, expect } from "vitest";
import { urlDetectorUtils, URLType } from "../useURLDetector";

describe("useURLDetector", () => {
  it("detects x.com status URLs", () => {
    const res = urlDetectorUtils.detectURL("https://x.com/karpathy/status/1880000000000000000");
    expect(res.isURL).toBe(true);
    expect(res.type).toBe(URLType.Twitter);
    expect(res.twitterStatusId).toBe("1880000000000000000");
    expect(res.twitterUsername).toBe("karpathy");
  });

  it("detects twitter.com status URLs with query parameters", () => {
    const res = urlDetectorUtils.detectURL("https://twitter.com/sama/status/1234567890?s=20&t=abcdef");
    expect(res.isURL).toBe(true);
    expect(res.type).toBe(URLType.Twitter);
    expect(res.twitterStatusId).toBe("1234567890");
    expect(res.twitterUsername).toBe("sama");
  });

  it("detects mobile.twitter.com status URLs", () => {
    const res = urlDetectorUtils.detectURL("https://mobile.twitter.com/ylecun/status/987654321");
    expect(res.isURL).toBe(true);
    expect(res.type).toBe(URLType.Twitter);
    expect(res.twitterStatusId).toBe("987654321");
    expect(res.twitterUsername).toBe("ylecun");
  });

  it("detects youtube URLs", () => {
    const res = urlDetectorUtils.detectURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(res.isURL).toBe(true);
    expect(res.type).toBe(URLType.YouTube);
    expect(res.youtubeId).toBe("dQw4w9WgXcQ");
  });

  it("detects RSS feed URLs", () => {
    const res = urlDetectorUtils.detectURL("https://example.com/blog/feed.xml");
    expect(res.isURL).toBe(true);
    expect(res.type).toBe(URLType.RSSFeed);
  });
});
