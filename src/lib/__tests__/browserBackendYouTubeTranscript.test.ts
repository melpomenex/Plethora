import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../database", () => ({
  getDocuments: vi.fn(),
  updateDocument: vi.fn(async (id: string, updates: Record<string, unknown>) => ({ id, ...updates })),
}));

vi.mock("../../stores/llmProvidersStore", () => ({
  useLLMProvidersStore: { getState: () => ({ providers: [] }) },
}));

import { browserInvoke } from "../browser-backend";
import * as db from "../database";

/**
 * Browser/PWA parity for the complete-transcript fix: the web backend must
 * persist and return the whole YouTube transcript (no head slice), because the
 * shared Document Q&A workspace grounds a single-video turn on whatever
 * `get_youtube_transcript_by_id` returns.
 */
describe("browser backend YouTube transcript parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("stores the complete transcript in the document and returns every cached segment", async () => {
    vi.mocked(db.getDocuments).mockResolvedValue([
      {
        id: "doc-yt",
        title: "Video",
        file_type: "youtube",
        file_path: "https://www.youtube.com/watch?v=abc12345678",
      } as never,
    ]);
    const segments = Array.from({ length: 500 }, (_, index) => ({
      start: index * 10,
      duration: 10,
      text: `spoken line ${index}`,
    }));
    segments[0].text = "first sentinel";
    segments[segments.length - 1].text = "last sentinel";

    await browserInvoke("save_youtube_transcript_segments", {
      videoId: "abc12345678",
      documentId: "doc-yt",
      segments,
    });

    const updates = vi.mocked(db.updateDocument).mock.calls.at(-1)![1] as { content: string };
    const lines = updates.content.split("\n");
    expect(lines).toHaveLength(segments.length);
    expect(lines[0]).toBe("[0:00] first sentinel");
    expect(lines.at(-1)).toBe("[83:10] last sentinel");

    const read = await browserInvoke<Array<{ start: number; text: string }>>(
      "get_youtube_transcript_by_id",
      { videoId: "abc12345678" },
    );
    expect(read).toHaveLength(segments.length);
    expect(read.at(-1)!.text).toBe("last sentinel");
  });
});
