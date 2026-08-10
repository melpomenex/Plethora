import { describe, it, expect } from "vitest";
import { resolveCitationLocation, type CitationLocationDeps } from "../resolveCitationLocation";
import type { Document } from "../../types/document";

function makeDocument(overrides: Partial<Document>): Document {
  return {
    id: "doc-1",
    title: "Test Document",
    filePath: "/tmp/test.pdf",
    fileType: "pdf",
    content: undefined,
    tags: [],
    dateAdded: "2026-01-01",
    dateModified: "2026-01-01",
    extractCount: 0,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
    ...overrides,
  };
}

const PDF_CONTENT = `
<html><body>
<div class="page" id="page-1"><div class="page-content"><p>Introductory text that is unique to page one.</p></div></div>
<div class="page" id="page-2"><div class="page-content"><p>The quick brown fox jumps over the lazy dog and keeps running.</p></div></div>
</body></html>`;

describe("resolveCitationLocation", () => {
  it("resolves a PDF quote to the page whose marker precedes the match", async () => {
    const doc = makeDocument({ fileType: "pdf", content: PDF_CONTENT });
    const location = await resolveCitationLocation(doc, "The quick brown fox jumps over the lazy dog and keeps running.");
    expect(location).toEqual({
      kind: "pdf",
      pageNumber: 2,
      textQuote: "The quick brown fox jumps over the lazy dog and keeps running.",
    });
  });

  it("resolves a PDF quote to a page using form-feed page separators (stored pdf-extract content)", async () => {
    // The Rust PDF processor stores the raw pdf-extract output, where pages
    // are separated by \u000c form feeds — not the viewer HTML markers.
    const content = [
      "Introduction words on the first page.",
      "Middle page with the cited passage inside.",
      "Conclusion on the third page.",
    ].join("\u000c");
    const doc = makeDocument({ fileType: "pdf", content, totalPages: 3 });
    const location = await resolveCitationLocation(doc, "Middle page with the cited passage inside.");
    expect(location).toEqual({
      kind: "pdf",
      pageNumber: 2,
      textQuote: "Middle page with the cited passage inside.",
    });
  });

  it("treats a single-page PDF without separators as page 1", async () => {
    const doc = makeDocument({
      fileType: "pdf",
      content: "Only page with the quoted text.",
      totalPages: 1,
    });
    const location = await resolveCitationLocation(doc, "Only page with the quoted text.");
    expect(location?.kind === "pdf" && location.pageNumber).toBe(1);
  });

  it("returns null when a multi-page PDF has no page separators and no markers", async () => {
    const doc = makeDocument({
      fileType: "pdf",
      content: "Some text with the quoted passage but no page boundaries.",
      totalPages: 5,
    });
    const location = await resolveCitationLocation(doc, "Some text with the quoted passage but no page boundaries.");
    expect(location).toBeNull();
  });

  it("matches a PDF quote case-insensitively across collapsed whitespace", async () => {
    const doc = makeDocument({ fileType: "pdf", content: PDF_CONTENT });
    const location = await resolveCitationLocation(doc, "the  quick\nbrown fox jumps");
    expect(location?.kind).toBe("pdf");
    expect(location?.kind === "pdf" && location.pageNumber).toBe(2);
  });

  it("returns null for a PDF match with no page marker before it", async () => {
    const doc = makeDocument({
      fileType: "pdf",
      content: "<p>The quick brown fox jumps over the lazy dog.</p>",
    });
    const location = await resolveCitationLocation(doc, "The quick brown fox jumps over the lazy dog.");
    expect(location).toBeNull();
  });

  it("retries with a shorter prefix when the full quote prefix misses", async () => {
    // The first 60 chars of the chunk match; the 120-char prefix does not
    // (the content diverges after char 60).
    const chunkText = "a".repeat(70) + "different-tail";
    const content = `${"a".repeat(60)} something else entirely.`;
    const doc = makeDocument({ fileType: "html", content });
    const location = await resolveCitationLocation(doc, chunkText);
    expect(location?.kind).toBe("html");
  });

  it("resolves an EPUB quote to a quote-only location", async () => {
    const doc = makeDocument({
      fileType: "epub",
      content: "<p>Chapter one begins with a memorable sentence about the sea.</p>",
    });
    const location = await resolveCitationLocation(doc, "Chapter one begins with a memorable sentence about the sea.");
    expect(location).toEqual({
      kind: "epub",
      cfi: "",
      textQuote: "Chapter one begins with a memorable sentence about the sea.",
    });
  });

  it("resolves html and markdown quotes to quote-only locations", async () => {
    const html = await resolveCitationLocation(
      makeDocument({ fileType: "html", content: "Plain HTML body with a quoted passage inside." }),
      "Plain HTML body with a quoted passage inside."
    );
    expect(html?.kind).toBe("html");

    const markdown = await resolveCitationLocation(
      makeDocument({ fileType: "markdown", content: "# Title\n\nA markdown passage worth citing." }),
      "A markdown passage worth citing."
    );
    expect(markdown?.kind).toBe("markdown");
  });

  it("resolves a YouTube quote to the containing transcript segment", async () => {
    const deps: CitationLocationDeps = {
      fetchYouTubeSegments: async () => [
        { start: 10, duration: 5, text: "an early segment" },
        { start: 25, duration: 6, text: "the cited passage words here" },
      ],
    };
    const doc = makeDocument({ fileType: "youtube", filePath: "https://youtube.com/watch?v=abcdefghijk" });
    const location = await resolveCitationLocation(doc, "the cited passage words here", deps);
    expect(location).toEqual({
      kind: "youtube",
      timeSeconds: 25,
      segmentId: "seg-1",
      textQuote: "the cited passage words here",
    });
  });

  it("resolves an audio quote via the stored transcript", async () => {
    const deps: CitationLocationDeps = {
      loadStoredAudioSegments: () => [
        { id: "seg-0", startSeconds: 0, text: "welcome back" },
        { id: "seg-1", startSeconds: 12, text: "here is the important claim" },
      ],
      loadWhisperSegments: async () => [],
    };
    const doc = makeDocument({ fileType: "audio" });
    const location = await resolveCitationLocation(doc, "here is the important claim", deps);
    expect(location).toEqual({
      kind: "audio",
      timeSeconds: 12,
      segmentId: "seg-1",
      textQuote: "here is the important claim",
    });
  });

  it("falls back to the whisper transcript when no stored audio transcript exists", async () => {
    const deps: CitationLocationDeps = {
      loadStoredAudioSegments: () => [],
      loadWhisperSegments: async () => [{ id: "w-0", startSeconds: 90, text: "fallback transcript text" }],
    };
    const doc = makeDocument({ fileType: "audio" });
    const location = await resolveCitationLocation(doc, "fallback transcript text", deps);
    expect(location?.kind === "audio" && location.timeSeconds).toBe(90);
  });

  it("resolves a local video quote to an audio-kind timestamp location", async () => {
    const deps: CitationLocationDeps = {
      loadVideoTranscript: async () => ({
        document_id: "doc-1",
        transcript: "a clip transcript",
        segments: [{ time: 5, text: "first" }, { time: 33, text: "the cited clip line" }],
      }),
    };
    const doc = makeDocument({ fileType: "video" });
    const location = await resolveCitationLocation(doc, "the cited clip line", deps);
    expect(location).toEqual({
      kind: "audio",
      timeSeconds: 33,
      segmentId: "seg-1",
      textQuote: "the cited clip line",
    });
  });

  it("returns null when the transcript does not contain the quote", async () => {
    const deps: CitationLocationDeps = {
      fetchYouTubeSegments: async () => [{ start: 0, duration: 5, text: "unrelated words" }],
    };
    const doc = makeDocument({ fileType: "youtube", filePath: "abcdefghijk" });
    expect(await resolveCitationLocation(doc, "something not spoken", deps)).toBeNull();
  });

  it("returns null for a missing document", async () => {
    expect(await resolveCitationLocation(undefined, "any quote")).toBeNull();
    expect(await resolveCitationLocation(null, "any quote")).toBeNull();
  });

  it("returns null for missing or empty content", async () => {
    expect(await resolveCitationLocation(makeDocument({ fileType: "html" }), "any quote")).toBeNull();
    expect(
      await resolveCitationLocation(makeDocument({ fileType: "html", content: "   " }), "any quote")
    ).toBeNull();
  });

  it("returns null for an unmatched quote", async () => {
    const doc = makeDocument({ fileType: "html", content: "content that has nothing to do with the quote" });
    expect(await resolveCitationLocation(doc, "a completely different passage")).toBeNull();
  });

  it("returns null for an empty chunk text", async () => {
    const doc = makeDocument({ fileType: "html", content: "some content" });
    expect(await resolveCitationLocation(doc, "  ")).toBeNull();
  });

  it("returns null for fileTypes with no supported navigation location", async () => {
    const doc = makeDocument({ fileType: "other", content: "opaque content" });
    expect(await resolveCitationLocation(doc, "opaque content")).toBeNull();
  });
});
