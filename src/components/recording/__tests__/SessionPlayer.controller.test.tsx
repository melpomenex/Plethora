import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionPlayer } from "../SessionPlayer";
import { LearningStudio } from "../LearningStudio";
import { GlobalAudioController } from "../../../services/audio/globalAudioController";
import { AudioPlaybackPersistence } from "../../../services/audio/audioPlaybackPersistence";
import { AudioPlaybackException } from "../../../services/audio/audioErrors";
import { resetAudioRuntimeForTests } from "../../../services/audio/audioRuntime";
import { withAudioBoundaries } from "../../../services/audio/audioCoordinates";
import type { AudioEngine, AudioEngineEvents, AudioEngineSample } from "../../../services/audio/htmlAudioEngine";
import type { AudioSourceKey, ResolvedAudioItem, ResolvedAudioPart } from "../../../types/audioEdition";
import type {
  RecordingSession,
  SessionMediaAsset,
  SessionTranscriptSegment,
} from "../../../types/recordingSession";

vi.mock("../../../services/audio/audioPlaybackRollout", () => ({
  GLOBAL_AUDIO_PLAYBACK_ENABLED: true,
}));

const i18nT = vi.hoisted(() => (key: string, fallback?: string) => fallback ?? key);
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: i18nT,
    locale: "en",
  }),
}));

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => false),
  isNativeAndroid: vi.fn(() => false),
  invokeCommand: vi.fn(async () => null),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: tauriMocks.isTauri,
    isNativeMobile: tauriMocks.isNativeMobile,
    isNativeAndroid: tauriMocks.isNativeAndroid,
    invokeCommand: tauriMocks.invokeCommand,
  };
});

const recordingApiMocks = vi.hoisted(() => ({
  findSessionByDocumentId: vi.fn(),
  getRecordingSession: vi.fn(),
  getRecordingAsset: vi.fn(),
  getRecordingMediaPath: vi.fn(),
  getSessionSegments: vi.fn(),
  listSessionMarkers: vi.fn(),
  listSessionLearningDrafts: vi.fn(),
  listSessionRelatedDocuments: vi.fn(),
  correctSessionSegment: vi.fn(),
  updateSessionSpeaker: vi.fn(),
}));

vi.mock("../../../api/recordingSessions", () => recordingApiMocks);

const privacyMock = vi.hoisted(() => ({
  getDocumentPrivacy: vi.fn(async () => ({
    isLocalOnly: true,
    isAiExcluded: false,
    privacyVersion: 1,
  })),
}));

vi.mock("../../../lib/documentPrivacy", () => privacyMock);

class FakeEngine implements AudioEngine {
  src = "";
  currentTime = 0;
  duration: number | null = 180;
  paused = true;
  rate = 1;
  volume = 1;
  loads: ResolvedAudioPart[] = [];
  seeks: number[] = [];
  events: AudioEngineEvents | null = null;

  async load(part: ResolvedAudioPart, events: AudioEngineEvents, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.loads.push(part);
    this.events = events;
    this.src = part.browserUrl ?? "";
    this.currentTime = 0;
    this.duration = part.durationSec ?? 180;
    this.paused = true;
    events.sample(this.sample());
  }

  async play(): Promise<void> {
    this.paused = false;
    this.events?.sample(this.sample());
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.events?.sample(this.sample());
  }

