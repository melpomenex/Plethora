import { describe, expect, it } from "vitest";
import {
  BROWSER_CAPTURE_LIMITS,
  browserOrganizationFingerprint,
  confidenceBand,
  isNeedsReview,
  normalizeBrowserCaptureContext,
  rankInheritedSourceTags,
} from "../browserImportOrganization";

describe("browser import organization contracts", () => {
  it("bounds untrusted capture context and derives source identity", () => {
    const context = normalizeBrowserCaptureContext({
      source_url: "https://example.com/path",
      page_title: "A\u0000 title",
      heading_path: Array.from({ length: 30 }, (_, index) => `Section ${index}`),
      nearby_text: "x".repeat(10_000),
      source_tags: ["topic", "topic", "source"],
    });

    expect(context?.domain).toBe("example.com");
    expect(context?.headingPath).toHaveLength(BROWSER_CAPTURE_LIMITS.headingPath);
    expect(context?.nearbyText?.length).toBeLessThanOrEqual(BROWSER_CAPTURE_LIMITS.nearbyText);
    expect(new TextEncoder().encode(JSON.stringify(context)).byteLength).toBeLessThanOrEqual(BROWSER_CAPTURE_LIMITS.totalBytes);
    expect(context?.pageTitle).toBe("A  title");
  });

  it("produces stable local fingerprints for retry coalescing", () => {
    expect(browserOrganizationFingerprint(["qa", "same"])).toBe(browserOrganizationFingerprint(["qa", "same"]));
    expect(browserOrganizationFingerprint(["qa", "same"])).not.toBe(browserOrganizationFingerprint(["qa", "changed"]));
  });

  it("ranks source tags only when child evidence supports them", () => {
    expect(rankInheritedSourceTags(["Machine Learning", "History"], ["A machine learning paper"])).toEqual(["Machine Learning"]);
  });

  it("maps confidence and review states deterministically", () => {
    expect(confidenceBand(0.9)).toBe("high");
    expect(confidenceBand(0.75)).toBe("medium");
    expect(confidenceBand(0.4)).toBe("low");
    expect(isNeedsReview({
      schemaVersion: 1,
      status: "needs-review",
      confidenceBand: "low",
      fingerprint: "test",
    })).toBe(true);
  });
});
