import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { PodcastChapterSheet } from "../PodcastChapterSheet";
import type { PodcastChapter } from "../../../types/podcastAd";

// Mock ResponsiveDialogSheet to render inline children
vi.mock("../../adaptive/ResponsiveDialogSheet", () => ({
  ResponsiveDialogSheet: ({
    open,
    children,
    title,
  }: {
    open: boolean;
    children: React.ReactNode;
    title: string;
  }) => (open ? <div data-testid="dialog-sheet"><h2>{title}</h2>{children}</div> : null),
}));

describe("PodcastChapterSheet", () => {
  const sampleChapters: PodcastChapter[] = [
    {
      id: "ch1",
      episodeId: "ep1",
      chapterIndex: 0,
      title: "Introduction & Welcome",
      startMs: 0,
      endMs: 180000,
      imageUrl: "https://example.com/cover1.jpg",
      linkUrl: "https://example.com/intro",
      source: "podcast20_json",
      isAdvertisement: false,
    },
    {
      id: "ch2",
      episodeId: "ep1",
      chapterIndex: 1,
      title: "Sponsor: Athletic Greens",
      startMs: 180000,
      endMs: 300000,
      imageUrl: null,
      linkUrl: null,
      source: "podcast20_json",
      isAdvertisement: true,
    },
    {
      id: "ch3",
      episodeId: "ep1",
      chapterIndex: 2,
      title: "Main Deep Dive",
      startMs: 300000,
      endMs: 900000,
      imageUrl: null,
      linkUrl: null,
      source: "podcast20_json",
      isAdvertisement: false,
    },
  ];

  it("renders chapter titles, timestamps, and sponsor badges", () => {
    render(
      <PodcastChapterSheet
        open={true}
        onClose={vi.fn()}
        chapters={sampleChapters}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    );

    expect(screen.getByText("Introduction & Welcome")).toBeInTheDocument();
    expect(screen.getByText("Sponsor: Athletic Greens")).toBeInTheDocument();
    expect(screen.getByText("Main Deep Dive")).toBeInTheDocument();

    // Check sponsor badge
    expect(screen.getByText("Sponsor")).toBeInTheDocument();

    // Check formatted timestamps (00:00, 03:00, 05:00)
    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getAllByText("3:00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("5:00")).toBeInTheDocument();
  });

  it("calls onSeek with milliseconds and onClose when a chapter is clicked", () => {
    const handleSeek = vi.fn();
    const handleClose = vi.fn();

    render(
      <PodcastChapterSheet
        open={true}
        onClose={handleClose}
        chapters={sampleChapters}
        currentTimeMs={0}
        onSeek={handleSeek}
      />
    );

    const chapter2 = screen.getByText("Sponsor: Athletic Greens");
    fireEvent.click(chapter2);

    expect(handleSeek).toHaveBeenCalledWith(180000);
    expect(handleClose).toHaveBeenCalled();
  });

  it("highlights the active chapter based on current playback time", () => {
    const { container } = render(
      <PodcastChapterSheet
        open={true}
        onClose={vi.fn()}
        chapters={sampleChapters}
        currentTimeMs={200000} // Inside chapter 2 (180,000 - 300,000)
        onSeek={vi.fn()}
      />
    );

    // Active chapter item should have primary highlight class
    const activeItem = container.querySelector(".bg-primary\\/10");
    expect(activeItem).toBeInTheDocument();
    expect(activeItem?.textContent).toContain("Sponsor: Athletic Greens");
  });

  it("shows empty state when no chapters are present", () => {
    render(
      <PodcastChapterSheet
        open={true}
        onClose={vi.fn()}
        chapters={[]}
        currentTimeMs={0}
        onSeek={vi.fn()}
      />
    );

    expect(
      screen.getByText("No chapters available for this episode")
    ).toBeInTheDocument();
  });
});
