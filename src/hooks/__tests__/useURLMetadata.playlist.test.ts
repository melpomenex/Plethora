import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { urlDetectorUtils, URLType } from "../useURLDetector";
import {
  useURLMetadata,
  isYouTubePlaylistData,
  findImportedYouTubeDocument,
} from "../useURLMetadata";

const mockFetchYouTubeVideoInfo = vi.fn();
const mockFetchYouTubePlaylist = vi.fn();

vi.mock("../../api/youtube", async () => {
  const actual = await vi.importActual<typeof import("../../api/youtube")>("../../api/youtube");
  return {
    ...actual,
    fetchYouTubeVideoInfo: (...args: unknown[]) => mockFetchYouTubeVideoInfo(...args),
    fetchYouTubePlaylist: (...args: unknown[]) => mockFetchYouTubePlaylist(...args),
  };
});

describe("useURLDetector & useURLMetadata playlist resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects dedicated YouTube playlist URLs and watch+playlist URLs", () => {
    const dedicated = urlDetectorUtils.detectURL(
      "https://www.youtube.com/playlist?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
    );
    expect(dedicated.isURL).toBe(true);
    expect(dedicated.type).toBe(URLType.YouTube);
    expect(dedicated.youtubeId).toBeUndefined();
    expect(dedicated.playlistId).toBe("PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ");

    const dual = urlDetectorUtils.detectURL(
      "https://www.youtube.com/watch?v=VMj-3S1tku0&list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
    );
    expect(dual.isURL).toBe(true);
    expect(dual.type).toBe(URLType.YouTube);
    expect(dual.youtubeId).toBe("VMj-3S1tku0");
    expect(dual.playlistId).toBe("PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ");

    const listFirst = urlDetectorUtils.detectURL(
      "https://www.youtube.com/watch?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ&v=VMj-3S1tku0"
    );
    expect(listFirst.isURL).toBe(true);
    expect(listFirst.type).toBe(URLType.YouTube);
    expect(listFirst.youtubeId).toBe("VMj-3S1tku0");
    expect(listFirst.playlistId).toBe("PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ");
  });

  it("resolves playlist metadata for dedicated YouTube playlist URLs", async () => {
    const fakePlaylist = {
      id: "PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ",
      title: "Zero to Hero",
      description: "",
      channel: "Andrej Karpathy",
      channelId: "UC1",
      videoCount: 2,
      thumbnail: "https://img.youtube.com/vi/VMj-3S1tku0/hqdefault.jpg",
      videos: [
        {
          id: "VMj-3S1tku0",
          title: "Micrograd",
          description: "",
          channel: "Andrej Karpathy",
          channelId: "UC1",
          duration: 8742,
          viewCount: 0,
          uploadDate: "",
          thumbnail: "https://img.youtube.com/vi/VMj-3S1tku0/hqdefault.jpg",
          publishDate: "",
          tags: [],
          category: "",
          liveContent: false,
        },
      ],
    };

    mockFetchYouTubePlaylist.mockResolvedValueOnce(fakePlaylist);

    const { result } = renderHook(() =>
      useURLMetadata(
        URLType.YouTube,
        "https://www.youtube.com/playlist?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ",
        { debounceMs: 0, enabled: true }
      )
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).not.toBeNull();
    });

    expect(isYouTubePlaylistData(result.current.data)).toBe(true);
    expect(result.current.playlistData).toEqual(fakePlaylist);
    expect(mockFetchYouTubeVideoInfo).not.toHaveBeenCalled();
  });

  it("resolves both single video and playlist metadata for dual watch+playlist URLs", async () => {
    const fakeVideo = {
      id: "VMj-3S1tku0",
      title: "Micrograd",
      description: "",
      channel: "Andrej Karpathy",
      channelId: "UC1",
      duration: 8742,
      viewCount: 0,
      uploadDate: "",
      thumbnail: "https://img.youtube.com/vi/VMj-3S1tku0/hqdefault.jpg",
      publishDate: "",
      tags: [],
      category: "",
      liveContent: false,
    };
    const fakePlaylist = {
      id: "PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ",
      title: "Zero to Hero",
      description: "",
      channel: "Andrej Karpathy",
      channelId: "UC1",
      videoCount: 2,
      thumbnail: "https://img.youtube.com/vi/VMj-3S1tku0/hqdefault.jpg",
      videos: [fakeVideo],
    };

    mockFetchYouTubeVideoInfo.mockResolvedValueOnce(fakeVideo);
    mockFetchYouTubePlaylist.mockResolvedValueOnce(fakePlaylist);

    const { result } = renderHook(() =>
      useURLMetadata(
        URLType.YouTube,
        "https://www.youtube.com/watch?v=VMj-3S1tku0&list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ",
        { debounceMs: 0, enabled: true }
      )
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).not.toBeNull();
    });

    expect(result.current.data).toEqual(fakeVideo);
    expect(result.current.playlistData).toEqual(fakePlaylist);
    expect(mockFetchYouTubeVideoInfo).toHaveBeenCalledWith("VMj-3S1tku0");
    expect(mockFetchYouTubePlaylist).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=VMj-3S1tku0&list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
    );
  });

  it("matches already-imported YouTube documents by videoId", () => {
    const docs = [
      {
        id: "doc-yt-1",
        title: "Micrograd Lecture",
        filePath: "https://www.youtube.com/watch?v=VMj-3S1tku0",
        fileType: "youtube",
      },
    ];
    expect(findImportedYouTubeDocument("VMj-3S1tku0", docs)).toEqual({
      id: "doc-yt-1",
      title: "Micrograd Lecture",
    });
    expect(findImportedYouTubeDocument("otherId1234", docs)).toBeUndefined();
  });
});
