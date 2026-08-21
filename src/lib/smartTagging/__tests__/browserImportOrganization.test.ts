import { describe, expect, it } from "vitest";
import {
  BROWSER_CAPTURE_LIMITS,
  browserOrganizationFingerprint,
  buildImageAssetTarget,
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

describe("image asset organization targets", () => {
  it("builds a target from a browser-captured registry asset", () => {
    const target = buildImageAssetTarget({
      id: "asset-1",
      file_name: "heart-diagram.png",
      mime_type: "image/png",
      metadata: {
        browserCaptureContext: {
          version: 1,
          sourceUrl: "https://example.com/articles/anatomy",
          domain: "example.com",
          pageTitle: "Anatomy diagram",
          captionAltText: "Figure 1: heart chambers",
        },
        captureProvenance: {
          source: "browser_extension",
          itemType: "image-registry",
          sourceUrl: "https://example.com/articles/anatomy",
          capturedAt: "2026-08-21T00:00:00Z",
          schemaVersion: 1,
        },
        organization: { schemaVersion: 1, status: "queued", confidenceBand: "none", fingerprint: "browser-org-v1-abc" },
      },
    });
    expect(target).not.toBeNull();
    expect(target?.targetType).toBe("image-asset");
    expect(target?.itemType).toBe("image");
    expect(target?.title).toBe("heart-diagram.png");
    expect(target?.content).toContain("Anatomy diagram");
    expect(target?.content).toContain("Figure 1: heart chambers");
    expect(target?.captureContext?.domain).toBe("example.com");
    expect(target?.organization?.status).toBe("queued");
    expect(target?.captureProvenance?.source).toBe("browser_extension");
  });

  it("returns null for assets without browser provenance", () => {
    expect(buildImageAssetTarget({ id: "asset-2", file_name: "uploaded.png", mime_type: "image/png", metadata: {} })).toBeNull();
    expect(buildImageAssetTarget({ id: "asset-3", file_name: "x.png", mime_type: "image/png" })).toBeNull();
  });
});
