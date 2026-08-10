import { describe, it, expect } from "vitest";
import { tolerantPhraseRegex, collectSectionCfiMatches } from "../epubQuoteSearch";

describe("tolerantPhraseRegex", () => {
  it("matches a phrase with flexible whitespace", () => {
    const regex = tolerantPhraseRegex("the quick brown fox");
    expect("The  quick\nbrown\tfox jumps".match(regex)).not.toBeNull();
  });

  it("matches straight quotes in the query against curly quotes in the book", () => {
    const regex = tolerantPhraseRegex("what we call 'past' and 'present'");
    expect("What we call \u2018past\u2019 and \u201cpresent\u201d indeed".match(regex)).not.toBeNull();
  });

  it("matches straight dashes against en/em dashes in the book", () => {
    const regex = tolerantPhraseRegex("the well-known author");
    expect("the well\u2013known author".match(regex)).not.toBeNull();
  });

  it("matches identical text exactly", () => {
    const regex = tolerantPhraseRegex("exact phrase here");
    expect("exact phrase here".match(regex)).not.toBeNull();
  });

  it("does not match a different phrase", () => {
    const regex = tolerantPhraseRegex("nothing alike");
    expect("something else entirely".match(regex)).toBeNull();
  });

  it("is case-insensitive", () => {
    const regex = tolerantPhraseRegex("The Capital City");
    expect("the capital city".match(regex)).not.toBeNull();
  });
});

describe("collectSectionCfiMatches", () => {
  it("matches a phrase split across text nodes by an inline element", () => {
    // `<a id="page_7"/>` page anchors split paragraphs into text nodes and
    // drop the whitespace the indexed text had — the match must span nodes.
    const doc = new DOMParser().parseFromString(
      '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>why this is so <a id="page_7"/>in a later chapter. Frequently, my obligatory athletes come to class.</p></body></html>',
      "text/xml"
    );
    const section = {
      document: doc,
      cfiFromRange: () => "epubcfi(/6/4!)",
    };
    const cfis = collectSectionCfiMatches(
      section,
      tolerantPhraseRegex("why this is so in a later chapter. Frequently, my obligatory athletes come to class")
    );
    expect(cfis.length).toBeGreaterThan(0);
  });

  it("matches a phrase spanning a paragraph boundary", () => {
    const doc = new DOMParser().parseFromString(
      '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>End of the first paragraph.</p><p>Start of the second paragraph with the cited passage.</p></body></html>',
      "text/xml"
    );
    const section = {
      document: doc,
      cfiFromRange: () => "epubcfi(/6/4!)",
    };
    const cfis = collectSectionCfiMatches(
      section,
      tolerantPhraseRegex("first paragraph. Start of the second paragraph with the cited passage")
    );
    expect(cfis.length).toBeGreaterThan(0);
  });

  it("collects one CFI per match from a section's DOM", () => {
    const doc = new DOMParser().parseFromString(
      "<html><body><p>Intro words.</p><p>The cited passage lives here.</p></body></html>",
      "text/html"
    );
    let counter = 0;
    const section = {
      document: doc,
      cfiFromRange: () => `epubcfi(/6/${4 + counter++}!)`,
    };

    const cfis = collectSectionCfiMatches(section, tolerantPhraseRegex("the cited passage"));
    expect(cfis).toEqual(["epubcfi(/6/4!)"]);
  });

  it("returns an empty array for a section without the phrase", () => {
    const doc = new DOMParser().parseFromString(
      "<html><body><p>Nothing relevant here.</p></body></html>",
      "text/html"
    );
    const section = { document: doc, cfiFromRange: () => "epubcfi(/6/4!)" };
    expect(collectSectionCfiMatches(section, tolerantPhraseRegex("missing passage"))).toEqual([]);
  });

  it("returns an empty array when the section has no document", () => {
    expect(collectSectionCfiMatches({}, tolerantPhraseRegex("anything"))).toEqual([]);
  });
});
