import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { DocumentQASources, sourcesCopyText } from "../DocumentQASources";
import { useDocumentStore } from "../../../stores/documentStore";
import { getDocument } from "../../../api/documents";
import { openDocumentAtLocation } from "../../../utils/openDocumentAtLocation";
import type { RagHit } from "../../../api/rag";
import type { Document } from "../../../types/document";

vi.mock("../../../api/documents", () => ({
  getDocument: vi.fn(),
}));

vi.mock("../../../utils/openDocumentAtLocation", () => ({
  openDocumentAtLocation: vi.fn(),
}));

const mockedGetDocument = vi.mocked(getDocument);
const mockedOpenDocumentAtLocation = vi.mocked(openDocumentAtLocation);

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

function citation(overrides: Partial<RagHit> = {}): RagHit {
  return {
    documentId: "doc-1",
    documentTitle: "Test Document",
    chunkIndex: 0,
    chunkText: "The quick brown fox jumps over the lazy dog.",
    score: 0.9,
    ...overrides,
  };
}

describe("sourcesCopyText", () => {
  it("returns the answer alone when there are no citations", () => {
    expect(sourcesCopyText("The answer.", undefined)).toBe("The answer.");
    expect(sourcesCopyText("The answer.", [])).toBe("The answer.");
  });

  it("appends a plain-text sources list when citations exist", () => {
    const text = sourcesCopyText("The answer.", [citation()]);
    expect(text).toContain("The answer.");
    expect(text).toContain("Sources");
    expect(text).toContain("1. Test Document");
  });
});

