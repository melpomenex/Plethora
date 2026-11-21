import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportPreview } from "../ImportPreview";
import { URLType } from "../../../hooks/useURLDetector";
import type { YouTubePlaylist, YouTubeVideo } from "../../../api/youtube";
import { useDocumentStore } from "../../../stores/documentStore";

const mockImportYouTubeVideo = vi.fn();
const mockSubscribeToPlaylist = vi.fn();

vi.mock("../../../api/documents", () => ({
  importYouTubeVideo: (...args: unknown[]) => mockImportYouTubeVideo(...args),
}));

vi.mock("../../../api/youtubePlaylist", () => ({
  subscribeToPlaylist: (...args: unknown[]) => mockSubscribeToPlaylist(...args),
}));

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
}));

const sampleVideos: YouTubeVideo[] = [
  {
    id: "VMj-3S1tku0",
    title: "Lecture 1: Micrograd and Backpropagation",
    description: "",
    channel: "Andrej Karpathy",
    channelId: "UC1",
    duration: 8742,
    viewCount: 1000,
    uploadDate: "",
    thumbnail: "https://img.youtube.com/vi/VMj-3S1tku0/hqdefault.jpg",
    publishDate: "",
    tags: [],
    category: "",
    liveContent: false,
  },
  {
    id: "PaCmpygFfXo",
    title: "Lecture 2: Building makemore bigram model",
    description: "",
    channel: "Andrej Karpathy",
    channelId: "UC1",
    duration: 7020,
    viewCount: 900,
    uploadDate: "",
    thumbnail: "https://img.youtube.com/vi/PaCmpygFfXo/hqdefault.jpg",
    publishDate: "",
    tags: [],
    category: "",
    liveContent: false,
  },
  {
    id: "TCH_1BHY58I",
    title: "Lecture 3: MLP and BatchNorm",
    description: "",
    channel: "Andrej Karpathy",
    channelId: "UC1",
    duration: 6900,
    viewCount: 800,
    uploadDate: "",
    thumbnail: "https://img.youtube.com/vi/TCH_1BHY58I/hqdefault.jpg",
    publishDate: "",
    tags: [],
    category: "",
    liveContent: false,
  },
  {
    id: "q8SA3rM6ckI",
    title: "Lecture 4: Becoming a Backprop Ninja",
    description: "",
    channel: "Andrej Karpathy",
    channelId: "UC1",
    duration: 6500,
    viewCount: 700,
    uploadDate: "",
    thumbnail: "https://img.youtube.com/vi/q8SA3rM6ckI/hqdefault.jpg",
    publishDate: "",
    tags: [],
    category: "",
    liveContent: false,
  },
];

const samplePlaylist: YouTubePlaylist = {
  id: "PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ",
  title: "Neural Networks: Zero to Hero",
  description: "Full course",
  channel: "Andrej Karpathy",
  channelId: "UC1",
  videoCount: 4,
  thumbnail: sampleVideos[0].thumbnail,
  videos: sampleVideos,
};

