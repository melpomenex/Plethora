import { describe, expect, it } from "vitest";
import {
  compareDocumentPositions,
  deserializeDocumentPosition,
  freezeActionSnapshot,
  orderDocumentRange,
  serializeDocumentPosition,
  type EpubDocumentPosition,
  type PdfDocumentPosition,
} from "../documentModel";
import { VimNavigationRequestCoordinator } from "../navigationRequest";

const epub = (spineIndex: number, textOffset: number): EpubDocumentPosition => ({
  kind: "epub", spineIndex, cfi: `epubcfi(/6/${spineIndex * 2 + 2})`, textOffset,
  affinity: "forward", quote: { exact: `word-${textOffset}` },
});
const pdf = (pageNumber: number, itemIndex: number, charOffset = 0): PdfDocumentPosition => ({
  kind: "pdf", pageNumber, itemIndex, charOffset, affinity: "forward",
});

describe("document Vim model", () => {
  it("orders EPUB and PDF positions by logical document order", () => {
    expect(compareDocumentPositions(epub(0, 9), epub(1, 0))).toBeLessThan(0);
    expect(compareDocumentPositions(pdf(2, 5), pdf(3, 0))).toBeLessThan(0);
    expect(compareDocumentPositions(pdf(2, 5, 1), pdf(2, 5, 1))).toBe(0);
  });

  it("normalizes reversed ranges while preserving anchor and head", () => {
    const range = orderDocumentRange(pdf(4, 2), pdf(2, 1));
    expect(range.direction).toBe("backward");
    expect(range.start).toMatchObject({ pageNumber: 2 });
    expect(range.end).toMatchObject({ pageNumber: 4 });
    expect(range.anchor).toMatchObject({ pageNumber: 4 });
  });

  it("round trips positions and rejects malformed input", () => {
    const position = epub(3, 17);
    expect(deserializeDocumentPosition(serializeDocumentPosition(position))).toEqual(position);
    expect(deserializeDocumentPosition('{"kind":"pdf","pageNumber":0}')).toBeNull();
    expect(deserializeDocumentPosition("not-json")).toBeNull();
  });

  it("freezes action snapshots and quote fallbacks", () => {
    const range = orderDocumentRange(epub(0, 1), epub(0, 4));
    const snapshot = freezeActionSnapshot({
      documentId: "book", text: "word", range, createdAt: 1,
      selectionContext: { type: "epub", documentId: "book", cfiRange: "cfi", selectedText: "word" },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.range)).toBe(true);
    expect(Object.isFrozen(snapshot.range.start.quote)).toBe(true);
  });

  it("refuses to compare positions from different formats", () => {
    expect(() => compareDocumentPositions(epub(0, 0), pdf(1, 0))).toThrow(/Cannot compare/);
  });

  it("prevents a stale navigation request from committing", async () => {
    const coordinator = new VimNavigationRequestCoordinator();
    const commits: string[] = [];
    let finishFirst!: (value: string) => void;
    const first = coordinator.run(
      () => new Promise<string>((resolve) => { finishFirst = resolve; }),
      (value) => commits.push(value),
    );
    const second = coordinator.run(
      async () => "newest",
      (value) => commits.push(value),
    );
    finishFirst("stale");
    expect(await second).toBe(true);
    expect(await first).toBe(false);
    expect(commits).toEqual(["newest"]);
  });
});
