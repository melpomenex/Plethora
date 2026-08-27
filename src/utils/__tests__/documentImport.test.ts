import { describe, expect, it, vi, beforeEach } from "vitest";
import { processHtmlContent, processPlainTextContent, resolveDocumentHtmlBaseUrl, resolveHtmlReaderBaseUrl } from "../documentImport";

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

  it("strips publisher styles and resolves images against the verbatim base", () => {
    const html = processHtmlContent(
      '<style>p{color:#000}</style><article class="inc-article"><div class="inc-body"><p style="color:#111">Text</p><img src="x1.png" alt="Figure"></div></article>',
      "https://arxiv.org/html/2410.07524v1",
      "Paper",
      true,
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(
      [...parsed.querySelectorAll("style")].some((style) => style.textContent?.includes("color:#000")),
    ).toBe(false);
    expect(parsed.querySelector("p")?.getAttribute("style")).toBeNull();
    // Standards resolution: 'x1.png' against the verbatim (no-slash) document
    // URL replaces the last path segment — exactly what a browser computes.
    expect(parsed.querySelector("img")?.getAttribute("src")).toBe(
      "https://arxiv.org/html/x1.png",
    );
    expect(parsed.querySelector("base")?.getAttribute("href")).toBe(
      "https://arxiv.org/html/2410.07524v1",
    );
  });

  it("removes imgs with no usable source after lazy-attribute resolution", () => {
    const html = processHtmlContent(
      '<article><img alt="No source"><img src="" alt="Empty"><img src="  " alt="Blank"><img src="data:image/gif;base64,R0lGOD" alt="Placeholder"><img src="real.png" alt="Real"></article>',
      "https://example.com/article/",
      "Article",
      true,
    );

    const parsed = new DOMParser().parseFromString(html, "text/html");
    const imgs = [...parsed.querySelectorAll("img")];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute("src")).toBe("https://example.com/article/real.png");
  });
});

describe("resolveHtmlReaderBaseUrl", () => {
  it("passes generic http(s) candidates through verbatim (hash stripped only)", () => {
    expect(resolveHtmlReaderBaseUrl("https://arxiv.org/html/2410.07524v1")).toBe(
      "https://arxiv.org/html/2410.07524v1",
    );
    expect(resolveHtmlReaderBaseUrl("https://example.com/a/b#section")).toBe(
      "https://example.com/a/b",
    );
    // No host-specific slash mutation for arXiv shapes either.
    expect(resolveHtmlReaderBaseUrl("https://arxiv.org/abs/2410.07524")).toBe(
      "https://arxiv.org/abs/2410.07524",
    );
  });
});

describe("resolveDocumentHtmlBaseUrl", () => {
  const doc = (metadata: Record<string, unknown>, filePath?: string) => ({
    filePath,
    metadata,
  });

  it("prefers the persisted resolvedUrl and never the canonical identity URL", () => {
    expect(
      resolveDocumentHtmlBaseUrl(
        doc({
          webArticle: {
            resolvedUrl: "https://arxiv.org/html/2410.07524v2",
            canonicalUrl: "https://arxiv.org/abs/2410.07524",
          },
          htmlUrl: "https://arxiv.org/html/2410.07524v2",
          source: "https://arxiv.org/abs/2410.07524",
        }),
        "canonical-article"
      )
    ).toBe("https://arxiv.org/html/2410.07524v2");
  });

  it("falls through htmlUrl → source → filePath before the canonical URL", () => {
    expect(
      resolveDocumentHtmlBaseUrl(doc({ htmlUrl: "https://arxiv.org/html/2410.1" }), "legacy-arxiv")
    ).toBe("https://arxiv.org/html/2410.1/");
    expect(
      resolveDocumentHtmlBaseUrl(doc({ source: "https://example.com/source-page" }), "raw-html")
    ).toBe("https://example.com/source-page");
    expect(
      resolveDocumentHtmlBaseUrl(doc({}, "https://example.com/file-path"), "browser-capture")
    ).toBe("https://example.com/file-path");
    expect(
      resolveDocumentHtmlBaseUrl(
        doc({ webArticle: { canonicalUrl: "https://example.com/canon" } }),
        "canonical-article"
      )
    ).toBe("https://example.com/canon");
  });

  it("keeps the trailing-slash arXiv repair ONLY for legacy-arxiv documents", () => {
    // Legacy corpus: bare-relative stored srcs resolve under the slash base.
    expect(
      resolveDocumentHtmlBaseUrl(
        doc({
          htmlUrl: "https://arxiv.org/html/2410.07524v1",
          source: "https://arxiv.org/abs/2410.07524v1",
        }),
        "legacy-arxiv"
      )
    ).toBe("https://arxiv.org/html/2410.07524v1/");
    // An abs-URL candidate also maps to the slash html base for legacy docs.
    expect(
      resolveDocumentHtmlBaseUrl(
        doc({ source: "https://arxiv.org/abs/2410.07524v1" }),
        "legacy-arxiv"
      )
    ).toBe("https://arxiv.org/html/2410.07524v1/");
    // Canonical / raw-fallback / browser-capture use the verbatim URL.
    for (const kind of ["canonical-article", "canonical-raw-fallback", "browser-capture", "raw-html"]) {
      expect(
        resolveDocumentHtmlBaseUrl(
          doc({
            webArticle: { resolvedUrl: "https://arxiv.org/html/2410.07524v1" },
            source: "https://arxiv.org/abs/2410.07524v1",
          }),
          kind
        ),
        `${kind} must use the verbatim resolved URL`
      ).toBe("https://arxiv.org/html/2410.07524v1");
    }
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
