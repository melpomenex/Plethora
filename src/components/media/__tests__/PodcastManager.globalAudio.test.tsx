import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PodcastManager } from "../PodcastManager";
import { AudiobookViewer } from "../../viewer/AudiobookViewer";
import { useSeekToAlignedWord } from "../../../hooks/useAlignmentPlayback";
import { GlobalAudioController } from "../../../services/audio/globalAudioController";
import { AudioPlaybackPersistence } from "../../../services/audio/audioPlaybackPersistence";
import { resetAudioRuntimeForTests } from "../../../services/audio/audioRuntime";
import { withAudioBoundaries } from "../../../services/audio/audioCoordinates";
import { useDocumentStore } from "../../../stores/documentStore";
import type { AudioEngine, AudioEngineEvents } from "../../../services/audio/htmlAudioEngine";
import type { AudioSourceKey, ResolvedAudioItem } from "../../../types/audioEdition";
import type { PodcastEpisode, PodcastFeed } from "../../../api/podcast";
import type { Document } from "../../../types/document";

vi.mock("../../../services/audio/audioPlaybackRollout", () => ({
  GLOBAL_AUDIO_PLAYBACK_ENABLED: true,
}));

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => false),
  invokeCommand: vi.fn(async () => null),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const podcastApiMocks = vi.hoisted(() => ({
  feeds: [] as PodcastFeed[],
  episodes: [] as PodcastEpisode[],
  markEpisodePlayed: vi.fn(async () => undefined),
  getSubscribedPodcasts: vi.fn(async () => podcastApiMocks.feeds),
  getPodcastEpisodes: vi.fn(async () => podcastApiMocks.episodes),
  getDownloadedEpisodePath: vi.fn(async () => null),
  getEpisodePosition: vi.fn(async () => 0),
  updateEpisodePosition: vi.fn(async () => undefined),
  getPodcastTranscript: vi.fn(async () => ({ status: "none", text: "", segments: [] })),
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
  useI18n: () => ({ t: i18nT, locale: "en" }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => toastMocks,
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../common/Tabs/TabContent", () => ({
  usePaneId: () => "pane-1",
  useTabId: () => "tab-1",
}));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
}));

vi.mock("../../../commandPalette/paletteActionEvents", () => ({
  usePaletteActionListener: () => {},
  usePaletteContextProvider: () => {},
}));

vi.mock("../../../lib/contextualBack", () => ({
  useContextualBack: () => {},
}));

vi.mock("../../../stores/useTranscriptionStore", () => ({
  useTranscriptionStore: Object.assign(
    (selector?: (value: typeof transcriptionStoreState) => unknown) =>
      selector ? selector(transcriptionStoreState) : transcriptionStoreState,
    { getState: () => transcriptionStoreState },
  ),
}));

vi.mock("../../assistant/AssistantPanel", () => ({
  AssistantPanel: () => null,
}));

vi.mock("../../viewer/localMediaSource", () => ({
  resolveLocalMediaSource: vi.fn(),
}));

vi.mock("../../viewer/media/KaraokeText", () => ({
  KaraokeText: () => null,
}));

vi.mock("../../viewer/adaptive/ResponsiveDialogSheet", () => ({
  ResponsiveDialogSheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../api/audiobooks", () => ({
  extractAudioCoverArt: vi.fn(async () => null),
  searchAudiobookCover: vi.fn(async () => []),
  prepareAudiobookPlayback: vi.fn(async (p: string) => p),
  parseAudiobookMetadata: vi.fn(async () => ({})),
  transcribeAudiobookWithGroq: vi.fn(),
  formatDuration: vi.fn((s: number) => `${Math.floor(s)}s`),
}));

vi.mock("../../../api/sponsorblock", () => ({
  getSponsorBlockCuts: vi.fn(async () => []),
  fetchSponsorBlockSegments: vi.fn(async () => []),
  extractVideoID: vi.fn(() => null),
  getCategoryDisplayName: vi.fn((c: string) => c),
}));

