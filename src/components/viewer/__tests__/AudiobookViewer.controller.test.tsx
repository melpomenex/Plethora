import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudiobookViewer } from "../AudiobookViewer";
import { GlobalAudioController } from "../../../services/audio/globalAudioController";
import { AudioPlaybackPersistence } from "../../../services/audio/audioPlaybackPersistence";
import { resetAudioRuntimeForTests } from "../../../services/audio/audioRuntime";
import { withAudioBoundaries } from "../../../services/audio/audioCoordinates";
import { getActiveSession } from "../../../utils/listeningSessionService";
import type { AudioEngine, AudioEngineEvents } from "../../../services/audio/htmlAudioEngine";
import type { AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { Document } from "../../../types/document";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => false),
  invokeCommand: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "create_listening_session") {
      const session = (args?.session ?? {}) as Record<string, unknown>;
      return {
        ...session,
        id: String(session.id ?? "ls-1"),
        editionId: String(session.editionId ?? "ed"),
        startedAt: Number(session.startedAt ?? Date.now()),
        endedAt: null,
        durationSeconds: 0,
        extractCount: 0,
        isReviewed: 0,
      };
    }
    return null;
  }),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const transcriptionStoreState = vi.hoisted(() => ({
  profiles: [],
  fetchProfiles: vi.fn(async () => {}),
  currentStatus: null,
  activeJob: null,
  activeSegments: [],
  activeTranscriptBookId: null,
  activeTranscriptStatus: null,
  activeTranscriptChapterId: null,
  loadTranscript: vi.fn(async () => {}),
  transcriptionProgress: 0,
}));

const i18nT = vi.hoisted(() => (key: string) => key);

const positionMocks = vi.hoisted(() => ({
  getDocumentPosition: vi.fn(async () => null),
  saveDocumentPosition: vi.fn(async () => undefined),
  timePosition: vi.fn((seconds: number) => ({ type: "time", seconds })),
}));

const audiobookApiMocks = vi.hoisted(() => ({
  extractAudioCoverArt: vi.fn(async () => null),
  searchAudiobookCover: vi.fn(async () => []),
  prepareAudiobookPlayback: vi.fn(async (p: string) => p),
  parseAudiobookMetadata: vi.fn(async () => ({})),
  transcribeAudiobookWithGroq: vi.fn(),
  formatDuration: vi.fn((seconds: number) => `${Math.floor(seconds)}s`),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    invokeCommand: tauriMocks.invokeCommand,
    isNativeMobile: tauriMocks.isNativeMobile,
    isTauri: tauriMocks.isTauri,
    listen: tauriMocks.listen,
  };
});

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: i18nT,
    locale: "en",
  }),
}));

vi.mock("../../../lib/audiobookDiagnostics", () => ({
  logAudiobookDiagnostic: vi.fn(),
}));

vi.mock("../../../api/audiobooks", () => ({
  extractAudioCoverArt: audiobookApiMocks.extractAudioCoverArt,
  searchAudiobookCover: audiobookApiMocks.searchAudiobookCover,
  prepareAudiobookPlayback: audiobookApiMocks.prepareAudiobookPlayback,
  parseAudiobookMetadata: audiobookApiMocks.parseAudiobookMetadata,
  transcribeAudiobookWithGroq: audiobookApiMocks.transcribeAudiobookWithGroq,
  formatDuration: audiobookApiMocks.formatDuration,
}));

vi.mock("../../../api/sponsorblock", () => ({
  getSponsorBlockCuts: vi.fn(async () => []),
  fetchSponsorBlockSegments: vi.fn(async () => []),
  extractVideoID: vi.fn(() => null),
  getCategoryDisplayName: vi.fn((category: string) => category),
}));

vi.mock("../../../api/documents", () => ({
  readDocumentFile: vi.fn(),
  updateDocument: vi.fn(),
  updateDocumentProgressAuto: vi.fn(),
  updateDocumentContent: vi.fn(),
  getDocument: vi.fn(async () => null),
}));

vi.mock("../../../api/position", () => ({
  getDocumentPosition: positionMocks.getDocumentPosition,
  saveDocumentPosition: positionMocks.saveDocumentPosition,
  timePosition: positionMocks.timePosition,
}));

vi.mock("../../../api/podcast", () => ({
  getEpisodePosition: vi.fn(async () => 0),
  updateEpisodePosition: vi.fn(),
  markEpisodePlayed: vi.fn(async () => undefined),
  downloadEpisodeAudio: vi.fn(),
  getDownloadedEpisodePath: vi.fn(async () => null),
  getPodcastTranscript: vi.fn(async () => ({ status: "none", text: "", segments: [] })),
  transcribePodcastEpisode: vi.fn(),
  transcribePodcastEpisodeWithGroq: vi.fn(),
}));

