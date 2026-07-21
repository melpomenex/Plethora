import { describe, it, expect } from "vitest";
import { isKindleClippingsFilename } from "../kindleClippingsImport";

/**
 * Filename sniff for the Kindle-routing decision on the frontend.
 *
 * The authoritative content sniff lives in Rust (`is_kindle_clippings_path`);
 * these tests just pin down the filename gate that decides when to *try* the
 * Kindle import flow vs. falling straight through to the generic single-doc
 * importer.
 */
describe("isKindleClippingsFilename", () => {
  it("matches the canonical filename on both POSIX and Windows paths", () => {
    expect(isKindleClippingsFilename("/home/user/My Clippings.txt")).toBe(true);
    expect(isKindleClippingsFilename("C:\\Users\\user\\My Clippings.txt")).toBe(true);
    expect(isKindleClippingsFilename("/Volumes/Kindle/documents/My Clippings.txt")).toBe(true);
  });

  it("matches a bare filename with no path separators", () => {
    expect(isKindleClippingsFilename("My Clippings.txt")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isKindleClippingsFilename("my clippings.txt")).toBe(true);
    expect(isKindleClippingsFilename("MY CLIPPINGS.txt")).toBe(true);
    expect(isKindleClippingsFilename("My cLiPpInGs.txt")).toBe(true);
  });

  it("treats underscores and hyphens as word separators", () => {
    // The Kindle-generated name uses a space, but users rename the file.
    expect(isKindleClippingsFilename("my_clippings.txt")).toBe(true);
    expect(isKindleClippingsFilename("my-clippings.txt")).toBe(true);
    expect(isKindleClippingsFilename("My_Clippings.txt")).toBe(true);
  });

  it("collapses runs of whitespace inside the stem", () => {
    expect(isKindleClippingsFilename("My  Clippings.txt")).toBe(true); // double space
    expect(isKindleClippingsFilename("My\tClippings.txt")).toBe(true); // tab
  });

  it("rejects unrelated .txt files even if they contain 'clippings'", () => {
    expect(isKindleClippingsFilename("clippings.txt")).toBe(false);
    expect(isKindleClippingsFilename("my-clippings-export.txt")).toBe(false);
    expect(isKindleClippingsFilename("notes.txt")).toBe(false);
    expect(isKindleClippingsFilename("kindle-clippings.txt")).toBe(false);
    expect(isKindleClippingsFilename("/tmp/My Clippings (backup).txt")).toBe(false);
  });

  it("rejects files without the .txt extension", () => {
    expect(isKindleClippingsFilename("My Clippings")).toBe(false);
    expect(isKindleClippingsFilename("My Clippings.md")).toBe(false);
    expect(isKindleClippingsFilename("My Clippings.pdf")).toBe(false);
  });
});
