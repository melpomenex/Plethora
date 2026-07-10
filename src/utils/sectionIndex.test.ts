import { describe, it, expect } from "vitest";
import {
  parseMarkdownHeadings,
  buildTreeFromHeadings,
  flattenTree,
  buildDocumentSections,
  mergeOutlineWithHeuristics,
  sliceWithNeighbors,
  buildSectionFocusedContext,
  convertPdfOutlineToSectionNodes,
  convertEpubTocToSectionNodes,
  type SectionNode,
} from "./sectionIndex";

describe("sectionIndex", () => {
  it("parses markdown headings with levels", () => {
    const content = "# Chapter 1\nIntro\n## 1.1 Background\nDetails\n### Details deep\nMore";
    const headings = parseMarkdownHeadings(content);
    expect(headings.length).toBe(3);
    expect(headings[0].level).toBe(1);
    expect(headings[0].title).toBe("Chapter 1");
    expect(headings[1].level).toBe(2);
    expect(headings[1].title).toBe("1.1 Background");
    expect(headings[2].level).toBe(3);
  });

  it("parses numbered headings", () => {
    const content = "1. Introduction\nText\n1.1 Background\nMore\n1.2 Motivation";
    const headings = parseMarkdownHeadings(content);
    expect(headings.length).toBe(3);
    expect(headings[0].level).toBe(1);
    expect(headings[1].level).toBe(2);
    expect(headings[2].level).toBe(2);
  });

  it("builds tree with breadcrumbs", () => {
    const content = "# Chapter 1\nC1\n## 1.1 Intro\nIntro text\n## 1.2 Methods\nMethods text\n# Chapter 2\nC2\n## 2.1 Background\nBg";
    const headings = parseMarkdownHeadings(content);
    const tree = buildTreeFromHeadings(content, headings);
    expect(tree.length).toBe(2);
    expect(tree[0].title).toBe("Chapter 1");
    expect(tree[0].children.length).toBe(2);
    expect(tree[0].children[0].breadcrumb).toEqual(["Chapter 1"]);
    expect(tree[1].children[0].breadcrumb).toEqual(["Chapter 2"]);
  });

  it("handles duplicate titles with different breadcrumbs", () => {
    const content = "# Chapter 1\n## Introduction\nText\n# Chapter 2\n## Introduction\nOther";
    const headings = parseMarkdownHeadings(content);
    const tree = buildTreeFromHeadings(content, headings);
    const flat = flattenTree(tree);
    const intros = flat.filter((n) => n.title === "Introduction");
    expect(intros.length).toBe(2);
    expect(intros[0].breadcrumb).not.toEqual(intros[1].breadcrumb);
    expect(intros[0].id).not.toBe(intros[1].id);
  });

  it("flattens tree in DFS order", () => {
    const content = "# A\n## B\n### C\n## D";
    const { tree, flat } = buildDocumentSections(content);
    expect(flat.length).toBe(4);
    expect(flat[0].title).toBe("A");
    expect(flat[1].title).toBe("B");
    expect(flat[2].title).toBe("C");
    expect(flat[3].title).toBe("D");
  });

  it("merges outline with heuristics by chapter number", () => {
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 1", pageNumber: 1 },
      { title: "Chapter 2", pageNumber: 10 },
    ]);
    const heuristicContent = "1. Introduction\nIntro\n1.1 Background\nBg text\n2. Methods\nMethods\n2.1 Setup";
    const heuristicHeadings = parseMarkdownHeadings(heuristicContent);
    const heuristicTree = buildTreeFromHeadings(heuristicContent, heuristicHeadings);
    const merged = mergeOutlineWithHeuristics(outline, heuristicTree);
    expect(merged.length).toBeGreaterThanOrEqual(2);
    const flat = flattenTree(merged);
    const hasBackground = flat.some((n) => n.title.includes("Background"));
    expect(hasBackground).toBe(true);
  });

  it("sliceWithNeighbors returns previous, focused, next", () => {
    const content = "Para one.\n\nPara two target section content.\n\nPara three after.";
    const start = content.indexOf("Para two");
    const end = start + "Para two target section content.".length;
    const sliced = sliceWithNeighbors(content, start, end, 50);
    expect(sliced.focused).toContain("Para two");
    expect(sliced.formatted).toContain("[Focused]");
  });

  it("buildSectionFocusedContext respects token budget", () => {
    const content = "# Sec1\n" + "a".repeat(5000) + "\n# Sec2\n" + "b".repeat(5000);
    const { flat } = buildDocumentSections(content);
    expect(flat.length).toBe(2);
    const ctx = buildSectionFocusedContext([flat[0]], content, { maxTokens: 100, includeNeighbors: false });
    expect(ctx.length).toBeLessThan(600);
  });

  it("converts PDF outline to nodes with levels", () => {
    const outline = [
      { title: "Chapter 1", pageNumber: 1, items: [{ title: "1.1 Intro", pageNumber: 2 }] },
      { title: "Chapter 2", pageNumber: 5 },
    ];
    const nodes = convertPdfOutlineToSectionNodes(outline as never);
    expect(nodes.length).toBe(2);
    expect(nodes[0].children.length).toBe(1);
    expect(nodes[0].children[0].level).toBe(2);
    expect(nodes[0].page).toBe(1);
  });

  it("converts EPUB toc to nodes preserving href", () => {
    const toc = [
      { label: "Chapter 1", href: "ch1.html", subitems: [{ label: "Intro", href: "ch1.html#intro" }] },
    ];
    const nodes = convertEpubTocToSectionNodes(toc as never);
    expect(nodes.length).toBe(1);
    expect(nodes[0].href).toBe("ch1.html");
    expect(nodes[0].children[0].href).toBe("ch1.html#intro");
  });

  it("buildDocumentSections fallback to full document when no headings", () => {
    const content = "Just some plain text without any headings at all.";
    const { tree } = buildDocumentSections(content);
    expect(tree.length).toBe(1);
    expect(tree[0].title).toBe("Full Document");
  });
});
