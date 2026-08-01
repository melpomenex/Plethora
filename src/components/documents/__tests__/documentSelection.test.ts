import { describe, expect, it } from "vitest";
import {
  selectDocumentsByCheckbox,
  selectDocumentsByClick,
  toggleDocumentSelection,
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

  it("keeps an already-selected document selected on a plain row click", () => {
    const result = selectDocumentsByClick(state(["two"], "two"), orderedIds, "two");

    expect(Array.from(result.selectedIds)).toEqual(["two"]);
  });
});

describe("checkbox selection", () => {
  it("clears a selected document when its checkbox is clicked again", () => {
    const result = toggleDocumentSelection(state(["two"], "two", ["two"]), "two");

    expect(Array.from(result.selectedIds)).toEqual([]);
    expect(Array.from(result.toggledIds)).toEqual([]);
    expect(result.anchorId).toBeNull();
  });

  it("accumulates documents without a modifier key", () => {
    const first = toggleDocumentSelection(state(), "one");
    const second = toggleDocumentSelection(first, "three");

    expect(Array.from(second.selectedIds)).toEqual(["one", "three"]);
  });

  it("removes only the clicked document from a larger selection", () => {
    const result = toggleDocumentSelection(state(["one", "two", "three"], "one"), "two");

    expect(Array.from(result.selectedIds)).toEqual(["one", "three"]);
    expect(result.anchorId).toBe("one");
  });

  it("leaves the anchor intact when a different document is cleared", () => {
    const result = toggleDocumentSelection(state(["one", "two"], "two"), "one");

    expect(result.anchorId).toBe("two");
  });

  it("does not disturb a shift range built from row clicks", () => {
    const range = selectDocumentsByClick(state(["two"], "two"), orderedIds, "four", {
      shiftKey: true,
    });
    const withExtra = toggleDocumentSelection(range, "one");

    expect(Array.from(withExtra.selectedIds)).toEqual(["two", "three", "four", "one"]);
  });

  it("toggles on an unmodified checkbox click", () => {
    const added = selectDocumentsByCheckbox(state(), orderedIds, "two");
    const removed = selectDocumentsByCheckbox(added, orderedIds, "two");

    expect(Array.from(added.selectedIds)).toEqual(["two"]);
    expect(Array.from(removed.selectedIds)).toEqual([]);
  });

  it("toggles rather than replacing when the platform modifier is held", () => {
    const result = selectDocumentsByCheckbox(state(["one"], "one"), orderedIds, "one", {
      toggleKey: true,
    });

    expect(Array.from(result.selectedIds)).toEqual([]);
  });

  it("extends a range when shift is held", () => {
    const anchored = selectDocumentsByCheckbox(state(), orderedIds, "two");
    const ranged = selectDocumentsByCheckbox(anchored, orderedIds, "four", { shiftKey: true });

    expect(Array.from(ranged.selectedIds)).toEqual(["two", "three", "four"]);
  });
});
