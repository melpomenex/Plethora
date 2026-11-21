import { describe, expect, it } from "vitest";
import { markPdfText, pdfTextMatchRanges } from "../pdfTextMarks";

describe("PDF text marks", () => {
  it("keeps literal angle brackets and ampersands in matched and unmatched text", () => {
    const text = "Compare <term> & <category>.";
    const element = document.createElement("span");
    element.textContent = text;

    const count = markPdfText(element, pdfTextMatchRanges(text, /<term>|&/g), "pdf-search-highlight");

    expect(count).toBe(2);
    expect(element.textContent).toBe(text);
    expect(Array.from(element.children, (child) => child.tagName)).toEqual(["MARK", "MARK"]);
    expect(Array.from(element.children, (child) => child.textContent)).toEqual(["<term>", "&"]);
    expect(element.firstElementChild).toHaveClass("pdf-search-highlight");
  });
});
