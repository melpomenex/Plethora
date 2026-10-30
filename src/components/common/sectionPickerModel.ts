import { useCallback, useEffect, useMemo, useState } from "react";
import type { SectionNode } from "../../utils/sectionIndex";

/**
 * One visible row of the `#` section picker. `depth` is the visual outline
 * depth (roots are 0); search rows use their breadcrumb depth so a nested
 * match is still readable in a flat result list.
 */
export interface SectionPickerRow {
  node: SectionNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export function sectionPickerOptionId(nodeId: string): string {
  return `section-picker-option-${nodeId}`;
}

export function matchesSectionQuery(node: SectionNode, query: string): boolean {
  if (!query) return true;
  const lowerQuery = query.toLowerCase();
  return (
    node.title.toLowerCase().includes(lowerQuery) ||
    node.content.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Heading-oriented score for a query. Kept in one place so the popup and the
 * host's keyboard navigation can never rank rows differently.
 */
export function scoreSectionNode(node: SectionNode, query: string): number {
  if (!query) return 0;
  const lowerQuery = query.toLowerCase();
  const titleLower = node.title.toLowerCase();
  const breadcrumbLower = node.breadcrumb.join(" > ").toLowerCase();
  const previewLower = node.preview.toLowerCase();

  let score = 0;

  if (titleLower.startsWith(lowerQuery)) score += 100;
  else if (titleLower.includes(lowerQuery)) score += 50;

  score += breadcrumbLower.includes(lowerQuery) ? 20 : 0;
  score += previewLower.includes(lowerQuery) ? 5 : 0;

  const titleWeight = titleLower.includes(lowerQuery) ? 2 : 1;
  score *= titleWeight;

  score -= node.level * 0.5;

  return score;
}

/**
 * Depth-first visible rows for the bare `#` outline. Collapsed branches hide
 * their entire descendant chain — unlike the old chevron that only toggled an
 * arrow while every nested heading stayed listed.
 */
export function buildOutlineRows(
  tree: SectionNode[],
  expandedIds: ReadonlySet<string>,
): SectionPickerRow[] {
  const rows: SectionPickerRow[] = [];

  const visit = (nodes: SectionNode[], depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const expanded = hasChildren && expandedIds.has(node.id);
      rows.push({ node, depth, hasChildren, expanded });
      if (expanded) visit(node.children, depth + 1);
    }
  };

  visit(tree, 0);
  return rows;
}

/**
 * Ranked, de-duplicated search rows across every depth. The live text
 * selection entry is synthetic (never part of `flat`) and always ranks first
 * when it matches, matching the old picker's promise that the current
 * selection is the first choice.
 */
export function filterSectionRows(
  flat: SectionNode[],
  query: string,
  selectionEntry?: SectionNode | null,
): SectionPickerRow[] {
  const seen = new Set<string>();
  const rows: SectionPickerRow[] = [];

  const push = (node: SectionNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    rows.push({
      node,
      depth,
      hasChildren: node.children.length > 0,
      expanded: false,
    });
  };

  if (selectionEntry && matchesSectionQuery(selectionEntry, query)) {
    push(selectionEntry, 0);
  }

  const scored = flat
    .filter((node) => !seen.has(node.id))
    .map((node) => ({ node, score: scoreSectionNode(node, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const aSelection = a.node.source === "selection" ? 1 : 0;
      const bSelection = b.node.source === "selection" ? 1 : 0;
      return (
        bSelection - aSelection ||
        b.score - a.score ||
        a.node.level - b.node.level
      );
    })
    .slice(0, 100);

  for (const entry of scored) {
    push(entry.node, entry.node.breadcrumb.length);
  }

  return rows;
}

export interface UseSectionPickerOptions {
  tree: SectionNode[];
  flat: SectionNode[];
  query: string;
  selectionEntry?: SectionNode | null;
  open: boolean;
}

export interface UseSectionPickerResult {
  rows: SectionPickerRow[];
  activeIndex: number;
  activeRow: SectionPickerRow | undefined;
  activeDescendantId: string | undefined;
  expandedIds: ReadonlySet<string>;
  setActiveIndex: (index: number) => void;
  next: () => void;
  previous: () => void;
  expandActive: () => void;
  collapseActive: () => void;
  toggleExpanded: (nodeId: string) => void;
  selectActive: () => SectionNode | undefined;
}

/**
 * Owns outline expansion and the active row for a picker. Hosts render the
 * returned rows and call the movement helpers from the textarea keydown
 * handler, so the row that Enter selects is always the highlighted row.
 */
export function useSectionPicker({
  tree,
  flat,
  query,
  selectionEntry = null,
  open,
}: UseSectionPickerOptions): UseSectionPickerResult {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);

  const rows = useMemo<SectionPickerRow[]>(() => {
    if (query) {
      return filterSectionRows(flat, query, selectionEntry);
    }
    return buildOutlineRows(tree, expandedIds);
    // expandedIds is a Set; its identity changes on every toggle, which is the
    // intended invalidation. The tree and flat arrays are memoized upstream.
  }, [expandedIds, flat, query, selectionEntry, tree]);

  const treeSignature = useMemo(
    () => tree.map((node) => node.id).join("|"),
    [tree],
  );

  useEffect(() => {
    if (!open) {
      setExpandedIds(new Set());
      setActiveIndex(0);
    }
  }, [open]);

  // A different document (or a rebuilt outline) starts collapsed again.
  useEffect(() => {
    setExpandedIds(new Set());
    setActiveIndex(0);
  }, [treeSignature]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    setActiveIndex((index) =>
      Math.min(index, Math.max(0, rows.length - 1)),
    );
  }, [rows.length]);

  const activeRow = rows[activeIndex] ?? rows[0];

  const next = useCallback(() => {
    setActiveIndex((index) => Math.min(index + 1, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  const previous = useCallback(() => {
    setActiveIndex((index) => Math.max(0, index - 1));
  }, []);

  const expandActive = useCallback(() => {
    if (!activeRow?.hasChildren) return;
    setExpandedIds((prev) => {
      if (prev.has(activeRow.node.id)) return prev;
      const nextSet = new Set(prev);
      nextSet.add(activeRow.node.id);
      return nextSet;
    });
  }, [activeRow]);

  const collapseActive = useCallback(() => {
    if (!activeRow?.expanded) return;
    setExpandedIds((prev) => {
      if (!prev.has(activeRow.node.id)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(activeRow.node.id);
      return nextSet;
    });
  }, [activeRow]);

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(nodeId)) nextSet.delete(nodeId);
      else nextSet.add(nodeId);
      return nextSet;
    });
  }, []);

  const selectActive = useCallback(() => activeRow?.node, [activeRow]);

  return {
    rows,
    activeIndex: Math.min(activeIndex, Math.max(0, rows.length - 1)),
    activeRow,
    activeDescendantId: activeRow
      ? sectionPickerOptionId(activeRow.node.id)
      : undefined,
    expandedIds,
    setActiveIndex,
    next,
    previous,
    expandActive,
    collapseActive,
    toggleExpanded,
    selectActive,
  };
}
