import { describe, expect, it } from "vitest";
import { renderMarkdown, hasMarkdownMarkup } from "../markdown";
import { indentContent, outdentContent } from "../../components/extracts/ExtractContentEditor";

describe("Issue #6 Rich-Text & Math Rendering (BUG-01, BUG-02, BUG-18)", () => {
  it("BUG-01: renders nested unordered and ordered lists without flattening", () => {
    const md = [
      "- Exanthematous Eruptions",
      "  - Simple Eruptions",
      "    - Morbilliform",
      "• Bullet item",
      "  • Nested bullet item",
      "1. First step",
      "  1. Sub-step",
    ].join("\n");

    const html = renderMarkdown(md);
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
    // Nested <ul> inside <li>
    expect(html.match(/<ul\b/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Exanthematous Eruptions");
    expect(html).toContain("Simple Eruptions");
    expect(html).toContain("Nested bullet item");
    expect(html).toContain("Sub-step");
    expect(hasMarkdownMarkup("• Bullet item")).toBe(true);
  });

  it("BUG-02: indentContent and outdentContent handle mid-line caret and trailing-newline selections", () => {
    const text = "alpha\nbeta";
    // Caret in the middle of "alpha" (index 2)
    const indented = indentContent(text, 2, 2);
    expect(indented.text).toBe("  alpha\nbeta");
    expect(indented.start).toBe(4);
    expect(indented.end).toBe(4);

    const outdented = outdentContent(indented.text, 4, 4);
    expect(outdented.text).toBe("alpha\nbeta");
    expect(outdented.start).toBe(2);

    // Multiline selection ending at '\n' after first line only indents first line
    const multi = indentContent("one\ntwo\nthree", 0, 4);
    expect(multi.text).toBe("  one\ntwo\nthree");
    expect(multi.end).toBe(6);
  });

  it("BUG-18: does not parse currency amounts as LaTeX math", () => {
    const prose =
      "You put **$5,000** into buying the motel, and you have $15,000 left over ($10 - $20 range).";
    const html = renderMarkdown(prose);
    expect(html).not.toContain("katex");
    expect(html).toContain("$5,000");
    expect(html).toContain("$15,000");
    expect(html).toContain("$10 - $20");
  });

  it("BUG-18: renders inline math, matrices with &, and inequalities without HTML entity or italic mangling", () => {
    const math = [
      "Simple variable $x$ and function $f(x) = x^2 + y_1$.",
      "",
      "$$",
      "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
      "$$",
      "",
      "Inequality $a < b$ and $x_1 * x_2$.",
    ].join("\n");
    const html = renderMarkdown(math);
    expect(html).toContain("katex");
    expect(html).toContain("<mtable");
    expect(html).not.toContain("katex-error");
    expect(html).not.toContain("<em>");
  });
});
