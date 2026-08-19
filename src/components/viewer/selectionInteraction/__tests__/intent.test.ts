/**
 * Unit tests for the selection-intent resolver (spec:
 * selection-intent-resolution; task 1.2). The parity suite proves the
 * `Intl.Segmenter` path and the regex fallback path agree on every
 * ASCII/Unicode case, and that ambiguous tokens degrade to `phrase` — never
 * to a wrong `word`.
 */

import { describe, expect, it } from "vitest";
import {
  dictionaryQueryForText,
  resolveSelectionIntent,
  resolveSelectionIntentUsingFallback,
  resolveSelectionIntentUsingSegmenter,
  selectionClassifierStatus,
} from "../intent";

type WordCase = [label: string, input: string, word: string, queryWord: string];

const wordCases: WordCase[] = [
  ["plain word", "epistemological", "epistemological", "epistemological"],
  ["trailing comma", "word,", "word", "word"],
  ["quoted word", '"word"', "word", "word"],
  ["parens and period", "(word).", "word", "word"],
  ["internal apostrophe", "can't", "can't", "can't"],
  ["internal hyphens", "mother-in-law", "mother-in-law", "mother-in-law"],
  ["acute accent", "résumé", "résumé", "résumé"],
  ["diaeresis", "naïve", "naïve", "naïve"],
  ["umlaut", "über", "über", "über"],
  ["cjk single run", "日本語", "日本語", "日本語"],
  ["leading and trailing punctuation", '…"ephemeral,"…', "ephemeral", "ephemeral"],
  ["uppercase normalizes for query", "Ephemeral", "Ephemeral", "ephemeral"],
];

const phraseCases = [
  ["two words", "two words"],
  ["sentence", "The quick brown fox jumps over the lazy dog."],
  ["cjk multi-run", "日本語 中文"],
  ["mixed run joined by space", "日本語 test"],
  ["ambiguous mixed-script token", "日本語abc"],
];

const noneCases = [
  ["empty", ""],
  ["whitespace only", "   \n\t "],
  ["punctuation only", "..."],
  ["punctuation only (dash)", "—"],
];

const urlCases = ["https://example.com/a", "http://example.com", "www.example.com/path"];

describe.each([
  ["resolveSelectionIntent (detected)", resolveSelectionIntent],
  ["segmenter path", resolveSelectionIntentUsingSegmenter],
  ["fallback path", resolveSelectionIntentUsingFallback],
] as const)("%s", (_name, resolve) => {
  it.each(wordCases)("classifies %s as a single word", (_label, input, word, queryWord) => {
    expect(resolve(input)).toEqual({ kind: "word", word, queryWord });
  });

  it.each(phraseCases)("classifies %s as a phrase", (_label, input) => {
    expect(resolve(input)).toEqual({ kind: "phrase" });
  });

  it.each(noneCases)("classifies %s as none", (_label, input) => {
    expect(resolve(input)).toEqual({ kind: "none" });
  });

  it.each(urlCases.map((u) => [u] as [string]))("classifies %s as a url", (input) => {
    expect(resolve(input)).toEqual({ kind: "url" });
  });

  it("returns none for null/undefined input", () => {
    expect(resolve(null)).toEqual({ kind: "none" });
    expect(resolve(undefined)).toEqual({ kind: "none" });
  });
});

describe("classifier parity", () => {
  it("segmenter and fallback agree on every word/phrase/none/url case", () => {
    const inputs = [
      ...wordCases.map(([, input]) => input),
      ...phraseCases.map(([, input]) => input),
      ...noneCases.map(([, input]) => input),
      ...urlCases,
      "",
      null,
    ];
    for (const input of inputs) {
      const viaFallback = resolveSelectionIntentUsingFallback(input);
      const viaSegmenter = resolveSelectionIntentUsingSegmenter(input);
      expect(
        viaFallback,
        `fallback (${JSON.stringify(viaFallback)}) and segmenter (${JSON.stringify(
          viaSegmenter,
        )}) disagree on ${JSON.stringify(input)}`,
      ).toEqual(viaSegmenter);
    }
  });

  it("reports the environment's detected capabilities", () => {
    expect(typeof selectionClassifierStatus.segmenter).toBe("boolean");
    expect(typeof selectionClassifierStatus.propertyEscapes).toBe("boolean");
  });
});

describe("dictionaryQueryForText", () => {
  it("uses the resolver's normalized query for word selections", () => {
    expect(dictionaryQueryForText('"ephemeral,"')).toBe("ephemeral");
  });

  it("queries trimmed lowercased phrases for multi-word selections", () => {
    expect(dictionaryQueryForText("Fire Drill.")).toBe("fire drill");
  });

  it("returns an empty query for none/url intents", () => {
    expect(dictionaryQueryForText("...")).toBe("");
    expect(dictionaryQueryForText("https://example.com/a")).toBe("");
    expect(dictionaryQueryForText(null)).toBe("");
  });
});
