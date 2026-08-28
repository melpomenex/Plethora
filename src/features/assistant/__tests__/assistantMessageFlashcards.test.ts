import { describe, expect, it } from "vitest";
import {
  buildAssistantMessageFlashcardRequest,
  canCreateFlashcardsFromMessage,
  getFlashcardIneligibilityReason,
  isAssistantMessageFlashcardRequest,
} from "../assistantMessageFlashcards";
import { isTwentyRulesCommand } from "../../../lib/ai/knowledgeFormulation";

describe("assistantMessageFlashcards", () => {
  describe("canCreateFlashcardsFromMessage", () => {
    it("allows genuine assistant answers", () => {
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-1",
          role: "assistant",
          content: "Group theory studies algebraic structures called groups.",
        }),
      ).toBe(true);
    });

    it("rejects generated instructional, confirmation, warning, and error content", () => {
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-3",
          role: "assistant",
          content: "### 🧠 20 Rules of Knowledge Formulation\n\nFormulating knowledge...",
        }),
      ).toBe(false);
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-4",
          role: "assistant",
          content: "Created 2 flashcards and saved to your library.",
        }),
      ).toBe(false);
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-5",
          role: "assistant",
          content: "⚠️ Deck created but no flashcards were saved because the response had no facts.",
        }),
      ).toBe(false);
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-6",
          role: "assistant",
          content: "Error calling LLM: provider unavailable",
        }),
      ).toBe(false);
    });

    it("rejects user and system messages", () => {
      expect(
        canCreateFlashcardsFromMessage({ id: "user-1", role: "user", content: "Hello" }),
      ).toBe(false);
      expect(
        canCreateFlashcardsFromMessage({ id: "sys-1", role: "system", content: "Warning" }),
      ).toBe(false);
    });

    it("rejects empty assistant messages", () => {
      expect(
        canCreateFlashcardsFromMessage({ id: "assistant-1", role: "assistant", content: "   " }),
      ).toBe(false);
    });

    it("rejects confirmation and placeholder messages", () => {
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-confirm-1",
          role: "assistant",
          content: "Created 2 flashcards and saved to your library.",
        }),
      ).toBe(false);
      expect(
        canCreateFlashcardsFromMessage({
          id: "assistant-2",
          role: "assistant",
          content: "Running tool calls...",
        }),
      ).toBe(false);
    });
  });

  describe("getFlashcardIneligibilityReason", () => {
    it("returns undefined for eligible assistant answers", () => {
      expect(
        getFlashcardIneligibilityReason({
          id: "assistant-1",
          role: "assistant",
          content: "Atomic answer.",
        }),
      ).toBeUndefined();
    });

    it("returns confirmation for assistant-confirm ids", () => {
      expect(
        getFlashcardIneligibilityReason({
          id: "assistant-confirm-9",
          role: "assistant",
          content: "Created 1 flashcard and saved to your library.",
        }),
      ).toBe("confirmation");
    });
  });

  describe("buildAssistantMessageFlashcardRequest", () => {
    it("activates /20rules and isolates source content", () => {
      const source = "RoPE encodes position via rotation matrices.";
      const built = buildAssistantMessageFlashcardRequest(source);
      expect(isTwentyRulesCommand(built.requestContent)).toBe(true);
      expect(isAssistantMessageFlashcardRequest(built.requestContent)).toBe(true);
      expect(built.sourceContent).toBe(source);
      expect(built.requestContent).not.toContain(source);
    });
  });
});
