import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMediaCompatibility } from "../useMediaCompatibility";

const mockInspectLocalMedia = vi.fn();
const mockGetMediaRuntimeCapabilities = vi.fn();
const mockPlanMediaPlayback = vi.fn();
const mockStartMediaCompatibilityJob = vi.fn();
const mockStartMediaStreamSession = vi.fn();
const mockStopMediaStreamSession = vi.fn();

vi.mock("../../lib/tauri", () => ({
  isTauri: () => true,
}));

vi.mock("../../lib/media/capabilities", () => ({
  detectDeclaredSupport: () => ({
    containers: {},
    h264: "supported",
    hevc: "supported",
    av1: "unknown",
    vp9: "supported",
    aac: "supported",
    ac3: "unknown",
    eac3: "unknown",
    dts: "unknown",
    truehd: "unknown",
    opus: "supported",
    flac: "supported",
    mp3: "supported",
    vorbis: "supported",
  }),
}));

vi.mock("../../api/mediaCompatibility", () => ({
  inspectLocalMedia: (...args: unknown[]) => mockInspectLocalMedia(...args),
  getMediaRuntimeCapabilities: (...args: unknown[]) => mockGetMediaRuntimeCapabilities(...args),
  planMediaPlayback: (...args: unknown[]) => mockPlanMediaPlayback(...args),
  startMediaCompatibilityJob: (...args: unknown[]) => mockStartMediaCompatibilityJob(...args),
  startMediaStreamSession: (...args: unknown[]) => mockStartMediaStreamSession(...args),
  stopMediaStreamSession: (...args: unknown[]) => mockStopMediaStreamSession(...args),
  cancelMediaCompatibilityJob: vi.fn(),
  getMediaCompatibilityArtifactUrl: vi.fn(),
  subscribeToMediaCompatibilityJobs: vi.fn().mockResolvedValue(() => {}),
}));

describe("useMediaCompatibility streaming mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInspectLocalMedia.mockResolvedValue({
      schemaVersion: 1,
      source: { fingerprint: "fp-movie-1" },
      probeStatus: "ok",
      container: "mkv",
      durationSeconds: 6782,
      videoStreams: [{ index: 0, codec: "hevc" }],
      audioStreams: [{ index: 1, codec: "aac" }],
      subtitleStreams: [{ index: 2, codec: "hdmv_pgs_subtitle", kind: "bitmap" }],
      chapters: [],
      isProtected: false,
      warnings: [],
      tool: {},
    });
    mockGetMediaRuntimeCapabilities.mockResolvedValue({
      platform: "linux",
      engine: "webkitgtk",
      ffmpeg: { available: true, ffprobeAvailable: true },
      demuxers: {},
      decoders: {},
      encoders: {},
      warnings: [],
    });
    mockStopMediaStreamSession.mockResolvedValue(undefined);
  });

  it("streams immediately on remux without starting a full-file conversion job and cleans up on unmount", async () => {
    mockPlanMediaPlayback.mockResolvedValue({
      schemaVersion: 1,
      planId: "plan-1",
      documentId: "doc-1",
      sourceFingerprint: "fp-movie-1",
      inspectionHash: "ih-1",
      strategy: "remux",
      deliveryMode: "stream",
      confidence: "certain",
      reasons: ["bitmap_subtitles_present"],
      subtitlePolicy: "strip_all",
      requiresConsent: false,
      consentReasons: [],
      limitations: [],
      canConvert: true,
    });
    mockStartMediaStreamSession.mockResolvedValue({
      sessionId: "sess-123",
      playlistUrl: "http://127.0.0.1:43210/media-stream/sess-123/playlist.m3u8",
      durationSeconds: 6782,
      segmentDurationSeconds: 6,
    });

    const { result, unmount } = renderHook(() =>
      useMediaCompatibility({
        documentId: "doc-1",
        filePath: "/movies/WarGames.mkv",
        mediaType: "video",
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });

    expect(mockStartMediaCompatibilityJob).not.toHaveBeenCalled();
    expect(mockStartMediaStreamSession).toHaveBeenCalledTimes(1);
    if (result.current.state.kind === "ready") {
      expect(result.current.state.artifactUrl).toBe(
        "http://127.0.0.1:43210/media-stream/sess-123/playlist.m3u8",
      );
    }

    unmount();
    expect(mockStopMediaStreamSession).toHaveBeenCalledWith("sess-123");
  });

  it("still requests consent for expensive video transcode before starting stream", async () => {
    mockPlanMediaPlayback.mockResolvedValue({
      schemaVersion: 1,
      planId: "plan-2",
      documentId: "doc-2",
      sourceFingerprint: "fp-movie-1",
      inspectionHash: "ih-2",
      strategy: "video_transcode",
      deliveryMode: "stream",
      confidence: "certain",
      reasons: [],
      subtitlePolicy: "strip_all",
      requiresConsent: true,
      consentReasons: ["video_transcode"],
      limitations: [],
      canConvert: true,
    });
    mockStartMediaStreamSession.mockResolvedValue({
      sessionId: "sess-456",
      playlistUrl: "http://127.0.0.1:43210/media-stream/sess-456/playlist.m3u8",
      durationSeconds: 6782,
      segmentDurationSeconds: 6,
    });

    const { result } = renderHook(() =>
      useMediaCompatibility({
        documentId: "doc-2",
        filePath: "/movies/WarGames.mkv",
        mediaType: "video",
        enabled: true,
      }),
    );

    await waitFor(() => {
      expect(result.current.state.kind).toBe("consent");
    });
    expect(mockStartMediaStreamSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmConsent();
    });

    await waitFor(() => {
      expect(result.current.state.kind).toBe("ready");
    });
    expect(mockStartMediaStreamSession).toHaveBeenCalledTimes(1);
  });
});
