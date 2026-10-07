/**
 * Unit tests for AskSheet scope resolution (OpenSpec
 * `mobile-ask-sheet-library-qa`, tasks 1.1/1.2/1.3/5.2).
 *
 * Covered through the real `askLibrary` pipeline with injected retrieval
 * and `FakeAIProvider` — no hardware or indexed library needed.
 */

import { describe, expect, it, vi } from "vitest";
import { askLibrary } from "../../tasks/definitions/libraryTask";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import { FakeSemanticRetriever } from "../../__fixtures__/FakePlatformProviders";
import { RAG_NAMESPACE_LIBRARY } from "../../capabilities/search";
import type { RagComposition } from "../../ragComposition";
import { askInScope, getAskSheetIndexState } from "../scope";
import type {
  IndexStatusResponse,
  RetrievalResult,
  RetrievalResponse,
} from "../../../../api/ai-learning";

function chunk(
  chunkId: string,
  documentId: string,
  documentTitle: string,
  text: string,
  headingPath: string[] = [],
): RetrievalResult {
  return {
    chunkId,
    documentId,
    documentTitle,
    sourceType: "document",
    ordinal: 0,
    text,
    headingPath,
    location: {
      sourceType: "text",
      documentId,
      ordinal: 0,
      startOffset: 0,
      endOffset: text.length,
    },
    contentHash: `h-${chunkId}`,
    tokenCount: 10,
    score: 0.9,
    mode: "semantic",
  };
}

const CHUNK_A = chunk(
  "c1",
  "doc-1",
  "Forgetting Curve Notes",
  "Spaced repetition schedules reviews at expanding intervals.",
  ["Chapter 2"],
);
const CHUNK_B = chunk(
  "c2",
  "doc-2",
  "Recall Handbook",
  "Active recall means retrieving an answer from memory.",
  ["Basics"],
);

function groundedProvider(): FakeAIProvider {
  return new FakeAIProvider({
    id: "fake-ondevice",
    kind: "ondevice",
    responses: [
      {
        requestId: "fake-text",
        text: JSON.stringify({
          answer: "Spaced repetition schedules reviews at expanding intervals [1].",
          sourceRefs: [
            {
              refId: "c1",
              quote: "Spaced repetition schedules reviews at expanding intervals.",
            },
          ],
          evidenceLevel: "supported",
        }),
      },
    ],
  });
}

const LIBRARY_COMPOSITION: RagComposition = {
  retrieverId: "ai_learning",
  generatorKind: "ondevice",
  namespace: RAG_NAMESPACE_LIBRARY,
};

describe("task 1.1 — cited sources carry deep-link metadata", () => {
  it("maps validated citations back to retrieval results with location metadata", async () => {
    const provider = groundedProvider();
    const result = await askLibrary({
      query: "What is spaced repetition?",
      retriever: new FakeSemanticRetriever([CHUNK_A, CHUNK_B]),
      provider,
      composition: LIBRARY_COMPOSITION,
    });

    expect(result.sources).toHaveLength(1);
    const [source] = result.sources;
    // Deep-link metadata the source chips need (design decision 4).
    expect(source.chunkId).toBe("c1");
    expect(source.documentId).toBe("doc-1");
    expect(source.documentTitle).toBe("Forgetting Curve Notes");
    expect(source.headingPath).toEqual(["Chapter 2"]);
    expect(source.location.documentId).toBe("doc-1");
    expect(source.location.startOffset).toBe(0);
    expect(source.text).toContain("Spaced repetition");
  });
});

