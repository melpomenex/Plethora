import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWithProviders, waitFor } from "../../../test/utils";
import { LocalVideoPlayer } from "../LocalVideoPlayer";
import * as videoExtractsApi from "../../../api/video-extracts";

vi.mock("../../../api/video-extracts", () => ({
  getVideoTranscript: vi.fn(),
  getVideoExtracts: vi.fn().mockResolvedValue([]),
  createVideoExtract: vi.fn(),
  updateVideoExtract: vi.fn(),
  deleteVideoExtract: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  getDocumentAuto: vi.fn().mockResolvedValue(null),
  updateDocumentProgressAuto: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../api/sponsorblock", () => ({
  getSponsorBlockCuts: vi.fn().mockReturnValue([]),
  fetchSponsorBlockSegments: vi.fn().mockResolvedValue([]),
  extractVideoID: vi.fn().mockReturnValue(null),
  getCategoryDisplayName: vi.fn().mockReturnValue(""),
}));

vi.mock("../../../api/mediaCompatibility", () => ({
  probeMediaTransport: vi.fn().mockResolvedValue({ ok: true, mimeType: "video/mp4" }),
}));

describe("LocalVideoPlayer video context parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onVideoContextChange with formatted transcript when transcript exists", async () => {
    vi.mocked(videoExtractsApi.getVideoTranscript).mockResolvedValue({
      id: "tr-1",
      documentId: "doc-local-1",
      segments: [
        { time: 0, end: 15, text: "Opening remarks of the local recording." },
        { time: 15, end: 45, text: "Detailed explanation of the local video content." },
      ],
    });

    const onVideoContextChange = vi.fn();

    renderWithProviders(
      <LocalVideoPlayer
        src="file:///path/to/video.mp4"
        documentId="doc-local-1"
        title="Local Lecture"
        onVideoContextChange={onVideoContextChange}
      />
    );

    await waitFor(() => {
      expect(onVideoContextChange).toHaveBeenCalledWith(
        expect.objectContaining({
          videoId: "doc-local-1",
          title: "Local Lecture",
          transcriptStatus: "ready-full",
          transcript: expect.stringContaining("Opening remarks of the local recording."),
        })
      );
    });
  });
});
