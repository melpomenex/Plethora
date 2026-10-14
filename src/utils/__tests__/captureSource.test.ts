import { describe, expect, it } from "vitest";
import { browserCaptureSourceUrl, hasShareCaptureEvidence, shareCaptureSourceUrl, validCaptureUrl } from "../captureSource";
import { formatLocalizedRelativeTime } from "../relativeTime";

describe("durable browser source rules", () => {
  it("respects explicit provenance and falls back to the first valid URL", () => {
    expect(browserCaptureSourceUrl({ captureProvenance: { source: "browser_extension", sourceUrl: "javascript:bad" }, shareProvenance: {}, originalUrl: "https://example.org/original" }, "https://example.org/fallback")).toBe("https://example.org/original");
    expect(browserCaptureSourceUrl({ source: "browser_extension", shareProvenance: {} }, "https://example.org")).toBeNull();
    expect(browserCaptureSourceUrl({ source: "browser_extension", captureProvenance: { source: "android_share" } }, "https://example.org")).toBeNull();
    expect(browserCaptureSourceUrl({ source: "browser_extension" }, "https://example.org")).toBe("https://example.org/");
    expect(browserCaptureSourceUrl({ source: "browser_extension", shareProvenance: null }, "https://example.org")).toBe("https://example.org/");
    expect(browserCaptureSourceUrl({ tags: ["browser-extension"] }, "https://example.org")).toBeNull();
    expect(browserCaptureSourceUrl("bad JSON", "https://example.org")).toBeNull();
    expect(validCaptureUrl("file:///private/page")).toBeNull();
  });

  it("formats dates in the active locale", () => {
    const now = Date.parse("2026-10-14T10:00:00Z");
    expect(formatLocalizedRelativeTime(now - 120000, "en", now)).toContain("2 min");
    expect(formatLocalizedRelativeTime(now - 120000, "ja", now)).toContain("2 分前");
    expect(formatLocalizedRelativeTime(now + 1000, "en", now)).toBe("now");
  });
});

describe("durable share source rules", () => {
  it("accepts explicit native origin and persisted share records, but not tags or URL presence", () => {
    for (const metadata of [
      { captureProvenance: { source: "share_extension" } },
      { captureProvenance: { source: "android_share" } },
      { shareProvenance: { source: "android_share" } },
      { shareProvenance: {} },
      { source: "share_extension" },
      JSON.stringify({ shareProvenance: {} }),
    ]) expect(hasShareCaptureEvidence(metadata)).toBe(true);
    for (const metadata of [
      { source: "manual", tags: ["share_extension"] },
      { source: "rss", url: "https://example.org" },
      { shareProvenance: null },
      "not JSON",
      [],
    ]) expect(hasShareCaptureEvidence(metadata)).toBe(false);
  });

  it("resolves only optional HTTP(S) originals and falls through invalid candidates", () => {
    expect(shareCaptureSourceUrl({
      shareProvenance: { sourceUrl: "javascript:bad" },
      captureProvenance: { sourceUrl: "file:///private/document.pdf" },
      originalUrl: "https://example.org/original",
    }, "file:///private/document.pdf")).toBe("https://example.org/original");
    expect(shareCaptureSourceUrl({ url: "note://local" }, "file:///private/document.pdf")).toBeNull();
    expect(shareCaptureSourceUrl({ browserCaptureContext: { sourceUrl: "https://example.org/context" }, originalUrl: "https://example.org/original" }, "https://example.org/path")).toBe("https://example.org/context");
    expect(shareCaptureSourceUrl("not JSON", "https://example.org")).toBeNull();
  });
});
