import { describe, expect, it } from "vitest";
import { errorAlignTokens, alignmentMatchRate } from "../errorAlign/errorAlign";

describe("errorAlignTokens", () => {
  it("aligns identical token sequences", () => {
    const ref = ["This", "is", "a", "test"];
    const align = errorAlignTokens(ref, ref, ref.map((t) => t.toLowerCase()), ref.map((t) => t.toLowerCase()));
    expect(align.every((a) => a.op === "MATCH")).toBe(true);
    expect(alignmentMatchRate(align)).toBe(1);
  });

  it("handles narrator introduction (INSERT)", () => {
    const ref = ["This", "is", "a", "test"];
    const hyp = ["Welcome", "this", "is", "a", "test"];
    const align = errorAlignTokens(
      ref,
      hyp,
      ref.map((t) => t.toLowerCase()),
      hyp.map((t) => t.toLowerCase()),
    );
    expect(align.some((a) => a.op === "INSERT")).toBe(true);
    expect(align.some((a) => a.op === "MATCH")).toBe(true);
  });

  it("handles STT substitution Mr vs mister", () => {
    const ref = ["Mr", "Smith"];
    const hyp = ["mister", "Smith"];
    const align = errorAlignTokens(
      ref,
      hyp,
      ref.map((t) => t.toLowerCase()),
      hyp.map((t) => t.toLowerCase()),
    );
    expect(align.some((a) => a.op === "SUBSTITUTE" || a.op === "MATCH")).toBe(true);
  });

  it("handles deleted ebook content", () => {
    const ref = ["one", "two", "three", "four"];
    const hyp = ["one", "three", "four"];
    const align = errorAlignTokens(
      ref,
      hyp,
      ref.map((t) => t.toLowerCase()),
      hyp.map((t) => t.toLowerCase()),
    );
    expect(align.some((a) => a.op === "DELETE")).toBe(true);
  });
});
