import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyUrl,
  validateRedirectUrl,
  detectSharedFileKind,
  isDrmProtectedHost,
  isSupportedMediaExtension,
} from "../urlAdapters";
import { processSharedBatch, type ProcessSharedBatchDeps } from "../../../lib/importRouting";
import { useUIStore } from "../../../stores/uiStore";
import type { SharedBatch } from "../../../types/share";

vi.mock("../../../utils/openDocumentAtLocation", () => ({
  openDocumentAtLocation: vi.fn(),
}));

vi.mock("../../../api/documents", () => ({
  createDocument: vi.fn().mockResolvedValue({ id: "doc-note-1", title: "Note", metadata: {} }),
  mergeDocumentMetadata: vi.fn().mockImplementation((id, updates) => Promise.resolve({ id, title: id, metadata: updates })),
  updateDocumentContent: vi.fn().mockImplementation((id, content) => Promise.resolve({ id, title: "Note", content, metadata: {} })),
}));

describe("urlAdapters and Ingestion Policy (Task 1.5)", () => {
  describe("Policy refusal: Private & Loopback Addresses (SSRF Protection)", () => {
    it("refuses loopback IPv4 and localhost", () => {
      const loopback1 = classifyUrl("http://127.0.0.1/secret.mp3");
      expect(loopback1.isAllowed).toBe(false);
      expect(loopback1.errorCode).toBe("private_network");

      const localhost = classifyUrl("http://localhost:8080/audio.wav");
      expect(localhost.isAllowed).toBe(false);
      expect(localhost.errorCode).toBe("private_network");
    });

    it("refuses private subnet IP ranges (10.x, 192.168.x, 172.16-31.x, link-local 169.254.x)", () => {
      expect(classifyUrl("http://10.1.2.3/stream").isAllowed).toBe(false);
      expect(classifyUrl("http://192.168.1.100/lecture.mp3").isAllowed).toBe(false);
      expect(classifyUrl("http://172.20.0.1/audio.m4a").isAllowed).toBe(false);
      expect(classifyUrl("http://169.254.169.254/latest/meta-data").isAllowed).toBe(false);
      expect(classifyUrl("http://0.0.0.0/test").isAllowed).toBe(false);
    });

    it("refuses IPv6 loopback and internal hosts", () => {
      expect(classifyUrl("http://[::1]/media").isAllowed).toBe(false);
      expect(classifyUrl("http://service.internal/audio").isAllowed).toBe(false);
    });
  });

  describe("Policy refusal: Unsupported Protocols & DRM Sources", () => {
    it("refuses non-HTTP/HTTPS protocols", () => {
      expect(classifyUrl("file:///etc/passwd").errorCode).toBe("unsupported_protocol");
      expect(classifyUrl("ftp://ftp.example.com/audio.mp3").errorCode).toBe("unsupported_protocol");
      expect(classifyUrl("javascript:alert(1)").errorCode).toBe("unsupported_protocol");
      expect(classifyUrl("data:text/plain;base64,SGVsbG8=").errorCode).toBe("unsupported_protocol");
    });

    it("refuses DRM-protected streaming domains", () => {
      expect(isDrmProtectedHost("netflix.com")).toBe(true);
      expect(isDrmProtectedHost("www.netflix.com")).toBe(true);
      expect(isDrmProtectedHost("disneyplus.com")).toBe(true);
      expect(isDrmProtectedHost("hulu.com")).toBe(true);
      expect(isDrmProtectedHost("primevideo.com")).toBe(true);

      const netflix = classifyUrl("https://www.netflix.com/watch/80186863");
      expect(netflix.isAllowed).toBe(false);
      expect(netflix.errorCode).toBe("drm_protected");
    });

    it("refuses private network redirects", () => {
      const redirect = validateRedirectUrl(
        "https://public-site.org/stream",
        "http://127.0.0.1:8080/internal-audio"
      );
      expect(redirect.isAllowed).toBe(false);
      expect(redirect.errorCode).toBe("private_network");
      expect(redirect.reason).toContain("Redirect from");
    });
  });

  describe("Supported URL Adapters & YouTube Compliance", () => {
    it("recognizes YouTube URLs and preserves compliance without arbitrary media downloading", () => {
      const yt = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(yt.isAllowed).toBe(true);
      expect(yt.adapter).toBe("youtube");
      expect(yt.meta?.youtubeId).toBe("dQw4w9WgXcQ");
      expect(yt.meta?.isVideo).toBe(true);

      const short = classifyUrl("https://youtu.be/dQw4w9WgXcQ");
      expect(short.isAllowed).toBe(true);
      expect(short.adapter).toBe("youtube");
    });

    it("recognizes Podcast RSS feeds and leaves podcast importer unchanged", () => {
      const podcast = classifyUrl("https://feeds.megaphone.fm/hubermanlab");
      expect(podcast.isAllowed).toBe(true);
      expect(podcast.adapter).toBe("podcast");
      expect(podcast.meta?.isAudio).toBe(true);

      const rss = classifyUrl("https://lexfridman.com/feed/podcast/");
      expect(rss.isAllowed).toBe(true);
      expect(rss.adapter).toBe("podcast");
    });

    it("recognizes direct media streams for audio and video", () => {
      const mp3 = classifyUrl("https://example.com/lectures/history_101.mp3");
      expect(mp3.isAllowed).toBe(true);
      expect(mp3.adapter).toBe("direct-media");
      expect(mp3.meta?.isAudio).toBe(true);
      expect(mp3.meta?.format).toBe("mp3");

      const mp4 = classifyUrl("https://example.com/lectures/lecture_video.mp4");
      expect(mp4.isAllowed).toBe(true);
      expect(mp4.adapter).toBe("direct-media");
      expect(mp4.meta?.isVideo).toBe(true);
      expect(mp4.meta?.format).toBe("mp4");
    });

    it("recognizes direct transcript files", () => {
      const srt = classifyUrl("https://example.com/subtitles/biology.srt");
      expect(srt.isAllowed).toBe(true);
      expect(srt.adapter).toBe("direct-transcript");
      expect(srt.meta?.format).toBe("srt");

      const vtt = classifyUrl("https://example.com/subtitles/physics.vtt");
      expect(vtt.isAllowed).toBe(true);
      expect(vtt.adapter).toBe("direct-transcript");
    });

    it("classifies general web pages as web-article without converting into media downloader", () => {
      const article = classifyUrl("https://en.wikipedia.org/wiki/Special_relativity");
      expect(article.isAllowed).toBe(true);
      expect(article.adapter).toBe("web-article");
    });
  });

  describe("File Kind Detection", () => {
    it("detects audio and video recording extensions", () => {
      expect(isSupportedMediaExtension("test.mp3")).toBe(true);
      expect(isSupportedMediaExtension("test.m4a")).toBe(true);
      expect(isSupportedMediaExtension("test.wav")).toBe(true);
      expect(isSupportedMediaExtension("test.flac")).toBe(true);
      expect(isSupportedMediaExtension("test.ogg")).toBe(true);
      expect(isSupportedMediaExtension("test.webm")).toBe(true);
      expect(isSupportedMediaExtension("test.mp4")).toBe(true);
      expect(isSupportedMediaExtension("test.mov")).toBe(true);

      const detection = detectSharedFileKind("/storage/emulated/0/Recordings/voice_001.m4a");
      expect(detection.isRecording).toBe(true);
      expect(detection.isTranscript).toBe(false);
      expect(detection.suggestedRoute).toBe("import-media");
    });

    it("detects transcript extensions (srt, vtt)", () => {
      const vtt = detectSharedFileKind("/downloads/lecture.vtt");
      expect(vtt.isRecording).toBe(false);
      expect(vtt.isTranscript).toBe(true);
      expect(vtt.suggestedRoute).toBe("import-transcript");

      const srt = detectSharedFileKind("/downloads/lecture.srt");
      expect(srt.isTranscript).toBe(true);
      expect(srt.suggestedRoute).toBe("import-transcript");
    });

    it("identifies non-recording document files", () => {
      expect(detectSharedFileKind("document.pdf").isRecording).toBe(false);
      expect(detectSharedFileKind("document.epub").isRecording).toBe(false);
      expect(detectSharedFileKind("notes.md").isRecording).toBe(false);
    });
  });
});

