import { describe, expect, it } from "vitest";
import {
  inferLearningAgentScope,
  resolveLearningAgentScope,
  type LearningAgentSubmitInput,
} from "../learningAgent";

const base: Omit<LearningAgentSubmitInput, "scope"> = {
  conversationId: "conv-1",
  ownerRevision: 7,
  intent: "Make cards",
  documents: [],
};

describe("frozen Learning Agent scope", () => {
  it("freezes a chapter only when a bounded section is resolved", () => {
    const noSection = resolveLearningAgentScope({
      ...base,
      scope: "section",
      documents: [{ id: "doc-a", title: "Paper A", contentVersion: "v1" }],
    });
    expect(noSection.ok).toBe(false);
    if (noSection.ok === false) {
      expect(noSection.reason).toBe("needs-section");
      expect(noSection.message).toContain("Select a section");
    }

    const withSection = resolveLearningAgentScope({
      ...base,
      scope: "section",
      documents: [{ id: "doc-a", title: "Paper A", contentVersion: "v1" }],
      section: {
        documentId: "doc-a",
        title: "Chapter 3",
        text: "Bounded chapter text.",
        sectionId: "sec-3",
      },
    });
    expect(withSection.ok).toBe(true);
    if (withSection.ok) {
      expect(withSection.run.section?.text).toBe("Bounded chapter text.");
      expect(withSection.run.retrievalDocumentIds).toEqual(["doc-a"]);
      expect(withSection.run.sources[0].libraryId).toBe("doc-a");
      expect(withSection.run.sourceRevision).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("keeps three papers as three immutable sources with per-source revisions", () => {
    const result = resolveLearningAgentScope({
      ...base,
      scope: "papers",
      documents: [
        { id: "paper-1", title: "Paper One", contentVersion: "a1" },
        { id: "paper-2", title: "Paper Two", contentVersion: "b2" },
        { id: "paper-3", title: "Paper Three", contentVersion: "c3" },
      ],
      primaryDocumentId: "paper-2",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.sources.map((source) => source.libraryId)).toEqual([
        "paper-1",
        "paper-2",
        "paper-3",
      ]);
      expect(result.run.primaryDocumentId).toBe("paper-2");
      expect(result.run.retrievalDocumentIds).toEqual(["paper-1", "paper-2", "paper-3"]);
      expect(result.run.sources.find((source) => source.libraryId === "paper-2")?.role).toBe(
        "required"
      );
      // Content versions stay on each source: no cross-paper inheritance.
      expect(result.run.sources[0].contentVersion).toBe("a1");
      expect(result.run.sources[2].contentVersion).toBe("c3");
    }
  });

  it("supports a library-wide scope without inventing a document", () => {
    const result = resolveLearningAgentScope({
      ...base,
      scope: "library",
      documents: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.retrievalDocumentIds).toEqual([]);
      expect(result.run.sources).toHaveLength(0);
      expect(result.run.primaryDocumentId).toBeUndefined();
    }
  });

  it("asks for a source when a document scope has no attachment", () => {
    const result = resolveLearningAgentScope({
      ...base,
      scope: "document",
      documents: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("needs-selection");
  });

  it("blocks an AI-excluded source", () => {
    const result = resolveLearningAgentScope({
      ...base,
      scope: "document",
      documents: [
        { id: "doc-x", title: "Private", isAiExcluded: true },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toBe("source-excluded");
  });

  it("freezes an ephemeral selection as a bounded section", () => {
    const result = resolveLearningAgentScope({
      ...base,
      scope: "section",
      documents: [],
      selection: {
        originalText: "A selected paragraph from unsaved web content.",
        title: "Web article",
        locator: { anchor: "p-4" },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.section?.text).toBe(
        "A selected paragraph from unsaved web content."
      );
      expect(result.run.sources.some((source) => source.kind === "selection")).toBe(false);
    }
  });

  it("infers multi-paper intent and chapter intent deterministically", () => {
    expect(
      inferLearningAgentScope("cards from these papers", {
        documentCount: 3,
        hasSection: false,
        hasSelection: false,
      })
    ).toBe("papers");
    expect(
      inferLearningAgentScope("cards from this chapter", {
        documentCount: 1,
        hasSection: false,
        hasSelection: false,
      })
    ).toBe("section");
    expect(
      inferLearningAgentScope("related material across my library", {
        documentCount: 1,
        hasSection: false,
        hasSelection: false,
      })
    ).toBe("library");
    expect(
      inferLearningAgentScope("quiz me", {
        documentCount: 1,
        hasSection: false,
        hasSelection: false,
        explicit: "document",
      })
    ).toBe("document");
  });
});
