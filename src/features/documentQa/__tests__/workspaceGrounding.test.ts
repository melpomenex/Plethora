import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../../../types/document";
import { eligibleQaSources, groundedQaMessage, askQaKnowledge } from "../workspaceGrounding";
import type { AskLibraryResult } from "../../../lib/ai/tasks/definitions/libraryTask";

const mocks = vi.hoisted(() => ({
  documents: [] as Document[], collectionId: "collection-a", generatorKind: "cloud",
  ask: vi.fn(), config: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../stores/documentStore", () => ({ useDocumentStore: { getState: () => ({ documents: mocks.documents }) } }));
vi.mock("../../../stores/collectionStore", () => ({ useCollectionStore: { getState: () => ({ activeCollectionId: mocks.collectionId }) } }));
vi.mock("../../../lib/ai/tasks/definitions/libraryTask", () => ({ askLibrary: mocks.ask }));
vi.mock("../../../lib/ai/resolveLibraryRag", () => ({ resolveLibraryRagComposition: async () => ({ generatorKind: mocks.generatorKind, retrieverId: "ai_learning", namespace: "library" }) }));
vi.mock("../../../components/assistant/ragConfig", () => ({ resolveEmbeddingConfigForRag: mocks.config }));
const doc = (id: string, partial: Partial<Document> = {}) => ({ id, title: id, collectionId: "collection-a", ...partial }) as Document;
const result = {
  answer: { answer: "Supported [2].", sourceRefs: [{ refId: "used", quote: "Evidence" }], evidenceLevel: "supported" },
  sources: ["unused", "used"].map((chunkId, index) => ({ chunkId, documentId: `doc-${index}`, documentTitle: `Document ${index}`, text: "Evidence", location: { ordinal: index }, score: 1 })),
  retrievalOnly: false, mode: "semantic",
} as AskLibraryResult;
const options = { question: "Question", collectionId: "collection-a", scope: { label: "My collection", documentIds: [] as string[], webSearch: false } };
beforeEach(() => {
  mocks.collectionId = "collection-a"; mocks.generatorKind = "cloud"; mocks.ask.mockReset().mockResolvedValue(result);
  mocks.config.mockReset().mockResolvedValue(undefined);
  mocks.documents = [doc("eligible"), doc("excluded", { isAiExcluded: true }), doc("local", { isLocalOnly: true }), doc("elsewhere", { collectionId: "collection-b" })];
});

describe("Q&A source contracts", () => {
  it("filters collection and privacy before cloud retrieval, retaining local-only on device", () => {
    expect(eligibleQaSources(mocks.documents, [], "collection-a", true).map((source) => source.id)).toEqual(["eligible"]);
    expect(eligibleQaSources(mocks.documents, [], "collection-a", false).map((source) => source.id)).toEqual(["eligible", "local"]);
    expect(eligibleQaSources(mocks.documents, ["elsewhere"], "collection-a", false)).toEqual([]);
  });
  it("passes the resolved eligible ids to retrieval", async () => {
    await askQaKnowledge(options);
    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({ filters: { documentIds: ["eligible"] } }));
  });
  it.each(["excluded", "local", "elsewhere", "deleted"])("never broadens an unavailable explicit source: %s", async (id) => {
    await expect(askQaKnowledge({ ...options, scope: { ...options.scope, documentIds: [id] } })).rejects.toThrow("qaWorkspace.sourceUnavailable");
    expect(mocks.ask).not.toHaveBeenCalled();
  });
  it("fails closed for an empty eligible library", async () => {
    mocks.documents = [];
    await expect(askQaKnowledge(options)).rejects.toThrow("qaWorkspace.sourceUnavailable");
    expect(mocks.ask).not.toHaveBeenCalled();
  });
  it("revalidates collection after async configuration", async () => {
    mocks.config.mockImplementationOnce(async () => { mocks.collectionId = "collection-b"; return undefined; });
    await expect(askQaKnowledge(options)).rejects.toThrow("qaWorkspace.collectionChanged");
    expect(mocks.ask).not.toHaveBeenCalled();
  });
  it("counts only cited documents and preserves noncontiguous numeric references", () => {
    const message = groundedQaMessage(result, options.scope);
    expect(message.citations).toHaveLength(1);
    expect(message.citations?.[0]).toMatchObject({ citationNumber: 2, documentId: "doc-1" });
    expect(message.evidence?.documentCount).toBe(1);
    expect(message.submittedScope).toEqual(options.scope);
    expect(message.content).toBe("Supported [2].");
  });
});

describe("Document-scope grounding", () => {
  const documentScope = { label: "Selected document", documentIds: ["eligible"], webSearch: false, conversationScope: "document" as const };

  it("answers from the selected document text when its chunks are not indexed", async () => {
    const message = await askQaKnowledge({
      ...options,
      scope: documentScope,
      loadDocumentText: async () => "Selected document text about spaced repetition.",
      chatExecutor: async ({ context }) => ({ content: `Answer from: ${context.content}` }),
    });

    expect(mocks.ask).not.toHaveBeenCalled();
    expect(message.content).toContain("Selected document text about spaced repetition");
    expect(message.citations).toBeUndefined();
    expect(message.evidence?.level).toBe("supported");
    expect(message.sourceDocuments).toEqual(["eligible"]);
  });

  it("falls back to document-restricted retrieval when the text cannot be loaded", async () => {
    const message = await askQaKnowledge({
      ...options,
      scope: documentScope,
      loadDocumentText: async () => "",
      chatExecutor: async () => { throw new Error("generation must not run without evidence"); },
    });

    expect(mocks.ask).toHaveBeenCalledWith(expect.objectContaining({
      filters: { documentIds: ["eligible"] },
      evidenceScope: "document",
    }));
    expect(message.citations).toHaveLength(1);
    expect(message.content).toBe("Supported [2].");
  });
});
