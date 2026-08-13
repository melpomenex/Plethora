import { describe, it, expect } from "vitest";
import {
  parseMarkdownHeadings,
  buildTreeFromHeadings,
  flattenTree,
  buildDocumentSections,
  buildHeuristicParagraphSections,
  buildSelectionFocusedContext,
  createSelectionSection,
  describeSectionDiagnostic,
  truncateTextToBudget,
  mergeOutlineWithHeuristics,
  sliceWithNeighbors,
  buildSectionFocusedContext,
  convertPdfOutlineToSectionNodes,
  convertEpubTocToSectionNodes,
  buildSectionsSnapshot,
  buildMediaTranscriptSections,
  resolveSectionFocusedContext,
  type SectionContextDiagnostic,
  type SectionNode,
} from "./sectionIndex";

describe("sectionIndex", () => {
  it("builds transcript-backed media chapters from overlapping timestamps", () => {
    const sections = buildMediaTranscriptSections(
      "book-1",
      [
        { id: 1, title: "Origins", startTime: 0, endTime: 60 },
        { id: 2, title: "Consequences", startTime: 60, endTime: 120 },
      ],
      [
        { start_ms: 5_000, end_ms: 20_000, text: "Origins-only evidence." },
        { start_ms: 70_000, end_ms: 90_000, text: "Consequences-only evidence." },
      ],
    );

    expect(sections.map((section) => section.title)).toEqual(["Origins", "Consequences"]);
    expect(sections[0].content).toContain("Origins-only evidence");
    expect(sections[0].content).not.toContain("Consequences-only evidence");
    expect(sections[1].source).toBe("media-transcript");

    const focused = buildSelectionFocusedContext([sections[0]], { maxTokens: 500 });
    expect(focused.content).toContain("Origins-only evidence");
    expect(focused.content).not.toContain("Consequences-only evidence");
  });

  it("omits media chapters that have not been transcribed yet", () => {
    const sections = buildMediaTranscriptSections(
      "book-1",
      [
        { id: 1, title: "Available", startTime: 0, endTime: 60 },
        { id: 2, title: "Not transcribed", startTime: 60, endTime: 120 },
      ],
      [{ startTime: 10, endTime: 20, text: "Saved checkpoint text." }],
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Available");
  });

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

  it("assigns differentiated heading levels to part/chapter/section keywords", () => {
    // A real nested outline: Part > Chapter. The heuristic tree must carry that
    // depth, not flatten every keyword heading to level 1, or it can never
    // breadcrumb-match a nested PDF/EPUB outline.
    const content = [
      "Part 1",
      "Chapter 1: DARWIN COMES OF AGE",
      "Real chapter body about Darwin.",
      "Chapter 2: THE ARRIVAL OF THE FITTEST",
      "Second chapter body.",
      "Part 2",
      "Chapter 3: LATER LIFE",
      "Third chapter body.",
    ].join("\n");
    const headings = parseMarkdownHeadings(content);
    const parts = headings.filter((h) => /^Part \d/.test(h.title));
    const chapters = headings.filter((h) => /^Chapter/.test(h.title));
    expect(parts).toHaveLength(2);
    expect(chapters).toHaveLength(3);
    // Parts are shallower than chapters after normalization.
    expect(parts.every((h) => h.level < chapters[0].level)).toBe(true);

    const tree = buildTreeFromHeadings(content, headings);
    const flat = flattenTree(tree);
    const chapter1 = flat.find((n) => n.title.includes("DARWIN COMES OF AGE"))!;
    expect(chapter1.breadcrumb).toContain("Part 1");
    expect(chapter1.content).toContain("Real chapter body about Darwin.");
  });

  it("keeps a flat markdown document as two level-1 sections after normalization", () => {
    const content = "# A\nAlpha body.\n# B\nBeta body.";
    const headings = parseMarkdownHeadings(content);
    expect(headings.map((h) => h.level)).toEqual([1, 1]);
    const { flat } = buildDocumentSections(content);
    expect(flat.map((n) => n.title)).toEqual(["A", "B"]);
    expect(flat.every((n) => n.level === 1)).toBe(true);
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

  it("merges an outline node onto the longest-bodied heuristic candidate", () => {
    // Real-world shape: a chapter title appears three times in the extracted
    // text — once in a page-numbered table of contents, once in a detailed TOC
    // that lists the chapter's sub-sections, and once as the real chapter
    // heading followed by prose. The outline node must merge onto the body
    // candidate (the longest range), not the first TOC-shaped match.
    const content = [
      "Title Page",
      "Chapter 1: DARWIN COMES OF AGE · 19",
      "Chapter 2: MALE AND FEMALE · 33",
      "Chapter 1: DARWIN COMES OF AGE",
      "AN UNLIKELY HERO",
      "CLIMATE CONTROL",
      "DARWIN'S SEX LIFE",
      "Chapter 2: MALE AND FEMALE",
      "PLAYING GOD",
      "The Moral Animal",
      "Chapter 1: DARWIN COMES OF AGE",
      "As for an English lady, I have almost forgotten what she is.",
      "Boys growing up in nineteenth-century England weren't generally advised to seek sexual excitement.",
      "Chapter 2: MALE AND FEMALE",
      "The second chapter body continues here.",
    ].join("\n");
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 1: DARWIN COMES OF AGE", pageNumber: 19 },
      { title: "Chapter 2: MALE AND FEMALE", pageNumber: 33 },
    ] as never);
    const { flat } = buildDocumentSections(content, outline);
    const chapter1 = flat.find((n) => n.title === "Chapter 1: DARWIN COMES OF AGE" && n.source === "pdf-outline")!;
    expect(chapter1.hasAuthoritativeRange).toBe(true);
    expect(chapter1.content).toContain("As for an English lady");
    expect(chapter1.content).not.toContain("CLIMATE CONTROL");

    const focused = resolveSectionFocusedContext([chapter1], flat, content, {
      documentId: "doc-1",
      maxTokens: 2000,
      includeNeighbors: false,
    });
    expect(focused.ok).toBe(true);
    expect(focused.content).toContain("As for an English lady");
  });

  it("recovers the chapter body, not a front-matter table-of-contents occurrence", () => {
    // The chapter title also appears in a table of contents at the top, where
    // it is immediately followed by another TOC line (no body). Recovery must
    // pick the real heading further down that is followed by the chapter prose.
    const content = [
      "Contents",
      "Chapter 1",
      "Chapter 2",
      "Chapter 1",
      "This is the real first chapter body that the model must receive.",
      "Chapter 2",
      "Second chapter body.",
    ].join("\n");
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 1", pageNumber: 1 },
      { title: "Chapter 2", pageNumber: 5 },
    ] as never);
    const { flat } = buildDocumentSections(content, outline);
    const chapter1 = flat.find((node) => node.title === "Chapter 1" && node.source === "pdf-outline")!;
    // Neighbors are disabled to assert recovery itself; with neighbors on the
    // previous-context window would legitimately reach back into the TOC.
    const focused = resolveSectionFocusedContext([chapter1], flat, content, {
      documentId: "doc-1",
      maxTokens: 2000,
      includeNeighbors: false,
    });
    expect(focused.ok).toBe(true);
    expect(focused.content).toContain("real first chapter body");
    expect(focused.content).not.toMatch(/Contents/);
  });

  it("recovers distinct bodies for two same-title outline chapters", () => {
    const content = [
      "Chapter 1",
      "First unique chapter body alpha.",
      "Chapter 2",
      "Second chapter body beta.",
      "Chapter 1",
      "This later chapter one body gamma is distinct.",
    ].join("\n");
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 1", pageNumber: 1 },
      { title: "Chapter 1", pageNumber: 9 },
    ] as never);
    const { flat } = buildDocumentSections(content, outline);
    const chapters = flat.filter((node) => node.title === "Chapter 1" && node.source === "pdf-outline");
    expect(chapters).toHaveLength(2);
    const focused = resolveSectionFocusedContext(chapters, flat, content, { documentId: "doc-1", maxTokens: 2000 });
    expect(focused.ok).toBe(true);
    expect(focused.content).toContain("First unique chapter body alpha");
    expect(focused.content).toContain("later chapter one body gamma");
  });

  it("treats a section whose only range has no body as unresolved", () => {
    // A title that appears only as a table-of-contents line, immediately
    // followed by another TOC line, has no body to send. The resolver must not
    // hand the empty/heading-only text to the model as if it were context.
    const content = ["Contents", "Chapter 1", "Chapter 2", "Chapter 3", "Closing"].join("\n");
    const outline = convertPdfOutlineToSectionNodes([
      { title: "Chapter 1", pageNumber: 1 },
      { title: "Chapter 2", pageNumber: 2 },
      { title: "Chapter 3", pageNumber: 3 },
    ] as never);
    const { flat } = buildDocumentSections(content, outline);
    const chapter1 = flat.find((node) => node.title === "Chapter 1" && node.source === "pdf-outline")!;
    const focused = resolveSectionFocusedContext([chapter1], flat, content, {
      documentId: "doc-1",
      maxTokens: 2000,
      includeNeighbors: false,
    });
    expect(focused.ok).toBe(false);
    expect(focused.failure).toBe("unresolved");
  });

  it("skips an empty-body candidate and resolves to a candidate with real body", () => {
    // The current-tree node for "Target" carries a stale range that slices to
    // nothing, but the picked node itself has the authoritative range. The
    // resolver should try the next candidate instead of returning empty.
    const content = "# Target\nReal target body text here.\n# Next\nOther.";
    const { flat } = buildDocumentSections(content);
    const good = flat.find((node) => node.title === "Target")!;
    // A current-tree node with a degenerate (zero-length) range that nonetheless
    // passes the documentId check but yields no body.
    const emptyBodied: SectionNode = {
      ...good,
      id: "empty-ranged",
      startChar: 0,
      endChar: 0,
      content: "",
    };
    const available = [emptyBodied, ...flat];
    const focused = resolveSectionFocusedContext([good], available, content, { documentId: "doc-1" });
    expect(focused.ok).toBe(true);
    expect(focused.content).toContain("Real target body text here.");
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
    expect(result.failure).toBe("unresolved");
  });

  it("rejects an ambiguous duplicate heading instead of guessing", () => {
    const content = "# Part A\n## Summary\nAlpha.\n# Part B\n## Summary\nBeta.";
    const { flat } = buildDocumentSections(content);
    const stale = {
      ...flat.find((node) => node.title === "Summary")!,
      id: "stale",
      breadcrumb: [],
      hasAuthoritativeRange: false,
      content: "",
    };
    const result = resolveSectionFocusedContext([stale], flat, content, { documentId: "doc-1" });
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("ambiguous");
    expect(result.unresolved[0].code).toBe("ambiguous");
    expect(result.unresolved[0].candidateCount).toBeGreaterThanOrEqual(2);
  });

  it("describeSectionDiagnostic renders actionable per-code reasons", () => {
    const wrongDoc: SectionContextDiagnostic = { id: "x", label: "Intro", reason: "r", code: "wrong-document" };
    const ambiguous: SectionContextDiagnostic = { id: "y", label: "Summary", reason: "r", code: "ambiguous", candidateCount: 3 };
    const unresolved: SectionContextDiagnostic = { id: "z", label: "Missing", reason: "r", code: "unresolved" };
    expect(describeSectionDiagnostic(wrongDoc)).toContain("different document");
    expect(describeSectionDiagnostic(ambiguous)).toContain("matched 3 headings");
    expect(describeSectionDiagnostic(unresolved)).toContain("no current document-text range");
  });

  it("returns stable provenance and exact selected ranges", () => {
    const content = "# Opening\nIgnore.\n# Target\nKeep this.\n# Ending\nIgnore.";
    const { flat } = buildDocumentSections(content);
    const target = flat.find((node) => node.title === "Target")!;
    const result = resolveSectionFocusedContext([target], flat, content, { documentId: "doc-1" });
    expect(result.ok).toBe(true);
    expect(result.source.documentId).toBe("doc-1");
    expect(result.source.sectionIds).toEqual([target.id]);
    expect(result.source.ranges).toEqual([{ start: target.startChar, end: target.endChar }]);
    expect(result.source.contentHash).toBeTruthy();
    expect(result.source.contextKey).toBeTruthy();
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

  it("buildDocumentSections uses heading structure when headings exist", () => {
    const content = "# Introduction\n\nSome intro text.\n\n## Details\n\nMore text here.";
    const { tree, flat } = buildDocumentSections(content);
    expect(tree.length).toBe(1);
    expect(tree[0].title).toBe("Introduction");
    expect(tree[0].children).toHaveLength(1);
    expect(flat.map((n) => n.title)).toEqual(["Introduction", "Details"]);
  });

  it("buildDocumentSections engages the heuristic segmenter when headings yield fewer than two nodes", () => {
    // No headings at all — the primary path would produce a single
    // "Full Document" node, so the paragraph-boundary fallback must engage.
    const paragraph = (seed: string) =>
      `This is the ${seed} paragraph of a plain imported article. It contains several sentences of connected prose so the segmenter treats it as one block and the article spans far more than a single segment of text.`;
    const content = [
      paragraph("first"),
      paragraph("second"),
      paragraph("third"),
      paragraph("fourth"),
    ].join("\n\n");
    const { tree, flat } = buildDocumentSections(content);
    expect(flat.length).toBeGreaterThanOrEqual(2);
    expect(flat.every((n) => n.title !== "Full Document")).toBe(true);
    expect(flat.every((n) => n.content.length > 0 && n.startChar !== undefined)).toBe(true);
    expect(tree).toEqual(flat);
  });

  it("buildDocumentSections returns no sections for a document without readable text", () => {
    const { tree, flat } = buildDocumentSections("");
    expect(tree).toHaveLength(0);
    expect(flat).toHaveLength(0);
  });

  it("buildHeuristicParagraphSections labels segments by their opening words", () => {
    const paragraph = (seed: string, label: string) =>
      `The ${label} paragraph begins with distinctive opening words so its segment label stands out from its neighbours in the mention popup, and it carries enough prose to fill a segment on its own.`;
    const content = [
      paragraph("one", "Alpha"),
      paragraph("two", "Beta"),
      paragraph("three", "Gamma"),
    ].join("\n\n");
    const segments = buildHeuristicParagraphSections(content, { targetChars: 120 });
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0].title).toContain("Alpha");
    expect(segments[1].title).toContain("Beta");
    expect(segments.every((s) => s.source === "text" && s.hasAuthoritativeRange)).toBe(true);
  });

  it("buildHeuristicParagraphSections clamps to maxSegments and covers the whole text", () => {
    const content = Array.from({ length: 50 }, (_, i) => `Paragraph number ${i} with enough words to be a real block of text.`).join("\n\n");
    const segments = buildHeuristicParagraphSections(content, { targetChars: 40, maxSegments: 10 });
    expect(segments.length).toBeLessThanOrEqual(10);
    expect(segments[0].startChar).toBe(0);
    const last = segments[segments.length - 1];
    expect(last.endChar).toBeLessThanOrEqual(content.length);
  });

  it("createSelectionSection carries exactly the selected text", () => {
    const node = createSelectionSection("  The exact words the user selected.  ", "doc-1");
    expect(node.content).toBe("The exact words the user selected.");
    expect(node.source).toBe("selection");
    expect(node.documentId).toBe("doc-1");
    expect(node.title).toContain("The exact words");
  });

  it("truncateTextToBudget truncates at a boundary and reports it", () => {
    const text = "word ".repeat(500);
    const { text: truncated, truncated: wasTruncated } = truncateTextToBudget(text, 200);
    expect(wasTruncated).toBe(true);
    expect(truncated.length).toBeLessThan(text.length);
    expect(truncated).toContain("truncated");
    const short = truncateTextToBudget("short", 200);
    expect(short.truncated).toBe(false);
    expect(short.text).toBe("short");
  });

  it("buildSelectionFocusedContext attaches exactly the selection and flags truncation", () => {
    const selection = createSelectionSection("selected passage");
    const { content, truncated, labels } = buildSelectionFocusedContext([selection], { maxTokens: 4000 });
    expect(content).toContain("selected passage");
    expect(content).toContain("[Selection]");
    expect(labels).toHaveLength(1);
    expect(truncated).toBe(false);

    const huge = createSelectionSection("x ".repeat(50000));
    const big = buildSelectionFocusedContext([huge], { maxTokens: 1 });
    expect(big.truncated).toBe(true);
    expect(big.content.length).toBeLessThan(50000);
  });
});

