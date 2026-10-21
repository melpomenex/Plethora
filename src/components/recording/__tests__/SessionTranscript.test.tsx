import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionTranscript } from "../SessionTranscript";
import * as recordingSessionsApi from "../../../api/recordingSessions";
import type {
  RecordingSession,
  SessionTranscriptSegment,
  SessionSegmentPage,
} from "../../../types/recordingSession";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("../../../api/recordingSessions", () => ({
  getSessionSegments: vi.fn(),
}));

describe("SessionTranscript Component (Task 2.2 Canonical Transcript)", () => {
  const baseSession: RecordingSession = {
    id: "sess-transcript-1",
    version: 1,
    documentId: "doc-1",
    origin: "recorded",
    contentType: "lecture",
    profileJson: "{}",
    mediaAssetId: "asset-1",
    transcriptId: 1,
    transcriptRevision: 1,
    overviewJson: null,
    overviewRevision: null,
    ingestionState: "saved",
    captureState: "saved",
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
  };

  // Helper to generate N segments (supports up to 90 minutes / 5400s)
  function makeSegments(
    count: number,
    startOffsetSec = 0,
    speaker = "Speaker 1"
  ): SessionTranscriptSegment[] {
    return Array.from({ length: count }, (_, i) => {
      const idx = startOffsetSec + i;
      const startMs = idx * 10000; // 10s per segment
      const endMs = startMs + 9500;
      return {
        segmentKey: `seg-${idx}`,
        transcriptId: 1,
        ordinal: idx,
        revision: 1,
        text: `Segment ${idx}: Explaining distributed consensus algorithms and timing guarantees.`,
        timing: { kind: "measured", startMs, endMs },
        speakerId: speaker,
      };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads 200-row first page and appends next page upon pagination", async () => {
    const page1Segments = makeSegments(200, 0);
    const page2Segments = makeSegments(200, 200);

    vi.mocked(recordingSessionsApi.getSessionSegments).mockImplementation(
      async (_id, opts) => {
        if (opts?.cursor === "cursor-page-2") {
          return {
            items: page2Segments,
            revision: 1,
            nextCursor: undefined,
          };
        }
        return {
          items: page1Segments,
          revision: 1,
          nextCursor: "cursor-page-2",
        };
      }
    );

    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByTestId("segment-seg-0")).toBeInTheDocument();
      expect(screen.getByTestId("segment-seg-199")).toBeInTheDocument();
    });

    expect(screen.getByText(/200 segments loaded · Revision 1/i)).toBeInTheDocument();

    const loadMoreButton = screen.getByRole("button", { name: /Load next 200 segments/i });
    expect(loadMoreButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(loadMoreButton);
    });

    await waitFor(() => {
      expect(screen.getByTestId("segment-seg-399")).toBeInTheDocument();
    });

    expect(screen.getByText(/400 segments loaded · Revision 1/i)).toBeInTheDocument();
  });

  it("performs search navigation across segments with Next/Previous cue cycling", async () => {
    const segments: SessionTranscriptSegment[] = [
      {
        segmentKey: "seg-apple-1",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: "The apple fell from the tree.",
        timing: { kind: "measured", startMs: 0, endMs: 5000 },
        speakerId: "Isaac",
      },
      {
        segmentKey: "seg-orange",
        transcriptId: 1,
        ordinal: 1,
        revision: 1,
        text: "Oranges are citrus fruits.",
        timing: { kind: "measured", startMs: 5000, endMs: 10000 },
        speakerId: "Isaac",
      },
      {
        segmentKey: "seg-apple-2",
        transcriptId: 1,
        ordinal: 2,
        revision: 1,
        text: "Another apple was discovered later.",
        timing: { kind: "measured", startMs: 10000, endMs: 15000 },
        speakerId: "Isaac",
      },
    ];

    vi.mocked(recordingSessionsApi.getSessionSegments).mockResolvedValue({
      items: segments,
      revision: 1,
    });

    render(<SessionTranscript session={baseSession} />);

    await waitFor(() => {
      expect(screen.getByTestId("segment-seg-apple-1")).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText("Search transcript");
    fireEvent.change(searchInput, { target: { value: "apple" } });

    expect(screen.getByText("1/2")).toBeInTheDocument();

    // Next match
    const nextBtn = screen.getByLabelText("Next match");
    act(() => {
      fireEvent.click(nextBtn);
    });
    expect(screen.getByText("2/2")).toBeInTheDocument();

    // Clear search
    const clearBtn = screen.getByLabelText("Clear search");
    act(() => {
      fireEvent.click(clearBtn);
    });
    expect(searchInput).toHaveValue("");
  });

  it("syncs playback position up to 90-minute synthetic text navigation and seeks on click", async () => {
    // 90 minutes = 5400 seconds = segment 540 at 10s intervals
    const segments: SessionTranscriptSegment[] = [
      {
        segmentKey: "seg-start",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: "Beginning of the lecture.",
        timing: { kind: "measured", startMs: 0, endMs: 10000 },
      },
      {
        segmentKey: "seg-90m",
        transcriptId: 1,
        ordinal: 540,
        revision: 1,
        text: "At minute 90: conclusion of the seminar.",
        timing: { kind: "measured", startMs: 5400000, endMs: 5410000 },
      },
    ];

    vi.mocked(recordingSessionsApi.getSessionSegments).mockResolvedValue({
      items: segments,
      revision: 1,
    });

    const onSeek = vi.fn();
    const { rerender } = render(
      <SessionTranscript
        session={baseSession}
        currentTimeSec={0}
        onSeek={onSeek}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("segment-seg-start")).toBeInTheDocument();
    });

    // Advance time to 5405 seconds (90m 5s)
    rerender(
      <SessionTranscript
        session={baseSession}
        currentTimeSec={5405}
        onSeek={onSeek}
      />
    );

    // Active segment should have primary highlight
    const seg90El = screen.getByTestId("segment-seg-90m");
    expect(seg90El.className).toContain("bg-primary/10");

    // Click play/time button in segment
    const timeBtn = screen.getByRole("button", { name: "Jump to 1:30:00" });
    fireEvent.click(timeBtn);
    expect(onSeek).toHaveBeenCalledWith(5400);
  });

  it("handles honest untimed segments without inventing fake 0:00 precision", async () => {
    const segments: SessionTranscriptSegment[] = [
      {
        segmentKey: "seg-untimed-1",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        text: "Untimed transcript paragraph from imported notes.",
        timing: { kind: "none" },
      },
    ];

    vi.mocked(recordingSessionsApi.getSessionSegments).mockResolvedValue({
      items: segments,
      revision: 1,
    });

    const onSeek = vi.fn();
    const onSelectSegment = vi.fn();

    render(
      <SessionTranscript
        session={baseSession}
        currentTimeSec={10}
        onSeek={onSeek}
        onSelectSegment={onSelectSegment}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("segment-seg-untimed-1")).toBeInTheDocument();
    });

    // Verify "untimed" label is displayed instead of a fake 0:00 button
    expect(screen.getByText("untimed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jump to/i })).not.toBeInTheDocument();

    // Clicking row selects segment but does not invoke onSeek
    fireEvent.click(screen.getByTestId("segment-seg-untimed-1"));
    expect(onSelectSegment).toHaveBeenCalledWith(segments[0]);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("pauses auto-scroll follow on manual user scroll and resumes on button click", async () => {
    const segments = makeSegments(10);
    vi.mocked(recordingSessionsApi.getSessionSegments).mockResolvedValue({
      items: segments,
      revision: 1,
    });

    render(<SessionTranscript session={baseSession} currentTimeSec={0} />);

    await waitFor(() => {
      expect(screen.getByTestId("segment-seg-0")).toBeInTheDocument();
    });

    const scrollContainer = screen.getByLabelText("Transcript content");

    // Simulate user scroll
    act(() => {
      fireEvent.scroll(scrollContainer, { target: { scrollTop: 500 } });
    });

    // "Resume Follow" button should appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Resume Follow/i })).toBeInTheDocument();
    });

    // Click resume follow
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Resume Follow/i }));
    });

    expect(screen.queryByRole("button", { name: /Resume Follow/i })).not.toBeInTheDocument();
  });
});
