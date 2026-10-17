/**
 * Citation adapter tests (task 3.2) and inline-marker tests (task 3.3 data).
 */

import { describe, expect, it } from "vitest";
import {
  citedSourceToCitation,
  citedSourcesToCitations,
  citationsSupportEvidence,
  citationsToRagHits,
  locationToLocator,
  mapInlineMarkers,
  ragHitsToCitations,
} from "../citations";
import type { AskLibraryCitedSource } from "../../tasks/definitions/libraryTask";
import type { ChunkLocation } from "../../../../api/ai-learning";

function source(overrides: Partial<AskLibraryCitedSource> = {}): AskLibraryCitedSource {
  return {
    chunkId: overrides.chunkId ?? "c3",
    documentId: overrides.documentId ?? "doc-1",
    documentTitle: overrides.documentTitle ?? "Doc One",
    sourceType: overrides.sourceType ?? "document",
    text: overrides.text ?? "Full chunk text that is much longer than the quote.",
    headingPath: overrides.headingPath ?? ["Chapter 2"],
    location: overrides.location,
    score: overrides.score ?? 0.9,
    referenceNumber: overrides.referenceNumber ?? 3,
    quote: overrides.quote ?? "the exact supporting quote",
    origin: overrides.origin ?? "library",
  };
}

describe("cited source → canonical citation", () => {
  it("preserves the original reference number and validated quote", () => {
    const citation = citedSourceToCitation(source());
    expect(citation.displayNumber).toBe(3);
    expect(citation.quote).toBe("the exact supporting quote");
    expect(citation.validation).toBe("verified");
    expect(citation.origin).toBe("library");
  });

  it("keeps selection evidence first-class without fabricating a document id", () => {
    const citation = citedSourceToCitation(
      source({
        chunkId: "selection-context",
        origin: "selection",
        documentId: "doc-1",
        documentTitle: undefined,
        quote: "selected words",
        referenceNumber: 2,
      }),
    );
    expect(citation.origin).toBe("selection");
    expect(citation.quote).toBe("selected words");
    // A selection is not a library chunk; its document id is not persisted as
    // proven library provenance here (callers attach the snapshot locator).
    expect(citation.chunkId).toBeUndefined();
    expect(citation.documentId).toBeUndefined();
  });

  it("maps source-appropriate locators", () => {
    const pdf = locationToLocator({
      sourceType: "pdf", documentId: "d", ordinal: 0, startOffset: 0, endOffset: 1, pageNumber: 12,
    } as ChunkLocation);
    expect(pdf).toEqual({ page: 12 });

    const epub = locationToLocator({
      sourceType: "epub", documentId: "d", ordinal: 0, startOffset: 0, endOffset: 1, cfiRange: "epubcfi(/6/4!/4)",
    } as ChunkLocation);
    expect(epub).toEqual({ cfi: "epubcfi(/6/4!/4)" });

    const media = locationToLocator({
      sourceType: "transcript", documentId: "d", ordinal: 0, startOffset: 0, endOffset: 1, timestampMs: 252_000,
    } as ChunkLocation);
    expect(media).toEqual({ timeSeconds: 252 });

    const text = locationToLocator({
      sourceType: "markdown", documentId: "d", ordinal: 0, startOffset: 10, endOffset: 50,
    } as ChunkLocation);
    expect(text).toEqual({ textRange: { start: 10, end: 50 }, anchor: undefined });

    // Unknown kinds keep origin but offer no guessed locator.
    expect(
      locationToLocator({ sourceType: "figure", documentId: "d", ordinal: 0, startOffset: 0, endOffset: 1 } as unknown as ChunkLocation),
    ).toBeUndefined();
  });
});

describe("canonical ↔ legacy conversions", () => {
  it("round-trips through RagHit without renumbering", () => {
    const citations = citedSourcesToCitations([
      source({ referenceNumber: 3, chunkId: "c3" }),
      source({ referenceNumber: 4, chunkId: "selection-context", origin: "selection" }),
    ]);
    const hits = citationsToRagHits(citations);
    expect(hits.map((hit) => hit.citationNumber)).toEqual([3, 4]);
    // The footer shows the validated quote, not the whole chunk.
    expect(hits[0].chunkText).toBe("the exact supporting quote");
  });

  it("marks persisted legacy hits as legacy and never verified", () => {
    const citations = ragHitsToCitations([
      { documentId: "doc-1", documentTitle: "Doc", chunkIndex: 0, chunkText: "old text", score: 0.5 },
      { documentId: "doc-1", documentTitle: "Doc", chunkIndex: 1, chunkText: "numbered", score: 0.5, citationNumber: 7 },
    ]);
    expect(citations.map((citation) => citation.validation)).toEqual(["legacy", "legacy"]);
    expect(citations[1].displayNumber).toBe(7);
    expect(citationsSupportEvidence(citations)).toBe(false);
  });

  it("a set with any verified citation supports evidence", () => {
    expect(
      citationsSupportEvidence([
        ...ragHitsToCitations([{ documentId: "d", documentTitle: "D", chunkIndex: 0, chunkText: "x", score: 1 }]),
        citedSourceToCitation(source()),
      ]),
    ).toBe(true);
  });

  it("filters invalid citations out of the footer", () => {
    const citation = citedSourceToCitation(source());
    const hits = citationsToRagHits([citation, { ...citation, id: "bad", validation: "invalid" as const }]);
    expect(hits).toHaveLength(1);
  });
});

describe("inline markers", () => {
  it("resolves only markers with a verified citation", () => {
    const citations = [
      citedSourceToCitation(source({ referenceNumber: 3 })),
      { ...citedSourceToCitation(source({ referenceNumber: 4 })), id: "l4", validation: "legacy" as const },
    ];
    const markers = mapInlineMarkers("Claims [3] and also [4] and dangling [9].", citations);
    expect(markers).toEqual([
      { number: 3, resolvable: true, citation: expect.objectContaining({ displayNumber: 3 }) },
      { number: 4, resolvable: false, citation: expect.objectContaining({ validation: "legacy" }) },
      { number: 9, resolvable: false, citation: undefined },
    ]);
  });

  it("deduplicates repeated markers", () => {
    const markers = mapInlineMarkers("[3] again [3]", [citedSourceToCitation(source())]);
    expect(markers).toHaveLength(1);
  });

  it("never compacts numbers when earlier ones are absent", () => {
    const markers = mapInlineMarkers("Only [3] survived.", [citedSourceToCitation(source({ referenceNumber: 3 }))]);
    expect(markers.map((marker) => marker.number)).toEqual([3]);
  });
});
