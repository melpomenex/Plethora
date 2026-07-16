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
