import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchYouTubePlaylist, normalizeYtdlpPlaylist } from "../youtube";

const mockInvokeCommand = vi.fn();
const mockIsTauri = vi.fn(() => true);
const mockIsNativeMobile = vi.fn(() => false);
const mockIsYouTubeApiEnabled = vi.fn(() => false);
const mockFetchPlaylistInfo = vi.fn();
const mockFetchVideoDurations = vi.fn();

vi.mock("../../lib/tauri", () => ({
  isTauri: () => mockIsTauri(),
  isNativeMobile: () => mockIsNativeMobile(),
  invokeCommand: (...args: unknown[]) => mockInvokeCommand(...args),
}));

vi.mock("../../lib/youtubeDataApi", () => ({
  isYouTubeApiEnabled: () => mockIsYouTubeApiEnabled(),
  fetchPlaylistInfo: (...args: unknown[]) => mockFetchPlaylistInfo(...args),
  fetchVideoDurations: (...args: unknown[]) => mockFetchVideoDurations(...args),
  parseDuration: (iso: string) => (iso === "PT4M15S" ? 255 : 0),
}));

describe("fetchYouTubePlaylist & normalizeYtdlpPlaylist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
    mockIsNativeMobile.mockReturnValue(false);
    mockIsYouTubeApiEnabled.mockReturnValue(false);
  });

  it("normalizes yt-dlp flat playlist entries into YouTubePlaylist", () => {
    const raw = {
      title: "Neural Networks: Zero to Hero",
      channel: "Andrej Karpathy",
      channel_id: "UCXUPKJO5MZQN11PqgIvyuvQ",
      description: "A course on neural networks",
      entries: [
        {
          id: "VMj-3S1tku0",
          title: "The spelled-out intro to neural networks and backpropagation",
          duration: 8742,
          view_count: 1500000,
          channel: "Andrej Karpathy",
          thumbnails: [{ url: "https://i.ytimg.com/vi/VMj-3S1tku0/hqdefault.jpg" }],
        },
        {
          url: "https://www.youtube.com/watch?v=PaCmpygFfXo",
          title: "The spelled-out intro to language modeling: building makemore",
          duration: "7020",
        },
      ],
    };

    const playlist = normalizeYtdlpPlaylist("PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ", raw);
    expect(playlist).not.toBeNull();
    expect(playlist?.id).toBe("PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ");
    expect(playlist?.title).toBe("Neural Networks: Zero to Hero");
    expect(playlist?.channel).toBe("Andrej Karpathy");
    expect(playlist?.videoCount).toBe(2);
    expect(playlist?.videos).toHaveLength(2);
    expect(playlist?.videos[0].id).toBe("VMj-3S1tku0");
    expect(playlist?.videos[0].duration).toBe(8742);
    expect(playlist?.videos[1].id).toBe("PaCmpygFfXo");
    expect(playlist?.videos[1].duration).toBe(7020);
  });

  it("fetches playlist via Tauri get_youtube_playlist_info command when available", async () => {
    mockInvokeCommand.mockResolvedValueOnce({
      title: "Category Theory",
      channel: "Bartosz Milewski",
      entries: [
        {
          id: "I8LbkfSSR58",
          title: "Category Theory 1.1: Motivation and Philosophy",
          duration: 2850,
        },
      ],
    });

    const result = await fetchYouTubePlaylist(
      "https://www.youtube.com/playlist?list=PLbgaMIhjbmEnaH_LTkxLI7FMa2HsnawM_"
    );

    expect(mockInvokeCommand).toHaveBeenCalledWith("get_youtube_playlist_info", {
      url: "https://www.youtube.com/playlist?list=PLbgaMIhjbmEnaH_LTkxLI7FMa2HsnawM_",
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe("PLbgaMIhjbmEnaH_LTkxLI7FMa2HsnawM_");
    expect(result?.title).toBe("Category Theory");
    expect(result?.videos).toHaveLength(1);
    expect(result?.videos[0].id).toBe("I8LbkfSSR58");
  });

  it("falls back to YouTube Data API fetchPlaylistInfo when Tauri fails or is unavailable", async () => {
    mockInvokeCommand.mockRejectedValueOnce(new Error("yt-dlp failed"));
    mockIsYouTubeApiEnabled.mockReturnValue(true);
    mockFetchPlaylistInfo.mockResolvedValueOnce({
      id: "PL12345",
      title: "API Fallback Playlist",
      description: "Loaded from Data API",
      channelTitle: "Test Channel",
      channelId: "UC123",
      thumbnail: "https://example.com/thumb.jpg",
      itemCount: 1,
      videos: [
        {
          id: "item-1",
          videoId: "dQw4w9WgXcQ",
          title: "Fallback Video",
          description: "Video desc",
          thumbnail: "https://example.com/v1.jpg",
          position: 0,
        },
      ],
    });
    mockFetchVideoDurations.mockResolvedValueOnce(new Map([["dQw4w9WgXcQ", "PT4M15S"]]));

    const result = await fetchYouTubePlaylist("PL12345");
    expect(mockFetchPlaylistInfo).toHaveBeenCalledWith("PL12345");
    expect(result).not.toBeNull();
    expect(result?.title).toBe("API Fallback Playlist");
    expect(result?.videos).toHaveLength(1);
    expect(result?.videos[0].id).toBe("dQw4w9WgXcQ");
    expect(result?.videos[0].duration).toBe(255);
  });
});
