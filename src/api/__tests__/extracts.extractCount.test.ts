import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeCommandMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/tauri", () => ({ invokeCommand: invokeCommandMock }));

// api/extracts.ts publishes via a dynamic import of the sync entity module on
// every create/delete; stub it out so tests don't depend on the sync
// subsystem being initialized.
vi.mock("../../lib/sync/entities/extracts", () => ({
  publishExtract: vi.fn().mockResolvedValue(undefined),
  publishExtractDeleted: vi.fn().mockResolvedValue(undefined),
}));

const patchExtractCountMock = vi.hoisted(() => vi.fn());
const documentStoreState = vi.hoisted(() => ({
  documents: [] as Array<{ id: string; extractCount?: number; dateModified: string }>,
  currentDocument: null as { id: string; extractCount?: number; dateModified: string } | null,
  patchExtractCount: patchExtractCountMock,
}));
vi.mock("../../stores/documentStore", () => ({
  useDocumentStore: { getState: () => documentStoreState },
}));

import { createExtract, deleteExtract } from "../extracts";

/**
 * A document's extractCount was hydrated once at load and never patched when
 * an extract was created or deleted, so the Documents grid/list/compact views
 * showed a stale count until a full reload. Most callers create/delete
 * extracts by calling this module directly rather than through
 * useExtractStore, so the fix lives at this choke point instead.
 */
describe("extract creation and deletion patch document extractCount", () => {
  beforeEach(() => {
    invokeCommandMock.mockReset();
    patchExtractCountMock.mockReset();
    documentStoreState.documents = [];
    documentStoreState.currentDocument = null;
  });

  it("increments extractCount when an extract is created for a loaded document", async () => {
    documentStoreState.documents = [{ id: "doc-1", extractCount: 0, dateModified: "2026-07-01T00:00:00Z" }];
    invokeCommandMock.mockResolvedValue({
      id: "extract-1",
      document_id: "doc-1",
      content: "body",
      progressive_disclosure_level: 0,
      max_disclosure_level: 3,
      date_created: "2026-07-31T00:00:00Z",
      date_modified: "2026-07-31T00:00:00Z",
      tags: [],
      review_count: 0,
      reps: 0,
    });

    await createExtract({ document_id: "doc-1", content: "body" });

    await vi.waitFor(() => expect(patchExtractCountMock).toHaveBeenCalled());
    expect(patchExtractCountMock).toHaveBeenCalledWith("doc-1", 1);
  });

  it("uses the local count patch instead of a document content update", async () => {
    documentStoreState.documents = [{ id: "doc-1", extractCount: 2, dateModified: "2026-07-01T00:00:00Z" }];
    invokeCommandMock.mockResolvedValue({
      id: "extract-2",
      document_id: "doc-1",
      content: "body",
      progressive_disclosure_level: 0,
      max_disclosure_level: 3,
      date_created: "2026-07-31T00:00:00Z",
      date_modified: "2026-07-31T00:00:00Z",
      tags: [],
      review_count: 0,
      reps: 0,
    });

    await createExtract({ document_id: "doc-1", content: "body" });

    await vi.waitFor(() => expect(patchExtractCountMock).toHaveBeenCalled());
    expect(patchExtractCountMock).toHaveBeenCalledWith("doc-1", 1);
  });

  it("decrements extractCount when an extract is deleted", async () => {
    documentStoreState.documents = [{ id: "doc-1", extractCount: 3, dateModified: "2026-07-01T00:00:00Z" }];
    // deleteExtract looks up the owning document via getExtract before
    // deleting, since delete_extract itself returns nothing.
    invokeCommandMock.mockImplementation(async (command: string) => {
      if (command === "get_extract") {
        return {
          id: "extract-1",
          document_id: "doc-1",
          content: "body",
          progressive_disclosure_level: 0,
          max_disclosure_level: 3,
          date_created: "2026-07-31T00:00:00Z",
          date_modified: "2026-07-31T00:00:00Z",
          tags: [],
          review_count: 0,
          reps: 0,
        };
      }
      return undefined;
    });

    await deleteExtract("extract-1");

    await vi.waitFor(() => expect(patchExtractCountMock).toHaveBeenCalled());
    expect(patchExtractCountMock).toHaveBeenCalledWith("doc-1", -1);
  });

  it("delegates decrements to the clamped document-store action", async () => {
    documentStoreState.documents = [{ id: "doc-1", extractCount: 0, dateModified: "2026-07-01T00:00:00Z" }];
    invokeCommandMock.mockImplementation(async (command: string) => {
      if (command === "get_extract") {
        return {
          id: "extract-1",
          document_id: "doc-1",
          content: "body",
          progressive_disclosure_level: 0,
          max_disclosure_level: 3,
          date_created: "2026-07-31T00:00:00Z",
          date_modified: "2026-07-31T00:00:00Z",
          tags: [],
          review_count: 0,
          reps: 0,
        };
      }
      return undefined;
    });

    await deleteExtract("extract-1");

    await vi.waitFor(() => expect(patchExtractCountMock).toHaveBeenCalled());
    expect(patchExtractCountMock).toHaveBeenCalledWith("doc-1", -1);
  });

  it("lets the document store no-op when the document is not currently loaded", async () => {
    documentStoreState.documents = [];
    documentStoreState.currentDocument = null;
    invokeCommandMock.mockResolvedValue({
      id: "extract-1",
      document_id: "doc-not-loaded",
      content: "body",
      progressive_disclosure_level: 0,
      max_disclosure_level: 3,
      date_created: "2026-07-31T00:00:00Z",
      date_modified: "2026-07-31T00:00:00Z",
      tags: [],
      review_count: 0,
      reps: 0,
    });

    await createExtract({ document_id: "doc-not-loaded", content: "body" });
    // Give the fire-and-forget patch a tick to run (or not run).
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(patchExtractCountMock).toHaveBeenCalledWith("doc-not-loaded", 1);
  });

  it("patches currentDocument when the created extract belongs to it but it is not in the documents list", async () => {
    documentStoreState.documents = [];
    documentStoreState.currentDocument = { id: "doc-2", extractCount: 5, dateModified: "2026-07-01T00:00:00Z" };
    invokeCommandMock.mockResolvedValue({
      id: "extract-3",
      document_id: "doc-2",
      content: "body",
      progressive_disclosure_level: 0,
      max_disclosure_level: 3,
      date_created: "2026-07-31T00:00:00Z",
      date_modified: "2026-07-31T00:00:00Z",
      tags: [],
      review_count: 0,
      reps: 0,
    });

    await createExtract({ document_id: "doc-2", content: "body" });

    await vi.waitFor(() => expect(patchExtractCountMock).toHaveBeenCalled());
    expect(patchExtractCountMock).toHaveBeenCalledWith("doc-2", 1);
  });

  it("skips the patch (without throwing) when the owning extract cannot be looked up before delete", async () => {
    documentStoreState.documents = [{ id: "doc-1", extractCount: 3, dateModified: "2026-07-01T00:00:00Z" }];
    invokeCommandMock.mockImplementation(async (command: string) => {
      if (command === "get_extract") {
        throw new Error("not found");
      }
      return undefined;
    });

    await expect(deleteExtract("missing-extract")).resolves.toBeUndefined();
    expect(patchExtractCountMock).not.toHaveBeenCalled();
  });
});
