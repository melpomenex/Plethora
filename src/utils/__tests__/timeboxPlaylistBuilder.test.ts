import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import {
  buildTimeboxPlaylist,
  type TimeboxItemInput,
} from "../timeboxPlaylistBuilder";
import { TimeboxCompletionRing } from "../../components/queue/TimeboxSessionLauncher";

function makeItems(
  reviews: number,
  extracts: number,
  docs: number
): TimeboxItemInput[] {
  const items: TimeboxItemInput[] = [];
  for (let i = 0; i < reviews; i++) {
    items.push({ id: `card-${i}`, type: "flashcard" });
  }
  for (let i = 0; i < extracts; i++) {
    items.push({ id: `ext-${i}`, type: "extract" });
  }
  for (let i = 0; i < docs; i++) {
    items.push({ id: `doc-${i}`, type: "document" });
  }
  return items;
}

describe("UX03-T01 timeboxPlaylistBuilder", () => {
  it("slices a finite 15m Quick Sprint playlist along the 60/25/15 budget", () => {
    const items = makeItems(120, 30, 20);
    const result = buildTimeboxPlaylist(items, { preset: "quick_sprint_15m" });

    expect(result.targetMinutes).toBe(15);
    expect(result.estimatedMinutes).toBeLessThanOrEqual(15);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.breakdown.reviews).toBeGreaterThan(0);
    expect(result.breakdown.extracts).toBeGreaterThan(0);
    expect(result.breakdown.discovery).toBeGreaterThan(0);
  });

  it("backfills sparse extract/discovery buckets from remaining reviews cleanly", () => {
    const items = makeItems(20, 0, 0);
    const result = buildTimeboxPlaylist(items, {
      preset: "quick_sprint",
      minutes: 15,
    });

    expect(result.items.length).toBe(20);
    expect(result.estimatedMinutes).toBe(10);
    expect(Number.isNaN(result.estimatedMinutes)).toBe(false);
    expect(result.breakdown.reviews).toBe(20);
  });

  it("filters 10m Audio Commute to audio/TTS-compatible items and excludes image-heavy cards", () => {
    const items: TimeboxItemInput[] = [
      { id: "pod-1", type: "podcast", estimatedTime: 3 },
      {
        id: "img-card",
        type: "flashcard",
        learningItem: { image_asset_ids: ["img-1"] },
      },
      { id: "text-card", type: "flashcard" },
      { id: "rss-1", type: "rss" },
      { id: "ext-1", type: "extract" },
    ];

    const result = buildTimeboxPlaylist(items, { preset: "audio_commute_10m" });
    const ids = result.items.map((i) => i.id);
    expect(ids).not.toContain("img-card");
    expect(ids).not.toContain("rss-1");
    expect(ids).toContain("pod-1");
    expect(ids).toContain("text-card");
    expect(ids).toContain("ext-1");
  });

  it("renders [data-timebox-ring] at 0% and 50% completion", () => {
    const { rerender } = render(
      React.createElement(TimeboxCompletionRing, { completedCount: 0, totalCount: 10 })
    );
    const ring = document.querySelector("[data-timebox-ring='true']");
    expect(ring).toBeInTheDocument();
    expect(ring).toHaveTextContent("0%");

    rerender(
      React.createElement(TimeboxCompletionRing, { completedCount: 5, totalCount: 10 })
    );
    expect(document.querySelector("[data-timebox-ring='true']")).toHaveTextContent("50%");
  });
});
