import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notebooklmAddSource,
  notebooklmGenerateArtifact,
  notebooklmPreviewFlashcards,
  notebooklmSyncPreviewItems,
} from "../integrations";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: vi.fn((path: string) => path),
}));

describe("NotebookLM workflow integration", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    mockInvoke.mockReset();
  });

  it("runs source ingestion -> artifact generation -> preview -> deck sync", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "wait_for_backend_ready") return null;
      if (cmd === "notebooklm_add_source") {
        return {
          id: "src_1",
          title: "Sample source",
          kind: "url",
          status: "ready",
        };
      }
      if (cmd === "notebooklm_generate_artifact") {
        return {
          id: "job_1",
          notebookId: "nb_1",
          artifactType: "flashcards",
          status: "succeeded",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          payload: { flashcards: [], quizItems: [] },
        };
      }
      if (cmd === "notebooklm_preview_flashcards") {
        return [
          {
            question: "Q1",
            answer: "A1",
            tags: ["notebooklm"],
            sourceNotebookId: "nb_1",
            sourceArtifactId: "art_1",
          },
        ];
      }
      if (cmd === "notebooklm_sync_preview_items") {
        return {
          created: 1,
          updated: 0,
          skipped: 0,
          itemIds: ["li_1"],
        };
      }
      return null;
    });

    await notebooklmAddSource({
      notebookId: "nb_1",
      kind: "url",
      content: "https://example.com",
    });
    const job = await notebooklmGenerateArtifact({
      notebookId: "nb_1",
      artifactType: "flashcards",
      retryCount: 1,
    });
    const preview = await notebooklmPreviewFlashcards(job.id);
    const sync = await notebooklmSyncPreviewItems({
      previewItems: preview,
      deckName: "NotebookLM Imports",
      dedupe: true,
    });

    expect(sync.created).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_add_source", {
      req: {
        notebookId: "nb_1",
        kind: "url",
        content: "https://example.com",
      },
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_generate_artifact", {
      req: {
        notebookId: "nb_1",
        artifactType: "flashcards",
        retryCount: 1,
      },
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_preview_flashcards", {
      jobId: "job_1",
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_sync_preview_items", {
      previewItems: preview,
      deckName: "NotebookLM Imports",
      dedupe: true,
    });
  });

  it("submits typed document, url, text, and file source attachment payloads", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "wait_for_backend_ready") return null;
      if (cmd === "notebooklm_add_source") {
        return {
          id: "src_test",
          title: "Added Source",
          kind: "file",
          status: "ready",
        };
      }
      return null;
    });

    // 1. Typed Document source
    await notebooklmAddSource({
      notebookId: "nb_1",
      kind: "document",
      documentId: "doc_456",
      title: "Dopamine Detox",
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_add_source", {
      req: {
        notebookId: "nb_1",
        kind: "document",
        documentId: "doc_456",
        title: "Dopamine Detox",
      },
    });

    // 2. Typed URL source
    await notebooklmAddSource({
      notebookId: "nb_1",
      kind: "url",
      url: "https://example.com/guide",
      title: "Web Guide",
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_add_source", {
      req: {
        notebookId: "nb_1",
        kind: "url",
        url: "https://example.com/guide",
        title: "Web Guide",
      },
    });

    // 3. Typed Text source
    await notebooklmAddSource({
      notebookId: "nb_1",
      kind: "text",
      text: "Notes with smart quotes ‘here’ and em—dash.",
      title: "Research Notes",
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_add_source", {
      req: {
        notebookId: "nb_1",
        kind: "text",
        text: "Notes with smart quotes ‘here’ and em—dash.",
        title: "Research Notes",
      },
    });

    // 4. Typed File source
    await notebooklmAddSource({
      notebookId: "nb_1",
      kind: "file",
      path: "/path/to/paper.pdf",
      title: "Whitepaper",
    });
    expect(mockInvoke).toHaveBeenCalledWith("notebooklm_add_source", {
      req: {
        notebookId: "nb_1",
        kind: "file",
        path: "/path/to/paper.pdf",
        title: "Whitepaper",
      },
    });
  });
});
