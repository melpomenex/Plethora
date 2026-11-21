import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TranscriptPanel } from "../TranscriptPanel";
import { PodcastTranscriptViewer } from "../../podcast/PodcastTranscriptViewer";
import { SessionTranscript } from "../../recording/SessionTranscript";
import { useTranscriptionStore } from "../../../stores/useTranscriptionStore";

const createExtractMock = vi.fn();
const exportTranscriptToFileMock = vi.fn();
const getSessionSegmentsMock = vi.fn();

vi.mock("../../../api/extracts", () => ({
  createExtract: (...args: unknown[]) => createExtractMock(...args),
}));

vi.mock("../../../api/recordingSessions", () => ({
  getSessionSegments: (...args: unknown[]) => getSessionSegmentsMock(...args),
  correctSessionSegment: vi.fn(),
  updateSessionSpeaker: vi.fn(),
}));

vi.mock("../../../utils/transcriptExport", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/transcriptExport")>(
    "../../../utils/transcriptExport"
  );
  return {
    ...actual,
    exportTranscriptToFile: (...args: unknown[]) => exportTranscriptToFileMock(...args),
  };
});

describe("TranscriptPanel, PodcastTranscriptViewer, and SessionTranscript context menus & export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createExtractMock.mockResolvedValue({ id: "ext-1" });
    exportTranscriptToFileMock.mockReturnValue({
      filename: "transcript.md",
      content: "# Transcript",
      mimeType: "text/markdown;charset=utf-8",
    });
    window.getSelection()?.removeAllRanges();
  });

  it("TranscriptPanel opens context menu on right-click, creates extract, seeks, and exports", async () => {
    useTranscriptionStore.setState({
      activeSegments: [
        { start_ms: 5000, end_ms: 10000, text: "Audiobook chapter opening segment" },
      ],
      loadTranscript: vi.fn(),
    } as any);

    const onSeek = vi.fn();
    render(
      <TranscriptPanel
        bookId="book-1"
        chapterId="ch-1"
        currentTimeMs={0}
        onSeek={onSeek}
      />
    );

    const segRow = screen.getByTestId("transcript-panel-segment-0");
    fireEvent.contextMenu(segRow, { clientX: 80, clientY: 120 });

    expect(screen.getByRole("menuitem", { name: "Create Extract" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Play from Here/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Create Extract" }));

    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: "book-1",
          content: "Audiobook chapter opening segment",
        })
      );
    });

    // Export from header
    fireEvent.click(screen.getByRole("button", { name: /Export transcript/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Markdown \(\.md\)/i }));
    expect(exportTranscriptToFileMock).toHaveBeenCalledWith(
      expect.any(Array),
      "md",
      expect.objectContaining({ title: "Transcript-ch-1" })
    );
  });

  it("PodcastTranscriptViewer opens context menu on right-click, creates extract, seeks, and exports", async () => {
    const onSeek = vi.fn();
    render(
      <PodcastTranscriptViewer
        episodeId="ep-42"
        documentId="doc-ep-42"
        currentTime={0}
        onSeek={onSeek}
        segments={[
          {
            id: "pseg-1",
            start: 30,
            end: 45,
            speaker: "Host",
            text: "Podcast insight on spaced repetition",
          },
        ]}
      />
    );

    const segRow = screen.getByTestId("transcript-segment-pseg-1");
    fireEvent.contextMenu(segRow, { clientX: 100, clientY: 150 });

    expect(screen.getByRole("menuitem", { name: "Create Extract" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Play from Here \(0:30\)/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Create Extract" }));

    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith({
        document_id: "doc-ep-42",
        content: "Podcast insight on spaced repetition",
        note: "[0:30 - 0:45]",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /Export transcript/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /WebVTT \(\.vtt\)/i }));
    expect(exportTranscriptToFileMock).toHaveBeenCalledWith(
      expect.any(Array),
      "vtt",
      expect.objectContaining({ title: "Podcast-ep-42" })
    );
  });

  it("SessionTranscript opens context menu on right-click, creates extract with evidence, edits segment, and exports", async () => {
    getSessionSegmentsMock.mockResolvedValueOnce({
      revision: 1,
      nextCursor: undefined,
      items: [
        {
          segmentKey: "s-0",
          transcriptId: 10,
          revision: 1,
          ordinal: 0,
          text: "Recorded lecture key takeaway",
          speakerId: "Prof",
          timing: { kind: "measured", startMs: 15000, endMs: 22000 },
        },
      ],
    });

    const onSeek = vi.fn();
    render(
      <SessionTranscript
        session={{
          id: "sess-1",
          documentId: "doc-sess-1",
          title: "CS Lecture 1",
          status: "ready",
          sourceKind: "imported_audio",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as any}
        currentTimeSec={0}
        onSeek={onSeek}
      />
    );

    const segRow = await screen.findByTestId("segment-s-0");
    fireEvent.contextMenu(segRow, { clientX: 90, clientY: 130 });

    expect(screen.getByRole("menuitem", { name: "Create Extract" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit Segment" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Play from Here/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Create Extract" }));

    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: "doc-sess-1",
          content: "Recorded lecture key takeaway",
        })
      );
    });

    // Export from header
    fireEvent.click(screen.getByRole("button", { name: /Export transcript/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /JSON \(\.json\)/i }));
    expect(exportTranscriptToFileMock).toHaveBeenCalledWith(
      expect.any(Array),
      "json",
      expect.objectContaining({ title: "CS Lecture 1" })
    );
  });
});
