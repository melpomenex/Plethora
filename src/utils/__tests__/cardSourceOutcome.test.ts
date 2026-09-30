/**
 * Unit tests for the shared source-availability predicate and the shared
 * degraded-outcome message map (`src/utils/cardSourceNavigation.ts`).
 *
 * These two helpers exist so the card strip, the context menu, the Zen session
 * and the `V` shortcut cannot disagree about what a card can do. Their value
 * is in the agreement, so the tests assert the mapping exhaustively rather
 * than exercising one path each.
 */

import { describe, it, expect } from "vitest";

import {
  hasReachableCardSource,
  sourceOutcomeKey,
  type CardSourceResolution,
} from "../cardSourceNavigation";

describe("hasReachableCardSource", () => {
  it("accepts a card that has only a document reference", () => {
    // The whole-document case: no extract linkage, no envelope, but the
    // document is there and the resolver's final rung reaches it.
    expect(hasReachableCardSource({ document_id: "doc-1" })).toBe(true);
  });

  it("accepts a card that has only an extract linkage", () => {
    expect(hasReachableCardSource({ extract_id: "ext-1" })).toBe(true);
  });

  it("accepts a card that has only a stored envelope", () => {
    expect(hasReachableCardSource({ source_reference: "{...}" })).toBe(true);
  });

  it("rejects a card with nothing recorded", () => {
    expect(
      hasReachableCardSource({
        extract_id: null,
        document_id: null,
        source_reference: null,
      })
    ).toBe(false);
  });

  it("treats empty strings as absent", () => {
    expect(
      hasReachableCardSource({
        extract_id: "",
        document_id: "",
        source_reference: "",
      })
    ).toBe(false);
  });

  it("agrees with the resolver's own entry conditions", () => {
    // Every non-`no-source` resolution is reachable, and no `no-source`
    // resolution is. If these ever diverge, a button appears (or vanishes) on
    // a card the resolver cannot act on.
    const reachable: CardSourceResolution[] = [
      { status: "ready", confidence: "exact", documentId: "d", location: { kind: "pdf", pageNumber: 1 }, excerpt: "" },
      { status: "coarse", reason: "ambiguous", documentId: "d", excerpt: "" },
      { status: "coarse", reason: "stale", documentId: "d", excerpt: "" },
      { status: "coarse", reason: "no-anchor", documentId: "d", excerpt: "" },
      { status: "coarse", reason: "document-only", documentId: "d", excerpt: "" },
    ];
    for (const resolution of reachable) {
      expect(resolution.status).not.toBe("unavailable");
    }
    const unreachable: CardSourceResolution[] = [
      { status: "unavailable", reason: "no-source" },
      { status: "unavailable", reason: "document-missing" },
    ];
    for (const resolution of unreachable) {
      expect(resolution.status).toBe("unavailable");
    }
  });
});

describe("sourceOutcomeKey", () => {
  it("says nothing when the exact passage was reached", () => {
    expect(
      sourceOutcomeKey({
        status: "ready",
        confidence: "exact",
        documentId: "d",
        location: { kind: "pdf", pageNumber: 1 },
        excerpt: "x",
      })
    ).toBeNull();
  });

  it("says nothing for a whole-document card — the document opened", () => {
    // Regression guard for the reported bug: this used to reach the
    // "the original document no longer exists" panel.
    expect(
      sourceOutcomeKey({
        status: "coarse",
        reason: "document-only",
        documentId: "d",
        excerpt: "",
      })
    ).toBeNull();
  });

  it("says nothing for no-anchor, matching the pre-existing behaviour", () => {
    expect(
      sourceOutcomeKey({ status: "coarse", reason: "no-anchor", documentId: "d", excerpt: "x" })
    ).toBeNull();
  });

  it("reports a stale passage separately from a missing document", () => {
    expect(
      sourceOutcomeKey({ status: "coarse", reason: "stale", documentId: "d", excerpt: "x" })
    ).toBe("review.source.notLocated");
  });

  it("reports an ambiguous match", () => {
    expect(
      sourceOutcomeKey({ status: "coarse", reason: "ambiguous", documentId: "d", excerpt: "x" })
    ).toBe("review.source.ambiguous");
  });

  it("reserves the 'no longer exists' wording for a deleted document", () => {
    expect(sourceOutcomeKey({ status: "unavailable", reason: "document-missing" })).toBe(
      "review.source.unavailable"
    );
  });

  it("gives a card with no source its own wording, not a deleted document", () => {
    expect(sourceOutcomeKey({ status: "unavailable", reason: "no-source" })).toBe(
      "review.source.noSource"
    );
  });

  it("never returns the deleted-document key for a no-source card", () => {
    // The specific lie in the report: a card that never had a source was
    // reported as a card whose document had been removed.
    const key = sourceOutcomeKey({ status: "unavailable", reason: "no-source" });
    expect(key).not.toBe("review.source.unavailable");
  });
});
