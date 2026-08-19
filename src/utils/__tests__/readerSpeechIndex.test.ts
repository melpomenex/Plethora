/**
 * Unit tests for the anchored speech index (`src/utils/readerSpeechIndex.ts`):
 * build/locate round-trips per anchor kind, mid-chunk slicing, page-marker
 * stripping with page tables, fold-for-matching edge cases, packing parity with
 * the legacy ReaderTTSControls chunker, and DOM extraction offset compatibility.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import {
  ReaderSpeechIndex,
  buildSpeechIndexFromText,
  foldForMatch,
  packWordStream,
  selectionContextToTTSAnchor,
} from "../readerSpeechIndex";
import { buildDOMSectionInput, extractSpeechSectionsFromDOM } from "../ttsTextExtraction";

/** Reimplementation of the legacy ReaderTTSControls.buildChunks chunker. */
function legacyBuildChunks(text: string, maxChunkSize = 700, target = 420): string[] {
  const targetSize = Math.min(target, Math.max(1, maxChunkSize));
  const hardSize = Math.max(1, maxChunkSize);
  const normalize = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const pageRegex = /<page number="(\d+)"\s*\/?>/g;
  let cleanedText = "";
  let lastIdx = 0;
  let match;
  while ((match = pageRegex.exec(text)) !== null) {
    const fragment = normalize(text.slice(lastIdx, match.index));
    if (fragment) cleanedText += (cleanedText ? " " : "") + fragment;
    lastIdx = pageRegex.lastIndex;
  }
  const remaining = normalize(text.slice(lastIdx));
  if (remaining) cleanedText += (cleanedText ? " " : "") + remaining;
  if (!cleanedText) return [];
  const sentences = cleanedText.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0) return [cleanedText];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= targetSize) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = sentence;
      continue;
    }
    const words = sentence.split(/\s+/);
    let fragment = "";
    for (const word of words) {
      const next = fragment ? `${fragment} ${word}` : word;
      if (next.length <= hardSize) fragment = next;
      else {
        if (fragment) chunks.push(fragment);
        fragment = word;
      }
    }
    if (fragment) chunks.push(fragment);
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Deterministic pseudo-random text generator for parity checks. */
function seededSentence(seed: number, words: number): string {
  let s = seed;
  const vocab = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  const out: string[] = [];
  for (let i = 0; i < words; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out.push(vocab[s % vocab.length]);
  }
  out[out.length - 1] += ".";
  return out.join(" ");
}

describe("ReaderSpeechIndex packing parity with the legacy chunker", () => {
  it("produces identical chunk texts for varied inputs", () => {
    const cases = [
      "Short text. Second sentence! Third? Fourth:",
      Array.from({ length: 80 }, (_, i) => seededSentence(i + 1, 8 + (i % 12))).join(" "),
      `Before. <page number="3"/> Page three text here. More text follows. <page number="4"/> Four.`,
      `${seededSentence(99, 120)} ${seededSentence(7, 60)}`,
      "no punctuation at all just words",
    ];
    for (const text of cases) {
      const index = buildSpeechIndexFromText(text, 700);
      expect(index.chunks.map((c) => c.text)).toEqual(legacyBuildChunks(text, 700));
    }
  });

  it("respects a smaller max chunk size", () => {
    const text = Array.from({ length: 40 }, (_, i) => seededSentence(i + 50, 10)).join(" ");
    const index = buildSpeechIndexFromText(text, 120);
    expect(index.chunks.length).toBeGreaterThan(1);
    for (const chunk of index.chunks) expect(chunk.text.length).toBeLessThanOrEqual(120);
  });
});

