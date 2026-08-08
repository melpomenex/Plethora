import { describe, it, expect } from "vitest";
import type { Document } from "../../types/document";
import {
  parseDocumentSearch,
  matchesDocumentSearch,
  matchesCardSearch,
  sortDocuments,
} from "../documentsView";

const baseDoc = (overrides: Partial<Document>): Document => ({
  id: "1",
  title: "Test Document",
  filePath: "/tmp/test.pdf",
  fileType: "pdf",
  tags: ["History"],
  dateAdded: "2024-01-01T00:00:00.000Z",
  dateModified: "2024-01-02T00:00:00.000Z",
  extractCount: 0,
  learningItemCount: 0,
  priorityRating: 1,
  prioritySlider: 0,
  priorityScore: 10,
  isArchived: false,
  isFavorite: false,
  ...overrides,
});

describe("parseDocumentSearch", () => {
  it("parses tag, source, queue, and extracts tokens", () => {
    const tokens = parseDocumentSearch("tag:History source:pdf queue:in extracts=0 other");
    expect(tokens.tags).toEqual(["History"]);
    expect(tokens.sources).toEqual(["pdf"]);
    expect(tokens.queue).toBe("in");
    expect(tokens.extracts).toEqual({ op: "=", value: 0 });
    expect(tokens.text).toBe("other");
  });

  it("treats unknown tokens as text", () => {
    const tokens = parseDocumentSearch("foo:bar title");
    expect(tokens.text).toBe("foo:bar title");
  });
});

describe("matchesDocumentSearch", () => {
  it("matches tag and extracts filters", () => {
    const doc = baseDoc({ extractCount: 0, tags: ["History", "World"] });
    const tokens = parseDocumentSearch("tag:History extracts=0");
    expect(matchesDocumentSearch(doc, tokens)).toBe(true);
  });

  it("matches a tag: token against part of a tag", () => {
    const doc = baseDoc({ tags: ["World History"] });
    expect(matchesDocumentSearch(doc, parseDocumentSearch("tag:histo"))).toBe(true);
    expect(matchesDocumentSearch(doc, parseDocumentSearch("tag:geo"))).toBe(false);
  });

  it("filters by source type", () => {
    const doc = baseDoc({ fileType: "epub" });
    const tokens = parseDocumentSearch("source:pdf");
    expect(matchesDocumentSearch(doc, tokens)).toBe(false);
  });
});

describe("sortDocuments", () => {
  it("keeps stable order when values tie", () => {
    const docs: Document[] = [
      baseDoc({ id: "a", title: "Alpha", priorityScore: 10 }),
      baseDoc({ id: "b", title: "Bravo", priorityScore: 10 }),
    ];
    const sorted = sortDocuments(docs, "priority", "desc");
    expect(sorted.map((doc) => doc.id)).toEqual(["a", "b"]);
  });

  it("sorts by item type", () => {
    const docs: Document[] = [
      baseDoc({ id: "a", fileType: "pdf" }),
      baseDoc({ id: "b", fileType: "epub" }),
    ];
    const sorted = sortDocuments(docs, "type", "asc");
    expect(sorted.map((doc) => doc.id)).toEqual(["b", "a"]);
  });
});

describe("matchesCardSearch", () => {
  const card = {
    question: "What is the powerhouse of the cell?",
    answer: "Mitochondria",
    cloze_text: undefined as string | undefined,
    tags: ["biology", "browser-extension"],
  };

  it("matches free text in the question", () => {
    expect(matchesCardSearch(card, parseDocumentSearch("powerhouse"))).toBe(true);
  });

  it("matches free text in the answer", () => {
    expect(matchesCardSearch(card, parseDocumentSearch("mitochondria"))).toBe(true);
  });

  it("matches free text in the cloze text", () => {
    const clozeCard = { question: "q", cloze_text: "The {{c1::heart}} pumps blood", tags: [] };
    expect(matchesCardSearch(clozeCard, parseDocumentSearch("heart"))).toBe(true);
  });

  it("matches free text in a tag", () => {
    expect(matchesCardSearch(card, parseDocumentSearch("biology"))).toBe(true);
  });

  it("does not match when the free text is absent everywhere", () => {
    expect(matchesCardSearch(card, parseDocumentSearch("nonexistentterm"))).toBe(false);
  });

  it("filters by tag: token", () => {
    expect(matchesCardSearch(card, parseDocumentSearch("tag:browser-extension"))).toBe(true);
    expect(matchesCardSearch(card, parseDocumentSearch("tag:chemistry"))).toBe(false);
  });

  it("matches a tag: token against part of a tag", () => {
    const occluded = { question: "q", tags: ["browser-extension", "image-occlusion"] };
    expect(matchesCardSearch(occluded, parseDocumentSearch("tag:occlusion"))).toBe(true);
    expect(matchesCardSearch(occluded, parseDocumentSearch("tag:extension"))).toBe(true);
    expect(matchesCardSearch(occluded, parseDocumentSearch("tag:occlusive"))).toBe(false);
  });

  it("combines tag: filter with free text (AND)", () => {
    expect(
      matchesCardSearch(card, parseDocumentSearch("tag:browser-extension mitochondria")),
    ).toBe(true);
    expect(
      matchesCardSearch(card, parseDocumentSearch("tag:browser-extension nomatchtext")),
    ).toBe(false);
    expect(
      matchesCardSearch(card, parseDocumentSearch("tag:chemistry mitochondria")),
    ).toBe(false);
  });

  it("suppresses card results when a document-only token is present", () => {
    expect(matchesCardSearch(card, parseDocumentSearch("source:pdf"))).toBe(false);
    expect(matchesCardSearch(card, parseDocumentSearch("queue:in"))).toBe(false);
    expect(matchesCardSearch(card, parseDocumentSearch("extracts=0"))).toBe(false);
  });

  it("returns false for an empty query", () => {
    expect(matchesCardSearch(card, parseDocumentSearch(""))).toBe(false);
  });
});