  seek(seconds: number): void {
    this.seeks.push(seconds);
    this.currentTime = seconds;
    this.events?.sample(this.sample());
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  sample(): AudioEngineSample {
    return {
      timeInPart: this.currentTime,
      durationSec: this.duration,
      paused: this.paused,
      seekable: true,
    };
  }

  unload(): void {
    this.paused = true;
    this.events = null;
  }

  dispose(): void {
    this.unload();
  }
}

const baseSession: RecordingSession = {
  id: "sess-ctrl-1",
  version: 1,
  documentId: "doc-rec-1",
  origin: "recorded",
  contentType: "lecture",
  profileJson: "{}",
  mediaAssetId: "asset-ready-1",
  transcriptId: 1,
  transcriptRevision: 1,
  overviewJson: null,
  overviewRevision: null,
  ingestionState: "saved",
  captureState: "saved",
  createdAt: "2026-10-20T12:00:00Z",
  updatedAt: "2026-10-20T12:00:00Z",
};

const readyAsset: SessionMediaAsset = {
  id: "asset-ready-1",
  sessionId: "sess-ctrl-1",
  kind: "original",
  relativePath: "recordings/sess-ctrl-1/consolidated.wav",
  sourceUrl: null,
  sourceAdapter: null,
  sha256: "sha-rec-1",
  state: "ready",
  durationMs: 180_000,
  byteLength: 4096,
  mime: "audio/wav",
  createdAt: "2026-10-20T12:00:00Z",
};

describe("SessionPlayer & LearningStudio (controller-backed)", () => {
  let engine: FakeEngine;
  let controller: GlobalAudioController;
  let clockMs: number;
  let missingSourceIds: Set<string>;

  beforeEach(async () => {
    vi.clearAllMocks();
    clockMs = 1_700_000_000_000;
    missingSourceIds = new Set();
    engine = new FakeEngine();

    recordingApiMocks.findSessionByDocumentId.mockResolvedValue(baseSession);
    recordingApiMocks.getRecordingSession.mockResolvedValue(baseSession);
    recordingApiMocks.getRecordingAsset.mockResolvedValue(readyAsset);
    recordingApiMocks.getRecordingMediaPath.mockResolvedValue("/app-data/recordings/sess-ctrl-1/consolidated.wav");
    recordingApiMocks.listSessionMarkers.mockResolvedValue([]);
    recordingApiMocks.listSessionLearningDrafts.mockResolvedValue({ items: [], total: 0, hasMore: false });
    recordingApiMocks.listSessionRelatedDocuments.mockResolvedValue([]);
    recordingApiMocks.getSessionSegments.mockResolvedValue({ items: [], revision: 1 });

    controller = new GlobalAudioController({
      now: () => clockMs,
      createEngine: () => engine,
      resolve: async (key: AudioSourceKey): Promise<ResolvedAudioItem> => {
        if (missingSourceIds.has(key.sourceId)) {
          throw new AudioPlaybackException("source_missing", "Recording file missing on disk");
        }
        return {
          sourceKey: { ...key },
          title: key.kind === "audiobook" ? "Active Audiobook" : "Systems Seminar Recording",
          documentId: key.kind === "recording" ? "doc-rec-1" : key.sourceId,
          mediaRevision: `rev-${key.sourceId}`,
          complete: true,
          parts: withAudioBoundaries([
            {
              partId: `part-${key.sourceId}`,
              sourceRevision: `rev-${key.sourceId}`,
              browserUrl: `http://127.0.0.1:19999/media/${key.sourceId}.wav`,
              durationSec: 180,
            },
          ]),
        };
      },
      persistence: new AudioPlaybackPersistence({
        commit: async () => undefined,
        onError: () => undefined,
      }),
    });

    await resetAudioRuntimeForTests(controller);
  });

  afterEach(async () => {
    await resetAudioRuntimeForTests(null);
  });

  it("handles transcript-only, missing, partial, and ready states with zero <audio> elements", async () => {
    const transcriptOnly = render(
      <SessionPlayer
        session={{ ...baseSession, mediaAssetId: null }}
        mediaAsset={null}
      />,
    );
    expect(screen.getByTestId("session-player-transcript-only")).toBeInTheDocument();
    expect(transcriptOnly.container.querySelector("audio")).toBeNull();
    expect(controller.getSnapshot()).toBeNull();
    transcriptOnly.unmount();

    const missingView = render(
      <SessionPlayer
        session={baseSession}
        mediaAsset={{ ...readyAsset, state: "missing" }}
      />,
    );
    expect(screen.getByTestId("session-player-missing-media")).toBeInTheDocument();
    expect(controller.getSnapshot()).toBeNull();
    missingView.unmount();

    const partialView = render(
      <SessionPlayer
        session={{ ...baseSession, captureState: "recording" }}
        mediaAsset={{ ...readyAsset, state: "partial" }}
      />,
    );
    expect(screen.getByTestId("session-player")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    const partialPlay = screen.getByRole("button", { name: "Play" });
    expect(partialPlay).toBeDisabled();
    fireEvent.click(partialPlay);
    expect(controller.getSnapshot()).toBeNull();
    partialView.unmount();

    // Runtime source_missing on load transitions cleanly to missing-media card
    missingSourceIds.add("sess-missing-disk");
    const runtimeMissing = render(
      <SessionPlayer
        session={{ ...baseSession, id: "sess-missing-disk" }}
        mediaAsset={{ ...readyAsset, sessionId: "sess-missing-disk" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(screen.getByTestId("session-player-missing-media")).toBeInTheDocument();
    });
    runtimeMissing.unmount();

    // Ready state: zero <audio>, speed cycling, mute, skip
    const readyView = render(<SessionPlayer session={baseSession} mediaAsset={readyAsset} />);
    expect(readyView.container.querySelector("audio")).toBeNull();
    expect(tauriMocks.invokeCommand).not.toHaveBeenCalledWith("get_media_stream_url", expect.anything());

    const speedBtn = screen.getByRole("button", { name: "Playback speed: 1x" });
    fireEvent.click(speedBtn);
    expect(screen.getByRole("button", { name: "Playback speed: 1.25x" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(controller.getSnapshot()?.sourceKey.sourceId).toBe("sess-ctrl-1");
      expect(controller.getSnapshot()?.state).toBe("playing");
      expect(controller.getSnapshot()?.playbackRate).toBe(1.25);
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("passively mounts LearningStudio without interrupting active audiobook playback until user clicks Play", async () => {
    await act(async () => {
      await controller.load(
        { profileKey: "local", kind: "audiobook", sourceId: "book-active-1" },
        { intent: "play", explicitPosition: 64 },
      );
    });
    expect(controller.getSnapshot()?.sourceKey.sourceId).toBe("book-active-1");
    expect(controller.getSnapshot()?.state).toBe("playing");

    render(
      <LearningStudio
        documentId="doc-rec-1"
        documentTitle="Systems Seminar"
        session={baseSession}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("session-player-playing-elsewhere")).toHaveTextContent(
        "Playing elsewhere: Active Audiobook",
      );
    });

    // Opening LearningStudio passively (initialSeekTimeSec defaults to 0) MUST NOT clobber book-active-1!
    expect(controller.getSnapshot()?.sourceKey.sourceId).toBe("book-active-1");
    expect(controller.getSnapshot()?.positionSec).toBe(64);
    expect(controller.getSnapshot()?.state).toBe("playing");

    // Clicking Play on the SessionPlayer explicitly takes over into the recording session
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(controller.getSnapshot()?.sourceKey).toEqual({
        profileKey: "local",
        kind: "recording",
        sourceId: "sess-ctrl-1",
      });
      expect(controller.getSnapshot()?.state).toBe("playing");
    });
  });

  it("supports transcript segment seeks and preserves playback continuity across LearningStudio -> Notes -> LearningStudio", async () => {
    const segments: SessionTranscriptSegment[] = [
      {
        segmentKey: "s1",
        transcriptId: 1,
        ordinal: 0,
        revision: 1,
        speakerId: "Speaker 1",
        text: "Consensus protocols guarantee safety under asynchrony.",
        confidence: 0.98,
        timing: { kind: "measured", startMs: 42_000, endMs: 49_000 },
      },
    ];
    recordingApiMocks.getSessionSegments.mockResolvedValue({ items: segments, revision: 1 });

    const studio = render(
      <LearningStudio
        documentId="doc-rec-1"
        documentTitle="Systems Seminar"
        session={baseSession}
        initialTab="transcript"
        initialSeekTimeSec={15}
      />,
    );

    // Initial deep-link seek (15s) loads paused at 15s when nothing else is playing
    await waitFor(() => {
      expect(controller.getSnapshot()?.sourceKey.sourceId).toBe("sess-ctrl-1");
      expect(controller.getSnapshot()?.positionSec).toBe(15);
      expect(controller.getSnapshot()?.state).toBe("paused");
    });

    // Start playback
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(controller.getSnapshot()?.state).toBe("playing");
    });

    // Click transcript timestamp "Jump to 0:42"
    const jumpBtn = await screen.findByRole("button", { name: "Jump to 0:42" });
    fireEvent.click(jumpBtn);
    await waitFor(() => {
      expect(controller.getSnapshot()?.positionSec).toBe(42);
    });

    // Advance playback to 60s, then click the SAME transcript timestamp "Jump to 0:42" again
    act(() => {
      clockMs += 1_500;
      engine.currentTime = 60;
      engine.events?.sample(engine.sample());
    });
    expect(controller.getSnapshot()?.positionSec).toBe(60);

    fireEvent.click(jumpBtn);
    await waitFor(() => {
      expect(controller.getSnapshot()?.positionSec).toBe(42);
    });

    // Navigate away to Notes (unmount LearningStudio) — playback MUST continue uninterrupted!
    const loadsBeforeUnmount = engine.loads.length;
    studio.unmount();
    expect(controller.getSnapshot()?.state).toBe("playing");
    expect(engine.paused).toBe(false);

    // Time advances while user is taking notes outside LearningStudio
    act(() => {
      clockMs += 2_000;
      engine.currentTime = 115;
      engine.events?.sample(engine.sample());
    });
    expect(controller.getSnapshot()?.positionSec).toBe(115);

    // Return to LearningStudio (even with original initialSeekTimeSec={15} tab prop!)
    render(
      <LearningStudio
        documentId="doc-rec-1"
        documentTitle="Systems Seminar"
        session={baseSession}
        initialTab="overview"
        initialSeekTimeSec={15}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(screen.getByText("1:55")).toBeInTheDocument();
    });

    // Must NOT have reloaded the engine or re-applied stale initialSeekTimeSec=15!
    expect(engine.loads.length).toBe(loadsBeforeUnmount);
    expect(controller.getSnapshot()?.positionSec).toBe(115);
    expect(controller.getSnapshot()?.state).toBe("playing");
  });
});