describe("word/anchor round-trips", () => {
  it("text anchors: locate(word) → position whose word carries the same anchor", () => {
    const surface = "markdown";
    const index = new ReaderSpeechIndex([
      {
        key: "doc",
        text: "one two three. four five six. seven eight nine.",
        anchorAt: (offset) => ({ kind: "text", surface, startOffset: offset }),
        offsetForAnchor: (a) => (a.kind === "text" && a.surface === surface ? a.startOffset : null),
      },
    ]);
    for (const chunk of index.chunks) {
      for (const word of chunk.words) {
        const pos = index.locate(word.anchor!);
        expect(pos).not.toBeNull();
        expect(index.chunks[pos!.chunkIndex].words[pos!.wordIndex].text).toBe(word.text);
        expect(index.chunks[pos!.chunkIndex].words[pos!.wordIndex].anchor).toEqual(word.anchor);
      }
    }
  });

  it("epub anchors via per-section offsetForAnchor disambiguate duplicate sections", () => {
    const mk = (spineIndex: number, text: string) => ({
      key: `spine-${spineIndex}`,
      text,
      anchorAt: (offset: number) => ({ kind: "epub" as const, spineIndex, sectionOffset: offset }),
      offsetForAnchor: (a: any) => (a.kind === "epub" && a.spineIndex === spineIndex ? a.sectionOffset : null),
    });
    const index = new ReaderSpeechIndex([
      mk(0, "duplicate sentence here. more filler text."),
      mk(3, "unique lead words. duplicate sentence here."),
    ]);
    const pos = index.locate({ kind: "epub", spineIndex: 3, sectionOffset: 25 });
    expect(pos).not.toBeNull();
    const word = index.chunks[pos!.chunkIndex].words[pos!.wordIndex];
    expect(word.sectionOffset).toBeGreaterThanOrEqual(25);
    // The word's own anchor points into spine 3 even though the chunk may span
    // both sections.
    expect(word.anchor).toEqual({ kind: "epub", spineIndex: 3, sectionOffset: word.sectionOffset });
  });

  it("page anchors locate the first word at/after the marker offset", () => {
    const index = buildSpeechIndexFromText(
      `Intro text. <page number="2"/> Second page starts here. More. <page number="5"/> Five content.`,
    );
    const pos = index.locate({ kind: "page", pageNumber: 5, pageOffset: 0 });
    expect(pos).not.toBeNull();
    expect(index.chunks[pos!.chunkIndex].words[pos!.wordIndex].text).toBe("Five");
    // pageOffset advances within the page
    const pos2 = index.locate({ kind: "page", pageNumber: 2, pageOffset: 13 }); // "here." area
    expect(pos2).not.toBeNull();
    const w = index.chunks[pos2!.chunkIndex].words[pos2!.wordIndex];
    expect(["starts", "here.", "Second"]).toContain(w.text);
  });

  it("locate returns null for unknown anchors", () => {
    const index = buildSpeechIndexFromText("just words here.");
    expect(index.locate({ kind: "page", pageNumber: 99, pageOffset: 0 })).toBeNull();
    expect(
      index.locate({ kind: "pdf-word", wordId: "p1:w1" }),
    ).toBeNull();
  });
});

describe("sliceChunkAtWord", () => {
  it("slices the chunk at the word boundary with rebased spans", () => {
    const index = buildSpeechIndexFromText(
      Array.from({ length: 30 }, (_, i) => seededSentence(i + 1, 6)).join(" "),
    );
    const chunk = index.chunks[0];
    const sliced = index.sliceChunkAtWord(0, 5)!;
    expect(sliced).not.toBeNull();
    expect(sliced.transient).toBe(true);
    expect(sliced.text.startsWith(chunk.words[5].text)).toBe(true);
    expect(sliced.words.length).toBe(chunk.words.length - 5);
    expect(sliced.words[0].normStart).toBe(0);
    expect(sliced.words[0].text).toBe(chunk.words[5].text);
    // The underlying index is untouched.
    expect(index.chunks[0].words.length).toBe(chunk.words.length);
    expect(index.sliceChunkAtWord(0, chunk.words.length)).toBeNull();
  });
});

describe("getScrollPercent", () => {
  it("is monotonic and bounded", () => {
    const index = buildSpeechIndexFromText(
      Array.from({ length: 60 }, (_, i) => seededSentence(i + 1, 8)).join(" "),
    );
    let prev = 0;
    for (let i = 0; i < index.chunks.length; i++) {
      const pct = index.getScrollPercent(i);
      expect(pct).toBeGreaterThanOrEqual(prev);
      expect(pct).toBeLessThanOrEqual(100);
      prev = pct;
    }
    expect(index.getScrollPercent(index.chunks.length)).toBe(100);
  });
});

describe("foldForMatch", () => {
  it("folds curly quotes, apostrophes, dashes, ligatures, and whitespace", () => {
    expect(foldForMatch("“quoted”")).toBe('"quoted"');
    expect(foldForMatch("don’t")).toBe("don't");
    expect(foldForMatch("en–dash —em and −minus")).toBe("en-dash -em and -minus");
    expect(foldForMatch("ﬁle ﬂow ﬀo ﬃce ﬄy")).toBe("file flow ffo ffice ffly");
    expect(foldForMatch("  Multiple\t\nspaces   ")).toBe("multiple spaces");
    expect(foldForMatch("Mixed CASE")).toBe("mixed case");
    expect(foldForMatch("soft\u00ADhyphen")).toBe("softhyphen");
  });

  it("makes smart-quote document text match ASCII TTS text", () => {
    expect(foldForMatch("“Hello — world’s”")).toBe(foldForMatch('"Hello - world\'s"'));
  });
});

