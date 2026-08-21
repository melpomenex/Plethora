/**
 * Anchored spoken-word highlighting tests: exact occurrence resolution (no
 * globally-first match), pdf-word data-w lookup, approximate-timing variant,
 * and chunk-level fallback on resolution failure.
 */

import { describe, expect, it } from "vitest";
import { WordHighlighter } from "../wordHighlighter";
import { ReaderSpeechIndex } from "../readerSpeechIndex";
import type { TTSChunk } from "../readerSpeechIndex";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function chunkFor(root: HTMLElement, surface: string, pickWord: (c: TTSChunk) => number) {
  const text = (root.textContent ?? "").replace(/\s+/g, " ").trim();
  const index = new ReaderSpeechIndex([
    {
      key: "doc",
      text,
      anchorAt: (offset) => ({ kind: "text", surface, startOffset: offset }),
    },
  ]);
  const chunk = index.chunks[0];
  return { index, chunk, wordIndex: pickWord(chunk), text };
}

describe("WordHighlighter.highlightAnchoredWord", () => {
  it("highlights the requested occurrence of a duplicated sentence, never the first", () => {
    const root = mount(
      "<p>The same quoted line appears here.</p><p>Other text in between.</p><p>The same quoted line appears here.</p>",
    );
    const { chunk } = chunkFor(root, "test", (c) => {
      // "quoted" in the LAST paragraph.
      const idx = c.words.findIndex((w, i) => w.text === "quoted" && i > 8);
      return idx;
    });
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);
    const ok = hl.highlightAnchoredWord(chunk, chunk.words.findIndex((w, i) => w.text === "quoted" && i > 8));
    expect(ok).toBe(true);
    const marks = root.querySelectorAll(".tts-word-highlight");
    expect(marks.length).toBe(1);
    // The highlighted word must be inside the LAST paragraph.
    const paragraphs = Array.from(root.querySelectorAll("p"));
    const owner = marks[0].closest("p");
    expect(owner).toBe(paragraphs[2]);
    root.remove();
  });

  it("resolves pdf-word anchors via [data-w] (reflow)", () => {
    const root = mount("<p><span data-w='p3:w7'>target</span> words around</p>");
    const chunk: TTSChunk = {
      index: 0,
      text: "target words around",
      words: [
        { text: "target", anchor: { kind: "pdf-word", wordId: "p3:w7" }, normStart: 0, normEnd: 6, sectionOffset: 0 },
      ],
      sectionKey: "page:3",
    };
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);
    expect(hl.highlightAnchoredWord(chunk, 0)).toBe(true);
    const marks = root.querySelectorAll(".tts-word-highlight");
    expect(marks.length).toBe(1);
    // The highlight wraps the word's text inside the [data-w] span.
    expect(marks[0].closest("[data-w]")?.getAttribute("data-w")).toBe("p3:w7");
    root.remove();
  });

  it("renders synthesized timing with the approximate variant class", () => {
    const root = mount("<p>approximate word here</p>");
    const { chunk } = chunkFor(root, "test", () => 0);
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);
    expect(hl.highlightAnchoredWord(chunk, 0, true)).toBe(true);
    expect(root.querySelector(".tts-word-highlight--approx")).not.toBeNull();
    root.remove();
  });

  it("falls back to a constrained chunk-level highlight on resolution failure", () => {
    const root = mount("<p>some words</p>");
    // Offset past the section length: unresolvable ordinal.
    const chunk: TTSChunk = {
      index: 0,
      text: "words",
      words: [{ text: "ghost", anchor: null, normStart: 0, normEnd: 5, sectionOffset: 9999 }],
      sectionKey: "doc",
    };
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);
    const ok = hl.highlightAnchoredWord(chunk, 0);
    expect(ok).toBe(false);
    // Chunk-level fallback applied.
    expect(root.querySelectorAll(".tts-chunk-highlight").length).toBeGreaterThan(0);
    root.remove();
  });
});

/**
 * Regression tests for the IndexedText cache: clear()/normalize() destroys
 * Text-node identity while the `${childNodes.length}:${textContent.length}`
 * signature stays identical, so the old code reused detached node references
 * and silently applied zero highlight ranges. The cache must invalidate after
 * DOM mutations and always resolve against connected Text nodes.
 */
describe("WordHighlighter IndexedText cache invalidation", () => {
  it("re-indexes after a clear/normalize cycle so repeated highlights keep working", () => {
    const root = mount("<p>alpha bravo charlie delta echo foxtrot</p>");
    const { chunk } = chunkFor(root, "test", () => 2); // "charlie"
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);

    expect(hl.highlightAnchoredWord(chunk, 2)).toBe(true);
    expect(root.querySelectorAll(".tts-word-highlight").length).toBe(1);

    // Second cycle: clear() replaces the span with a text node and normalizes
    // the parent, destroying the previously indexed Text nodes.
    expect(hl.highlightAnchoredWord(chunk, 2)).toBe(true);
    const marks = root.querySelectorAll(".tts-word-highlight");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("charlie");
    expect(marks[0].isConnected).toBe(true);
    root.remove();
  });

  it("discards cached nodes detached by external DOM mutation with an unchanged signature", () => {
    // Whitespace text node between paragraphs keeps word boundaries intact.
    const root = mount("<p>alpha bravo charlie</p> <p>second paragraph text here</p>");
    const { chunk } = chunkFor(root, "test", () => 2); // "charlie"
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);
    expect(hl.highlightAnchoredWord(chunk, 2)).toBe(true);
    hl.clear();

    // External rewrite keeps the container's childCount:textLength signature
    // identical but orphans every previously indexed Text node.
    const firstParagraph = root.querySelectorAll("p")[0];
    firstParagraph.innerHTML = firstParagraph.textContent ?? "";

    expect(hl.highlightAnchoredWord(chunk, 2)).toBe(true);
    const marks = root.querySelectorAll(".tts-word-highlight");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("charlie");
    expect(marks[0].isConnected).toBe(true);
    root.remove();
  });

  it("never applies ranges onto disconnected text nodes across rapid cycles", () => {
    const root = mount("<p>one two three four five six seven eight nine ten</p>");
    const { chunk } = chunkFor(root, "test", () => 9); // "ten"
    const hl = new WordHighlighter();
    hl.init(root);
    hl.setEnabled(true);

    for (let cycle = 0; cycle < 5; cycle += 1) {
      expect(hl.highlightAnchoredWord(chunk, 9)).toBe(true);
      const marks = root.querySelectorAll(".tts-word-highlight");
      expect(marks.length).toBe(1);
      expect(marks[0].isConnected).toBe(true);
      expect(marks[0].textContent).toBe("ten");
      hl.clear();
      expect(root.querySelectorAll(".tts-word-highlight").length).toBe(0);
    }
    root.remove();
  });
});
