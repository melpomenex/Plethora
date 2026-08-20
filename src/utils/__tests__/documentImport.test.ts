import { describe, expect, it, vi, beforeEach } from "vitest";
import { processHtmlContent, processPlainTextContent } from "../documentImport";

vi.mock("../../lib/tauri", () => ({ isTauri: () => true }));

const {
  fetchUrlContentMock,
  readDocumentFileMock,
  createDocumentMock,
  getExtractsMock,
  createExtractMock,
} = vi.hoisted(() => ({
  fetchUrlContentMock: vi.fn(async () => ({
    file_path: "/tmp/imported-article.html",
    content_type: "text/html",
    title: "Imported Article",
  })),
  readDocumentFileMock: vi.fn(async () =>
    new TextEncoder().encode(
      "<html><head><title>Imported Article</title></head><body><article><h1>Imported Article</h1><p>" +
        "The full body of the imported article, spanning many sentences of prose so that the " +
        "whole document text is considerably longer than any single extract would ever be. " +
        "This text represents the complete article content that belongs to the document, not to an extract.</p>" +
        "</article></body></html>"
    )
  ),
  createDocumentMock: vi.fn(async (input: Record<string, unknown>) => ({ ...input, id: "doc-imported-1" })),
  getExtractsMock: vi.fn(async () => []),
  createExtractMock: vi.fn(async () => null),
}));

vi.mock("../../api/documents", () => ({
  fetchUrlContent: fetchUrlContentMock,
  readDocumentFile: readDocumentFileMock,
  createDocument: createDocumentMock,
}));

vi.mock("../../api/extracts", () => ({
  getExtracts: getExtractsMock,
  createExtract: createExtractMock,
}));

import { importFromUrl } from "../documentImport";
import * as documentsApi from "../../api/documents";
import * as extractsApi from "../../api/extracts";

describe("import paths never create a whole-document extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("URL import yields a document with no automatic extract", async () => {
    const doc = await importFromUrl("https://example.com/article");
    expect(doc.extractCount).toBe(0);
    expect(doc.fileType).toBe("html");
    expect(doc.content).toContain("full body of the imported article");

    // Persist the imported article (what the command palette / import UI does).
    await documentsApi.createDocument(doc.title, doc.filePath, doc.fileType);

    // The import path must never call extract creation.
    expect(extractsApi.createExtract).not.toHaveBeenCalled();

    // And the document has no extracts: a whole-article extract would have a
    // content length approaching the document's own text length, which is
    // exactly what this regression guards against.
    const extracts = await extractsApi.getExtracts("doc-imported-1");
    expect(extracts).toHaveLength(0);
  });

  it("document text length vastly exceeds any extract the import could produce", async () => {
    const doc = await importFromUrl("https://example.com/article");
    const docTextLength = doc.content.length;
    expect(docTextLength).toBeGreaterThan(200);
    // No extract object is produced by the import at all — there is nothing
    // whose length could approach the document's.
    expect(extractsApi.createExtract).not.toHaveBeenCalled();
  });
});

describe("processHtmlContent", () => {
  it("restores lazy-loaded images as absolute eager image sources", () => {
    const html = processHtmlContent(
      '<article><img src="placeholder.gif" data-src="../images/map.png" srcset="placeholder.png 1x"></article>',
      "https://en.example.org/wiki/History",
      "History",
      true,
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    const image = parsed.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://en.example.org/images/map.png");
    expect(image?.hasAttribute("srcset")).toBe(false);
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("isolates the article body from MediaWiki navigation chrome", () => {
    const html = processHtmlContent(
      '<main><nav>Jump to content Main menu</nav><div id="mw-content-text"><div class="mw-parser-output"><h1>History</h1><p>The real article.</p><div class="navbox">Related navigation</div></div></div></main>',
      "https://en.wikipedia.org/wiki/History",
      "History",
      true,
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.body.textContent).toContain("The real article.");
    expect(parsed.body.textContent).not.toContain("Jump to content");
    expect(parsed.body.textContent).not.toContain("Related navigation");
  });
});

describe("processPlainTextContent", () => {
  it("preserves paragraphs and line breaks while escaping markup", () => {
    const html = processPlainTextContent(
      "First paragraph.\nStill first paragraph.\n\nSecond paragraph with <angle brackets>.",
      "Captured page",
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelectorAll("article > p")).toHaveLength(2);
    expect(parsed.querySelector("article > p")?.innerHTML).toContain("First paragraph.<br>Still first paragraph.");
    expect(parsed.body.textContent).toContain("Second paragraph with <angle brackets>.");
    expect(parsed.body.querySelector("script")).toBeNull();
  });
});
