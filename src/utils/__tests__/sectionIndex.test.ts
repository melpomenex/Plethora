import { describe, it, expect } from "vitest";
import {
  buildSectionsSnapshot,
  normalizeSectionTitleForMatch,
  resolvePromptSectionMentions,
  resolveSectionFocusedContext,
  type SectionNode,
} from "../sectionIndex";

const sectionNode = (id: string, title: string, documentId = "doc-1"): SectionNode => ({
  id,
  documentId,
  title,
  level: 1,
  content: `content of ${title}`,
  source: "text",
  preview: `content of ${title}`,
  parentId: null,
  breadcrumb: [],
  children: [],
});

describe("resolveSectionFocusedContext — TOC vs Chapter content matching", () => {
  it("bypasses 0-prose Table of Contents entries and resolves chapter body heading", () => {
    const documentId = "doc-test-1";
    const fullContent = `
Table of Contents
Chapter 1 Introduction
Chapter 2 Making a date
Chapter 3 Technology

Chapter 1 Introduction
This is the intro prose text.

Chapter 2 Making a date
This is the full text of Chapter 2 explaining dating methods in archaeology.
It contains multiple paragraphs of detailed explanations.

Chapter 3 Technology
Technology in ancient times.
    `.trim();

    const tocSection: SectionNode = {
      id: "sec-ch2",
      documentId,
      title: "Chapter 2 Making a date",
      level: 1,
      startChar: 40,
      endChar: 63, // Range inside TOC pointing to Chapter 3 TOC entry immediately following it (0 prose body)
      content: "Chapter 2 Making a date",
      source: "epub-toc",
      preview: "Chapter 2 Making a date",
      parentId: null,
      breadcrumb: [],
      children: [],
    };

    const available: SectionNode[] = [tocSection];

    const result = resolveSectionFocusedContext(
      [tocSection],
      available,
      fullContent,
      { documentId, maxTokens: 1000 }
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("dating methods in archaeology");
  });
});

describe("resolvePromptSectionMentions — tolerant token identity", () => {
  it("resolves an id token directly", () => {
    const nodes = [sectionNode("sec-1", "Introduction")];
    const result = resolvePromptSectionMentions("#{sec-1} explain", [], nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["sec-1"]);
    expect(result.unresolved).toEqual([]);
  });

  it("resolves a case-drifted title token", () => {
    const nodes = [sectionNode("sec-1", "Quantum Mechanics")];
    const result = resolvePromptSectionMentions("#{quantum mechanics} explain", [], nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["sec-1"]);
  });

  it("resolves a punctuation- and whitespace-drifted title token", () => {
    const nodes = [sectionNode("sec-1", "State of the Art: Methods!")];
    const result = resolvePromptSectionMentions("#{State of the Art Methods} explain", [], nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["sec-1"]);
  });

  it("reports ambiguity with the candidate titles when normalized titles collide", () => {
    const nodes = [sectionNode("sec-1", "Results"), sectionNode("sec-2", "results!")];
    const result = resolvePromptSectionMentions("#{RESULTS} explain", [], nodes);
    expect(result.nodes).toEqual([]);
    expect(result.ambiguous).toEqual(["RESULTS"]);
    expect(result.ambiguousTitles).toEqual([
      { token: "RESULTS", titles: ["Results", "results!"] },
    ]);
  });

  it("keeps an unresolvable token unresolved instead of guessing", () => {
    const nodes = [sectionNode("sec-1", "Introduction")];
    const result = resolvePromptSectionMentions("#{No Such Section} explain", [], nodes);
    expect(result.unresolved).toEqual(["No Such Section"]);
  });

  it("normalizeSectionTitleForMatch folds case, punctuation, and whitespace", () => {
    expect(normalizeSectionTitleForMatch("  Hello, World!! ")).toBe("hello world");
    expect(normalizeSectionTitleForMatch("A—B")).toBe(normalizeSectionTitleForMatch("a b"));
  });
});

describe("pseudo-document contexts resolve against attached content", () => {
  it("resolves a transcript-style chapter mention from attached content alone", () => {
    // Mirrors the podcast/extract send path: no document row exists, so the
    // section tree is built from the attached content itself and resolution
    // must succeed against that snapshot.
    const transcript = [
      "# Chapter 1: The Cortex",
      "Cortical columns process information.",
      "",
      "# Chapter 2: Memory",
      "Memories are stored across the brain.",
    ].join("\n");
    const snapshot = buildSectionsSnapshot("attached-content", transcript, undefined);
    const chapter = snapshot.flat.find((node) => node.title.includes("Memory"))!;

    const result = resolveSectionFocusedContext(
      [chapter],
      snapshot.flat,
      transcript,
      { documentId: "attached-content", maxTokens: 1000 },
    );

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Memories are stored across the brain.");
  });
});
