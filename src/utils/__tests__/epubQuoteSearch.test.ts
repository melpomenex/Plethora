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
