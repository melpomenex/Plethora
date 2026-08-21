import { beforeEach, describe, expect, it, vi } from "vitest";
import { WordHighlighter } from "../wordHighlighter";
import type { TTSChunk } from "../readerSpeechIndex";

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

  // Regression: WordHighlighter used to run its own legacy auto-scroll
  // (findScrollableContainer + scrollTo/scrollIntoView), colliding with the
  // authoritative useSpokenWordFollow controller on mobile WebView. The
  // highlighter must be highlight-only — never issue viewport commands.
  it("never dispatches scrollTo or scrollIntoView when applying highlights", () => {
    document.body.innerHTML = `<div id="root"><p>The quick brown fox jumps over the lazy dog.</p></div>`;
    const root = document.getElementById("root") as HTMLElement;
    const scrollToSpy = vi.fn();
    root.scrollTo = scrollToSpy;
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    const chunk: TTSChunk = {
      index: 0,
      text: "The quick brown fox jumps over the lazy dog.",
      words: [
        { text: "fox", anchor: null, normStart: 16, normEnd: 19, sectionOffset: 16 },
      ],
      sectionKey: "doc",
    };

    const highlighter = new WordHighlighter();
    highlighter.init(root);
    highlighter.setEnabled(true);

    highlighter.highlightWord(chunk.text, 3);
    highlighter.highlightChunk(chunk.text);
    highlighter.highlightAnchoredWord(chunk, 0);

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(root.querySelector(".tts-word-highlight, .tts-chunk-highlight")).not.toBeNull();
  });
});
