import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SectionNode } from "../../../utils/sectionIndex";
import {
  buildOutlineRows,
  filterSectionRows,
  useSectionPicker,
} from "../sectionPickerModel";

const node = (
  id: string,
  title: string,
  options: Partial<SectionNode> & { children?: SectionNode[] } = {},
): SectionNode => ({
  id,
  documentId: "doc-1",
  title,
  level: options.level ?? 1,
  content: options.content ?? `content ${title}`,
  source: options.source ?? "text",
  preview: options.preview ?? `preview ${title}`,
  parentId: options.parentId ?? null,
  breadcrumb: options.breadcrumb ?? [],
  children: options.children ?? [],
});

const child = node("chapter-1", "Chapter 1", {
  level: 2,
  parentId: "part-1",
  breadcrumb: ["Part One"],
  content: "Darwin's chapter body about peacocks.",
  preview: "Darwin's chapter body about peacocks.",
});
const grandchild = node("section-1", "Section 1.1", {
  level: 3,
  parentId: "chapter-1",
  breadcrumb: ["Part One", "Chapter 1"],
  content: "A nested subsection.",
});
child.children = [grandchild];
const part = node("part-1", "Part One", {
  level: 1,
  content: "Part body.",
  children: [child],
});
const other = node("part-2", "Part Two", { level: 1, content: "Other part." });
const tree = [part, other];
const flat = [part, child, grandchild, other];

describe("buildOutlineRows", () => {
  it("shows only top-level sections until a branch is expanded", () => {
    expect(buildOutlineRows(tree, new Set()).map((row) => row.node.id)).toEqual([
      "part-1",
      "part-2",
    ]);

    expect(buildOutlineRows(tree, new Set(["part-1"])).map((row) => row.node.id)).toEqual([
      "part-1",
      "chapter-1",
      "part-2",
    ]);

    expect(
      buildOutlineRows(tree, new Set(["part-1", "chapter-1"])).map((row) => row.node.id),
    ).toEqual(["part-1", "chapter-1", "section-1", "part-2"]);
  });

  it("marks disclosure state for rows with children", () => {
    const [partRow, otherRow] = buildOutlineRows(tree, new Set());
    expect(partRow.hasChildren).toBe(true);
    expect(partRow.expanded).toBe(false);
    expect(otherRow.hasChildren).toBe(false);
  });
});

describe("filterSectionRows", () => {
  it("finds nested sections and keeps their breadcrumb depth", () => {
    const rows = filterSectionRows(flat, "darwin");
    expect(rows).toHaveLength(1);
    expect(rows[0].node.id).toBe("chapter-1");
    expect(rows[0].node.breadcrumb).toEqual(["Part One"]);
    expect(rows[0].depth).toBe(1);
  });

  it("matches breadcrumbs even when the title itself does not match", () => {
    const rows = filterSectionRows(flat, "part one");
    expect(rows.map((row) => row.node.id)).toContain("chapter-1");
  });

  it("keeps the live selection entry first when it matches", () => {
    const selection = node("selection-1", "Live chapter selection", { source: "selection" });
    const rows = filterSectionRows(flat, "chapter", selection);
    expect(rows[0].node.id).toBe("selection-1");
    expect(rows.map((row) => row.node.id)).toContain("chapter-1");
  });

  it("returns no rows for a zero-match query", () => {
    expect(filterSectionRows(flat, "does-not-exist")).toEqual([]);
  });
});

describe("useSectionPicker", () => {
  it("expands and collapses the active branch", () => {
    const { result } = renderHook(() =>
      useSectionPicker({ tree, flat, query: "", open: true }),
    );

    expect(result.current.rows.map((row) => row.node.id)).toEqual(["part-1", "part-2"]);

    act(() => result.current.expandActive());
    expect(result.current.rows.map((row) => row.node.id)).toEqual([
      "part-1",
      "chapter-1",
      "part-2",
    ]);
    expect(result.current.rows[0].expanded).toBe(true);

    act(() => result.current.collapseActive());
    expect(result.current.rows.map((row) => row.node.id)).toEqual(["part-1", "part-2"]);
  });

  it("clamps arrow navigation to the visible rows", () => {
    const { result } = renderHook(() =>
      useSectionPicker({ tree, flat, query: "", open: true }),
    );

    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.previous());
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.previous());
    expect(result.current.activeIndex).toBe(0);
  });

  it("keeps the live selection entry first on a bare # outline", () => {
    const selection = node("selection-1", "Live selection", { source: "selection" });
    const { result } = renderHook(() =>
      useSectionPicker({ tree, flat, query: "", selectionEntry: selection, open: true }),
    );
    expect(result.current.rows.map((row) => row.node.id)).toEqual([
      "selection-1",
      "part-1",
      "part-2",
    ]);
  });

  it("selects the highlighted row", () => {
    const { result } = renderHook(() =>
      useSectionPicker({ tree, flat, query: "", open: true }),
    );

    act(() => result.current.next());
    const highlighted = result.current.rows[result.current.activeIndex];
    expect(result.current.selectActive()?.id).toBe(highlighted.node.id);
    expect(result.current.activeDescendantId).toBe(
      `section-picker-option-${highlighted.node.id}`,
    );
  });

  it("resets the active row when the picker closes or the document changes", () => {
    const { result, rerender } = renderHook(
      ({ open, currentTree }) =>
        useSectionPicker({ tree: currentTree, flat, query: "", open }),
      { initialProps: { open: true, currentTree: tree } },
    );

    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);

    rerender({ open: false, currentTree: tree });
    expect(result.current.activeIndex).toBe(0);

    rerender({ open: true, currentTree: tree });
    const replacement = [node("new-part", "New Part")];
    rerender({ open: true, currentTree: replacement });
    expect(result.current.rows.map((row) => row.node.id)).toEqual(["new-part"]);
    expect(result.current.activeIndex).toBe(0);
  });
});
