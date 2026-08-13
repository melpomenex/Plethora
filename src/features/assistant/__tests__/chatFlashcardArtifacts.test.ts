import { describe, expect, it } from "vitest";
import {
  getFlashcardArtifactDeckName,
  nonFlashcardToolCalls,
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
    expect(toolCallsToFlashcardArtifacts("message-1", [null, { name: "create_qa_card", parameters: null }])).toEqual([]);
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

  it("surfaces partial batch failures without offering an unsafe whole-batch retry", () => {
    const [artifact] = toolCallsToFlashcardArtifacts("message-1", [{
      name: "batch_create_cards",
      parameters: { cards: [{ type: "qa", question: "Q", answer: "A" }] },
      status: "success",
      result: {
        content: [{ type: "text", text: JSON.stringify({ results: [{ success: false, error: "Database busy" }] }) }],
      },
    }]);

    expect(artifact).toMatchObject({ status: "failed", error: "Database busy", retryable: false });
  });
});
