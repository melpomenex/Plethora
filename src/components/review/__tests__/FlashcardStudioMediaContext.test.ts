import { describe, expect, it, vi } from "vitest";
import type { SectionNode } from "../../../utils/sectionIndex";
import {
  mediaTranscriptContextText,
  preferredStudioDocumentContextText,
  resolveStudioSectionContext,
} from "../studio/mediaSectionContext";

const chapter = (title: string, content: string): SectionNode => ({
  id: `media-${title}`,
  title,
  level: 1,
  breadcrumb: ["Transcript"],
  preview: content,
  content,
  children: [],
  parentId: null,
  source: "media-transcript",
  hasAuthoritativeRange: false,
  documentId: "book-1",
});

describe("Flashcard Studio audiobook context", () => {
  it("uses viewer-published chapter text without loading document content", async () => {
    const chapters = [
      chapter("001", "FOREWORD_ONLY"),
      chapter("008", "CORTICAL_COLUMN_CONTENT"),
    ];
    const loadCanonicalText = vi.fn(async () => {
      throw new Error("document extraction should not run");
    });

    const focused = await resolveStudioSectionContext({
      selectedSections: [chapters[1]],
      availableSections: chapters,
      documentId: "book-1",
      maxTokens: 500,
      loadCanonicalText,
    });

    expect(loadCanonicalText).not.toHaveBeenCalled();
    expect(focused.ok).toBe(true);
    expect(focused.content).toContain("CORTICAL_COLUMN_CONTENT");
    expect(focused.content).not.toContain("FOREWORD_ONLY");
    expect(focused.source.ranges).toEqual([]);
  });

  it("uses the audiobook catalog as the Studio document-context fallback", () => {
    const chapters = [
      chapter("001", "Foreword transcript."),
      chapter("008", "Chapter eight transcript."),
    ];
    const text = mediaTranscriptContextText(chapters);

    expect(text).toBe("Foreword transcript.\n\nChapter eight transcript.");
    expect(preferredStudioDocumentContextText(undefined, undefined, chapters)).toBe(text);
  });
});
