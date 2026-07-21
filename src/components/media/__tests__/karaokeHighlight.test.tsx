/**
 * Rendering tests for karaoke-style word highlighting in the transcript panel.
 *
 * These cover the contract the UI actually depends on: exactly one word is
 * marked at a time, it advances with playback, measured and estimated timings
 * are visually distinguishable, and misaligned data degrades to plain text
 * rather than highlighting the wrong word.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KaraokeText } from "../KaraokeText";
import { TranscriptSync, type TranscriptSegment } from "../TranscriptSync";
import type { WordTiming } from "../../../utils/wordTimings";

const TIMINGS: WordTiming[] = [
  { word: "the", start_ms: 0, end_ms: 300 },
  { word: "quick", start_ms: 300, end_ms: 900 },
  { word: "fox", start_ms: 900, end_ms: 1500 },
];

// jsdom has no layout engine and so no Element.scrollTo; the panel calls it
// when it follows the active segment.
beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

/** The single word currently marked as spoken, or null if none is. */
function highlightedWord(container: HTMLElement): string | null {
  const marked = container.querySelectorAll("[data-karaoke-word='active']");
  if (marked.length === 0) return null;
  if (marked.length > 1) throw new Error(`expected one highlight, got ${marked.length}`);
  return marked[0].textContent;
}

/** The class list of the marked word, for style-distinction assertions. */
function highlightClass(container: HTMLElement): string {
  return container.querySelector("[data-karaoke-word='active']")!.className;
}

describe("KaraokeText", () => {
  it("highlights the word being spoken and advances with the clock", () => {
    const { container, rerender } = render(
      <KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={0.1} isActive />,
    );
    expect(highlightedWord(container)).toBe("the");

    rerender(<KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={0.5} isActive />);
    expect(highlightedWord(container)).toBe("quick");

    rerender(<KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={1.2} isActive />);
    expect(highlightedWord(container)).toBe("fox");
  });

  it("renders the full text regardless of which word is lit", () => {
    const { container } = render(
      <KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={0.5} isActive />,
    );
    expect(container.textContent).toBe("the quick fox");
  });

  it("preserves original whitespace between words", () => {
    const text = "the  quick\nfox";
    const { container } = render(
      <KaraokeText text={text} wordTimings={TIMINGS} currentTime={0.5} isActive />,
    );
    expect(container.textContent).toBe(text);
  });

  it("highlights nothing on inactive segments", () => {
    const { container } = render(
      <KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={0.5} isActive={false} />,
    );
    expect(highlightedWord(container)).toBeNull();
    expect(container.textContent).toBe("the quick fox");
  });

  it("falls back to plain text when timings do not align with the text", () => {
    // Three timings, four words — matching is positional, so highlighting here
    // would light the wrong word for the rest of the segment.
    const { container } = render(
      <KaraokeText text="the quick brown fox" wordTimings={TIMINGS} currentTime={0.5} isActive />,
    );
    expect(highlightedWord(container)).toBeNull();
    expect(container.textContent).toBe("the quick brown fox");
  });

  it("uses a distinct, softer style for approximate timings", () => {
    const { container: exact } = render(
      <KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={0.5} isActive />,
    );
    const { container: approx } = render(
      <KaraokeText text="the quick fox" wordTimings={TIMINGS} currentTime={0.5} isActive approximate />,
    );
    const exactClass = highlightClass(exact);
    const approxClass = highlightClass(approx);
    expect(exactClass).not.toBe(approxClass);
    // Measured timings are asserted confidently (bold); estimates are not.
    expect(exactClass).toContain("font-bold");
    expect(approxClass).not.toContain("font-bold");
  });

  it("composes with a caller-supplied token renderer (e.g. search marks)", () => {
    const { container } = render(
      <KaraokeText
        text="the quick fox"
        wordTimings={TIMINGS}
        currentTime={0.5}
        isActive
        renderToken={(token) => (token === "quick" ? <mark>{token}</mark> : token)}
      />,
    );
    expect(container.querySelector("mark")?.textContent).toBe("quick");
    // The search mark sits *inside* the karaoke span, so both apply at once.
    expect(highlightedWord(container)).toBe("quick");
  });
});

