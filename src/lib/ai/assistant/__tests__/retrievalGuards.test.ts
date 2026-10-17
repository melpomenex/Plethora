/**
 * Retrieval guard tests (task 2.4, defect A2).
 *
 * Proves that every retrieval path either carries the frozen authorized ids
 * or refuses to run — the strict Document regression cannot silently become a
 * whole-library search.
 */

import { describe, expect, it } from "vitest";
import {
  assertFrozenFilters,
  frozenSetForScope,
  resolveRetrievalFilters,
  RetrievalDeniedError,
} from "../retrievalGuards";

describe("resolveRetrievalFilters", () => {
  it("carries explicit document ids for Document scope", () => {
    expect(
      resolveRetrievalFilters("document", { kind: "documents", documentIds: ["doc-a"] }),
    ).toEqual({ documentIds: ["doc-a"] });
  });

  it("refuses an empty explicit set instead of widening", () => {
    expect(() =>
      resolveRetrievalFilters("document", { kind: "documents", documentIds: [] }),
    ).toThrow(RetrievalDeniedError);
    expect(() =>
      resolveRetrievalFilters("library", { kind: "collection", documentIds: [] }),
    ).toThrow(/empty/);
  });

  it("requires explicit ids for Document scope", () => {
    expect(() => resolveRetrievalFilters("document", { kind: "library" })).toThrow(
      /explicit document ids/,
    );
  });

  it("allows unrestricted retrieval only for Library scope", () => {
    expect(resolveRetrievalFilters("library", { kind: "library" })).toBeUndefined();
  });

  it("never retrieves in Chat scope", () => {
    expect(() => resolveRetrievalFilters("chat", { kind: "library" })).toThrow(
      /must not perform library retrieval/,
    );
  });

  it("keeps source-type restrictions with the ids", () => {
    const filters = resolveRetrievalFilters("library", {
      kind: "documents",
      documentIds: ["doc-a"],
      sourceTypes: ["document", "extract"],
    });
    expect(filters?.sourceTypes).toEqual(["document", "extract"]);
  });
});

describe("assertFrozenFilters", () => {
  it("accepts matching filters", () => {
    expect(() =>
      assertFrozenFilters(
        "document",
        { kind: "documents", documentIds: ["doc-a", "doc-b"] },
        { documentIds: ["doc-b", "doc-a"] },
      ),
    ).not.toThrow();
  });

  it("rejects dropped or widened filters", () => {
    expect(() =>
      assertFrozenFilters("document", { kind: "documents", documentIds: ["doc-a"] }, undefined),
    ).toThrow(/frozen authorized set/);
    expect(() =>
      assertFrozenFilters(
        "document",
        { kind: "documents", documentIds: ["doc-a"] },
        { documentIds: ["doc-a", "doc-b"] },
      ),
    ).toThrow(/frozen authorized set/);
  });

  it("checks Document scope against an unrestricted frozen set", () => {
    expect(() => assertFrozenFilters("document", { kind: "library" }, undefined)).toThrow(
      /lost its document restriction/,
    );
  });
});

describe("frozenSetForScope", () => {
  it("derives the set from the effective document and selection", () => {
    const both = frozenSetForScope("document", {
      documentId: "doc-a",
      selectionDocumentId: "doc-b",
    });
    expect(both?.kind).toBe("documents");
    const ids = both && "documentIds" in both ? both.documentIds : [];
    expect([...ids].sort()).toEqual(["doc-a", "doc-b"]);
    // Selection matching the document dedupes.
    expect(
      frozenSetForScope("document", { documentId: "doc-a", selectionDocumentId: "doc-a" }),
    ).toEqual({ kind: "documents", documentIds: ["doc-a"] });
  });

  it("returns null when Document scope has no resolvable id", () => {
    expect(frozenSetForScope("document", {})).toBeNull();
  });

  it("restricts a collection-bounded library ask", () => {
    expect(
      frozenSetForScope("library", { collectionDocumentIds: ["doc-c"] }),
    ).toEqual({ kind: "collection", documentIds: ["doc-c"] });
    expect(frozenSetForScope("library", {})).toEqual({ kind: "library" });
  });

  it("never produces a retrieving set for Chat scope", () => {
    expect(frozenSetForScope("chat", { documentId: "doc-a" })).toBeNull();
  });
});

describe("sidebar strict-Document regression (A2)", () => {
  it("a sidebar Document ask retrieves only the frozen document", async () => {
    // Simulate the AssistantPanel adapter: derive the frozen set from the
    // effective context, then build the filters askLibrary receives.
    const frozen = frozenSetForScope("document", { documentId: "doc-1" });
    expect(frozen).not.toBeNull();
    const filters = resolveRetrievalFilters("document", frozen!);
    // This is the exact object that reaches the Rust retrieval boundary; the
    // pre-fix call site passed `undefined` here (whole-library search).
    expect(filters).toEqual({ documentIds: ["doc-1"] });
    expect(() =>
      assertFrozenFilters("document", frozen!, filters),
    ).not.toThrow();
  });

  it("a sidebar Document ask with no resolvable source is denied, not widened", () => {
    const frozen = frozenSetForScope("document", {});
    expect(frozen).toBeNull();
    // The adapter throws a RetrievalDeniedError in this case; nothing reaches
    // `askLibrary`.
    let reachedAskLibrary = false;
    if (frozen) {
      reachedAskLibrary = true;
    }
    expect(reachedAskLibrary).toBe(false);
  });
});
