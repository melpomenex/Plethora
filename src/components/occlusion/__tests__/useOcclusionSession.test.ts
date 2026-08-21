import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOcclusionSession } from "../useOcclusionSession";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";

const regionA: ImageOcclusionRegion = { id: "a", x: 0, y: 0, width: 10, height: 10, label: "term A" };
const regionB: ImageOcclusionRegion = { id: "b", x: 20, y: 20, width: 10, height: 10, label: "term B" };

function renderSession(initialRegions: ImageOcclusionRegion[] = [], initialSuggestions: ImageOcclusionRegion[] = []) {
  return renderHook(() =>
    useOcclusionSession({ initialRegions, initialSuggestions }),
  );
}

describe("useOcclusionSession", () => {
  it("starts from the initial regions and suggestions with undo disabled", () => {
    const { result } = renderSession([regionA], [regionB]);
    expect(result.current.regions).toEqual([regionA]);
    expect(result.current.suggestions).toEqual([regionB]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.mode).toBe("hide-all");
  });

  it("a single committed gesture yields exactly one history entry", () => {
    const { result } = renderSession([regionA]);
    act(() => result.current.apply({ type: "replaceRegions", regions: [regionA, regionB] }));
    expect(result.current.hasChanges).toBe(true);
    // One undo fully reverts the single commit.
    act(() => result.current.undo());
    expect(result.current.regions).toEqual([regionA]);
    expect(result.current.canUndo).toBe(false);
    // One redo restores it.
    act(() => result.current.redo());
    expect(result.current.regions).toEqual([regionA, regionB]);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo restores a deleted region's geometry and label", () => {
    const { result } = renderSession([regionA, regionB]);
    act(() => result.current.apply({ type: "deleteRegions", ids: ["b"] }));
    expect(result.current.regions).toEqual([regionA]);
    act(() => result.current.undo());
    expect(result.current.regions).toEqual([regionA, regionB]);
    expect(result.current.regions[1]).toMatchObject({ id: "b", x: 20, y: 20, label: "term B" });
  });

  it("redo reapplies an undone move", () => {
    const { result } = renderSession([regionA]);
    act(() =>
      result.current.apply({
        type: "replaceRegions",
        regions: [{ ...regionA, x: 30, y: 30 }],
      }),
    );
    act(() => result.current.undo());
    expect(result.current.regions[0]).toMatchObject({ x: 0, y: 0 });
    act(() => result.current.redo());
    expect(result.current.regions[0]).toMatchObject({ x: 30, y: 30 });
  });

  it("undo on a fresh session is a no-op", () => {
    const { result } = renderSession([regionA]);
    act(() => result.current.undo());
    expect(result.current.regions).toEqual([regionA]);
    expect(result.current.canUndo).toBe(false);
  });

  it("accepting a suggestion moves it to regions and undo returns it to pending", () => {
    const suggestion: ImageOcclusionRegion = { id: "s1", x: 50, y: 50, width: 10, height: 10, label: "suggested" };
    const { result } = renderSession([], [suggestion]);
    act(() => result.current.apply({ type: "acceptSuggestion", id: "s1" }));
    expect(result.current.regions).toEqual([suggestion]);
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.selection).toEqual(["s1"]);
    act(() => result.current.undo());
    expect(result.current.regions).toEqual([]);
    expect(result.current.suggestions).toEqual([suggestion]);
  });

  it("rejecting a suggestion removes it and is undoable", () => {
    const suggestion: ImageOcclusionRegion = { id: "s1", x: 50, y: 50, width: 10, height: 10 };
    const { result } = renderSession([], [suggestion]);
    act(() => result.current.apply({ type: "rejectSuggestion", id: "s1" }));
    expect(result.current.suggestions).toEqual([]);
    act(() => result.current.undo());
    expect(result.current.suggestions).toEqual([suggestion]);
  });

  it("accept-all and reject-all act on every suggestion at once", () => {
    const s1: ImageOcclusionRegion = { id: "s1", x: 10, y: 10, width: 5, height: 5 };
    const s2: ImageOcclusionRegion = { id: "s2", x: 20, y: 20, width: 5, height: 5 };
    const { result } = renderSession([regionA], [s1, s2]);
    act(() => result.current.apply({ type: "acceptAllSuggestions" }));
    expect(result.current.regions).toHaveLength(3);
    expect(result.current.suggestions).toEqual([]);
    act(() => result.current.undo());
    expect(result.current.regions).toEqual([regionA]);
    expect(result.current.suggestions).toEqual([s1, s2]);
    act(() => result.current.apply({ type: "rejectAllSuggestions" }));
    expect(result.current.suggestions).toEqual([]);
  });

  it("duplicate copies the selected regions with an offset and selects the copies", () => {
    const { result } = renderSession([regionA, regionB]);
    act(() => result.current.apply({ type: "duplicateRegions", ids: ["a", "b"] }));
    expect(result.current.regions).toHaveLength(4);
    const copies = result.current.regions.slice(2);
    expect(copies[0]).toMatchObject({ x: 5, y: 5, width: 10, height: 10, label: "term A" });
    expect(copies[0].id).not.toBe("a");
    expect(result.current.selection).toEqual(copies.map((c) => c.id));
    act(() => result.current.undo());
    expect(result.current.regions).toEqual([regionA, regionB]);
  });

  it("label edits create history entries and are undoable", () => {
    const { result } = renderSession([regionA]);
    act(() => result.current.apply({ type: "setLabel", id: "a", label: "renamed" }));
    expect(result.current.regions[0].label).toBe("renamed");
    act(() => result.current.undo());
    expect(result.current.regions[0].label).toBe("term A");
  });

  it("switching mode preserves region geometry and creates no history entry", () => {
    const { result } = renderSession([regionA]);
    act(() => result.current.apply({ type: "setMode", mode: "hide-all" }));
    expect(result.current.mode).toBe("hide-all");
    expect(result.current.regions).toEqual([regionA]);
    expect(result.current.hasChanges).toBe(false);
  });

  it("caps the history stack at 50 entries", () => {
    const { result } = renderSession([]);
    for (let i = 0; i < 60; i += 1) {
      act(() => result.current.apply({ type: "replaceRegions", regions: [{ ...regionA, x: i }] }));
    }
    // 60 commits: the oldest 10 are evicted, keeping 50 + present.
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.regions[0].x).toBe(57);
  });
});
