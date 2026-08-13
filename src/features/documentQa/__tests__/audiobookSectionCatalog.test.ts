import { describe, expect, it, vi } from "vitest";
import { loadAudiobookSectionCatalog } from "../audiobookSectionCatalog";

describe("loadAudiobookSectionCatalog", () => {
  it("rebuilds every stored transcript chapter for Document Q&A", async () => {
    const stored = {
      chapters: [
        { id: 1, title: "001", startTime: 0, endTime: 60 },
        { id: 8, title: "008", startTime: 60, endTime: 120 },
        { id: 50, title: "050", startTime: 120, endTime: 180 },
      ],
      transcript: {
        segments: [
          { startTime: 5, endTime: 20, text: "Foreword text" },
          { startTime: 70, endTime: 90, text: "Cortical column text" },
          { startTime: 130, endTime: 150, text: "Closing chapter text" },
        ],
      },
    };

    const sections = await loadAudiobookSectionCatalog(
      { id: "book-1", filePath: "/books/book.m4b" },
      { storage: { getItem: () => JSON.stringify(stored) } },
    );

    expect(sections.map((section) => section.title)).toEqual(["001", "008", "050"]);
    expect(sections.every((section) => section.source === "media-transcript")).toBe(true);
    expect(sections.find((section) => section.title === "008")?.content).toBe("Cortical column text");
  });

  it("loads parsed chapters and persisted Whisper segments when the local mirror is incomplete", async () => {
    const parseMetadata = vi.fn().mockResolvedValue({
      chapters: [
        { id: 1, title: "001", startTime: 0, endTime: 60 },
        { id: 2, title: "002", startTime: 60, endTime: 120 },
      ],
    });
    const loadTranscript = vi.fn().mockResolvedValue({
      segments: [
        { start_ms: 5_000, end_ms: 20_000, text: "Opening" },
        { start_ms: 70_000, end_ms: 90_000, text: "Second chapter" },
      ],
    });

    const sections = await loadAudiobookSectionCatalog(
      { id: "book-2", filePath: "/books/book-2.m4b" },
      {
        storage: { getItem: () => null },
        parseMetadata: parseMetadata as never,
        loadTranscript: loadTranscript as never,
      },
    );

    expect(parseMetadata).toHaveBeenCalledWith("/books/book-2.m4b");
    expect(loadTranscript).toHaveBeenCalledWith("book-2", "book-2");
    expect(sections.map((section) => section.title)).toEqual(["001", "002"]);
  });
});
