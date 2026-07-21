import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTranscript } from "../sourceChain";
import { useSettingsStore } from "../../../stores/settingsStore";

// Mock tauri
const mockInvokeCommand = vi.fn();
vi.mock("../../tauri", () => ({
  isTauri: () => true,
  invokeCommand: (...args: any[]) => mockInvokeCommand(...args),
}));

// Mock browser transcript fetcher
const mockFetchFromBrowser = vi.fn();
vi.mock("../../../utils/youtubeTranscriptBrowser", () => ({
  fetchYouTubeTranscript: (...args: any[]) => mockFetchFromBrowser(...args),
}));

// Mock settingsStore
const originalSettings = useSettingsStore.getState().settings;

describe("Transcript Source Chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset settings to default
    useSettingsStore.setState({
      settings: {
        ...originalSettings,
        youtube: {
          apiKey: undefined,
          enabled: false,
          transcriptServerUrl: undefined,
          transcriptServerApiKey: undefined,
          transcriptOnDeviceEnabled: true,
        },
      },
    });
  });

  it("resolves from on-device when successful", async () => {
    mockInvokeCommand.mockResolvedValue({
      status: "ok",
      segments: [{ text: "Hello", start: 0, duration: 1 }],
      language: "en",
    });

    const result = await resolveTranscript("video123");

    expect(result.source).toBe("on-device");
    expect(result.segments).toEqual([{ text: "Hello", start: 0, duration: 1 }]);
    expect(mockInvokeCommand).toHaveBeenCalledWith("fetch_youtube_transcript_on_device", {
      videoId: "video123",
      language: undefined,
      documentId: null,
    });
  });

  it("raises terminal error and does not fall through if NoCaptions", async () => {
    mockInvokeCommand.mockResolvedValue({
      status: "err",
      kind: "NoCaptions",
      detail: "No captions available",
    });

    await expect(resolveTranscript("video123")).rejects.toThrow("No captions available");
    expect(mockFetchFromBrowser).not.toHaveBeenCalled();
  });

  it("falls through to hosted relay if on-device returns non-terminal error", async () => {
    mockInvokeCommand.mockResolvedValue({
      status: "err",
      kind: "PoTokenRequired",
      detail: "Signature gate",
    });

    mockFetchFromBrowser.mockResolvedValue({
      segments: [{ text: "Relay transcript", start: 1, duration: 2 }],
      language: "en",
      videoId: "video123",
    });

    const result = await resolveTranscript("video123");

    expect(result.source).toBe("relay");
    expect(result.segments).toEqual([{ text: "Relay transcript", start: 1, duration: 2 }]);
    expect(mockFetchFromBrowser).toHaveBeenCalledWith("video123", undefined);
  });

  it("calls self-hosted server when url is configured and on-device fails", async () => {
    mockInvokeCommand.mockResolvedValue({
      status: "err",
      kind: "PoTokenRequired",
      detail: "Signature gate",
    });

    // Set self-hosted VPS URL
    useSettingsStore.setState({
      settings: {
        ...originalSettings,
        youtube: {
          apiKey: undefined,
          enabled: false,
          transcriptServerUrl: "https://my-vps.com",
          transcriptServerApiKey: "my-key",
          transcriptOnDeviceEnabled: true,
        },
      },
    });

    // Mock fetch for VPS call
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        segments: [{ text: "VPS transcript", start: 2, duration: 3 }],
        language: "en",
      }),
    });
    globalThis.fetch = mockFetch;

    const result = await resolveTranscript("video123");

    expect(result.source).toBe("self-hosted");
    expect(result.segments).toEqual([{ text: "VPS transcript", start: 2, duration: 3 }]);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://my-vps.com/api/youtube/transcript?videoId=video123",
      expect.objectContaining({
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "my-key",
        },
      })
    );
  });
});
