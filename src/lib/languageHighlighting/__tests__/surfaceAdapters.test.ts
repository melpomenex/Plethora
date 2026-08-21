import { describe, expect, it } from "vitest";
import {
  EpubLanguageHighlightAdapter,
  HtmlLanguageHighlightAdapter,
  MarkdownLanguageHighlightAdapter,
  PdfFixedLanguageHighlightAdapter,
  PdfReflowLanguageHighlightAdapter,
  PlainTextLanguageHighlightAdapter,
  QueueLanguageHighlightAdapter,
  TranscriptLanguageHighlightAdapter,
} from "../adapters";

const pdfWord = (text: string, confidence = 1) => ({
  id: `p1:${text}`,
  pageNumber: 1,
  text,
  sourceBbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
  sourceFragments: [],
  bboxExact: true,
  readingOrder: 0,
  confidence,
  source: "native-pdf-text" as const,
  dehyphenated: false,
  font: null,
});

describe("reader and transcript surface adapters", () => {
  it("keeps EPUB, HTML, Markdown, and plain text anchors source-local", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>Hola <em>mundo</em></p>";
    expect(new EpubLanguageHighlightAdapter(root, "epub-1", "chapter-1").getTokenAnchors()[0]?.anchor.kind).toBe("epub-text");
    expect(new HtmlLanguageHighlightAdapter(root, "html-1").getTokenAnchors()[1]?.anchor.kind).toBe("dom-text");
    expect(new MarkdownLanguageHighlightAdapter(root, "md-1").getTokenAnchors()).toHaveLength(2);
    expect(new PlainTextLanguageHighlightAdapter("txt-1", "Hola mundo").getTokenAnchors()).toHaveLength(2);
  });

  it("preserves PDF confidence and Queue ownership boundaries", () => {
    const reflow = new PdfReflowLanguageHighlightAdapter("pdf-1", [{ text: "Hola", pageNumber: 1, blockId: "b1", confidence: 0.4 }]);
    expect(reflow.getTokenAnchors()[0]?.anchor.confidenceScore).toBe(0.4);
    const fixed = new PdfFixedLanguageHighlightAdapter("pdf-1", [pdfWord("mundo", 0.99)]);
    expect(fixed.getTokenAnchors()[0]?.anchor.kind).toBe("pdf-canonical-word");
    const queue = new QueueLanguageHighlightAdapter("queue-1", [{ id: "q1", text: "Hola" }]);
    expect(queue.getTokenAnchors()[0]?.anchor.kind).toBe("queue-item");
  });

  it("maps transcript sentence timing without owning playback", () => {
    const transcript = new TranscriptLanguageHighlightAdapter("media-1", [{ id: "s1", text: "Hola mundo", startMs: 100, endMs: 900 }]);
    expect(transcript.getTokenAnchors()[0]?.anchor).toMatchObject({ kind: "transcript-segment", segmentId: "s1", startMs: 100, endMs: 900 });
    transcript.dispose();
    expect(transcript.getTokenAnchors()).toHaveLength(2);
  });
});
