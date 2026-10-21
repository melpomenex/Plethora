import { describe, expect, it } from "vitest";
import { GraphNodeType } from "../KnowledgeGraph";
import {
  countActiveGraphFilters,
  describeActiveGraphFilters,
  removeActiveGraphFilter,
  type GraphFilters,
} from "../GraphFilters";
import { t } from "../../../lib/i18n";

function filters(overrides: Partial<GraphFilters> = {}): GraphFilters {
  return {
    searchQuery: "",
    nodeTypes: [],
    categories: [],
    tags: [],
    ...overrides,
  };
}

describe("describeActiveGraphFilters", () => {
  it("returns nothing when no filters are active", () => {
    expect(describeActiveGraphFilters(filters(), t)).toEqual([]);
    expect(countActiveGraphFilters(filters())).toBe(0);
  });

  it("describes a search term", () => {
    const described = describeActiveGraphFilters(filters({ searchQuery: "memory" }), t);
    expect(described).toEqual([
      { id: "search", kind: "search", label: 'Search: "memory"' },
    ]);
    expect(countActiveGraphFilters(filters({ searchQuery: "memory" }))).toBe(1);
  });

  it("labels node-type exclusions explicitly", () => {
    const described = describeActiveGraphFilters(
      filters({ nodeTypes: [GraphNodeType.Document, GraphNodeType.Flashcard] }),
      t,
    );
    expect(described.map((entry) => entry.label)).toEqual([
      "Without Documents",
      "Without Flashcards",
    ]);
    expect(described.map((entry) => entry.id)).toEqual([
      `nodeType:${GraphNodeType.Document}`,
      `nodeType:${GraphNodeType.Flashcard}`,
    ]);
  });

  it("describes categories and tags and counts every dimension", () => {
    const current = filters({
      searchQuery: " graph ",
      nodeTypes: [GraphNodeType.Extract],
      categories: ["Research"],
      tags: ["ai", "memory"],
    });
    const described = describeActiveGraphFilters(current, t);
    expect(described.map((entry) => entry.kind)).toEqual([
      "search",
      "nodeType",
      "category",
      "tag",
      "tag",
    ]);
    expect(described.map((entry) => entry.label)).toEqual([
      'Search: "graph"',
      "Without Extracts",
      "Research",
      "#ai",
      "#memory",
    ]);
    expect(countActiveGraphFilters(current)).toBe(5);
  });
});

describe("removeActiveGraphFilter", () => {
  const current = filters({
    searchQuery: "graph",
    nodeTypes: [GraphNodeType.Document],
    categories: ["Research"],
    tags: ["ai"],
  });

  it("removes only the requested dimension", () => {
    expect(removeActiveGraphFilter(current, "search").searchQuery).toBe("");
    expect(removeActiveGraphFilter(current, `nodeType:${GraphNodeType.Document}`).nodeTypes).toEqual([]);
    expect(removeActiveGraphFilter(current, "category:Research").categories).toEqual([]);
    expect(removeActiveGraphFilter(current, "tag:ai").tags).toEqual([]);
  });

  it("leaves the other dimensions intact", () => {
    const next = removeActiveGraphFilter(current, "tag:ai");
    expect(next).toEqual({
      searchQuery: "graph",
      nodeTypes: [GraphNodeType.Document],
      categories: ["Research"],
      tags: [],
    });
  });

  it("returns the same filters for an unknown descriptor", () => {
    expect(removeActiveGraphFilter(current, "unknown")).toBe(current);
  });
});
