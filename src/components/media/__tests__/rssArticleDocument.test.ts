import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDocument, updateDocumentContent } from "../../../api/documents";
import { ensureRssArticleDocument } from "../rssArticleDocument";
import type { Feed, FeedItem } from "../../../api/rss";
import type { Document } from "../../../types/document";

vi.mock("../../../api/documents", () => ({
  createDocument: vi.fn(),
  updateDocumentContent: vi.fn(),
}));

const mockedCreate = vi.mocked(createDocument);
const mockedUpdateContent = vi.mocked(updateDocumentContent);

function feed(): Feed {
  return { id: "feed-1", title: "PsyPost" } as Feed;
}

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "article-1",
    title: "Mitochondrial plaques",
    description: "desc",
    content: "<p>body</p>",
    link: "https://example.com/article",
    pubDate: "2026-09-23",
    categories: [],
    read: false,
    favorite: false,
    feedId: "feed-1",
    ...overrides,
  } as FeedItem;
}

function doc(id: string, filePath: string): Document {
  return { id, filePath, title: "t" } as Document;
}

describe("ensureRssArticleDocument", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedUpdateContent.mockReset();
  });

  it("reuses the existing document matched by article link", async () => {
    const deps = {
      documents: [doc("doc-9", "https://example.com/article")],
      addDocument: vi.fn(),
      updateDocument: vi.fn(),
    };
    mockedUpdateContent.mockResolvedValue(doc("doc-9", "https://example.com/article"));

    const id = await ensureRssArticleDocument(feed(), item(), deps);

    expect(id).toBe("doc-9");
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedUpdateContent).toHaveBeenCalledWith("doc-9", expect.stringContaining("body"));
  });

  it("creates and content-syncs a document on first use", async () => {
    const created = doc("doc-1", "https://example.com/article");
    mockedCreate.mockResolvedValue(created);
    mockedUpdateContent.mockResolvedValue(created);
    const deps = { documents: [], addDocument: vi.fn(), updateDocument: vi.fn() };

    const id = await ensureRssArticleDocument(feed(), item(), deps);

    expect(id).toBe("doc-1");
    expect(mockedCreate).toHaveBeenCalledWith(
      "Mitochondrial plaques",
      "https://example.com/article",
      "html",
    );
    expect(deps.addDocument).toHaveBeenCalledWith(created);
    expect(deps.updateDocument).toHaveBeenCalledWith(
      "doc-1",
      expect.objectContaining({ filePath: "https://example.com/article", fileType: "html" }),
    );
  });

  it("falls back to feed title and rss: id identity without a link", async () => {
    const created = doc("doc-2", "rss:article-1");
    mockedCreate.mockResolvedValue(created);
    mockedUpdateContent.mockResolvedValue(created);
    const deps = { documents: [], addDocument: vi.fn(), updateDocument: vi.fn() };

    const id = await ensureRssArticleDocument(
      feed(),
      item({ title: "", link: "" }),
      deps,
    );

    expect(id).toBe("doc-2");
    expect(mockedCreate).toHaveBeenCalledWith("PsyPost", "rss:article-1", "html");
  });

  it("propagates backend failure so callers can toast", async () => {
    mockedCreate.mockRejectedValue(new Error("backend down"));
    const deps = { documents: [], addDocument: vi.fn(), updateDocument: vi.fn() };

    await expect(ensureRssArticleDocument(feed(), item(), deps)).rejects.toThrow(
      "backend down",
    );
  });
});
