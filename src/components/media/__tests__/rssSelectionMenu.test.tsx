import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useRssSelectionMenu } from "../useRssSelectionMenu";
import { useDocumentStore } from "../../../stores/documentStore";
import { createDocument, updateDocumentContent } from "../../../api/documents";
import { createExtract } from "../../../api/extracts";
import type { Feed, FeedItem } from "../../../api/rss";

vi.mock("../../../api/documents", () => ({
  createDocument: vi.fn(),
  updateDocumentContent: vi.fn(),
}));

vi.mock("../../../api/extracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/extracts")>();
  return { ...actual, createExtract: vi.fn() };
});

vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: "none", available: false, loading: false }),
}));

vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const mockedCreateDocument = vi.mocked(createDocument);
const mockedUpdateContent = vi.mocked(updateDocumentContent);
const mockedCreateExtract = vi.mocked(createExtract);

const feed = { id: "feed-1", title: "PsyPost" } as Feed;
const article: FeedItem = {
  id: "article-1",
  title: "Mitochondrial plaques",
  description: "",
  content: "<p>Alzheimer's disease is a progressive brain condition.</p>",
  link: "https://example.com/article",
  pubDate: "2026-09-23",
  categories: [],
  read: false,
  favorite: false,
  feedId: "feed-1",
} as FeedItem;

function Host() {
  const selection = useRssSelectionMenu(feed, article);
  return (
    <div ref={selection.contentRef} onContextMenu={selection.handleContextMenu}>
      <p>Alzheimer's disease is a progressive brain condition.</p>
      {selection.overlays}
    </div>
  );
}

function selectParagraph(): void {
  const p = document.querySelector("p");
  if (!p) throw new Error("paragraph missing");
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe("useRssSelectionMenu", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: [] });
    mockedCreateDocument.mockReset();
    mockedUpdateContent.mockReset();
    mockedCreateExtract.mockReset();
    window.getSelection()?.removeAllRanges();
  });

  it("opens the document-parity selection menu in registry order", async () => {
    render(<Host />);
    selectParagraph();

    const row = document.querySelector("p");
    if (!row) throw new Error("paragraph missing");
    fireEvent.contextMenu(row);

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels).toEqual([
      "Create Extract",
      "Add note",
      "Highlight",
      // Label + visible "Ctrl+C" shortcut render adjacently.
      "CopyCtrl+C",
      "Lookup dictionary and thesaurus",
      "Create Flashcard...",
    ]);
  });

  it("lets the native menu through when nothing is selected", () => {
    render(<Host />);
    const row = document.querySelector("p");
    if (!row) throw new Error("paragraph missing");

    // fireEvent returns false when preventDefault() ran (menu opened).
    expect(fireEvent.contextMenu(row)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("creates the backing article document on extract", async () => {
    const created = { id: "doc-1", filePath: article.link } as never;
    mockedCreateDocument.mockResolvedValue(created as never);
    mockedUpdateContent.mockResolvedValue(created as never);
    mockedCreateExtract.mockResolvedValue({ id: "ex-1" } as never);

    render(<Host />);
    selectParagraph();
    const row = document.querySelector("p");
    if (!row) throw new Error("paragraph missing");
    fireEvent.contextMenu(row);

    fireEvent.click(await screen.findByRole("menuitem", { name: "Create Extract" }));

    await waitFor(() => {
      expect(mockedCreateDocument).toHaveBeenCalledWith(
        "Mitochondrial plaques",
        "https://example.com/article",
        "html",
      );
    });
    expect(mockedCreateExtract).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: "doc-1" }),
    );
  });
});