describe("packWordStream", () => {
  it("hard-wraps over-long sentences by words", () => {
    const text = "word ".repeat(10).trim();
    const units: Array<{ start: number; end: number }> = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text)) !== null) units.push({ start: m.index, end: re.lastIndex });
    const groups = packWordStream(units, [{ start: 0, end: units.length }], {
      targetSize: 15,
      hardSize: 15,
      targetSeparatorCost: 1,
      sliceLongWords: false,
      hardWrapAfterPush: false,
      carryHardWrapTrailingFragment: false,
    });
    for (const g of groups) {
      expect(g.end - g.start <= 15 || text.slice(g.start, g.end).length <= 15).toBe(true);
    }
    expect(groups.length).toBeGreaterThan(1);
  });
});

describe("extractSpeechSectionsFromDOM", () => {
  function mount(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = [
      "<nav>Site navigation</nav>",
      "<p id='p1'>First paragraph with content.</p>",
      "<p id='p2'>Second paragraph, <em>emphasized</em> part.</p>",
      "<div aria-hidden='true'>Decorative hidden text</div>",
      "<p id='p3'>Third paragraph the end.</p>",
    ].join("");
    document.body.appendChild(root);
    return root;
  }

  it("extracts speakable text and skips chrome/hidden elements", () => {
    const root = mount();
    const [section] = extractSpeechSectionsFromDOM(root, { key: "test" });
    expect(section.text).toBe(
      "First paragraph with content. Second paragraph, emphasized part. Third paragraph the end.",
    );
    root.remove();
  });

  it("emits offsets compatible with buildTextSelectionContext flattened text", () => {
    const root = mount();
    const [section] = extractSpeechSectionsFromDOM(root, { key: "test" });
    const input = buildDOMSectionInput(section, "markdown");

    // Simulate a selection of the word "emphasized" via Range over the root —
    // the same measurement buildTextSelectionContext uses.
    const em = root.querySelector("em")!.firstChild!;
    const probe = document.createRange();
    probe.selectNodeContents(root);
    probe.setEnd(em, 0);
    const flatStart = probe.toString().length;

    // Round-trip: normalized offset of "emphasized" → text anchor → back.
    const normOffset = section.text.indexOf("emphasized");
    const anchor = input.anchorAt!(normOffset)!;
    expect(anchor.kind).toBe("text");
    expect((anchor as any).startOffset).toBe(flatStart);
    const back = input.offsetForAnchor!(anchor);
    expect(back).toBe(normOffset);
    root.remove();
  });

  it("round-trips through the speech index", () => {
    const root = mount();
    const [section] = extractSpeechSectionsFromDOM(root, { key: "test" });
    const input = buildDOMSectionInput(section, "markdown");
    const index = new ReaderSpeechIndex([input]);
    for (const chunk of index.chunks) {
      for (const word of chunk.words) {
        const pos = index.locate(word.anchor!);
        expect(pos).not.toBeNull();
        expect(index.chunks[pos!.chunkIndex].words[pos!.wordIndex].text).toBe(word.text);
      }
    }
    root.remove();
  });
});

describe("selectionContextToTTSAnchor", () => {
  it("EPUB selections use the first CFI range", () => {
    expect(
      selectionContextToTTSAnchor({
        cfiRange: "epubcfi(/6/8!/4/10,/1:20)",
        cfiRanges: ["epubcfi(/6/10!/4/2,/1:5)", "epubcfi(/6/8!/4/10,/1:20)"],
      }),
    ).toEqual({ kind: "epub-cfi", cfi: "epubcfi(/6/10!/4/2,/1:5)" });
    expect(selectionContextToTTSAnchor({ cfiRange: "epubcfi(/6/8)" })).toEqual({
      kind: "epub-cfi",
      cfi: "epubcfi(/6/8)",
    });
  });

  it("PDF prefers canonical word ID, then token ID, then page", () => {
    expect(
      selectionContextToTTSAnchor({ canonical: { startWordId: "p4:w19" }, tokenData: { startTokenId: "t7" } }),
    ).toEqual({ kind: "pdf-word", wordId: "p4:w19" });
    expect(selectionContextToTTSAnchor({ tokenData: { startTokenId: "t7" } })).toEqual({
      kind: "pdf-token",
      tokenId: "t7",
    });
    expect(selectionContextToTTSAnchor({ pages: [{ pageNumber: 12 }] })).toEqual({
      kind: "page-offset",
      pageNumber: 12,
      pageOffset: 0,
    });
  });

  it("markdown/html selections use the exact start offset", () => {
    expect(selectionContextToTTSAnchor({ surface: "markdown", startOffset: 321 })).toEqual({
      kind: "text-offset",
      surface: "markdown",
      startOffset: 321,
    });
  });

  it("returns null for unmappable selections", () => {
    expect(selectionContextToTTSAnchor(null)).toBeNull();
    expect(selectionContextToTTSAnchor({})).toBeNull();
    expect(selectionContextToTTSAnchor({ surface: "x-thread" })).toBeNull();
  });
});
