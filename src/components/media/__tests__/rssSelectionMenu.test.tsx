import { describe, expect, it, vi, beforeEach } from "vitest";
import { useMemo } from "react";
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

vi.mock("../../extracts/CreateExtractDialog", () => ({
  CreateExtractDialog: ({ selectedText }: { selectedText: string }) => (
    <div data-testid="extract-dialog">{selectedText}</div>
  ),
}));

const mockedCreateDocument = vi.mocked(createDocument);
const mockedUpdateContent = vi.mocked(updateDocumentContent);
const mockedCreateExtract = vi.mocked(createExtract);
const clipboardWrite = vi.fn().mockResolvedValue(undefined);

const feed = { id: "feed-1", title: "PsyPost" } as Feed;
const ARTICLE_TEXT = "Alzheimer's disease is a progressive brain condition.";
const ARTICLE_TEXT_TWO = "A second paragraph carries formatted text across nodes.";

function makeArticle(
  id: string,
  content = `<p>${ARTICLE_TEXT}</p><p>${ARTICLE_TEXT_TWO}</p>`,
): FeedItem {
  return {
    id,
    title: id === "article-1" ? "Mitochondrial plaques" : "Replacement article",
    description: "",
    content,
    link: `https://example.com/${id}`,
    pubDate: "2026-09-23",
    categories: [],
    read: false,
    favorite: false,
    feedId: "feed-1",
  } as FeedItem;
}

const article = makeArticle("article-1");

function Host({
  current = article,
  content = `<p>${ARTICLE_TEXT}</p><p>${ARTICLE_TEXT_TWO}</p>`,
}: {
  current?: FeedItem;
  content?: string;
}) {
  const selection = useRssSelectionMenu(feed, current);
  // Mirror production hosts: a stable innerHTML object keeps text nodes alive
  // across menu-only rerenders. Changing `content` still replaces the nodes.
  const articleHtml = useMemo(() => ({ __html: content }), [content]);
  return (
    <div>
      <div
        ref={selection.contentRef}
        onMouseDown={selection.handleMouseDown}
        onContextMenu={selection.handleContextMenu}
      >
        <div className="prose" dangerouslySetInnerHTML={articleHtml} />
        <div data-testid="editable" contentEditable="true" suppressContentEditableWarning>
          Editable words
        </div>
        <a data-testid="article-link" href="https://example.com/link">
          Linked words
        </a>
        {selection.overlays}
      </div>
      <div data-testid="outside">Outside the article</div>
    </div>
  );
}

function firstParagraph(): HTMLElement {
  const paragraph = document.querySelector<HTMLElement>(".prose p");
  if (!paragraph) throw new Error("paragraph missing");
  return paragraph;
}

