import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  TranscriptSync,
  formatSliceTimestamp,
  resolveTranscriptSelectionBounds,
} from "../TranscriptSync";
import type { TranscriptSegment } from "../TranscriptSync";

const createVideoExtractMock = vi.fn();

vi.mock("../../../api/video-extracts", () => ({
  createVideoExtract: (...args: unknown[]) => createVideoExtractMock(...args),
}));

const sampleSegments: TranscriptSegment[] = [
  { id: "seg-0", start: 12.2, end: 18.4, text: "First idea about spaced repetition" },
  { id: "seg-1", start: 18.4, end: 25.9, text: "Second sentence explaining active recall" },
  { id: "seg-2", start: 26.0, end: 33.1, text: "Third sentence wrapping up the point" },
];

describe("TranscriptSliceExtraction", () => {
  beforeEach(() => {
    createVideoExtractMock.mockReset();
    createVideoExtractMock.mockResolvedValue({ id: "ve-1" });
    window.getSelection()?.removeAllRanges();
  });

  it("formats slice timestamps as mm:ss", () => {
    expect(formatSliceTimestamp(0)).toBe("00:00");
    expect(formatSliceTimestamp(12.2)).toBe("00:12");
    expect(formatSliceTimestamp(125)).toBe("02:05");
  });

  it("resolves exact timestamp bounds across multiple selected segment indices", () => {
    const bounds = resolveTranscriptSelectionBounds(sampleSegments, {
      startIndex: 0,
      endIndex: 1,
      text: "spaced repetition Second sentence",
    });

    expect(bounds).toEqual({
      startTime: 12,
      endTime: 26,
      transcriptText: "spaced repetition Second sentence",
    });
  });

  it("resolves timestamp bounds by text fallback when DOM indices are omitted", () => {
    const bounds = resolveTranscriptSelectionBounds(sampleSegments, {
      text: "active recall Third sentence",
    });

    expect(bounds).toEqual({
      startTime: 18,
      endTime: 34,
      transcriptText: "active recall Third sentence",
    });
  });

  it("shows Capture Video Slice button on selection and calls createVideoExtract", async () => {
    render(
      <TranscriptSync
        segments={sampleSegments}
        currentTime={15}
        documentId="doc-video-1"
      />
    );

    const row0 = document.querySelector('[data-segment-index="0"]')!;
    const row1 = document.querySelector('[data-segment-index="1"]')!;
    expect(row0).toBeTruthy();
    expect(row1).toBeTruthy();

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "spaced repetition Second sentence",
      anchorNode: row0,
      focusNode: row1,
      removeAllRanges: vi.fn(),
    } as unknown as Selection);

    const scrollContainer = document.querySelector('[data-transcript-scroll="true"]')!;
    fireEvent.mouseUp(scrollContainer);

    const captureBtn = await screen.findByRole("button", {
      name: /Capture Video Slice \[00:12 - 00:26\]/i,
    });
    expect(captureBtn).toBeInTheDocument();

    fireEvent.click(captureBtn);

    await waitFor(() => {
      expect(createVideoExtractMock).toHaveBeenCalledWith(
        expect.objectContaining({
          document_id: "doc-video-1",
          start_time: 12,
          end_time: 26,
          transcript_text: "spaced repetition Second sentence",
          add_to_queue: true,
        })
      );
    });
  });
});