describe("TranscriptSync word highlighting", () => {
  const segments: TranscriptSegment[] = [
    {
      id: "s1",
      start: 0,
      end: 1.5,
      text: "the quick fox",
      wordTimings: TIMINGS,
    },
    {
      id: "s2",
      start: 1.5,
      end: 3,
      text: "jumps over",
      wordTimings: [
        { word: "jumps", start_ms: 1500, end_ms: 2200 },
        { word: "over", start_ms: 2200, end_ms: 3000 },
      ],
    },
  ];

  it("highlights the spoken word inside the active segment only", () => {
    const { container, rerender } = render(
      <TranscriptSync segments={segments} currentTime={0.5} showHeader={false} />,
    );
    expect(highlightedWord(container)).toBe("quick");

    // Crossing into the next segment moves the highlight with it.
    rerender(<TranscriptSync segments={segments} currentTime={2.5} showHeader={false} />);
    expect(highlightedWord(container)).toBe("over");
  });

  it("estimates word timings when the transcript has none", () => {
    // Human-authored caption tracks carry no per-word offsets; the panel spreads
    // the segment's own span across its words and marks the result approximate.
    const noWords: TranscriptSegment[] = [
      { id: "s1", start: 0, end: 3, text: "alpha beta gamma" },
    ];
    const { container } = render(
      <TranscriptSync segments={noWords} currentTime={0.1} showHeader={false} />,
    );
    expect(highlightedWord(container)).toBe("alpha");
    expect(highlightClass(container)).not.toContain("font-bold");
  });

  it("does not highlight words in the static (no playback) reading view", () => {
    // PodcastManager renders the transcript with currentTime={-1}.
    const { container } = render(
      <TranscriptSync segments={segments} currentTime={-1} showHeader={false} />,
    );
    expect(highlightedWord(container)).toBeNull();
  });

  it("keeps segment search highlighting working while a word is lit", () => {
    render(
      <TranscriptSync
        segments={segments}
        currentTime={0.5}
        showHeader={false}
        searchQuery="quick"
      />,
    );
    expect(screen.getByText("quick", { selector: "mark" })).toBeTruthy();
  });
});

describe("TranscriptSync auto-follow", () => {
  const segments: TranscriptSegment[] = [
    { id: "s1", start: 0, end: 2, text: "first line" },
    { id: "s2", start: 2, end: 4, text: "second line" },
    { id: "s3", start: 4, end: 6, text: "third line" },
  ];

  /**
   * jsdom reports zero-sized rects for everything, which the panel reads as
   * "the active line is already comfortably in view" and skips scrolling. Give
   * the scroll container a real viewport and place segments far below it so
   * following is actually required.
   */
  function withLayout() {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const isContainer = this.hasAttribute("data-transcript-scroll");
      const box = isContainer
        ? { top: 0, bottom: 400, height: 400 }
        : { top: 900, bottom: 960, height: 60 };
      return { ...box, left: 0, right: 300, width: 300, x: 0, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    return scrollTo;
  }

  it("scrolls the panel as playback moves into a new segment", async () => {
    const scrollTo = withLayout();
    const { rerender } = render(
      <TranscriptSync segments={segments} currentTime={0.5} showHeader={false} isPlaying />,
    );
    scrollTo.mockClear();

    rerender(
      <TranscriptSync segments={segments} currentTime={2.5} showHeader={false} isPlaying />,
    );

    // The follow is debounced to coalesce rapid cue changes.
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled(), { timeout: 1000 });
    vi.restoreAllMocks();
  });

  it("releases a stale highlight when playback seeks before the active segment", async () => {
    const scrollTo = withLayout();
    const { container, rerender } = render(
      <TranscriptSync segments={segments} currentTime={4.5} showHeader={false} isPlaying />,
    );
    await vi.waitFor(() =>
      expect(container.querySelector("[aria-selected='true']")?.textContent).toContain("third"),
    );

    // Seek back into a gap before the third segment. Holding the old line here
    // is what previously stranded auto-follow on a segment playback had left.
    rerender(
      <TranscriptSync segments={segments} currentTime={-0.5} showHeader={false} isPlaying />,
    );
    await vi.waitFor(() =>
      expect(container.querySelector("[aria-selected='true']")).toBeNull(),
    );
    expect(scrollTo).toBeDefined();
    vi.restoreAllMocks();
  });
});
