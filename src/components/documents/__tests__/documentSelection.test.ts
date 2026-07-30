import { describe, expect, it } from "vitest";
import {
  selectDocumentsByClick,
  uniqueDocumentIds,
  type DocumentSelectionState,
} from "../documentSelection";

const orderedIds = ["one", "two", "three", "four", "five"];

function state(
  selectedIds: string[] = [],
  anchorId: string | null = null,
  toggledIds: string[] = [],
): DocumentSelectionState {
  return {
    selectedIds: new Set(selectedIds),
    anchorId,
    toggledIds: new Set(toggledIds),
  };
}

describe("document selection", () => {
  it("deduplicates document IDs for repeated dashboard sections", () => {
    expect(uniqueDocumentIds(["one", "two", "one", "three", "two"])).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  it("selects an inclusive forward range from the anchor", () => {
    const result = selectDocumentsByClick(state(["two"], "two"), orderedIds, "four", {
      shiftKey: true,
    });

    expect(Array.from(result.selectedIds)).toEqual(["two", "three", "four"]);
    expect(result.anchorId).toBe("two");
  });

  it("selects an inclusive reverse range from the anchor", () => {
    const result = selectDocumentsByClick(state(["four"], "four"), orderedIds, "two", {
      shiftKey: true,
    });

    expect(Array.from(result.selectedIds)).toEqual(["two", "three", "four"]);
  });

  it("replaces the prior range while retaining independently toggled documents", () => {
    const result = selectDocumentsByClick(
      state(["one", "two", "three", "five"], "one", ["five"]),
      orderedIds,
      "three",
      { shiftKey: true },
    );

    expect(Array.from(result.selectedIds)).toEqual(["one", "two", "three", "five"]);
    expect(Array.from(result.toggledIds)).toEqual(["five"]);
  });

  it("falls back to single selection when the anchor is no longer visible", () => {
    const result = selectDocumentsByClick(state(["one"], "one"), ["two", "three"], "three", {
      shiftKey: true,
    });

    expect(Array.from(result.selectedIds)).toEqual(["three"]);
    expect(result.anchorId).toBe("three");
  });

  it("toggles independently with command/control selection", () => {
    const added = selectDocumentsByClick(state(["one"], "one"), orderedIds, "three", {
      toggleKey: true,
    });
    const removed = selectDocumentsByClick(added, orderedIds, "three", { toggleKey: true });

    expect(Array.from(added.selectedIds)).toEqual(["one", "three"]);
    expect(Array.from(removed.selectedIds)).toEqual(["one"]);
  });
});
