import { describe, expect, it } from "vitest";
import { baseNameOf, naturalCompare, stripExtension } from "../naturalSort";

describe("naturalCompare", () => {
  it("orders plain numbers numerically (1, 2, 10 — not 1, 10, 2)", () => {
    const sorted = ["1.mp3", "10.mp3", "2.mp3"].sort(naturalCompare);
    expect(sorted).toEqual(["1.mp3", "2.mp3", "10.mp3"]);
  });

  it("orders two-digit tracks after single-digit tracks", () => {
    const sorted = ["09 Track.mp3", "10 Track.mp3", "11 Track.mp3", "2 Track.mp3"].sort(
      naturalCompare,
    );
    expect(sorted).toEqual(["2 Track.mp3", "09 Track.mp3", "10 Track.mp3", "11 Track.mp3"]);
  });

  it("keeps disc order when digits appear mid-name", () => {
    const sorted = ["Disc 10/01.mp3", "Disc 2/01.mp3", "Disc 1/02.mp3", "Disc 1/01.mp3"].sort(
      naturalCompare,
    );
    expect(sorted).toEqual([
      "Disc 1/01.mp3",
      "Disc 1/02.mp3",
      "Disc 2/01.mp3",
      "Disc 10/01.mp3",
    ]);
  });

  it("is case-insensitive for text", () => {
    expect(naturalCompare("alpha", "Beta")).toBeLessThan(0);
    expect(naturalCompare("ALPHA", "alpha")).toBe(0);
  });

  it("handles padded numbers as numerically equal", () => {
    expect(naturalCompare("01 Intro", "1 Intro")).toBe(0);
  });

  it("handles unicode names without throwing", () => {
    expect(() => naturalCompare("第七章.mp3", "第八章.mp3")).not.toThrow();
    expect(naturalCompare("第七章.mp3", "第八章.mp3")).toBeLessThan(0);
  });
});

describe("baseNameOf", () => {
  it("extracts unix-style final segments", () => {
    expect(baseNameOf("/a/b/01 - Track.mp3")).toBe("01 - Track.mp3");
  });

  it("extracts windows-style final segments", () => {
    expect(baseNameOf("C:\\books\\book\\01.mp3")).toBe("01.mp3");
  });

  it("returns the string itself when no separator exists", () => {
    expect(baseNameOf("01.mp3")).toBe("01.mp3");
  });
});

describe("stripExtension", () => {
  it("strips the last extension", () => {
    expect(stripExtension("01 - Track.mp3")).toBe("01 - Track");
    expect(stripExtension("archive.tar.gz")).toBe("archive.tar");
  });

  it("keeps dotfiles and extensionless names intact", () => {
    expect(stripExtension(".hidden")).toBe(".hidden");
    expect(stripExtension("noext")).toBe("noext");
  });
});
