import { describe, it, expect } from "vitest";
import { resolveSectionFocusedContext, type SectionNode } from "../sectionIndex";

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
