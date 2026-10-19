import { describe, expect, it, vi } from "vitest";
import { runAssistantTurn, type AssistantTurnRequest } from "../orchestrator";

type ChatExecutorArgs = Parameters<NonNullable<AssistantTurnRequest["chatExecutor"]>>[0];

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

  it("uses live document content in Document scope instead of replacing it with retrieval", async () => {
    const chatExecutor = vi.fn(async (_args: { context: { content?: string } }) => ({
      content: "A summary grounded in the open document.",
    }));
    const libraryExecutor = vi.fn(async (): Promise<never> => {
      throw new Error("retrieval must not run while live document evidence exists");
    });

    const res = await runAssistantTurn({
      scope: "document",
      userQuestion: "summarize this document",
      sourceType: "document",
      sourceId: "doc-open",
      sourceTitle: "Open Document",
      sourceContent: "The open document's full text about attention mechanisms.",
      provider: "openai",
      chatExecutor,
      libraryExecutor,
    });

    expect(libraryExecutor).not.toHaveBeenCalled();
    expect(chatExecutor).toHaveBeenCalledTimes(1);
    expect(chatExecutor.mock.calls[0][0].context.content).toContain(
      "attention mechanisms",
    );
    expect(res.answer).toContain("grounded in the open document");
    expect(res.evidenceLevel).toBe("supported");
    expect(res.suggestSwitchToChat).toBe(false);
  });

  it("answers a selection-only Document-scope turn without retrieval", async () => {
    const chatExecutor = vi.fn(async () => ({ content: "Answer from the selection." }));
    const libraryExecutor = vi.fn(async (): Promise<never> => {
      throw new Error("retrieval must not run while a selection grounds the turn");
    });

    const res = await runAssistantTurn({
      scope: "document",
      userQuestion: "What does this passage mean?",
      sourceType: "document",
      sourceId: "doc-open",
      selectionExcerpt: "The selected sentence about Q, K, and V.",
      provider: "openai",
      chatExecutor,
      libraryExecutor,
    });

    expect(libraryExecutor).not.toHaveBeenCalled();
    expect(res.evidenceLevel).toBe("supported");
  });

  it("falls back to document-restricted retrieval when Document scope has no live evidence", async () => {
    const libraryExecutor = vi.fn(async (): Promise<import("../../tasks/definitions/libraryTask").AskLibraryResult> => ({
      answer: {
        answer: "Sparse attention reduces complexity [1]",
        sourceRefs: [{ refId: "chunk-1", quote: "Sparse attention reduces complexity" }],
        evidenceLevel: "supported" as const,
      },
      sources: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentTitle: "Attention Notes",
          sourceType: "document",
          text: "Sparse attention reduces complexity.",
          headingPath: [],
          location: { sourceType: "text" as const, documentId: "doc-1", startOffset: 0, endOffset: 36, ordinal: 0 },
          score: 0.9,
          referenceNumber: 1,
          quote: "Sparse attention reduces complexity.",
          origin: "library" as const,
        },
      ],
      droppedChunks: 0,
      mode: "semantic" as const,
      candidatesScanned: 3,
      composition: { retrieverId: "ai_learning" as const, generatorKind: "cloud" as const, namespace: "library" as const },
      retrievalOnly: false,
      run: {} as never,
    }));

    const res = await runAssistantTurn({
      scope: "document",
      userQuestion: "What does this document say about sparse attention?",
      sourceType: "document",
      sourceId: "doc-1",
      sourceContent: "",
      provider: "openai",
      libraryExecutor,
    });

    expect(libraryExecutor).toHaveBeenCalledTimes(1);
    expect(res.citations).toHaveLength(1);
    expect(res.evidenceLevel).toBe("supported");
  });

  it("keeps the honest Switch-to-Chat outcome when live content and retrieval both yield nothing", async () => {
    const libraryExecutor = vi.fn(async (): Promise<import("../../tasks/definitions/libraryTask").AskLibraryResult> => ({
      answer: {
        answer: "No relevant material was found.",
        sourceRefs: [],
        evidenceLevel: "none" as const,
      },
      sources: [],
      droppedChunks: 0,
      mode: "semantic" as const,
      candidatesScanned: 0,
      composition: { retrieverId: "ai_learning" as const, generatorKind: "cloud" as const, namespace: "library" as const },
      retrievalOnly: true,
      run: {} as never,
    }));

    const res = await runAssistantTurn({
      scope: "document",
      userQuestion: "What does this document say about quantum gravity?",
      sourceType: "document",
      sourceId: "doc-1",
      sourceContent: "",
      provider: "openai",
      libraryExecutor,
    });

    expect(libraryExecutor).toHaveBeenCalledTimes(1);
    expect(res.evidenceLevel).toBe("none");
    expect(res.suggestSwitchToChat).toBe(true);
    expect(res.citations).toEqual([]);
  });

  const retrievalFallback = async (): Promise<import("../../tasks/definitions/libraryTask").AskLibraryResult> => ({
    answer: {
      answer: "Sparse attention reduces complexity [1]",
      sourceRefs: [{ refId: "chunk-1", quote: "Sparse attention reduces complexity" }],
      evidenceLevel: "supported" as const,
    },
    sources: [
      {
        chunkId: "chunk-1",
        documentId: "video-1",
        documentTitle: "Video",
        sourceType: "video",
        text: "Sparse attention reduces complexity.",
        headingPath: [],
        location: { sourceType: "text" as const, documentId: "video-1", startOffset: 0, endOffset: 36, ordinal: 0, timestampMs: 5000 },
        score: 0.9,
        referenceNumber: 1,
        quote: "Sparse attention reduces complexity.",
        origin: "library" as const,
      },
    ],
    droppedChunks: 0,
    mode: "semantic" as const,
    candidatesScanned: 3,
    composition: { retrieverId: "ai_learning" as const, generatorKind: "cloud" as const, namespace: "library" as const },
    retrievalOnly: false,
    run: {} as never,
  });

  it("grounds a library-scope single-video complete-transcript turn without retrieval", async () => {
    const chatExecutor = vi.fn(async (_args: ChatExecutorArgs) => ({
      content: "The transcript's main claim is precise neural control [00:05].",
    }));
    const libraryExecutor = vi.fn(async (): Promise<never> => {
      throw new Error("retrieval must not replace the complete transcript");
    });

    const res = await runAssistantTurn({
      scope: "library",
      userQuestion: "What is the main claim of this video?",
      sourceType: "video",
      sourceId: "video-1",
      sourceTitle: "Video",
      sourceContent:
        "[00:05] Channelrhodopsin lets light control neurons.\n[00:10] The main claim is precise neural control.",
      completeTranscriptSource: true,
      provider: "openai",
      chatExecutor,
      libraryExecutor,
    });

    expect(libraryExecutor).not.toHaveBeenCalled();
    expect(res.sourceCoverage).toBe("full");
    expect(res.transcriptStatus).toBe("ready-full");
    const system = chatExecutor.mock.calls[0][0].messages.find((message) => message.role === "system");
    expect(String(system?.content)).not.toContain("SOURCE COVERAGE LIMIT");
  });

  it("composes hierarchical coverage for an over-budget single-video turn and never slices the tail", async () => {
    const lines = Array.from({ length: 320 }, (_, i) => `[${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}] line ${i} about optogenetics and neural circuits in detail.`);
    lines.push("[166:30] CLOSING_SENTINEL the final remark.");
    const chatExecutor = vi.fn(async (_args: ChatExecutorArgs) => ({
      content: "Synthesized answer across the whole video.",
    }));
    const libraryExecutor = vi.fn(async (): Promise<never> => {
      throw new Error("retrieval must not replace complete-transcript coverage");
    });

    const res = await runAssistantTurn({
      scope: "library",
      userQuestion: "What does the video say about neural circuits?",
      sourceType: "video",
      sourceId: "video-1",
      sourceTitle: "Video",
      sourceContent: lines.join("\n"),
      completeTranscriptSource: true,
      provider: "openai",
      chatExecutor,
      libraryExecutor,
    });

    expect(libraryExecutor).not.toHaveBeenCalled();
    expect(res.sourceCoverage).toBe("hierarchical-full");
    const summarizeInputs = chatExecutor.mock.calls
      .map((call) => String(call[0]?.context?.content ?? ""))
      .join("\n");
    expect(summarizeInputs).toContain("CLOSING_SENTINEL");
    const finalSystem = chatExecutor.mock.calls.at(-1)![0].messages.find((message) => message.role === "system");
    expect(String(finalSystem?.content)).not.toContain("SOURCE COVERAGE LIMIT");
  });

  it("falls back to document-restricted retrieval when a complete-transcript video has no transcript", async () => {
    const chatExecutor = vi.fn(async () => ({ content: "Fragment answer." }));
    const libraryExecutor = vi.fn(retrievalFallback);

    const res = await runAssistantTurn({
      scope: "library",
      userQuestion: "What does this video say about sparse attention?",
      sourceType: "video",
      sourceId: "video-1",
      sourceContent: "",
      completeTranscriptSource: true,
      transcriptStatus: "unavailable",
      provider: "openai",
      chatExecutor,
      libraryExecutor,
    });

    expect(libraryExecutor).toHaveBeenCalledTimes(1);
    expect(res.sourceCoverage).toBe("chunks");
    expect(res.transcriptStatus).toBe("unavailable");
  });

  it("preserves an explicitly supplied non-transcript source on a video turn", async () => {
    const chatExecutor = vi.fn(async (_args: ChatExecutorArgs) => ({ content: "ok" }));

    await runAssistantTurn({
      scope: "chat",
      userQuestion: "Create flashcards from the supplied Assistant response context.",
      sourceType: "video",
      sourceId: "video-1",
      sourceContent: "UNIQUE_ANSWER_SENTINEL: RoPE uses rotations.",
      explicitSourceContent: true,
      provider: "openai",
      chatExecutor,
    });

    expect(chatExecutor).toHaveBeenCalledTimes(1);
    const context = chatExecutor.mock.calls[0][0].context;
    expect(context.content).toContain("UNIQUE_ANSWER_SENTINEL");
  });
});
