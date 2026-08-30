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

const transcriptionMocks = vi.hoisted(() => ({
  enqueueAutoTranscription: vi.fn(),
  getTranscriptionStatus: vi.fn(),
  fetchProfiles: vi.fn(async () => {}),
  loadTranscript: vi.fn(async () => {}),
  profiles: [] as Array<Record<string, unknown>>,
  activeJob: null as { bookId: string; chapterId: string } | null,
  activeSegments: [] as Array<Record<string, unknown>>,
  activeTranscriptBookId: null as string | null,
  activeTranscriptStatus: null as "pending" | "processing" | "completed" | "failed" | null,
  activeTranscriptChapterId: null as string | null,
}));

const settingsMocks = vi.hoisted(() => ({
  audioTranscription: {
    provider: "local" as "local" | "groq",
    preferredModelId: "parakeet-tdt-ctc-110m" as string | undefined,
    language: "en",
    groq: { apiKey: "key", model: "whisper-large-v3-turbo" as const },
  },
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
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
    t: (key: string, params?: Record<string, unknown>) =>
      params?.engine ? `${key} ${params.engine}` : key,
    locale: "en",
  }),
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
  enqueueAutoTranscription: transcriptionMocks.enqueueAutoTranscription,
  getTranscriptionStatus: transcriptionMocks.getTranscriptionStatus,
  getTranscriptionProfiles: vi.fn(async () => transcriptionMocks.profiles),
  downloadTranscriptionModel: vi.fn(),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => toastMocks,
}));

vi.mock("../../common/Tabs", () => ({
  useIsActiveTab: () => true,
}));