vi.mock("../../../api/transcription", () => ({
  enqueueAutoTranscription: vi.fn(),
  getTranscriptionStatus: vi.fn(async () => null),
  getTranscriptionProfiles: vi.fn(async () => []),
  downloadTranscriptionModel: vi.fn(),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => toastMocks,
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../stores/useTranscriptionStore", () => ({
  useTranscriptionStore: Object.assign(
    (selector?: (value: typeof transcriptionStoreState) => unknown) =>
      selector ? selector(transcriptionStoreState) : transcriptionStoreState,
    { getState: () => transcriptionStoreState },
  ),
}));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
}));

vi.mock("../../../commandPalette/paletteActionEvents", () => ({
  usePaletteActionListener: () => {},
}));

vi.mock("../localMediaSource", () => ({
  resolveLocalMediaSource: vi.fn(),
}));

vi.mock("../media/KaraokeText", () => ({
  KaraokeText: () => null,
}));

vi.mock("../adaptive/ResponsiveDialogSheet", () => ({
  ResponsiveDialogSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeBookDocument(id = "book-1", title = "Controller Book"): Document {
  return {
    id,
    title,
    filePath: `/library/${id}.m4b`,
    fileType: "audio",
    tags: [],
    dateAdded: "2025-01-01T00:00:00.000Z",
    dateModified: "2025-01-01T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
  };
}

function createFakeOwnerHarness() {
  const sample = { timeInPart: 0, durationSec: 120 as number | null, paused: true, seekable: true };
  const events: AudioEngineEvents[] = [];
  const engine: AudioEngine = {
    sample: () => ({ ...sample }),
    load: vi.fn(async (_part, handlers) => {
      events.push(handlers);
      sample.timeInPart = 0;
    }),
    play: vi.fn(async () => {
      sample.paused = false;
    }),
    pause: vi.fn(async () => {
      sample.paused = true;
    }),
    seek: vi.fn((seconds: number) => {
      sample.timeInPart = seconds;
    }),
    setRate: vi.fn(),
    setVolume: vi.fn(),
    unload: vi.fn(),
    dispose: vi.fn(),
  };

  const titles: Record<string, string> = {
    "other-book": "Other Audiobook",
    "book-1": "Controller Book",
    "ep-99": "Episode 99",
  };

  const resolve = vi.fn(async (sourceKey: AudioSourceKey): Promise<ResolvedAudioItem> => ({
    sourceKey,
    title: titles[sourceKey.sourceId] ?? sourceKey.sourceId,
    editionId: sourceKey.kind === "audiobook" ? `ed-${sourceKey.sourceId}` : undefined,
    mediaRevision: "v1",
    complete: true,
    parts: withAudioBoundaries([
      {
        partId: "0",
        title: "Part 1",
        sourceRevision: "v1",
        browserUrl: `http://127.0.0.1:19999/${sourceKey.sourceId}.mp3`,
        durationSec: 120,
      },
    ]),
  }));

  let seq = 0;
  let clockMs = 1_000_000;
  const advanceClock = (ms: number) => {
    clockMs += ms;
  };
  const controller = new GlobalAudioController({
    createEngine: () => engine,
    resolve,
    persistence: new AudioPlaybackPersistence({ commit: vi.fn(async () => undefined) }),
    uuid: () => `incarnation-${++seq}`,
    now: () => clockMs,
  });

  return { controller, engine, events, sample, resolve, advanceClock };
}

describe("AudiobookViewer controllerBacked presentation (task 5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(async () => {
    await resetAudioRuntimeForTests(null);
  });

  it("mounts zero <audio> elements, skips viewer-owned transcode/save, and does not steal global Space keydown", async () => {
    const h = createFakeOwnerHarness();
    await resetAudioRuntimeForTests(h.controller);

    const { container, unmount } = render(
      <AudiobookViewer
        document={makeBookDocument("book-1")}
        controllerBacked
        autoPlayOnOpen
      />,
    );

    await waitFor(() => {
      expect(h.controller.getSnapshot()?.state).toBe("playing");
    });

    expect(container.querySelectorAll("audio")).toHaveLength(0);
    expect(audiobookApiMocks.prepareAudiobookPlayback).not.toHaveBeenCalled();

    // Global Space on document.body must not toggle playback when controllerBacked is true
    fireEvent.keyDown(window, { key: " " });
    expect(h.controller.getSnapshot()?.state).toBe("playing");

    unmount();
    expect(positionMocks.saveDocumentPosition).not.toHaveBeenCalled();
  });

  it("passively opens another audiobook while active audio keeps playing, then takes over only on explicit Play", async () => {
    const h = createFakeOwnerHarness();
    await resetAudioRuntimeForTests(h.controller);

    await h.controller.load(
      { profileKey: "local", kind: "audiobook", sourceId: "other-book" },
      { intent: "play" },
    );
    expect(h.engine.load).toHaveBeenCalledTimes(1);

    render(<AudiobookViewer document={makeBookDocument("book-1")} controllerBacked />);

    // Passive open shows non-destructive status notice and leaves other-book playing
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Playing elsewhere: Other Audiobook");
    expect(h.controller.getSnapshot()).toMatchObject({
      sourceKey: { profileKey: "local", kind: "audiobook", sourceId: "other-book" },
      state: "playing",
    });
    expect(h.engine.load).toHaveBeenCalledTimes(1);

    // Explicit takeover via the inline Play button switches the singleton owner
    const takeoverButton = status.querySelector("button")!;
    await act(async () => {
      fireEvent.click(takeoverButton);
    });

    await waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        sourceKey: { profileKey: "local", kind: "audiobook", sourceId: "book-1" },
        state: "playing",
      });
    });
    expect(h.engine.load).toHaveBeenCalledTimes(2);
  });

  it("forwards onDurationChange, onTimeUpdate, and onEpisodeEnded from owner subscriptions", async () => {
    const h = createFakeOwnerHarness();
    await resetAudioRuntimeForTests(h.controller);

    const onDurationChange = vi.fn();
    const onTimeUpdate = vi.fn();
    const onEpisodeEnded = vi.fn();

    render(
      <AudiobookViewer
        document={makeBookDocument("pod-doc-99", "Podcast Doc")}
        episodeId="ep-99"
        episodeTitle="Episode 99"
        controllerBacked
        autoPlayOnOpen
        initialSeekTime={15}
        onDurationChange={onDurationChange}
        onTimeUpdate={onTimeUpdate}
        onEpisodeEnded={onEpisodeEnded}
      />,
    );

    await waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        sourceKey: { profileKey: "local", kind: "podcast", sourceId: "ep-99" },
        state: "playing",
        positionSec: 15,
      });
    });
    expect(onDurationChange).toHaveBeenCalledWith(120);
    expect(onTimeUpdate).toHaveBeenCalledWith(15);

    await act(async () => {
      h.advanceClock(1500);
      h.sample.timeInPart = 48;
      h.events.at(-1)!.sample(h.sample);
    });
    expect(onTimeUpdate).toHaveBeenCalledWith(48);

    await act(async () => {
      h.events.at(-1)!.ended();
    });
    await waitFor(() => {
      expect(onEpisodeEnded).toHaveBeenCalledTimes(1);
    });
  });

  it("reattaches to an already-playing source without reloading or re-applying stale initialSeekTime, and survives tab unmount/eviction with sleep + listening session intact", async () => {
    const h = createFakeOwnerHarness();
    await resetAudioRuntimeForTests(h.controller);

    const firstMount = render(
      <AudiobookViewer
        document={makeBookDocument("book-1")}
        controllerBacked
        autoPlayOnOpen
        initialSeekTime={5}
      />,
    );

    await waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        sourceKey: { profileKey: "local", kind: "audiobook", sourceId: "book-1" },
        state: "playing",
        positionSec: 5,
      });
    });
    expect(h.engine.load).toHaveBeenCalledTimes(1);

    // Owner advances to 42s, arms a sleep timer, and opens an owner-bound listening session
    const sleepDeadline = 1_600_000;
    await act(async () => {
      h.controller.setSleepTimer(sleepDeadline);
      h.advanceClock(1500);
      h.sample.timeInPart = 42;
      h.events.at(-1)!.sample(h.sample);
    });
    await waitFor(() => {
      expect(getActiveSession("ed-book-1")).not.toBeNull();
    });

    // Simulate tab close / LRU eviction
    firstMount.unmount();

    expect(h.controller.getSnapshot()).toMatchObject({
      sourceKey: { profileKey: "local", kind: "audiobook", sourceId: "book-1" },
      state: "playing",
      positionSec: 42,
      sleepDeadlineMs: sleepDeadline,
    });
    expect(getActiveSession("ed-book-1")).not.toBeNull();

    // Reopen tab with original tab data (initialSeekTime: 5, autoPlayOnOpen: true)
    const secondMount = render(
      <AudiobookViewer
        document={makeBookDocument("book-1")}
        controllerBacked
        autoPlayOnOpen
        initialSeekTime={5}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(h.engine.load).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot()).toMatchObject({
      positionSec: 42,
      state: "playing",
      sleepDeadlineMs: sleepDeadline,
    });

    secondMount.unmount();

    // Explicit stopAndClose closes the owner-tracked listening session
    await act(async () => {
      await h.controller.stopAndClose();
    });
    await waitFor(() => {
      expect(getActiveSession("ed-book-1")).toBeNull();
    });
  });
});