vi.mock("../../../api/podcast", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/podcast")>();
  return {
    ...actual,
    getSubscribedPodcasts: podcastApiMocks.getSubscribedPodcasts,
    getPodcastEpisodes: podcastApiMocks.getPodcastEpisodes,
    getDownloadedEpisodePath: podcastApiMocks.getDownloadedEpisodePath,
    getEpisodePosition: podcastApiMocks.getEpisodePosition,
    updateEpisodePosition: podcastApiMocks.updateEpisodePosition,
    markEpisodePlayed: podcastApiMocks.markEpisodePlayed,
    getPodcastTranscript: podcastApiMocks.getPodcastTranscript,
    probeAudioDuration: vi.fn(async () => 180),
  };
});

function createFakeOwnerHarness() {
  const sample = { timeInPart: 0, durationSec: 180 as number | null, paused: true, seekable: true };
  const events: AudioEngineEvents[] = [];
  let clockMs = 2_000_000;
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

  const resolve = vi.fn(async (sourceKey: AudioSourceKey): Promise<ResolvedAudioItem> => {
    const promoted = useDocumentStore.getState().documents.find(
      (doc) => doc.fileType === "audio" && doc.metadata?.source === `podcast:${sourceKey.sourceId}`,
    );
    return {
      sourceKey,
      title: `Title ${sourceKey.sourceId}`,
      documentId: promoted?.id,
      mediaRevision: "v1",
      complete: true,
      parts: withAudioBoundaries([
        {
          partId: "0",
          sourceRevision: "v1",
          browserUrl: `https://cdn.example/${sourceKey.sourceId}.mp3`,
          durationSec: 180,
        },
      ]),
    };
  });

  let seq = 0;
  const controller = new GlobalAudioController({
    createEngine: () => engine,
    resolve,
    persistence: new AudioPlaybackPersistence({ commit: vi.fn(async () => undefined) }),
    uuid: () => `pod-session-${++seq}`,
    now: () => clockMs,
  });

  return {
    controller,
    engine,
    events,
    sample,
    advanceClock: (ms: number) => {
      clockMs += ms;
    },
  };
}

