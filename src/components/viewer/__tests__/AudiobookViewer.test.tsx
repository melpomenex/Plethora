import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AudiobookPlaybackErrorNotice,
  AudiobookViewer,
  classifyAudiobookPlaybackError,
} from "../AudiobookViewer";
import type { Document } from "../../../types/document";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => false),
  invokeCommand: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
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
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

vi.mock("../../../lib/audiobookDiagnostics", () => ({
  logAudiobookDiagnostic: vi.fn(),
}));

const audiobookApiMocks = vi.hoisted(() => ({
  extractAudioCoverArt: vi.fn(),
  searchAudiobookCover: vi.fn(),
  prepareAudiobookPlayback: vi.fn(),
  parseAudiobookMetadata: vi.fn(),
  transcribeAudiobookWithGroq: vi.fn(),
  formatDuration: vi.fn((seconds: number) => `${seconds}s`),
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
  getDocument: vi.fn(),
}));

vi.mock("../../../api/position", () => ({
  getDocumentPosition: vi.fn(async () => null),
  saveDocumentPosition: vi.fn(),
  timePosition: vi.fn(),
}));

vi.mock("../../../api/podcast", () => ({
  getEpisodePosition: vi.fn(async () => null),
  updateEpisodePosition: vi.fn(),
  markEpisodePlayed: vi.fn(),
  downloadEpisodeAudio: vi.fn(),
  getDownloadedEpisodePath: vi.fn(),
  getPodcastTranscript: vi.fn(),
  transcribePodcastEpisode: vi.fn(),
  transcribePodcastEpisodeWithGroq: vi.fn(),
}));

vi.mock("../../../api/transcription", () => ({
  startTranscription: vi.fn(),
}));

vi.mock("../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

vi.mock("../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../stores/useTranscriptionStore", () => ({
  useTranscriptionStore: () => ({
    profiles: [],
    fetchProfiles: vi.fn(),
    currentStatus: null,
    activeJob: null,
    activeSegments: [],
    loadTranscript: vi.fn(),
    transcriptionProgress: {},
  }),
  getState: () => ({ profiles: [], activeSegments: [] }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector?: (state: unknown) => unknown) => {
      const state = {
        settings: {
          general: { language: "en" },
          audioTranscription: { provider: "groq" },
        },
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        settings: { general: { language: "en" }, audioTranscription: { provider: "groq" } },
      }),
    },
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

function desktopDocument(): Document {
  return {
    id: "book-1",
    title: "Test Book",
    filePath: "/Users/test/Music/test-book.mp3",
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

describe("Audiobook playback error classification", () => {
  it("treats decode and unsupported-source errors as codec failures", () => {
    expect(classifyAudiobookPlaybackError(3)).toBe("codec");
    expect(classifyAudiobookPlaybackError(4)).toBe("codec");
  });

  it("treats network and unknown media errors as source failures", () => {
    expect(classifyAudiobookPlaybackError(2)).toBe("source");
    expect(classifyAudiobookPlaybackError(undefined)).toBe("source");
  });

  it("renders a retryable error state and invokes the retry action", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AudiobookPlaybackErrorNotice
        error={null}
        retryLabel="Retry play"
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <AudiobookPlaybackErrorNotice
        error={{ kind: "codec", message: "Unsupported audio format" }}
        retryLabel="Retry play"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported audio format");
    fireEvent.click(screen.getByRole("button", { name: "Retry play" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("desktop audiobook source resolution failures", () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.isNativeMobile.mockReturnValue(false);
    tauriMocks.invokeCommand.mockReset();
    audiobookApiMocks.extractAudioCoverArt.mockReset().mockResolvedValue(null);
    audiobookApiMocks.searchAudiobookCover.mockReset().mockResolvedValue([]);
    audiobookApiMocks.parseAudiobookMetadata.mockReset().mockResolvedValue({});
  });

  it("surfaces playbackError when source resolution fails instead of leaving the player idle", async () => {
    tauriMocks.invokeCommand.mockRejectedValue(
      new Error("Cannot stream media file: file not found on disk"),
    );

    render(<AudiobookViewer document={desktopDocument()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Cannot stream media file: file not found on disk");
    expect(alert).toHaveTextContent("viewer.unableToLoadAudio");
    // The resolution path must go through the media server command, never
    // through the asset protocol.
    expect(tauriMocks.invokeCommand).toHaveBeenCalledWith("get_media_stream_url", {
      filePath: "/Users/test/Music/test-book.mp3",
    });
  });

  it("re-runs source resolution when the user retries after a failure", async () => {
    tauriMocks.invokeCommand.mockRejectedValueOnce(
      new Error("Cannot stream media file: file not found on disk"),
    );
    tauriMocks.invokeCommand.mockResolvedValueOnce(
      "http://127.0.0.1:43123/stream?path=%2FUsers%2Ftest%2FMusic%2Ftest-book.mp3",
    );
    // jsdom does not implement HTMLMediaElement.play() (it returns undefined),
    // and the retry control defers a play() call — stub it so that deferred
    // call cannot throw an uncaught exception when the test unwinds.
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());

    render(<AudiobookViewer document={desktopDocument()} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Cannot stream media file: file not found on disk");

    fireEvent.click(screen.getByRole("button", { name: "viewer.retryPlay" }));

    // The retry control must re-resolve the source (and clear the error),
    // not leave the player idle with no src and no message.
    await waitFor(() => {
      expect(tauriMocks.invokeCommand).toHaveBeenCalledTimes(2);
    });
    expect(tauriMocks.invokeCommand).toHaveBeenLastCalledWith("get_media_stream_url", {
      filePath: "/Users/test/Music/test-book.mp3",
    });
    expect(screen.queryByRole("alert")).toBeNull();

    // Let the retry's deferred play() call run inside this test.
    await new Promise((resolve) => setTimeout(resolve, 0));
    HTMLMediaElement.prototype.play = originalPlay;
  });

  it("resolves playback through the media server when the command succeeds", async () => {
    tauriMocks.invokeCommand.mockResolvedValue(
      "http://127.0.0.1:43123/stream?path=%2FUsers%2Ftest%2FMusic%2Ftest-book.mp3",
    );

    render(<AudiobookViewer document={desktopDocument()} />);

    await waitFor(() => {
      expect(tauriMocks.invokeCommand).toHaveBeenCalledWith("get_media_stream_url", {
        filePath: "/Users/test/Music/test-book.mp3",
      });
    });
    // No error is surfaced for a successful resolution.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