describe("DocumentQASources", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: [] });
    mockedGetDocument.mockReset();
    mockedOpenDocumentAtLocation.mockReset();
  });

  it("renders an inert entry with the unavailable reason when the document is missing", async () => {
    mockedGetDocument.mockResolvedValue(null);
    render(<DocumentQASources citations={[citation({ documentId: "gone" })]} />);
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(await screen.findByText("Document is no longer available")).toBeTruthy();
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the unavailable reason on re-render instead of flipping to not-located", async () => {
    // Regression: the missing-document state must not be conflated with
    // "quote not located" via the resolution cache once the store updates.
    mockedGetDocument.mockResolvedValue(null);
    const { rerender } = render(<DocumentQASources citations={[citation({ documentId: "gone" })]} />);
    expect(await screen.findByText("Document is no longer available")).toBeTruthy();

    // Any store update (e.g. another document being imported) re-renders the footer.
    act(() => {
      useDocumentStore.setState({ documents: [makeDocument({ id: "other", title: "Other Doc" })] });
    });
    rerender(<DocumentQASources citations={[citation({ documentId: "gone" })]} />);

    expect(await screen.findByText("Document is no longer available")).toBeTruthy();
    expect(screen.queryByText("Passage could not be located in the current document content")).toBeNull();
  });

  it("fetches the full document and resolves a PDF citation to a page label", async () => {
    const content =
      '<div class="page" id="page-1"><div class="page-content"><p>Intro text.</p></div></div>' +
      '<div class="page" id="page-2"><div class="page-content"><p>The quick brown fox jumps over the lazy dog.</p></div></div>';
    mockedGetDocument.mockResolvedValue(makeDocument({ content, contentHash: "pdf-v1" }));

    render(<DocumentQASources citations={[citation()]} />);

    expect(await screen.findByText("Page 2")).toBeTruthy();
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders the not-located reason when the quote cannot be found", async () => {
    mockedGetDocument.mockResolvedValue(
      makeDocument({ fileType: "html", content: "unrelated content", contentHash: "html-v1" })
    );

    render(<DocumentQASources citations={[citation({ chunkText: "a passage that is absent" })]} />);

    expect(await screen.findByText("Passage could not be located in the current document content")).toBeTruthy();
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-resolves after a same-id re-import with changed content (not-located, never stale)", async () => {
    // First pass: the document contains the quoted passage → located.
    mockedGetDocument.mockResolvedValue(
      makeDocument({
        content:
          '<div class="page" id="page-1"><div class="page-content"><p>original text with the cited passage inside</p></div></div>',
        contentHash: "v1",
      })
    );
    const { rerender } = render(<DocumentQASources citations={[citation({ chunkText: "the cited passage" })]} />);
    expect(await screen.findByText("Page 1")).toBeTruthy();

    // Re-import with changed content under the same document id: the library
    // store changes, the fetch cache is rebuilt, and the old cached location
    // must not be replayed — the entry degrades to not-located.
    mockedGetDocument.mockResolvedValue(
      makeDocument({
        content:
          '<div class="page" id="page-1"><div class="page-content"><p>completely different re-imported text</p></div></div>',
        contentHash: "v2",
      })
    );
    act(() => {
      useDocumentStore.setState({ documents: [makeDocument({ id: "doc-1", contentHash: "v2" })] });
    });
    rerender(<DocumentQASources citations={[citation({ chunkText: "the cited passage" })]} />);

    expect(
      await screen.findByText("Passage could not be located in the current document content")
    ).toBeTruthy();
  });

  it("appends the resolved location to copied text", async () => {
    const content =
      '<div class="page" id="page-2"><div class="page-content"><p>The quick brown fox jumps over the lazy dog.</p></div></div>';
    mockedGetDocument.mockResolvedValue(makeDocument({ content, contentHash: "pdf-copy" }));

    const { unmount } = render(<DocumentQASources citations={[citation()]} />);
    expect(await screen.findByText("Page 2")).toBeTruthy();

    const copied = sourcesCopyText("The answer.", [citation()]);
    expect(copied).toContain("1. Test Document — Page 2");
    unmount();
  });

  it("resolves a content-less cited row through its openable sibling and opens the sibling on activation", async () => {
    // Ghost row: RAG-chunked document with no content and no file path.
    const ghost = makeDocument({
      id: "ghost-1",
      title: "Ghost Book",
      filePath: "",
      content: undefined,
      contentHash: "abc123",
    });
    // The real book lives on a same-title sibling with a file and matching hash.
    const real = makeDocument({
      id: "real-1",
      title: "Ghost Book",
      filePath: "/books/ghost.epub",
      fileType: "epub",
      content: "<p>The cited passage lives in the real book.</p>",
      contentHash: "abc123",
    });
    mockedGetDocument.mockImplementation((id: string) => {
      if (id === "ghost-1") return Promise.resolve(ghost);
      if (id === "real-1") return Promise.resolve(real);
      return Promise.resolve(null);
    });
    useDocumentStore.setState({ documents: [ghost, real] });

    const { unmount } = render(
      <DocumentQASources citations={[citation({ documentId: "ghost-1", chunkText: "The cited passage lives in the real book." })]} />
    );

    expect(await screen.findByText("Passage")).toBeTruthy();
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(mockedOpenDocumentAtLocation).toHaveBeenCalledWith(
      "real-1",
      expect.objectContaining({ initialJump: expect.objectContaining({ kind: "epub" }) }),
      expect.anything()
    );
    unmount();
  });

  it("does not open a sibling when its content hash differs from the cited row", async () => {
    const ghost = makeDocument({ id: "ghost-2", title: "Another Book", filePath: "", content: undefined, contentHash: "h1" });
    const sibling = makeDocument({
      id: "real-2",
      title: "Another Book",
      filePath: "/books/another.epub",
      fileType: "epub",
      content: "<p>The cited passage lives in this book.</p>",
      contentHash: "h2",
    });
    mockedGetDocument.mockImplementation((id: string) => {
      if (id === "ghost-2") return Promise.resolve(ghost);
      if (id === "real-2") return Promise.resolve(sibling);
      return Promise.resolve(null);
    });
    useDocumentStore.setState({ documents: [ghost, sibling] });

    const { unmount } = render(
      <DocumentQASources citations={[citation({ documentId: "ghost-2", chunkText: "The cited passage lives in this book." })]} />
    );

    // Hash mismatch → no sibling adopted → no content to resolve against.
    expect(await screen.findByText("Passage could not be located in the current document content")).toBeTruthy();
    unmount();
  });
});
