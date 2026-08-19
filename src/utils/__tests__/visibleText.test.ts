/**
 * jsdom tests for deterministic first-visible-word resolution with mocked
 * rects: mid-paragraph viewports, sliver rejection, iframe translation, and
 * the textContent offset mapper.
 */

import { describe, expect, it } from "vitest";
import {
  buildTextContentOffsetMapper,
  findFirstVisibleWord,
  flatOffsetOfWord,
} from "../visibleText";

function mount(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = "<p>first paragraph words here</p><p>second paragraph more words follow</p>";
  document.body.appendChild(root);
  return root;
}

function rect(top: number, height: number, left = 0, width = 100) {
  return { top, bottom: top + height, left, right: left + width, width, height } as DOMRect;
}

/** Rect source keyed by word text (a word's rect is derived from its text). */
function rectByWord(lineTops: Array<{ line: string; top: number; height: number }>) {
  return (range: Range) => {
    const text = range.toString();
    for (const entry of lineTops) {
      if (entry.line.split(/\s+/).includes(text)) {
        return rect(entry.top, entry.height);
      }
    }
    return rect(0, 0);
  };
}

describe("findFirstVisibleWord", () => {
  it("starts mid-paragraph: skips the clipped line, starts on the first sufficiently visible one", () => {
    const root = mount();
    const word = findFirstVisibleWord(root, {
      getRect: rectByWord([
        { line: "first paragraph words here", top: -18, height: 20 },
        { line: "second paragraph more words follow", top: 2, height: 20 },
      ]),
      viewport: { top: 0, bottom: 800 },
      getBlockRect: () => rect(0, 800),
    });
    expect(word?.node.textContent?.slice(word!.start, word!.end)).toBe("second");
    root.remove();
  });

  it("a one-pixel sliver never qualifies; resolution continues to the next line", () => {
    const root = mount();
    const word = findFirstVisibleWord(root, {
      getRect: rectByWord([
        { line: "first paragraph words here", top: -19.5, height: 20 },
        { line: "second paragraph more words follow", top: 5, height: 20 },
      ]),
      viewport: { top: 0, bottom: 800 },
      getBlockRect: () => rect(0, 800),
    });
    expect(word?.node.textContent?.slice(word!.start, word!.end)).toBe("second");
    root.remove();
  });

  it("fully visible first line wins top-down and stops at the first hit", () => {
    const root = mount();
    const word = findFirstVisibleWord(root, {
      getRect: rectByWord([
        { line: "first paragraph words here", top: 4, height: 20 },
        { line: "second paragraph more words follow", top: 30, height: 20 },
      ]),
      viewport: { top: 0, bottom: 800 },
      getBlockRect: () => rect(0, 800),
    });
    expect(word?.node.textContent?.slice(word!.start, word!.end)).toBe("first");
    root.remove();
  });

  it("translates iframe-local rects through the frame offset", () => {
    const root = mount();
    const word = findFirstVisibleWord(root, {
      getRect: rectByWord([{ line: "first paragraph words here", top: 0, height: 20 }]),
      translateRect: (r) =>
        new DOMRect(r.left, r.top + 500, r.width, r.height),
      viewport: { top: 490, bottom: 1300 },
      getBlockRect: () => rect(490, 800),
    });
    expect(word).not.toBeNull();
    expect(word!.node.textContent?.slice(word!.start, word!.end)).toBe("first");
    root.remove();
  });

  it("paragraphs outside the viewport are pre-rejected", () => {
    const root = mount();
    // All words above the viewport; nothing qualifies.
    const word = findFirstVisibleWord(root, {
      getRect: rectByWord([
        { line: "first paragraph words here", top: -200, height: 20 },
        { line: "second paragraph more words follow", top: -100, height: 20 },
      ]),
      viewport: { top: 0, bottom: 800 },
      getBlockRect: () => rect(0, 800),
    });
    expect(word).toBeNull();
    root.remove();
  });
});

describe("flatOffsetOfWord + buildTextContentOffsetMapper", () => {
  it("flat offsets count skipped/whitespace nodes; mapper converts flat → normalized", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<p>one  two</p><span aria-hidden='true'>hidden ignorable</span><p>three   four</p>";
    document.body.appendChild(root);

    const word = findFirstVisibleWord(root, {
      getRect: (range) => (range.toString() === "three" ? rect(10, 20) : rect(-100, 20)),
      viewport: { top: 0, bottom: 800 },
      getBlockRect: () => rect(0, 800),
    });
    expect(word).not.toBeNull();
    const flat = flatOffsetOfWord(root, word!);
    // "one  two" (8) + "hidden ignorable" (16) = 24 → "three" starts at flat 24.
    expect(flat).toBe(24);

    const mapper = buildTextContentOffsetMapper(root);
    expect(mapper.normalized).toBe("one two hidden ignorable three four");
    // Flat 24 → normalized offset of "three" = 25 ("one two hidden ignorable ").
    expect(mapper.flatToNorm(flat)).toBe(25);
    root.remove();
  });
});
