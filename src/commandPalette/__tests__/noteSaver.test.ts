import { describe, expect, it, vi } from "vitest";
import { isNoteDraftSaveable, savePaletteNote, type NoteSaveDeps } from "../noteSaver";
import type { Document } from "../../types/document";

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "note-1",
    title: "Idea",
    filePath: "note://1700000000000",
    fileType: "markdown",
    tags: [],
    dateAdded: "2026-10-01T00:00:00.000Z",
    dateModified: "2026-10-01T00:00:00.000Z",
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

function makeDeps(overrides: Partial<NoteSaveDeps> = {}): NoteSaveDeps & {
  created: string[];
  deleted: string[];
} {
  const created: string[] = [];
  const deleted: string[] = [];
  const deps: NoteSaveDeps = {
    createDocument: vi.fn(async () => {
      created.push("note-1");
      return makeDocument();
    }),
    updateDocumentContent: vi.fn(async () => makeDocument()),
    deleteDocument: vi.fn(async (id: string) => {
      deleted.push(id);
    }),
    addDocument: vi.fn(),
    updateDocument: vi.fn(),
    refreshLibrary: vi.fn(),
    openDocument: vi.fn(),
    clearDraft: vi.fn(),
    now: () => 1_700_000_000_000,
    fallbackTitle: "Untitled note",
    ...overrides,
  };
  return Object.assign(deps, { created, deleted });
}

describe("palette note saver", () => {
  it("marks only non-blank drafts as saveable", () => {
    expect(isNoteDraftSaveable({ title: "", body: "" })).toBe(false);
    expect(isNoteDraftSaveable({ title: "  ", body: " " })).toBe(false);
    expect(isNoteDraftSaveable({ title: "x", body: "" })).toBe(true);
    expect(isNoteDraftSaveable({ title: "", body: "y" })).toBe(true);
  });

  it("persists content before reporting success, then opens the note", async () => {
    const deps = makeDeps();
    const result = await savePaletteNote({ title: "Idea", body: "Body" }, deps);

    expect(result).toEqual({ documentId: "note-1" });
    expect(deps.updateDocumentContent).toHaveBeenCalledWith("note-1", "Body");
    // Content is stored before the draft is cleared.
    const updateOrder = (deps.updateDocumentContent as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const clearOrder = (deps.clearDraft as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(clearOrder);
    expect(deps.clearDraft).toHaveBeenCalled();
    expect(deps.refreshLibrary).toHaveBeenCalled();
    expect(deps.openDocument).toHaveBeenCalledWith("note-1");
    expect(deps.deleteDocument).not.toHaveBeenCalled();
  });

  it("uses the honest fallback title for an empty title", async () => {
    const deps = makeDeps();
    await savePaletteNote({ title: "   ", body: "Body" }, deps);
    expect(deps.createDocument).toHaveBeenCalledWith(
      "Untitled note",
      "note://1700000000000",
      "markdown"
    );
  });

  it("compensates a partial creation when content save fails and keeps the draft", async () => {
    const cleanupError = vi.fn();
    const deps = makeDeps({
      updateDocumentContent: vi.fn(async () => {
        throw new Error("disk full");
      }),
      onCleanupError: cleanupError,
    });
    const result = await savePaletteNote({ title: "Idea", body: "Body" }, deps);

    expect(result.error).toBe("disk full");
    expect(deps.deleteDocument).toHaveBeenCalledWith("note-1");
    expect(deps.clearDraft).not.toHaveBeenCalled();
    expect(deps.refreshLibrary).not.toHaveBeenCalled();
    expect(deps.openDocument).not.toHaveBeenCalled();
    expect(cleanupError).not.toHaveBeenCalled();
  });

  it("retains the draft and creates nothing else when document creation fails", async () => {
    const deps = makeDeps({
      createDocument: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const result = await savePaletteNote({ title: "Idea", body: "Body" }, deps);

    expect(result.error).toBe("offline");
    expect(deps.deleteDocument).not.toHaveBeenCalled();
    expect(deps.clearDraft).not.toHaveBeenCalled();
  });

  it("reports a failed compensation without claiming success", async () => {
    const cleanupError = vi.fn();
    const deps = makeDeps({
      updateDocumentContent: vi.fn(async () => {
        throw new Error("disk full");
      }),
      deleteDocument: vi.fn(async () => {
        throw new Error("delete failed");
      }),
      onCleanupError: cleanupError,
    });
    const result = await savePaletteNote({ title: "Idea", body: "Body" }, deps);

    expect(result.error).toBe("disk full");
    expect(cleanupError).toHaveBeenCalledWith(expect.any(Error));
    expect(deps.clearDraft).not.toHaveBeenCalled();
  });
});