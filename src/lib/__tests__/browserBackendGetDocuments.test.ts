import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../database", () => ({
  getDocuments: vi.fn(),
  getDocumentsWithProgress: vi.fn(),
}));

vi.mock("../../stores/llmProvidersStore", () => ({
  useLLMProvidersStore: { getState: () => ({ providers: [] }) },
}));

import { browserInvoke } from "../browser-backend";
import * as db from "../database";

describe("browser backend get_documents collection filter", () => {
  const DEFAULT_COLLECTION_ID = "00000000-0000-0000-0000-000000000001";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes documents with no collection_id when filtering by the default collection", async () => {
    // Browser imports create documents without a collection_id.
    vi.mocked(db.getDocuments).mockResolvedValue([
      { id: "d1", title: "Imported doc", collection_id: undefined } as any,
      { id: "d2", title: "Explicit default", collection_id: DEFAULT_COLLECTION_ID } as any,
      { id: "d3", title: "Other collection", collection_id: "other-collection" } as any,
    ]);

    const docs = await browserInvoke<any[]>("get_documents", {
      collectionId: DEFAULT_COLLECTION_ID,
    });

    const ids = docs.map((d) => d.id);
    expect(ids).toEqual(["d1", "d2"]);
    expect(ids).not.toContain("d3");
  });

  it("returns all documents when no collectionId is requested", async () => {
    vi.mocked(db.getDocuments).mockResolvedValue([
      { id: "d1", title: "A", collection_id: undefined } as any,
      { id: "d2", title: "B", collection_id: "other" } as any,
    ]);

    const docs = await browserInvoke<any[]>("get_documents", { collectionId: null });
    expect(docs.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("filters persisted browser provenance before paging and across collections", async () => {
    const saved = Array.from({ length: 9 }, (_, index) => ({ id: `saved-${index}`, title: `Save ${index}`, file_type: "html", file_path: "https://example.org/page", date_added: `2026-10-${String(index + 1).padStart(2, "0")}T10:00:00Z`, collection_id: index % 2 ? "other" : "default", metadata: { source: "browser_extension" } }));
    vi.mocked(db.getDocuments).mockResolvedValue([
      { ...saved[0], id: "manual", metadata: {} },
      { ...saved[0], id: "archived", is_archived: true },
      { ...saved[0], id: "bad", metadata: { source: "browser_extension", shareProvenance: {} } },
      ...saved,
    ] as any);
    const page = await browserInvoke<any>("get_browser_capture_documents", { limit: 6, offset: 0 });
    expect(page.total_count).toBe(9);
    expect(page.items.map((item: any) => item.document_id)).toEqual(["saved-8", "saved-7", "saved-6", "saved-5", "saved-4", "saved-3"]);
    const library = await browserInvoke<any[]>("get_documents", { captureSource: "browser-extension", collectionId: null });
    expect(library).toHaveLength(9);
    expect(library.some(doc => doc.id === "saved-7")).toBe(true);
  });

  it("filters share captures across the persisted library and rejects unsupported sources", async () => {
    const shared = Array.from({ length: 8 }, (_, index) => ({ id: `share-${index}`, title: `Shared ${index}`, file_type: index % 2 ? "pdf" : "markdown", file_path: `/private/shared-${index}`, date_added: `2026-10-${String(index + 1).padStart(2, "0")}T10:00:00Z`, metadata: { shareProvenance: { source: "android_share" } } }));
    vi.mocked(db.getDocuments).mockResolvedValue([
      ...shared,
      { ...shared[0], id: "manual", metadata: { source: "manual" } },
      { ...shared[0], id: "archived", is_archived: true },
    ] as any);
    const all = await browserInvoke<any[]>("get_documents", { captureSource: "share-target", collectionId: null });
    expect(all).toHaveLength(8);
    expect(all[0].id).toBe("share-7");
    const page = await browserInvoke<any>("get_capture_documents", { source: "share-target", limit: 6, offset: 0 });
    expect(page.total_count).toBe(8);
    expect(page.items[0]).toMatchObject({ document_id: "share-7", source_url: null });
    await expect(browserInvoke("get_capture_documents", { source: "whole-library" })).rejects.toThrow("Unsupported capture source");
    await expect(browserInvoke("get_documents", { captureSource: "whole-library" })).rejects.toThrow("Unsupported capture source");
  });

  it("returns document progress timestamps as Unix seconds", async () => {
    const dateModified = "2026-07-16T12:00:00.000Z";
    const dateAdded = "2026-07-14T12:00:00.000Z";
    vi.mocked(db.getDocumentsWithProgress).mockResolvedValue([
      {
        id: "d1",
        progress_percent: 25,
        title: "Recent document",
        date_modified: dateModified,
        date_added: dateAdded,
      } as any,
    ]);

    const docs = await browserInvoke<any[]>("get_documents_with_progress", { limit: 10 });

    expect(docs).toEqual([[
      "d1",
      25,
      "Recent document",
      Math.floor(Date.parse(dateModified) / 1000),
      Math.floor(Date.parse(dateAdded) / 1000),
    ]]);
  });

  it("returns a null import timestamp for legacy documents without date_added", async () => {
    const dateModified = "2026-07-16T12:00:00.000Z";
    vi.mocked(db.getDocumentsWithProgress).mockResolvedValue([
      {
        id: "legacy",
        progress_percent: 10,
        title: "Legacy document",
        date_modified: dateModified,
      } as any,
    ]);

    const docs = await browserInvoke<any[]>("get_documents_with_progress", { limit: 10 });

    expect(docs[0]).toEqual([
      "legacy",
      10,
      "Legacy document",
      Math.floor(Date.parse(dateModified) / 1000),
      null,
    ]);
  });
});