describe("task 1.2 — scope resolution", () => {
  it("passage scope performs no retrieval and grounds on the chip text alone", async () => {
    const provider = new FakeAIProvider({
      id: "fake-ondevice",
      kind: "ondevice",
      responses: [
        {
          requestId: "fake-text",
          text: JSON.stringify({
            answer: "The passage describes the forgetting curve.",
            sourceRefs: [],
            evidenceLevel: "weak",
          }),
        },
      ],
    });
    const retrieve = vi.fn(async (): Promise<RetrievalResponse> => {
      throw new Error("passage scope must not retrieve");
    });

    const result = await askInScope({
      scope: "passage",
      query: "What does this describe?",
      contextPassage: "The forgetting curve shows memory decaying over time.",
      composition: LIBRARY_COMPOSITION,
      provider,
      retrieve,
    });

    // No retrieval happened, yet the generator ran (grounded on the passage).
    expect(retrieve).not.toHaveBeenCalled();
    expect(provider.callCount).toBe(1);
    expect(result.retrievalOnly).toBe(false);
    expect(result.sources).toEqual([]);
    // The passage reached the model inside its untrusted block.
    const prompt = provider.requests[0]?.text ?? "";
    expect(prompt).toContain("The forgetting curve shows memory decaying over time.");
    expect(prompt).not.toContain("[1]");
  });

  it("document scope restricts retrieval to the current document", async () => {
    const seen: unknown[] = [];
    const retrieve = async (_q: string, opts: any): Promise<RetrievalResponse> => {
      seen.push(opts?.filters);
      return { results: [CHUNK_A], mode: "semantic", candidatesScanned: 3 };
    };
    const provider = groundedProvider();

    await askInScope({
      scope: "document",
      query: "What is spaced repetition?",
      documentId: "doc-1",
      contextPassage: "selected passage",
      composition: LIBRARY_COMPOSITION,
      provider,
      retrieve: retrieve as typeof import("../../../../api/ai-learning").retrieveFromLibrary,
    });

    expect(seen).toEqual([{ documentIds: ["doc-1"] }]);
    expect(provider.callCount).toBe(1);
  });

  it("library scope retrieves without document restriction", async () => {
    const seen: unknown[] = [];
    const retrieve = async (_q: string, opts: any): Promise<RetrievalResponse> => {
      seen.push(opts?.filters);
      return { results: [CHUNK_A, CHUNK_B], mode: "semantic", candidatesScanned: 12 };
    };
    const provider = groundedProvider();

    const result = await askInScope({
      scope: "library",
      query: "What is spaced repetition?",
      contextPassage: "selected passage",
      composition: LIBRARY_COMPOSITION,
      provider,
      retrieve: retrieve as typeof import("../../../../api/ai-learning").retrieveFromLibrary,
    });

    expect(seen).toEqual([undefined]);
    expect(result.sources.map((s) => s.chunkId)).toEqual(["c1"]);
  });
});

describe("task 1.3 — honest index state", () => {
  function statusResponse(states: Array<IndexStatusResponse["documents"][number]["state"]>): IndexStatusResponse {
    return {
      aggregate: {
        totalDocuments: states.length,
        indexedDocuments: 0,
        queuedDocuments: 0,
        indexingDocuments: 0,
        staleDocuments: 0,
        failedDocuments: 0,
        totalChunks: 0,
        totalEmbeddings: 0,
        embeddingStorageBytes: 0,
        embeddingModels: [],
        paused: false,
        pendingDocuments: 0,
      },
      documents: states.map((state, i) => ({
        documentId: `d${i}`,
        state,
        chunksIndexed: 0,
        totalChunks: 0,
        updatedAt: new Date(0).toISOString(),
      })),
    };
  }

  it("counts unindexed documents and surfaces the resolved generator kind", async () => {
    const state = await getAskSheetIndexState({
      getStatus: async () =>
        statusResponse(["indexed", "unindexed", "queued", "unindexed", "failed"]),
      resolveComposition: async () => ({
        ...LIBRARY_COMPOSITION,
        generatorKind: "cloud",
      }),
    });
    expect(state.unindexedCount).toBe(2);
    expect(state.generatorKind).toBe("cloud");
  });

  it("degrades to zero when the index status is unavailable", async () => {
    const state = await getAskSheetIndexState({
      getStatus: async () => {
        throw new Error("no backend");
      },
      resolveComposition: async () => LIBRARY_COMPOSITION,
    });
    expect(state.unindexedCount).toBe(0);
    expect(state.generatorKind).toBe("ondevice");
  });
});

describe("task 5.2 — retrieval-only mode", () => {
  it("returns matching passages with no generation and no provider calls", async () => {
    const provider = groundedProvider();
    const result = await askInScope({
      scope: "library",
      query: "photosynthesis",
      composition: { ...LIBRARY_COMPOSITION, generatorKind: "none" },
      provider,
      retriever: new FakeSemanticRetriever([CHUNK_A]),
    });

    expect(provider.callCount).toBe(0);
    expect(result.retrievalOnly).toBe(true);
    expect(result.sources.map((s) => s.chunkId)).toEqual(["c1"]);
  });
});
