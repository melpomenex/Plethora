/**
 * Unit tests for the capture-activity API wrapper: response normalization
 * guards (null/non-object payloads, malformed entries) and command args.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  isNativeMobile: vi.fn(() => false),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: () => true,
  isNativeMobile: mocks.isNativeMobile,
}));

import {
  getCaptureActivity,
  normalizeCaptureActivity,
  getBrowserCaptureDocuments,
  normalizeBrowserCapturePage,
  getCaptureDocuments,
  getCaptureListingSource,
  normalizeCapturePage,
} from "../capture-activity";

describe("normalizeCaptureActivity", () => {
  it("passes through a well-formed payload", () => {
    const activity = normalizeCaptureActivity({
      window_days: 30,
      needs_attention: 2,
      per_day: [
        { date: "2026-09-05", count: 4 },
        { date: "2026-09-06", count: 0 },
      ],
      by_source: [
        { source: "browser-extension", count: 12 },
        { source: "share-target", count: 1 },
        { source: "rss", count: 0 },
        { source: "manual", count: 3 },
      ],
    });

    expect(activity).toEqual({
      windowDays: 30,
      needsAttention: 2,
      perDay: [
        { date: "2026-09-05", count: 4 },
        { date: "2026-09-06", count: 0 },
      ],
      bySource: [
        { source: "browser-extension", count: 12 },
        { source: "share-target", count: 1 },
        { source: "rss", count: 0 },
        { source: "manual", count: 3 },
      ],
    });
  });

  it("degrades null and non-object payloads to safe defaults", () => {
    for (const raw of [null, undefined, "nope", 42, []]) {
      const activity = normalizeCaptureActivity(raw);
      expect(activity.windowDays).toBe(30);
      expect(activity.perDay).toEqual([]);
      expect(activity.bySource).toEqual([]);
      expect(activity.needsAttention).toBe(0);
    }
  });

  it("drops malformed per-day entries instead of throwing", () => {
    const activity = normalizeCaptureActivity({
      per_day: [
        { date: "2026-09-05", count: 3 },
        { count: 5 }, // missing date
        { date: "2026-09-06", count: -2 }, // negative
        { date: "2026-09-07", count: Number.NaN }, // NaN
        "junk", // non-object
        null,
      ],
    });

    expect(activity.perDay).toEqual([{ date: "2026-09-05", count: 3 }]);
  });

  it("drops unrecognized sources and malformed counts", () => {
    const activity = normalizeCaptureActivity({
      by_source: [
        { source: "browser-extension", count: 7 },
        { source: "carrier-pigeon", count: 2 }, // unknown source
        { source: "rss" }, // missing count
        { source: "manual", count: 2.7 }, // rounded
      ],
    });

    expect(activity.bySource).toEqual([
      { source: "browser-extension", count: 7 },
      { source: "manual", count: 3 },
    ]);
  });

  it("coerces bad scalars to defaults", () => {
    const activity = normalizeCaptureActivity({
      window_days: -5,
      needs_attention: Number.NaN,
    });

    expect(activity.windowDays).toBe(30);
    expect(activity.needsAttention).toBe(0);
  });
});

describe("browser capture metadata", () => {
  const row = { document_id: "saved", title: "Saved page", file_type: "html", source_url: "https://example.org/article", date_added: "2026-10-14T10:00:00Z", cover_image_url: null };

  it("normalizes bounded metadata and drops malformed or unsupported source rows", () => {
    const page = normalizeBrowserCapturePage({ items: [row, row, null, { ...row, document_id: "bad-date", date_added: "never" }, { ...row, document_id: "unsafe", source_url: "javascript:alert(1)" }], total_count: Infinity, limit: -1, offset: -5 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ documentId: "saved", fileType: "html", sourceUrl: row.source_url, coverImageUrl: null });
    expect(page).toMatchObject({ limit: 1, offset: 0, totalCount: 1 });
    expect(normalizeBrowserCapturePage(null).items).toEqual([]);
  });

  it("bounds command inputs and preserves aggregate isolation", async () => {
    mocks.invokeCommand.mockResolvedValue({ items: [row], total_count: 12, limit: 100, offset: 0 });
    const page = await getBrowserCaptureDocuments(999, -10);
    expect(mocks.invokeCommand).toHaveBeenLastCalledWith("get_browser_capture_documents", { limit: 100, offset: 0 });
    expect(page.totalCount).toBe(12);
  });
});

describe("source-selected capture pages", () => {
  const local = { document_id: "local-note", title: "A note", file_type: "markdown", source_url: null, date_added: "2026-10-14T10:00:00Z", cover_image_url: null };

  it("selects native shares and desktop browser captures independent of width", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    mocks.isNativeMobile.mockReturnValue(true);
    expect(getCaptureListingSource()).toBe("share-target");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    expect(getCaptureListingSource()).toBe("share-target");
    mocks.isNativeMobile.mockReturnValue(false);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    expect(getCaptureListingSource()).toBe("browser-extension");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
    expect(getCaptureListingSource()).toBe("browser-extension");
  });

  it("keeps valid URL-less items, sanitizes bad URLs, and rejects invalid identities or dates", () => {
    const page = normalizeCapturePage({ items: [
      local,
      { ...local, document_id: "url", source_url: "javascript:alert(1)" },
      { ...local, document_id: "bad-date", date_added: "never" },
      { ...local, document_id: "", date_added: "2026-10-14T10:00:00Z" },
      local,
    ], total_count: 8, limit: 6, offset: 0 });
    expect(page.items.map(item => item.documentId)).toEqual(["local-note", "url"]);
    expect(page.items[0].sourceUrl).toBeNull();
    expect(page.items[1].sourceUrl).toBeNull();
    expect(page.totalCount).toBe(8);
  });

  it("invokes the source-selected query with bounded inputs", async () => {
    mocks.invokeCommand.mockResolvedValue({ items: [local], total_count: 1, limit: 6, offset: 0 });
    const page = await getCaptureDocuments("share-target", 0, -20);
    expect(mocks.invokeCommand).toHaveBeenLastCalledWith("get_capture_documents", { source: "share-target", limit: 1, offset: 0 });
    expect(page.items[0].sourceUrl).toBeNull();
  });
});

describe("getCaptureActivity", () => {
  beforeEach(() => {
    mocks.invokeCommand.mockReset();
  });

  it("invokes the command with the requested window and normalizes the result", async () => {
    mocks.invokeCommand.mockResolvedValue({
      window_days: 14,
      needs_attention: 1,
      per_day: [{ date: "2026-09-06", count: 2 }],
      by_source: [{ source: "browser-extension", count: 2 }],
    });

    const activity = await getCaptureActivity(14);

    expect(mocks.invokeCommand).toHaveBeenCalledWith("get_capture_activity", { days: 14 });
    expect(activity.windowDays).toBe(14);
    expect(activity.needsAttention).toBe(1);
    expect(activity.perDay).toEqual([{ date: "2026-09-06", count: 2 }]);
  });

  it("uses the default 30-day window and survives a null payload", async () => {
    mocks.invokeCommand.mockResolvedValue(null);

    const activity = await getCaptureActivity();

    expect(mocks.invokeCommand).toHaveBeenCalledWith("get_capture_activity", { days: 30 });
    expect(activity.perDay).toEqual([]);
  });

  it("propagates command errors to the caller", async () => {
    mocks.invokeCommand.mockRejectedValue(new Error("db unavailable"));
    await expect(getCaptureActivity(30)).rejects.toThrow("db unavailable");
  });
});