describe("buildSectionsSnapshot (send-time stale-tree retry)", () => {
  it("stamps the documentId onto every flat node", () => {
    const { flat } = buildSectionsSnapshot("doc-1", "# Heading\nBody text.");
    expect(flat.length).toBeGreaterThan(0);
    for (const node of flat) expect(node.documentId).toBe("doc-1");
  });

  it("returns an empty tree for a document without readable text", () => {
    const { tree, flat } = buildSectionsSnapshot("doc-1", "");
    expect(tree).toHaveLength(0);
    expect(flat).toHaveLength(0);
  });

  it("resolves a mention picked against stale text once the tree is rebuilt from the fresh snapshot", () => {
    // The user picks "Chapter 1" while only the first part of the book has
    // been mirrored/loaded, so the pick-time tree has shifted offsets.
    const partialText = "# Part One\n# Chapter 1: DARWIN COMES OF AGE\nA fragment.";
    const { flat: staleFlat } = buildDocumentSections(partialText);
    const picked = staleFlat.find((section) => section.title.includes("DARWIN COMES OF AGE"))!;

    // By send time the full canonical text has arrived and disagrees with the
    // offsets the section was picked against — the stale tree cannot resolve.
    const fullText = [
      "# Front Matter\nIntroduction to the edition.\n\n",
      "# Part One: SEX, ROMANCE, AND LOVE\n\n",
      "# Chapter 1: DARWIN COMES OF AGE\n\nThe full chapter body with the exact answer.\n\n",
      "# Chapter 2: THE ARRIVAL OF THE FITTEST\n\nMore content.\n",
    ].join("");
    const staleAttempt = resolveSectionFocusedContext([picked], staleFlat, fullText, {
      documentId: "doc-1",
      maxTokens: 4000,
    });
    expect(staleAttempt.ok).toBe(false);

    // Rebuilding the tree from the same snapshot being resolved against —
    // exactly what the transparent retry now does — succeeds without the user
    // having to reselect and resend.
    const { flat: freshFlat } = buildSectionsSnapshot("doc-1", fullText);
    const retry = resolveSectionFocusedContext([picked], freshFlat, fullText, {
      documentId: "doc-1",
      maxTokens: 4000,
    });
    expect(retry.ok).toBe(true);
    expect(retry.content).toContain("The full chapter body with the exact answer.");
    expect(retry.labels.some((label) => label.includes("DARWIN COMES OF AGE"))).toBe(true);
  });

  it("rebuilds outline-based (epub-toc) sections with authoritative ranges from the fresh text", () => {
    const toc = [
      { label: "Part One", subitems: [{ label: "Chapter 1: DARWIN COMES OF AGE" }] },
    ];
    const fullText = [
      "# Part One\n\n",
      "# Chapter 1: DARWIN COMES OF AGE\n\nChapter body that must be found by heading.\n",
    ].join("");

    const outlineNodes = convertEpubTocToSectionNodes(toc as never);
    const { flat } = buildSectionsSnapshot("epub-1", fullText, { epubToc: toc });

    const chapter = flat.find((node: SectionNode) => node.title.includes("DARWIN COMES OF AGE"));
    expect(chapter).toBeDefined();
    expect(chapter!.hasAuthoritativeRange).toBe(true);
    expect(chapter!.content).toContain("Chapter body that must be found by heading.");

    // The picked node (from the outline) resolves against the rebuilt tree.
    const focused = resolveSectionFocusedContext([outlineNodes[0].children[0]], flat, fullText, {
      documentId: "epub-1",
      maxTokens: 4000,
    });
    expect(focused.ok).toBe(true);
  });

  it("shares the hook's LRU cache: a second snapshot with identical content+outline is served from cache", () => {
    const text = "# Only Heading\nBody.";
    const first = buildSectionsSnapshot("doc-2", text);
    const second = buildSectionsSnapshot("doc-2", text);
    expect(second.tree).toBe(first.tree);
    expect(second.flat).toBe(first.flat);
  });
});
