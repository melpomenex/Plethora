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
});
