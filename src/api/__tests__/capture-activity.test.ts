/**
 * Unit tests for the capture-activity API wrapper: response normalization
 * guards (null/non-object payloads, malformed entries) and command args.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  invokeCommand: mocks.invokeCommand,
  isTauri: () => true,
}));

import {
  getCaptureActivity,
  normalizeCaptureActivity,
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
