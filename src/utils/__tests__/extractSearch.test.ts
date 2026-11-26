import { describe, expect, it } from "vitest";
import {
  matchesExtractSearch,
  matchesVideoExtractSearch,
  stripHtmlTags,
  tokenizeSearchQuery,
} from "../extractSearch";

describe("extractSearch", () => {
  it("tokenizes whitespace-separated queries case-insensitively", () => {
    expect(tokenizeSearchQuery("  Fortran   1950s  ")).toEqual(["fortran", "1950s"]);
    expect(tokenizeSearchQuery("   ")).toEqual([]);
  });

  it("strips HTML tags without merging adjacent words", () => {
    expect(stripHtmlTags("<p>Hello <b>world</b></p>")).toContain("Hello");
    expect(stripHtmlTags("<p>Hello</p><p>world</p>")).toMatch(/Hello\s+world/);
  });

  it("matches text extracts across content, notes, tags, and document title", () => {
    const extract = {
      content: "<p>The first digital computers used <span>floating-point</span> arithmetic.</p>",
      notes: "Chapter 1 summary",
      tags: ["history", "compilers"],
      category: "CS",
      page_title: "Concepts of Programming Languages",
      source_url: "https://example.com/cpl",
    };

    expect(matchesExtractSearch(extract, "floating-point", "CS Textbook")).toBe(true);
    expect(matchesExtractSearch(extract, "chapter compilers", "CS Textbook")).toBe(true);
    expect(matchesExtractSearch(extract, "textbook arithmetic", "CS Textbook")).toBe(true);
    // HTML tag names should not match
    expect(matchesExtractSearch(extract, "span", "CS Textbook")).toBe(false);
    expect(matchesExtractSearch(extract, "quantum", "CS Textbook")).toBe(false);
  });

  it("matches video extracts across title, transcript, notes, tags, and document title", () => {
    const videoExtract = {
      title: "Memory hierarchy",
      transcript_text: "L1 cache is much faster than main DRAM",
      notes: "Review latency numbers",
      tags: ["systems"],
      document_title: "Computer Architecture Lecture",
    };

    expect(matchesVideoExtractSearch(videoExtract, "dram cache")).toBe(true);
    expect(matchesVideoExtractSearch(videoExtract, "systems latency")).toBe(true);
    expect(matchesVideoExtractSearch(videoExtract, "architecture hierarchy")).toBe(true);
    expect(matchesVideoExtractSearch(videoExtract, "networking")).toBe(false);
  });
});
