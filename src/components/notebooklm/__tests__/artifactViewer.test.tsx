import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ArtifactViewer } from "../artifacts/ArtifactViewer";

const api = vi.hoisted(() => ({
  notebooklmGetJob: vi.fn(),
  notebooklmSetArtifactPosition: vi.fn(),
  readDocumentFile: vi.fn(),
  resolveLocalMediaSource: vi.fn(),
}));

vi.mock("../../../api/integrations", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

vi.mock("../../../api/documents", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readDocumentFile: api.readDocumentFile,
}));

vi.mock("../../viewer/localMediaSource", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveLocalMediaSource: api.resolveLocalMediaSource,
}));

// The media viewers resolve local paths via convertFileSrc under Tauri; in
// jsdom the Tauri runtime is absent so the raw URL is kept.
vi.mock("../../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => false,
}));

beforeEach(() => {
  api.notebooklmGetJob.mockReset();
  api.notebooklmSetArtifactPosition.mockReset();
  api.notebooklmSetArtifactPosition.mockResolvedValue(undefined);
  api.readDocumentFile.mockReset();
  api.resolveLocalMediaSource.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ArtifactViewer media rendering", () => {
  it("renders an infographic artifact as an image, not raw JSON", async () => {
    const content = JSON.stringify({
      url: "/tmp/infographic.png",
      description: "Infographic generated via NotebookLM CLI",
    });
    render(
      <ArtifactViewer type="infographic" content={content} title="Infographic" />
    );
    await waitFor(() => {
      const img = document.querySelector("img[src='/tmp/infographic.png']");
      expect(img).toBeTruthy();
    });
  });

  it("renders a slide deck artifact in an iframe, not raw JSON", async () => {
    const content = JSON.stringify({
      url: "/tmp/slides.pdf",
      description: "Slide deck generated via NotebookLM CLI",
    });
    render(<ArtifactViewer type="slide-deck" content={content} title="Slide Deck" />);
    await waitFor(() => {
      const frame = document.querySelector("iframe[src='/tmp/slides.pdf']");
      expect(frame).toBeTruthy();
    });
  });

  it("shows an explanatory message when infographic media is missing", () => {
    const content = JSON.stringify({ description: "no url here" });
    render(<ArtifactViewer type="infographic" content={content} title="Infographic" />);
    expect(screen.getByText(/Infographic image not available yet/i)).toBeTruthy();
  });

  it("polls a queued job and reveals the image once mediaUrl lands", async () => {
    const content = JSON.stringify({ description: "generating..." });
    // First poll: queued with no media URL yet; second poll (after the 2.5s
    // interval) succeeds with the media URL present.
    api.notebooklmGetJob
      .mockResolvedValueOnce({
        id: "job-1",
        notebookId: "nb-1",
        artifactType: "infographic",
        status: "queued",
        createdAt: "2026-08-10T00:00:00Z",
        updatedAt: "2026-08-10T00:00:00Z",
        payload: { flashcards: [], quizItems: [], rawText: "generating..." },
      })
      .mockResolvedValueOnce({
        id: "job-1",
        notebookId: "nb-1",
        artifactType: "infographic",
        status: "succeeded",
        createdAt: "2026-08-10T00:00:00Z",
        updatedAt: "2026-08-10T00:00:00Z",
        payload: {
          flashcards: [],
          quizItems: [],
          rawText: "generating...",
          mediaUrl: "/tmp/infographic-final.png",
        },
      });

    render(
      <ArtifactViewer type="infographic" content={content} title="Infographic" artifactId="job-1" />
    );

    // The first poll fires on mount (queued → schedules a 2.5s retry); the
    // second poll reveals the image. Real timers, so allow past the interval.
    await waitFor(
      () => {
        const img = document.querySelector("img[src='/tmp/infographic-final.png']");
        expect(img).toBeTruthy();
      },
      { timeout: 6000 }
    );
  });

  it("falls back to a blob URL when the infographic image fails to load", async () => {
    const content = JSON.stringify({
      url: "/tmp/blocked.png",
      description: "Infographic generated via NotebookLM CLI",
    });
    // The asset URL is served (isTauri false → raw path), but the img fails
    // to load (CSP/scope); readDocumentFile supplies the bytes for a blob URL.
    api.readDocumentFile.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));

    render(<ArtifactViewer type="infographic" content={content} title="Infographic" />);

    // Wait for the asset URL to be set, then simulate the onError the browser
    // fires when that URL is blocked (CSP / asset scope).
    const img = (await screen.findByAltText("Infographic")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/tmp/blocked.png");
    fireEvent.error(img);

    await waitFor(() => {
      expect(api.readDocumentFile).toHaveBeenCalledWith("/tmp/blocked.png");
    });
    await waitFor(() => {
      const blobImg = document.querySelector("img[src^='blob:']");
      expect(blobImg).toBeTruthy();
    });
  });

  it("plays a video artifact through the app's media resolver", async () => {
    const content = JSON.stringify({
      url: "/tmp/video-overview.mp4",
      description: "Video overview generated via NotebookLM CLI",
    });
    // The media resolver returns the playable src (asset or blob URL).
    api.resolveLocalMediaSource.mockResolvedValue({
      src: "blob:video-src",
      mimeType: "video/mp4",
      mediaType: "video",
      originalPath: "/tmp/video-overview.mp4",
      strategy: "backend-blob",
      revokeSrcOnDispose: true,
      attempts: [],
    });

    render(<ArtifactViewer type="video" content={content} title="Video Overview" />);

    await waitFor(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      expect(video).toBeTruthy();
      expect(video?.getAttribute("src")).toBe("blob:video-src");
    });
    expect(api.resolveLocalMediaSource).toHaveBeenCalledWith("/tmp/video-overview.mp4", "video");
  });

  it("plays an audio artifact through the app's media resolver", async () => {
    const content = JSON.stringify({
      url: "/tmp/audio-overview.mp3",
      description: "Audio overview generated via NotebookLM CLI",
    });
    api.resolveLocalMediaSource.mockResolvedValue({
      src: "blob:audio-src",
      mimeType: "audio/mpeg",
      mediaType: "audio",
      originalPath: "/tmp/audio-overview.mp3",
      strategy: "backend-blob",
      revokeSrcOnDispose: true,
      attempts: [],
    });

    render(<ArtifactViewer type="audio" content={content} title="Audio Overview" />);

    await waitFor(() => {
      const audio = document.querySelector("audio") as HTMLAudioElement | null;
      expect(audio).toBeTruthy();
      expect(audio?.getAttribute("src")).toBe("blob:audio-src");
    });
    expect(api.resolveLocalMediaSource).toHaveBeenCalledWith("/tmp/audio-overview.mp3", "audio");
  });

  it("saves the video playback position when playback advances", async () => {
    const content = JSON.stringify({
      url: "/tmp/video-overview.mp4",
      description: "Video overview generated via NotebookLM CLI",
    });
    api.resolveLocalMediaSource.mockResolvedValue({
      src: "blob:video-src",
      mimeType: "video/mp4",
      mediaType: "video",
      originalPath: "/tmp/video-overview.mp4",
      strategy: "backend-blob",
      revokeSrcOnDispose: true,
      attempts: [],
    });
    // The initial-resolve effect fetches the job to capture a saved position;
    // provide a minimal job so the resolve proceeds.
    api.notebooklmGetJob.mockResolvedValue({
      id: "job-video",
      notebookId: "nb-1",
      artifactType: "video",
      status: "succeeded",
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:00:00Z",
      payload: { flashcards: [], quizItems: [], mediaUrl: "/tmp/video-overview.mp4" },
    });

    render(
      <ArtifactViewer type="video" content={content} title="Video Overview" artifactId="job-video" />
    );

    const video = (await waitFor(() => {
      const el = document.querySelector("video") as HTMLVideoElement | null;
      expect(el).toBeTruthy();
      return el;
    })) as HTMLVideoElement;
    // jsdom permits setting currentTime; the browser fires timeupdate as
    // playback advances, so set the property then dispatch the event.
    video.currentTime = 15;
    fireEvent.timeUpdate(video);
    video.currentTime = 16;
    fireEvent.timeUpdate(video);

    await waitFor(() => {
      expect(api.notebooklmSetArtifactPosition).toHaveBeenCalledWith("job-video", 16);
    });
  });

  it("restores the saved video position on load", async () => {
    const content = JSON.stringify({
      url: "/tmp/video-overview.mp4",
      description: "Video overview generated via NotebookLM CLI",
    });
    // Job carries a previously saved position.
    api.notebooklmGetJob.mockResolvedValue({
      id: "job-video",
      notebookId: "nb-1",
      artifactType: "video",
      status: "succeeded",
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:00:00Z",
      payload: {
        flashcards: [],
        quizItems: [],
        mediaUrl: "/tmp/video-overview.mp4",
        playbackPosition: 42,
      },
    });
    api.resolveLocalMediaSource.mockResolvedValue({
      src: "blob:video-src",
      mimeType: "video/mp4",
      mediaType: "video",
      originalPath: "/tmp/video-overview.mp4",
      strategy: "backend-blob",
      revokeSrcOnDispose: true,
      attempts: [],
    });

    render(
      <ArtifactViewer type="video" content={content} title="Video Overview" artifactId="job-video" />
    );

    // The poll fetches the job (with the saved position) and resolves media.
    await waitFor(() => {
      const video = document.querySelector("video") as HTMLVideoElement | null;
      expect(video).toBeTruthy();
      expect(video?.getAttribute("src")).toBe("blob:video-src");
    });
    // Wait until the poll has fetched the job (which carries playbackPosition).
    await waitFor(() => {
      expect(api.notebooklmGetJob).toHaveBeenCalledWith("job-video");
    });

    // Simulate metadata loading so the seek-to-saved-position runs.
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 120, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(42);
  });

  it("seeks to the saved position even when metadata loads before the position is fetched", async () => {
    const content = JSON.stringify({
      url: "/tmp/video-overview.mp4",
      description: "Video overview generated via NotebookLM CLI",
    });
    // Delay the job resolution so media metadata loads first.
    let resolveJob: (job: unknown) => void;
    const jobPromise = new Promise((resolve) => {
      resolveJob = resolve;
    });
    api.notebooklmGetJob.mockReturnValue(jobPromise);
    api.resolveLocalMediaSource.mockResolvedValue({
      src: "blob:video-src",
      mimeType: "video/mp4",
      mediaType: "video",
      originalPath: "/tmp/video-overview.mp4",
      strategy: "backend-blob",
      revokeSrcOnDispose: true,
      attempts: [],
    });

    render(
      <ArtifactViewer type="video" content={content} title="Video Overview" artifactId="job-video" />
    );

    // Media resolves and metadata fires BEFORE the job (with the saved
    // position) comes back.
    const video = (await waitFor(() => {
      const el = document.querySelector("video") as HTMLVideoElement | null;
      expect(el).toBeTruthy();
      return el;
    })) as HTMLVideoElement;
    Object.defineProperty(video, "duration", { value: 120, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);

    // Now the job resolves with the saved position; the viewer must still
    // seek even though metadata already fired.
    resolveJob!({
      id: "job-video",
      notebookId: "nb-1",
      artifactType: "video",
      status: "succeeded",
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: "2026-08-10T00:00:00Z",
      payload: {
        flashcards: [],
        quizItems: [],
        mediaUrl: "/tmp/video-overview.mp4",
        playbackPosition: 42,
      },
    });

    await waitFor(() => {
      expect(video.currentTime).toBe(42);
    });
  });
});
