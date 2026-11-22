import { describe, expect, it } from "vitest";
import {
  mapPaletteSearchItemToSearchResult,
  searchInMemoryFallback,
} from "../paletteSearchAdapter";
import { SearchResultType } from "../../components/search/GlobalSearch";
import type { Document, Extract } from "../../types/document";

function makeDoc(id: string, title: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    title,
    filePath: `/library/${id}.pdf`,
    fileType: "pdf",
    tags: [],
    dateAdded: "2026-09-01T00:00:00.000Z",
    dateModified: "2026-10-01T00:00:00.000Z",
    extractCount: 1,
    learningItemCount: 0,
    priorityRating: 0,
    prioritySlider: 0,
    priorityScore: 0,
    isArchived: false,
    isFavorite: false,
    collectionId: "col-default",
    ...overrides,
  };
}

function makeExtract(
  id: string,
  documentId: string,
  content: string,
  overrides: Partial<Extract> = {}
): Extract {
  return {
    id,
    documentId,
    content,
    progressiveDisclosureLevel: 0,
    maxDisclosureLevel: 3,
    dateCreated: "2026-09-02T00:00:00.000Z",
    dateModified: "2026-10-02T00:00:00.000Z",
    tags: [],
    learningItems: [],
    ...overrides,
  };
}

describe("paletteSearchAdapter extracts", () => {
  it("returns matching extracts as SearchResultType.Extract alongside documents", async () => {
    const docs = [
      makeDoc("doc-1", "Neural Networks Overview"),
      makeDoc("doc-2", "Linear Algebra Notes"),
    ];
    const extracts = [
      makeExtract(
        "ext-1",
        "doc-2",
        "<p>Backpropagation computes gradients through the computation graph.</p>",
        { pageTitle: "Gradient Flow", pageNumber: 12 }
      ),
      makeExtract("ext-2", "doc-1", "Backpropagation in multilayer perceptrons", {
        notes: "Important exam concept",
      }),
    ];

    const results = await searchInMemoryFallback({
      documents: docs,
      extracts,
      query: { query: "backpropagation" },
      limit: 50,
      allowContentSearch: true,
      isWeb: true,
    });

    const extractResults = results.filter((r) => r.type === SearchResultType.Extract);
    expect(extractResults.map((r) => r.id).sort()).toEqual(["ext-1", "ext-2"]);
    expect(extractResults.find((r) => r.id === "ext-1")?.title).toBe("Gradient Flow");
    expect(extractResults.find((r) => r.id === "ext-1")?.metadata?.primaryHit?.location).toEqual({
      kind: "pdf",
      pageNumber: 12,
      textQuote: "backpropagation",
    });
    expect(extractResults.find((r) => r.id === "ext-2")?.title).toBe("Neural Networks Overview");
  });

  it("matches extracts by pageTitle, notes, and when documents array is empty", async () => {
    const extracts = [
      makeExtract("ext-title", "doc-9", "Unrelated body text", {
        pageTitle: "Attention Mechanism",
        pageNumber: 4,
      }),
      makeExtract("ext-notes", "doc-9", "Unrelated body text", {
        notes: "Review transformer scaling laws",
      }),
    ];

    const titleResults = await searchInMemoryFallback({
      documents: [],
      extracts,
      query: { query: "Attention", types: [SearchResultType.Extract] },
      limit: 50,
      allowContentSearch: false,
      isWeb: true,
    });
    expect(titleResults).toHaveLength(1);
    expect(titleResults[0].id).toBe("ext-title");
    expect(titleResults[0].type).toBe(SearchResultType.Extract);

    const notesResults = await searchInMemoryFallback({
      documents: [],
      extracts,
      query: { query: "transformer", types: [SearchResultType.Extract] },
      limit: 50,
      allowContentSearch: true,
      isWeb: true,
    });
    expect(notesResults).toHaveLength(1);
    expect(notesResults[0].id).toBe("ext-notes");
  });

  it("maps backend extract PaletteSearchItem to SearchResultType.Extract", () => {
    const mapped = mapPaletteSearchItemToSearchResult(
      {
        id: "ext-1",
        resultType: "extract",
        resultKind: "extract",
        title: "BPTT Summary",
        excerpt: "<mark>Backpropagation</mark> through time",
        score: 65,
        documentId: "doc-1",
        tags: ["ml"],
        transcriptMatch: false,
        pageNumber: 7,
        secondaryHits: [],
        scopes: ["documents"],
      },
      "backpropagation"
    );

    expect(mapped.type).toBe(SearchResultType.Extract);
    expect(mapped.metadata?.documentId).toBe("doc-1");
    expect(mapped.metadata?.pageNumber).toBe(7);
  });
});