vi.mock("../../../stores/useTranscriptionStore", () => {
  const state = () => ({
    profiles: transcriptionMocks.profiles,
    fetchProfiles: transcriptionMocks.fetchProfiles,
    currentStatus: null,
    activeJob: transcriptionMocks.activeJob,
    activeSegments: transcriptionMocks.activeSegments,
    activeTranscriptBookId: transcriptionMocks.activeTranscriptBookId,
    activeTranscriptStatus: transcriptionMocks.activeTranscriptStatus,
    activeTranscriptChapterId: transcriptionMocks.activeTranscriptChapterId,
    loadTranscript: transcriptionMocks.loadTranscript,
    transcriptionProgress: 25,
  });
  return {
    useTranscriptionStore: Object.assign(
      (selector?: (value: ReturnType<typeof state>) => unknown) =>
        selector ? selector(state()) : state(),
      { getState: state },
    ),
  };
});

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: Object.assign(
    (selector?: (state: unknown) => unknown) => {
      const state = {
        settings: {
          general: { language: "en" },
          documents: { autoProcessOnImport: false },
          audioTranscription: settingsMocks.audioTranscription,
        },
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        settings: {
          general: { language: "en" },
          documents: { autoProcessOnImport: false },
          audioTranscription: settingsMocks.audioTranscription,
        },
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
    transcriptionMocks.enqueueAutoTranscription.mockReset().mockResolvedValue(undefined);
    transcriptionMocks.getTranscriptionStatus.mockReset().mockResolvedValue(null);
    transcriptionMocks.fetchProfiles.mockClear();
    transcriptionMocks.loadTranscript.mockClear();
    transcriptionMocks.profiles = [{
      id: "parakeet-tdt-ctc-110m",
      name: "Parakeet TDT-CTC 110M",
      installed: true,
      description: "",
      url: "",
      sha256: "",
      size_bytes: 1,
    }];
    transcriptionMocks.activeJob = null;
    transcriptionMocks.activeSegments = [];
    transcriptionMocks.activeTranscriptBookId = null;
    transcriptionMocks.activeTranscriptStatus = null;
    transcriptionMocks.activeTranscriptChapterId = null;
    settingsMocks.audioTranscription.provider = "local";
    settingsMocks.audioTranscription.preferredModelId = "parakeet-tdt-ctc-110m";
    settingsMocks.audioTranscription.groq.apiKey = "key";
    toastMocks.success.mockClear();
    toastMocks.info.mockClear();
    toastMocks.error.mockClear();
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
    // Command-aware mock: the first media-server resolution fails, the retry
    // succeeds. Other commands the player issues on mount (audio-edition
    // probe, media-bridge metadata) resolve neutrally so they cannot consume
    // the queued failure/success pair.
    let streamAttempts = 0;
    tauriMocks.invokeCommand.mockImplementation(async (cmd: string) => {
      if (cmd === "get_media_stream_url") {
        streamAttempts += 1;
        if (streamAttempts === 1) {
          throw new Error("Cannot stream media file: file not found on disk");
        }
        return "http://127.0.0.1:43123/stream?path=%2FUsers%2Ftest%2FMusic%2Ftest-book.mp3";
      }
      if (cmd === "get_audio_edition_by_document") return null;
      return undefined;
    });
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
      expect(streamAttempts).toBe(2);
    });
    expect(tauriMocks.invokeCommand).toHaveBeenCalledWith("get_media_stream_url", {
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

  it("keeps an already-resolved m4b source and publishes delayed duration/time events", async () => {
    const onTimeUpdate = vi.fn();
    const onDurationChange = vi.fn();
    const { container } = render(
      <AudiobookViewer
        document={{ ...desktopDocument(), filePath: "/Users/test/Music/test-book.m4b" }}
        fileContent="http://127.0.0.1:43123/stream?path=test-book.m4b"
        onTimeUpdate={onTimeUpdate}
        onDurationChange={onDurationChange}
      />,
    );

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("http://127.0.0.1:43123/stream?path=test-book.m4b");
    await waitFor(() => expect(audiobookApiMocks.prepareAudiobookPlayback).not.toHaveBeenCalled());

    Object.defineProperty(audio, "duration", { configurable: true, value: 321 });
    Object.defineProperty(audio, "currentTime", { configurable: true, value: 12 });
    fireEvent.durationChange(audio!);
    fireEvent.timeUpdate(audio!);

    expect(onDurationChange).toHaveBeenCalledWith(321);
    expect(onTimeUpdate).toHaveBeenCalledWith(12);
  });
});

describe("transcription provider routing and labels", () => {
  beforeEach(() => {
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.isNativeMobile.mockReturnValue(false);
    tauriMocks.invokeCommand.mockReset().mockResolvedValue(
      "http://127.0.0.1:43123/stream?path=test-book.mp3",
    );
    transcriptionMocks.enqueueAutoTranscription.mockReset().mockResolvedValue(undefined);
    transcriptionMocks.getTranscriptionStatus.mockReset().mockResolvedValue(null);
    transcriptionMocks.profiles = [{
      id: "parakeet-tdt-ctc-110m",
      name: "Parakeet TDT-CTC 110M",
      installed: true,
      description: "",
      url: "",
      sha256: "",
      size_bytes: 1,
    }];
    transcriptionMocks.activeSegments = [];
    transcriptionMocks.activeTranscriptBookId = null;
    transcriptionMocks.activeJob = null;
    transcriptionMocks.activeTranscriptStatus = null;
    transcriptionMocks.activeTranscriptChapterId = null;
    settingsMocks.audioTranscription.provider = "local";
    settingsMocks.audioTranscription.preferredModelId = "parakeet-tdt-ctc-110m";
    settingsMocks.audioTranscription.groq.apiKey = "key";
    toastMocks.error.mockClear();
  });

  function openTranscript() {
    fireEvent.click(screen.getByTitle("viewer.transcript"));
  }

  it("names local Parakeet in progress without mentioning Groq", () => {
    transcriptionMocks.activeJob = { bookId: "book-1", chapterId: "default" };
    render(<AudiobookViewer document={desktopDocument()} />);
    openTranscript();
    const panel = screen.getByText(/Transcribing audiobook using Local STT · Parakeet/);
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("Groq");
  });

  it("names Groq in progress without local or offline wording", () => {
    settingsMocks.audioTranscription.provider = "groq";
    transcriptionMocks.activeJob = { bookId: "book-1", chapterId: "default" };
    render(<AudiobookViewer document={desktopDocument()} />);
    openTranscript();
    const panel = screen.getByText(/Transcribing audiobook using Groq · Whisper Large v3 Turbo/);
    expect(panel.textContent?.toLowerCase()).not.toMatch(/local|offline/);
  });

  it("updates the idle CTA when the configured provider changes", () => {
    const view = render(<AudiobookViewer document={desktopDocument()} />);
    openTranscript();
    expect(screen.getByText(/viewer.startTranscriptionWith Local STT · Parakeet/)).toBeInTheDocument();

    settingsMocks.audioTranscription.provider = "groq";
    view.rerender(<AudiobookViewer document={desktopDocument()} />);
    expect(screen.getByText(/viewer.startTranscriptionWith Groq · Whisper Large v3 Turbo/)).toBeInTheDocument();
  });

  it("does not enqueue when the preferred local model is not installed", async () => {
    transcriptionMocks.profiles = transcriptionMocks.profiles.map((profile) => ({
      ...profile,
      installed: false,
    }));
    render(<AudiobookViewer document={desktopDocument()} />);
    openTranscript();
    fireEvent.click(screen.getByText(/viewer.startTranscriptionWith Parakeet TDT-CTC 110M is not installed/));

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith(
        "Model not installed",
        expect.stringContaining("Parakeet TDT-CTC 110M"),
        expect.any(Object),
      );
    });
    expect(transcriptionMocks.enqueueAutoTranscription).not.toHaveBeenCalled();
  });

  it("continues a saved partial transcript using its original chapter key", async () => {
    transcriptionMocks.activeSegments = [
      { start_ms: 8_970_000, end_ms: 9_000_000, text: "Saved at two and a half hours.", confidence: 0.9 },
    ];
    transcriptionMocks.activeTranscriptBookId = "book-1";
    transcriptionMocks.activeTranscriptStatus = "processing";
    transcriptionMocks.activeTranscriptChapterId = "legacy-chapter-17";

    render(<AudiobookViewer document={desktopDocument()} />);
    openTranscript();

    expect(screen.getByText("viewer.partialTranscript")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/viewer.continueTranscriptionWith Local STT · Parakeet/));

    await waitFor(() => {
      expect(transcriptionMocks.enqueueAutoTranscription).toHaveBeenCalledWith(
        "book-1",
        "/Users/test/Music/test-book.mp3",
        "local",
        "parakeet-tdt-ctc-110m",
        "en",
        undefined,
        "legacy-chapter-17",
      );
    });
  });

  it("reloads the durable queue chapter when recovering after an app restart", async () => {
    transcriptionMocks.getTranscriptionStatus.mockResolvedValue({
      id: "queue-1",
      documentId: "book-1",
      chapterId: "chapter-17",
      audioPath: "/Users/test/Music/test-book.mp3",
      provider: "local",
      modelId: "parakeet-tdt-ctc-110m",
      language: "en",
      status: "processing",
      errorMessage: null,
      priority: 0,
      createdAt: "2026-08-13T00:00:00Z",
      startedAt: "2026-08-13T00:01:00Z",
      completedAt: null,
      retryCount: 0,
      progress: 71,
    });

    render(<AudiobookViewer document={desktopDocument()} />);

    await waitFor(() => {
      expect(transcriptionMocks.loadTranscript).toHaveBeenCalledWith("book-1", "chapter-17");
    });
  });
});
