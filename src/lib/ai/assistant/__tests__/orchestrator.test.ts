import { describe, expect, it, vi } from "vitest";
import { runAssistantTurn } from "../orchestrator";

describe("runAssistantTurn (Unified Assistant Orchestrator)", () => {
  it("allows unrelated general-knowledge questions in Chat scope even when document context is empty", async () => {
    const chatExecutor = vi.fn(async () => ({
      content: "Neuroscience models biological attention via frontoparietal networks.",
    }));

    const res = await runAssistantTurn({
      scope: "chat",
      userQuestion: "What does neuroscience say about biological attention?",
      sourceType: "document",
      sourceId: "doc-empty",
      sourceContent: "",
      provider: "openai",
      model: "gpt-4o",
      chatExecutor,
    });

    expect(chatExecutor).toHaveBeenCalledTimes(1);
    expect(res.answer).toContain("frontoparietal networks");
    expect(res.suggestSwitchToChat).toBe(false);
  });

  it("refuses ungrounded answers in Document scope when source context is unavailable and suggests switching to Chat", async () => {
    const chatExecutor = vi.fn();

    const res = await runAssistantTurn({
      scope: "document",
      userQuestion: "What does the author say about attention?",
      sourceType: "document",
      sourceId: "doc-empty",
      sourceContent: "",
      provider: "openai",
      chatExecutor,
    });

    expect(chatExecutor).not.toHaveBeenCalled();
    expect(res.suggestSwitchToChat).toBe(true);
    expect(res.evidenceLevel).toBe("none");
    expect(res.answer).toContain("Switch to **Chat** scope");
  });

  it("maintains conversation continuity across Chat -> Document -> Chat scope transitions and parses multi-turn flashcard tools", async () => {
    const history = [
      {
        role: "user" as const,
        content: "Explain scaled dot-product attention in this paper.",
        scope: "chat" as const,
      },
      {
        role: "assistant" as const,
        content: "It computes softmax(QK^T / sqrt(d_k))V.",
        scope: "chat" as const,
      },
      {
        role: "user" as const,
        content: "Does the paper mention biological neurons?",
        scope: "document" as const,
      },
      {
        role: "assistant" as const,
        content: "The provided paper does not mention biological neurons.",
        scope: "document" as const,
      },
    ];

    const chatExecutor = vi.fn(async () => ({
      content: [
        "Here are flashcards connecting the concepts we discussed:",
        "```tool_calls",
        JSON.stringify([
          {
            name: "create_qa_card",
            arguments: {
              question: "Why is dot-product attention scaled by 1/sqrt(d_k)?",
              answer: "To prevent large dot products from pushing softmax into small-gradient regions.",
            },
          },
        ]),
        "```",
      ].join("\n"),
    }));

    const res = await runAssistantTurn({
      scope: "chat",
      userQuestion: "Create flashcards covering the connections we discussed",
      history,
      sourceType: "document",
      sourceId: "doc-attn",
      sourceTitle: "Attention Is All You Need",
      sourceContent: "We scale the dot products by 1/sqrt(d_k).",
      tools: [{ name: "create_qa_card" }],
      provider: "openai",
      chatExecutor,
    });

    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].name).toBe("create_qa_card");
    expect(res.diagnostics.historyCount.verbatimMessages).toBe(4);
  });

  it("rewrites follow-up queries with history in Library scope", async () => {
    const libraryExecutor = vi.fn(async ({ rewrittenQuery }): Promise<import("../../tasks/definitions/libraryTask").AskLibraryResult> => ({
      answer: {
        answer: `Compared sources using query: ${rewrittenQuery} [1]`,
        sourceRefs: [{ refId: "chunk-1", quote: "Sparse attention reduces O(n^2)" }],
        evidenceLevel: "supported" as const,
      },
      sources: [
        {
          chunkId: "chunk-1",
          documentId: "doc-2",
          documentTitle: "BigBird Paper",
          sourceType: "document",
          text: "Sparse attention reduces O(n^2) complexity to O(n).",
          headingPath: ["Introduction"],
          location: { sourceType: "pdf" as const, documentId: "doc-2", startOffset: 0, endOffset: 100, pageNumber: 2, ordinal: 0 },
          score: 0.92,
          referenceNumber: 1,
          quote: 'Sparse attention reduces O(n^2) complexity to O(n).',
          origin: "library",
        },
      ],
      droppedChunks: 0,
      mode: "semantic" as const,
      candidatesScanned: 10,
      composition: {
        retrieverId: "ai_learning" as const,
        generatorKind: "cloud" as const,
        namespace: "library" as const,
      },
      retrievalOnly: false,
      run: {} as never,
    }));

    const res = await runAssistantTurn({
      scope: "library",
      userQuestion: "Compare the second paper with the first",
      history: [
        { role: "user", content: "Which papers discuss sparse transformers?" },
        { role: "assistant", content: "Longformer and BigBird discuss sparse transformers." },
      ],
      provider: "openai",
      libraryExecutor,
    });

    expect(libraryExecutor).toHaveBeenCalledTimes(1);
    const callArgs = libraryExecutor.mock.calls[0][0];
    expect(callArgs.rewrittenQuery).toContain("Longformer");
    expect(res.citations).toHaveLength(1);
    expect(res.evidenceLevel).toBe("supported");
  });
});
