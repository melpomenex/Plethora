import { beforeEach, describe, expect, it } from "vitest";
import {
  ANCHOR_CONTEXT_CHARS,
  buildContainerSelector,
  captureSelectionAnchor,
  findQuoteRange,
  nearestSectionHeading,
  wrapRangeTextWithMark,
} from "../selectionAnchors";
import {
  applyAnchoredTextHighlights,
  buildIframeTextSelectionContext,
  buildTextSelectionContext,
} from "../textHighlights";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  // Highlight painting skips disconnected nodes — keep the root attached.
  document.body.appendChild(root);
});

function selectBetween(startMarker: string, endMarker: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let start: { node: Text; offset: number } | null = null;
  let end: { node: Text; offset: number } | null = null;
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const content = text.textContent ?? "";
    const s = content.indexOf(startMarker);
    if (s !== -1 && !start) start = { node: text, offset: s };
    const e = content.indexOf(endMarker) + endMarker.length;
    if (content.includes(endMarker) && !end) end = { node: text, offset: e };
    current = walker.nextNode();
  }
  if (!start || !end) throw new Error(`markers not found: ${startMarker} / ${endMarker}`);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

describe("captureSelectionAnchor (via buildTextSelectionContext)", () => {
  it("captures exact text with bounded prefix and suffix context", () => {
    root.innerHTML = `<p>${"alpha ".repeat(40)}TARGET QUOTE${" omega".repeat(40)}</p>`;
    const range = selectBetween("TARGET", "QUOTE");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    expect(ctx).not.toBeNull();
    expect(ctx?.anchor?.textQuote.exact).toBe("TARGET QUOTE");
    expect(ctx?.anchor?.textQuote.prefix.length).toBeLessThanOrEqual(ANCHOR_CONTEXT_CHARS);
    expect(ctx?.anchor?.textQuote.prefix.trimEnd().endsWith("alpha")).toBe(true);
    expect(ctx?.anchor?.textQuote.suffix.trimStart().startsWith("omega")).toBe(true);
    expect(ctx?.anchor?.textQuote.suffix.length).toBeLessThanOrEqual(ANCHOR_CONTEXT_CHARS);
    // Offsets remain the fast path alongside the anchor.
    expect(ctx?.startOffset).toBeGreaterThan(0);
    expect(ctx?.endOffset).toBeGreaterThan((ctx?.startOffset ?? 0));
  });

  it("captures multi-paragraph selections spanning inline links", () => {
    root.innerHTML = `
      <article class="inc-article"><div class="inc-body">
        <p>First paragraph with <a href="https://example.com">an inline link</a> inside.</p>
        <p>Second paragraph content.</p>
        <p>Third paragraph tail.</p>
      </div></article>`;
    const range = selectBetween("inline link", "Second paragraph content.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    expect(ctx?.selectedText).toContain("inline link");
    expect(ctx?.selectedText).toContain("Second paragraph content.");
    expect(ctx?.anchor?.textQuote.exact.replace(/\s+/g, " ")).toContain("inline link inside");
  });

  it("captures a container selector rooted below the root element", () => {
    root.innerHTML = `<article><div><p>Some selectable sentence here.</p><p>Other.</p></div></article>`;
    const range = selectBetween("Some selectable", "sentence here.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    expect(ctx?.anchor?.selector).toMatch(/^article > div > p(:nth-of-type\(1\))?$/);
  });

  it("records the nearest preceding section heading", () => {
    root.innerHTML = `
      <h2>Methods</h2>
      <p>Participants were recruited.</p>
      <h3>Results</h3>
      <p>The measurements agreed.</p>`;
    const range = selectBetween("measurements", "agreed.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    expect(ctx?.anchor?.sectionHeading).toBe("Results");
  });

  it("handles unicode and RTL text", () => {
    root.innerHTML = `<p dir="rtl">משפט ראשון בעברית. משפט שני לבחירה. משפט שלישי.</p>`;
    const range = selectBetween("משפט שני", "לבחירה.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    expect(ctx?.selectedText).toContain("משפט שני לבחירה.");
    expect(ctx?.anchor?.textQuote.exact).toContain("לבחירה");

    root.innerHTML = `<p>Preceding 字符 context. 選択された日本語のテキスト。 Trailing 字符 context.</p>`;
    const jp = selectBetween("選択された", "テキスト。");
    const jpCtx = buildTextSelectionContext({ root, range: jp, documentId: "d1", surface: "html" });
    expect(jpCtx?.anchor?.textQuote.exact).toBe("選択された日本語のテキスト。");
  });
});

describe("findQuoteRange", () => {
  it("resolves an anchor back to the exact range after regeneration", () => {
    root.innerHTML = `<p>Prefix words. The durable quote target. Suffix words.</p>`;
    const range = selectBetween("The durable", "target.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    const anchor = ctx!.anchor!;

    // Simulated regeneration: different markup, whitespace, extra wrapper.
    root.innerHTML = `<section><p>Prefix words.</p><p>The durable quote   target. Suffix words.</p></section>`;
    const resolved = findQuoteRange(root, anchor);
    expect(resolved).not.toBeNull();
    expect(resolved!.toString().replace(/\s+/g, " ")).toBe("The durable quote target.");
  });

  it("prefers context-confirmed occurrences when the quote repeats", () => {
    root.innerHTML = `<p>alpha repeat me beta</p><p>gamma repeat me delta</p>`;
    const range = selectBetween("repeat me", "repeat me");
    range.setEnd(range.endContainer, range.endOffset); // first occurrence only
    const first = root.getElementsByTagName("p")[0]!.firstChild!;
    range.setStart(first, 6);
    range.setEnd(first, 15);
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    const anchor = ctx!.anchor!;

    const resolved = findQuoteRange(root, anchor);
    expect(resolved).not.toBeNull();
    expect(resolved!.toString()).toBe("repeat me");
    expect(resolved!.startContainer).toBe(first);
  });

  it("returns null for ambiguous bare matches without disambiguating context", () => {
    const anchor = {
      textQuote: { exact: "repeat me", prefix: "", suffix: "" },
    };
    root.innerHTML = `<p>repeat me one</p><p>repeat me two</p>`;
    expect(findQuoteRange(root, anchor)).toBeNull();
  });

  it("returns null when the quote no longer exists", () => {
    const anchor = { textQuote: { exact: "vanished text", prefix: "p", suffix: "s" } };
    root.innerHTML = `<p>totally different content now</p>`;
    expect(findQuoteRange(root, anchor)).toBeNull();
  });
});

describe("selector and heading helpers", () => {
  it("builds nth-of-type selectors only among same-tag siblings", () => {
    root.innerHTML = `<div><p>one</p><h3>mid</h3><p>two</p></div>`;
    const second = root.querySelectorAll("p")[1]!;
    expect(buildContainerSelector(second, root)).toBe("div > p:nth-of-type(2)");
    expect(buildContainerSelector(root, root)).toBeUndefined();
  });

  it("nearestSectionHeading returns undefined without preceding headings", () => {
    root.innerHTML = `<p>no headings at all</p>`;
    const p = root.querySelector("p")!;
    expect(nearestSectionHeading(p, root)).toBeUndefined();
  });
});

describe("highlight repaint fallback (task 4.2)", () => {
  it("repaints at the quote-resolved position after re-import shifts the offsets", () => {
    root.innerHTML = `<p>Original intro text. The durable passage target lives here. Outro.</p>`;
    const range = selectBetween("The durable", "here.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });

    // Re-import: prepended content shifts every offset; the anchor repairs.
    root.innerHTML = `<p>Brand new lead paragraph added by re-import.</p><p>Original intro text. The durable passage target lives here. Outro.</p>`;
    applyAnchoredTextHighlights({
      root,
      highlights: [
        {
          id: "hl-1",
          // Stale offsets point into the wrong region of the new content.
          startOffset: ctx!.startOffset,
          endOffset: ctx!.endOffset,
          color: "yellow",
          anchor: ctx!.anchor,
        },
      ],
      signature: "sig-after-reimport",
    });
    const marks = root.querySelectorAll("mark[data-highlight-wrapper='true']");
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe("The durable passage target lives here.");
    expect(marks[0]!.closest("p")).toBe(root.querySelectorAll("p")[1]);
  });

  it("skips an ambiguous anchor without blocking the remaining highlights", () => {
    root.innerHTML = `<p>alpha duplicated phrase beta</p><p>gamma duplicated phrase delta</p><p>unique tail sentence.</p>`;
    const unique = selectBetween("unique tail", "sentence.");
    const uniqueCtx = buildTextSelectionContext({ root, range: unique, documentId: "d1", surface: "html" });

    applyAnchoredTextHighlights({
      root,
      highlights: [
        {
          id: "hl-ambiguous",
          startOffset: 6,
          endOffset: 25,
          color: "yellow",
          // Repeats twice with no disambiguating context → must be skipped.
          anchor: { textQuote: { exact: "duplicated phrase", prefix: "", suffix: "" } },
        },
        {
          id: "hl-unique",
          startOffset: uniqueCtx!.startOffset,
          endOffset: uniqueCtx!.endOffset,
          color: "green",
          anchor: uniqueCtx!.anchor,
        },
      ],
      signature: "sig-2",
    });
    const marks = [...root.querySelectorAll<HTMLElement>("mark[data-highlight-wrapper='true']")];
    expect(marks.map((m) => m.dataset.highlightId)).toEqual(["hl-unique"]);
    expect(marks[0]!.textContent).toBe("unique tail sentence.");
  });
});

describe("wrapRangeTextWithMark (viewer jump marking)", () => {
  it("marks a multi-paragraph range with one mark per text portion and returns the first", () => {
    root.innerHTML = `<p>first paragraph start</p><p>second paragraph end tail</p>`;
    const range = selectBetween("start", "end tail");
    const first = wrapRangeTextWithMark(range, (owner) => {
      const mark = owner.createElement("mark");
      mark.setAttribute("data-search-highlight", "true");
      return mark;
    });
    const marks = [...root.querySelectorAll("mark[data-search-highlight='true']")];
    expect(marks.length).toBe(2);
    expect(marks[0]!.textContent).toBe("start");
    expect(marks[1]!.textContent).toBe("second paragraph end tail");
    expect(first).toBe(marks[0]);
    // No text is lost or reordered by the wrapping (element boundaries do
    // not contribute whitespace to textContent).
    expect(root.textContent).toBe("first paragraph startsecond paragraph end tail");
  });
});

describe("desktop right-click provenance (task 2.3)", () => {
  it("buildIframeTextSelectionContext carries offsets + anchor from a live iframe selection", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = `<article class="inc-article"><div class="inc-body"><p>The quotable sentence.</p></div></article>`;
    const textNode = doc.querySelector("p")!.firstChild!;
    const range = doc.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 22);
    const sel = iframe.contentWindow!.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const context = buildIframeTextSelectionContext({
      win: iframe.contentWindow,
      doc,
      documentId: "doc-1",
      surface: "html",
    });
    // The context-menu path forwards exactly this instead of null.
    expect(context).not.toBeNull();
    expect(context!.type).toBe("text");
    expect(context!.surface).toBe("html");
    expect(context!.selectedText).toBe("quotable sentence.");
    expect(context!.startOffset).toBe(4);
    expect(context!.endOffset).toBe(22);
    expect(context!.anchor?.textQuote.exact).toBe("quotable sentence.");

    // Collapsed/empty selections return null — menu opens without offsets.
    sel.removeAllRanges();
    expect(
      buildIframeTextSelectionContext({ win: iframe.contentWindow, doc, documentId: "doc-1", surface: "html" }),
    ).toBeNull();
  });

  it("a highlight created from the right-click context repaints after document reopen", () => {
    root.innerHTML = `<article class="inc-article"><div class="inc-body"><p>Persist this highlighted passage exactly.</p></div></article>`;
    const range = selectBetween("Persist this", "exactly.");
    const ctx = buildTextSelectionContext({ root, range, documentId: "d1", surface: "html" });
    expect(ctx).not.toBeNull();

    // "Reopen": fresh DOM, same content signature — offsets still apply.
    const reopen = () => {
      root.innerHTML = `<article class="inc-article"><div class="inc-body"><p>Persist this highlighted passage exactly.</p></div></article>`;
      applyAnchoredTextHighlights({
        root,
        highlights: [
          {
            id: "hl-1",
            startOffset: ctx!.startOffset,
            endOffset: ctx!.endOffset,
            color: "yellow",
            anchor: ctx!.anchor,
          },
        ],
        signature: "sig-1",
      });
    };
    reopen();
    const mark = root.querySelector("mark[data-highlight-wrapper='true']");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Persist this highlighted passage exactly.");
  });
});
