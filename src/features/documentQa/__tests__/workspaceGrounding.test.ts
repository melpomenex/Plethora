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

  it("passes configured provider apiKey and model to assistant turn", async () => {
    const { useLLMProvidersStore } = await import("../../../stores/llmProvidersStore");
    useLLMProvidersStore.setState({
      providers: [
        {
          id: "openrouter-1",
          provider: "openrouter",
          name: "OpenRouter",
          model: "openai/gpt-4o",
          apiKey: "sk-or-v1-testkey123",
          baseUrl: "https://openrouter.ai/api/v1",
          enabled: true,
          temperature: 0.5,
          maxTokens: 2048,
        },
      ],
    });

    let receivedApiKey: string | undefined;
    let receivedModel: string | undefined;
    const message = await askQaKnowledge({
      ...options,
      scope: documentScope,
      loadDocumentText: async () => "Custom text for OpenRouter query.",
      chatExecutor: async (args) => {
        receivedApiKey = args.apiKey;
        receivedModel = args.model;
        return { content: `Answer generated: ${args.context.content}` };
      },
    });

    expect(receivedApiKey).toBe("sk-or-v1-testkey123");
    expect(receivedModel).toBe("openai/gpt-4o");
    expect(message.content).toContain("Answer generated");
  });

  it("answers successfully when document text is long and trimmed to token window", async () => {
    const longDocumentText = Array.from({ length: 100 }, (_, i) => `Section ${i}: In depth details of knowledge acquisition and retrieval practice.`).join("\n");
    const message = await askQaKnowledge({
      ...options,
      scope: documentScope,
      loadDocumentText: async () => longDocumentText,
      chatExecutor: async ({ context }) => ({ content: `Summarized: ${context.content.slice(0, 50)}` }),
    });

    expect(message.content).toContain("Summarized");
    expect(message.evidence?.level).toBe("supported");
  });
});

describe("Single-video complete-transcript grounding", () => {
  const videoScope = {
    label: "Selected video",
    documentIds: ["video-1"],
    webSearch: false,
    conversationScope: "library" as const,
  };
  const header = (i: number) =>
    `[${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}] line ${i} about neuroscience and light sensitive channels.`;

  beforeEach(() => {
    mocks.documents = [doc("video-1", { fileType: "youtube", title: "Video" })];
  });

  it("plans the complete transcript for a library-scope single-video turn without head truncation", async () => {
    const tail = "CLOSING_SENTINEL: the final remark about optogenetics.";
    const longTranscript =
      Array.from({ length: 900 }, (_, i) => header(i)).join("\n") + `\n[166:30] ${tail}`;
    const contexts: string[] = [];
    const message = await askQaKnowledge({
      ...options,
      scope: videoScope,
      loadDocumentText: async () => longTranscript,
      chatExecutor: async ({ context }) => {
        contexts.push(String(context.content ?? ""));
        return { content: "Synthesized whole-video answer." };
      },
    });

    // The full transcript was planned (hierarchical synthesis over every
    // window): the closing line survives, and no head slice marker exists.
    expect(contexts.some((text) => text.includes("CLOSING_SENTINEL"))).toBe(true);
    expect(contexts.some((text) => text.includes("[Content truncated"))).toBe(false);
    // Retrieval never replaces complete-transcript grounding for a single video.
    expect(mocks.ask).not.toHaveBeenCalled();
    // Attribution: the video document is the cited source; no fabricated chunks.
    expect(message.sourceDocuments).toEqual(["video-1"]);
    expect(message.citations).toBeUndefined();
    expect(message.evidence?.documentCount).toBe(1);
    expect(message.evidence?.coverage).toBe("hierarchical-full");
    expect(message.evidence?.transcriptStatus).toBe("ready-full");
  });

  it("uses the whole transcript directly when it fits the budget", async () => {
    const text = `${header(0)}\n${header(1)}\n[0:10] closing thought about channelrhodopsin.`;
    const contexts: string[] = [];
    const message = await askQaKnowledge({
      ...options,
      scope: videoScope,
      loadDocumentText: async () => text,
      chatExecutor: async ({ context }) => {
        contexts.push(String(context.content ?? ""));
        return { content: "Answer from the whole transcript." };
      },
    });

    expect(contexts.some((value) => value.includes("channelrhodopsin"))).toBe(true);
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(message.evidence?.coverage).toBe("full");
  });

  it("discloses an unavailable transcript instead of presenting fragments as the whole video", async () => {
    const message = await askQaKnowledge({
      ...options,
      scope: videoScope,
      loadDocumentText: async () => "",
      chatExecutor: async () => ({ content: "Retrieved fragment answer." }),
    });

    expect(mocks.ask).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { documentIds: ["video-1"] } }),
    );
    expect(message.evidence?.transcriptStatus).toBe("unavailable");
    expect(message.evidence?.coverage).toBe("chunks");
  });

  it("still trims long non-video document text to its head window", async () => {
    const tail = "NON_VIDEO_TAIL_SENTINEL";
    const longDocumentText =
      "Opening paragraph about retrieval practice.\n" +
      Array.from({ length: 4000 }, (_, i) => `Section ${i}: detailed knowledge acquisition discussion.`).join("\n") +
      `\n${tail}`;
    mocks.documents = [doc("paper-1", { fileType: "pdf", title: "Paper" })];
    const contexts: string[] = [];
    const message = await askQaKnowledge({
      ...options,
      scope: { ...videoScope, documentIds: ["paper-1"], conversationScope: "document" },
      loadDocumentText: async () => longDocumentText,
      chatExecutor: async ({ context }) => {
        contexts.push(String(context.content ?? ""));
        return { content: "Answer from the head window." };
      },
    });

    expect(contexts.some((text) => text.includes(tail))).toBe(false);
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(message.evidence?.coverage).toBe("window");
  });
});
