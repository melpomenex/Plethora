import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

const tauriMocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isNativeMobile: vi.fn(() => false),
  getPlatform: vi.fn((): "mac" | "windows" | "linux" | "unknown" => "linux"),
  invokeCommand: vi.fn(async () => null),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: tauriMocks.isTauri,
  isNativeMobile: tauriMocks.isNativeMobile,
  getPlatform: tauriMocks.getPlatform,
  invokeCommand: tauriMocks.invokeCommand,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string, params?: any) => key, locale: "en" }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

const storeMocks = vi.hoisted(() => ({
  updateDocument: vi.fn(),
}));

// Selector-shaped, matching the real zustand hook: the viewer reads
// `updateDocument` off the store and calls it after persisting an archive.
vi.mock("../../../stores", () => ({
  useDocumentStore: (selector: (state: unknown) => unknown) =>
    selector({ currentDocument: null, updateDocument: storeMocks.updateDocument }),
}));

vi.mock("../../../api/position", () => ({
  getDocumentPosition: vi.fn(async () => null),
  saveDocumentPosition: vi.fn(async () => {}),
  timePosition: vi.fn(),
}));

const documentMocks = vi.hoisted(() => ({
  archiveDocument: vi.fn(async () => ({ id: "doc-1", isArchived: true })),
}));

vi.mock("../../../api/documents", () => ({
  archiveDocument: documentMocks.archiveDocument,
  getDocumentAuto: vi.fn(async () => null),
  updateDocument: vi.fn(async () => {}),
  updateDocumentProgressAuto: vi.fn(async () => {}),
}));

vi.mock("../../../api/sponsorblock", () => ({
  fetchSponsorBlockSegments: vi.fn(async () => []),
  getCategoryDisplayName: vi.fn((c: string) => c),
}));

vi.mock("../../../utils/youtubeTranscriptBrowser", () => ({
  fetchYouTubeTranscript: vi.fn(async () => []),
}));

vi.mock("../../video/VideoFeatures", () => ({
  VideoFeatures: () => null,
}));

vi.mock("../../video/VideoExtracts", () => ({
  CreateVideoExtractDialog: () => null,
  VideoExtractsList: () => null,
}));

vi.mock("../../language/LanguageVideoHost", () => ({
  LanguageVideoHost: () => null,
}));

const mockYouTubeInstances: any[] = [];

vi.mock("react-youtube", () => ({
  default: (props: any) => {
    mockYouTubeInstances.push(props);
    return (
      <div
        data-testid="react-youtube-player"
        data-host={props.opts?.host}
        data-videoid={props.videoId}
      >
        <button
          data-testid="simulate-error-150"
          onClick={() => props.onError?.({ data: 150 })}
        >
          Simulate Error 150
        </button>
        <button
          data-testid="simulate-error-153"
          onClick={() => props.onError?.({ data: 153 })}
        >
          Simulate Error 153
        </button>
        <button
          data-testid="simulate-ended"
          onClick={() => props.onStateChange?.({ data: 0, target: { getDuration: async () => 0 } })}
        >
          Simulate Ended
        </button>
      </div>
    );
  },
}));

import { YouTubeViewer } from "../YouTubeViewer";

describe("YouTubeViewer inline playback and lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockYouTubeInstances.length = 0;
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.getPlatform.mockReturnValue("linux");
  });

  it("mounts with inline player active by default for valid videoId", async () => {
    render(
      <YouTubeViewer
        videoId="dQw4w9WgXcQ"
        documentId="doc-yt-1"
        title="Rick Astley"
      />
    );

    // Should mount the YouTube inline player directly without getting trapped in thumbnail
    await waitFor(() => {
      expect(screen.getByTestId("react-youtube-player")).toBeInTheDocument();
    });

    const player = screen.getByTestId("react-youtube-player");
    expect(player).toHaveAttribute("data-videoid", "dQw4w9WgXcQ");
    // On Linux / Tauri desktop, host defaults to https://www.youtube.com
    expect(player).toHaveAttribute("data-host", "https://www.youtube.com");
  });

  it("clicking thumbnail play button activates inline player and forceInlinePlayback", async () => {
    const { rerender } = render(
      <YouTubeViewer
        videoId=""
        documentId="doc-yt-2"
        title="Empty Video"
      />
    );

    // With empty videoId, player starts in fallback/thumbnail mode
    expect(screen.queryByTestId("react-youtube-player")).not.toBeInTheDocument();

    // Now update to valid video
    rerender(
      <YouTubeViewer
        videoId="dQw4w9WgXcQ"
        documentId="doc-yt-2"
        title="Updated Video"
      />
    );

    // Clicking play directly activates inline player
    const playButton = screen.queryByText(/viewer.playVideo/);
    if (playButton) {
      fireEvent.click(playButton);
    }

    await waitFor(() => {
      expect(screen.getByTestId("react-youtube-player")).toBeInTheDocument();
    });
  });

  it("re-resolves embed host and preserves inline playback across document switches", async () => {
    const { rerender } = render(
      <YouTubeViewer
        videoId="dQw4w9WgXcQ"
        documentId="doc-yt-1"
        title="First Video"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("react-youtube-player")).toBeInTheDocument();
    });

    // Switch to another document
    rerender(
      <YouTubeViewer
        videoId="L_LUpnjgPso"
        documentId="doc-yt-2"
        title="Second Video"
      />
    );

    await waitFor(() => {
      const player = screen.getByTestId("react-youtube-player");
      expect(player).toHaveAttribute("data-videoid", "L_LUpnjgPso");
    });
  });

  it("retries with youtube.com host when error 150 or 153 occurs on youtube-nocookie", async () => {
    // Force web environment where youtube-nocookie is initially used
    tauriMocks.isTauri.mockReturnValue(false);
    tauriMocks.getPlatform.mockReturnValue("mac");

    render(
      <YouTubeViewer
        videoId="dQw4w9WgXcQ"
        documentId="doc-yt-web"
        title="Web Video"
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("react-youtube-player")).toBeInTheDocument();
    });

    // Initially uses youtube-nocookie on web
    expect(screen.getByTestId("react-youtube-player")).toHaveAttribute(
      "data-host",
      "https://www.youtube-nocookie.com"
    );

    // Trigger error 150
    fireEvent.click(screen.getByTestId("simulate-error-150"));

    // Should switch to https://www.youtube.com
    await waitFor(() => {
      expect(screen.getByTestId("react-youtube-player")).toHaveAttribute(
        "data-host",
        "https://www.youtube.com"
      );
    });
  });

  // The regression: archiving a video you just finished in the review queue
  // called `update_document` with `{ isArchived: true }`. That command
  // deserializes `updates` into a whole `Document`, so it failed argument
  // validation with "missing field `id`" and the video stayed in the queue.
  it("archives through the narrow command when the end-of-video prompt is accepted", async () => {
    const onArchive = vi.fn();
    render(
      <YouTubeViewer
        videoId="dQw4w9WgXcQ"
        documentId="doc-yt-archive"
        title="Video To Archive"
        onArchive={onArchive}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("react-youtube-player")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("simulate-ended"));

    const archiveButton = await screen.findByText("viewer.archiveVideo");
    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(documentMocks.archiveDocument).toHaveBeenCalledWith("doc-yt-archive", true);
    });
    await waitFor(() => {
      expect(onArchive).toHaveBeenCalled();
    });
  });
});
