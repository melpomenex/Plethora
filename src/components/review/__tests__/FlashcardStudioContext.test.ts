import { describe, expect, it } from "vitest";
import { normalizeContextSelection } from "../FlashcardStudioModal";

describe("Flashcard Studio context normalization", () => {
  it("normalizes null legacy collections and strings", () => {
    expect(normalizeContextSelection({
      mode: "chapters",
      chapters: null,
      pageRange: null,
      excerpt: null,
      searchQuery: null,
      searchResults: null,
    })).toEqual({
      mode: "chapters",
      chapters: [],
      pageRange: null,
      excerpt: "",
      searchQuery: "",
      searchResults: [],
      selectedSectionIds: [],
    });
  });

  it("filters malformed restored chapters and search results", () => {
    expect(normalizeContextSelection({
      mode: "search",
      chapters: [1, null, -2, "3", 4],
      pageRange: { start: -3, end: 0 },
      searchResults: [null, { start: 2, end: 5, preview: "match" }, { preview: null }],
    })).toMatchObject({
      chapters: [1, 4],
      pageRange: { start: 1, end: 1 },
      searchResults: [{ start: 2, end: 5, preview: "match" }],
    });
  });
});