describe("processSharedBatch Integration with urlAdapters (Task 1.5)", () => {
  let mockToast: any;
  let mockDocStore: any;
  let mockTabsStore: any;
  let mockOpenExternal: any;
  let deps: ProcessSharedBatchDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast = {
      info: vi.fn().mockReturnValue("toast-info-1"),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      dismiss: vi.fn(),
    };
    mockDocStore = {
      importFromUrl: vi.fn().mockResolvedValue({ id: "doc-1", title: "Imported Doc" }),
      openTwitterThread: vi.fn(),
      importFromFiles: vi.fn().mockResolvedValue([{ id: "doc-pdf-1", title: "Paper.pdf" }]),
      loadDocuments: vi.fn().mockResolvedValue([]),
      persistWebArticleFailure: vi.fn(),
    };
    mockTabsStore = {
      addTab: vi.fn(),
    };
    mockOpenExternal = vi.fn();
    deps = {
      t: (key: string) => key,
      toast: mockToast,
      getDocumentStore: () => mockDocStore,
      getTabsStore: () => mockTabsStore,
      openExternal: mockOpenExternal,
    };
    useUIStore.setState({
      captureImportDialogOpen: false,
      captureImportInitialRoute: undefined,
      captureImportInitialData: undefined,
    });
  });

  it("refuses private network URL share and shows error toast without calling importFromUrl", async () => {
    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{ type: "url", url: "http://127.0.0.1:8080/internal.mp3" }],
    };

    const result = await processSharedBatch(batch, deps);
    expect(result.failed).toBe(1);
    expect(mockDocStore.importFromUrl).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "mainLayout.importFailed",
      expect.stringContaining("private or local network"),
      expect.any(Object)
    );
  });

  it("refuses DRM streaming service URL share without calling importFromUrl", async () => {
    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://www.netflix.com/watch/123456" }],
    };

    const result = await processSharedBatch(batch, deps);
    expect(result.failed).toBe(1);
    expect(mockDocStore.importFromUrl).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(
      "mainLayout.importFailed",
      expect.stringContaining("DRM-protected"),
      expect.any(Object)
    );
  });

  it("routes direct media URL share to CaptureImportDialog with initial url prefilled", async () => {
    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{ type: "url", url: "https://cdn.example.org/podcasts/episode12.mp3", title: "Episode 12" }],
    };

    const result = await processSharedBatch(batch, deps);
    expect(result.imported).toBe(1);
    expect(mockDocStore.importFromUrl).not.toHaveBeenCalled();

    // Verify CaptureImportDialog was opened with prefilled data
    const uiState = useUIStore.getState();
    expect(uiState.captureImportDialogOpen).toBe(true);
    expect(uiState.captureImportInitialRoute).toBe("import-url");
    expect(uiState.captureImportInitialData?.url).toBe("https://cdn.example.org/podcasts/episode12.mp3");
    expect(uiState.captureImportInitialData?.title).toBe("Episode 12");
  });

  it("routes shared recording file to CaptureImportDialog with prefilled path and suggested route", async () => {
    const batch: SharedBatch = {
      id: "send-intent-101",
      timestamp: Date.now(),
      items: [{
        type: "file",
        filePath: "/storage/emulated/0/Download/lecture_physics.m4a",
        fileName: "lecture_physics.m4a",
        title: "Physics Lecture",
      }],
    };

    const result = await processSharedBatch(batch, deps);
    expect(result.imported).toBe(1);
    expect(mockDocStore.importFromFiles).not.toHaveBeenCalled();

    const uiState = useUIStore.getState();
    expect(uiState.captureImportDialogOpen).toBe(true);
    expect(uiState.captureImportInitialRoute).toBe("import-media");
    expect(uiState.captureImportInitialData?.filePath).toBe("/storage/emulated/0/Download/lecture_physics.m4a");
    expect(uiState.captureImportInitialData?.fileName).toBe("lecture_physics.m4a");
  });

  it("routes shared transcript file to CaptureImportDialog with suggested route import-transcript", async () => {
    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{
        type: "file",
        filePath: "/storage/emulated/0/Download/lecture_physics.vtt",
        fileName: "lecture_physics.vtt",
      }],
    };

    const result = await processSharedBatch(batch, deps);
    expect(result.imported).toBe(1);
    const uiState = useUIStore.getState();
    expect(uiState.captureImportDialogOpen).toBe(true);
    expect(uiState.captureImportInitialRoute).toBe("import-transcript");
  });

  it("routes regular document files to existing importFromFiles without opening recording dialog", async () => {
    const batch: SharedBatch = {
      timestamp: Date.now(),
      items: [{
        type: "file",
        filePath: "/storage/emulated/0/Download/deep_learning.pdf",
        fileName: "deep_learning.pdf",
      }],
    };

    const result = await processSharedBatch(batch, deps);
    expect(result.imported).toBe(1);
    expect(mockDocStore.importFromFiles).toHaveBeenCalledWith(["/storage/emulated/0/Download/deep_learning.pdf"]);
    expect(useUIStore.getState().captureImportDialogOpen).toBe(false);
  });
});
