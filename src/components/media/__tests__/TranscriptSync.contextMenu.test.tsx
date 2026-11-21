import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TranscriptSync, type TranscriptSegment } from "../TranscriptSync";

const createVideoExtractMock = vi.fn();
const createExtractMock = vi.fn();
const exportTranscriptToFileMock = vi.fn();

vi.mock("../../../api/video-extracts", () => ({
  createVideoExtract: (...args: unknown[]) => createVideoExtractMock(...args),
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: (...args: unknown[]) => createExtractMock(...args),
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

const sampleSegments: TranscriptSegment[] = [
  {
    id: "seg-0",
    start: 12.2,
    end: 18.4,
    speaker: "Host",
    text: "First idea about spaced repetition",
  },
  {
    id: "seg-1",
    start: 18.4,
    end: 25.9,
    speaker: "Guest",
    text: "Second sentence explaining active recall",
  },
];

describe("TranscriptSync context menu, extraction, and export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createVideoExtractMock.mockResolvedValue({ id: "ve-1" });
    createExtractMock.mockResolvedValue({ id: "ext-1" });
    exportTranscriptToFileMock.mockReturnValue({
      filename: "transcript.srt",
      content: "1\n...",
      mimeType: "application/x-subrip;charset=utf-8",
    });
    window.getSelection()?.removeAllRanges();
  });

  it("opens right-click context menu on a transcript block and creates an extract or seeks", async () => {
    const onSeek = vi.fn();
    render(
      <TranscriptSync
        segments={sampleSegments}
        currentTime={0}
        documentId="doc-video-1"
        onSeek={onSeek}
      />
    );

    const row0 = screen.getByTestId("transcript-sync-segment-seg-0");
    fireEvent.contextMenu(row0, { clientX: 120, clientY: 160 });

    expect(screen.getByRole("menuitem", { name: "Create Extract" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Capture Video Slice \[00:12 - 00:19\]/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Play from Here \(0:12\)/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy Segment Text" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy with Timestamp" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy Full Transcript" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Export Transcript" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Create Extract" }));

    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith({
        document_id: "doc-video-1",
        content: "First idea about spaced repetition",
        note: "[00:12 - 00:19]",
      });
    });
  });

  it("targets active text selection when right-clicking a transcript block", async () => {
    render(
      <TranscriptSync
        segments={sampleSegments}
        currentTime={0}
        documentId="doc-video-1"
      />
    );

    const span0 = document.querySelector('[data-segment-index="0"]')!;
    const span1 = document.querySelector('[data-segment-index="1"]')!;
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "spaced repetition Second sentence",
      anchorNode: span0,
      focusNode: span1,
      removeAllRanges: vi.fn(),
    } as unknown as Selection);

    const row0 = screen.getByTestId("transcript-sync-segment-seg-0");
    fireEvent.contextMenu(row0, { clientX: 100, clientY: 140 });

    expect(screen.getByRole("menuitem", { name: "Copy Selection" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Capture Video Slice \[00:12 - 00:26\]/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Create Extract" }));

    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith({
        document_id: "doc-video-1",
        content: "spaced repetition Second sentence",
        note: "[00:12 - 00:26]",
      });
    });
  });

  it("shows both Create Extract and Capture Video Slice in the selection floating bar", async () => {
    render(
      <TranscriptSync
        segments={sampleSegments}
        currentTime={15}
        documentId="doc-video-1"
      />
    );

    const span0 = document.querySelector('[data-segment-index="0"]')!;
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "First idea about spaced repetition",
      anchorNode: span0,
      focusNode: span0,
      removeAllRanges: vi.fn(),
    } as unknown as Selection);

    const scrollContainer = document.querySelector('[data-transcript-scroll="true"]')!;
    fireEvent.mouseUp(scrollContainer);

    const createExtractBtn = await screen.findByRole("button", { name: /^Create Extract$/i });
    const captureSliceBtn = await screen.findByRole("button", {
      name: /Capture Video Slice \[00:12 - 00:19\]/i,
    });
    expect(createExtractBtn).toBeInTheDocument();
    expect(captureSliceBtn).toBeInTheDocument();

    fireEvent.click(createExtractBtn);
    await waitFor(() => {
      expect(createExtractMock).toHaveBeenCalledWith({
        document_id: "doc-video-1",
        content: "First idea about spaced repetition",
        note: "[00:12 - 00:19]",
      });
    });
  });

  it("always renders the header Export button and exports in the chosen format", () => {
    render(<TranscriptSync segments={sampleSegments} currentTime={0} />);

    const exportBtn = screen.getByRole("button", { name: /Export transcript/i });
    fireEvent.click(exportBtn);

    const srtItem = screen.getByRole("menuitem", { name: /SRT Subtitles \(\.srt\)/i });
    fireEvent.click(srtItem);

    expect(exportTranscriptToFileMock).toHaveBeenCalledWith(
      sampleSegments,
      "srt",
      expect.objectContaining({
        title: "Transcript",
        includeTimestamps: true,
        includeSpeakers: true,
      })
    );
  });
});
