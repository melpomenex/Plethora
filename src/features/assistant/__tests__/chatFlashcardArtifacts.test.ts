import { describe, expect, it } from "vitest";
import {
  withCardCandidateIdentities,
  mergeBatchCandidateResult,
  safeCardCreationError,
  getFlashcardArtifactDeckName,
  nonFlashcardToolCalls,
  persistedCardDocumentId,
  summarizeBatchCardResults,
  toolCallsToFlashcardArtifacts,
} from "../chatFlashcardArtifacts";

describe("chat flashcard artifact normalization", () => {
  it("normalizes mixed Q&A and cloze tool calls while preserving generic tools", () => {
    const calls = [
      { name: "create_qa_card", parameters: { question: "Why?", answer: "Because.", tags: ["deck:Neocortex", "008"] }, status: "success", result: { id: "card-1" } },
      { name: "create_extract", parameters: { content: "Quote" }, status: "pending" },
      { name: "create_cloze_card", parameters: { text: "The {{target}} matters." }, status: "error", result: "Database busy" },
    ];
    const artifacts = toolCallsToFlashcardArtifacts("message-1", calls, { timestamp: 123 });
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({ type: "qa", front: "Why?", back: "Because.", status: "saved", persistedCardId: "card-1", tags: ["deck:Neocortex", "008"] });
    expect(artifacts[1]).toMatchObject({ type: "cloze", status: "failed", error: "Database busy" });
    expect(getFlashcardArtifactDeckName(artifacts)).toBe("Neocortex");
    expect(nonFlashcardToolCalls(calls).map((call) => call.name)).toEqual(["create_extract"]);
  });

  it("defensively ignores null legacy fields and malformed card calls", () => {
    expect(toolCallsToFlashcardArtifacts("message-1", null)).toEqual([]);
    expect(toolCallsToFlashcardArtifacts("message-1", [null, { name: "create_qa_card", parameters: null }])).toEqual([expect.objectContaining({ status: "failed", retryable: false })]);
  });

  it("attaches lightweight section provenance without source content", () => {
    const source = {
      documentId: "doc-1",
      sectionIds: ["section-2"],
      labels: ["Chapter Two"],
      contentHash: "hash",
      contextKey: "key",
      ranges: [{ start: 20, end: 40 }],
    };
    const [artifact] = toolCallsToFlashcardArtifacts("message-1", [
      { name: "create_qa_card", parameters: { question: "Q", answer: "A" }, status: "pending" },
    ], { source });
    expect(artifact.source).toEqual(source);
    expect(artifact.source).not.toHaveProperty("content");
  });

  it("expands a batch tool call into card artifacts instead of generic JSON", () => {
    const calls = [{
      name: "batch_create_cards",
      parameters: {
        tags: ["deck:Podcast Episode", "shared"],
        cards: [
          { type: "qa", question: "First question?", answer: "First answer.", tags: ["shared", "first"] },
          { type: "cloze", question: "The {{second}} answer is hidden." },
        ],
      },
      status: "success",
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            created: 2,
            results: [
              { success: true, id: "card-1" },
              { success: true, id: "card-2" },
            ],
          }),
        }],
      },
    }];

    const artifacts = toolCallsToFlashcardArtifacts("podcast-message", calls, { timestamp: 456 });

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]).toMatchObject({
      id: "podcast-message:card:0:0",
      type: "qa",
      front: "First question?",
      back: "First answer.",
      persistedCardId: "card-1",
      status: "saved",
      tags: ["deck:Podcast Episode", "shared", "first"],
    });
    expect(artifacts[1]).toMatchObject({
      type: "cloze",
      front: "The {{second}} answer is hidden.",
      persistedCardId: "card-2",
      status: "saved",
    });
    expect(getFlashcardArtifactDeckName(artifacts)).toBe("Podcast Episode");
    expect(nonFlashcardToolCalls(calls)).toEqual([]);
  });

  it("surfaces partial batch failures for retry of only the failed candidate", () => {
    const [artifact] = toolCallsToFlashcardArtifacts("message-1", [{
      name: "batch_create_cards",
      parameters: { cards: [{ type: "qa", question: "Q", answer: "A" }] },
      status: "success",
      result: {
        content: [{ type: "text", text: JSON.stringify({ results: [{ success: false, error: "Database busy" }] }) }],
      },
    }]);

    expect(artifact).toMatchObject({ status: "failed", error: "Database busy", retryable: true });
  });

  it("counts only persisted batch receipts and exposes the canonical source document", () => {
    const result = { content: [{ type: "text", text: JSON.stringify({
      document_id: "parent-document",
      created: 2,
      results: [{ success: true, id: "saved" }, { success: false, error: "Write failed" }],
    }) }] };
    expect(summarizeBatchCardResults(result, 2)).toEqual({ saved: 1, failed: 1 });
    expect(persistedCardDocumentId(result)).toBe("parent-document");
    expect(summarizeBatchCardResults(result, 3)).toEqual({ saved: 1, failed: 2 });
  });

  it("never labels a card saved without a durable identity", () => {
    const artifacts = toolCallsToFlashcardArtifacts("message", [
      { name: "create_qa_card", parameters: { question: "Q", answer: "A" }, status: "success", result: {} },
      { name: "batch_create_cards", parameters: { cards: [{ type: "cloze", question: "{{answer}}" }] }, status: "success", result: { results: [{ success: true }] } },
    ]);
    expect(artifacts.map((artifact) => artifact.status)).toEqual(["failed", "failed"]);
    expect(artifacts.every((artifact) => !artifact.persistedCardId)).toBe(true);
  });
});

describe("retry-safe candidate receipts", () => {
  it("keeps saved siblings when the batch reports an error and merges just one retry", () => {
    const parameters = withCardCandidateIdentities("turn", 0, { name: "batch_create_cards", status: "pending", parameters: { acceptance_id: "model", cards: [{ type: "qa", question: "Q1", answer: "A1" }, { type: "qa", question: "Q2", answer: "A2" }] } });
    const first = { results: [{ success: true, id: "committed", proposal_id: "chat:turn:0:0" }, { success: false, error: "Busy", proposal_id: "chat:turn:0:1" }] };
    const call = { name: "batch_create_cards", status: "error", parameters, result: first };
    expect(toolCallsToFlashcardArtifacts("m", [call]).map((row) => row.status)).toEqual(["saved", "failed"]);
    const merged = mergeBatchCandidateResult(first, 2, 1, { results: [{ success: true, id: "retried" }] }, "chat:turn:0:1");
    expect(summarizeBatchCardResults(merged, 2)).toEqual({ saved: 2, failed: 0 });
    expect(toolCallsToFlashcardArtifacts("m", [{ ...call, result: merged }]).map((row) => row.persistedCardId)).toEqual(["committed", "retried"]);
    expect(parameters.acceptance_id).toBe("chat:turn:0");
  });
  it("hides raw database JSON and leaves uncertain legacy saves non-retryable", () => {
    expect(safeCardCreationError({ content: [{ text: '{"error":"SQLITE_CONSTRAINT"}' }] })).not.toContain("SQLITE");
    const [row] = toolCallsToFlashcardArtifacts("m", [{ name: "create_qa_card", parameters: { question: "Q", answer: "A" }, status: "error", result: "timeout" }]);
    expect(row.retryable).toBe(false);
  });
});
