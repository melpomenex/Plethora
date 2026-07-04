import { beforeEach, describe, expect, it, vi } from "vitest";
import { WordHighlighter } from "../wordHighlighter";

describe("WordHighlighter", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("highlights a spoken word when rendered text is split across nodes and whitespace differs", () => {
    document.body.innerHTML = `
      <div id="root">
        <p>The quick <strong>brown</strong>
        fox jumps over the lazy dog.</p>
      </div>
    `;
    const root = document.getElementById("root") as HTMLElement;
    root.scrollTo = vi.fn();

    const highlighter = new WordHighlighter();
    highlighter.init(root);
    highlighter.setEnabled(true);

    highlighter.highlightWord("The quick brown fox jumps over the lazy dog.", 3);

    const mark = root.querySelector(".tts-word-highlight");
    expect(mark?.textContent).toBe("fox");
  });

  it("keeps a visible highlight when a precise word cannot be mapped", () => {
    document.body.innerHTML = `<div id="root"><p>Intro sentence. A rendered phrase with extra spacing.</p></div>`;
    const root = document.getElementById("root") as HTMLElement;
    root.scrollTo = vi.fn();

    const highlighter = new WordHighlighter();
    highlighter.init(root);
    highlighter.setEnabled(true);

    highlighter.highlightWord("A rendered phrase that differs from the source.", 4);

    expect(root.querySelector(".tts-word-highlight, .tts-chunk-highlight")?.textContent).toBeTruthy();
  });
});