describe("Entry-point migration & podcast continuation (task 5.4)", () => {
  const feed: PodcastFeed = {
    id: "feed-1",
    title: "Systems Radio",
    feedUrl: "https://example.com/feed.xml",
    author: "Host",
    description: "Podcast feed",
    imageUrl: null,
    language: null,
    link: null,
    lastFetched: null,
    subscribedAt: "2026-01-01T00:00:00.000Z",
    sortOrder: 0,
    episodeCount: 2,
    unplayedCount: 2,
    autoTranscribe: false,
  };

  const ep1: PodcastEpisode = {
    id: "ep-1",
    feedId: "feed-1",
    title: "Episode One",
    audioUrl: "https://cdn.example/ep-1.mp3",
    publishedDate: "2026-01-02T00:00:00.000Z",
    duration: 180,
    played: false,
    playbackPosition: 0,
    guid: "guid-1",
    description: "First",
    imageUrl: null,
    audioType: "audio/mpeg",
    fileSize: null,
    link: null,
    dateAdded: "2026-01-02T00:00:00.000Z",
    transcriptStatus: "none",
  };

  const ep2: PodcastEpisode = {
    id: "ep-2",
    feedId: "feed-1",
    title: "Episode Two",
    audioUrl: "https://cdn.example/ep-2.mp3",
    publishedDate: "2026-01-01T00:00:00.000Z",
    duration: 180,
    played: false,
    playbackPosition: 0,
    guid: "guid-2",
    description: "Second",
    imageUrl: null,
    audioType: "audio/mpeg",
    fileSize: null,
    link: null,
    dateAdded: "2026-01-01T00:00:00.000Z",
    transcriptStatus: "none",
  };

  const promotedDoc: Document = {
    id: "doc-promoted-ep1",
    title: "Episode One",
    filePath: "/podcasts/ep-1.mp3",
    fileType: "audio",
    metadata: { source: "podcast:ep-1" },
    tags: [],
    dateAdded: "2026-01-02T00:00:00.000Z",
    dateModified: "2026-01-02T00:00:00.000Z",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    podcastApiMocks.feeds = [feed];
    podcastApiMocks.episodes = [ep1, ep2];
    useDocumentStore.setState({ documents: [promotedDoc] });
  });

  afterEach(async () => {
    useDocumentStore.setState({ documents: [] });
    await resetAudioRuntimeForTests(null);
  });

  it("starts PodcastManager playback with canonical episode identity, distinct promoted documentId, and unplayed feed continuation that advances after unmount and reattaches without re-seek", async () => {
    const h = createFakeOwnerHarness();
    await resetAudioRuntimeForTests(h.controller);

    const view = render(<PodcastManager />);

    const feedBtn = await screen.findByText("Systems Radio");
    await act(async () => {
      fireEvent.click(feedBtn);
    });

    await screen.findByText("Episode One");
    const playButtons = screen.getAllByTitle("Play episode");
    await act(async () => {
      fireEvent.click(playButtons[0]);
    });

    await waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        sourceKey: { profileKey: "local", kind: "podcast", sourceId: "ep-1" },
        state: "playing",
        queue: [
          { profileKey: "local", kind: "podcast", sourceId: "ep-1" },
          { profileKey: "local", kind: "podcast", sourceId: "ep-2" },
        ],
      });
    });

    // Resolved item keeps distinct promoted documentId while sourceKey uses episodeId
    expect(h.controller.getItem()?.documentId).toBe("doc-promoted-ep1");
    expect(h.controller.getSnapshot()?.sourceKey.sourceId).toBe("ep-1");

    // Unmount PodcastManager completely; continuation queue must still advance in the singleton owner
    view.unmount();

    await act(async () => {
      h.events.at(-1)!.ended();
    });

    await waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        sourceKey: { profileKey: "local", kind: "podcast", sourceId: "ep-2" },
        state: "playing",
      });
    });
    expect(podcastApiMocks.markEpisodePlayed).toHaveBeenCalledWith("ep-1", true);
    const loadsAfterAdvance = (h.engine.load as ReturnType<typeof vi.fn>).mock.calls.length;

    // Advance ep-2 playhead to 33s
    await act(async () => {
      h.advanceClock(1500);
      h.sample.timeInPart = 33;
      h.events.at(-1)!.sample(h.sample);
    });
    expect(h.controller.getSnapshot()?.positionSec).toBe(33);

    // Remount PodcastManager and reattach to ep-2: must NOT reload or seek back to 0
    const remount = render(<PodcastManager />);
    const feedBtn2 = await screen.findByText("Systems Radio");
    await act(async () => {
      fireEvent.click(feedBtn2);
    });
    await screen.findByText("Episode Two");
    const ep2RowButtons = screen.getAllByTitle("Play episode");
    // Episode Two is the second row in newest-first order
    await act(async () => {
      fireEvent.click(ep2RowButtons[1]);
    });

    expect(h.engine.load).toHaveBeenCalledTimes(loadsAfterAdvance);
    expect(h.controller.getSnapshot()).toMatchObject({
      sourceKey: { profileKey: "local", kind: "podcast", sourceId: "ep-2" },
      positionSec: 33,
      state: "playing",
    });

    remount.unmount();
  });

  it("preserves episode identity separate from promoted document.id when opened via DocumentViewer/QueueScroll entry props", async () => {
    const h = createFakeOwnerHarness();
    await resetAudioRuntimeForTests(h.controller);

    const { unmount } = render(
      <AudiobookViewer
        document={promotedDoc}
        episodeId="ep-1"
        episodeTitle="Episode One"
        autoPlayOnOpen
      />,
    );

    await waitFor(() => {
      expect(h.controller.getSnapshot()).toMatchObject({
        sourceKey: { profileKey: "local", kind: "podcast", sourceId: "ep-1" },
        state: "playing",
      });
    });
    expect(h.controller.getItem()?.documentId).toBe("doc-promoted-ep1");

    unmount();
  });

  it("routes useSeekToAlignedWord through onSeekSeconds when no local HTMLAudioElement exists", () => {
    const audioRef = { current: null as HTMLAudioElement | null };
    const onSeekSeconds = vi.fn();
    const { result } = renderHook(() => useSeekToAlignedWord(audioRef, null, onSeekSeconds));

    act(() => {
      result.current({
        word: "continuity",
        normalized: "continuity",
        startMs: 24_500,
        endMs: 25_000,
        confidence: 0.95,
        chapterIndex: 0,
        cfi: "epubcfi(/6/2!/4/2)",
      } as any);
    });

    expect(onSeekSeconds).toHaveBeenCalledWith(24.5);
  });
});
