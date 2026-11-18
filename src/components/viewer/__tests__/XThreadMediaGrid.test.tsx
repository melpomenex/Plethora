import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { XThreadMediaGrid, isPlayableVideoUrl } from "../XThreadMediaGrid";
import type { TwitterMedia } from "../../../types/document";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  openExternal: vi.fn(),
}));

const docsApiMocks = vi.hoisted(() => ({
  cacheTwitterVideo: vi.fn(),
}));

const videoExtractsMocks = vi.hoisted(() => ({
  getVideoTranscript: vi.fn().mockResolvedValue(null),
}));

const transcriptionMocks = vi.hoisted(() => ({
  status: "none" as string,
  error: null as Error | null,
  progress: { percent: 0, message: "" },
  startTranscription: vi.fn().mockResolvedValue({ success: true }),
  retryTranscription: vi.fn().mockResolvedValue({ success: true }),
  cancelTranscription: vi.fn(),
  isProcessing: false,
  isCompleted: false,
  hasError: false,
  onComplete: undefined as (() => void) | undefined,
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => tauriMocks.isTauri(),
  openExternal: (url: string) => tauriMocks.openExternal(url),
}));

vi.mock("../../../api/documents", () => ({
  cacheTwitterVideo: (url: string, postId: string) => docsApiMocks.cacheTwitterVideo(url, postId),
}));

vi.mock("../../../api/video-extracts", () => ({
  getVideoTranscript: (docId: string) => videoExtractsMocks.getVideoTranscript(docId),
}));

vi.mock("../../transcription/useTranscriptionService", () => ({
  useTranscriptionService: (opts: { onComplete?: () => void }) => {
    transcriptionMocks.onComplete = opts.onComplete;
    return {
      status: transcriptionMocks.status,
      error: transcriptionMocks.error,
      progress: transcriptionMocks.progress,
      startTranscription: transcriptionMocks.startTranscription,
      retryTranscription: transcriptionMocks.retryTranscription,
      cancelTranscription: transcriptionMocks.cancelTranscription,
      isProcessing: transcriptionMocks.isProcessing,
      isCompleted: transcriptionMocks.isCompleted,
      hasError: transcriptionMocks.hasError,
    };
  },
}));

vi.mock("../../transcription/TranscriptionKeyDialog", () => ({
  TranscriptionKeyDialog: () => null,
}));

vi.mock("../../transcription/TranscribeAudioDialog", () => ({
  TranscribeAudioDialog: () => null,
}));

vi.mock("../../common/Modal", () => ({
  ModalType: { Custom: "custom" },
  useModal: () => ({ custom: vi.fn() }),
}));

const sampleVideo: TwitterMedia = {
  kind: "video",
  mediaUrl: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/clip.mp4",
  thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/thumb.jpg",
  aspectRatio: 16 / 9,
};

const sampleGif: TwitterMedia = {
  kind: "animated_gif",
  mediaUrl: "https://video.twimg.com/tweet_video/abc.mp4",
  thumbnailUrl: "https://pbs.twimg.com/tweet_video_thumb/abc.jpg",
  aspectRatio: 1,
};

describe("isPlayableVideoUrl", () => {
  it("accepts video.twimg.com mp4 URLs and rejects image/empty URLs", () => {
    expect(isPlayableVideoUrl(sampleVideo.mediaUrl)).toBe(true);
    expect(isPlayableVideoUrl("https://pbs.twimg.com/media/thumb.jpg")).toBe(false);
    expect(isPlayableVideoUrl("https://video.twimg.com/thumb.png?name=small")).toBe(false);
    expect(isPlayableVideoUrl("")).toBe(false);
    expect(isPlayableVideoUrl(null)).toBe(false);
  });
});

describe("XThreadMediaGrid video playback & transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.isTauri.mockReturnValue(false);
    videoExtractsMocks.getVideoTranscript.mockResolvedValue(null);
    transcriptionMocks.status = "none";
    transcriptionMocks.error = null;
    transcriptionMocks.isProcessing = false;
  });

  it("renders inline video + Transcribe video button for video posts, and omits Transcribe for GIFs", () => {
    const { rerender } = render(
      <XThreadMediaGrid media={[sampleVideo]} postId="123" documentId="doc-123" documentTitle="X Post" />
    );

    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("src")).toBe(sampleVideo.mediaUrl);
    expect(screen.getByRole("button", { name: /transcribe video/i })).toBeInTheDocument();

    rerender(<XThreadMediaGrid media={[sampleGif]} postId="124" documentId="doc-124" />);
    expect(screen.queryByRole("button", { name: /transcribe video/i })).not.toBeInTheDocument();
  });

  it("caches and streams via loopback media_server in Tauri mode", async () => {
    tauriMocks.isTauri.mockReturnValue(true);
    docsApiMocks.cacheTwitterVideo.mockResolvedValue({
      localPath: "/tmp/videos/x-cache-123.mp4",
      streamUrl: "http://127.0.0.1:45678/stream?path=%2Ftmp%2Fvideos%2Fx-cache-123.mp4",
    });

    render(<XThreadMediaGrid media={[sampleVideo]} postId="123" documentId="doc-123" />);

    expect(screen.getByText(/loading video/i)).toBeInTheDocument();

    await waitFor(() => {
      const video = document.querySelector("video");
      expect(video).toBeTruthy();
      expect(video?.getAttribute("src")).toBe(
        "http://127.0.0.1:45678/stream?path=%2Ftmp%2Fvideos%2Fx-cache-123.mp4"
      );
    });
    expect(docsApiMocks.cacheTwitterVideo).toHaveBeenCalledWith(sampleVideo.mediaUrl, "123");
  });

  it("shows Retry and Open on X fallback when video element fires error", () => {
    render(<XThreadMediaGrid media={[sampleVideo]} postId="123" documentId="doc-123" />);
    const video = document.querySelector("video")!;
    fireEvent.error(video);

    expect(screen.getByText(/couldn't be played inline/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open on x/i })).toBeInTheDocument();
  });

  it("loads existing transcript and lets user expand and seek timestamps", async () => {
    videoExtractsMocks.getVideoTranscript.mockResolvedValue({
      documentId: "doc-123",
      transcript: "Hello world. Second sentence.",
      segments: [
        { time: 0, text: "Hello world." },
        { time: 65, text: "Second sentence." },
      ],
    });

    render(<XThreadMediaGrid media={[sampleVideo]} postId="123" documentId="doc-123" />);

    const toggleBtn = await screen.findByRole("button", { name: /show transcript/i });
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId("x-video-transcript-panel")).toBeInTheDocument();
    expect(screen.getByText("Hello world.")).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
  });

  it("starts transcription when Transcribe video is clicked", async () => {
    render(<XThreadMediaGrid media={[sampleVideo]} postId="123" documentId="doc-123" />);
    const btn = screen.getByRole("button", { name: /transcribe video/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(transcriptionMocks.startTranscription).toHaveBeenCalledTimes(1);
    });
  });
});