function selectParagraph(): void {
  const range = document.createRange();
  range.selectNodeContents(firstParagraph());
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selectionText(): string {
  return window.getSelection()?.toString().trim() ?? "";
}

async function openMenuFromSelection(): Promise<void> {
  selectParagraph();
  fireEvent.contextMenu(firstParagraph());
  await screen.findByRole("menu");
}

describe("useRssSelectionMenu", () => {
  beforeEach(() => {
    useDocumentStore.setState({ documents: [] });
    mockedCreateDocument.mockReset();
    mockedUpdateContent.mockReset();
    mockedCreateExtract.mockReset();
    clipboardWrite.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
    window.getSelection()?.removeAllRanges();
  });

  it("opens the document-parity selection menu in registry order", async () => {
    render(<Host />);
    selectParagraph();

    fireEvent.contextMenu(firstParagraph());

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

    // fireEvent returns false when preventDefault() ran (menu opened).
    expect(fireEvent.contextMenu(firstParagraph())).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();

    // Links keep their native menu too when no passage is selected.
    expect(fireEvent.contextMenu(screen.getByTestId("article-link"))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("restores the range captured on the secondary-button press", async () => {
    render(<Host />);
    selectParagraph();
    const before = selectionText();

    // Platforms such as WebKitGTK may collapse the selection between the
    // secondary press and the contextmenu event.
    fireEvent.mouseDown(firstParagraph(), { button: 2 });
    window.getSelection()?.removeAllRanges();
    expect(selectionText()).toBe("");

    fireEvent.contextMenu(firstParagraph());

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await waitFor(() => expect(selectionText()).toBe(before));
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it("requires both range endpoints to belong to the article", () => {
    render(<Host />);
    const outside = screen.getByTestId("outside");
    const range = document.createRange();
    range.setStart(outside.firstChild as Node, 0);
    range.setEnd(firstParagraph().firstChild as Node, 10);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(fireEvent.contextMenu(firstParagraph())).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps the selection while pressing menu and submenu items", async () => {
    render(<Host />);
    const before = await (async () => {
      await openMenuFromSelection();
      return selectionText();
    })();

    const copy = screen.getByRole("menuitem", { name: /^Copy/ });
    // False means mousedown's default (focus/selection change) was prevented.
    expect(fireEvent.mouseDown(copy, { button: 0 })).toBe(false);
    expect(selectionText()).toBe(before);

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight" }));
    const yellow = await screen.findByRole("menuitem", { name: "Yellow highlight" });
    expect(fireEvent.mouseDown(yellow, { button: 0 })).toBe(false);
    expect(selectionText()).toBe(before);
  });

  it("copies the passage captured for that menu after the live selection changes", async () => {
    render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    // Simulate a focus change/later selection before the click is processed.
    fireEvent.click(screen.getByRole("menuitem", { name: /^Copy/ }));
    window.getSelection()?.removeAllRanges();

    expect(clipboardWrite).toHaveBeenCalledWith(before);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("creates the backing article document on extract", async () => {
    const created = { id: "doc-1", filePath: article.link } as never;
    mockedCreateDocument.mockResolvedValue(created);
    mockedUpdateContent.mockResolvedValue(created);
    mockedCreateExtract.mockResolvedValue({ id: "ex-1" } as never);

    render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    fireEvent.click(await screen.findByRole("menuitem", { name: "Create Extract" }));
    window.getSelection()?.removeAllRanges();

    await waitFor(() => {
      expect(mockedCreateDocument).toHaveBeenCalledWith(
        "Mitochondrial plaques",
        "https://example.com/article-1",
        "html",
      );
    });
    expect(mockedCreateExtract).toHaveBeenCalledWith(
      expect.objectContaining({ document_id: "doc-1", content: before }),
    );
    // Successful extraction retains its existing selection cleanup.
    await waitFor(() => expect(selectionText()).toBe(""));
  });

  it("highlights the captured passage after the live selection changes", async () => {
    const created = { id: "doc-1", filePath: article.link } as never;
    mockedCreateDocument.mockResolvedValue(created);
    mockedUpdateContent.mockResolvedValue(created);
    mockedCreateExtract.mockResolvedValue({ id: "ex-1" } as never);

    render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    fireEvent.click(screen.getByRole("menuitem", { name: "Highlight" }));
    const green = await screen.findByRole("menuitem", { name: "Green highlight" });
    fireEvent.click(green);
    window.getSelection()?.removeAllRanges();

    await waitFor(() => {
      expect(mockedCreateExtract).toHaveBeenCalledWith(
        expect.objectContaining({ document_id: "doc-1", content: before, color: "green" }),
      );
    });
  });

  it("gives a delayed dialog action the captured passage", async () => {
    const created = { id: "doc-1", filePath: article.link } as never;
    mockedCreateDocument.mockResolvedValue(created);
    mockedUpdateContent.mockResolvedValue(created);

    render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    fireEvent.click(screen.getByRole("menuitem", { name: "Add note" }));
    // The action is still awaiting the backing document here.
    window.getSelection()?.removeAllRanges();

    expect(await screen.findByTestId("extract-dialog")).toHaveTextContent(before);
  });

  it("keeps the selection on Escape and reopens for the same passage", async () => {
    render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(selectionText()).toBe(before);
    expect(window.getSelection()?.isCollapsed).toBe(false);

    fireEvent.contextMenu(firstParagraph());
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("does not restore the old range after an outside click", async () => {
    render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    fireEvent.mouseDown(screen.getByTestId("outside"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    window.getSelection()?.removeAllRanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(selectionText()).toBe("");
    expect(selectionText()).not.toBe(before);
  });

  it("closes and invalidates the retained range when the article changes", async () => {
    const { rerender } = render(<Host />);
    await openMenuFromSelection();
    const before = selectionText();

    rerender(<Host current={makeArticle("article-2")} />);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    window.getSelection()?.removeAllRanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(selectionText()).toBe("");

    // A later right-click without a fresh selection must not reuse the passage.
    expect(fireEvent.contextMenu(firstParagraph())).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(before).toContain("Alzheimer");
  });

  it("closes the menu when the article content is replaced", async () => {
    const { rerender } = render(<Host />);
    await openMenuFromSelection();

    rerender(<Host content="<p>Completely different replacement content.</p>" />);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    window.getSelection()?.removeAllRanges();
    expect(fireEvent.contextMenu(firstParagraph())).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("yields right-click inside editable fields", () => {
    render(<Host />);
    const editable = screen.getByTestId("editable");
    const range = document.createRange();
    range.selectNodeContents(editable);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    expect(fireEvent.contextMenu(editable)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