describe("ImportPreview YouTube Playlist dropdown & selective import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({
      documents: [
        {
          id: "existing-doc-1",
          title: "Lecture 1: Micrograd and Backpropagation",
          filePath: "https://www.youtube.com/watch?v=VMj-3S1tku0",
          fileType: "youtube",
          content: "",
          tags: [],
          dateAdded: new Date().toISOString(),
          dateModified: new Date().toISOString(),
          extractCount: 0,
          learningItemCount: 0,
          priorityRating: 0,
          prioritySlider: 50,
          priorityScore: 5,
          isArchived: false,
          isFavorite: false,
        },
      ],
      loadDocuments: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it("renders playlist dropdown, marks already-imported videos, and opens existing doc", () => {
    const onOpenExisting = vi.fn();
    render(
      <ImportPreview
        urlType={URLType.YouTube}
        url="https://www.youtube.com/playlist?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
        data={samplePlaylist}
        isLoading={false}
        error={null}
        onImport={vi.fn()}
        isImporting={false}
        duplicateCheck={{ isDuplicate: false }}
        onOpenExisting={onOpenExisting}
      />
    );

    expect(screen.getByText("Neural Networks: Zero to Hero")).toBeInTheDocument();
    expect(screen.getByText("1/4 in library")).toBeInTheDocument();

    // First video is already imported
    const row1 = screen.getByTestId("playlist-video-row-VMj-3S1tku0");
    expect(row1).toHaveTextContent("Imported");

    fireEvent.click(screen.getByRole("button", { name: `Open ${sampleVideos[0].title}` }));
    expect(onOpenExisting).toHaveBeenCalledWith("existing-doc-1");
  });

  it("supports Select All / Deselect All (skipping already-imported videos), title filtering, and batch import", async () => {
    mockImportYouTubeVideo.mockImplementation(async (url: string) => ({
      id: `imported-${url}`,
      title: url,
    }));
    const onImport = vi.fn();

    render(
      <ImportPreview
        urlType={URLType.YouTube}
        url="https://www.youtube.com/playlist?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
        data={samplePlaylist}
        isLoading={false}
        error={null}
        onImport={onImport}
        isImporting={false}
        duplicateCheck={{ isDuplicate: false }}
      />
    );

    // Click Select All -> selects the 3 unimported videos (leaves VMj-3S1tku0 unselected)
    fireEvent.click(screen.getByRole("button", { name: /Select All/i }));
    expect(screen.getByRole("button", { name: /Import Selected \(3\)/i })).toBeInTheDocument();

    const importedCheckbox = screen.getByRole("checkbox", {
      name: `Select ${sampleVideos[0].title}`,
    }) as HTMLInputElement;
    expect(importedCheckbox.checked).toBe(false);

    // Filter by title while preserving selection
    const filterInput = screen.getByRole("textbox", { name: /Filter playlist videos/i });
    fireEvent.change(filterInput, { target: { value: "makemore" } });

    expect(screen.getByTestId("playlist-video-row-PaCmpygFfXo")).toBeInTheDocument();
    expect(screen.queryByTestId("playlist-video-row-TCH_1BHY58I")).not.toBeInTheDocument();
    // Selected count remains 3
    expect(screen.getByRole("button", { name: /Import Selected \(3\)/i })).toBeInTheDocument();

    // Clear filter and trigger batch import
    fireEvent.change(filterInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Import Selected \(3\)/i }));

    await waitFor(() => {
      expect(mockImportYouTubeVideo).toHaveBeenCalledTimes(3);
    });
    expect(mockImportYouTubeVideo).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=PaCmpygFfXo",
      undefined
    );
    expect(mockImportYouTubeVideo).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=TCH_1BHY58I",
      undefined
    );
    expect(mockImportYouTubeVideo).toHaveBeenNthCalledWith(
      3,
      "https://www.youtube.com/watch?v=q8SA3rM6ckI",
      undefined
    );
    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({
        youtubeMode: "playlist",
        selectedVideoIds: ["PaCmpygFfXo", "TCH_1BHY58I", "q8SA3rM6ckI"],
      })
    );
  });

  it("imports a single video directly from a playlist row and marks it as imported", async () => {
    mockImportYouTubeVideo.mockResolvedValueOnce({
      id: "new-doc-2",
      title: sampleVideos[1].title,
    });

    render(
      <ImportPreview
        urlType={URLType.YouTube}
        url="https://www.youtube.com/playlist?list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
        data={samplePlaylist}
        isLoading={false}
        error={null}
        onImport={vi.fn()}
        isImporting={false}
        duplicateCheck={{ isDuplicate: false }}
        onOpenExisting={vi.fn()}
      />
    );

    const importBtn = screen.getByRole("button", { name: `Import ${sampleVideos[1].title}` });
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockImportYouTubeVideo).toHaveBeenCalledWith(
        "https://www.youtube.com/watch?v=PaCmpygFfXo",
        undefined
      );
    });

    await waitFor(() => {
      const row2 = screen.getByTestId("playlist-video-row-PaCmpygFfXo");
      expect(row2).toHaveTextContent("Imported");
    });
  });

  it("renders mode toggle between Single Video and Playlist when URL has both v= and list=", () => {
    render(
      <ImportPreview
        urlType={URLType.YouTube}
        url="https://www.youtube.com/watch?v=PaCmpygFfXo&list=PLAqhIrjkxbuWI23v9cThsA9GvCAUhRvKZ"
        data={sampleVideos[1]}
        playlistData={samplePlaylist}
        isLoading={false}
        error={null}
        onImport={vi.fn()}
        isImporting={false}
        duplicateCheck={{ isDuplicate: false }}
      />
    );

    // Starts in Single Video mode for watch?v=...&list=...
    expect(screen.getByRole("button", { name: /Import Video/i })).toBeInTheDocument();

    // Switch to Playlist mode
    fireEvent.click(screen.getByRole("tab", { name: /Playlist \(4 videos\)/i }));
    expect(screen.getByTestId("youtube-playlist-import-preview")).toBeInTheDocument();

    // Switch back to Single Video mode
    fireEvent.click(screen.getByRole("tab", { name: /Single Video/i }));
    expect(screen.getByRole("button", { name: /Import Video/i })).toBeInTheDocument();
  });
});
