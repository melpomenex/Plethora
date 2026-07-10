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
  resolveSectionFocusedContext,
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

  it("parses HTML headings and scopes their body ranges", () => {
    const content = "<h1>Overview</h1><p>Intro.</p><h2>Evidence &amp; Results</h2><p>Cobalt body.</p><h1>Appendix</h1><p>Other.</p>";
    const headings = parseMarkdownHeadings(content);
    expect(headings.map((heading) => heading.title)).toEqual(["Overview", "Evidence & Results", "Appendix"]);
    const tree = buildTreeFromHeadings(content, headings);
    expect(tree[0].content).toContain("Cobalt body");
    expect(tree[0].content).not.toContain("Other");
    expect(tree[0].children[0].content).toContain("Cobalt body");
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

  it("keeps parent content through descendant headings", () => {
    const content = "# Parent\nParent body\n## Child\nChild body\n### Grandchild\nDeep body\n# Next\nNext body";
    const { flat } = buildDocumentSections(content);
    const parent = flat.find((node) => node.title === "Parent")!;
    const child = flat.find((node) => node.title === "Child")!;
    expect(parent.content).toContain("Child body");
    expect(parent.content).toContain("Deep body");
    expect(parent.content).not.toContain("Next body");
    expect(child.content).toContain("Deep body");
    expect(child.content).not.toContain("Next body");
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
    const { flat } = buildDocumentSections(content);
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

  it("enriches PDF outline nodes with body ranges instead of title-only content", () => {
    const content = "# Chapter 1\nChapter one body phrase.\n## Introduction\nFirst introduction body.\n# Chapter 2\nChapter two body.\n## Introduction\nSecond introduction body.";
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 1", pageNumber: 1, items: [{ title: "Introduction", pageNumber: 2 }] },
      { title: "Chapter 2", pageNumber: 3, items: [{ title: "Introduction", pageNumber: 4 }] },
    ] as never);
    const { flat } = buildDocumentSections(content, outline);
    const introductions = flat.filter((node) => node.title === "Introduction");
    expect(introductions).toHaveLength(2);
    expect(introductions[0].content).toContain("First introduction body");
    expect(introductions[0].content).not.toContain("Second introduction body");
    expect(introductions[1].content).toContain("Second introduction body");
    expect(introductions.every((node) => node.hasAuthoritativeRange)).toBe(true);
  });

  it("enriches EPUB TOC entries and leaves unmatched entries unresolved", () => {
    const content = "# Chapter One\nEPUB body text.\n## Details\nDetailed EPUB passage.";
    const toc = convertEpubTocToSectionNodes([
      { label: "Chapter One", href: "ch1.xhtml", subitems: [{ label: "Details", href: "ch1.xhtml#details" }] },
      { label: "Appendix Missing", href: "appendix.xhtml" },
    ] as never);
    const { flat } = buildDocumentSections(content, toc);
    expect(flat.find((node) => node.title === "Details")?.content).toContain("Detailed EPUB passage");
    const missing = flat.find((node) => node.title === "Appendix Missing")!;
    expect(missing.content).toBe("");
    expect(missing.hasAuthoritativeRange).toBe(false);
    expect(missing.href).toBe("appendix.xhtml");
  });

  it("recovers plain-text PDF outline headings that heuristic parsing cannot classify", () => {
    const content = "Preface\nOverview\nGeneral prose.\nSpecial Topic\nRecovered PDF body phrase.\nClosing Notes\nDone.";
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Overview", pageNumber: 1 },
      { title: "Special Topic", pageNumber: 2 },
      { title: "Closing Notes", pageNumber: 3 },
    ] as never);
    const selected = outline[1];
    const result = resolveSectionFocusedContext(selected ? [selected] : [], flattenTree(outline), content, {
      documentId: "pdf-1",
      maxTokens: 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Recovered PDF body phrase");
    expect(result.content).not.toContain("Closing Notes");
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

  it("resolves stale ranges structurally and accepts authoritative short sections", () => {
    const content = "# Alpha\nA\n# Beta\nCurrent beta body.";
    const { flat } = buildDocumentSections(content);
    const beta = flat.find((node) => node.title === "Beta")!;
    const stale: SectionNode = { ...beta, id: "old-id", startChar: 0, endChar: 3, content: "old" };
    const result = resolveSectionFocusedContext([stale], flat, content, { documentId: "doc-1" });
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Current beta body");

    const alpha = flat.find((node) => node.title === "Alpha")!;
    const short = resolveSectionFocusedContext([{ ...alpha, documentId: "doc-1" }], flat, content, { documentId: "doc-1" });
    expect(short.ok).toBe(true);
    expect(short.content).toContain("A");
  });

  it("rejects unresolved and cross-document selections atomically", () => {
    const content = "# Current\nCurrent body.";
    const { flat } = buildDocumentSections(content);
    const unresolved: SectionNode = {
      id: "missing", title: "Missing", level: 1, breadcrumb: [], preview: "", content: "",
      children: [], parentId: null, source: "pdf-outline", hasAuthoritativeRange: false, documentId: "doc-1",
    };
    const crossDocument = { ...flat[0], documentId: "doc-2" };
    const result = resolveSectionFocusedContext([flat[0], unresolved, crossDocument], flat, content, { documentId: "doc-1" });
    expect(result.ok).toBe(false);
    expect(result.content).toBe("");
    expect(result.unresolved).toHaveLength(2);
  });

  it("coalesces overlapping parent and child ranges while retaining both labels", () => {
    const content = "# Parent\nParent body.\n## Child\nUnique child body.\n# Next\nOther.";
    const { flat } = buildDocumentSections(content);
    const parent = flat.find((node) => node.title === "Parent")!;
    const child = flat.find((node) => node.title === "Child")!;
    const result = resolveSectionFocusedContext([child, parent], flat, content, { maxTokens: 1000 });
    expect(result.ok).toBe(true);
    expect(result.labels).toEqual(["Parent > Child", "Parent"]);
    expect(result.content.match(/Unique child body/g)).toHaveLength(1);
    expect(result.content).toContain("Parent; Parent > Child");
  });

  it("prioritizes selected body and marks truncation", () => {
    const content = `# Large\n${"important body sentence. ".repeat(300)}\n# Next\nNeighbor`;
    const { flat } = buildDocumentSections(content);
    const result = resolveSectionFocusedContext([flat[0]], flat, content, { maxTokens: 80, includeNeighbors: true });
    expect(result.ok).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("important body sentence");
    expect(result.content).toContain("[Selected section truncated due to context limit...]");
    expect(result.content).not.toContain("[Next context]");
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
    expect(nodes[0].content).toBe("");
    expect(nodes[0].hasAuthoritativeRange).toBe(false);
  });

  it("converts EPUB toc to nodes preserving href", () => {
    const toc = [
      { label: "Chapter 1", href: "ch1.html", subitems: [{ label: "Intro", href: "ch1.html#intro" }] },
    ];
    const nodes = convertEpubTocToSectionNodes(toc as never);
    expect(nodes.length).toBe(1);
    expect(nodes[0].href).toBe("ch1.html");
    expect(nodes[0].children[0].href).toBe("ch1.html#intro");
    expect(nodes[0].content).toBe("");
  });

  it("buildDocumentSections fallback to full document when no headings", () => {
    const content = "Just some plain text without any headings at all.";
    const { tree } = buildDocumentSections(content);
    expect(tree.length).toBe(1);
    expect(tree[0].title).toBe("Full Document");
  });
});
