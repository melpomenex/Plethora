import { describe, it, expect } from "vitest";
import {
  extractArticleSemanticSections,
  extractEpubSemanticSections,
  extractPdfSemanticSections,
  stripHtmlTags,
} from "../sectionIndex";

describe("Semantic Chapterization for Audio Editions", () => {
  describe("stripHtmlTags", () => {
    it("strips basic html tags and decodes entities", () => {
      const html = "<p>Hello &amp; welcome to <strong>Plethora</strong>!</p><br/><div>Second line</div>";
      const result = stripHtmlTags(html);
      expect(result).toBe("Hello & welcome to Plethora!\n\nSecond line");
    });

    it("removes script and style blocks completely", () => {
      const html = "<style>.hide{display:none}</style><p>Visible content</p><script>console.log(1);</script>";
      expect(stripHtmlTags(html)).toBe("Visible content");
    });
  });

  describe("extractArticleSemanticSections", () => {
    it("segments HTML articles by h1, h2, h3 tags", () => {
      const html = `
        <article>
          <h1>Chapter 1: The Beginning</h1>
          <p>It was the best of times, it was the worst of times.</p>
          <h2>Subsection 1.1: Context</h2>
          <p>More details on the background.</p>
          <h1>Chapter 2: The Journey</h1>
          <p>And so the voyage commenced across the sea.</p>
        </article>
      `;

      const sections = extractArticleSemanticSections(html);
      expect(sections.length).toBe(3);
      expect(sections[0].title).toBe("Chapter 1: The Beginning");
      expect(sections[0].sectionIndex).toBe(0);
      expect(sections[0].content).toContain("It was the best of times");
      expect(sections[1].title).toBe("Subsection 1.1: Context");
      expect(sections[1].sectionIndex).toBe(1);
      expect(sections[2].title).toBe("Chapter 2: The Journey");
      expect(sections[2].sectionIndex).toBe(2);
    });

    it("handles preamble before the first heading", () => {
      const html = `
        <p>This is a lengthy introduction to the book that sets up the historical background and the overall thesis before diving into chapter one proper.</p>
        <h1>First Chapter</h1>
        <p>Chapter body text goes here.</p>
      `;

      const sections = extractArticleSemanticSections(html);
      expect(sections.length).toBe(2);
      expect(sections[0].title).toBe("Introduction");
      expect(sections[1].title).toBe("First Chapter");
    });

    it("segments Markdown articles by heading markers", () => {
      const markdown = `
# Section One
Introduction to the topic with details.

## Section Two
Deep dive into methodology.

# Section Three
Conclusion and final remarks.
      `;

      const sections = extractArticleSemanticSections(markdown);
      expect(sections.length).toBe(3);
      expect(sections[0].title).toBe("Section One");
      expect(sections[1].title).toBe("Section Two");
      expect(sections[2].title).toBe("Section Three");
    });

    it("falls back to heuristic paragraph segmentation when no headings exist", () => {
      const text = `
First paragraph with several sentences explaining the first key concept.

Second paragraph with additional explanation and supporting arguments.

Third paragraph summarizing the observations and transitioning to conclusions.
      `;

      const sections = extractArticleSemanticSections(text, { targetChars: 50 });
      expect(sections.length).toBeGreaterThanOrEqual(1);
      expect(sections[0].sectionIndex).toBe(0);
      expect(sections[0].characterCount).toBeGreaterThan(0);
    });
  });

  describe("extractEpubSemanticSections", () => {
    it("extracts flattened sections from nested EPUB TOC", () => {
      const toc = [
        {
          label: "Part I",
          href: "part1.xhtml",
          subitems: [
            { label: "Chapter 1", href: "part1.xhtml#ch1" },
            { label: "Chapter 2", href: "part1.xhtml#ch2" },
          ],
        },
        {
          label: "Part II",
          href: "part2.xhtml",
          subitems: [{ label: "Chapter 3", href: "part2.xhtml#ch3" }],
        },
      ];

      const contentMap = {
        "part1.xhtml": "<p>Part 1 full text content goes here.</p>",
        "part2.xhtml": "<p>Part 2 full text content goes here.</p>",
      };

      const sections = extractEpubSemanticSections(toc, undefined, contentMap);
      expect(sections.length).toBe(5);
      expect(sections[0].title).toBe("Part I");
      expect(sections[0].level).toBe(1);
      expect(sections[1].title).toBe("Chapter 1");
      expect(sections[1].level).toBe(2);
      expect(sections[3].title).toBe("Part II");
    });

    it("falls back to spine items when TOC is empty", () => {
      const spine = [
        { href: "text/ch01.xhtml", title: "Chapter 1", text: "<p>Text of chapter 1</p>" },
        { href: "text/ch02.xhtml", title: "Chapter 2", text: "<p>Text of chapter 2</p>" },
      ];

      const sections = extractEpubSemanticSections([], spine);
      expect(sections.length).toBe(2);
      expect(sections[0].title).toBe("Chapter 1");
      expect(sections[0].content).toBe("Text of chapter 1");
      expect(sections[1].title).toBe("Chapter 2");
    });
  });

  describe("extractPdfSemanticSections", () => {
    it("extracts sections from PDF outline with page ranges", () => {
      const outline = [
        { title: "Introduction", pageNumber: 1 },
        { title: "Chapter 1: Theory", pageNumber: 5 },
        { title: "Chapter 2: Practice", pageNumber: 15 },
      ];

      const pageContents = [
        { pageNumber: 1, text: "Welcome to this book." },
        { pageNumber: 2, text: "More introductory material." },
        { pageNumber: 5, text: "Theoretical foundations." },
        { pageNumber: 15, text: "Practical implementations." },
      ];

      const sections = extractPdfSemanticSections(outline, pageContents);
      expect(sections.length).toBe(3);
      expect(sections[0].title).toBe("Introduction");
      expect(sections[0].sourceStartAnchor).toBe("page:1");
      expect(sections[0].sourceEndAnchor).toBe("page:4");
      expect(sections[0].content).toContain("Welcome to this book.");
      expect(sections[1].title).toBe("Chapter 1: Theory");
      expect(sections[1].sourceStartAnchor).toBe("page:5");
      expect(sections[1].sourceEndAnchor).toBe("page:14");
    });

    it("groups pages into chapters when outline is missing", () => {
      const pageContents = [
        { pageNumber: 1, text: "Page 1" },
        { pageNumber: 2, text: "Page 2" },
        { pageNumber: 3, text: "Page 3" },
        { pageNumber: 4, text: "Page 4" },
        { pageNumber: 5, text: "Page 5" },
        { pageNumber: 6, text: "Page 6" },
      ];

      const sections = extractPdfSemanticSections([], pageContents);
      expect(sections.length).toBe(2);
      expect(sections[0].title).toBe("Pages 1–5");
      expect(sections[1].title).toBe("Pages 6–6");
    });
  });
});
