import { describe, expect, it } from "vitest";
import { classifyPlaybackFailure } from "../errorClassification";
import type {
  MediaInspection,
  MediaPlaybackPlan,
  MediaRuntimeCapabilities,
  MediaTransportProbe,
} from "../types";

const healthyProbe: MediaTransportProbe = {
  urlKind: "loopback_media_server",
  reachable: true,
  status: 206,
  contentType: "video/x-matroska",
  contentLength: 2,
  acceptRanges: "bytes",
  contentRange: "bytes 0-1/100",
  elapsedMs: 3,
  error: null,
};

function inspection(overrides: Partial<MediaInspection> = {}): MediaInspection {
  return {
    schemaVersion: 1,
    source: {
      pathLabel: "movie.mkv",
      pathHash: "abc123",
      fingerprint: "fp",
      sizeBytes: 100,
    },
    probeStatus: "ok",
    container: "matroska",
    durationSeconds: 100,
    videoStreams: [
      {
        index: 0,
        codec: "hevc",
        isAttachedPic: false,
        isDefault: true,
        hdr: { kind: "hdr10", bt2020: true, hdr10Plus: false, dolbyVision: null },
      },
    ],
    audioStreams: [
      {
        index: 1,
        codec: "dts",
        channels: 6,
        isDefault: false,
        isCommentary: false,
      },
    ],
    subtitleStreams: [
      {
        index: 2,
        codec: "hdmv_pgs_subtitle",
        kind: "bitmap",
        isDefault: true,
        isForced: false,
      },
    ],
    chapters: [],
    isProtected: false,
    warnings: [],
    tool: { ffprobeAvailable: true, ffmpegAvailable: true },
    ...overrides,
  };
}

function capabilities(overrides: Partial<MediaRuntimeCapabilities> = {}): MediaRuntimeCapabilities {
  return {
    schemaVersion: 1,
    platform: "linux",
    engine: "webkitgtk",
    evidence: ["gstreamer_registry"],
    runtimeFingerprint: "rt",
    checkedAt: new Date(0).toISOString(),
    decoders: { hevc: "supported", dts: "supported" },
    demuxers: { matroska: "supported" },
    subtitleSupport: {},
    encoders: {},
    ffmpeg: {
      available: true,
      ffprobeAvailable: true,
      hasLibx264: true,
      hasAac: true,
      hasZscale: true,
      hasTonemap: true,
      hardwareEncoders: [],
    },
    warnings: [],
    ...overrides,
  };
}

function plan(overrides: Partial<MediaPlaybackPlan> = {}): MediaPlaybackPlan {
  return {
    schemaVersion: 1,
    planId: "plan",
    documentId: "doc",
    sourceFingerprint: "fp",
    inspectionHash: "hash",
    strategy: "remux",
    confidence: "certain",
    reasons: ["bitmap_subtitles_present"],
    subtitlePolicy: "strip_all",
    requiresConsent: false,
    consentReasons: [],
    limitations: ["subtitles_not_rendered"],
    canConvert: true,
    ...overrides,
  };
}

describe("classifyPlaybackFailure", () => {
  it("never calls a healthy PGS playback failure source-access", () => {
    const failure = classifyPlaybackFailure({
      mediaErrorCode: 4,
      transport: healthyProbe,
      inspection: inspection(),
      capabilities: capabilities(),
      plan: plan(),
      strategy: "local-media-server",
    });
    expect(failure.code).toBe("bitmap_subtitle_unsupported");
    expect(failure.code).not.toBe("source_not_found");
    expect(failure.actions).toContain("convert");
  });

  it("classifies 403 from the transport probe as permission denied", () => {
    const failure = classifyPlaybackFailure({
      mediaErrorCode: 4,
      transport: { ...healthyProbe, status: 403 },
    });
    expect(failure.code).toBe("source_permission_denied");
  });

  it("classifies 404 as source-not-found", () => {
    const failure = classifyPlaybackFailure({
      transport: { ...healthyProbe, status: 404 },
    });
    expect(failure.code).toBe("source_not_found");
  });

  it("classifies 416 as an invalid range", () => {
    const failure = classifyPlaybackFailure({
      transport: { ...healthyProbe, status: 416 },
    });
    expect(failure.code).toBe("source_range_invalid");
  });

  it("does not infer source access when transport evidence is absent", () => {
    const failure = classifyPlaybackFailure({ mediaErrorCode: 4 });
    expect(failure.code).toBe("media_compatibility_indeterminate");
    expect(failure.code).not.toBe("source_not_found");
  });

  it("uses a known unsupported video decoder", () => {
    const failure = classifyPlaybackFailure({
      mediaErrorCode: 4,
      transport: healthyProbe,
      inspection: inspection({
        subtitleStreams: [],
        videoStreams: [
          {
            index: 0,
            codec: "hevc",
            isAttachedPic: false,
            isDefault: true,
            hdr: { kind: "hdr10", bt2020: true, hdr10Plus: false, dolbyVision: null },
          },
        ],
      }),
      capabilities: capabilities({ decoders: { hevc: "unsupported", dts: "supported" } }),
    });
    expect(failure.code).toBe("video_decoder_unavailable");
  });

  it("uses a known unsupported audio decoder while video is supported", () => {
    const failure = classifyPlaybackFailure({
      mediaErrorCode: 4,
      transport: healthyProbe,
      inspection: inspection({ subtitleStreams: [] }),
      capabilities: capabilities({ decoders: { hevc: "supported", dts: "unsupported" } }),
    });
    expect(failure.code).toBe("audio_decoder_unavailable");
  });

  it("keeps bitmap failures indeterminate off Linux/WebKitGTK", () => {
    const failure = classifyPlaybackFailure({
      mediaErrorCode: 4,
      transport: healthyProbe,
      inspection: inspection(),
      capabilities: capabilities({ platform: "android", engine: "android_webview", decoders: { hevc: "unknown", dts: "unknown" } }),
    });
    expect(failure.code).toBe("media_compatibility_indeterminate");
  });

  it("classifies abort as interrupted and non-retryable", () => {
    const failure = classifyPlaybackFailure({ aborted: true });
    expect(failure.code).toBe("playback_interrupted");
    expect(failure.retryable).toBe(false);
  });
});
