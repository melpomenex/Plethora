import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PodcastTranscriptViewer } from "../PodcastTranscriptViewer";
import type { TranscriptSegment } from "../../media/TranscriptSync";
import type { PodcastAdInterval } from "../../../types/podcastAd";

describe("PodcastTranscriptViewer", () => {
  const mockSegments: TranscriptSegment[] = [
    {
      id: "seg-1",
      start: 0,
      end: 15,
      text: "Welcome to the show everyone.",
    },
    {
      id: "seg-2",
      start: 15,
      end: 45,
      text: "Today's episode is brought to you by BestSponsor! Use code SHOW at checkout.",
    },
    {
      id: "seg-3",
      start: 45,
      end: 80,
      text: "Now let's dive into the main topic of today's conversation.",
    },
  ];

  const mockAds: PodcastAdInterval[] = [
    {
      id: "ad-1",
      episodeId: "ep-1",
      mediaRevision: "rev-1",
      startMs: 15000,
      endMs: 45000,
      category: "external_ad",
      confidence: 0.95,
      origin: "classifier_llm",
    },
  ];

  it("renders in Clean mode by default: collapses ad segment with a skipped pill", () => {
    render(
      <PodcastTranscriptViewer
        episodeId="ep-1"
        segments={mockSegments}
        adIntervals={mockAds}
        currentTime={5}
        initialMode="clean"
      />
    );

    // Clean segments are rendered
    expect(screen.getByText("Welcome to the show everyone.")).toBeInTheDocument();
    expect(screen.getByText("Now let's dive into the main topic of today's conversation.")).toBeInTheDocument();

    // Ad segment text is collapsed in clean mode
    expect(screen.queryByText(/Today's episode is brought to you by BestSponsor/)).not.toBeInTheDocument();

    // Collapsed pill is displayed
    expect(screen.getByTestId("ad-collapsed-pill")).toBeInTheDocument();
    expect(screen.getByText(/Sponsor segment skipped/)).toBeInTheDocument();
  });

  it("switches to Verbatim mode: reveals ad segment with sponsor badge and warning styling", () => {
    render(
      <PodcastTranscriptViewer
        episodeId="ep-1"
        segments={mockSegments}
        adIntervals={mockAds}
        currentTime={5}
        initialMode="clean"
      />
    );

    // Switch to Verbatim mode
    fireEvent.click(screen.getByTestId("mode-verbatim-btn"));

    // Ad segment is now visible
    expect(screen.getByText(/Today's episode is brought to you by BestSponsor/)).toBeInTheDocument();

    // Sponsor badge is shown
    const badge = screen.getByTestId("sponsor-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent?.toLowerCase()).toContain("external ad");

    // Collapsed pill is gone
    expect(screen.queryByTestId("ad-collapsed-pill")).not.toBeInTheDocument();
  });

  it("calls onSeek when a segment or seek past button is clicked", () => {
    const handleSeek = vi.fn();
    render(
      <PodcastTranscriptViewer
        episodeId="ep-1"
        segments={mockSegments}
        adIntervals={mockAds}
        currentTime={5}
        initialMode="clean"
        onSeek={handleSeek}
      />
    );

    // Click first segment to seek to start
    fireEvent.click(screen.getByTestId("transcript-segment-seg-1"));
    expect(handleSeek).toHaveBeenCalledWith(0);

    // Click seek past on collapsed pill
    const seekPastBtn = screen.getByText("Seek past");
    fireEvent.click(seekPastBtn);
    expect(handleSeek).toHaveBeenCalledWith(45);
  });
});
