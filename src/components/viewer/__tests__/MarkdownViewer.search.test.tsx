import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Document as DocType } from "../../../types";
import { MarkdownViewer } from "../MarkdownViewer";

/**
 * Reader search teardown regression tests (issue #44 bug 06): clearing the
 * in-document search must restore a pristine DOM — no leftover marks, no
 * nested marks on re-search, no marks baked into later highlight baselines —
 * and selections made in surviving text must stay live for AI actions.
 */

const baseDocument = {
  id: "doc-search-teardown",
  title: "Search Teardown Doc",
  file_path: "/tmp/search-teardown.md",
  file_type: "markdown",
  collection_id: "00000000-0000-0000-0000-000000000001",
} as unknown as DocType;

const CONTENT = [
  "# Title",
  "",
  "The quick brown fox jumps over the lazy dog.",
  "",
  "A second paragraph about the fox again.",
].join("\n");

function renderViewer(props: Record<string, unknown> = {}) {
  return render(
    <MarkdownViewer
      document={baseDocument}
      content={CONTENT}
      {...props}
    />
  );
}

const marksIn = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("mark[data-search-highlight='true']"));

describe("MarkdownViewer search teardown", () => {
  it("clearing the search removes every highlight mark", () => {
    const { container, rerender } = renderViewer({ searchQuery: "fox" });
    expect(marksIn(container).length).toBe(2);

    rerender(
      <MarkdownViewer document={baseDocument} content={CONTENT} searchQuery="" />
    );
    expect(marksIn(container).length).toBe(0);
    // The content text itself is unharmed.
    expect(container.textContent).toContain("quick brown fox");
  });

  it("a second search never nests marks inside marks", () => {
    const { container, rerender } = renderViewer({ searchQuery: "fox" });
    expect(marksIn(container).length).toBe(2);

    rerender(
      <MarkdownViewer document={baseDocument} content={CONTENT} searchQuery="paragraph" />
    );
    const marks = marksIn(container);
    expect(marks.length).toBe(1);
    // Exactly one wrapper per match: no mark contains another mark and no
    // match text survives unwrapped inside another mark's subtree.
    expect(container.querySelectorAll("mark[data-search-highlight] mark").length).toBe(0);
    expect(marks[0].textContent).toBe("paragraph");
  });

  it("a persistent highlight created after a cleared search operates on mark-free content", () => {
    const { container, rerender } = renderViewer({ searchQuery: "fox" });
    expect(marksIn(container).length).toBe(2);

    rerender(
      <MarkdownViewer document={baseDocument} content={CONTENT} searchQuery="" />
    );
    expect(marksIn(container).length).toBe(0);

    // Now apply a persistent (extract) highlight — it must wrap plain text,
    // and no search mark may reappear in the resulting baseline.
    rerender(
      <MarkdownViewer
        document={baseDocument}
        content={CONTENT}
        searchQuery=""
        highlights={[{ id: "hl-1", startOffset: 0, endOffset: 9 }]}
      />
    );
    expect(marksIn(container).length).toBe(0);
    expect(
      container.querySelectorAll("mark[data-highlight-wrapper='true']").length
    ).toBeGreaterThan(0);
    // The persisted highlight's text is real content, not a search mark.
    const wrapper = container.querySelector("mark[data-highlight-wrapper='true']");
    expect(wrapper?.textContent).not.toContain("fox jumps");
  });

  it("a selection anchored in surviving text survives the teardown unwrap", () => {
    const { container, rerender } = renderViewer({ searchQuery: "fox" });
    expect(marksIn(container).length).toBe(2);

    // The content heading — a node the search never touched. (The viewer also
    // renders a document-title header, so scope by text.)
    const heading = Array.from(container.querySelectorAll("h1")).find(
      (h) => h.textContent === "Title"
    )!;
    const textNodeBefore = heading.firstChild;
    expect(textNodeBefore?.nodeType).toBe(Node.TEXT_NODE);

    // Clearing the search unwraps marks surgically. jsdom collapses live
    // Ranges on unrelated DOM mutations (real browsers do not), so the
    // jsdom-stable form of "the selection's anchor survived" is that the
    // anchored text node itself is never replaced — the destructive
    // innerHTML reset this guards against is what destroyed selections.
    rerender(
      <MarkdownViewer document={baseDocument} content={CONTENT} searchQuery="" />
    );
    expect(marksIn(container).length).toBe(0);
    expect(heading.firstChild).toBe(textNodeBefore);
    expect(heading.textContent).toBe("Title");
  });

  it("reports a fresh selection (the AI-action input) immediately after clear", () => {
    const onSelectionChange = vi.fn();
    const { container, rerender } = renderViewer({
      searchQuery: "fox",
      onSelectionChange,
    });

    rerender(
      <MarkdownViewer
        document={baseDocument}
        content={CONTENT}
        searchQuery=""
        onSelectionChange={onSelectionChange}
      />
    );
    expect(marksIn(container).length).toBe(0);

    // A fresh selection in mark-free content is published to the consumer
    // that selection-dependent AI actions (Explain/Summarize/Simplify) read.
    const paragraph = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("lazy dog")
    )!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection?.removeAllRanges();
    selection?.addRange(range);
    paragraph.dispatchEvent(new Event("mouseup", { bubbles: true }));

    expect(onSelectionChange).toHaveBeenCalled();
    const lastCall = onSelectionChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("lazy dog");
    selection?.removeAllRanges();
  });
});
